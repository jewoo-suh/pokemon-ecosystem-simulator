-- Pokemon-type relationships with type names joined in

SELECT
    pt.pokemon_id,
    pt.type_id,
    pt.slot,
    t.name AS type_name
FROM {{ source('public', 'pokemon_types') }} pt
JOIN {{ source('public', 'types') }} t ON pt.type_id = t.id
