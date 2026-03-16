# Pokemon Card Price Forecaster

A backend system architecture portfolio project. Ingests Pokemon card price data from multiple sources, processes and normalizes it, generates price forecasts, and serves results through a REST API.

**The goal is not ML accuracy or frontend polish — it is demonstrating system design and architectural decision-making.**

---

## System Architecture

```
[eBay Scraper] ──┐
[TCGPlayer]    ──┼──► [Message Queue] ──► [Processing Service] ──► [PostgreSQL]
[PSA Reports]  ──┘                                              └──► [TimescaleDB]
                                                                         │
                                                                  [Forecasting Service]
                                                                         │
                                                                    [FastAPI]
                                                                         │
                                                                      [Redis]
```

## Layers

| Layer | Responsibility |
|---|---|
| Ingestion | Isolated scrapers/API clients per source, push to message queue |
| Processing | Consume queue, clean + normalize data, write to databases |
| Storage | PostgreSQL (card metadata) + TimescaleDB (price history) |
| Forecasting | Scheduled service, reads history, writes predictions |
| API | FastAPI REST endpoints serving card data and forecasts |
| Infrastructure | Docker Compose, Terraform, GitHub Actions, Prometheus + Grafana |

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /cards/{id}/price-history` | Historical price data for a card |
| `GET /cards/{id}/forecast` | Price prediction for a card |
| `GET /cards?set=xy&rarity=ultra-rare` | Search/filter cards |
| `GET /health` | Pipeline health status |

## Tech Stack

- **Language:** Python
- **API:** FastAPI
- **Message Queue:** Redis Streams
- **Relational DB:** PostgreSQL
- **Time-Series DB:** TimescaleDB
- **Caching:** Redis
- **Containers:** Docker + Docker Compose
- **IaC:** Terraform
- **CI/CD:** GitHub Actions
- **Monitoring:** Prometheus + Grafana

## Documentation

Architecture decisions and design rationale live in `/docs`:

- `docs/architecture/` — C4 diagrams (system context, container)
- `docs/diagrams/` — Data flow diagrams
- `docs/adr/` — Architecture Decision Records (why Kafka vs Redis Streams, why split DBs, etc.)

## Project Structure

```
services/
├── ingestion/
│   ├── ebay/
│   ├── tcgplayer/
│   └── psa/
├── processing/
├── forecasting/
└── api/
infrastructure/
├── docker/
├── terraform/
└── monitoring/
docs/
├── architecture/
├── diagrams/
└── adr/
.github/
└── workflows/
```

## Roadmap

- [ ] Week 1-2: Ingestion services + message queue + DB schema
- [ ] Week 3: Processing pipeline + API layer
- [ ] Week 4: Forecasting service + Docker Compose + monitoring
- [ ] Week 5: Documentation, diagrams, README polish
