"""
Bulbapedia Predation Scraper
Scrapes the Pokemon predation page for canon predator-prey relationships.

The page has multiple tables:
  - Table 0: Predator | Prey (90 rows) — direct predation
  - Table 1: Predator | Prey (10 rows) — anime-only predation
  - Table 2: Rival | Rival (38 rows) — competitive rivals
  - Table 3: Parasite | Host (14 rows) — parasitic relationships
  - Table 4+: Other categories

Each data row has 5 cells: [image, name, image, name, entry/notes]
"""

import json
import os
import re
import requests
from bs4 import BeautifulSoup
from config import BULBAPEDIA_PREDATION_URL, DATA_DIR


def normalize_pokemon_name(name):
    """Normalize a Pokemon name to match PokeAPI format."""
    name = name.strip().lower()
    name = name.replace("\u2019", "").replace("'", "")  # Farfetch'd
    name = name.replace(". ", "-").replace(".", "")
    name = re.sub(r'\s+', '-', name)
    name = re.sub(r'[^a-z0-9-]', '', name)
    return name


def extract_pokemon_from_row(cells):
    """Extract two Pokemon names from a table row with 5+ cells.
    Pattern: [img_cell, name_cell, img_cell, name_cell, ...]
    """
    pokemon_names = []
    for cell in cells:
        for link in cell.find_all("a"):
            href = link.get("href", "")
            text = link.get_text().strip()
            if "_(Pok" in href and text:
                pokemon_names.append(normalize_pokemon_name(text))
                break  # one Pokemon per cell pair

    # We expect at least 2 Pokemon (predator + prey or rival + rival)
    if len(pokemon_names) >= 2:
        return pokemon_names[0], pokemon_names[1]
    return None, None


def scrape_predation():
    """Scrape all predation-related tables from Bulbapedia."""
    print("Scraping Bulbapedia predation page...")

    resp = requests.get(BULBAPEDIA_PREDATION_URL, timeout=30, headers={
        "User-Agent": "PokemonEcosystemSimulator/1.0 (educational project)"
    })
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    content = soup.find("div", {"id": "mw-content-text"})
    if not content:
        print("  Could not find main content div")
        return []

    tables = content.find_all("table")
    print(f"  Found {len(tables)} tables on page")

    all_pairs = []
    seen = set()

    # Map table headers to relationship types
    table_types = {
        "predator": "predator_prey",
        "rival": "rival",
        "parasite": "parasite_host",
    }

    for i, table in enumerate(tables):
        rows = table.find_all("tr")
        if not rows:
            continue

        # Detect table type from header row
        header_cells = rows[0].find_all(["th", "td"])
        header_text = " ".join(c.get_text().strip().lower() for c in header_cells)

        relationship = "unknown"
        for keyword, rel_type in table_types.items():
            if keyword in header_text:
                relationship = rel_type
                break

        # Skip tables we can't categorize or that only list single Pokemon
        if relationship == "unknown":
            continue

        pair_count = 0
        for row in rows[1:]:
            cells = row.find_all("td")
            if len(cells) < 4:
                continue

            first, second = extract_pokemon_from_row(cells)
            if first and second and first != second:
                pair_key = (first, second)
                if pair_key not in seen:
                    seen.add(pair_key)
                    all_pairs.append({
                        "predator": first,
                        "prey": second,
                        "relationship": relationship,
                        "source": "canon",
                    })
                    pair_count += 1

        print(f"  Table {i} ({relationship}): {pair_count} pairs extracted")

    return all_pairs


def save_json(data, filename):
    """Save data to a JSON file."""
    os.makedirs(DATA_DIR, exist_ok=True)
    filepath = os.path.join(DATA_DIR, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"  Saved {filepath} ({len(data)} records)")


def main():
    print("=" * 60)
    print("Bulbapedia Predation Scraper")
    print("=" * 60)

    pairs = scrape_predation()
    save_json(pairs, "predation_canon.json")

    # Summary by relationship type
    by_type = {}
    for p in pairs:
        rel = p["relationship"]
        by_type[rel] = by_type.get(rel, 0) + 1

    print(f"\nTotal: {len(pairs)} canon pairs")
    for rel, count in sorted(by_type.items()):
        print(f"  {rel}: {count}")

    print("\nSample pairs:")
    for pair in pairs[:15]:
        print(f"  [{pair['relationship']}] {pair['predator']} -> {pair['prey']}")
    if len(pairs) > 15:
        print(f"  ... and {len(pairs) - 15} more")

    print("=" * 60)


if __name__ == "__main__":
    main()
