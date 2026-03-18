-- =============================================================
-- 006: Type-biome affinity
-- Each type has an affinity multiplier per biome.
-- Rock types thrive in caves, water types in the sea, etc.
-- Combined with biome biomass: effective_biomass = biomass_factor * type_affinity
-- Default affinity is 1.0 (neutral).
-- =============================================================

CREATE TABLE IF NOT EXISTS type_biome_affinity (
    type_id     INT REFERENCES types(id),
    biome_id    INT REFERENCES biomes(id),
    affinity    NUMERIC(3,2) NOT NULL DEFAULT 1.0,
    PRIMARY KEY (type_id, biome_id)
);

-- Also moderate biomass values (less extreme now that type affinity adds differentiation)
UPDATE biomes SET biomass_factor = CASE name
    WHEN 'forest' THEN 1.3
    WHEN 'grassland' THEN 1.2
    WHEN 'waters-edge' THEN 1.1
    WHEN 'sea' THEN 1.0
    WHEN 'rare' THEN 0.9
    WHEN 'mountain' THEN 0.8
    WHEN 'rough-terrain' THEN 0.7
    WHEN 'urban' THEN 0.6
    WHEN 'cave' THEN 0.5
    ELSE 1.0
END;

-- ============================================================
-- Type affinities per biome
-- >1.0 = thrives here, <1.0 = uncomfortable, 1.0 = neutral
-- Only non-1.0 values are inserted (1.0 is the default)
-- ============================================================

-- CAVE (id=1): rock, ground, dark, ghost, steel thrive; grass, flying, water struggle
INSERT INTO type_biome_affinity (type_id, biome_id, affinity) VALUES
    (6,  1, 1.60),  -- rock
    (5,  1, 1.40),  -- ground
    (17, 1, 1.40),  -- dark
    (8,  1, 1.30),  -- ghost
    (9,  1, 1.20),  -- steel
    (12, 1, 0.60),  -- grass
    (3,  1, 0.60),  -- flying
    (11, 1, 0.70),  -- water
    (10, 1, 0.80);  -- fire

-- FOREST (id=2): bug, grass, fairy, poison, normal thrive; rock, ice struggle
INSERT INTO type_biome_affinity (type_id, biome_id, affinity) VALUES
    (7,  2, 1.50),  -- bug
    (12, 2, 1.40),  -- grass
    (18, 2, 1.30),  -- fairy
    (4,  2, 1.20),  -- poison
    (1,  2, 1.20),  -- normal
    (6,  2, 0.80),  -- rock
    (15, 2, 0.70);  -- ice

-- GRASSLAND (id=3): normal, ground, grass, electric, fighting, flying thrive
INSERT INTO type_biome_affinity (type_id, biome_id, affinity) VALUES
    (1,  3, 1.40),  -- normal
    (5,  3, 1.30),  -- ground
    (12, 3, 1.30),  -- grass
    (13, 3, 1.20),  -- electric
    (2,  3, 1.20),  -- fighting
    (3,  3, 1.20);  -- flying

-- MOUNTAIN (id=4): rock, flying, ice, dragon, ground thrive; water struggles
INSERT INTO type_biome_affinity (type_id, biome_id, affinity) VALUES
    (6,  4, 1.50),  -- rock
    (3,  4, 1.40),  -- flying
    (15, 4, 1.30),  -- ice
    (16, 4, 1.30),  -- dragon
    (5,  4, 1.20),  -- ground
    (10, 4, 1.10),  -- fire
    (11, 4, 0.70);  -- water

-- RARE (id=5): dragon, psychic, fairy thrive (mystical environments)
INSERT INTO type_biome_affinity (type_id, biome_id, affinity) VALUES
    (16, 5, 1.40),  -- dragon
    (14, 5, 1.30),  -- psychic
    (18, 5, 1.20);  -- fairy

-- ROUGH-TERRAIN (id=6): ground, rock, fighting, steel, dragon thrive; fairy struggles
INSERT INTO type_biome_affinity (type_id, biome_id, affinity) VALUES
    (5,  6, 1.40),  -- ground
    (6,  6, 1.30),  -- rock
    (2,  6, 1.30),  -- fighting
    (9,  6, 1.20),  -- steel
    (16, 6, 1.20),  -- dragon
    (18, 6, 0.70);  -- fairy

-- SEA (id=7): water thrives; fire, ground, rock struggle
INSERT INTO type_biome_affinity (type_id, biome_id, affinity) VALUES
    (11, 7, 1.60),  -- water
    (15, 7, 1.20),  -- ice
    (3,  7, 1.10),  -- flying
    (10, 7, 0.50),  -- fire
    (5,  7, 0.50),  -- ground
    (6,  7, 0.70);  -- rock

-- URBAN (id=8): electric, steel, normal, psychic, fighting thrive; grass struggles
INSERT INTO type_biome_affinity (type_id, biome_id, affinity) VALUES
    (13, 8, 1.40),  -- electric
    (9,  8, 1.30),  -- steel
    (1,  8, 1.30),  -- normal
    (14, 8, 1.20),  -- psychic
    (2,  8, 1.20),  -- fighting
    (4,  8, 1.10),  -- poison
    (12, 8, 0.70);  -- grass

-- WATERS-EDGE (id=9): water, grass, bug, ground, flying thrive
INSERT INTO type_biome_affinity (type_id, biome_id, affinity) VALUES
    (11, 9, 1.40),  -- water
    (12, 9, 1.20),  -- grass
    (7,  9, 1.20),  -- bug
    (5,  9, 1.10),  -- ground
    (3,  9, 1.10);  -- flying
