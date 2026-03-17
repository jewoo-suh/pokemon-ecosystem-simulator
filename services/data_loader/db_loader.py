"""
DB Loader
Reads raw JSON files from the data/ directory and inserts them into PostgreSQL.
Loads tables in dependency order (types before pokemon_types, etc.)
"""

import json
import os
import psycopg2
from psycopg2.extras import execute_values
from config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DATA_DIR


def get_connection():
    """Create a database connection."""
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
    )


def load_json(filename):
    """Load a JSON file from the data directory."""
    filepath = os.path.join(DATA_DIR, filename)
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def clear_tables(conn):
    """Clear all data tables in reverse dependency order."""
    tables = [
        "pokemon_sim_params",
        "trophic_levels",
        "food_chain",
        "population_snapshots",
        "ecosystem_events",
        "evolution_chains",
        "pokemon_habitats",
        "pokemon_types",
        "type_effectiveness",
        "pokemon",
        "biomes",
        "types",
    ]
    with conn.cursor() as cur:
        for table in tables:
            cur.execute(f"TRUNCATE TABLE {table} CASCADE")
    conn.commit()
    print("Cleared all tables")


def load_types(conn):
    """Load types into the types table."""
    data = load_json("types.json")

    with conn.cursor() as cur:
        values = [(t["pokeapi_id"], t["name"]) for t in data]
        execute_values(
            cur,
            "INSERT INTO types (pokeapi_id, name) VALUES %s ON CONFLICT (pokeapi_id) DO NOTHING",
            values,
        )
    conn.commit()
    print(f"  Loaded {len(data)} types")
    return data


def load_type_effectiveness(conn, types_data):
    """Build the 18x18 type effectiveness matrix from damage relations."""
    # Build name -> DB id mapping
    with conn.cursor() as cur:
        cur.execute("SELECT id, name FROM types")
        type_map = {name: id for id, name in cur.fetchall()}

    rows = []
    for t in types_data:
        atk_id = type_map[t["name"]]
        for target_name in t["damage_relations"]["double_damage_to"]:
            if target_name in type_map:
                rows.append((atk_id, type_map[target_name], 2.0))
        for target_name in t["damage_relations"]["half_damage_to"]:
            if target_name in type_map:
                rows.append((atk_id, type_map[target_name], 0.5))
        for target_name in t["damage_relations"]["no_damage_to"]:
            if target_name in type_map:
                rows.append((atk_id, type_map[target_name], 0.0))

    with conn.cursor() as cur:
        execute_values(
            cur,
            "INSERT INTO type_effectiveness (atk_type_id, def_type_id, multiplier) VALUES %s "
            "ON CONFLICT (atk_type_id, def_type_id) DO NOTHING",
            rows,
        )
    conn.commit()
    print(f"  Loaded {len(rows)} type effectiveness entries")


def load_biomes(conn):
    """Load biomes from habitats data."""
    data = load_json("habitats.json")

    with conn.cursor() as cur:
        values = [(h["name"], f"PokeAPI habitat: {h['name']}") for h in data]
        execute_values(
            cur,
            "INSERT INTO biomes (name, description) VALUES %s ON CONFLICT (name) DO NOTHING",
            values,
        )
    conn.commit()
    print(f"  Loaded {len(data)} biomes")
    return data


def load_pokemon(conn):
    """Load pokemon base data, merging pokemon.json with species.json."""
    pokemon_data = load_json("pokemon.json")
    species_data = load_json("species.json")

    # Index species by pokeapi_id for fast lookup
    species_map = {s["pokeapi_id"]: s for s in species_data}

    rows = []
    for p in pokemon_data:
        species = species_map.get(p["pokeapi_id"], {})
        rows.append((
            p["pokeapi_id"],
            p["name"],
            p["hp"],
            p["attack"],
            p["defense"],
            p["sp_attack"],
            p["sp_defense"],
            p["speed"],
            p["height"],
            p["weight"],
            p.get("base_experience"),
            species.get("hatch_counter"),
            species.get("catch_rate"),
            species.get("growth_rate"),
            species.get("is_legendary", False),
            species.get("is_mythical", False),
            p.get("sprite_url"),
        ))

    with conn.cursor() as cur:
        execute_values(
            cur,
            """INSERT INTO pokemon (
                pokeapi_id, name, hp, attack, defense, sp_attack, sp_defense,
                speed, height, weight, base_experience, hatch_counter, catch_rate,
                growth_rate, is_legendary, is_mythical, sprite_url
            ) VALUES %s ON CONFLICT (pokeapi_id) DO NOTHING""",
            rows,
        )
    conn.commit()
    print(f"  Loaded {len(rows)} pokemon")
    return pokemon_data


def load_pokemon_types(conn):
    """Load pokemon-type relationships."""
    pokemon_data = load_json("pokemon.json")

    # Build mappings
    with conn.cursor() as cur:
        cur.execute("SELECT id, pokeapi_id FROM pokemon")
        pokemon_map = {pokeapi_id: id for id, pokeapi_id in cur.fetchall()}
        cur.execute("SELECT id, name FROM types")
        type_map = {name: id for id, name in cur.fetchall()}

    rows = []
    for p in pokemon_data:
        pk_id = pokemon_map.get(p["pokeapi_id"])
        if not pk_id:
            continue
        for t in p["types"]:
            type_id = type_map.get(t["name"])
            if type_id:
                rows.append((pk_id, type_id, t["slot"]))

    with conn.cursor() as cur:
        execute_values(
            cur,
            "INSERT INTO pokemon_types (pokemon_id, type_id, slot) VALUES %s "
            "ON CONFLICT (pokemon_id, type_id) DO NOTHING",
            rows,
        )
    conn.commit()
    print(f"  Loaded {len(rows)} pokemon-type relationships")


def load_pokemon_habitats(conn, habitats_data):
    """Load pokemon-biome relationships from habitat data."""
    # Build mappings
    with conn.cursor() as cur:
        cur.execute("SELECT id, name FROM pokemon")
        pokemon_map = {name: id for id, name in cur.fetchall()}
        cur.execute("SELECT id, name FROM biomes")
        biome_map = {name: id for id, name in cur.fetchall()}

    rows = []
    for habitat in habitats_data:
        biome_id = biome_map.get(habitat["name"])
        if not biome_id:
            continue
        for species_name in habitat["pokemon_species"]:
            pk_id = pokemon_map.get(species_name)
            if pk_id:
                rows.append((pk_id, biome_id, 1.0))  # default affinity 1.0

    with conn.cursor() as cur:
        execute_values(
            cur,
            "INSERT INTO pokemon_habitats (pokemon_id, biome_id, affinity) VALUES %s "
            "ON CONFLICT (pokemon_id, biome_id) DO NOTHING",
            rows,
        )
    conn.commit()
    print(f"  Loaded {len(rows)} pokemon-habitat relationships")


def load_evolution_chains(conn):
    """Load evolution chain pairs."""
    chains = load_json("evolution_chains.json")

    with conn.cursor() as cur:
        cur.execute("SELECT id, name FROM pokemon")
        pokemon_map = {name: id for id, name in cur.fetchall()}

    rows = []
    for chain in chains:
        for pair in chain["pairs"]:
            from_id = pokemon_map.get(pair["from"])
            to_id = pokemon_map.get(pair["to"])
            if from_id and to_id:
                rows.append((from_id, to_id, 50, pair["order"]))

    with conn.cursor() as cur:
        execute_values(
            cur,
            "INSERT INTO evolution_chains (from_pokemon_id, to_pokemon_id, min_population, evolution_order) "
            "VALUES %s ON CONFLICT (from_pokemon_id, to_pokemon_id) DO NOTHING",
            rows,
        )
    conn.commit()
    print(f"  Loaded {len(rows)} evolution pairs")


def load_food_chain(conn):
    """Load canon predation pairs from Bulbapedia scrape."""
    predation = load_json("predation_canon.json")

    with conn.cursor() as cur:
        cur.execute("SELECT id, name FROM pokemon")
        pokemon_map = {name: id for id, name in cur.fetchall()}

    rows = []
    skipped = []
    for pair in predation:
        pred_id = pokemon_map.get(pair["predator"])
        prey_id = pokemon_map.get(pair["prey"])
        if pred_id and prey_id:
            rows.append((pred_id, prey_id, 0.5, "canon"))
        else:
            skipped.append(f"{pair['predator']} -> {pair['prey']}")

    with conn.cursor() as cur:
        execute_values(
            cur,
            "INSERT INTO food_chain (predator_id, prey_id, probability, source) "
            "VALUES %s ON CONFLICT (predator_id, prey_id) DO NOTHING",
            rows,
        )
    conn.commit()
    print(f"  Loaded {len(rows)} canon food chain pairs")
    if skipped:
        print(f"  Skipped {len(skipped)} pairs (Pokemon name mismatch)")


def main():
    print("=" * 60)
    print("DB Loader -- JSON to PostgreSQL")
    print("=" * 60)

    conn = get_connection()
    try:
        print("\nClearing existing data...")
        clear_tables(conn)

        print("\nLoading data...")
        types_data = load_types(conn)
        load_type_effectiveness(conn, types_data)
        habitats_data = load_biomes(conn)
        load_pokemon(conn)
        load_pokemon_types(conn)
        load_pokemon_habitats(conn, habitats_data)
        load_evolution_chains(conn)
        load_food_chain(conn)

        # Summary
        print("\n" + "=" * 60)
        print("Summary:")
        with conn.cursor() as cur:
            tables = [
                "types", "type_effectiveness", "biomes", "pokemon",
                "pokemon_types", "pokemon_habitats", "evolution_chains",
                "food_chain", "simulation_config",
            ]
            for table in tables:
                cur.execute(f"SELECT COUNT(*) FROM {table}")
                count = cur.fetchone()[0]
                print(f"  {table}: {count} rows")
        print("=" * 60)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
