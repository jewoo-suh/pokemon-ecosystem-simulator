# Development Log

## 2026-03-16 — Project Kickoff & Data Model Design

### What happened
- Pivoted from Pokemon Card Price Forecaster to Pokemon Ecosystem Simulator
- Designed full data model across 3 migration files
- Set up project directory structure

### Decisions made
- **Split storage:** PostgreSQL for entities/relationships, TimescaleDB for time-series population data
- **Raw vs derived separation:** `pokemon` table holds immutable PokeAPI data; `pokemon_sim_params` holds recomputable derived simulation parameters
- **Tiered food chain strategy:** 88 canon predator-prey pairs from Bulbapedia + type-derived rules, each tagged with data lineage (`canon` vs `derived`)
- **Trophic levels:** Every Pokemon assigned an ecological role (producer → apex predator) so all 1000+ species participate in the simulation
- **Simulation config as DB table:** Tuning knobs stored in `simulation_config` so balancing adjustments don't require code changes
- **dbt for transformations:** Will use dbt to derive sim params from raw stats and generate food chain rules

### Files created
- `db/migrations/001_core_entities.sql` — Pokemon, types, type effectiveness, biomes, evolution chains
- `db/migrations/002_food_chain_and_simulation.sql` — Food chain, trophic levels, sim params, config
- `db/migrations/003_timeseries.sql` — Population snapshots + ecosystem events (TimescaleDB hypertables) + continuous aggregates
- `README.md` — Updated for ecosystem simulator concept

### Next steps
- Build data loader service (ingest from PokeAPI + scrape Bulbapedia predation data)
- Set up dbt project for deriving sim params and food chain rules

---

## 2026-03-16 — Data Ingestion Complete

### What happened
- Built PokeAPI data loader with concurrent fetching (10 threads, 18.6s for all data)
- Built Bulbapedia predation scraper (parses HTML tables for canon food chain data)
- Pulled all raw data successfully

### Data pulled
| Source | Data | Count |
|---|---|---|
| PokeAPI | Types | 18 |
| PokeAPI | Pokemon (full stat blocks) | 1,025 |
| PokeAPI | Species (habitat, hatch, catch rate) | 1,025 |
| PokeAPI | Evolution Chains | 541 |
| PokeAPI | Habitats | 9 |
| Bulbapedia | Canon predation pairs | 150 (100 predator-prey, 36 rival, 14 parasite) |

### Decisions made
- **Concurrent fetching over sequential:** Switched from sequential requests (15+ min) to ThreadPoolExecutor with 10 workers (18.6s). PokeAPI is cacheable and handles concurrency well.
- **Bulbapedia scraper parses tables directly:** The predation page uses structured HTML tables (Predator | Prey | Entry). Parsing table rows is more reliable than keyword-based text extraction.
- **150 canon pairs exceeds expectations:** Originally estimated 88 pairs. The page also has rival and parasite-host tables, giving us richer relationship data for the simulation.
- **Raw JSON files as intermediate format:** Data saved as JSON before DB loading. Allows re-loading without re-fetching, and serves as a cache during development.

### Files created
- `services/data_loader/pokeapi_loader.py` — Concurrent PokeAPI fetcher
- `services/data_loader/bulbapedia_scraper.py` — Predation table scraper
- `services/data_loader/config.py` — Shared configuration
- `services/data_loader/requirements.txt` — Python dependencies
- `services/data_loader/data/*.json` — Raw data files (gitignored)

### Next steps
- Set up dbt project for deriving sim params and food chain rules
- Build DB loader to insert raw JSON into PostgreSQL
- Derive trophic levels and type-based food chain pairs

---

## 2026-03-16 — DB Loading, dbt Transformations & Simulation Engine

### What happened
- Built DB loader to insert raw JSON into PostgreSQL tables
- Set up dbt project with staging + derived models
- Fixed simulation parameter formulas to use `GREATEST(attack, sp_attack)` for hunt_power and `GREATEST(defense, sp_defense)` for escape_power (fairness for special attackers/defenders)
- Created `derived_default_habitats` model to assign biomes to 640+ Gen 5+ Pokemon missing habitat data
- Added migration 004 for simulation state table (mutable "whiteboard")
- Built simulation engine with 8-phase tick loop
- Implemented legendary/mythical immortality (94 Pokemon)

### Simulation Engine Phases (per tick)
1. Producer food regeneration
2. Metabolism (hunger drain, legendaries exempt)
3. Predation (hunt_power vs escape_power, legendaries can't be hunted)
4. Mortality + starvation (legendaries immortal)
5. Reproduction (legendaries don't reproduce)
6. Evolution (per-individual chance, requires stability + food)
7. Migration (speed-based, fraction of population moves between biomes)
8. Stability counter updates

### Decisions made
- **GREATEST() for combat stats:** Using `GREATEST(attack, sp_attack)` for hunt_power ensures special attackers like Gardevoir (125 SpAtk) aren't undersold. Same pattern for escape_power and natural_mortality.
- **Type-based default habitats:** Gen 5+ Pokemon had no PokeAPI habitat data. Created type-to-biome mapping (e.g., water->sea, fire->mountain) expanding connected Pokemon from 382 to 856.
- **Legendary immortality:** Legendaries/mythicals don't starve, can't be hunted, don't die, don't reproduce. They're eternal forces of nature.
- **Per-individual evolution:** Small probability per individual per tick (base_evolution_rate = 0.02), not mass evolution. Requires stability and food satiation.
- **TimescaleDB deferred:** Using plain PostgreSQL for now since TimescaleDB requires Docker (needs system restart). Hypertable calls commented out.
- **Simulation state as "whiteboard":** `simulation_state` table is mutable (read/write each tick), while `population_snapshots` is append-only history.

### Files created/modified
- `services/data_loader/db_loader.py` — Loads raw JSON into PostgreSQL
- `dbt_project/pokemon_ecosystem/models/staging/` — stg_pokemon.sql, stg_pokemon_types.sql, sources.yml
- `dbt_project/pokemon_ecosystem/models/derived/` — derived_sim_params.sql, derived_trophic_levels.sql, derived_food_chain.sql, derived_default_habitats.sql
- `db/migrations/004_simulation_state.sql` — Simulation state + metadata tables
- `services/simulation/engine.py` — Core simulation engine (8-phase tick loop)
- `services/simulation/run.py` — CLI runner (`python run.py 50 --fresh`)
- `services/simulation/config.py` — DB connection config

### Test run results (50 ticks, --fresh)
- 856 species-biome pairs initialized
- 0 legendary extinctions (immortality working)
- Gardevoir thriving: pop 41+13 across biomes, food_satiation 0.93-0.96
- Mewtwo surviving: pop 2+8, food_satiation 0.70-1.0
- Rayquaza stable: pop 5+2

### Next steps
- Build FastAPI REST layer
- Docker Compose orchestration
- Phase 2: Frontend visualization with time scrubbing

---

## 2026-03-17 — Biodiversity Mechanics & Simulation Tuning

### Problem
The simulation converged to a winner-take-all state within 500 ticks. 9 species (Rattata, Caterpie, etc.) filled entire biomes to carrying capacity (~10K each), driving 75% of species extinct. Total population hit 96K but only 165 species survived.

### Root cause
1. **No per-species density limits** — a single species could fill an entire biome
2. **Reproduction only checked total biome cap** — no intraspecific competition
3. **Predators didn't focus on abundant prey** — rare and common prey hunted equally

### Three new mechanics added

**1. Logistic Growth (Reproduction)**
- Each species has a "niche share" = biome_capacity / num_species_in_biome
- Reproduction rate drops as species approaches 3x its niche share
- `growth_factor = max(0.0, 1.0 - population / (niche * 3))`

**2. Intraspecific Competition (Mortality)**
- Species occupying >25% of a biome face extra mortality from disease/territorial pressure
- Penalty scales with dominance: `1.0 + ((share - 0.25) / 0.75)^0.7 * 2.0`
- Prevents any single species from monopolizing a biome

**3. Prey-Switching (Predation)**
- Predators encounter abundant prey more frequently
- Abundance multiplier: `1.0 + (prey_share * 5.0)`
- Species at 10% of biome get hunted ~1.5x more; at 50% get hunted ~3.5x more
- Acts as natural population control on dominant species

### Tuning iterations
| Version | Living species | Total pop | Max species | Notes |
|---|---|---|---|---|
| v1 (no biodiversity) | 165 | 96,664 | 11,433 | Winner-take-all |
| v2 (15% threshold) | 427 | 27,822 | 580 | Too aggressive, pop declining |
| v3 (25% threshold, 3x niche) | **412** | **66,838** | **1,582** | Balanced |

### Also fixed
- `RuntimeError: dictionary changed size during iteration` in evolution phase — collected pending evolutions into a list before applying

### Results (500 ticks, v3)
- 412 living species (vs 165 before)
- Max species pop 1,582 (Stunfisk) vs 11,433 (Rattata)
- Top species is only 2.4% of total population (vs 11.8%)
- Biomes hold 5-10K each with 44-125 species per biome
- Pikachu: 301 pop, Gardevoir: 30 pop, Mewtwo/Rayquaza: immortal
- Population slowly declining (80K→67K) — may need more ticks to stabilize

---

## 2026-03-17 — Food Chain Realism & Predation Balance

### Problem
Caterpie (BST 195) was listed as a predator of Torterra (BST 525). The derived food chain only checked type effectiveness + trophic level, not actual combat power. Grass types had 115-118 predators each because every fire/ice/flying/poison/bug Pokemon counted as a predator.

### Root cause analysis
Queried alive vs extinct species and found the smoking gun:
- Alive species: avg 6.6 predator threats
- Extinct species: avg 31.1 predator threats
- Stats (repro, metabolism, BST) were nearly identical — the difference was purely food chain connectivity

### Fixes applied

**1. BST Power Gate (dbt model)**
- Predator must have ≥60% of prey's BST to hunt it
- Caterpie (195) vs Torterra (525): 195/525 = 0.37 < 0.60 → blocked
- Butterfree (395) vs Oddish (320): 395/320 = 1.23 > 0.60 → allowed
- Probability now scales with power ratio instead of flat 0.3

**2. Predation Saturation (engine)**
- Prey can only lose up to 30% of starting population per tick across ALL predators
- Models finite hunting hours — prey flee/hide after sustained attacks

**3. Predator Dilution (engine)**
- Species with 10+ predators: each predator's success rate is diluted
- 115 predators → each is ~9% as effective (predators interfere with each other)

**4. Prey-Pressure Breeding (engine)**
- Species with 10+ predators get up to 2x reproduction rate
- Models evolutionary pressure: heavily hunted species become prolific breeders

### Results (1000 ticks)
| Metric | Before fixes | After fixes |
|---|---|---|
| Living species | 165 | **375** |
| Total population | 96K | **68K** |
| Food chain pairs | 23,987 | **22,033** |
| Caterpie eats Torterra | Yes | **No** |
| Torterra population | extinct | **318 (food 0.98)** |
| Pikachu population | extinct | **307** |

---

## 2026-03-17 — Base-Form Reproduction, Grazing & Producer Resilience

### Problems fixed

**1. Gardevoir was cloning herself**
- Old: Gardevoir reproduces → more Gardevoirs (wrong)
- New: Gardevoir reproduces → **Ralts is born** (correct)
- Built `base_form` map by walking evolution chains backwards
- Babies inherit parent's biome, start at 0.8 food satiation

**2. 76% of herbivores had no food source**
- Primary consumers (482 species) had no prey in the food chain — they just starved
- Added **grazing mechanic**: herbivores passively feed on producer biomass in their biome
- Added **decomposer scavenging**: feed on dead organic matter (flat food gain)
- Secondary consumers/apex with no prey get a small scavenge bonus too

**3. Producers (grass types) dying at 88% rate**
- Only 12/103 producers survived — too many predators, not enough resilience
- Added **plant regrowth**: producers regenerate small population each tick (capped by biome capacity)
- Added **seed dispersal**: 2x base reproduction rate for producers
- Added **faster photosynthesis**: 0.15 food regen (up from 0.10)

### Results (1000 ticks)
| Metric | Before | After |
|---|---|---|
| Living species | 375 | **460** |
| Total population | 68K | **82K** |
| Producer survival | 12% | **39%** |
| Species-biome pairs | 621 (declining) | **870 (stable)** |
| Equilibrium reached? | No | **Yes (~tick 600)** |

Key survivors: Dratini 407, Rowlet 316, Riolu 283, Turtwig 258, Ralts 153, Bulbasaur 107, Eevee 67, Snorlax 42

### Next steps
- Build FastAPI REST layer
- Docker Compose orchestration
- Phase 2: Frontend visualization with time scrubbing

---

## 2026-03-17 — Performance Overhaul, Biome Biomass & Death Pool

### Problems fixed

**1. biome_total computed 6+ times per tick (O(n²) waste)**
- Every phase scanned all state entries to sum biome populations
- Pre-computed `biome_totals`, `biome_species_counts`, `biome_producer_pops` once at tick start
- Single O(n) pass replaces 6+ redundant O(n) scans

**2. Per-individual dice rolls (O(population) per event)**
- Predation, mortality, reproduction, and evolution all looped `for _ in range(pop)`
- Replaced with `_binomial()` helper: exact rolls for n<20, normal approximation for n≥20
- 1000 ticks: ~200s+ → **83s** (2.4x faster)

**3. Buggy metabolism scavenge formula**
- Old: `scavenge_bonus = 1.0 - (pop/20)*0.5; metabolism *= (1.0 - scavenge_bonus*0.5)` — convoluted double-reduction
- New: `metabolism *= 0.5 + 0.5 * (pop / 20.0)` — clean linear scale (pop 1 = 50% metabolism, pop 20+ = full)

**4. Grazing excluded bug herbivores with prey options**
- Bug types like Caterpie had food chain prey (grass types) but were too weak to actually catch them
- Old `has_prey` check excluded them from grazing → starvation
- Fixed: ALL primary consumers now graze regardless of prey options. Hunting is supplemental.

**5. "Free food" epidemic — decomposers and prey-less carnivores**
- Decomposers got flat +0.08/tick from nowhere
- Prey-less carnivores (Snorlax etc.) got flat +0.04/tick from nowhere
- **Decomposers now feed on death pool**: total predation kills + mortality deaths per biome, shared among all decomposers. No deaths = no food.
- **Prey-less carnivores now forage opportunistically**: 30% of herbivore grazing rate, scaled by biome biomass. Snorlax in a forest finds berries; Snorlax on a mountain starves.

**6. Biome biomass factor (new mechanic)**
- Each biome has a biomass multiplier affecting grazing/foraging rates
- Forest (1.5), grassland (1.3), waters-edge (1.2), sea (1.0), rare (0.8), mountain (0.7), rough-terrain (0.6), urban (0.5), cave (0.4)
- Creates real biome differentiation: lush biomes sustain more herbivores, harsh biomes are survival challenges
- Added `biomass_factor` column to biomes table (migration 005)

### Results (1000 ticks)
| Metric | Before (v9) | After (v10) |
|---|---|---|
| Living species | 460 | **495** |
| Total pop | 82K | **78K** |
| Species-biome pairs | 870 | **922** |
| Performance (1000 ticks) | ~200s+ | **83s** |
| Snorlax (forest) food | 1.0 (free) | 1.0 (earned — foraging) |
| Snorlax (mountain) food | 1.0 (free) | 0.0 (starving — harsh biome) |
| Eevee (cave) food | 1.0 | 0.50 (cave is harsh) |

### Files created/modified
- `services/simulation/engine.py` — All 6 fixes above
- `db/migrations/005_biome_biomass.sql` — Biome biomass factor column

---

## 2026-03-17 — Type-Biome Affinity (Habitat Specialization)

### Problem
Biome biomass alone made caves universally terrible and forests universally great. A Rock Pokemon adapted to caves shouldn't struggle as much as a Grass type there.

### Solution: Type-biome affinity multiplier
- 56 type-biome affinity entries (18 types × 9 biomes, only non-1.0 stored)
- Effective biomass = `biome_biomass × type_affinity`
- Rock in cave: `0.5 × 1.6 = 0.80` (adapted), Grass in cave: `0.5 × 0.6 = 0.30` (struggling)
- Bug in forest: `1.3 × 1.5 = 1.95` (thriving), Ice in forest: `1.3 × 0.7 = 0.91` (uncomfortable)
- Also moderated base biomass range: 0.5-1.3 (was 0.4-1.5)

### Key affinities
| Biome | Thrives | Struggles |
|---|---|---|
| Cave | rock 1.6, ground 1.4, dark 1.4, ghost 1.3 | grass 0.6, flying 0.6 |
| Forest | bug 1.5, grass 1.4, fairy 1.3, normal 1.2 | ice 0.7, rock 0.8 |
| Sea | water 1.6, ice 1.2 | fire 0.5, ground 0.5 |
| Mountain | rock 1.5, flying 1.4, ice 1.3, dragon 1.3 | water 0.7 |
| Urban | electric 1.4, steel 1.3, normal 1.3 | grass 0.7 |

### Results (1000 ticks)
- Cave: Dark types dominate (2691 pop), ghost types thrive (1647), rock/ground solid — no grass types survive
- Forest: Grass dominates (7401 pop), bugs thrive (615), fairy/normal do well
- Each biome has distinct type composition — real ecological niches

### Files created/modified
- `db/migrations/006_type_biome_affinity.sql` — Type-biome affinity table + data
- `services/simulation/engine.py` — Load type affinity, compute effective biomass

---

## 2026-03-17 — Global Time Scale & Final Tuning (v11)

### Problem
48% extinction rate at 1000 ticks was too aggressive. Small populations would get 2-3 bad rolls in a row and spiral to 0 before recovering. Per-tick rates (metabolism, mortality, predation) made each tick too volatile.

### Solution: Global time scale factor
- Added `time_scale` config parameter (stored in `simulation_config`)
- Scales metabolism, mortality, and predation encounter chance per tick
- Reproduction left unscaled so species can recover
- Effectively makes each tick a shorter time unit — less happens per tick, fewer death spirals

### Tuning
| time_scale | Living species | Survival rate | Pikachu | Eevee | Greninja |
|---|---|---|---|---|---|
| 1.0 | 493 | 48% | extinct | 71 | extinct |
| 0.5 | 635 | 62% | 12 | 98 | extinct |
| **0.3** | **840** | **82%** | **39** | **504** | **1** |

### Final results (time_scale = 0.3, 1000 ticks)
- **840 / 1025 species alive (82% survival)**
- **84K total population** across 1432 species-biome pairs
- Equilibrium still not fully reached at tick 1000 — gradual competitive exclusion ongoing
- Trophic pyramid healthy: 282 primary consumers (52K), 130 secondary (17K), 103 producers (10K), 92 apex (941), 28 decomposers (3K)

### Key species
| Pokemon | Pop | Biomes | Notes |
|---|---|---|---|
| Eevee | 504 | 5 biomes | Ultimate generalist |
| Magikarp | 261 | waters-edge | Water type thriving |
| Geodude | 167 | mountain | Rock type at home |
| Gastly | 154 | cave | Ghost in the dark |
| Ralts | 141 | urban, grassland | Psychic city dweller |
| Bulbasaur | 100 | grassland | Producer, full food |
| Rattata | 56 | grassland | Normal type recovered |
| Pikachu | 39 | forest | Electric mouse lives! |
| Snorlax | 23 | forest, mountain | Foraging for berries |
| Torterra | 18 | forest, grassland | Grass tank |
| Greninja | 1 | waters-edge | Barely hanging on |
| Mewtwo | 4 | rare | Immortal legend |
| Rayquaza | 4 | rare | Immortal legend |

### Files modified
- `services/simulation/engine.py` — Added `time_scale` config, applied to metabolism/mortality/predation
- `simulation_config` table — Added `time_scale = 0.3`

---

## 2026-03-17 — FastAPI REST Layer

### What happened
Built the full REST API layer using FastAPI + psycopg2. All endpoints tested and returning correct data.

### Architecture
- **FastAPI** with `uvicorn` — auto-generated interactive docs at `/docs`
- **psycopg2 connection pool** (SimpleConnectionPool, 5 max) with `RealDictCursor` for dict responses
- **6 route modules** under `services/api/routes/`
- **CORS enabled** for frontend dev

### Endpoints
| Method | Path | Description |
|---|---|---|
| GET | `/species` | List all species (filterable by trophic level, type) |
| GET | `/species/{id}` | Species detail with per-biome population breakdown |
| GET | `/biomes` | All biomes with population/species counts |
| GET | `/biomes/{id}` | Biome detail with species list and type breakdown |
| GET | `/population/species/{id}` | Population time series (supports `resolution`, `by_biome`) |
| GET | `/population/biome/{id}` | Biome population time series |
| GET | `/simulation/status` | Current tick, config, living species |
| POST | `/simulation/run?ticks=100` | Run N more ticks (blocks until done) |
| GET | `/simulation/events` | Ecosystem events (filterable) |
| GET | `/food-chain/{pokemon_id}` | Predators and prey for a species |
| GET | `/food-chain` | Full food chain graph (nodes + edges, filterable by biome) |
| GET | `/stats/overview` | Dashboard numbers (survival rate, top species/biome) |
| GET | `/stats/trophic` | Population by trophic level |

### How to run
```bash
cd services/api
uvicorn main:app --reload --port 8000
# Open http://localhost:8000/docs for interactive API explorer
```

### Files created
- `services/api/main.py` — App entry point, CORS, router registration
- `services/api/config.py` — DB connection config
- `services/api/db.py` — Connection pool + cursor context manager
- `services/api/requirements.txt` — FastAPI + uvicorn + psycopg2-binary
- `services/api/routes/species.py` — Species endpoints
- `services/api/routes/biomes.py` — Biome endpoints
- `services/api/routes/population.py` — Time series endpoints
- `services/api/routes/simulation.py` — Simulation control + events
- `services/api/routes/food_chain.py` — Food chain graph
- `services/api/routes/stats.py` — Aggregate stats

---

## 2026-03-17 — Perlin Noise Map & Spatial Migration

### What happened
Built a Perlin noise map generator that creates natural-looking terrain and derives biome adjacency for realistic migration. Migration is now spatial — Pokemon can only move between biomes that share a border on the map.

### Map generation
- **Layered simplex noise**: elevation (4 octaves) + moisture + urban noise
- **Island effect**: elevation drops near edges to create ocean borders
- **Biome assignment** from elevation × moisture:
  - Low elevation → sea → waters-edge (shoreline)
  - Mid elevation + high moisture → forest
  - Mid elevation + low moisture → grassland
  - High elevation → rough-terrain → mountain → cave (peaks)
  - Urban scattered in lowlands, rare near mountain peaks
- **Adjacency computed** from which biomes share borders on the grid
- Maps saved as JSON (frontend) + adjacency written to DB (engine)

### Biome distribution (seed 42, 200×200)
| Biome | Coverage | Adjacent to |
|---|---|---|
| forest | 26.9% | grassland, mountain, rare, urban, waters-edge |
| grassland | 24.1% | forest, mountain, rough-terrain, urban, waters-edge |
| sea | 13.4% | waters-edge |
| mountain | 9.7% | cave, forest, grassland, rare, rough-terrain |
| waters-edge | 8.6% | forest, grassland, sea |
| rough-terrain | 7.5% | grassland, mountain, urban |
| cave | 6.9% | mountain |
| urban | 2.0% | forest, grassland, rough-terrain |
| rare | 0.9% | forest, mountain |

### Modular design
- Maps stored as JSON in `services/map_generator/maps/`
- Each map has a seed — reproducible and swappable
- `python generate_map.py --seed 42` generates a new map
- Engine loads adjacency from DB — doesn't know which map made it
- To swap maps: generate new one → re-run simulation
- Frontend loads map via `GET /simulation/map`

### Migration update
- Old: Pokemon migrate to any biome they have habitat in (random teleportation)
- New: Pokemon only migrate to **adjacent biomes** on the map
- Fallback: if no adjacency data exists, all-to-all migration (backwards compatible)
- Sea Pokemon stay in the sea (only adjacent to waters-edge)
- Cave Pokemon can reach mountain but not directly to grassland

### Files created/modified
- `services/map_generator/generate_map.py` — Map generator with noise, adjacency, preview
- `services/map_generator/maps/map_seed_42.json` — Current map data
- `services/map_generator/maps/current_map.json` — Symlink for frontend
- `services/map_generator/requirements.txt` — opensimplex, numpy, pillow
- `services/simulation/engine.py` — Load adjacency, spatial migration
- `services/api/routes/simulation.py` — Added `GET /simulation/map` endpoint

---

## 2026-03-18 — Phase 1: 3D Visualization & Engine Optimization

### What happened
- Built React Three Fiber 3D isometric world (Monument Valley style)
- Terraced heightmap terrain with flat shading and pastel biome colors
- Low-poly biome decorations: trees (forests), rocks (mountains), crystals (caves), buildings (urban)
- Pokemon pixel art sprites from PokeAPI as billboard textures
- Agent behavior system: wandering, flocking (boids), predator-prey chase/flee
- Animated water, fog, warm directional lighting
- Timeline bar with simulation playback and animation frames
- Connected component biome splitting (9 types → 66 distinct regions)
- Numpy-vectorized engine: 2600ms/tick → 162ms/tick (16x speedup)
- Compact animation frame API (73MB → 2.8MB per 50 frames)

### Key technical decisions
- **Instanced rendering** for decorations and shadows (single draw call per type)
- **Spatial hash grid** for O(n) neighbor lookups in flocking/chase behaviors
- **Pre-computed local prey lists** per predator-biome pair (eliminated 31% wasted lookups)
- **Biome splitting via flood-fill**: disconnected regions of same biome type become separate DB entries with own carrying capacity, preventing cross-map predation
- **Elevation data in map JSON**: quantized to uint8 (326KB total) for 3D terrain mesh

### Files created
- `frontend/src/components/IsometricScene.jsx` — R3F Canvas wrapper with camera, lighting, fog
- `frontend/src/components/TerrainMesh.jsx` — Heightmap mesh with terraced elevation
- `frontend/src/components/BiomeDecorations.jsx` — Procedural low-poly props
- `frontend/src/components/PokemonSprites.jsx` — Billboard sprites with agent behaviors
- `frontend/src/components/BiomeMap.jsx` — 2D canvas fallback view
- `frontend/src/components/TimelineBar.jsx` — Playback controls with scrub bar
- `frontend/src/components/Sidebar.jsx` — Species detail panel

---

## 2026-03-18 — Phase 2: Seasons, Random Events & Diversity Indices

### What happened
- Added 4-season cycle (spring/summer/autumn/winter, 25 ticks each)
- Added random ecosystem events (drought, disease, fire, flood, bloom)
- Added ecological diversity indices (Shannon, Simpson, evenness, food web connectance)
- Ran 1000-tick (10-year) comparison: Phase 1 vs Phase 2

### Season mechanics
Each season modifies 7 simulation parameters:
- **Spring**: food_regen 1.5x, reproduction 1.5x, mortality 0.7x (breeding season)
- **Summer**: stable peak, food_regen 1.2x, low migration (settled)
- **Autumn**: food_regen 0.7x, migration 1.8x, predation 1.2x (preparing for winter)
- **Winter**: food_regen 0.3x, mortality 1.6x, reproduction 0.15x (harsh survival)

### Random events
~5% chance per tick, season-weighted:
- **Drought**: kills 30-50% producers in a biome, drops everyone's food
- **Disease**: kills 20-40% of the most populous species in a biome
- **Fire**: kills 15-30% of all species (producers hit harder)
- **Flood**: kills 10-20% of non-water species, water types benefit
- **Bloom**: boosts producers 30-60% in a biome

### Diversity indices
- **Shannon H'**: species diversity based on proportional abundance
- **Simpson 1-D**: probability two random individuals are different species
- **Evenness**: how equitably population is distributed (H/ln(S))
- **Food web connectance**: proportion of possible predator-prey links that are active

### 1000-tick comparison results

| Metric | Phase 1 (no seasons) | Phase 2 (seasons) |
|--------|---------------------|-------------------|
| Final Population | 195,150 | 182,601 |
| Species Alive | 956 (93.3%) | 954 (93.1%) |
| Shannon H' | 6.012 | **6.022** |
| Simpson 1-D | 0.9960 | **0.9964** |
| Evenness | 0.876 | **0.878** |
| Connectance | 0.0205 | 0.0200 |
| Stability (CV%) | 0.30% | 3.28% (seasonal) |
| Trend T800-1000 | +0.16% | +0.38% |

**Key findings:**
1. Both simulations stabilize by year 5-6 (~194k and ~190k respectively)
2. Phase 2 has higher biodiversity despite lower population — seasons prevent dominance
3. Producers healthier in Phase 2 (10.5% vs 9.0%) — spring blooms sustain food chain
4. Phase 2's 3.28% CV is seasonal heartbeat, not instability
5. 40 random events over 1000 ticks caused zero additional extinctions — ecosystem is resilient
6. **Verdict: Phase 2 is the better simulation** — more realistic, higher diversity, richer data

### Seasonal population patterns (Phase 2, years 6-10)
| Season | Avg Pop | Min | Max | Range |
|--------|---------|-----|-----|-------|
| Spring | 193,439 | 179,716 | 198,002 | 9.5% |
| Summer | 195,354 | 193,160 | 197,573 | 2.3% |
| Autumn | 194,053 | 192,964 | 196,163 | 1.6% |
| Winter | 182,020 | 173,338 | 194,389 | 11.6% |

### Files created/modified
- `services/simulation/engine.py` — Added `get_season()`, `_roll_random_event()`, `_apply_random_event()`, `compute_diversity_indices()`, season modifiers in all 7 phases
- `services/api/routes/stats.py` — Added `GET /stats/diversity` endpoint
- `services/api/routes/simulation.py` — Season info in animation frames
- `frontend/src/components/TimelineBar.jsx` — Season badge and year counter
- `db/` — Added drought/disease/fire/flood/bloom to event_type_enum

---

## 2026-03-18 — Phase 2: Hexagonal World & Visual Overhaul

### What happened
- Rebuilt terrain from smooth heightmap to floating hexagonal tiles
- World clipped to hexagonal boundary shape (no more rectangular edges)
- Added liquid glass material (meshPhysicalMaterial with clearcoat + glass overlay)
- Brightened and saturated the pastel color palette
- Fixed Pokemon sprite rendering (simplified from ref-based to state-based approach)
- Git version control: Phase 1 tagged, Phase 2 on separate branch

### Terrain overhaul
- Each grid cell → hexagonal tile with flat top, thin side band, bottom face
- Tiles float at terraced elevation levels (10 discrete steps)
- Hex offset rows (every other row shifts half a hex) for natural tessellation
- `isInsideHexWorld()` clips to hexagonal boundary using axial coordinate distance
- Side faces slightly darker + blue-shifted for glass depth effect
- Decorations and sprites filtered to only appear within hex boundary

### Color palette (bright pastels)
| Biome | Color |
|-------|-------|
| Sea | Bright sky blue (0.55, 0.78, 0.95) |
| Waters-edge | Vivid mint (0.60, 0.90, 0.85) |
| Forest | Bright green (0.50, 0.85, 0.50) |
| Grassland | Vivid lime (0.82, 0.92, 0.50) |
| Rough-terrain | Warm peach (0.88, 0.72, 0.55) |
| Mountain | Light lilac (0.88, 0.82, 0.88) |
| Cave | Rosy brown (0.70, 0.55, 0.50) |
| Urban | Bright lavender (0.85, 0.75, 0.92) |
| Rare | Bright gold (0.95, 0.88, 0.55) |

### Material: liquid glass
- `meshPhysicalMaterial` with `clearcoat: 0.8`, `roughness: 0.15`, `reflectivity: 0.5`
- Second transparent overlay mesh (`opacity: 0.06`, `clearcoat: 1.0`) for glass sheen
- Flat shading preserves geometric hex edges

### Pokemon sprite fix
- Original ref-based approach (`useRef` + `forwardRef` + `useFrame`) failed to trigger re-renders
- Replaced with simplified state-based component using `useState` + direct `<sprite>` rendering
- Sprites capped at 500 visible, retry logic for hex boundary placement

### 1000-tick comparison results
Full Phase 1 vs Phase 2 comparison over 10 simulated years confirmed:
- Phase 2 has higher Shannon diversity (6.02 vs 6.01)
- Phase 2 has better evenness (0.878 vs 0.876)
- Both stabilize by year 5-6 (~194k and ~190k respectively)
- Phase 2 seasonal oscillation: winter dips to ~182k, spring recovers to ~195k
- 40 random events (fires, floods, droughts, disease, blooms) caused zero additional extinctions

### Files created/modified
- `frontend/src/components/TerrainMesh.jsx` — Hex tile terrain with liquid glass material
- `frontend/src/components/PokemonSprites_debug.jsx` — Simplified working sprite renderer
- `frontend/src/components/IsometricScene.jsx` — Updated camera, lighting, fog for hex world
- `frontend/src/components/BiomeDecorations.jsx` — Hex world boundary filtering
- `services/simulation/long_run.py` — Phase 1 vs Phase 2 comparison script

### Next steps
- Population dashboard with live graphs overlaid on 3D world
- Day/night cycle tied to seasons
- Species-specific behaviors (Snorlax idle, birds fly higher)
- Carrying capacity degradation
- Docker Compose orchestration
