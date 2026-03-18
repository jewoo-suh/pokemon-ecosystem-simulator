"""
Perlin Noise Map Generator for Pokemon Ecosystem Simulator

Generates a 2D biome map using layered simplex noise.
Splits disconnected regions of the same biome type into separate biome instances
so that species in one lake can't interact with species in another disconnected lake.
Computes biome adjacency and writes it to the database.
Maps are saved as JSON for the frontend to render.

Usage:
    python generate_map.py                # Generate with random seed
    python generate_map.py --seed 42      # Generate with specific seed
    python generate_map.py --seed 42 --size 200   # 200x200 grid
    python generate_map.py --seed 42 --preview    # Save a preview image
"""

import argparse
import json
import os
import sys
import time
from collections import deque
import numpy as np
from opensimplex import OpenSimplex

# DB config from sibling service
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "simulation"))
from config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD

import psycopg2

# Base biome IDs (must match database)
BASE_BIOMES = {
    "sea": 7,
    "waters-edge": 9,
    "forest": 2,
    "grassland": 3,
    "rough-terrain": 6,
    "mountain": 4,
    "cave": 1,
    "urban": 8,
    "rare": 5,
}

# Biome colors for preview image (RGB) — keyed by base biome ID
BASE_BIOME_COLORS = {
    7: (30, 100, 200),    # sea — deep blue
    9: (70, 170, 190),    # waters-edge — teal
    2: (34, 120, 50),     # forest — dark green
    3: (140, 180, 60),    # grassland — yellow-green
    6: (150, 110, 70),    # rough-terrain — brown
    4: (160, 160, 170),   # mountain — gray
    1: (80, 60, 50),      # cave — dark brown
    8: (130, 100, 150),   # urban — purple
    5: (220, 190, 60),    # rare — gold
}


def generate_noise_layers(width, height, seed):
    """Generate elevation and moisture noise layers."""
    elevation_gen = OpenSimplex(seed=seed)
    moisture_gen = OpenSimplex(seed=seed + 1000)
    urban_gen = OpenSimplex(seed=seed + 2000)

    elevation = np.zeros((height, width))
    moisture = np.zeros((height, width))
    urban_noise = np.zeros((height, width))

    # Multi-octave noise for natural-looking terrain
    for y in range(height):
        for x in range(width):
            nx = x / width
            ny = y / height

            # Elevation: large landmasses + detail
            e = (0.50 * elevation_gen.noise2(2 * nx, 2 * ny)
                 + 0.30 * elevation_gen.noise2(4 * nx, 4 * ny)
                 + 0.15 * elevation_gen.noise2(8 * nx, 8 * ny)
                 + 0.05 * elevation_gen.noise2(16 * nx, 16 * ny))

            # Island effect: lower elevation near edges to create ocean borders
            dx = 2 * nx - 1
            dy = 2 * ny - 1
            dist_from_center = min(1.0, (dx * dx + dy * dy) ** 0.5 / 1.0)
            e = e - 0.3 * dist_from_center

            elevation[y][x] = e

            # Moisture: separate pattern
            m = (0.60 * moisture_gen.noise2(2.5 * nx, 2.5 * ny)
                 + 0.30 * moisture_gen.noise2(5 * nx, 5 * ny)
                 + 0.10 * moisture_gen.noise2(10 * nx, 10 * ny))
            moisture[y][x] = m

            # Urban: high-frequency spots
            u = urban_gen.noise2(8 * nx, 8 * ny)
            urban_noise[y][x] = u

    # Normalize to 0-1
    elevation = (elevation - elevation.min()) / (elevation.max() - elevation.min())
    moisture = (moisture - moisture.min()) / (moisture.max() - moisture.min())

    return elevation, moisture, urban_noise


def assign_biome_types(elevation, moisture, urban_noise):
    """Map elevation + moisture to base biome type IDs."""
    height, width = elevation.shape
    grid = np.zeros((height, width), dtype=int)

    for y in range(height):
        for x in range(width):
            e = elevation[y][x]
            m = moisture[y][x]
            u = urban_noise[y][x]

            if e < 0.28:
                grid[y][x] = BASE_BIOMES["sea"]
            elif e < 0.35:
                grid[y][x] = BASE_BIOMES["waters-edge"]
            elif e > 0.82:
                grid[y][x] = BASE_BIOMES["cave"]
            elif e > 0.72:
                grid[y][x] = BASE_BIOMES["mountain"]
            elif e > 0.68 and m > 0.75:
                grid[y][x] = BASE_BIOMES["rare"]
            elif e > 0.58 and m < 0.45:
                grid[y][x] = BASE_BIOMES["rough-terrain"]
            elif 0.40 < e < 0.58 and u > 0.55 and m < 0.55:
                grid[y][x] = BASE_BIOMES["urban"]
            elif m > 0.55:
                grid[y][x] = BASE_BIOMES["forest"]
            else:
                grid[y][x] = BASE_BIOMES["grassland"]

    return grid


def flood_fill_regions(grid):
    """Find connected components per biome type using BFS flood fill.

    Returns:
        regions: list of (base_biome_id, set_of_cells) sorted by size descending per type
        region_grid: numpy array where each cell has a unique region ID
    """
    height, width = grid.shape
    visited = np.zeros((height, width), dtype=bool)
    regions_by_type = {}  # base_biome_id -> [(set_of_cells), ...]

    for y in range(height):
        for x in range(width):
            if visited[y][x]:
                continue

            biome_type = int(grid[y][x])
            cells = set()
            queue = deque([(y, x)])
            visited[y][x] = True

            while queue:
                cy, cx = queue.popleft()
                cells.add((cy, cx))

                for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < height and 0 <= nx < width and not visited[ny][nx]:
                        if grid[ny][nx] == biome_type:
                            visited[ny][nx] = True
                            queue.append((ny, nx))

            if biome_type not in regions_by_type:
                regions_by_type[biome_type] = []
            regions_by_type[biome_type].append(cells)

    # Sort each type's regions by size (largest first)
    for biome_type in regions_by_type:
        regions_by_type[biome_type].sort(key=len, reverse=True)

    return regions_by_type


def split_regions_to_db(regions_by_type, grid, conn):
    """Create separate biome DB rows for disconnected regions.

    The largest region of each type keeps the original biome ID.
    Smaller regions get new biome IDs.

    Returns:
        region_id_map: {base_biome_id -> [(db_biome_id, cells), ...]}
        final_grid: updated numpy grid with new biome IDs
        biome_colors: {str(db_biome_id) -> [r, g, b]} for all biomes including splits
    """
    cur = conn.cursor()
    height, width = grid.shape
    final_grid = grid.copy()

    biome_id_to_name = {v: k for k, v in BASE_BIOMES.items()}
    region_id_map = {}
    biome_colors = {}
    all_new_biome_ids = []  # track new sub-biome IDs for habitat/affinity duplication

    # Get existing biome properties
    cur.execute("SELECT id, name, description, carrying_capacity, biomass_factor FROM biomes")
    biome_props = {r[0]: r for r in cur.fetchall()}

    for base_id, regions in regions_by_type.items():
        base_name = biome_id_to_name.get(base_id, f"biome_{base_id}")
        base_color = BASE_BIOME_COLORS.get(base_id, (128, 128, 128))
        region_id_map[base_id] = []

        for i, cells in enumerate(regions):
            if i == 0:
                # Largest region keeps original ID
                db_id = base_id
            else:
                # Create new biome row for smaller region
                props = biome_props.get(base_id)
                sub_name = f"{base_name}_{i + 1}"
                carrying_cap = props[3] if props else 10000
                biomass = float(props[4]) if props else 1.0

                # Scale carrying capacity by relative size
                largest_size = len(regions[0])
                relative_size = len(cells) / largest_size
                scaled_cap = max(500, int(carrying_cap * relative_size))

                cur.execute("""
                    INSERT INTO biomes (name, description, carrying_capacity, biomass_factor)
                    VALUES (%s, %s, %s, %s) RETURNING id
                """, (sub_name, f"Split region of {base_name}", scaled_cap, biomass))
                db_id = cur.fetchone()[0]
                all_new_biome_ids.append((db_id, base_id))

            region_id_map[base_id].append((db_id, cells))

            # Assign to grid
            for (cy, cx) in cells:
                final_grid[cy][cx] = db_id

            # Slight color variation for sub-regions
            if i == 0:
                biome_colors[str(db_id)] = list(base_color)
            else:
                # Slightly shift color for visual distinction
                shift = ((i * 17) % 30) - 15
                biome_colors[str(db_id)] = [
                    max(0, min(255, base_color[0] + shift)),
                    max(0, min(255, base_color[1] - shift)),
                    max(0, min(255, base_color[2] + shift // 2)),
                ]

    # Duplicate pokemon_habitats for new sub-biomes
    for new_id, parent_id in all_new_biome_ids:
        cur.execute("""
            INSERT INTO pokemon_habitats (pokemon_id, biome_id)
            SELECT pokemon_id, %s FROM pokemon_habitats WHERE biome_id = %s
            ON CONFLICT DO NOTHING
        """, (new_id, parent_id))

    # Duplicate type_biome_affinity for new sub-biomes
    for new_id, parent_id in all_new_biome_ids:
        cur.execute("""
            INSERT INTO type_biome_affinity (type_id, biome_id, affinity)
            SELECT type_id, %s, affinity FROM type_biome_affinity WHERE biome_id = %s
            ON CONFLICT DO NOTHING
        """, (new_id, parent_id))

    conn.commit()
    cur.close()

    return region_id_map, final_grid, biome_colors


def compute_adjacency(grid):
    """Determine which biomes share borders on the map."""
    height, width = grid.shape
    adjacent_pairs = set()

    for y in range(height):
        for x in range(width):
            biome = grid[y][x]
            for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                ny, nx = y + dy, x + dx
                if 0 <= ny < height and 0 <= nx < width:
                    neighbor = grid[ny][nx]
                    if neighbor != biome:
                        pair = tuple(sorted([int(biome), int(neighbor)]))
                        adjacent_pairs.add(pair)

    return adjacent_pairs


def save_map(grid, biome_colors, seed, output_dir, elevation=None):
    """Save map as JSON for frontend consumption."""
    height, width = grid.shape

    map_data = {
        "seed": seed,
        "width": width,
        "height": height,
        "biome_colors": biome_colors,
        "grid": grid.flatten().tolist(),
    }

    # Include elevation data for 3D terrain rendering (quantized to uint8)
    if elevation is not None:
        elevation_u8 = (np.clip(elevation, 0, 1) * 255).astype(np.uint8)
        map_data["elevation"] = elevation_u8.flatten().tolist()

    filepath = os.path.join(output_dir, f"map_seed_{seed}.json")
    with open(filepath, "w") as f:
        json.dump(map_data, f)

    current_path = os.path.join(output_dir, "current_map.json")
    with open(current_path, "w") as f:
        json.dump(map_data, f)

    return filepath


def save_preview(grid, biome_colors, seed, output_dir):
    """Save a PNG preview of the map (requires pillow)."""
    try:
        from PIL import Image
    except ImportError:
        print("  Skipping preview (pip install pillow for PNG export)")
        return

    height, width = grid.shape
    img = Image.new("RGB", (width, height))
    pixels = img.load()

    for y in range(height):
        for x in range(width):
            biome_id = int(grid[y][x])
            c = biome_colors.get(str(biome_id), [0, 0, 0])
            pixels[x, y] = tuple(c)

    filepath = os.path.join(output_dir, f"map_seed_{seed}.png")
    img.save(filepath)
    print(f"  Preview saved: {filepath}")


def write_adjacency_to_db(adjacency_pairs, conn):
    """Write biome adjacency to database."""
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS biome_adjacency (
            biome_a INT REFERENCES biomes(id),
            biome_b INT REFERENCES biomes(id),
            PRIMARY KEY (biome_a, biome_b)
        )
    """)

    cur.execute("DELETE FROM biome_adjacency")

    for a, b in adjacency_pairs:
        cur.execute(
            "INSERT INTO biome_adjacency (biome_a, biome_b) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (a, b),
        )
        cur.execute(
            "INSERT INTO biome_adjacency (biome_a, biome_b) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (b, a),
        )

    conn.commit()
    cur.close()
    print(f"  Wrote {len(adjacency_pairs)} adjacency pairs to DB (both directions)")


def cleanup_old_splits(conn):
    """Remove previously generated sub-biome rows (names like 'sea_2', 'forest_3', etc.)."""
    cur = conn.cursor()

    # Find all split biome IDs (name contains underscore + digit at end)
    cur.execute("""
        SELECT id FROM biomes
        WHERE name ~ '_[0-9]+$'
        AND name != 'waters-edge'
        AND name != 'rough-terrain'
    """)
    old_ids = [r[0] for r in cur.fetchall()]

    if old_ids:
        ids_tuple = tuple(old_ids)
        # Clean up referencing tables first
        for table in ['simulation_state', 'population_snapshots', 'ecosystem_events',
                      'pokemon_habitats', 'type_biome_affinity', 'biome_adjacency']:
            if table == 'biome_adjacency':
                cur.execute(f"DELETE FROM {table} WHERE biome_a IN %s OR biome_b IN %s",
                            (ids_tuple, ids_tuple))
            else:
                cur.execute(f"DELETE FROM {table} WHERE biome_id IN %s", (ids_tuple,))

        cur.execute("DELETE FROM biomes WHERE id IN %s", (ids_tuple,))
        conn.commit()
        print(f"  Cleaned up {len(old_ids)} old sub-biome entries")

    cur.close()


def main():
    parser = argparse.ArgumentParser(description="Generate Perlin noise biome map")
    parser.add_argument("--seed", type=int, default=None, help="Random seed (default: random)")
    parser.add_argument("--size", type=int, default=200, help="Grid size NxN (default: 200)")
    parser.add_argument("--preview", action="store_true", help="Save PNG preview")
    args = parser.parse_args()

    seed = args.seed if args.seed is not None else int(time.time()) % 100000
    size = args.size
    output_dir = os.path.join(os.path.dirname(__file__), "maps")

    print(f"Generating {size}x{size} map with seed {seed}...")

    # Connect to DB
    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD,
    )

    # Clean up any previous split biomes
    cleanup_old_splits(conn)

    # Generate noise layers
    elevation, moisture, urban_noise = generate_noise_layers(size, size, seed)
    print(f"  Noise layers generated")

    # Assign base biome types
    type_grid = assign_biome_types(elevation, moisture, urban_noise)

    # Find connected regions per biome type
    regions_by_type = flood_fill_regions(type_grid)

    # Count regions per type
    total_regions = 0
    biome_id_to_name = {v: k for k, v in BASE_BIOMES.items()}
    print(f"\n  Connected regions per biome type:")
    for base_id in sorted(regions_by_type.keys()):
        regions = regions_by_type[base_id]
        name = biome_id_to_name.get(base_id, f"biome_{base_id}")
        sizes = [len(r) for r in regions]
        total_regions += len(regions)
        if len(regions) == 1:
            print(f"    {name:15s}: 1 region ({sizes[0]} cells)")
        else:
            print(f"    {name:15s}: {len(regions)} regions (largest: {sizes[0]}, smallest: {sizes[-1]})")

    print(f"  Total: {total_regions} distinct regions from 9 biome types")

    # Split into separate DB biomes
    region_id_map, final_grid, biome_colors = split_regions_to_db(regions_by_type, type_grid, conn)

    # Count actual biome IDs in use
    unique_ids = set(int(x) for x in final_grid.flatten())
    print(f"  {len(unique_ids)} unique biome IDs in final grid")

    # Compute adjacency on the split grid
    adjacency = compute_adjacency(final_grid)
    print(f"  Found {len(adjacency)} adjacency pairs")

    # Save map JSON
    filepath = save_map(final_grid, biome_colors, seed, output_dir, elevation=elevation)
    print(f"  Map saved: {filepath}")

    # Save preview if requested
    if args.preview:
        save_preview(final_grid, biome_colors, seed, output_dir)

    # Write adjacency to DB
    write_adjacency_to_db(adjacency, conn)

    conn.close()

    print(f"\nDone! Seed {seed} is ready.")
    print(f"  Disconnected biome regions are now separate biome instances.")
    print(f"  Species in one lake cannot interact with species in another.")


if __name__ == "__main__":
    main()
