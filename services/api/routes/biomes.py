from fastapi import APIRouter, HTTPException
from db import get_cursor

router = APIRouter()


@router.get("")
def list_biomes():
    """List all biomes with current population stats."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT
                b.id, b.name, b.carrying_capacity, b.biomass_factor,
                COALESCE(s.total_pop, 0) AS total_population,
                COALESCE(s.species_count, 0) AS species_count,
                ROUND(COALESCE(s.avg_food, 0)::numeric, 3) AS avg_food_satiation
            FROM biomes b
            LEFT JOIN (
                SELECT biome_id,
                       SUM(population) AS total_pop,
                       COUNT(DISTINCT pokemon_id) AS species_count,
                       AVG(food_satiation) AS avg_food
                FROM simulation_state
                WHERE population > 0
                GROUP BY biome_id
            ) s ON s.biome_id = b.id
            ORDER BY COALESCE(s.total_pop, 0) DESC
        """)
        return [dict(r) for r in cur.fetchall()]


@router.get("/{biome_id}")
def get_biome(biome_id: int):
    """Get detailed info for a biome, including species breakdown by type."""
    with get_cursor() as cur:
        # Biome info
        cur.execute("SELECT id, name, carrying_capacity, biomass_factor FROM biomes WHERE id = %s", (biome_id,))
        biome = cur.fetchone()
        if not biome:
            raise HTTPException(status_code=404, detail="Biome not found")
        result = dict(biome)

        # Species in this biome
        cur.execute("""
            SELECT p.id AS pokemon_id, p.name,
                   ss.population, ss.food_satiation,
                   tl.level AS trophic_level
            FROM simulation_state ss
            JOIN pokemon p ON p.id = ss.pokemon_id
            LEFT JOIN trophic_levels tl ON tl.pokemon_id = p.id
            WHERE ss.biome_id = %s AND ss.population > 0
            ORDER BY ss.population DESC
        """, (biome_id,))
        result["species"] = [dict(r) for r in cur.fetchall()]

        # Type breakdown
        cur.execute("""
            SELECT t.name AS type, SUM(ss.population) AS total_pop,
                   COUNT(DISTINCT ss.pokemon_id) AS species_count,
                   COALESCE(tba.affinity, 1.0) AS type_affinity
            FROM simulation_state ss
            JOIN pokemon_types pt ON pt.pokemon_id = ss.pokemon_id AND pt.slot = 1
            JOIN types t ON t.id = pt.type_id
            LEFT JOIN type_biome_affinity tba ON tba.type_id = pt.type_id AND tba.biome_id = ss.biome_id
            WHERE ss.biome_id = %s AND ss.population > 0
            GROUP BY t.name, tba.affinity
            ORDER BY total_pop DESC
        """, (biome_id,))
        result["type_breakdown"] = [dict(r) for r in cur.fetchall()]

        result["total_population"] = sum(s["population"] for s in result["species"])
        result["species_count"] = len(result["species"])

        return result
