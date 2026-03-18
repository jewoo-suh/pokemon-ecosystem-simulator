-- =============================================================
-- 005: Biome biomass factor
-- Represents base vegetation/food availability per biome.
-- Forests are lush (1.5), caves are barren (0.4).
-- Affects grazing rates for herbivores and opportunistic feeders.
-- =============================================================

ALTER TABLE biomes ADD COLUMN IF NOT EXISTS biomass_factor NUMERIC(3,2) NOT NULL DEFAULT 1.0;

UPDATE biomes SET biomass_factor = CASE name
    WHEN 'forest' THEN 1.5
    WHEN 'grassland' THEN 1.3
    WHEN 'waters-edge' THEN 1.2
    WHEN 'sea' THEN 1.0
    WHEN 'rare' THEN 0.8
    WHEN 'mountain' THEN 0.7
    WHEN 'rough-terrain' THEN 0.6
    WHEN 'urban' THEN 0.5
    WHEN 'cave' THEN 0.4
    ELSE 1.0
END;
