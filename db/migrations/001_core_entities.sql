-- ============================================================
-- Migration 001: Core Entity Tables (PostgreSQL)
-- Pokemon, Types, Biomes, and their relationships
-- ============================================================

BEGIN;

-- --------------------------
-- Types (Fire, Water, etc.)
-- --------------------------
CREATE TABLE types (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) NOT NULL UNIQUE,
    pokeapi_id  INT UNIQUE
);

-- --------------------------
-- Type Effectiveness Matrix
-- 18x18 = 324 rows max
-- multiplier: 0 (immune), 0.5 (resists), 1 (neutral), 2 (super effective)
-- --------------------------
CREATE TABLE type_effectiveness (
    id              SERIAL PRIMARY KEY,
    atk_type_id     INT NOT NULL REFERENCES types(id),
    def_type_id     INT NOT NULL REFERENCES types(id),
    multiplier      NUMERIC(3,2) NOT NULL CHECK (multiplier IN (0, 0.5, 1, 2)),
    UNIQUE (atk_type_id, def_type_id)
);

CREATE INDEX idx_type_eff_atk ON type_effectiveness(atk_type_id);
CREATE INDEX idx_type_eff_def ON type_effectiveness(def_type_id);

-- --------------------------
-- Biomes (forest, ocean, cave, etc.)
-- Seeded from PokeAPI habitats + custom additions
-- --------------------------
CREATE TABLE biomes (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT,
    carrying_capacity INT NOT NULL DEFAULT 10000,
    primary_type_id INT REFERENCES types(id)
);

-- --------------------------
-- Pokemon
-- Raw data from PokeAPI — immutable source of truth
-- --------------------------
CREATE TABLE pokemon (
    id              SERIAL PRIMARY KEY,
    pokeapi_id      INT UNIQUE NOT NULL,
    name            VARCHAR(100) NOT NULL UNIQUE,
    hp              INT NOT NULL,
    attack          INT NOT NULL,
    defense         INT NOT NULL,
    sp_attack       INT NOT NULL,
    sp_defense      INT NOT NULL,
    speed           INT NOT NULL,
    height          INT NOT NULL,         -- in decimeters
    weight          INT NOT NULL,         -- in hectograms
    base_experience INT,
    hatch_counter   INT,                  -- egg cycles from species data
    catch_rate      INT,                  -- from species data, proxy for rarity
    growth_rate     VARCHAR(50),          -- slow, medium, fast, etc.
    is_legendary    BOOLEAN DEFAULT FALSE,
    is_mythical     BOOLEAN DEFAULT FALSE,
    sprite_url      TEXT
);

-- --------------------------
-- Pokemon <-> Types (many-to-many)
-- A Pokemon can have 1-2 types
-- --------------------------
CREATE TABLE pokemon_types (
    pokemon_id  INT NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
    type_id     INT NOT NULL REFERENCES types(id),
    slot        INT NOT NULL CHECK (slot IN (1, 2)),  -- primary or secondary type
    PRIMARY KEY (pokemon_id, type_id)
);

-- --------------------------
-- Pokemon <-> Biomes (many-to-many)
-- Which biomes a Pokemon can inhabit
-- --------------------------
CREATE TABLE pokemon_habitats (
    pokemon_id  INT NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
    biome_id    INT NOT NULL REFERENCES biomes(id),
    affinity    NUMERIC(3,2) NOT NULL DEFAULT 1.0,  -- how well they thrive (0.0-1.0)
    PRIMARY KEY (pokemon_id, biome_id)
);

-- --------------------------
-- Evolution Chains
-- Tracks who evolves into whom
-- --------------------------
CREATE TABLE evolution_chains (
    id                  SERIAL PRIMARY KEY,
    from_pokemon_id     INT NOT NULL REFERENCES pokemon(id),
    to_pokemon_id       INT NOT NULL REFERENCES pokemon(id),
    min_population      INT DEFAULT 50,     -- min stable population before evolution occurs
    evolution_order     INT NOT NULL,        -- 1 = first stage, 2 = second stage, etc.
    UNIQUE (from_pokemon_id, to_pokemon_id)
);

CREATE INDEX idx_evo_from ON evolution_chains(from_pokemon_id);
CREATE INDEX idx_evo_to ON evolution_chains(to_pokemon_id);

COMMIT;
