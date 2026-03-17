-- ============================================================
-- Migration 004: Simulation State Table
-- Live mutable state that the engine reads/writes each tick.
-- This is the "whiteboard" — population_snapshots is the "notebook".
-- ============================================================

BEGIN;

-- --------------------------
-- Simulation State
-- One row per Pokemon per biome — the live world state
-- --------------------------
CREATE TABLE simulation_state (
    pokemon_id      INT NOT NULL REFERENCES pokemon(id),
    biome_id        INT NOT NULL REFERENCES biomes(id),
    population      INT NOT NULL DEFAULT 0,
    food_satiation  NUMERIC(5,4) NOT NULL DEFAULT 1.0,  -- 0.0 = starving, 1.0 = full
    health          NUMERIC(5,2) NOT NULL DEFAULT 100.0,
    ticks_stable    INT NOT NULL DEFAULT 0,              -- consecutive ticks with stable pop
    PRIMARY KEY (pokemon_id, biome_id)
);

CREATE INDEX idx_simstate_biome ON simulation_state(biome_id);

-- --------------------------
-- Simulation Metadata
-- Tracks current tick and simulation status
-- --------------------------
CREATE TABLE simulation_metadata (
    key     VARCHAR(100) PRIMARY KEY,
    value   TEXT NOT NULL
);

INSERT INTO simulation_metadata (key, value) VALUES
    ('current_tick', '0'),
    ('status', 'stopped'),       -- stopped, running, paused
    ('started_at', ''),
    ('last_tick_at', '');

-- --------------------------
-- Add base_evolution_rate to config
-- --------------------------
INSERT INTO simulation_config (key, value, description) VALUES
    ('base_evolution_rate', 0.020000, 'Per-individual evolution chance per tick when conditions are met')
ON CONFLICT (key) DO NOTHING;

COMMIT;
