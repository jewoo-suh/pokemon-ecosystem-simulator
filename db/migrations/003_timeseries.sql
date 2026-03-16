-- ============================================================
-- Migration 003: Time-Series Tables (TimescaleDB)
-- Population tracking and ecosystem events over simulation ticks
-- ============================================================

BEGIN;

-- --------------------------
-- Population Snapshots
-- One row per Pokemon per biome per tick
-- This is the core time-series data the API serves
-- --------------------------
CREATE TABLE population_snapshots (
    tick            INT NOT NULL,
    pokemon_id      INT NOT NULL REFERENCES pokemon(id),
    biome_id        INT NOT NULL REFERENCES biomes(id),
    population      INT NOT NULL DEFAULT 0,
    avg_health      NUMERIC(5,2) DEFAULT 100.0,
    births          INT NOT NULL DEFAULT 0,
    deaths          INT NOT NULL DEFAULT 0,
    immigrations    INT NOT NULL DEFAULT 0,    -- arrived from other biomes
    emigrations     INT NOT NULL DEFAULT 0,    -- left to other biomes
    food_satiation  NUMERIC(5,4) DEFAULT 1.0,  -- 0.0 = starving, 1.0 = fully fed
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Convert to TimescaleDB hypertable for efficient time-series queries
-- Partitions by tick for fast range scans
SELECT create_hypertable('population_snapshots', 'tick', chunk_time_interval => 100);

CREATE INDEX idx_pop_pokemon ON population_snapshots(pokemon_id, tick);
CREATE INDEX idx_pop_biome ON population_snapshots(biome_id, tick);
CREATE INDEX idx_pop_tick ON population_snapshots(tick DESC);

-- --------------------------
-- Ecosystem Events
-- Notable events: extinctions, booms, migrations, equilibrium
-- --------------------------
CREATE TYPE event_type_enum AS ENUM (
    'extinction',           -- population hit 0
    'population_boom',      -- population exceeded threshold
    'mass_migration',       -- large group moved biomes
    'equilibrium_reached',  -- populations stabilized
    'evolution_wave',       -- mass evolution event
    'food_chain_collapse',  -- prey extinction cascading up
    'invasive_species'      -- new species dominates a biome
);

CREATE TABLE ecosystem_events (
    id              SERIAL,
    tick            INT NOT NULL,
    event_type      event_type_enum NOT NULL,
    pokemon_id      INT REFERENCES pokemon(id),
    biome_id        INT REFERENCES biomes(id),
    description     TEXT,
    metadata        JSONB DEFAULT '{}',       -- flexible extra data per event type
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT create_hypertable('ecosystem_events', 'tick', chunk_time_interval => 500);

CREATE INDEX idx_events_type ON ecosystem_events(event_type, tick);
CREATE INDEX idx_events_pokemon ON ecosystem_events(pokemon_id, tick);
CREATE INDEX idx_events_biome ON ecosystem_events(biome_id, tick);

-- --------------------------
-- Continuous Aggregates (materialized views)
-- Pre-computed rollups for common API queries
-- --------------------------

-- Population totals per biome per tick (avoids expensive GROUP BY at query time)
CREATE MATERIALIZED VIEW biome_population_summary
WITH (timescaledb.continuous) AS
SELECT
    tick,
    biome_id,
    SUM(population) AS total_population,
    COUNT(DISTINCT pokemon_id) AS species_count,
    SUM(births) AS total_births,
    SUM(deaths) AS total_deaths
FROM population_snapshots
GROUP BY tick, biome_id
WITH NO DATA;

-- Population totals per pokemon across all biomes
CREATE MATERIALIZED VIEW species_population_summary
WITH (timescaledb.continuous) AS
SELECT
    tick,
    pokemon_id,
    SUM(population) AS total_population,
    AVG(avg_health) AS avg_health,
    AVG(food_satiation) AS avg_food_satiation
FROM population_snapshots
GROUP BY tick, pokemon_id
WITH NO DATA;

COMMIT;
