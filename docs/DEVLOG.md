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
