"""
PokeAPI Data Loader
Pulls Pokemon, Types, Species, and Evolution Chain data from PokeAPI.
Uses concurrent requests for speed while respecting rate limits.
Outputs raw JSON files for downstream processing and DB loading.
"""

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from config import POKEAPI_BASE_URL, MAX_POKEMON_ID, DATA_DIR

# Session for connection pooling
session = requests.Session()

# Concurrency: PokeAPI is free and cacheable, 10 threads is reasonable
MAX_WORKERS = 10


def fetch_with_retry(url, retries=3, delay=1):
    """Fetch a URL with retry logic."""
    for attempt in range(retries):
        try:
            resp = session.get(url, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            if attempt == retries - 1:
                print(f"  FAILED after {retries} attempts: {url} — {e}")
                return None
            time.sleep(delay * (attempt + 1))
    return None


def fetch_batch(urls, label="items"):
    """Fetch multiple URLs concurrently. Returns list of (url, data) tuples."""
    results = []
    total = len(urls)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_url = {executor.submit(fetch_with_retry, url): url for url in urls}

        done_count = 0
        for future in as_completed(future_to_url):
            url = future_to_url[future]
            data = future.result()
            if data:
                results.append((url, data))
            done_count += 1
            if done_count % 100 == 0:
                print(f"  {done_count}/{total} {label} fetched...")

    return results


def load_types():
    """Load all 18 Pokemon types and their damage relations."""
    print("Loading types...")
    urls = [f"{POKEAPI_BASE_URL}/type/{i}" for i in range(1, 19)]
    results = fetch_batch(urls, "types")

    types_data = []
    for _, data in sorted(results, key=lambda x: x[1]["id"]):
        type_entry = {
            "pokeapi_id": data["id"],
            "name": data["name"],
            "damage_relations": {
                "double_damage_to": [t["name"] for t in data["damage_relations"]["double_damage_to"]],
                "half_damage_to": [t["name"] for t in data["damage_relations"]["half_damage_to"]],
                "no_damage_to": [t["name"] for t in data["damage_relations"]["no_damage_to"]],
            }
        }
        types_data.append(type_entry)

    print(f"  Loaded {len(types_data)} types")
    return types_data


def load_pokemon(max_id):
    """Load Pokemon base data (stats, types, sprites)."""
    print(f"Loading Pokemon 1-{max_id}...")
    urls = [f"{POKEAPI_BASE_URL}/pokemon/{i}" for i in range(1, max_id + 1)]
    results = fetch_batch(urls, "pokemon")

    pokemon_data = []
    for _, data in sorted(results, key=lambda x: x[1]["id"]):
        stats = {}
        for stat in data["stats"]:
            stat_name = stat["stat"]["name"].replace("-", "_")
            stats[stat_name] = stat["base_stat"]

        pokemon_entry = {
            "pokeapi_id": data["id"],
            "name": data["name"],
            "hp": stats.get("hp", 0),
            "attack": stats.get("attack", 0),
            "defense": stats.get("defense", 0),
            "sp_attack": stats.get("special_attack", 0),
            "sp_defense": stats.get("special_defense", 0),
            "speed": stats.get("speed", 0),
            "height": data["height"],
            "weight": data["weight"],
            "base_experience": data.get("base_experience"),
            "types": [
                {"name": t["type"]["name"], "slot": t["slot"]}
                for t in data["types"]
            ],
            "sprite_url": data["sprites"].get("front_default"),
        }
        pokemon_data.append(pokemon_entry)

    print(f"  Loaded {len(pokemon_data)} pokemon")
    return pokemon_data


def load_species(max_id):
    """Load species data (habitat, hatch counter, catch rate, etc.)."""
    print(f"Loading species data 1-{max_id}...")
    urls = [f"{POKEAPI_BASE_URL}/pokemon-species/{i}" for i in range(1, max_id + 1)]
    results = fetch_batch(urls, "species")

    species_data = []
    for _, data in sorted(results, key=lambda x: x[1]["id"]):
        species_entry = {
            "pokeapi_id": data["id"],
            "name": data["name"],
            "hatch_counter": data.get("hatch_counter"),
            "catch_rate": data.get("capture_rate"),
            "growth_rate": data["growth_rate"]["name"] if data.get("growth_rate") else None,
            "is_legendary": data.get("is_legendary", False),
            "is_mythical": data.get("is_mythical", False),
            "habitat": data["habitat"]["name"] if data.get("habitat") else None,
            "evolution_chain_url": data["evolution_chain"]["url"] if data.get("evolution_chain") else None,
        }
        species_data.append(species_entry)

    print(f"  Loaded {len(species_data)} species")
    return species_data


def load_evolution_chains(species_data):
    """Load evolution chains from unique chain URLs found in species data."""
    print("Loading evolution chains...")

    chain_urls = sorted(set(
        s["evolution_chain_url"] for s in species_data
        if s.get("evolution_chain_url")
    ))
    print(f"  Found {len(chain_urls)} unique evolution chains")

    results = fetch_batch(chain_urls, "evolution chains")
    chains = []

    for _, data in sorted(results, key=lambda x: x[1]["id"]):
        pairs = []
        _walk_chain(data["chain"], pairs, order=1)
        chains.append({
            "chain_id": data["id"],
            "pairs": pairs,
        })

    print(f"  Loaded {len(chains)} chains")
    return chains


def _walk_chain(node, pairs, order):
    """Recursively extract evolution pairs from a chain node."""
    current_name = node["species"]["name"]
    for evolution in node.get("evolves_to", []):
        next_name = evolution["species"]["name"]
        pairs.append({
            "from": current_name,
            "to": next_name,
            "order": order,
        })
        _walk_chain(evolution, pairs, order + 1)


def load_habitats():
    """Load all habitat categories from PokeAPI."""
    print("Loading habitats...")
    urls = [f"{POKEAPI_BASE_URL}/pokemon-habitat/{i}" for i in range(1, 10)]
    results = fetch_batch(urls, "habitats")

    habitats = []
    for _, data in sorted(results, key=lambda x: x[1]["id"]):
        habitats.append({
            "pokeapi_id": data["id"],
            "name": data["name"],
            "pokemon_species": [s["name"] for s in data["pokemon_species"]],
        })
        print(f"  Loaded habitat: {data['name']} ({len(data['pokemon_species'])} species)")

    return habitats


def save_json(data, filename):
    """Save data to a JSON file."""
    os.makedirs(DATA_DIR, exist_ok=True)
    filepath = os.path.join(DATA_DIR, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"  Saved {filepath} ({len(data)} records)")


def main():
    start = time.time()
    print("=" * 60)
    print("PokeAPI Data Loader")
    print(f"Loading Pokemon 1-{MAX_POKEMON_ID} ({MAX_WORKERS} concurrent workers)")
    print("=" * 60)

    types_data = load_types()
    save_json(types_data, "types.json")

    pokemon_data = load_pokemon(MAX_POKEMON_ID)
    save_json(pokemon_data, "pokemon.json")

    species_data = load_species(MAX_POKEMON_ID)
    save_json(species_data, "species.json")

    evolution_chains = load_evolution_chains(species_data)
    save_json(evolution_chains, "evolution_chains.json")

    habitats = load_habitats()
    save_json(habitats, "habitats.json")

    elapsed = time.time() - start
    print("=" * 60)
    print(f"Done in {elapsed:.1f}s! Raw data saved to: {DATA_DIR}")
    print(f"  Types: {len(types_data)}")
    print(f"  Pokemon: {len(pokemon_data)}")
    print(f"  Species: {len(species_data)}")
    print(f"  Evolution chains: {len(evolution_chains)}")
    print(f"  Habitats: {len(habitats)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
