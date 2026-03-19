"""
Export all simulation data as static JSON files for GitHub Pages deployment.

Usage:
    cd services/simulation
    python ../../scripts/export_static.py

This generates all JSON files that the frontend needs, replacing API calls.
Run this after any simulation changes, then rebuild the frontend.
"""

import json
import os
import sys

# Add paths
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services", "simulation"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services", "api"))

from config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
import psycopg2
from psycopg2.extras import RealDictCursor

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "data")


def get_conn():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD,
    )


def export_map():
    """Export /simulation/map — the current_map.json"""
    map_path = os.path.join(
        os.path.dirname(__file__), "..", "services", "map_generator", "maps", "current_map.json"
    )
    with open(map_path) as f:
        data = json.load(f)
    write_json("simulation_map.json", data)
    print(f"  map: {data['width']}x{data['height']}, {len(data.get('elevation', []))} elevation pts")


def export_status():
    """Export /simulation/status — always shows tick 0 (fresh start for static site)"""
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    cur.execute("SELECT key, value FROM simulation_config")
    config = {r["key"]: float(r["value"]) for r in cur.fetchall()}

    cur.execute("""
        SELECT COUNT(DISTINCT pokemon_id) AS living_species,
               SUM(population) AS total_population
        FROM simulation_state WHERE population > 0
    """)
    pop = cur.fetchone()

    data = {
        "current_tick": 0,
        "status": "stopped",
        "living_species": pop["living_species"],
        "total_population": pop["total_population"],
        "config": config,
    }
    write_json("simulation_status.json", data)
    print(f"  status: tick {data['current_tick']}, {data['living_species']} species, {data['total_population']} pop")
    cur.close()
    conn.close()


def export_biomes():
    """Export /biomes (list) and /biomes/{id} (details for each)"""
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Biome list with population stats
    cur.execute("""
        SELECT b.id, b.name, b.carrying_capacity,
               COALESCE(b.biomass_factor, 1.0) AS biomass_factor,
               COALESCE(SUM(ss.population), 0) AS total_population,
               COUNT(DISTINCT ss.pokemon_id) AS species_count,
               ROUND(COALESCE(AVG(ss.food_satiation), 0)::numeric, 2) AS avg_food_satiation
        FROM biomes b
        LEFT JOIN simulation_state ss ON b.id = ss.biome_id AND ss.population > 0
        GROUP BY b.id, b.name, b.carrying_capacity, b.biomass_factor
        ORDER BY b.id
    """)
    biome_list = [dict(r) for r in cur.fetchall()]
    # Convert Decimal to float
    for b in biome_list:
        b["biomass_factor"] = float(b["biomass_factor"])
        b["avg_food_satiation"] = float(b["avg_food_satiation"])
        b["total_population"] = int(b["total_population"])
        b["species_count"] = int(b["species_count"])

    write_json("biomes.json", biome_list)
    print(f"  biomes: {len(biome_list)} biomes")

    # Per-biome detail
    biome_details = {}
    for biome in biome_list:
        bid = biome["id"]
        cur.execute("""
            SELECT ss.pokemon_id, p.name, ss.population,
                   tl.level AS trophic_level,
                   ROUND(ss.food_satiation::numeric, 3) AS food_satiation
            FROM simulation_state ss
            JOIN pokemon p ON p.id = ss.pokemon_id
            JOIN trophic_levels tl ON tl.pokemon_id = ss.pokemon_id
            WHERE ss.biome_id = %s AND ss.population > 0
            ORDER BY ss.population DESC
        """, (bid,))
        species = []
        for r in cur.fetchall():
            species.append({
                "pokemon_id": r["pokemon_id"],
                "name": r["name"],
                "population": r["population"],
                "trophic_level": r["trophic_level"],
                "food_satiation": float(r["food_satiation"]),
            })

        biome_details[str(bid)] = {
            **biome,
            "species": species,
        }

    write_json("biome_details.json", biome_details)
    print(f"  biome details: {len(biome_details)} biomes with species lists")

    cur.close()
    conn.close()


def export_food_chain():
    """Export /food-chain"""
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Get active species
    cur.execute("""
        SELECT DISTINCT pokemon_id FROM simulation_state WHERE population > 0
    """)
    active_ids = {r["pokemon_id"] for r in cur.fetchall()}

    # Get food chain edges between active species
    cur.execute("""
        SELECT fc.predator_id, p1.name AS predator_name,
               fc.prey_id, p2.name AS prey_name,
               fc.probability
        FROM food_chain fc
        JOIN pokemon p1 ON p1.id = fc.predator_id
        JOIN pokemon p2 ON p2.id = fc.prey_id
    """)
    edges = []
    nodes_set = set()
    for r in cur.fetchall():
        if r["predator_id"] in active_ids and r["prey_id"] in active_ids:
            edges.append({
                "predator_id": r["predator_id"],
                "predator_name": r["predator_name"],
                "prey_id": r["prey_id"],
                "prey_name": r["prey_name"],
                "probability": float(r["probability"]),
            })
            nodes_set.add(r["predator_id"])
            nodes_set.add(r["prey_id"])

    data = {
        "edges": edges,
        "node_count": len(nodes_set),
        "edge_count": len(edges),
    }
    write_json("food_chain.json", data)
    print(f"  food chain: {len(edges)} edges, {len(nodes_set)} species")

    cur.close()
    conn.close()


def export_stats():
    """Export /stats/overview and /stats/trophic"""
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Overview
    cur.execute("SELECT value FROM simulation_metadata WHERE key = 'current_tick'")
    current_tick = int(cur.fetchone()["value"])

    cur.execute("""
        SELECT COUNT(DISTINCT pokemon_id) AS living_species,
               SUM(population) AS total_population
        FROM simulation_state WHERE population > 0
    """)
    pop = cur.fetchone()

    cur.execute("SELECT COUNT(*) AS total FROM pokemon")
    total_species = cur.fetchone()["total"]

    cur.execute("""
        SELECT p.id, p.name, SUM(ss.population) AS population
        FROM simulation_state ss JOIN pokemon p ON p.id = ss.pokemon_id
        WHERE ss.population > 0 GROUP BY p.id, p.name
        ORDER BY population DESC LIMIT 1
    """)
    top_species = dict(cur.fetchone()) if cur.rowcount else None

    cur.execute("""
        SELECT b.id, b.name, SUM(ss.population) AS population
        FROM simulation_state ss JOIN biomes b ON b.id = ss.biome_id
        WHERE ss.population > 0 GROUP BY b.id, b.name
        ORDER BY population DESC LIMIT 1
    """)
    top_biome = dict(cur.fetchone()) if cur.rowcount else None

    overview = {
        "current_tick": current_tick,
        "total_species": total_species,
        "living_species": int(pop["living_species"]),
        "total_population": int(pop["total_population"]),
        "survival_rate": round(int(pop["living_species"]) / total_species * 100, 1),
        "most_populous_species": top_species,
        "most_populous_biome": top_biome,
    }
    write_json("stats_overview.json", overview)

    # Trophic
    cur.execute("""
        SELECT tl.level,
               COUNT(DISTINCT ss.pokemon_id) AS species_count,
               SUM(ss.population) AS total_population,
               ROUND(AVG(ss.food_satiation)::numeric, 3) AS avg_food_satiation
        FROM simulation_state ss
        JOIN trophic_levels tl ON tl.pokemon_id = ss.pokemon_id
        WHERE ss.population > 0
        GROUP BY tl.level ORDER BY total_population DESC
    """)
    trophic = []
    for r in cur.fetchall():
        trophic.append({
            "level": r["level"],
            "species_count": int(r["species_count"]),
            "total_population": int(r["total_population"]),
            "avg_food_satiation": float(r["avg_food_satiation"]),
        })
    write_json("stats_trophic.json", trophic)
    print(f"  stats: tick {current_tick}, {len(trophic)} trophic levels")

    cur.close()
    conn.close()


def export_species():
    """Export /species/{id} for all species with population > 0"""
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    cur.execute("""
        SELECT DISTINCT ss.pokemon_id
        FROM simulation_state ss WHERE ss.population > 0
    """)
    active_ids = [r["pokemon_id"] for r in cur.fetchall()]

    species_data = {}
    for pid in active_ids:
        cur.execute("""
            SELECT p.id, p.name, p.hp, p.attack, p.defense,
                   p.sp_attack, p.sp_defense, p.speed,
                   (p.hp + p.attack + p.defense + p.sp_attack + p.sp_defense + p.speed) AS bst,
                   p.is_legendary, p.is_mythical,
                   tl.level AS trophic_level
            FROM pokemon p
            JOIN trophic_levels tl ON tl.pokemon_id = p.id
            WHERE p.id = %s
        """, (pid,))
        row = cur.fetchone()
        if not row:
            continue

        # Types
        cur.execute("""
            SELECT t.name FROM pokemon_types pt
            JOIN types t ON t.id = pt.type_id
            WHERE pt.pokemon_id = %s ORDER BY pt.slot
        """, (pid,))
        types = [r["name"] for r in cur.fetchall()]

        # Per-biome populations
        cur.execute("""
            SELECT ss.biome_id, b.name AS biome_name,
                   ss.population, ss.food_satiation
            FROM simulation_state ss
            JOIN biomes b ON b.id = ss.biome_id
            WHERE ss.pokemon_id = %s AND ss.population > 0
            ORDER BY ss.population DESC
        """, (pid,))
        biomes = []
        total_pop = 0
        for r in cur.fetchall():
            biomes.append({
                "biome_id": r["biome_id"],
                "biome_name": r["biome_name"],
                "population": r["population"],
                "food_satiation": float(r["food_satiation"]),
            })
            total_pop += r["population"]

        # Predator/prey counts
        cur.execute("SELECT COUNT(*) AS c FROM food_chain WHERE prey_id = %s", (pid,))
        predator_count = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) AS c FROM food_chain WHERE predator_id = %s", (pid,))
        prey_count = cur.fetchone()["c"]

        species_data[str(pid)] = {
            "id": row["id"],
            "name": row["name"],
            "types": types,
            "trophic_level": row["trophic_level"],
            "bst": row["bst"],
            "hp": row["hp"],
            "attack": row["attack"],
            "defense": row["defense"],
            "sp_attack": row["sp_attack"],
            "sp_defense": row["sp_defense"],
            "speed": row["speed"],
            "is_legendary": row["is_legendary"],
            "is_mythical": row["is_mythical"],
            "total_population": total_pop,
            "predator_count": predator_count,
            "prey_count": prey_count,
            "biomes": biomes,
        }

    write_json("species.json", species_data)
    print(f"  species: {len(species_data)} species exported")

    cur.close()
    conn.close()


def export_animation_frames():
    """Re-initialize simulation from tick 0 and export frames for playback."""
    from engine import SimulationEngine
    import numpy as np

    print("  Re-initializing simulation from tick 0...")
    engine = SimulationEngine()
    engine.load_data()
    engine.initialize_world()
    engine._build_arrays()

    current_tick = 0

    # Name/trophic lookups
    name_lookup = {}
    cur = engine.conn.cursor()
    cur.execute("SELECT id, name FROM pokemon")
    for row in cur.fetchall():
        name_lookup[row[0]] = row[1]
    cur.close()

    biome_names = {}
    cur = engine.conn.cursor()
    cur.execute("SELECT id, name FROM biomes")
    for row in cur.fetchall():
        biome_names[row[0]] = row[1]
    cur.close()

    ticks = 10000  # 100 years of seasonal data
    ANIM_SAMPLE = 25  # store every 25th tick for animation (400 frames)
    TS_SAMPLE = 5     # store every 5th tick for biome timeseries (2000 points)

    keys = engine.keys

    # Pre-build biome membership for timeseries aggregation
    biome_ids_set = set()
    for entry in keys:
        biome_ids_set.add(entry[1])
    biome_id_list = sorted(biome_ids_set)
    biome_members = {bid: [] for bid in biome_id_list}
    for idx, (pid, bid) in enumerate(keys):
        if bid in biome_members:
            biome_members[bid].append(idx)

    # Carrying capacities for food approximation
    carrying_caps = {}
    cur = engine.conn.cursor()
    cur.execute("SELECT id, carrying_capacity FROM biomes")
    for row in cur.fetchall():
        carrying_caps[row[0]] = row[1]
    cur.close()

    # Collect sampled data in one pass
    tick_pops = []       # sampled for animation frames
    ts_pop = [[] for _ in biome_id_list]   # biome x sampled_tick
    ts_food = [[] for _ in biome_id_list]
    ts_spp = [[] for _ in biome_id_list]
    ts_ticks = []
    ts_events = []
    prev_season = None

    print(f"  Running {ticks} ticks (sampling anim every {ANIM_SAMPLE}, timeseries every {TS_SAMPLE})...")
    for i in range(ticks):
        current_tick += 1
        engine._run_tick(current_tick)

        season_name, _ = engine.get_season(current_tick)
        alive_mask = engine.pop > 0

        # Season events (every tick, for timeseries)
        if season_name != prev_season:
            ts_events.append({"tick": current_tick, "type": "season_change", "season": season_name})
            prev_season = season_name

        # Animation frame sampling
        if current_tick % ANIM_SAMPLE == 0 or current_tick == 1:
            alive_idx = np.where(alive_mask)[0]
            tick_pops.append({
                "tick": current_tick,
                "season": season_name,
                "pops": {int(j): int(engine.pop[j]) for j in alive_idx},
                "total_population": int(engine.pop[alive_mask].sum()),
                "living_species": int(alive_mask.sum()),
            })

        # Biome timeseries sampling
        if current_tick % TS_SAMPLE == 0 or current_tick == 1:
            ts_ticks.append(current_tick)
            for bi, bid in enumerate(biome_id_list):
                biome_pop = 0
                biome_spp = 0
                for idx in biome_members[bid]:
                    p = int(engine.pop[idx])
                    if p > 0:
                        biome_pop += p
                        biome_spp += 1
                ts_pop[bi].append(biome_pop)
                ts_spp[bi].append(biome_spp)
                cap = carrying_caps.get(bid, 10000)
                ratio = min(biome_pop / max(cap, 1), 2.0)
                ts_food[bi].append(round(max(0.0, min(1.0, 1.0 - ratio * 0.5)), 2))

        # Progress logging
        if current_tick % 1000 == 0:
            total_pop = int(engine.pop[alive_mask].sum())
            print(f"    tick {current_tick}: {total_pop:,} pop, {int(alive_mask.sum())} entries alive")

    # --- Build animation_frames.json ---
    all_seen = set()
    for tp in tick_pops:
        all_seen.update(tp["pops"].keys())

    catalog = []
    idx_to_catalog = {}
    for ci, idx in enumerate(sorted(all_seen)):
        pid, bid = keys[idx]
        catalog.append({
            "id": pid,
            "biome_id": bid,
            "name": name_lookup.get(pid, "?"),
            "trophic": engine.trophic_levels.get(pid, "unknown"),
            "biome": biome_names.get(bid, "?"),
        })
        idx_to_catalog[idx] = ci

    frames = []
    for tp in tick_pops:
        pop_arr = [0] * len(catalog)
        for idx, pop in tp["pops"].items():
            ci = idx_to_catalog.get(idx)
            if ci is not None:
                pop_arr[ci] = pop
        frames.append({
            "tick": tp["tick"],
            "season": tp["season"],
            "populations": pop_arr,
            "total_population": tp["total_population"],
            "living_species": tp["living_species"],
        })

    data = {
        "start_tick": frames[0]["tick"],
        "end_tick": current_tick,
        "species": catalog,
        "frames": frames,
    }
    write_json("animation_frames.json", data)
    print(f"  animation: {len(frames)} frames, {len(catalog)} species in catalog")

    # --- Generate biome_timeseries.json ---
    biome_ts = {
        "biome_ids": biome_id_list,
        "biome_names": [biome_names.get(bid, "?") for bid in biome_id_list],
        "ticks": ts_ticks,
        "population": ts_pop,
        "avg_food": ts_food,
        "species_count": ts_spp,
        "events": ts_events,
    }
    write_json("biome_timeseries.json", biome_ts)
    print(f"  biome timeseries: {len(biome_id_list)} biomes x {len(ts_ticks)} sampled ticks")

    engine.conn.close()


def getSeason_py(tick):
    t = tick % 100
    if t < 25: return "spring"
    if t < 50: return "summer"
    if t < 75: return "autumn"
    return "winter"


def export_events():
    """Generate events by analyzing animation frames data."""
    frames_path = os.path.join(OUTPUT_DIR, "animation_frames.json")
    if not os.path.exists(frames_path):
        print("  events: skipped (no animation_frames.json)")
        return

    with open(frames_path) as f:
        data = json.load(f)

    catalog = data["species"]
    frames = data["frames"]
    events = []

    # Build species_id -> catalog indices map
    species_indices = {}
    for j, sp in enumerate(catalog):
        sid = sp.get("id")
        if sid not in species_indices:
            species_indices[sid] = []
        species_indices[sid].append(j)
    extinct_species = set()

    prev_season = None
    for i, frame in enumerate(frames):
        tick = frame["tick"]
        season = frame.get("season", "spring")

        # Season change
        if season != prev_season:
            events.append({"tick": tick, "type": "season_change", "season": season})
            prev_season = season

        # Extinctions: species gone from ALL biomes (true extinction)
        if i > 0:
            curr_pops = frame["populations"]
            for species_id, indices in species_indices.items():
                if species_id in extinct_species:
                    continue
                if all(curr_pops[j] == 0 for j in indices if j < len(curr_pops)):
                    extinct_species.add(species_id)
                    sp = catalog[indices[0]]
                    events.append({
                        "tick": tick,
                        "type": "extinction",
                        "species_id": sp.get("id"),
                        "species_name": sp.get("name", "?"),
                    })

        # Population crash: total drops by >20%
        if i > 0:
            prev_total = frames[i - 1]["total_population"]
            curr_total = frame["total_population"]
            if prev_total > 100 and (prev_total - curr_total) / prev_total > 0.20:
                events.append({
                    "tick": tick,
                    "type": "disaster",
                    "detail": f"Population crash: {prev_total:,} \u2192 {curr_total:,}",
                })

    write_json("animation_events.json", events)
    print(f"  events: {len(events)} events generated")


def write_json(filename, data):
    filepath = os.path.join(OUTPUT_DIR, filename)
    with open(filepath, "w") as f:
        json.dump(data, f, separators=(",", ":"))  # compact JSON


def export_sprites():
    """Download Pokemon sprites for all active species."""
    import urllib.request
    import time as _time

    sprites_dir = os.path.join(OUTPUT_DIR, "sprites")
    os.makedirs(sprites_dir, exist_ok=True)

    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT pokemon_id FROM simulation_state WHERE population > 0")
    active_ids = [r[0] for r in cur.fetchall()]
    cur.close()
    conn.close()

    # Check which sprites we already have
    existing = set()
    for f in os.listdir(sprites_dir):
        if f.endswith(".png"):
            existing.add(int(f.replace(".png", "")))

    to_download = [pid for pid in active_ids if pid not in existing]
    print(f"  sprites: {len(active_ids)} needed, {len(existing)} cached, {len(to_download)} to download")

    for i, pid in enumerate(to_download):
        url = f"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/{pid}.png"
        dest = os.path.join(sprites_dir, f"{pid}.png")
        try:
            urllib.request.urlretrieve(url, dest)
        except Exception as e:
            print(f"    Failed to download sprite {pid}: {e}")

        # Rate limit: small delay every 20 downloads
        if (i + 1) % 20 == 0:
            print(f"    Downloaded {i + 1}/{len(to_download)}...")
            _time.sleep(0.5)

    print(f"  sprites: {len(os.listdir(sprites_dir))} total sprites cached")


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print("Exporting static data for GitHub Pages...\n")

    export_map()
    export_status()
    export_biomes()
    export_food_chain()
    export_stats()
    export_species()
    export_sprites()
    export_animation_frames()
    export_events()

    # Calculate total size
    total = 0
    for root, dirs, files in os.walk(OUTPUT_DIR):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    file_count = sum(len(files) for _, _, files in os.walk(OUTPUT_DIR))
    print(f"\nDone! {file_count} files, {total / 1024 / 1024:.1f} MB total")
    print(f"Output: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
