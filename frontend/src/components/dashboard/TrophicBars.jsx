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
  apex_predator: 'Apex',
  decomposer: 'Decomposers',
};

const ORDER = ['producer', 'primary_consumer', 'secondary_consumer', 'apex_predator', 'decomposer'];

export default function TrophicBars({ trophic }) {
  if (!trophic || trophic.length === 0) {
    return (
      <div className="card" style={{ padding: '12px 14px' }}>
        <div className="panel-title">Trophic Pyramid</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '12px 0', textAlign: 'center' }}>
          Waiting for data...
        </div>
      </div>
    );
  }

  const maxPop = Math.max(1, ...trophic.map(t => t.total_population));

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="panel-title">Trophic Pyramid</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {ORDER.map(level => {
          const t = trophic.find(x => x.level === level);
          if (!t) return null;
          const pct = (t.total_population / maxPop) * 100;
          return (
            <div key={level}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 11, marginBottom: 2,
              }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {TROPHIC_LABELS[level]}
                </span>
                <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 10 }}>
                  {t.total_population.toLocaleString()}
                </span>
              </div>
              <div style={{
                height: 6, background: 'var(--bg-secondary)',
                borderRadius: 3, overflow: 'hidden',
              }}>
                <motion.div
                  animate={{ width: `${pct}%` }}
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
    </div>
  );
}
