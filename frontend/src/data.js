/**
 * Data loader — works in both modes:
 *   - Development: fetches from local API (http://localhost:8000)
 *   - Production (GitHub Pages): loads from static JSON in /data/
 *
 * Detects mode automatically: if the API is unreachable, falls back to static files.
 */

const API = 'http://localhost:8000';
const STATIC = import.meta.env.BASE_URL + 'data';

let useStatic = null; // null = not yet determined

async function detectMode() {
  if (useStatic !== null) return;

  // On GitHub Pages (or any non-localhost), always use static
  if (typeof window !== 'undefined' && !window.location.hostname.includes('localhost')) {
    useStatic = true;
    console.log('[data] Static mode (not localhost)');
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${API}/simulation/status`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      useStatic = false;
      console.log('[data] Using live API');
      return;
    }
  } catch (e) {
    // API not available
  }
  useStatic = true;
  console.log('[data] Using static JSON files');
}

async function fetchData(apiPath, staticFile) {
  await detectMode();
  if (useStatic) {
    const res = await fetch(`${STATIC}/${staticFile}`);
    return res.json();
  } else {
    const res = await fetch(`${API}${apiPath}`);
    return res.json();
  }
}

// ---- Public API ----

export async function getMap() {
  return fetchData('/simulation/map', 'simulation_map.json');
}

export async function getStatus() {
  return fetchData('/simulation/status', 'simulation_status.json');
}

export async function getBiomes() {
  return fetchData('/biomes', 'biomes.json');
}

export async function getBiomeDetail(biomeId) {
  await detectMode();
  if (useStatic) {
    // All biome details are in one file
    const res = await fetch(`${STATIC}/biome_details.json`);
    const all = await res.json();
    return all[String(biomeId)];
  } else {
    const res = await fetch(`${API}/biomes/${biomeId}`);
    return res.json();
  }
}

// Cached version: load all biome details at once
let biomeDetailsCache = null;
export async function getAllBiomeDetails() {
  await detectMode();
  if (useStatic) {
    if (!biomeDetailsCache) {
      const res = await fetch(`${STATIC}/biome_details.json`);
      biomeDetailsCache = await res.json();
    }
    return Object.values(biomeDetailsCache);
  } else {
    const biomes = await getBiomes();
    const details = await Promise.all(biomes.map(b => getBiomeDetail(b.id)));
    return details;
  }
}

export async function getFoodChain() {
  return fetchData('/food-chain?limit=5000', 'food_chain.json');
}

export async function getStatsOverview() {
  return fetchData('/stats/overview', 'stats_overview.json');
}

export async function getStatsTrophic() {
  return fetchData('/stats/trophic', 'stats_trophic.json');
}

export async function getSpeciesDetail(pokemonId) {
  await detectMode();
  if (useStatic) {
    const res = await fetch(`${STATIC}/species.json`);
    const all = await res.json();
    return all[String(pokemonId)];
  } else {
    const res = await fetch(`${API}/species/${pokemonId}`);
    return res.json();
  }
}

export async function runAnimationFrames(ticks) {
  await detectMode();
  if (useStatic) {
    // Load pre-recorded frames
    const res = await fetch(`${STATIC}/animation_frames.json`);
    return res.json();
  } else {
    const res = await fetch(`${API}/simulation/run-frames?ticks=${ticks}`, { method: 'POST' });
    return res.json();
  }
}

export async function getEvents() {
  await detectMode();
  if (useStatic) {
    try {
      const res = await fetch(`${STATIC}/animation_events.json`);
      if (!res.ok) return [];
      return res.json();
    } catch {
      return [];
    }
  } else {
    try {
      const res = await fetch(`${API}/simulation/events`);
      if (!res.ok) return [];
      return res.json();
    } catch {
      return [];
    }
  }
}

export async function getBiomeTimeseries() {
  await detectMode();
  if (useStatic) {
    try {
      const res = await fetch(`${STATIC}/biome_timeseries.json`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  } else {
    // No API endpoint for this — always use static
    try {
      const res = await fetch(`${STATIC}/biome_timeseries.json`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }
}

export function isStaticMode() {
  return useStatic === true;
}

// ---- Additional loaders for Species tab (always static; cached) ----

let allSpeciesCache = null;
export async function getAllSpecies() {
  if (allSpeciesCache) return allSpeciesCache;
  const res = await fetch(`${STATIC}/species.json`);
  allSpeciesCache = await res.json();
  return allSpeciesCache;
}

let typeEffectivenessCache = null;
export async function getTypeEffectiveness() {
  if (typeEffectivenessCache) return typeEffectivenessCache;
  const res = await fetch(`${STATIC}/type_effectiveness.json`);
  typeEffectivenessCache = await res.json();
  return typeEffectivenessCache;
}

let typeBiomeAffinityCache = null;
export async function getTypeBiomeAffinity() {
  if (typeBiomeAffinityCache) return typeBiomeAffinityCache;
  const res = await fetch(`${STATIC}/type_biome_affinity.json`);
  typeBiomeAffinityCache = await res.json();
  return typeBiomeAffinityCache;
}

let evolutionChainsCache = null;
export async function getEvolutionChains() {
  if (evolutionChainsCache) return evolutionChainsCache;
  const res = await fetch(`${STATIC}/evolution_chains.json`);
  evolutionChainsCache = await res.json();
  return evolutionChainsCache;
}

let animationFramesCache = null;
export async function getAllAnimationFrames() {
  if (animationFramesCache) return animationFramesCache;
  const res = await fetch(`${STATIC}/animation_frames.json`);
  animationFramesCache = await res.json();
  return animationFramesCache;
}

// Aggregate per-species population timelines across all biomes.
// Heavy: ~14M ops on first call, then cached.
let speciesTimelineCache = null;
export async function getSpeciesTimeline() {
  if (speciesTimelineCache) return speciesTimelineCache;
  const data = await getAllAnimationFrames();
  if (!data) return { timeline: {}, biomesBySpecies: {}, ticks: [] };

  const speciesMeta = data.species;
  const frames = data.frames;
  const numFrames = frames.length;
  const ticks = new Array(numFrames);
  const perSpecies = {};
  const biomesMap = {};

  const uniqueIds = new Set();
  for (const sm of speciesMeta) {
    uniqueIds.add(sm.id);
    if (!biomesMap[sm.id]) biomesMap[sm.id] = new Set();
    biomesMap[sm.id].add(sm.biome_id);
  }
  for (const id of uniqueIds) perSpecies[id] = new Int32Array(numFrames);

  for (let fi = 0; fi < numFrames; fi++) {
    const f = frames[fi];
    ticks[fi] = f.tick;
    const pops = f.populations;
    for (let ei = 0; ei < pops.length; ei++) {
      const sid = speciesMeta[ei].id;
      perSpecies[sid][fi] += pops[ei];
    }
  }

  const out = {};
  for (const id of uniqueIds) {
    const arr = perSpecies[id];
    let peak = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] > peak) peak = arr[i];
    out[id] = { ticks, pops: Array.from(arr), peak, latest: arr[arr.length - 1] };
  }

  speciesTimelineCache = { timeline: out, biomesBySpecies: biomesMap, ticks };
  return speciesTimelineCache;
}
