#!/usr/bin/env node
/**
 * gen_biome_ts.js
 * Generates biome_timeseries.json from animation_frames.json + biomes.json
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(
  __dirname,
  "..",
  "frontend",
  "public",
  "data"
);

// Load source files
const frames_data = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "animation_frames.json"), "utf8")
);
const biomes = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "biomes.json"), "utf8")
);

const { species, frames } = frames_data;

// Build biome catalog: biome_id → { name, carrying_capacity, speciesIndices[] }
const biomeMap = new Map();
for (const b of biomes) {
  biomeMap.set(b.id, {
    name: b.name,
    capacity: b.carrying_capacity,
    speciesIndices: [],
  });
}

// Map each species index to its biome
for (let i = 0; i < species.length; i++) {
  const entry = biomeMap.get(species[i].biome_id);
  if (entry) {
    entry.speciesIndices.push(i);
  }
}

// Ordered biome list (sorted by id)
const biomeIds = [...biomeMap.keys()].sort((a, b) => a - b);
const biomeNames = biomeIds.map((id) => biomeMap.get(id).name);

// Prepare output arrays: one sub-array per biome
const ticks = [];
const population = biomeIds.map(() => []);
const avg_food = biomeIds.map(() => []);
const species_count = biomeIds.map(() => []);
const events = [];

let prevSeason = null;

for (const frame of frames) {
  const { tick, season, populations } = frame;
  ticks.push(tick);

  // Detect season change
  if (prevSeason !== null && season !== prevSeason) {
    events.push({ tick, type: "season_change", season });
  }
  prevSeason = season;

  // Aggregate per biome
  for (let bi = 0; bi < biomeIds.length; bi++) {
    const biomeId = biomeIds[bi];
    const info = biomeMap.get(biomeId);
    let pop = 0;
    let alive = 0;

    for (const idx of info.speciesIndices) {
      const p = populations[idx];
      if (p > 0) {
        pop += p;
        alive++;
      }
    }

    population[bi].push(pop);
    species_count[bi].push(alive);
    // Approximate food availability
    const food = Math.max(0, 1 - (pop / info.capacity) * 0.5);
    avg_food[bi].push(Math.round(food * 1000) / 1000); // 3 decimal places
  }
}

const output = {
  biome_ids: biomeIds,
  biome_names: biomeNames,
  ticks,
  population,
  avg_food,
  species_count,
  events,
};

const outPath = path.join(DATA_DIR, "biome_timeseries.json");
fs.writeFileSync(outPath, JSON.stringify(output));
console.log(`Wrote ${outPath}`);
console.log(`  biomes: ${biomeIds.length}, ticks: ${ticks.length}, events: ${events.length}`);
