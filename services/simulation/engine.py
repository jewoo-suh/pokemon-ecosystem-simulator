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
import psycopg2
from psycopg2.extras import execute_values
from config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD


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
        self.biome_capacity = {}
        self.legendaries = set()   # pokemon_ids that are legendary/mythical (immortal)
        self.state = {}            # (pokemon_id, biome_id) -> {population, food_satiation, health, ticks_stable}

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
        for from_id, to_id, min_pop, order in cur.fetchall():
            self.evolution_map.setdefault(from_id, []).append((to_id, min_pop, order))

        # Biome capacities
        cur.execute("SELECT id, carrying_capacity FROM biomes")
        self.biome_capacity = {row[0]: row[1] for row in cur.fetchall()}

        # Legendaries & mythicals (immortal, can't be hunted, don't reproduce)
        cur.execute("SELECT id FROM pokemon WHERE is_legendary = TRUE OR is_mythical = TRUE")
        self.legendaries = {row[0] for row in cur.fetchall()}

        cur.close()
        print(f"  Loaded {len(self.sim_params)} pokemon params")
        print(f"  Loaded {len(self.legendaries)} legendaries/mythicals (immortal)")
        print(f"  Loaded {sum(len(v) for v in self.food_chain.values())} food chain pairs")
        print(f"  Loaded {len(self.biome_capacity)} biomes")

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
        total_pop = sum(s["population"] for s in self.state.values())
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

    def run(self, num_ticks, log_interval=50):
        """Run the simulation for N ticks."""
        cur = self.conn.cursor()
        cur.execute("SELECT value FROM simulation_metadata WHERE key = 'current_tick'")
        current_tick = int(cur.fetchone()[0])
        cur.close()

        print(f"\nRunning simulation: tick {current_tick + 1} to {current_tick + num_ticks}")
        start_time = time.time()

        for i in range(num_ticks):
            current_tick += 1
            events = self._run_tick(current_tick)

            # Save snapshot and events
            self._save_snapshot(current_tick)
            if events:
                self._save_events(current_tick, events)

            # Update metadata
            cur = self.conn.cursor()
            cur.execute("UPDATE simulation_metadata SET value = %s WHERE key = 'current_tick'",
                        (str(current_tick),))
            self.conn.commit()
            cur.close()

            if current_tick % log_interval == 0:
                total_pop = sum(s["population"] for s in self.state.values())
                alive = sum(1 for s in self.state.values() if s["population"] > 0)
                elapsed = time.time() - start_time
                print(f"  Tick {current_tick}: {total_pop} total pop, "
                      f"{alive} active species-biomes, "
                      f"{len(events)} events, "
                      f"{elapsed:.1f}s elapsed")

        total_pop = sum(s["population"] for s in self.state.values())
        elapsed = time.time() - start_time
        print(f"\nSimulation complete: {num_ticks} ticks in {elapsed:.1f}s")
        print(f"  Final population: {total_pop}")

    def _run_tick(self, tick):
        """Execute one simulation tick. Returns list of events."""
        events = []

        # Track populations before this tick for stability check
        prev_populations = {k: v["population"] for k, v in self.state.items()}

        # --- Phase 1: Food regeneration (producers) ---
        for key, state in self.state.items():
            if state["population"] <= 0:
                continue
            pokemon_id = key[0]
            trophic = self.trophic_levels.get(pokemon_id)
            if trophic == "producer":
                # Producers photosynthesize — food regenerates toward 1.0
                state["food_satiation"] = min(1.0, state["food_satiation"] + 0.1)

        # --- Phase 2: Metabolism (everyone gets hungrier, except legendaries) ---
        for key, state in self.state.items():
            if state["population"] <= 0:
                continue
            pokemon_id = key[0]
            if pokemon_id in self.legendaries:
                state["food_satiation"] = 1.0  # legendaries never hunger
                continue
            params = self.sim_params.get(pokemon_id)
            if not params:
                continue

            # Small population scavenging: rare species can forage scraps
            # Reduced metabolism when population is small (less competition for food)
            metabolism = params["metabolism"]
            if state["population"] < 20:
                scavenge_bonus = 1.0 - (state["population"] / 20.0) * 0.5  # up to 50% reduced metabolism
                metabolism *= (1.0 - scavenge_bonus * 0.5)

            state["food_satiation"] = max(0.0, state["food_satiation"] - metabolism)

        # --- Phase 3: Predation (with prey-switching & saturation) ---
        encounter_chance = self.config["predation_encounter_chance"]

        # Pre-compute biome populations for prey-switching
        biome_prey_pops = {}  # biome_id -> {prey_id: population}
        for (pid, bid), s in self.state.items():
            if s["population"] > 0:
                biome_prey_pops.setdefault(bid, {})[pid] = s["population"]

        # Track total kills per prey species-biome this tick (for saturation cap)
        prey_losses = {}  # (prey_id, biome_id) -> total caught so far

        for key, state in self.state.items():
            if state["population"] <= 0:
                continue
            pokemon_id, biome_id = key
            params = self.sim_params.get(pokemon_id)
            if not params:
                continue

            prey_list = self.food_chain.get(pokemon_id, [])
            if not prey_list:
                continue

            # Get total prey available in this biome for prey-switching
            biome_pops = biome_prey_pops.get(biome_id, {})

            for prey_id, base_prob in prey_list:
                # Legendaries can't be hunted
                if prey_id in self.legendaries:
                    continue
                prey_key = (prey_id, biome_id)
                prey_state = self.state.get(prey_key)
                if not prey_state or prey_state["population"] <= 0:
                    continue

                prey_params = self.sim_params.get(prey_id)
                if not prey_params:
                    continue

                # Predation saturation: prey can only lose up to 30% of their
                # starting pop per tick across ALL predators combined.
                # Models finite hunting hours, prey fleeing/hiding after attacks
                start_pop = biome_prey_pops.get(biome_id, {}).get(prey_id, 0)
                max_losses = max(1, int(start_pop * 0.30))
                already_lost = prey_losses.get(prey_key, 0)
                if already_lost >= max_losses:
                    continue  # this prey has been hunted enough this tick

                # Prey-switching: predators focus on abundant prey
                prey_pop = prey_state["population"]
                biome_total = sum(biome_pops.values())
                prey_abundance = prey_pop / max(1, biome_total)
                abundance_mult = 1.0 + prey_abundance * 5.0

                # Refuge effect: small populations are harder to find
                if prey_pop < 20:
                    refuge_mult = prey_pop / 20.0
                    abundance_mult *= refuge_mult

                # Number of encounters this tick
                encounters = int(state["population"] * encounter_chance * abundance_mult)
                if encounters <= 0:
                    continue

                # Per-encounter success rate
                hunt = params["hunt_power"]
                escape = prey_params["escape_power"]
                success_rate = (hunt / (hunt + escape)) * base_prob

                # Predator dilution: species with many predators have each
                # individual predator contribute less (predators compete/interfere)
                num_preds = self.predator_count.get(prey_id, 1)
                if num_preds > 10:
                    dilution = 10.0 / num_preds  # 115 predators -> each is ~9% effective
                    success_rate *= dilution

                # How many prey are caught
                caught = 0
                for _ in range(min(encounters, prey_state["population"])):
                    if random.random() < success_rate:
                        caught += 1

                if caught > 0:
                    # Cap by prey population AND saturation limit
                    remaining_quota = max_losses - already_lost
                    caught = min(caught, prey_state["population"], remaining_quota)
                    prey_state["population"] -= caught
                    prey_losses[prey_key] = already_lost + caught
                    # Predator gets fed
                    food_gain = min(0.3, caught * 0.05 / max(1, state["population"]))
                    state["food_satiation"] = min(1.0, state["food_satiation"] + food_gain)

        # --- Phase 4: Starvation & Natural mortality ---
        mortality_base = self.config["mortality_base_rate"]
        food_scarcity_mult = self.config["food_scarcity_multiplier"]

        for key, state in self.state.items():
            if state["population"] <= 0:
                continue
            pokemon_id, biome_id = key

            # Legendaries are immortal
            if pokemon_id in self.legendaries:
                continue

            params = self.sim_params.get(pokemon_id)
            if not params:
                continue

            mortality = params["mortality"]

            # Starvation increases mortality
            if state["food_satiation"] < 0.3:
                mortality *= food_scarcity_mult

            # Carrying capacity pressure (biome-level)
            biome_cap = self.biome_capacity.get(biome_id, 10000)
            biome_total = sum(
                s["population"] for k, s in self.state.items()
                if k[1] == biome_id and s["population"] > 0
            )
            if biome_total > biome_cap:
                overcrowding = biome_total / biome_cap
                mortality *= overcrowding

            # Intraspecific competition: species that dominate a biome
            # face disease/territorial pressure (density-dependent mortality)
            species_share = state["population"] / max(1, biome_total)
            if species_share > 0.25:
                # Gentle penalty above 25% biome share, ramps up toward monopoly
                dominance_penalty = 1.0 + ((species_share - 0.25) / 0.75) ** 0.7 * 2.0
                mortality *= dominance_penalty

            # Apply deaths
            deaths = 0
            for _ in range(state["population"]):
                if random.random() < mortality:
                    deaths += 1

            state["population"] = max(0, state["population"] - deaths)

            # Check extinction
            if state["population"] == 0 and prev_populations.get(key, 0) > 0:
                events.append(("extinction", pokemon_id, biome_id,
                               f"Population reached 0 in biome"))

        # --- Phase 5: Reproduction ---
        repro_threshold = self.config["reproduction_food_threshold"]

        for key, state in self.state.items():
            if state["population"] <= 0:
                continue
            pokemon_id, biome_id = key

            # Legendaries don't reproduce (there's only one of each)
            if pokemon_id in self.legendaries:
                continue

            params = self.sim_params.get(pokemon_id)
            if not params:
                continue

            # Must be fed enough to reproduce
            # Small populations get a lower threshold (survival pressure)
            effective_threshold = repro_threshold
            if state["population"] < 10:
                effective_threshold *= 0.5  # desperate times, desperate measures
            if state["food_satiation"] < effective_threshold:
                continue

            # Check carrying capacity
            biome_cap = self.biome_capacity.get(biome_id, 10000)
            biome_total = sum(
                s["population"] for k, s in self.state.items()
                if k[1] == biome_id and s["population"] > 0
            )
            if biome_total >= biome_cap:
                continue

            # Logistic growth: reproduction slows as species dominates biome
            # A species can grow beyond its "fair share" but reproduction drops
            num_species_in_biome = sum(
                1 for k, s in self.state.items()
                if k[1] == biome_id and s["population"] > 0
            )
            species_niche = biome_cap / max(1, num_species_in_biome)
            # Allow species to grow up to 3x their fair share before reproduction stops
            niche_saturation = state["population"] / max(1, species_niche * 3)
            # Growth factor: 1.0 at low pop, approaches 0 at 3x niche
            growth_factor = max(0.0, 1.0 - niche_saturation)

            # Birth rate scales with population and repro_rate
            base_birth = min(0.5, params["repro_rate"] / 100.0)

            # Prey-pressure bonus: species with many predators breed faster
            # Models evolutionary pressure — hunted species become prolific breeders
            num_predators = self.predator_count.get(pokemon_id, 0)
            if num_predators > 10:
                # Up to 2x birth rate for heavily hunted species (30+ predators)
                prey_pressure_bonus = 1.0 + min(1.0, (num_predators - 10) / 20.0)
                base_birth *= prey_pressure_bonus

            birth_rate = min(0.6, base_birth) * growth_factor
            if birth_rate <= 0.001:
                continue

            births = 0
            for _ in range(state["population"]):
                if random.random() < birth_rate:
                    births += 1

            state["population"] += births

            # Population boom detection
            if births > 20 and births > state["population"] * 0.3:
                events.append(("population_boom", pokemon_id, biome_id,
                               f"Rapid growth: {births} births"))

        # --- Phase 6: Evolution ---
        base_evo_rate = self.config.get("base_evolution_rate", 0.02)
        evo_stability = int(self.config.get("evolution_stability_ticks", 50))
        pending_evolutions = []  # collect to avoid mutating dict during iteration

        for key, state in list(self.state.items()):
            if state["population"] <= 0:
                continue
            pokemon_id, biome_id = key
            params = self.sim_params.get(pokemon_id)
            if not params or not params["evo_threshold"]:
                continue

            evolutions = self.evolution_map.get(pokemon_id, [])
            if not evolutions:
                continue

            # Conditions: stable population + well fed
            if state["ticks_stable"] < evo_stability:
                continue
            if state["food_satiation"] < repro_threshold:
                continue

            # Per-individual evolution chance
            evo_rate = base_evo_rate * (1.0 / max(0.1, params["evo_threshold"]))

            for to_pokemon_id, min_pop, order in evolutions:
                if state["population"] < min_pop:
                    continue

                evolved = 0
                for _ in range(state["population"]):
                    if random.random() < evo_rate:
                        evolved += 1

                if evolved > 0:
                    evolved = min(evolved, state["population"])
                    state["population"] -= evolved
                    pending_evolutions.append((to_pokemon_id, biome_id, evolved, state["food_satiation"], state["health"]))

                    if len(evolutions) > 1:
                        break  # only evolve into one form per tick

        # Apply evolutions
        evolved_counts = {}
        for to_pokemon_id, biome_id, count, food, health in pending_evolutions:
            evo_key = (to_pokemon_id, biome_id)
            if evo_key not in self.state:
                self.state[evo_key] = {
                    "population": 0,
                    "food_satiation": food,
                    "health": health,
                    "ticks_stable": 0,
                }
            self.state[evo_key]["population"] += count
            evolved_counts[evo_key] = evolved_counts.get(evo_key, 0) + count

        for (pokemon_id, biome_id), total in evolved_counts.items():
            if total > 5:
                events.append(("evolution_wave", pokemon_id, biome_id,
                               f"{total} evolved"))

        # --- Phase 7: Migration ---
        migration_pairs = []  # collect migrations to apply after iteration

        for key, state in self.state.items():
            if state["population"] <= 2:  # need at least 2 to migrate some
                continue
            pokemon_id, biome_id = key
            params = self.sim_params.get(pokemon_id)
            if not params:
                continue

            migration_rate = params["migration"]
            if random.random() > migration_rate:
                continue

            # Find other biomes this pokemon can live in
            other_biomes = [
                k[1] for k in self.state.keys()
                if k[0] == pokemon_id and k[1] != biome_id
            ]
            if not other_biomes:
                continue

            # Migrate a small fraction
            migrants = max(1, int(state["population"] * 0.1))
            migrants = min(migrants, state["population"] - 1)  # leave at least 1

            target_biome = random.choice(other_biomes)
            migration_pairs.append((key, (pokemon_id, target_biome), migrants))

        # Apply migrations
        for from_key, to_key, count in migration_pairs:
            self.state[from_key]["population"] -= count
            if to_key not in self.state:
                self.state[to_key] = {
                    "population": 0,
                    "food_satiation": self.state[from_key]["food_satiation"],
                    "health": self.state[from_key]["health"],
                    "ticks_stable": 0,
                }
            self.state[to_key]["population"] += count

            if count > 10:
                events.append(("mass_migration", from_key[0], from_key[1],
                               f"{count} migrated to biome {to_key[1]}"))

        # --- Phase 8: Update stability counters ---
        for key, state in self.state.items():
            prev = prev_populations.get(key, 0)
            curr = state["population"]
            if prev > 0 and abs(curr - prev) / max(prev, 1) < 0.1:
                state["ticks_stable"] += 1
            else:
                state["ticks_stable"] = 0

        return events

    def _save_snapshot(self, tick):
        """Save current state to population_snapshots."""
        cur = self.conn.cursor()
        rows = []
        for (pokemon_id, biome_id), state in self.state.items():
            if state["population"] <= 0:
                continue
            rows.append((
                tick, pokemon_id, biome_id,
                state["population"],
                state["health"],
                0, 0,  # births/deaths tracked separately in future
                0, 0,  # immigrations/emigrations
                state["food_satiation"],
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
