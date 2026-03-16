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
