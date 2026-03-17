-- =============================================================
-- Derived Food Chain (type-based)
-- Generates predator-prey pairs where:
--   1. Predator's type is super effective against prey's type
--   2. Predator is a higher trophic level than prey
--   3. Both share at least one biome
--   4. Pair doesn't already exist as canon
-- =============================================================

{{ config(materialized='table') }}

WITH trophic_rank AS (
    SELECT
        pokemon_id,
        level,
        CASE level
            WHEN 'producer' THEN 1
            WHEN 'decomposer' THEN 1
            WHEN 'primary_consumer' THEN 2
            WHEN 'secondary_consumer' THEN 3
            WHEN 'apex_predator' THEN 4
        END AS rank
    FROM {{ ref('derived_trophic_levels') }}
),

pokemon_primary_type AS (
    SELECT pt.pokemon_id, pt.type_id
    FROM {{ source('public', 'pokemon_types') }} pt
    WHERE pt.slot = 1
),

super_effective AS (
    SELECT atk_type_id, def_type_id
    FROM {{ source('public', 'type_effectiveness') }}
    WHERE multiplier = 2.0
),

shared_biomes AS (
    SELECT DISTINCT
        ph1.pokemon_id AS pokemon_a,
        ph2.pokemon_id AS pokemon_b
    FROM {{ source('public', 'pokemon_habitats') }} ph1
    JOIN {{ source('public', 'pokemon_habitats') }} ph2
        ON ph1.biome_id = ph2.biome_id
        AND ph1.pokemon_id != ph2.pokemon_id
),

existing_pairs AS (
    SELECT predator_id, prey_id
    FROM {{ source('public', 'food_chain') }}
),

candidates AS (
    SELECT DISTINCT
        pred_type.pokemon_id AS predator_id,
        prey_type.pokemon_id AS prey_id
    FROM super_effective se
    JOIN pokemon_primary_type pred_type ON se.atk_type_id = pred_type.type_id
    JOIN pokemon_primary_type prey_type ON se.def_type_id = prey_type.type_id
    JOIN trophic_rank pred_rank ON pred_type.pokemon_id = pred_rank.pokemon_id
    JOIN trophic_rank prey_rank ON prey_type.pokemon_id = prey_rank.pokemon_id
    WHERE pred_rank.rank > prey_rank.rank
    AND EXISTS (
        SELECT 1 FROM shared_biomes sb
        WHERE sb.pokemon_a = pred_type.pokemon_id
        AND sb.pokemon_b = prey_type.pokemon_id
    )
    AND NOT EXISTS (
        SELECT 1 FROM existing_pairs ep
        WHERE ep.predator_id = pred_type.pokemon_id
        AND ep.prey_id = prey_type.pokemon_id
    )
    AND pred_type.pokemon_id != prey_type.pokemon_id
)

SELECT
    predator_id,
    prey_id,
    0.3 AS probability,
    'derived' AS source
FROM candidates
