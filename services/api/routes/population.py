from fastapi import APIRouter, Query
from typing import Optional
from db import get_cursor

router = APIRouter()


@router.get("/species/{pokemon_id}")
def species_population_history(
    pokemon_id: int,
    tick_start: int = Query(0, ge=0),
    tick_end: Optional[int] = Query(None),
    resolution: int = Query(1, ge=1, description="Sample every Nth tick"),
    by_biome: bool = Query(False, description="Break out by biome"),
):
    """Population time series for a single species."""
    with get_cursor() as cur:
        # Default tick_end to current tick
        if tick_end is None:
            cur.execute("SELECT value FROM simulation_metadata WHERE key = 'current_tick'")
            row = cur.fetchone()
            tick_end = int(row["value"]) if row else 1000

        if by_biome:
            cur.execute("""
                SELECT ps.tick, b.name AS biome, ps.population,
                       ps.food_satiation
                FROM population_snapshots ps
                JOIN biomes b ON b.id = ps.biome_id
                WHERE ps.pokemon_id = %s
                  AND ps.tick >= %s AND ps.tick <= %s
                  AND ps.tick %% %s = 0
                ORDER BY ps.tick, b.name
            """, (pokemon_id, tick_start, tick_end, resolution))
            rows = cur.fetchall()

            # Group by biome
            biomes = {}
            for r in rows:
                biome = r["biome"]
                if biome not in biomes:
                    biomes[biome] = {"ticks": [], "populations": [], "food_satiation": []}
                biomes[biome]["ticks"].append(r["tick"])
                biomes[biome]["populations"].append(r["population"])
                biomes[biome]["food_satiation"].append(float(r["food_satiation"]))

            return {"pokemon_id": pokemon_id, "biomes": biomes}
        else:
            cur.execute("""
                SELECT tick,
                       SUM(population) AS population,
                       AVG(food_satiation) AS food_satiation
                FROM population_snapshots
                WHERE pokemon_id = %s
                  AND tick >= %s AND tick <= %s
                  AND tick %% %s = 0
                GROUP BY tick
                ORDER BY tick
            """, (pokemon_id, tick_start, tick_end, resolution))
            rows = cur.fetchall()

            return {
                "pokemon_id": pokemon_id,
                "ticks": [r["tick"] for r in rows],
                "populations": [r["population"] for r in rows],
                "food_satiation": [float(r["food_satiation"]) for r in rows],
            }


@router.get("/biome/{biome_id}")
def biome_population_history(
    biome_id: int,
    tick_start: int = Query(0, ge=0),
    tick_end: Optional[int] = Query(None),
    resolution: int = Query(1, ge=1, description="Sample every Nth tick"),
):
    """Total population time series for a biome."""
    with get_cursor() as cur:
        if tick_end is None:
            cur.execute("SELECT value FROM simulation_metadata WHERE key = 'current_tick'")
            row = cur.fetchone()
            tick_end = int(row["value"]) if row else 1000

        cur.execute("""
            SELECT tick,
                   SUM(population) AS population,
                   COUNT(DISTINCT pokemon_id) AS species_count,
                   AVG(food_satiation) AS avg_food_satiation
            FROM population_snapshots
            WHERE biome_id = %s
              AND tick >= %s AND tick <= %s
              AND tick %% %s = 0
            GROUP BY tick
            ORDER BY tick
        """, (biome_id, tick_start, tick_end, resolution))
        rows = cur.fetchall()

        return {
            "biome_id": biome_id,
            "ticks": [r["tick"] for r in rows],
            "populations": [r["population"] for r in rows],
            "species_counts": [r["species_count"] for r in rows],
            "avg_food_satiation": [float(r["avg_food_satiation"]) for r in rows],
        }
