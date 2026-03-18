import sys
import os
from fastapi import APIRouter
from db import get_cursor

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "simulation"))

router = APIRouter()


@router.get("/overview")
def get_overview():
    """Dashboard overview: key ecosystem numbers."""
    with get_cursor() as cur:
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
            SELECT COUNT(DISTINCT pokemon_id) AS count
            FROM ecosystem_events WHERE event_type = 'extinction'
        """)
        extinctions = cur.fetchone()["count"]

        # Most populous species
        cur.execute("""
            SELECT p.id, p.name, SUM(ss.population) AS population
            FROM simulation_state ss
            JOIN pokemon p ON p.id = ss.pokemon_id
            WHERE ss.population > 0
            GROUP BY p.id, p.name
            ORDER BY population DESC LIMIT 1
        """)
        top_species = cur.fetchone()

        # Most populous biome
        cur.execute("""
            SELECT b.id, b.name, SUM(ss.population) AS population
            FROM simulation_state ss
            JOIN biomes b ON b.id = ss.biome_id
            WHERE ss.population > 0
            GROUP BY b.id, b.name
            ORDER BY population DESC LIMIT 1
        """)
        top_biome = cur.fetchone()

        return {
            "current_tick": current_tick,
            "total_species": total_species,
            "living_species": pop["living_species"],
            "total_population": pop["total_population"],
            "extinction_events": extinctions,
            "survival_rate": round(pop["living_species"] / total_species * 100, 1),
            "most_populous_species": dict(top_species) if top_species else None,
            "most_populous_biome": dict(top_biome) if top_biome else None,
        }


@router.get("/trophic")
def get_trophic_breakdown():
    """Population breakdown by trophic level."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT tl.level,
                   COUNT(DISTINCT ss.pokemon_id) AS species_count,
                   SUM(ss.population) AS total_population,
                   ROUND(AVG(ss.food_satiation)::numeric, 3) AS avg_food_satiation
            FROM simulation_state ss
            JOIN trophic_levels tl ON tl.pokemon_id = ss.pokemon_id
            WHERE ss.population > 0
            GROUP BY tl.level
            ORDER BY total_population DESC
        """)
        return [dict(r) for r in cur.fetchall()]


@router.get("/diversity")
def get_diversity_indices():
    """Compute ecological diversity indices (Shannon, Simpson, connectance, etc.)."""
    from engine import SimulationEngine

    engine = SimulationEngine()
    engine.load_data()
    engine._load_state()
    engine._build_arrays()

    indices = engine.compute_diversity_indices()

    # Get current tick and season
    cur = engine.conn.cursor()
    cur.execute("SELECT value FROM simulation_metadata WHERE key = 'current_tick'")
    current_tick = int(cur.fetchone()[0])
    cur.close()

    season_name, _ = engine.get_season(current_tick)
    engine.conn.close()

    return {
        "tick": current_tick,
        "season": season_name,
        **indices,
    }
