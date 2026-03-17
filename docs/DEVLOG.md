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

### Next steps
- Build FastAPI REST layer
- Docker Compose orchestration
- Phase 2: Frontend visualization with time scrubbing
