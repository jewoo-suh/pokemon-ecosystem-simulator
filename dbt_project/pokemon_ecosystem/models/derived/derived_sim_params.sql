-- =============================================================
-- Derived Simulation Parameters
-- Computes metabolism, reproduction, mortality, hunt/escape power,
-- and migration rates from raw Pokemon stats.
-- =============================================================

WITH config AS (
    SELECT
        MAX(CASE WHEN key = 'base_metabolism_constant' THEN value END) AS base_metabolism,
        MAX(CASE WHEN key = 'base_repro_divisor' THEN value END) AS base_repro_divisor,
        MAX(CASE WHEN key = 'mortality_base_rate' THEN value END) AS mortality_base,
        MAX(CASE WHEN key = 'migration_speed_divisor' THEN value END) AS migration_divisor
    FROM {{ source('public', 'simulation_config') }}
),

stats_range AS (
    SELECT
        MAX(weight) AS max_weight,
        MAX(hp + GREATEST(defense, sp_defense)) AS max_survivability,
        MAX(speed + GREATEST(attack, sp_attack)) AS max_offensive,
        MAX(speed + GREATEST(defense, sp_defense)) AS max_defensive
    FROM {{ source('public', 'pokemon') }}
),

evo_pokemon AS (
    SELECT DISTINCT from_pokemon_id AS pokemon_id
    FROM {{ source('public', 'evolution_chains') }}
)

SELECT
    p.id AS pokemon_id,

    -- Metabolism: heavier = more food needed per tick
    ROUND((p.weight::NUMERIC / sr.max_weight) * c.base_metabolism, 5)
        AS metabolism_rate,

    -- Reproduction: lower hatch counter = faster breeding
    ROUND(
        CASE
            WHEN p.hatch_counter IS NOT NULL AND p.hatch_counter > 0
            THEN 1.0 / (p.hatch_counter / c.base_repro_divisor)
            ELSE 0.01
        END, 5)
        AS repro_rate,

    -- Natural mortality: tankier Pokemon live longer (uses best defensive stat)
    ROUND(
        GREATEST(0.001,
            c.mortality_base * (1.0 - (p.hp + GREATEST(p.defense, p.sp_defense))::NUMERIC / sr.max_survivability)
        ), 5)
        AS natural_mortality,

    -- Hunt power: fast + best offensive stat = better predator
    ROUND((p.speed + GREATEST(p.attack, p.sp_attack))::NUMERIC / sr.max_offensive, 5)
        AS hunt_power,

    -- Escape power: fast + best defensive stat = harder to catch
    ROUND((p.speed + GREATEST(p.defense, p.sp_defense))::NUMERIC / sr.max_defensive, 5)
        AS escape_power,

    -- Migration: faster Pokemon move between biomes more
    ROUND(p.speed::NUMERIC / c.migration_divisor, 5)
        AS migration_rate,

    -- Evolution threshold: NULL if Pokemon doesn't evolve
    CASE
        WHEN ep.pokemon_id IS NOT NULL
        THEN ROUND(COALESCE(p.base_experience, 100)::NUMERIC / 500.0, 5)
        ELSE NULL
    END AS evolution_threshold

FROM {{ source('public', 'pokemon') }} p
CROSS JOIN config c
CROSS JOIN stats_range sr
LEFT JOIN evo_pokemon ep ON p.id = ep.pokemon_id
