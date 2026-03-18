"""Long-term simulation comparison: Phase 1 (no seasons) vs Phase 2 (seasons + events)"""
from engine import SimulationEngine
from collections import defaultdict
import numpy as np

# ============================================
# RUN 1: Phase 2 (seasons + events) - 1000 ticks
# ============================================
print("Running Phase 2 (seasons + events)...")
engine = SimulationEngine()
engine.load_data()
engine.initialize_world()
engine._build_arrays()

p2_series = []
p2_events = defaultdict(int)

for tick in range(1, 1001):
    events = engine._run_tick(tick)
    total_pop = int(engine.pop.sum())
    alive = int((engine.pop > 0).sum())
    season, _ = engine.get_season(tick)
    p2_series.append((tick, total_pop, alive, season))
    for etype, pid, bid, desc in events:
        p2_events[etype] += 1

p2_unique_alive = set()
for i in range(len(engine.keys)):
    if engine.pop[i] > 0:
        p2_unique_alive.add(engine.keys[i][0])

p2_diversity = engine.compute_diversity_indices()
engine.close()

# ============================================
# RUN 2: Phase 1 style (no seasons, no events) - 1000 ticks
# ============================================
print("\nRunning Phase 1 (no seasons, no events)...")
engine2 = SimulationEngine()
engine2.load_data()
engine2.initialize_world()
engine2._build_arrays()

# Override season to neutral
orig = SimulationEngine.get_season
SimulationEngine.get_season = staticmethod(lambda tick: ("none", {
    "food_regen": 1.0, "metabolism": 1.0, "grazing": 1.0,
    "mortality": 1.0, "reproduction": 1.0, "migration": 1.0, "predation": 1.0,
}))
# Override random events
engine2._roll_random_event = lambda tick, sn: None

p1_series = []
for tick in range(1, 1001):
    events = engine2._run_tick(tick)
    total_pop = int(engine2.pop.sum())
    alive = int((engine2.pop > 0).sum())
    p1_series.append((tick, total_pop, alive))

p1_unique_alive = set()
for i in range(len(engine2.keys)):
    if engine2.pop[i] > 0:
        p1_unique_alive.add(engine2.keys[i][0])

# Restore for diversity calc
SimulationEngine.get_season = orig
p1_diversity = engine2.compute_diversity_indices()
engine2.close()

# ============================================
# REPORT
# ============================================
print("\n" + "=" * 80)
print("LONG-TERM SIMULATION COMPARISON: 1000 TICKS (10 YEARS)")
print("=" * 80)

print(f"\n{'Metric':<35} {'Phase 1 (no seasons)':>20} {'Phase 2 (seasons)':>20}")
print("-" * 80)

for t in [100, 200, 500, 1000]:
    p1_pop = p1_series[t-1][1]
    p2_pop = p2_series[t-1][1]
    print(f"  Population at T{t:<20} {p1_pop:>20,} {p2_pop:>20,}")

print()
p1g = p1_diversity["global"]
p2g = p2_diversity["global"]
print(f"  Final Population              {p1g['population']:>20,} {p2g['population']:>20,}")
print(f"  Unique Species Alive          {len(p1_unique_alive):>20} {len(p2_unique_alive):>20}")
print(f"  Shannon Index H'              {p1g['shannon']:>20.4f} {p2g['shannon']:>20.4f}")
print(f"  Simpson Index 1-D             {p1g['simpson']:>20.4f} {p2g['simpson']:>20.4f}")
print(f"  Evenness                      {p1g['evenness']:>20.4f} {p2g['evenness']:>20.4f}")
print(f"  Species Richness              {p1g['richness']:>20} {p2g['richness']:>20}")

p1fw = p1_diversity["food_web"]
p2fw = p2_diversity["food_web"]
print(f"  Food Web Links                {p1fw['links']:>20,} {p2fw['links']:>20,}")
print(f"  Connectance                   {p1fw['connectance']:>20.6f} {p2fw['connectance']:>20.6f}")
print(f"  Links/Species                 {p1fw['links_per_species']:>20.1f} {p2fw['links_per_species']:>20.1f}")

print("\n  Trophic Pyramid:")
for trophic in ["producer", "primary_consumer", "secondary_consumer", "apex_predator", "decomposer"]:
    p1t = p1_diversity["per_trophic"].get(trophic, {"species_count": 0, "population": 0, "proportion": 0})
    p2t = p2_diversity["per_trophic"].get(trophic, {"species_count": 0, "population": 0, "proportion": 0})
    print(f"    {trophic:22s}  P1: {p1t['species_count']:3d}spp {p1t['population']:>7,} ({p1t['proportion']*100:5.1f}%)  |  P2: {p2t['species_count']:3d}spp {p2t['population']:>7,} ({p2t['proportion']*100:5.1f}%)")

# Stabilization analysis
print("\n" + "=" * 80)
print("STABILIZATION ANALYSIS")
print("=" * 80)

p1_late = [p for _, p, _ in p1_series[800:]]
p1_mid = [p for _, p, _ in p1_series[600:800]]
p2_late = [p for _, p, _, _ in p2_series[800:]]
p2_mid = [p for _, p, _, _ in p2_series[600:800]]

p1_trend = (np.mean(p1_late) - np.mean(p1_mid)) / np.mean(p1_mid) * 100
p2_trend = (np.mean(p2_late) - np.mean(p2_mid)) / np.mean(p2_mid) * 100

print(f"  Pop change T600-800 vs T800-1000:")
print(f"    Phase 1: {np.mean(p1_mid):>10,.0f} -> {np.mean(p1_late):>10,.0f} ({p1_trend:+.2f}%)")
print(f"    Phase 2: {np.mean(p2_mid):>10,.0f} -> {np.mean(p2_late):>10,.0f} ({p2_trend:+.2f}%)")

p1_cv = np.std(p1_late) / np.mean(p1_late) * 100
p2_cv = np.std(p2_late) / np.mean(p2_late) * 100
print(f"  Population stability (CV%, last 200 ticks):")
print(f"    Phase 1: {p1_cv:.2f}%")
print(f"    Phase 2: {p2_cv:.2f}%")

# Seasonal oscillation
print("\n" + "=" * 80)
print("SEASONAL PATTERNS (Phase 2, Years 6-10)")
print("=" * 80)
late_seasons = defaultdict(list)
for tick, pop, alive, season in p2_series[500:]:
    late_seasons[season].append(pop)

for s in ["spring", "summer", "autumn", "winter"]:
    pops = late_seasons[s]
    swing = (np.max(pops) - np.min(pops)) / np.mean(pops) * 100
    print(f"  {s:8s}: avg={np.mean(pops):>10,.0f}  min={np.min(pops):>10,}  max={np.max(pops):>10,}  range={swing:.1f}%")

# Year by year
print("\n" + "=" * 80)
print("YEAR-BY-YEAR POPULATION")
print("=" * 80)
print(f"{'Year':>6} {'P1 Pop':>12} {'P1 Species':>12} {'P2 Pop':>12} {'P2 Species':>12} {'Diff':>10}")
for yr in range(1, 11):
    t = yr * 100
    p1_pop, p1_alive = p1_series[t-1][1], p1_series[t-1][2]
    p2_pop, p2_alive = p2_series[t-1][1], p2_series[t-1][2]
    diff = p2_pop - p1_pop
    print(f"{yr:>6} {p1_pop:>12,} {p1_alive:>12,} {p2_pop:>12,} {p2_alive:>12,} {diff:>+10,}")

# Events
print("\n  Random Events (Phase 2):")
for etype in ["drought", "disease", "fire", "flood", "bloom"]:
    if etype in p2_events:
        print(f"    {etype:15s}: {p2_events[etype]:>4}")

# Verdict
print("\n" + "=" * 80)
print("VERDICT")
print("=" * 80)

verdicts = []
if p2g["shannon"] > p1g["shannon"]:
    verdicts.append("+ Phase 2 has HIGHER biodiversity (Shannon H')")
else:
    verdicts.append("- Phase 1 has higher biodiversity (Shannon H')")

if len(p2_unique_alive) >= len(p1_unique_alive):
    verdicts.append(f"+ Phase 2 kept {len(p2_unique_alive)} species alive (vs {len(p1_unique_alive)})")
else:
    verdicts.append(f"- Phase 1 kept more species alive ({len(p1_unique_alive)} vs {len(p2_unique_alive)})")

if abs(p2_trend) < abs(p1_trend):
    verdicts.append("+ Phase 2 population is MORE STABLE long-term")
else:
    verdicts.append("- Phase 1 population is more stable long-term")

if p2g["evenness"] > p1g["evenness"]:
    verdicts.append("+ Phase 2 has BETTER evenness (more equitable distribution)")
else:
    verdicts.append("- Phase 1 has better evenness")

if p2_cv > p1_cv:
    verdicts.append("+ Phase 2 has MORE VARIATION (seasonal cycles = realistic)")
else:
    verdicts.append("- Phase 1 has more variation")

for v in verdicts:
    print(f"  {v}")

print()
if sum(1 for v in verdicts if v.startswith("+")) >= 3:
    print("  >>> Phase 2 is the BETTER simulation overall")
else:
    print("  >>> Mixed results - tradeoffs between the two approaches")
