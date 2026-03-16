import os
from dotenv import load_dotenv

load_dotenv()

POKEAPI_BASE_URL = "https://pokeapi.co/api/v2"
BULBAPEDIA_PREDATION_URL = "https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_predation"

# How many Pokemon to load (Gen 1-9 = 1025)
MAX_POKEMON_ID = int(os.getenv("MAX_POKEMON_ID", "1025"))

# Database connection
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "pokemon_ecosystem")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")

# Rate limiting for PokeAPI (requests per second)
REQUEST_DELAY = float(os.getenv("REQUEST_DELAY", "0.5"))

# Output directory for raw JSON dumps
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
