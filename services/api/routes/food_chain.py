from fastapi import APIRouter, Query
from typing import Optional
from db import get_cursor

router = APIRouter()


@router.get("/{pokemon_id}")
def get_food_chain(pokemon_id: int):
    """Get predators and prey for a single species."""
    with get_cursor() as cur:
        # What this species eats
        cur.execute("""
            SELECT p.id, p.name, fc.probability, fc.source,
                   tl.level AS trophic_level
            FROM food_chain fc
            JOIN pokemon p ON p.id = fc.prey_id
            LEFT JOIN trophic_levels tl ON tl.pokemon_id = p.id
            WHERE fc.predator_id = %s
            ORDER BY fc.probability DESC
        """, (pokemon_id,))
        prey = [dict(r) for r in cur.fetchall()]

        # What eats this species
        cur.execute("""
            SELECT p.id, p.name, fc.probability, fc.source,
                   tl.level AS trophic_level
            FROM food_chain fc
            JOIN pokemon p ON p.id = fc.predator_id
            LEFT JOIN trophic_levels tl ON tl.pokemon_id = p.id
            WHERE fc.prey_id = %s
            ORDER BY fc.probability DESC
        """, (pokemon_id,))
        predators = [dict(r) for r in cur.fetchall()]

        return {
            "pokemon_id": pokemon_id,
            "prey": prey,
            "prey_count": len(prey),
            "predators": predators,
            "predator_count": len(predators),
        }


@router.get("")
def get_food_chain_graph(
    biome_id: Optional[int] = Query(None, description="Filter to species present in this biome"),
    limit: int = Query(500, ge=1, le=5000, description="Max edges to return"),
):
    """Get food chain as a graph (nodes + edges) for visualization."""
    with get_cursor() as cur:
        if biome_id:
            # Only species currently alive in this biome
            cur.execute("""
                SELECT fc.predator_id, pred.name AS predator_name,
                       fc.prey_id, prey.name AS prey_name,
                       fc.probability
                FROM food_chain fc
                JOIN pokemon pred ON pred.id = fc.predator_id
                JOIN pokemon prey ON prey.id = fc.prey_id
                WHERE EXISTS (SELECT 1 FROM simulation_state ss WHERE ss.pokemon_id = fc.predator_id AND ss.biome_id = %s AND ss.population > 0)
                  AND EXISTS (SELECT 1 FROM simulation_state ss WHERE ss.pokemon_id = fc.prey_id AND ss.biome_id = %s AND ss.population > 0)
                LIMIT %s
            """, (biome_id, biome_id, limit))
        else:
            cur.execute("""
                SELECT fc.predator_id, pred.name AS predator_name,
                       fc.prey_id, prey.name AS prey_name,
                       fc.probability
                FROM food_chain fc
                JOIN pokemon pred ON pred.id = fc.predator_id
                JOIN pokemon prey ON prey.id = fc.prey_id
                LIMIT %s
            """, (limit,))

        edges = cur.fetchall()

        # Build unique node set
        node_ids = set()
        for e in edges:
            node_ids.add(e["predator_id"])
            node_ids.add(e["prey_id"])

        # Get node details
        nodes = []
        if node_ids:
            cur.execute("""
                SELECT p.id, p.name, tl.level AS trophic_level,
                       COALESCE(ss.total_pop, 0) AS population
                FROM pokemon p
                LEFT JOIN trophic_levels tl ON tl.pokemon_id = p.id
                LEFT JOIN (
                    SELECT pokemon_id, SUM(population) AS total_pop
                    FROM simulation_state WHERE population > 0
                    GROUP BY pokemon_id
                ) ss ON ss.pokemon_id = p.id
                WHERE p.id = ANY(%s)
            """, (list(node_ids),))
            nodes = [dict(r) for r in cur.fetchall()]

        return {
            "nodes": nodes,
            "edges": [dict(e) for e in edges],
            "node_count": len(nodes),
            "edge_count": len(edges),
        }
