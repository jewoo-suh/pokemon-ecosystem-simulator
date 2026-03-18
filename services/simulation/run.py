"""
Simulation Runner
Entry point for running the Pokemon Ecosystem Simulation.

Usage:
    python run.py                  # Run 100 ticks (default)
    python run.py 500              # Run 500 ticks
    python run.py 1000 --fresh     # Reset world and run 1000 ticks
"""

import sys
from engine import SimulationEngine


def main():
    num_ticks = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    fresh = "--fresh" in sys.argv

    print("=" * 60)
    print("Pokemon Ecosystem Simulator")
    print("=" * 60)

    engine = SimulationEngine()

    print("\nLoading data...")
    engine.load_data()

    if fresh:
        print("\nInitializing fresh world...")
        engine.initialize_world()
    else:
        engine._load_state()
        if not engine.state:
            print("\nNo existing state found, initializing fresh world...")
            engine.initialize_world()
        else:
            engine._build_arrays()
            total_pop = sum(s["population"] for s in engine.state.values())
            print(f"\nResuming: {len(engine.state)} species-biome pairs, {total_pop} total pop")

    engine.run(num_ticks, log_interval=10)

    print("\nSaving final state...")
    engine.close()
    print("Done!")
    print("=" * 60)


if __name__ == "__main__":
    main()
