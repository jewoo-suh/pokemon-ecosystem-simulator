import { motion } from 'framer-motion';

const TROPHIC_COLORS = {
  producer: 'var(--trophic-producer)',
  primary_consumer: 'var(--trophic-primary)',
  secondary_consumer: 'var(--trophic-secondary)',
  apex_predator: 'var(--trophic-apex)',
  decomposer: 'var(--trophic-decomposer)',
};

const TROPHIC_LABELS = {
  producer: 'Producers',
  primary_consumer: 'Herbivores',
  secondary_consumer: 'Carnivores',
  apex_predator: 'Apex Predators',
  decomposer: 'Decomposers',
};

function getSeason(tick) {
  const t = tick % 100;
  if (t < 25) return 'spring';
  if (t < 50) return 'summer';
  if (t < 75) return 'autumn';
  return 'winter';
}

export default function StatsPanel({ overview, trophic, currentTick, season: seasonProp }) {
  if (!overview) return null;

  const season = seasonProp || getSeason(currentTick);
  const year = Math.floor(currentTick / 100) + 1;

  const maxPop = trophic ? Math.max(...trophic.map(t => t.total_population)) : 1;

  return (
    <motion.div
      className="card-glass fade-in"
      style={{ padding: '16px 18px' }}
    >
      {/* Season + Year */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`badge badge-${season}`} style={{ textTransform: 'capitalize' }}>
            {season}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Year {year}
          </span>
        </div>
        <span style={{
          fontSize: 11, color: 'var(--text-muted)',
          fontFamily: 'monospace',
        }}>
          T{currentTick}
        </span>
      </div>

      {/* Key stats */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 10, marginBottom: 16,
      }}>
        <StatBox label="Population" value={overview.total_population?.toLocaleString()} />
        <StatBox label="Species" value={`${overview.living_species} / ${overview.total_species}`} />
        <StatBox label="Survival" value={`${overview.survival_rate}%`} accent />
        <StatBox label="Biomes" value="66" />
      </div>

      {/* Trophic pyramid */}
      {trophic && (
        <div>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
            marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase',
          }}>
            Trophic Pyramid
          </div>
          {['apex_predator', 'secondary_consumer', 'primary_consumer', 'producer', 'decomposer'].map(level => {
            const t = trophic.find(x => x.level === level);
            if (!t) return null;
            const width = maxPop > 0 ? (t.total_population / maxPop) * 100 : 0;
            return (
              <div key={level} style={{ marginBottom: 6 }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  fontSize: 11, marginBottom: 2,
                }}>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {TROPHIC_LABELS[level]}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    {t.total_population?.toLocaleString()}
                  </span>
                </div>
                <div style={{
                  height: 6, background: 'var(--bg-secondary)',
                  borderRadius: 3, overflow: 'hidden',
                }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${width}%` }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                    style={{
                      height: '100%', borderRadius: 3,
                      background: TROPHIC_COLORS[level],
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

function StatBox({ label, value, accent }) {
  return (
    <div style={{
      padding: '8px 10px',
      background: accent ? 'var(--accent-bg)' : 'var(--bg-secondary)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <div style={{
        fontSize: 10, color: accent ? 'var(--accent)' : 'var(--text-muted)',
        fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
        marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 16, fontWeight: 600,
        fontFamily: 'var(--font-display)',
        color: accent ? 'var(--accent)' : 'var(--text-primary)',
      }}>
        {value}
      </div>
    </div>
  );
}
