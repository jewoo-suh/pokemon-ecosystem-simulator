-- =============================================================
-- Derived Default Habitats
-- Assigns biomes to Pokemon that have no habitat data in PokeAPI
-- (Gen 5+ Pokemon are missing habitat assignments)
--
-- Rules based on primary type:
--   water       -> sea, waters-edge
--   fire        -> mountain, rough-terrain
--   grass/bug   -> forest, grassland
--   rock/ground -> mountain, cave, rough-terrain
--   ice         -> mountain, cave
--   ghost/dark  -> cave, urban
--   electric    -> urban, grassland
--   steel       -> cave, mountain
--   fairy       -> forest, urban
--   psychic     -> urban, grassland
--   dragon      -> mountain, rough-terrain
--   flying      -> forest, grassland, mountain
--   fighting    -> urban, rough-terrain
--   normal      -> grassland, urban, forest
--   poison      -> urban, forest
-- =============================================================

{{ config(materialized='table') }}

WITH pokemon_missing_habitat AS (
    SELECT p.id AS pokemon_id
    FROM {{ source('public', 'pokemon') }} p
    LEFT JOIN {{ source('public', 'pokemon_habitats') }} ph ON p.id = ph.pokemon_id
    WHERE ph.pokemon_id IS NULL
),

primary_types AS (
    SELECT pt.pokemon_id, t.name AS type_name
    FROM {{ source('public', 'pokemon_types') }} pt
    JOIN {{ source('public', 'types') }} t ON pt.type_id = t.id
    WHERE pt.slot = 1
),

biome_ids AS (
    SELECT id, name FROM {{ source('public', 'biomes') }}
),

type_to_biome (type_name, biome_name, affinity) AS (
    VALUES
        ('water',    'sea',             1.0),
        ('water',    'waters-edge',     0.8),
        ('fire',     'mountain',        0.9),
        ('fire',     'rough-terrain',   0.7),
        ('grass',    'forest',          1.0),
        ('grass',    'grassland',       0.8),
        ('bug',      'forest',          1.0),
        ('bug',      'grassland',       0.7),
        ('rock',     'mountain',        0.9),
        ('rock',     'cave',            0.8),
        ('rock',     'rough-terrain',   0.7),
        ('ground',   'mountain',        0.8),
        ('ground',   'cave',            0.7),
        ('ground',   'rough-terrain',   0.9),
        ('ice',      'mountain',        0.9),
        ('ice',      'cave',            0.7),
        ('ghost',    'cave',            0.9),
        ('ghost',    'urban',           0.7),
        ('dark',     'cave',            0.9),
        ('dark',     'urban',           0.7),
        ('electric', 'urban',           0.9),
        ('electric', 'grassland',       0.7),
        ('steel',    'cave',            0.9),
        ('steel',    'mountain',        0.8),
        ('fairy',    'forest',          0.9),
        ('fairy',    'urban',           0.7),
        ('psychic',  'urban',           0.9),
        ('psychic',  'grassland',       0.7),
        ('dragon',   'mountain',        0.9),
        ('dragon',   'rough-terrain',   0.8),
        ('flying',   'forest',          0.8),
        ('flying',   'grassland',       0.8),
        ('flying',   'mountain',        0.7),
        ('fighting', 'urban',           0.9),
        ('fighting', 'rough-terrain',   0.8),
        ('normal',   'grassland',       0.9),
        ('normal',   'urban',           0.8),
        ('normal',   'forest',          0.7),
        ('poison',   'urban',           0.8),
        ('poison',   'forest',          0.7)
)

SELECT
    pmh.pokemon_id,
    b.id AS biome_id,
    ttb.affinity::NUMERIC(3,2) AS affinity
FROM pokemon_missing_habitat pmh
JOIN primary_types pt ON pmh.pokemon_id = pt.pokemon_id
JOIN type_to_biome ttb ON pt.type_name = ttb.type_name
JOIN biome_ids b ON ttb.biome_name = b.name
