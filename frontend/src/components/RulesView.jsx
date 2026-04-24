const TROPHIC_COLOR = {
  producer: '#6abf69', primary_consumer: '#5b9bd5',
  secondary_consumer: '#e8944a', apex_predator: '#e86b8a', decomposer: '#8b6bbf',
};

function Section({ title, subtitle, children }) {
  return (
    <section className="rules-section">
      <div className="rules-section-head">
        <h3>{title}</h3>
        {subtitle && <span className="rules-subtitle">{subtitle}</span>}
      </div>
      <div className="rules-section-body">{children}</div>
    </section>
  );
}

function K({ children }) { return <span className="rules-k">{children}</span>; }
function V({ children }) { return <span className="rules-v">{children}</span>; }

function Row({ label, children }) {
  return (
    <div className="rules-row">
      <span className="rules-label">{label}</span>
      <span className="rules-value">{children}</span>
    </div>
  );
}

export default function RulesView() {
  return (
    <div className="rules-view">
      <div className="rules-header">
        <h2 style={{ margin: 0 }}>Simulation Rules</h2>
        <p>
          The model. Each species lives across one or more biomes, governed by ecological
          rules derived from real Pokémon stats. One tick ≈ one day. The simulation runs
          11 ordered phases per tick. Numbers below are pulled directly from
          <code> services/simulation/engine.py</code>.
        </p>
      </div>

      <Section title="1. Tick Loop" subtitle="11 phases run in this order, every tick">
        <ol className="rules-list">
          <li><K>Season</K> — figure out which of the 4 seasons applies (each lasts 25 ticks)</li>
          <li><K>Random events</K> — ~5% chance a disaster or bloom strikes somewhere</li>
          <li><K>Producers photosynthesize</K> — they gain food (+0.15 × season modifier)</li>
          <li><K>Consumers burn food</K> — metabolism drains food each tick</li>
          <li><K>Predators hunt</K> — predation is rolled against the food chain</li>
          <li><K>Starvation &amp; mortality</K> — starving or overcrowded species lose population</li>
          <li><K>Decomposers feed</K> — they gain food from the tick's death pool</li>
          <li><K>Reproduction</K> — well-fed species have babies (binomial sampling)</li>
          <li><K>Evolution</K> — stable, well-fed populations may evolve into their next form</li>
          <li><K>Migration</K> — some individuals move to neighboring biomes</li>
          <li><K>Stability check</K> — track how long each population has been steady</li>
        </ol>
      </Section>

      <Section title="2. Trophic Roles" subtitle="Each species plays one of 5 ecological roles">
        <div className="trophic-grid">
          <div className="trophic-card" style={{ borderLeftColor: TROPHIC_COLOR.producer }}>
            <h4>Producer</h4>
            <p>Generates its own food via photosynthesis (+0.15 per tick, adjusted by
            season). The base of the food web — everything upstream depends on it.
            Helped by <K>bloom</K>, crushed by <K>drought</K>.</p>
          </div>
          <div className="trophic-card" style={{ borderLeftColor: TROPHIC_COLOR.primary_consumer }}>
            <h4>Primary consumer</h4>
            <p>A herbivore. Grazes on producers in the same biome (food gain scales
            with how much vegetation is around). Hunted by secondary consumers and
            apex predators.</p>
          </div>
          <div className="trophic-card" style={{ borderLeftColor: TROPHIC_COLOR.secondary_consumer }}>
            <h4>Secondary consumer</h4>
            <p>A hunter. Each tick, each predator has a 5% chance to encounter a given
            prey; success depends on its hunt_power vs. the prey's escape_power. Can
            kill at most 30% of a prey population per tick.</p>
          </div>
          <div className="trophic-card" style={{ borderLeftColor: TROPHIC_COLOR.apex_predator }}>
            <h4>Apex predator</h4>
            <p>Top of the food chain. Same hunt math as a secondary consumer, just
            pointed at bigger prey. Tends to wipe out its own food source — most
            extinction cascades start here.</p>
          </div>
          <div className="trophic-card" style={{ borderLeftColor: TROPHIC_COLOR.decomposer }}>
            <h4>Decomposer</h4>
            <p>Scavenger. Feeds on whatever died in its biome this tick. The more
            death in the ecosystem, the better they eat. Small, steady role — rarely
            booms or crashes.</p>
          </div>
        </div>
      </Section>

      <Section title="3. Reproduction & Death" subtitle="How populations grow and shrink">
        <div className="rules-cols">
          <div>
            <h4>Births</h4>
            <Row label="Food required">≥ 0.6 to breed (or ≥ 0.3 if pop &lt; 10, to protect tiny populations)</Row>
            <Row label="Birth rate">base_repro ÷ 100 × growth_factor × season modifier</Row>
            <Row label="Growth factor">1 − (pop ÷ niche_capacity)³ — shrinks fast as the niche fills</Row>
            <Row label="Producer bonus">birth rate ×2 (plants breed fast)</Row>
            <Row label="Prey under pressure">birth rate up to ×2 when &gt; 10 predators are hunting them</Row>
            <Row label="Sampling">Binomial — births are random, not a smooth average</Row>
            <Row label="Babies spawn as">Base form. Evolution is a separate step (see §8)</Row>
          </div>
          <div>
            <h4>Deaths</h4>
            <Row label="Starvation">food &lt; 0.3 multiplies mortality ×4</Row>
            <Row label="Overcrowding">mortality × (pop ÷ capacity) when biome is over capacity</Row>
            <Row label="Predation cap">no more than 30% of starting prey pop killed per tick</Row>
            <Row label="Boom event">&gt; 20 births AND &gt; 30% of pop born this tick → logged as a boom</Row>
          </div>
        </div>
      </Section>

      <Section title="4. Predation" subtitle="How predators find and kill prey each tick">
        <ul className="rules-list">
          <li><K>Encounter rate</K>: each predator has a 5% base chance per tick to run into a given prey (modulated by season)</li>
          <li><K>Success rate</K>: hunt_power ÷ (hunt_power + escape_power) — if an encounter happens, this is the probability of a kill</li>
          <li><K>Saturation cap</K>: no more than 30% of the prey's starting population can die in one tick (prevents total wipes)</li>
          <li><K>Prey-switching</K>: when a prey species is abundant, encounter rate jumps ×5 (predators preferentially target whatever's easiest)</li>
          <li><K>Predator competition</K>: when more than 10 predators are after the same prey, each one's success scales by 10 ÷ count</li>
          <li><K>Refuge effect</K>: prey populations under 20 individuals become harder to find (they hide better)</li>
          <li><K>Food reward</K>: predator gains 0.05 food per kill, up to +0.3 per tick</li>
        </ul>
      </Section>

      <Section title="5. Food &amp; Carrying Capacity" subtitle="The two things that limit growth">
        <div className="rules-cols">
          <div>
            <h4>Food (a 0.0–1.0 value, per species per biome)</h4>
            <Row label="Producers gain">+0.15 per tick (scaled by season)</Row>
            <Row label="Consumers lose">metabolism drain each tick</Row>
            <Row label="Carnivores gain">from successful kills</Row>
            <Row label="Decomposers gain">from the death pool</Row>
            <Row label="What it controls">reproduction and evolution both require food ≥ 0.6; food &lt; 0.3 triggers starvation</Row>
          </div>
          <div>
            <h4>Carrying capacity (fixed per biome)</h4>
            <Row label="Niche split">each species gets capacity ÷ species_count as its share</Row>
            <Row label="How full it is">pop ÷ (niche × 3) — determines how strongly growth slows down</Row>
            <Row label="When over capacity">mortality is multiplied by (pop ÷ capacity) until it self-corrects</Row>
            <Row label="Producer regrowth">slows down as the biome approaches capacity</Row>
          </div>
        </div>
      </Section>

      <Section title="6. Seasons" subtitle="Each season lasts 25 ticks · 100 ticks make a year">
        <table className="rules-table">
          <thead>
            <tr>
              <th>Season</th>
              <th>Food regen</th>
              <th>Metabolism</th>
              <th>Mortality</th>
              <th>Reproduction</th>
              <th>Predation</th>
              <th>Migration</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span style={{ color: '#9ae070' }}>● Spring</span> (0-24)</td>
              <td className="num">×1.5</td><td className="num">×0.85</td>
              <td className="num">×0.7</td><td className="num">×1.5</td>
              <td className="num">×0.9</td><td className="num">×1.0</td>
            </tr>
            <tr>
              <td><span style={{ color: '#f0c060' }}>● Summer</span> (25-49)</td>
              <td className="num">×1.2</td><td className="num">×1.0</td>
              <td className="num">×1.0</td><td className="num">×1.0</td>
              <td className="num">×1.0</td><td className="num">×1.0</td>
            </tr>
            <tr>
              <td><span style={{ color: '#e8944a' }}>● Autumn</span> (50-74)</td>
              <td className="num">×0.7</td><td className="num">×1.1</td>
              <td className="num">×1.0</td><td className="num">×1.0</td>
              <td className="num">×1.2</td><td className="num">×1.8</td>
            </tr>
            <tr>
              <td><span style={{ color: '#8caaff' }}>● Winter</span> (75-99)</td>
              <td className="num">×0.3</td><td className="num">×1.3</td>
              <td className="num">×1.6</td><td className="num">×0.15</td>
              <td className="num">×1.0</td><td className="num">×1.0</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="7. Disasters" subtitle="~5% chance per tick · hits one biome at a time">
        <table className="rules-table">
          <thead>
            <tr><th>Type</th><th>Trigger</th><th>Effect</th></tr>
          </thead>
          <tbody>
            <tr><td>🔥 <K>Fire</K></td><td>any biome</td><td>kills 10–30% of all species (25–40% for producers)</td></tr>
            <tr><td>🌊 <K>Flood</K></td><td>any biome</td><td>kills 10–20% of non-water types; water types gain +0.15 food</td></tr>
            <tr><td>🏜️ <K>Drought</K></td><td>summer/autumn weighted</td><td>kills 30–50% of producers; all food −0.2</td></tr>
            <tr><td>🦠 <K>Disease</K></td><td>highest-pop species (&gt; 20)</td><td>kills 20–40%, non-legendary only</td></tr>
            <tr><td>🌸 <K>Bloom</K></td><td>any biome</td><td>+30–60% population for all producers in the biome</td></tr>
          </tbody>
        </table>
      </Section>

      <Section title="8. Evolution" subtitle="How a Charmander becomes a Charizard">
        <p style={{ margin: '0 0 8px', color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>
          A species only evolves once its population is settled and well-fed. All of
          these conditions must hold:
        </p>
        <ul className="rules-list">
          <li>Population ≥ its <K>minimum threshold</K> for that chain step</li>
          <li>Has been <K>stable for 50+ ticks</K> (population moved less than 10%)</li>
          <li>Food ≥ <K>0.6</K></li>
        </ul>
        <p style={{ margin: '8px 0 0', color: 'rgba(255,255,255,0.65)', fontSize: 11 }}>
          Per-tick evolution chance is roughly <K>0.02</K> once gates are met. Evolved
          individuals keep their parent's food and health. If 5+ evolutions happen
          simultaneously in a biome, it gets logged as an <K>evolution_wave</K> event.
        </p>
      </Section>

      <Section title="9. Migration" subtitle="Populations moving between biomes">
        <ul className="rules-list">
          <li>Each species has its own baseline <K>migration rate</K>, boosted by autumn (×1.8)</li>
          <li>Only triggers when the source biome has more than 2 individuals</li>
          <li>When it happens, about 10% of the population relocates to a known neighboring biome</li>
          <li>If 10+ individuals move at once, it's logged as a <K>mass_migration</K> event</li>
        </ul>
      </Section>

      <Section title="10. Legendaries &amp; Mythicals" subtitle="The immortals">
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', margin: '4px 0' }}>
          Species flagged as <K>legendary</K> or <K>mythical</K> are effectively
          immortal: their food is pinned to 1.0, and they can't die from starvation,
          disasters, or predation. They still hunt and reproduce normally. Think of
          them as a safety floor — if everything else collapses, they keep the food
          web from going fully empty.
        </p>
      </Section>

      <Section title="Why things you've seen happen" subtitle="Common patterns, explained">
        <ul className="rules-list">
          <li><V>A population crashes with no disaster event logged:</V> a predator
            boom quietly overwhelmed the saturation cap and cascaded. Open the
            Compare tab and you'll usually see the predator surge right before the
            prey collapse.</li>
          <li><V>Everything oscillates yearly:</V> winter's ×0.15 reproduction and
            ×1.6 mortality grinds weaker populations down every 100 ticks.</li>
          <li><V>A biome goes over 100% capacity for a few ticks:</V> the overshoot
            triggers mortality × (pop ÷ capacity) until it self-corrects — usually
            within 5–10 ticks.</li>
          <li><V>A whole trophic level collapses:</V> when producers crash (typically
            via drought), the rest of the food chain falls upward. Apex predators
            recover last because they need prey populations stable for 50 ticks
            before they'll breed again.</li>
          <li><V>A single species takes over a biome:</V> niche-saturation is supposed
            to prevent this, but if its predator went extinct first, runaway growth
            is real.</li>
        </ul>
      </Section>
    </div>
  );
}
