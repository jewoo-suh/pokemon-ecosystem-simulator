from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db import init_pool, close_pool
from routes import species, biomes, population, simulation, food_chain, stats


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_pool()
    yield
    close_pool()


app = FastAPI(
    title="Pokemon Ecosystem Simulator API",
    description="REST API for the Pokemon Ecosystem Simulator",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(species.router, prefix="/species", tags=["Species"])
app.include_router(biomes.router, prefix="/biomes", tags=["Biomes"])
app.include_router(population.router, prefix="/population", tags=["Population"])
app.include_router(simulation.router, prefix="/simulation", tags=["Simulation"])
app.include_router(food_chain.router, prefix="/food-chain", tags=["Food Chain"])
app.include_router(stats.router, prefix="/stats", tags=["Stats"])
