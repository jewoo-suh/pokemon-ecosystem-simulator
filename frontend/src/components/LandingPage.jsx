import { motion } from 'framer-motion';

export default function LandingPage({ onEnter }) {
  return (
    <div style={{
      height: '100vh', width: '100vw',
      background: 'var(--bg-primary)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Background decoration — soft gradient circles */}
      <div style={{
        position: 'absolute', top: '-20%', right: '-10%',
        width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,108,240,0.08) 0%, transparent 70%)',
      }} />
      <div style={{
        position: 'absolute', bottom: '-15%', left: '-5%',
        width: 500, height: 500, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(91,155,213,0.06) 0%, transparent 70%)',
      }} />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        style={{ textAlign: 'center', zIndex: 1, maxWidth: 600, padding: '0 24px' }}
      >
        {/* Tiny badge */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 14px', borderRadius: 100,
            background: 'var(--accent-bg)', color: 'var(--accent)',
            fontSize: 12, fontWeight: 600, marginBottom: 24,
            letterSpacing: 0.5,
          }}
        >
          1,025 species / 66 biomes / seasonal cycles
        </motion.div>

        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 48, fontWeight: 700,
          lineHeight: 1.1, marginBottom: 16,
          color: 'var(--text-primary)',
          letterSpacing: '-0.03em',
        }}>
          Pokemon
          <br />
          <span style={{ color: 'var(--accent)' }}>Ecosystem</span> Simulator
        </h1>

        <p style={{
          fontSize: 16, lineHeight: 1.7,
          color: 'var(--text-secondary)',
          marginBottom: 40, maxWidth: 460, margin: '0 auto 40px',
        }}>
          Watch 1,025 Pokemon species compete, evolve, and survive across
          a procedurally generated world with seasons, natural disasters,
          and ecological dynamics.
        </p>

        <motion.button
          whileHover={{ scale: 1.03, boxShadow: '0 8px 30px rgba(124,108,240,0.25)' }}
          whileTap={{ scale: 0.97 }}
          onClick={onEnter}
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-lg)',
            padding: '14px 36px',
            fontSize: 15,
            fontWeight: 600,
            fontFamily: 'var(--font-display)',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-lg)',
            letterSpacing: 0.3,
          }}
        >
          Enter World
        </motion.button>

        {/* Tech stack pills */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          style={{
            marginTop: 48,
            display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap',
          }}
        >
          {['Python', 'PostgreSQL', 'FastAPI', 'dbt', 'React', 'Three.js'].map(tech => (
            <span key={tech} style={{
              padding: '4px 12px', borderRadius: 100,
              background: 'var(--bg-secondary)',
              color: 'var(--text-muted)',
              fontSize: 11, fontWeight: 500,
            }}>
              {tech}
            </span>
          ))}
        </motion.div>
      </motion.div>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        style={{
          position: 'absolute', bottom: 24,
          color: 'var(--text-muted)', fontSize: 12,
        }}
      >
        Built by Jewoo Suh — Data Architect Portfolio Project
      </motion.div>
    </div>
  );
}
