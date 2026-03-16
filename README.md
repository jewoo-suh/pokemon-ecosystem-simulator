# Pokemon Ecosystem Simulator

An agent-based ecological simulation where Pokemon populations interact, compete, and evolve across biomes. Built as a data architecture portfolio project.

**The goal is demonstrating data modeling, pipeline design, and architectural decision-making — not game graphics or ML accuracy.**

---

## Concept

Drop 1000+ Pokemon species into a world of biomes (forests, oceans, caves, mountains). Each species has ecologically-derived traits — metabolism, reproduction, predation — computed from real game stats. Run the simulation and watch food chains emerge, populations boom and crash, and ecosystems reach (or fail to reach) equilibrium.

Think Conway's Game of Life meets Lotka-Volterra predator-prey dynamics, with 18 types and real Pokemon data.

---

## System Architecture

```
[PokeAPI + Bulbapedia] ──► [Data Loader] ──► [PostgreSQL]
                                                  │
                              [dbt] ──► [pokemon_sim_params]
                                                  │
                           [Simulation Engine] ──► [Redis Streams]
                                                  │
                           [Event Consumer] ──► [TimescaleDB]
                                                  │
                              [FastAPI] ◄──► [Redis Cache]
```

## Data Layers

| Layer | Storage | Contents |
|---|---|---|
| Raw Entities | PostgreSQL | Pokemon, types, biomes, evolution chains (from PokeAPI) |
| Derived Data | PostgreSQL | Food chain, trophic levels, sim params (dbt-transformed) |
| Time-Series | TimescaleDB | Population snapshots, ecosystem events per tick |
| Config | PostgreSQL | Simulation tuning knobs |

## Key Data Model Decisions

- **Split storage:** PostgreSQL for entities + TimescaleDB for time-series (different query patterns)
- **Raw vs derived separation:** `pokemon` table is immutable PokeAPI data; `pokemon_sim_params` is recomputable derived data
- **Tiered food chain:** Canon data (Bulbapedia) + type-derived rules, each tagged with lineage
- **Trophic levels:** Every Pokemon gets an ecological role so nothing is left "roaming"

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /world/state?tick=500` | Full ecosystem state at a given tick |
| `GET /biomes/{id}/populations` | Population history for a biome |
| `GET /pokemon/{id}/history` | Population trend for a species over time |
| `GET /world/events` | Extinctions, booms, migrations, equilibria |
| `GET /simulation/config` | Current simulation parameters |
| `GET /health` | System health |

## Tech Stack

- **Language:** Python
- **API:** FastAPI
- **Data Transformation:** dbt
- **Message Queue:** Redis Streams
- **Relational DB:** PostgreSQL
- **Time-Series DB:** TimescaleDB
- **Caching:** Redis
- **Containers:** Docker + Docker Compose
- **IaC:** Terraform
- **CI/CD:** GitHub Actions
- **Monitoring:** Prometheus + Grafana

## Project Structure

```
db/
└── migrations/          # SQL schema migrations
services/
├── data_loader/         # Ingests from PokeAPI + Bulbapedia
├── simulation/          # Tick-based ecosystem engine
└── api/                 # FastAPI REST layer
infrastructure/
├── docker/
├── terraform/
└── monitoring/
docs/
├── architecture/        # C4 diagrams
├── diagrams/            # Data flow, ER diagrams
└── adr/                 # Architecture Decision Records
.github/
└── workflows/           # CI/CD
```

## Roadmap

### Phase 1: Backend
- [x] Data model design & SQL migrations
- [ ] Data loader (PokeAPI + Bulbapedia scraper)
- [ ] dbt transformations (sim params, food chain derivation)
- [ ] Simulation engine + Redis Streams
- [ ] Event consumer + TimescaleDB writes
- [ ] FastAPI REST layer
- [ ] Docker Compose orchestration
- [ ] Documentation & ADRs

### Phase 2: Frontend (future)
- [ ] 2D world visualization with biomes and sprites
- [ ] Real-time population graphs
- [ ] Time slider to scrub through simulation history
