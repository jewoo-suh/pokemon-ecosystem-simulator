-- ============================================================
-- Migration 002: Food Chain & Simulation Parameter Tables
-- Derived/enriched data layer
-- ============================================================

BEGIN;

-- --------------------------
-- Trophic Levels
-- Every Pokemon gets an ecological role
-- --------------------------
CREATE TYPE trophic_level_enum AS ENUM (
    'producer',           -- Grass types, photosynthesis — generates energy
    'primary_consumer',   -- Herbivores, eats producers/berries
    'secondary_consumer', -- Mid-tier predators
    'apex_predator',      -- Top of chain (legends, pseudos, large predators)
    'decomposer'          -- Grimer, Muk, Ghost types — feeds on dead
);

CREATE TYPE data_source_enum AS ENUM (
    'canon',    -- from Bulbapedia/Pokedex entries
    'derived'   -- generated from type rules
);

CREATE TABLE trophic_levels (
    pokemon_id  INT PRIMARY KEY REFERENCES pokemon(id) ON DELETE CASCADE,
    level       trophic_level_enum NOT NULL,
    source      data_source_enum NOT NULL DEFAULT 'derived'
);

-- --------------------------
-- Food Chain
-- Specific predator-prey relationships
-- Canon (Bulbapedia) + derived (type-based rules)
-- --------------------------
CREATE TABLE food_chain (
    id              SERIAL PRIMARY KEY,
    predator_id     INT NOT NULL REFERENCES pokemon(id),
    prey_id         INT NOT NULL REFERENCES pokemon(id),
    probability     NUMERIC(4,3) NOT NULL DEFAULT 0.5,  -- hunt success modifier
    source          data_source_enum NOT NULL DEFAULT 'derived',
    UNIQUE (predator_id, prey_id),
    CHECK (predator_id != prey_id)
);

CREATE INDEX idx_food_predator ON food_chain(predator_id);
CREATE INDEX idx_food_prey ON food_chain(prey_id);

-- --------------------------
-- Pokemon Simulation Parameters
-- Derived from PokeAPI stats via dbt transformations
-- Separated from raw pokemon table for clean lineage
-- --------------------------
CREATE TABLE pokemon_sim_params (
    pokemon_id          INT PRIMARY KEY REFERENCES pokemon(id) ON DELETE CASCADE,
    metabolism_rate      NUMERIC(8,5) NOT NULL,  -- food units needed per tick
    repro_rate           NUMERIC(8,5) NOT NULL,  -- offspring probability per tick
    natural_mortality    NUMERIC(8,5) NOT NULL,  -- base death chance per tick
    hunt_power           NUMERIC(8,5) NOT NULL,  -- (speed + attack) normalized
    escape_power         NUMERIC(8,5) NOT NULL,  -- (speed + defense) normalized
    migration_rate       NUMERIC(8,5) NOT NULL,  -- chance to move biomes per tick
    evolution_threshold  NUMERIC(8,5),           -- NULL if no evolution
    derived_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --------------------------
-- Simulation Config
-- Tuning knobs — adjustable without code changes
-- --------------------------
CREATE TABLE simulation_config (
    key         VARCHAR(100) PRIMARY KEY,
    value       NUMERIC(12,6) NOT NULL,
    description TEXT
);

-- Seed default config values
INSERT INTO simulation_config (key, value, description) VALUES
    ('base_metabolism_constant',    0.050000, 'Multiplier for metabolism rate derivation'),
    ('base_repro_divisor',        255.000000, 'Divisor applied to hatch_counter for repro_rate'),
    ('predation_encounter_chance',  0.100000, 'Base probability of predator meeting prey per tick'),
    ('max_population_per_biome', 10000.000000, 'Default carrying capacity per biome'),
    ('evolution_stability_ticks',  50.000000, 'Ticks of stable population needed before evolution'),
    ('migration_speed_divisor',   200.000000, 'Divisor for speed stat to get migration_rate'),
    ('mortality_base_rate',         0.020000, 'Baseline mortality before stat adjustments'),
    ('food_scarcity_multiplier',    2.000000, 'Mortality multiplier when food is scarce'),
    ('reproduction_food_threshold', 0.700000, 'Min food satiation ratio to reproduce'),
    ('tick_duration_seconds',       1.000000, 'Real-time seconds per simulation tick');

COMMIT;
