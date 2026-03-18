from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from db import get_cursor

router = APIRouter()


@router.get("")
def list_species(
    trophic_level: Optional[str] = Query(None, description="Filter by trophic level"),
    type_name: Optional[str] = Query(None, description="Filter by type name"),
    alive_only: bool = Query(True, description="Only show species with population > 0"),
):
    """List all species with their types, trophic level, and total population."""
    with get_cursor() as cur:
        query = """
            SELECT
                p.id, p.name, p.hp, p.attack, p.defense,
                p.sp_attack, p.sp_defense, p.speed,
                p.is_legendary, p.is_mythical,
                (p.hp + p.attack + p.defense + p.sp_attack + p.sp_defense + p.speed) AS bst,
                tl.level AS trophic_level,
                ARRAY_AGG(DISTINCT t.name ORDER BY t.name) AS types,
                COALESCE(pop.total_population, 0) AS total_population,
                COALESCE(pop.num_biomes, 0) AS num_biomes
            FROM pokemon p
            LEFT JOIN trophic_levels tl ON tl.pokemon_id = p.id
            LEFT JOIN pokemon_types pt ON pt.pokemon_id = p.id
            LEFT JOIN types t ON t.id = pt.type_id
            LEFT JOIN (
                SELECT pokemon_id,
                       SUM(population) AS total_population,
                       COUNT(*) AS num_biomes
                FROM simulation_state
                WHERE population > 0
                GROUP BY pokemon_id
            ) pop ON pop.pokemon_id = p.id
        """
        conditions = []
        params = []

        if trophic_level:
            conditions.append("tl.level = %s")
            params.append(trophic_level)
        if type_name:
            conditions.append("EXISTS (SELECT 1 FROM pokemon_types pt2 JOIN types t2 ON t2.id = pt2.type_id WHERE pt2.pokemon_id = p.id AND t2.name = %s)")
            params.append(type_name)
        if alive_only:
            conditions.append("COALESCE(pop.total_population, 0) > 0")

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " GROUP BY p.id, p.name, p.hp, p.attack, p.defense, p.sp_attack, p.sp_defense, p.speed, p.is_legendary, p.is_mythical, tl.level, pop.total_population, pop.num_biomes"
        query += " ORDER BY COALESCE(pop.total_population, 0) DESC"

        cur.execute(query, params)
        rows = cur.fetchall()
        return [dict(r) for r in rows]


@router.get("/{pokemon_id}")
def get_species(pokemon_id: int):
    """Get detailed info for a single species, including per-biome population."""
    with get_cursor() as cur:
        # Basic info
        cur.execute("""
            SELECT
                p.id, p.name, p.hp, p.attack, p.defense,
                p.sp_attack, p.sp_defense, p.speed,
                p.is_legendary, p.is_mythical,
                (p.hp + p.attack + p.defense + p.sp_attack + p.sp_defense + p.speed) AS bst,
                tl.level AS trophic_level
            FROM pokemon p
            LEFT JOIN trophic_levels tl ON tl.pokemon_id = p.id
            WHERE p.id = %s
        """, (pokemon_id,))
        pokemon = cur.fetchone()
        if not pokemon:
            raise HTTPException(status_code=404, detail="Pokemon not found")
        result = dict(pokemon)

        # Types
        cur.execute("""
            SELECT t.name FROM pokemon_types pt
            JOIN types t ON t.id = pt.type_id
            WHERE pt.pokemon_id = %s ORDER BY pt.slot
        """, (pokemon_id,))
        result["types"] = [r["name"] for r in cur.fetchall()]

        # Per-biome population
        cur.execute("""
            SELECT b.id AS biome_id, b.name AS biome_name,
                   ss.population, ss.food_satiation, ss.health, ss.ticks_stable
            FROM simulation_state ss
            JOIN biomes b ON b.id = ss.biome_id
            WHERE ss.pokemon_id = %s AND ss.population > 0
            ORDER BY ss.population DESC
        """, (pokemon_id,))
        result["biomes"] = [dict(r) for r in cur.fetchall()]
        result["total_population"] = sum(b["population"] for b in result["biomes"])

        # Predators and prey counts
        cur.execute("SELECT COUNT(*) AS count FROM food_chain WHERE prey_id = %s", (pokemon_id,))
        result["predator_count"] = cur.fetchone()["count"]
        cur.execute("SELECT COUNT(*) AS count FROM food_chain WHERE predator_id = %s", (pokemon_id,))
        result["prey_count"] = cur.fetchone()["count"]

        return result
