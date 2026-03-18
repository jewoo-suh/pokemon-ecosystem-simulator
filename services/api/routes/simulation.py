import sys
import os
import json
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse
from typing import Optional
from db import get_cursor

# Add simulation service to path for importing engine
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "simulation"))

router = APIRouter()


@router.get("/status")
def get_status():
    """Get current simulation status, tick, and config."""
    with get_cursor() as cur:
        cur.execute("SELECT key, value FROM simulation_metadata")
        metadata = {r["key"]: r["value"] for r in cur.fetchall()}

        cur.execute("SELECT key, value FROM simulation_config")
        config = {r["key"]: float(r["value"]) for r in cur.fetchall()}

        cur.execute("""
            SELECT COUNT(DISTINCT pokemon_id) AS living_species,
                   SUM(population) AS total_population
            FROM simulation_state WHERE population > 0
        """)
        pop = cur.fetchone()

        return {
            "current_tick": int(metadata.get("current_tick", 0)),
            "status": metadata.get("status", "unknown"),
            "living_species": pop["living_species"],
            "total_population": pop["total_population"],
            "config": config,
        }


@router.post("/run")
def run_simulation(ticks: int = Query(100, ge=1, le=5000, description="Number of ticks to run")):
    """Run the simulation for N more ticks. Blocks until complete."""
    from engine import SimulationEngine

    engine = SimulationEngine()
    engine.load_data()
    engine._load_state()

    if not engine.state:
        engine.initialize_world()

    engine._build_arrays()
    engine.run(ticks, log_interval=max(10, ticks // 10))
    engine.close()

    # Return updated status
    with get_cursor() as cur:
        cur.execute("SELECT value FROM simulation_metadata WHERE key = 'current_tick'")
        current_tick = int(cur.fetchone()["value"])

        cur.execute("""
            SELECT COUNT(DISTINCT pokemon_id) AS living_species,
                   SUM(population) AS total_population
            FROM simulation_state WHERE population > 0
        """)
        pop = cur.fetchone()

    return {
        "ticks_run": ticks,
        "current_tick": current_tick,
        "living_species": pop["living_species"],
        "total_population": pop["total_population"],
    }


@router.post("/run-frames")
def run_simulation_frames(ticks: int = Query(50, ge=1, le=500)):
    """Run N ticks and return per-tick population snapshots for animation.

    Returns frames as a list of {tick, species: [{id, biome_id, population}, ...]}.
    Only includes species with population > 0 to keep payload small.
    """
    from engine import SimulationEngine
    from collections import defaultdict

    import numpy as np

    engine = SimulationEngine()
    engine.load_data()
    engine._load_state()

    if not engine.state:
        engine.initialize_world()

    engine._build_arrays()

    cur = engine.conn.cursor()
    cur.execute("SELECT value FROM simulation_metadata WHERE key = 'current_tick'")
    current_tick = int(cur.fetchone()[0])
    cur.close()

    # Build name lookup
    name_lookup = {}
    cur = engine.conn.cursor()
    cur.execute("SELECT id, name FROM pokemon")
    for row in cur.fetchall():
        name_lookup[row[0]] = row[1]
    cur.close()

    # Biome name lookup
    biome_names = {}
    cur = engine.conn.cursor()
    cur.execute("SELECT id, name FROM biomes")
    for row in cur.fetchall():
        biome_names[row[0]] = row[1]
    cur.close()

    trophic_levels = engine.trophic_levels

    # Collect all unique (pokemon_id, biome_id) entries seen across all frames
    # Run simulation first, capture population per tick as compact arrays
    tick_pops = []  # list of {idx: pop} per tick

    for i in range(ticks):
        current_tick += 1
        events = engine._run_tick(current_tick)

        # Snapshot: just population array (lightweight)
        alive_mask = engine.pop > 0
        alive_idx = np.where(alive_mask)[0]
        season_name, _ = engine.get_season(current_tick)
        tick_pops.append({
            "tick": current_tick,
            "season": season_name,
            "pops": {int(j): int(engine.pop[j]) for j in alive_idx},
            "total_population": int(engine.pop[alive_mask].sum()),
            "living_species": int(alive_mask.sum()),
        })

    # Build species catalog: all entries that appeared in any frame
    all_seen = set()
    for tp in tick_pops:
        all_seen.update(tp["pops"].keys())

    keys = engine.keys
    catalog = []  # ordered list of species entries
    idx_to_catalog = {}  # engine index -> catalog position

    for ci, idx in enumerate(sorted(all_seen)):
        pid, bid = keys[idx]
        catalog.append({
            "id": pid,
            "biome_id": bid,
            "name": name_lookup.get(pid, "?"),
            "trophic": trophic_levels.get(pid, "unknown"),
            "biome": biome_names.get(bid, "?"),
        })
        idx_to_catalog[idx] = ci

    # Convert frames to use catalog indices + compact pop arrays
    frames = []
    for tp in tick_pops:
        # Build population array aligned to catalog order
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

    # Save final state to DB
    engine._sync_arrays_to_state()
    engine._save_snapshot(current_tick)
    cur = engine.conn.cursor()
    cur.execute("UPDATE simulation_metadata SET value = %s WHERE key = 'current_tick'",
                (str(current_tick),))
    engine.conn.commit()
    cur.close()
    engine.close()

    return {
        "start_tick": frames[0]["tick"],
        "end_tick": current_tick,
        "species": catalog,
        "frames": frames,
    }


@router.get("/events")
def get_events(
    tick_start: Optional[int] = Query(None),
    tick_end: Optional[int] = Query(None),
    event_type: Optional[str] = Query(None, description="Filter by event type (extinction, population_boom, etc.)"),
    pokemon_id: Optional[int] = Query(None),
    limit: int = Query(50, ge=1, le=500),
):
    """Get ecosystem events with optional filters."""
    with get_cursor() as cur:
        query = """
            SELECT ee.tick, ee.event_type, ee.pokemon_id,
                   p.name AS pokemon_name,
                   ee.biome_id, b.name AS biome_name,
                   ee.description
            FROM ecosystem_events ee
            JOIN pokemon p ON p.id = ee.pokemon_id
            JOIN biomes b ON b.id = ee.biome_id
        """
        conditions = []
        params = []

        if tick_start is not None:
            conditions.append("ee.tick >= %s")
            params.append(tick_start)
        if tick_end is not None:
            conditions.append("ee.tick <= %s")
            params.append(tick_end)
        if event_type:
            conditions.append("ee.event_type = %s")
            params.append(event_type)
        if pokemon_id:
            conditions.append("ee.pokemon_id = %s")
            params.append(pokemon_id)

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY ee.tick DESC LIMIT %s"
        params.append(limit)

        cur.execute(query, params)
        return [dict(r) for r in cur.fetchall()]


@router.get("/map")
def get_map():
    """Get the current Perlin noise map for frontend rendering."""
    map_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "map_generator", "maps", "current_map.json"
    )
    if not os.path.exists(map_path):
        raise HTTPException(status_code=404, detail="No map generated yet. Run: python services/map_generator/generate_map.py")

    with open(map_path) as f:
        return JSONResponse(content=json.load(f))
