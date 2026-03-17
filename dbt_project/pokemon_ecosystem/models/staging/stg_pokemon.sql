-- Staging view over raw pokemon table
-- Source of truth from PokeAPI, not modified

SELECT
    id,
    pokeapi_id,
    name,
    hp,
    attack,
    defense,
    sp_attack,
    sp_defense,
    speed,
    height,
    weight,
    base_experience,
    hatch_counter,
    catch_rate,
    growth_rate,
    is_legendary,
    is_mythical,
    sprite_url,
    -- derived convenience fields
    (hp + attack + defense + sp_attack + sp_defense + speed) AS base_stat_total
FROM {{ source('public', 'pokemon') }}
