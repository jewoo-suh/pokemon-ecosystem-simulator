-- =============================================================
-- Derived Trophic Levels
-- Assigns every Pokemon an ecological role based on type,
-- legendary status, and base stat total.
-- =============================================================

WITH primary_types AS (
    SELECT
        pt.pokemon_id,
        t.name AS primary_type
    FROM {{ source('public', 'pokemon_types') }} pt
    JOIN {{ source('public', 'types') }} t ON pt.type_id = t.id
    WHERE pt.slot = 1
),

has_prey AS (
    SELECT DISTINCT predator_id AS pokemon_id
    FROM {{ source('public', 'food_chain') }}
),

pokemon_stats AS (
    SELECT
        id,
        name,
        (hp + attack + defense + sp_attack + sp_defense + speed) AS bst,
        attack,
        is_legendary,
        is_mythical
    FROM {{ source('public', 'pokemon') }}
)

SELECT
    ps.id AS pokemon_id,

    CASE
        WHEN pt.primary_type = 'grass' THEN 'producer'
        WHEN pt.primary_type IN ('ghost', 'poison') AND ps.attack < 80 THEN 'decomposer'
        WHEN ps.is_legendary OR ps.is_mythical THEN 'apex_predator'
        WHEN ps.bst >= 580 THEN 'apex_predator'
        WHEN hp.pokemon_id IS NOT NULL THEN 'secondary_consumer'
        WHEN ps.attack >= 100 THEN 'secondary_consumer'
        ELSE 'primary_consumer'
    END AS level,

    'derived' AS source

FROM pokemon_stats ps
JOIN primary_types pt ON ps.id = pt.pokemon_id
LEFT JOIN has_prey hp ON ps.id = hp.pokemon_id
