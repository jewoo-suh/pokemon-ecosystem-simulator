"""
Pokemon Ecosystem Simulation Engine

Tick loop:
  1. Read simulation_state (live world)
  2. Producers regenerate food
  3. Consumers lose food (metabolism)
  4. Predation: predators hunt prey
  5. Starvation: low food = increased death
  6. Natural mortality
  7. Reproduction (if fed enough)
  8. Evolution (small per-individual chance)
  9. Migration (move between biomes)
  10. Write updated state back
  11. Snapshot to population_snapshots
  12. Detect and log ecosystem events
"""

import math
import random
import time
from collections import defaultdict
import numpy as np
import psycopg2
from psycopg2.extras import execute_values
from config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD


def _binomial(n, p):
    """Fast binomial sampling: returns number of successes out of n trials with probability p.
    Uses normal approximation for large n, exact counting for small n."""
    if n <= 0 or p <= 0:
        return 0
    if p >= 1.0:
        return n
    if n < 20:
        # Small n: exact per-trial rolls (fast enough)
        return sum(1 for _ in range(n) if random.random() < p)
    # Normal approximation to binomial
    mean = n * p
    std = math.sqrt(n * p * (1 - p))
    result = int(random.gauss(mean, std) + 0.5)
    return max(0, min(n, result))


class SimulationEngine:
    def __init__(self):
        self.conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
            user=DB_USER, password=DB_PASSWORD,
        )
        self.conn.autocommit = False
        self.config = {}
        self.sim_params = {}
        self.trophic_levels = {}
        self.food_chain = {}       # predator_id -> [(prey_id, probability)]
        self.prey_of = {}          # prey_id -> [predator_id]
        self.predator_count = {}   # pokemon_id -> number of predators targeting it
        self.evolution_map = {}    # from_pokemon_id -> [(to_pokemon_id, min_pop, order)]
        self.base_form = {}        # pokemon_id -> base form pokemon_id (for reproduction)
        self.biome_capacity = {}
        self.legendaries = set()   # pokemon_ids that are legendary/mythical (immortal)
        self.state = {}            # (pokemon_id, biome_id) -> {population, food_satiation, health, ticks_stable}

        # Numpy arrays (built by _build_arrays)
        self.keys = []
        self.key_to_idx = {}
        self.pop = None
        self.food = None
        self.health = None
        self.ticks_stable = None

        # Pre-computed lookup structures
        self.pokemon_biomes = defaultdict(set)   # pokemon_id -> set of biome_ids
        self.biome_indices = defaultdict(list)    # biome_id -> list of array indices
        self.decomposer_by_biome = defaultdict(list)  # biome_id -> list of array indices for decomposers

    def load_data(self):
        """Load all static data from DB into memory."""
        cur = self.conn.cursor()

        # Simulation config
        cur.execute("SELECT key, value FROM simulation_config")
        self.config = {row[0]: float(row[1]) for row in cur.fetchall()}

        # Sim params per pokemon
        cur.execute("""
            SELECT pokemon_id, metabolism_rate, repro_rate, natural_mortality,
                   hunt_power, escape_power, migration_rate, evolution_threshold
            FROM pokemon_sim_params
        """)
        for row in cur.fetchall():
            self.sim_params[row[0]] = {
                "metabolism": float(row[1]),
                "repro_rate": float(row[2]),
                "mortality": float(row[3]),
                "hunt_power": float(row[4]),
                "escape_power": float(row[5]),
                "migration": float(row[6]),
                "evo_threshold": float(row[7]) if row[7] else None,
            }

        # Trophic levels
        cur.execute("SELECT pokemon_id, level FROM trophic_levels")
        self.trophic_levels = {row[0]: row[1] for row in cur.fetchall()}

        # Food chain
        cur.execute("SELECT predator_id, prey_id, probability FROM food_chain")
        for pred_id, prey_id, prob in cur.fetchall():
            self.food_chain.setdefault(pred_id, []).append((prey_id, float(prob)))
            self.prey_of.setdefault(prey_id, []).append(pred_id)

        # Pre-compute predator pressure per species (for prey-pressure reproduction bonus)
        self.predator_count = {pid: len(preds) for pid, preds in self.prey_of.items()}

        # Evolution chains
        cur.execute("""
            SELECT from_pokemon_id, to_pokemon_id, min_population, evolution_order
            FROM evolution_chains
        """)
        prevo_map = {}  # to_id -> from_id (reverse lookup)
        for from_id, to_id, min_pop, order in cur.fetchall():
            self.evolution_map.setdefault(from_id, []).append((to_id, min_pop, order))
            prevo_map[to_id] = from_id

        # Build base_form map: walk backwards to find the first form
        # Gardevoir -> Kirlia -> Ralts, so base_form[gardevoir] = ralts
        for pokemon_id in self.sim_params:
            pid = pokemon_id
            while pid in prevo_map:
                pid = prevo_map[pid]
            if pid != pokemon_id:
                self.base_form[pokemon_id] = pid
            # else: already a base form or no evo line, reproduces as itself

        # Biome capacities and biomass
        cur.execute("SELECT id, carrying_capacity, COALESCE(biomass_factor, 1.0) FROM biomes")
        self.biome_capacity = {}
        self.biome_biomass = {}  # biome_id -> biomass multiplier (forest=1.3, cave=0.5)
        for row in cur.fetchall():
            self.biome_capacity[row[0]] = row[1]
            self.biome_biomass[row[0]] = float(row[2])

        # Type-biome affinity (rock thrives in caves, water in sea, etc.)
        cur.execute("SELECT type_id, biome_id, affinity FROM type_biome_affinity")
        self.type_biome_affinity = {}  # (type_id, biome_id) -> affinity multiplier
        for type_id, biome_id, affinity in cur.fetchall():
            self.type_biome_affinity[(type_id, biome_id)] = float(affinity)

        # Pre-compute per-pokemon biome affinity using primary type
        # pokemon_id -> {biome_id -> affinity}
        cur.execute("SELECT pokemon_id, type_id FROM pokemon_types WHERE slot = 1")
        self.pokemon_primary_type = {}
        for pokemon_id, type_id in cur.fetchall():
            self.pokemon_primary_type[pokemon_id] = type_id

        # Legendaries & mythicals (immortal, can't be hunted, don't reproduce)
        cur.execute("SELECT id FROM pokemon WHERE is_legendary = TRUE OR is_mythical = TRUE")
        self.legendaries = {row[0] for row in cur.fetchall()}

        # Biome adjacency (from Perlin map generator)
        # Falls back to "all biomes connected" if no adjacency data exists
        self.biome_adjacency = {}  # biome_id -> set of adjacent biome_ids
        cur.execute("SELECT biome_a, biome_b FROM biome_adjacency")
        adjacency_rows = cur.fetchall()
        if adjacency_rows:
            for a, b in adjacency_rows:
                self.biome_adjacency.setdefault(a, set()).add(b)
            adjacency_msg = f"{len(adjacency_rows)} adjacency pairs"
        else:
            # No map generated yet — allow migration to any biome
            all_biome_ids = list(self.biome_capacity.keys())
            for bid in all_biome_ids:
                self.biome_adjacency[bid] = set(all_biome_ids) - {bid}
            adjacency_msg = "no map (all-to-all fallback)"

        cur.close()
        print(f"  Loaded {len(self.sim_params)} pokemon params")
        print(f"  Loaded {len(self.legendaries)} legendaries/mythicals (immortal)")
        print(f"  Loaded {sum(len(v) for v in self.food_chain.values())} food chain pairs")
        print(f"  Loaded {len(self.biome_capacity)} biomes (biomass {min(self.biome_biomass.values()):.1f}-{max(self.biome_biomass.values()):.1f}, {len(self.type_biome_affinity)} type affinities)")
        print(f"  Migration: {adjacency_msg}")

    def initialize_world(self):
        """Set initial populations based on habitat assignments."""
        cur = self.conn.cursor()

        # Clear existing state
        cur.execute("DELETE FROM simulation_state")
        cur.execute("UPDATE simulation_metadata SET value = '0' WHERE key = 'current_tick'")
        cur.execute("UPDATE simulation_metadata SET value = 'running' WHERE key = 'status'")

        # Set initial population based on catch_rate (common Pokemon = more individuals)
        cur.execute("""
            SELECT ph.pokemon_id, ph.biome_id, p.catch_rate, p.is_legendary, p.is_mythical
            FROM pokemon_habitats ph
            JOIN pokemon p ON ph.pokemon_id = p.id
        """)

        rows = []
        for pokemon_id, biome_id, catch_rate, is_legendary, is_mythical in cur.fetchall():
            # Legendaries/mythicals start with tiny populations
            if is_legendary or is_mythical:
                pop = random.randint(2, 5)
            elif catch_rate and catch_rate > 0:
                # Higher catch rate = more common = larger starting population
                pop = max(5, int(catch_rate / 3) + random.randint(-5, 10))
            else:
                pop = random.randint(10, 30)

            rows.append((pokemon_id, biome_id, pop, 1.0, 100.0, 0))

        execute_values(
            cur,
            """INSERT INTO simulation_state
               (pokemon_id, biome_id, population, food_satiation, health, ticks_stable)
               VALUES %s""",
            rows,
        )
        self.conn.commit()

        # Load state into memory
        self._load_state()
        self._build_arrays()
        total_pop = int(np.sum(self.pop))
        print(f"  Initialized world: {len(self.state)} species-biome pairs, {total_pop} total individuals")
        cur.close()

    def _load_state(self):
        """Load current simulation state from DB into memory."""
        cur = self.conn.cursor()
        cur.execute("""
            SELECT pokemon_id, biome_id, population, food_satiation, health, ticks_stable
            FROM simulation_state
        """)
        self.state = {}
        for row in cur.fetchall():
            key = (row[0], row[1])
            self.state[key] = {
                "population": row[2],
                "food_satiation": float(row[3]),
                "health": float(row[4]),
                "ticks_stable": row[5],
            }
        cur.close()

    def _build_arrays(self):
        """Build numpy arrays and lookup structures from self.state for vectorized operations."""
        self.keys = list(self.state.keys())
        self.key_to_idx = {k: i for i, k in enumerate(self.keys)}
        N = len(self.keys)

        # Core state arrays
        self.pop = np.array([self.state[k]["population"] for k in self.keys], dtype=np.int32)
        self.food = np.array([self.state[k]["food_satiation"] for k in self.keys], dtype=np.float32)
        self.health = np.array([self.state[k]["health"] for k in self.keys], dtype=np.float32)
        self.ticks_stable = np.array([self.state[k]["ticks_stable"] for k in self.keys], dtype=np.int32)

        # Per-entry ID arrays (static)
        self.pid_arr = np.array([k[0] for k in self.keys], dtype=np.int32)
        self.bid_arr = np.array([k[1] for k in self.keys], dtype=np.int32)

        # Trophic level masks
        trophic_arr = [self.trophic_levels.get(k[0], "") for k in self.keys]
        self.is_producer = np.array([t == "producer" for t in trophic_arr], dtype=np.bool_)
        self.is_primary = np.array([t == "primary_consumer" for t in trophic_arr], dtype=np.bool_)
        self.is_secondary = np.array([t == "secondary_consumer" for t in trophic_arr], dtype=np.bool_)
        self.is_apex = np.array([t == "apex_predator" for t in trophic_arr], dtype=np.bool_)
        self.is_decomposer = np.array([t == "decomposer" for t in trophic_arr], dtype=np.bool_)
        self.is_legendary_arr = np.array([k[0] in self.legendaries for k in self.keys], dtype=np.bool_)

        # Per-entry sim params arrays
        self.metabolism_arr = np.array([
            self.sim_params.get(k[0], {}).get("metabolism", 0.05) for k in self.keys
        ], dtype=np.float32)
        self.mortality_arr = np.array([
            self.sim_params.get(k[0], {}).get("mortality", 0.02) for k in self.keys
        ], dtype=np.float32)
        self.repro_rate_arr = np.array([
            self.sim_params.get(k[0], {}).get("repro_rate", 5.0) for k in self.keys
        ], dtype=np.float32)
        self.migration_arr = np.array([
            self.sim_params.get(k[0], {}).get("migration", 0.0) for k in self.keys
        ], dtype=np.float32)

        # Has-prey mask for grazing logic
        self.has_prey_arr = np.array([
            k[0] in self.food_chain and len(self.food_chain[k[0]]) > 0
            for k in self.keys
        ], dtype=np.bool_)

        # Effective biomass per entry (static: base_biomass * type_affinity)
        self.effective_biomass_arr = np.empty(N, dtype=np.float32)
        for i, k in enumerate(self.keys):
            pid, bid = k
            base_biomass = self.biome_biomass.get(bid, 1.0)
            primary_type = self.pokemon_primary_type.get(pid)
            type_affinity = self.type_biome_affinity.get((primary_type, bid), 1.0) if primary_type else 1.0
            self.effective_biomass_arr[i] = base_biomass * type_affinity

        # Biome capacity per entry
        self.biome_cap_arr = np.array([
            self.biome_capacity.get(k[1], 10000) for k in self.keys
        ], dtype=np.float32)

        # Predator count per entry
        self.predator_count_arr = np.array([
            self.predator_count.get(k[0], 0) for k in self.keys
        ], dtype=np.int32)

        # Base form for reproduction per entry
        self.base_form_arr = np.array([
            self.base_form.get(k[0], k[0]) for k in self.keys
        ], dtype=np.int32)

        # Hunt/escape power arrays (for predation loop)
        self.hunt_power_arr = np.array([
            self.sim_params.get(k[0], {}).get("hunt_power", 0.0) for k in self.keys
        ], dtype=np.float32)
        self.escape_power_arr = np.array([
            self.sim_params.get(k[0], {}).get("escape_power", 0.0) for k in self.keys
        ], dtype=np.float32)

        # Pre-build predator indices and per-entry biome-local prey lists
        # Instead of checking all prey each tick, pre-filter to only prey that exist in the same biome
        pred_indices = []
        self.local_prey = {}  # idx -> [(prey_idx, base_prob)]
        for i, k in enumerate(self.keys):
            pid, bid = k
            if pid not in self.food_chain:
                continue
            local = []
            for prey_id, prob in self.food_chain[pid]:
                prey_idx = self.key_to_idx.get((prey_id, bid))
                if prey_idx is not None:
                    local.append((prey_idx, prey_id, prob))
            if local:
                pred_indices.append(i)
                self.local_prey[i] = local
        self.predator_indices = np.array(pred_indices, dtype=np.int32)

        # Build lookup structures
        self.pokemon_biomes = defaultdict(set)
        self.biome_indices = defaultdict(list)
        self.decomposer_by_biome = defaultdict(list)

        for i, k in enumerate(self.keys):
            pid, bid = k
            self.pokemon_biomes[pid].add(bid)
            self.biome_indices[bid].append(i)
            if self.is_decomposer[i]:
                self.decomposer_by_biome[bid].append(i)

        # Build unique biome IDs array for fast biome-level aggregation
        self.unique_biomes = list(set(k[1] for k in self.keys))
        self.biome_to_int = {b: i for i, b in enumerate(self.unique_biomes)}
        self.bid_int_arr = np.array([self.biome_to_int[k[1]] for k in self.keys], dtype=np.int32)
        self.num_biomes = len(self.unique_biomes)

    def _sync_arrays_to_state(self):
        """Sync numpy arrays back to self.state dict (for DB saves)."""
        for i, k in enumerate(self.keys):
            self.state[k]["population"] = int(self.pop[i])
            self.state[k]["food_satiation"] = float(self.food[i])
            self.state[k]["health"] = float(self.health[i])
            self.state[k]["ticks_stable"] = int(self.ticks_stable[i])

    def _add_new_entry(self, pokemon_id, biome_id, population, food_satiation, health, ticks_stable):
        """Add a new species-biome entry that doesn't exist yet. Extends arrays."""
        key = (pokemon_id, biome_id)
        self.state[key] = {
            "population": population,
            "food_satiation": food_satiation,
            "health": health,
            "ticks_stable": ticks_stable,
        }
        idx = len(self.keys)
        self.keys.append(key)
        self.key_to_idx[key] = idx

        # Extend all arrays by 1
        self.pop = np.append(self.pop, np.int32(population))
        self.food = np.append(self.food, np.float32(food_satiation))
        self.health = np.append(self.health, np.float32(health))
        self.ticks_stable = np.append(self.ticks_stable, np.int32(ticks_stable))

        self.pid_arr = np.append(self.pid_arr, np.int32(pokemon_id))
        self.bid_arr = np.append(self.bid_arr, np.int32(biome_id))

        trophic = self.trophic_levels.get(pokemon_id, "")
        self.is_producer = np.append(self.is_producer, trophic == "producer")
        self.is_primary = np.append(self.is_primary, trophic == "primary_consumer")
        self.is_secondary = np.append(self.is_secondary, trophic == "secondary_consumer")
        self.is_apex = np.append(self.is_apex, trophic == "apex_predator")
        self.is_decomposer = np.append(self.is_decomposer, trophic == "decomposer")
        self.is_legendary_arr = np.append(self.is_legendary_arr, pokemon_id in self.legendaries)

        params = self.sim_params.get(pokemon_id, {})
        self.metabolism_arr = np.append(self.metabolism_arr, np.float32(params.get("metabolism", 0.05)))
        self.mortality_arr = np.append(self.mortality_arr, np.float32(params.get("mortality", 0.02)))
        self.repro_rate_arr = np.append(self.repro_rate_arr, np.float32(params.get("repro_rate", 5.0)))
        self.migration_arr = np.append(self.migration_arr, np.float32(params.get("migration", 0.0)))

        self.has_prey_arr = np.append(self.has_prey_arr,
            pokemon_id in self.food_chain and len(self.food_chain[pokemon_id]) > 0)

        base_biomass = self.biome_biomass.get(biome_id, 1.0)
        primary_type = self.pokemon_primary_type.get(pokemon_id)
        type_affinity = self.type_biome_affinity.get((primary_type, biome_id), 1.0) if primary_type else 1.0
        self.effective_biomass_arr = np.append(self.effective_biomass_arr, np.float32(base_biomass * type_affinity))

        self.biome_cap_arr = np.append(self.biome_cap_arr, np.float32(self.biome_capacity.get(biome_id, 10000)))
        self.predator_count_arr = np.append(self.predator_count_arr, np.int32(self.predator_count.get(pokemon_id, 0)))
        self.base_form_arr = np.append(self.base_form_arr, np.int32(self.base_form.get(pokemon_id, pokemon_id)))

        # Update lookups
        self.pokemon_biomes[pokemon_id].add(biome_id)
        self.biome_indices[biome_id].append(idx)
        if trophic == "decomposer":
            self.decomposer_by_biome[biome_id].append(idx)

        # Update biome int mapping
        if biome_id not in self.biome_to_int:
            self.biome_to_int[biome_id] = self.num_biomes
            self.unique_biomes.append(biome_id)
            self.num_biomes += 1
        self.bid_int_arr = np.append(self.bid_int_arr, np.int32(self.biome_to_int[biome_id]))

        return idx

    def run(self, num_ticks, log_interval=50, snapshot_interval=10):
        """Run the simulation for N ticks."""
        if not hasattr(self, 'pop'):
            self._build_arrays()
        cur = self.conn.cursor()
        cur.execute("SELECT value FROM simulation_metadata WHERE key = 'current_tick'")
        current_tick = int(cur.fetchone()[0])
        cur.close()

        print(f"\nRunning simulation: tick {current_tick + 1} to {current_tick + num_ticks}")
        start_time = time.time()

        for i in range(num_ticks):
            current_tick += 1
            events = self._run_tick(current_tick)

            # Save snapshot only every snapshot_interval ticks
            if current_tick % snapshot_interval == 0:
                self._sync_arrays_to_state()
                self._save_snapshot(current_tick)

            if events:
                self._sync_arrays_to_state()
                self._save_events(current_tick, events)

            # Update metadata
            cur = self.conn.cursor()
            cur.execute("UPDATE simulation_metadata SET value = %s WHERE key = 'current_tick'",
                        (str(current_tick),))
            self.conn.commit()
            cur.close()

            if current_tick % log_interval == 0:
                total_pop = int(np.sum(self.pop))
                alive = int(np.sum(self.pop > 0))
                elapsed = time.time() - start_time
                print(f"  Tick {current_tick}: {total_pop} total pop, "
                      f"{alive} active species-biomes, "
                      f"{len(events)} events, "
                      f"{elapsed:.1f}s elapsed")

        total_pop = int(np.sum(self.pop))
        elapsed = time.time() - start_time
        print(f"\nSimulation complete: {num_ticks} ticks in {elapsed:.1f}s")
        print(f"  Final population: {total_pop}")

    def _run_tick(self, tick):
        """Execute one simulation tick. Returns list of events."""
        events = []
        time_scale = self.config.get("time_scale", 1.0)
        N = len(self.keys)

        # Track populations before this tick for stability check
        prev_pop = self.pop.copy()

        alive = self.pop > 0

        # --- Pre-compute biome stats using numpy (used by multiple phases) ---
        alive_indices = np.where(alive)[0]
        alive_bids = self.bid_int_arr[alive_indices]
        alive_pops = self.pop[alive_indices]

        biome_totals_arr = np.zeros(self.num_biomes, dtype=np.int64)
        np.add.at(biome_totals_arr, alive_bids, alive_pops)

        biome_species_counts_arr = np.zeros(self.num_biomes, dtype=np.int32)
        np.add.at(biome_species_counts_arr, alive_bids, 1)

        biome_producer_pops_arr = np.zeros(self.num_biomes, dtype=np.int64)
        alive_producers = alive_indices[self.is_producer[alive_indices]]
        if len(alive_producers) > 0:
            np.add.at(biome_producer_pops_arr, self.bid_int_arr[alive_producers], self.pop[alive_producers])

        # Per-entry biome total (broadcast for vectorized ops)
        bt_per_entry = biome_totals_arr[self.bid_int_arr]
        biome_cap_per_entry = self.biome_cap_arr
        producer_pop_per_entry = biome_producer_pops_arr[self.bid_int_arr]
        species_count_per_entry = biome_species_counts_arr[self.bid_int_arr]

        # --- Phase 1: Food regeneration & regrowth (producers) ---
        producer_alive = alive & self.is_producer
        # Producers photosynthesize
        self.food[producer_alive] = np.minimum(1.0, self.food[producer_alive] + 0.15)

        # Regrowth: plants regenerate population if below biome capacity and fed
        regrow_mask = producer_alive & (self.food > 0.5) & (bt_per_entry < biome_cap_per_entry)
        regrow_indices = np.where(regrow_mask)[0]
        for i in regrow_indices:
            regrowth = max(1, min(5, int(self.pop[i] * 0.03)))
            self.pop[i] += regrowth

        # --- Phase 2: Metabolism (everyone gets hungrier, except legendaries) ---
        # Legendaries: food stays at 1.0
        legendary_alive = alive & self.is_legendary_arr
        self.food[legendary_alive] = 1.0

        # Active non-legendary entries
        active = alive & ~self.is_legendary_arr
        active_indices = np.where(active)[0]

        # Vectorized metabolism
        met = self.metabolism_arr * time_scale
        # Small pop scavenging
        small_pop_mask = self.pop < 20
        scale = np.where(small_pop_mask, 0.5 + 0.5 * self.pop / 20.0, 1.0).astype(np.float32)
        met_scaled = met * scale
        self.food[active] = np.maximum(0.0, self.food[active] - met_scaled[active])

        # --- Phase 2b: Grazing ---
        # Primary consumers graze on biome vegetation
        primary_alive = active & self.is_primary
        if np.any(primary_alive):
            bt_safe = np.maximum(1, bt_per_entry).astype(np.float32)
            vegetation_ratio = producer_pop_per_entry.astype(np.float32) / bt_safe
            graze_gain = np.minimum(0.15, vegetation_ratio * 0.5) * self.effective_biomass_arr
            self.food[primary_alive] = np.minimum(1.0, self.food[primary_alive] + graze_gain[primary_alive])

        # Prey-less carnivores forage opportunistically at 30% rate
        carnivore_no_prey = active & (self.is_secondary | self.is_apex) & ~self.has_prey_arr
        if np.any(carnivore_no_prey):
            bt_safe = np.maximum(1, bt_per_entry).astype(np.float32)
            vegetation_ratio = producer_pop_per_entry.astype(np.float32) / bt_safe
            forage_gain = np.minimum(0.15, vegetation_ratio * 0.5) * self.effective_biomass_arr * 0.3
            self.food[carnivore_no_prey] = np.minimum(1.0, self.food[carnivore_no_prey] + forage_gain[carnivore_no_prey])

        # --- Phase 3: Predation (with prey-switching & saturation) ---
        encounter_chance = self.config["predation_encounter_chance"] * time_scale

        # Snapshot start populations for saturation caps (use numpy for speed)
        start_pops = self.pop.copy()

        # Track total kills per prey index this tick (array instead of dict)
        prey_losses = np.zeros(N, dtype=np.int32)

        # Death pool: tracks total deaths per biome for decomposer feeding
        biome_deaths_arr = np.zeros(self.num_biomes, dtype=np.int64)

        # Local refs to avoid attribute lookups in inner loop
        pop = self.pop
        food = self.food
        keys = self.keys
        key_to_idx = self.key_to_idx
        food_chain = self.food_chain
        legendaries = self.legendaries
        hunt_arr = self.hunt_power_arr
        escape_arr = self.escape_power_arr
        predator_count = self.predator_count_arr

        # Predation loop - only iterate predators with local prey
        local_prey = self.local_prey
        for i in self.predator_indices:
            if pop[i] <= 0:
                continue
            pred_pop_i = int(pop[i])
            hunt_i = float(hunt_arr[i])
            bt = int(bt_per_entry[i])
            biome_id = keys[i][1]

            for prey_idx, prey_id, base_prob in local_prey[i]:
                if prey_id in legendaries:
                    continue
                prey_pop = int(pop[prey_idx])
                if prey_pop <= 0:
                    continue

                # Predation saturation: max 30% of starting pop
                sp = int(start_pops[prey_idx])
                max_losses = max(1, int(sp * 0.30))
                al = int(prey_losses[prey_idx])
                if al >= max_losses:
                    continue

                # Prey-switching: focus on abundant prey
                prey_abundance = prey_pop / max(1, bt)
                abundance_mult = 1.0 + prey_abundance * 5.0

                # Refuge effect
                if prey_pop < 20:
                    abundance_mult *= prey_pop / 20.0

                encounters = int(pred_pop_i * encounter_chance * abundance_mult)
                if encounters <= 0:
                    continue

                # Success rate
                escape = float(escape_arr[prey_idx])
                success_rate = (hunt_i / (hunt_i + escape)) * base_prob

                # Predator dilution
                np_count = int(predator_count[prey_idx])
                if np_count > 10:
                    success_rate *= 10.0 / np_count

                n = min(encounters, prey_pop)
                caught = _binomial(n, success_rate)

                if caught > 0:
                    remaining_quota = max_losses - al
                    caught = min(caught, prey_pop, remaining_quota)
                    pop[prey_idx] -= caught
                    prey_losses[prey_idx] += caught
                    biome_deaths_arr[self.bid_int_arr[prey_idx]] += caught
                    food_gain = min(0.3, caught * 0.05 / max(1, pred_pop_i))
                    food[i] = min(1.0, food[i] + food_gain)

        # Convert biome_deaths to dict for decomposer phase
        biome_deaths = {self.unique_biomes[b]: int(biome_deaths_arr[b])
                        for b in range(self.num_biomes) if biome_deaths_arr[b] > 0}

        # --- Phase 4: Starvation & Natural mortality ---
        mortality_base = self.config["mortality_base_rate"]
        food_scarcity_mult = self.config["food_scarcity_multiplier"]

        # Recompute bt_per_entry since predation changed populations
        alive2 = self.pop > 0
        alive2_idx = np.where(alive2)[0]
        biome_totals_arr2 = np.zeros(self.num_biomes, dtype=np.int64)
        np.add.at(biome_totals_arr2, self.bid_int_arr[alive2_idx], self.pop[alive2_idx])
        bt_per_entry2 = biome_totals_arr2[self.bid_int_arr]

        # Process mortality for active non-legendary entries
        active2 = alive2 & ~self.is_legendary_arr
        active2_indices = np.where(active2)[0]

        # Vectorized mortality computation
        mort = self.mortality_arr * time_scale

        # Starvation multiplier
        starving = self.food < 0.3
        mort_multiplied = np.where(starving, mort * food_scarcity_mult, mort)

        # Overcrowding multiplier
        bt2_f = bt_per_entry2.astype(np.float32)
        cap_f = biome_cap_per_entry.astype(np.float32)
        overcrowded = bt2_f > cap_f
        overcrowding_factor = np.where(overcrowded, bt2_f / cap_f, 1.0)
        mort_multiplied = mort_multiplied * overcrowding_factor

        # Intraspecific competition (density-dependent)
        bt2_safe = np.maximum(1, bt2_f)
        species_share = self.pop.astype(np.float32) / bt2_safe
        high_share = species_share > 0.25
        share_excess = np.maximum(0.0, (species_share - 0.25) / 0.75)
        dominance_penalty = np.where(
            high_share,
            1.0 + np.power(share_excess, 0.7) * 2.0,
            1.0
        )
        mort_multiplied = mort_multiplied * dominance_penalty

        # Apply deaths using numpy vectorized binomial
        mort_clipped = np.clip(mort_multiplied[active2_indices], 0.0, 1.0)
        pop_active2 = self.pop[active2_indices].astype(np.int64)
        deaths_arr = np.random.binomial(pop_active2, mort_clipped).astype(np.int32)

        self.pop[active2_indices] -= deaths_arr

        # Accumulate deaths into biome_deaths
        for j, i in enumerate(active2_indices):
            if deaths_arr[j] > 0:
                bid = self.keys[i][1]
                biome_deaths[bid] = biome_deaths.get(bid, 0) + int(deaths_arr[j])

        # Check extinctions
        for j, i in enumerate(active2_indices):
            if self.pop[i] <= 0 and prev_pop[i] > 0:
                self.pop[i] = 0
                events.append(("extinction", self.keys[i][0], self.keys[i][1],
                               f"Population reached 0 in biome"))

        # --- Phase 4b: Decomposer feeding (death pool) ---
        # Pre-compute decomposer pop per biome in one pass (O(n) not O(n^2))
        decomposer_pop_per_biome = defaultdict(int)
        for bid, idx_list in self.decomposer_by_biome.items():
            for i in idx_list:
                if self.pop[i] > 0:
                    decomposer_pop_per_biome[bid] += int(self.pop[i])

        for bid, idx_list in self.decomposer_by_biome.items():
            total_dead = biome_deaths.get(bid, 0)
            if total_dead <= 0:
                continue
            decomp_pop = decomposer_pop_per_biome.get(bid, 0)
            if decomp_pop <= 0:
                continue

            food_pool = total_dead * 0.5
            per_capita_food = food_pool / max(1, decomp_pop)
            decompose_gain = min(0.15, per_capita_food * 0.01)

            for i in idx_list:
                if self.pop[i] > 0 and not self.is_legendary_arr[i]:
                    self.food[i] = min(1.0, self.food[i] + decompose_gain)

        # --- Phase 5: Reproduction (babies are base forms) ---
        repro_threshold = self.config["reproduction_food_threshold"]
        pending_births = []  # (baby_pokemon_id, biome_id, count, parent_idx)

        # Recompute biome totals after mortality
        alive3 = self.pop > 0
        alive3_idx = np.where(alive3)[0]
        biome_totals_arr3 = np.zeros(self.num_biomes, dtype=np.int64)
        np.add.at(biome_totals_arr3, self.bid_int_arr[alive3_idx], self.pop[alive3_idx])
        bt_per_entry3 = biome_totals_arr3[self.bid_int_arr]

        # Vectorized threshold computation
        effective_threshold = np.where(self.pop < 10, repro_threshold * 0.5, repro_threshold)

        # Eligible mask: alive, not legendary, fed enough, biome not at capacity
        repro_eligible = (
            alive3
            & ~self.is_legendary_arr
            & (self.food >= effective_threshold)
            & (bt_per_entry3 < biome_cap_per_entry)
        )

        repro_indices = np.where(repro_eligible)[0]
        for i in repro_indices:
            pokemon_id = self.keys[i][0]
            biome_id = self.keys[i][1]
            params = self.sim_params.get(pokemon_id)
            if not params:
                continue

            # Logistic growth
            bint = self.bid_int_arr[i]
            num_species_in_biome = int(biome_species_counts_arr[bint])
            biome_cap = float(biome_cap_per_entry[i])
            species_niche = biome_cap / max(1, num_species_in_biome)
            niche_saturation = int(self.pop[i]) / max(1, species_niche * 3)
            growth_factor = max(0.0, 1.0 - niche_saturation)

            base_birth = min(0.5, params["repro_rate"] / 100.0)

            # Producer seed dispersal
            if self.is_producer[i]:
                base_birth *= 2.0

            # Prey-pressure bonus
            num_predators = int(self.predator_count_arr[i])
            if num_predators > 10:
                prey_pressure_bonus = 1.0 + min(1.0, (num_predators - 10) / 20.0)
                base_birth *= prey_pressure_bonus

            birth_rate = min(0.7, base_birth) * growth_factor
            if birth_rate <= 0.001:
                continue

            births = _binomial(int(self.pop[i]), birth_rate)

            if births > 0:
                baby_id = int(self.base_form_arr[i])
                pending_births.append((baby_id, biome_id, births, i))

                if births > 20 and births > int(self.pop[i]) * 0.3:
                    events.append(("population_boom", pokemon_id, biome_id,
                                   f"Rapid growth: {births} births"))

        # Apply births
        for baby_id, biome_id, count, parent_idx in pending_births:
            baby_key = (baby_id, biome_id)
            idx = self.key_to_idx.get(baby_key)
            if idx is not None:
                self.pop[idx] += count
            else:
                idx = self._add_new_entry(baby_id, biome_id, count, 0.8, 100.0, 0)

        # --- Phase 6: Evolution ---
        base_evo_rate = self.config.get("base_evolution_rate", 0.02)
        evo_stability = int(self.config.get("evolution_stability_ticks", 50))
        pending_evolutions = []

        alive4 = self.pop > 0
        for i in np.where(alive4)[0]:
            pokemon_id = self.keys[i][0]
            params = self.sim_params.get(pokemon_id)
            if not params or not params["evo_threshold"]:
                continue

            evolutions = self.evolution_map.get(pokemon_id, [])
            if not evolutions:
                continue

            if self.ticks_stable[i] < evo_stability:
                continue
            if self.food[i] < repro_threshold:
                continue

            evo_rate = base_evo_rate * (1.0 / max(0.1, params["evo_threshold"]))

            for to_pokemon_id, min_pop, order in evolutions:
                if int(self.pop[i]) < min_pop:
                    continue

                evolved = _binomial(int(self.pop[i]), evo_rate)
                if evolved > 0:
                    evolved = min(evolved, int(self.pop[i]))
                    self.pop[i] -= evolved
                    pending_evolutions.append((
                        to_pokemon_id, self.keys[i][1], evolved,
                        float(self.food[i]), float(self.health[i])
                    ))
                    if len(evolutions) > 1:
                        break

        # Apply evolutions
        evolved_counts = {}
        for to_pokemon_id, biome_id, count, food, health in pending_evolutions:
            evo_key = (to_pokemon_id, biome_id)
            idx = self.key_to_idx.get(evo_key)
            if idx is not None:
                self.pop[idx] += count
            else:
                idx = self._add_new_entry(to_pokemon_id, biome_id, count, food, health, 0)
            evolved_counts[evo_key] = evolved_counts.get(evo_key, 0) + count

        for (pokemon_id, biome_id), total in evolved_counts.items():
            if total > 5:
                events.append(("evolution_wave", pokemon_id, biome_id,
                               f"{total} evolved"))

        # --- Phase 7: Migration ---
        migration_pairs = []

        alive5 = self.pop > 2
        migration_candidates = np.where(alive5)[0]

        for i in migration_candidates:
            pokemon_id = self.keys[i][0]
            biome_id = self.keys[i][1]
            params = self.sim_params.get(pokemon_id)
            if not params:
                continue

            migration_rate = params["migration"]
            if random.random() > migration_rate:
                continue

            # Find adjacent biomes this pokemon can live in using pre-built lookup
            adjacent = self.biome_adjacency.get(biome_id, set())
            known_biomes = self.pokemon_biomes.get(pokemon_id, set())
            other_biomes = [b for b in known_biomes if b != biome_id and b in adjacent]
            if not other_biomes:
                continue

            pop_i = int(self.pop[i])
            migrants = max(1, int(pop_i * 0.1))
            migrants = min(migrants, pop_i - 1)

            target_biome = random.choice(other_biomes)
            migration_pairs.append((i, (pokemon_id, target_biome), migrants))

        # Apply migrations
        for from_idx, to_key, count in migration_pairs:
            self.pop[from_idx] -= count
            to_idx = self.key_to_idx.get(to_key)
            if to_idx is not None:
                self.pop[to_idx] += count
            else:
                to_idx = self._add_new_entry(
                    to_key[0], to_key[1], count,
                    float(self.food[from_idx]),
                    float(self.health[from_idx]), 0
                )

            if count > 10:
                events.append(("mass_migration", self.keys[from_idx][0], self.keys[from_idx][1],
                               f"{count} migrated to biome {to_key[1]}"))

        # --- Phase 8: Update stability counters ---
        # Vectorized stability check
        N_cur = len(self.keys)
        if len(prev_pop) < N_cur:
            # New entries were added; extend prev_pop with zeros
            prev_pop = np.concatenate([prev_pop, np.zeros(N_cur - len(prev_pop), dtype=np.int32)])

        prev_safe = np.maximum(prev_pop[:N_cur], 1)
        change_ratio = np.abs(self.pop[:N_cur].astype(np.float32) - prev_pop[:N_cur].astype(np.float32)) / prev_safe.astype(np.float32)
        stable_mask = (prev_pop[:N_cur] > 0) & (change_ratio < 0.1)
        self.ticks_stable[:N_cur] = np.where(stable_mask, self.ticks_stable[:N_cur] + 1, 0)

        return events

    def _save_snapshot(self, tick):
        """Save current state to population_snapshots."""
        cur = self.conn.cursor()
        rows = []
        alive_indices = np.where(self.pop > 0)[0]
        for i in alive_indices:
            rows.append((
                tick, self.keys[i][0], self.keys[i][1],
                int(self.pop[i]),
                float(self.health[i]),
                0, 0,  # births/deaths tracked separately in future
                0, 0,  # immigrations/emigrations
                float(self.food[i]),
            ))

        if rows:
            execute_values(
                cur,
                """INSERT INTO population_snapshots
                   (tick, pokemon_id, biome_id, population, avg_health,
                    births, deaths, immigrations, emigrations, food_satiation)
                   VALUES %s""",
                rows,
            )
        self.conn.commit()
        cur.close()

    def _save_events(self, tick, events):
        """Save ecosystem events."""
        cur = self.conn.cursor()
        rows = [(tick, etype, pid, bid, desc, '{}')
                for etype, pid, bid, desc in events]
        if rows:
            execute_values(
                cur,
                """INSERT INTO ecosystem_events
                   (tick, event_type, pokemon_id, biome_id, description, metadata)
                   VALUES %s""",
                rows,
            )
        self.conn.commit()
        cur.close()

    def _save_state_to_db(self):
        """Write in-memory state back to simulation_state table."""
        self._sync_arrays_to_state()
        cur = self.conn.cursor()
        cur.execute("DELETE FROM simulation_state")

        rows = [(pid, bid, s["population"], s["food_satiation"], s["health"], s["ticks_stable"])
                for (pid, bid), s in self.state.items()
                if s["population"] > 0]

        if rows:
            execute_values(
                cur,
                """INSERT INTO simulation_state
                   (pokemon_id, biome_id, population, food_satiation, health, ticks_stable)
                   VALUES %s""",
                rows,
            )
        self.conn.commit()
        cur.close()

    def close(self):
        """Save final state and close connection."""
        self._save_state_to_db()
        cur = self.conn.cursor()
        cur.execute("UPDATE simulation_metadata SET value = 'stopped' WHERE key = 'status'")
        self.conn.commit()
        cur.close()
        self.conn.close()
