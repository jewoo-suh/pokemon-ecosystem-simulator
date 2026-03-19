import { motion, AnimatePresence } from 'framer-motion';

const EVENT_COLORS = {
  extinction: { bg: 'rgba(232, 107, 138, 0.15)', border: 'rgba(232, 107, 138, 0.4)', text: '#e86b8a', icon: '\u2620' },
  fire:       { bg: 'rgba(232, 148, 74, 0.15)',  border: 'rgba(232, 148, 74, 0.4)',  text: '#e8944a', icon: '\uD83D\uDD25' },
  drought:    { bg: 'rgba(232, 148, 74, 0.15)',  border: 'rgba(232, 148, 74, 0.4)',  text: '#e8944a', icon: '\u2600' },
  flood:      { bg: 'rgba(91, 155, 213, 0.15)',  border: 'rgba(91, 155, 213, 0.4)',  text: '#5b9bd5', icon: '\uD83C\uDF0A' },
  bloom:      { bg: 'rgba(92, 184, 92, 0.15)',   border: 'rgba(92, 184, 92, 0.4)',   text: '#5cb85c', icon: '\uD83C\uDF3F' },
  disease:    { bg: 'rgba(139, 107, 191, 0.15)', border: 'rgba(139, 107, 191, 0.4)', text: '#8b6bbf', icon: '\uD83E\uDDA0' },
  disaster:   { bg: 'rgba(232, 107, 138, 0.15)', border: 'rgba(232, 107, 138, 0.4)', text: '#e86b8a', icon: '\u26A0' },
};

const DEFAULT_STYLE = { bg: 'rgba(154, 154, 173, 0.15)', border: 'rgba(154, 154, 173, 0.4)', text: '#9a9aad', icon: '\u2139' };

export default function EventToast({ toasts }) {
  return (
    <div style={{
      position: 'absolute', top: 70, left: 20, zIndex: 20,
      display: 'flex', flexDirection: 'column', gap: 8,
      pointerEvents: 'none',
    }}>
      <AnimatePresence mode="popLayout">
        {toasts.map(toast => {
          const colors = EVENT_COLORS[toast.type] || DEFAULT_STYLE;
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: -30, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -20, scale: 0.95 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="card-glass"
              style={{
                padding: '8px 14px',
                background: colors.bg,
                borderColor: colors.border,
                borderWidth: 1,
                borderStyle: 'solid',
                maxWidth: 260,
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 12, fontWeight: 500,
              }}>
                <span style={{ fontSize: 14 }}>{colors.icon}</span>
                <div>
                  <div style={{ color: colors.text, fontWeight: 600, fontFamily: 'var(--font-display)' }}>
                    {formatEventTitle(toast)}
                  </div>
                  {toast.detail && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                      {toast.detail}
                    </div>
                  )}
                </div>
                <span style={{
                  fontSize: 10, color: 'var(--text-muted)',
                  fontFamily: 'monospace', marginLeft: 'auto',
                }}>
                  T{toast.tick}
                </span>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function formatEventTitle(event) {
  switch (event.type) {
    case 'extinction':
      return `${event.species_name} extinct`;
    case 'fire':
      return `Fire in ${event.biome_name || 'biome'}`;
    case 'drought':
      return `Drought in ${event.biome_name || 'biome'}`;
    case 'flood':
      return `Flood in ${event.biome_name || 'biome'}`;
    case 'bloom':
      return `Bloom in ${event.biome_name || 'biome'}`;
    case 'disease':
      return `Disease outbreak`;
    case 'disaster':
      return 'Population crash';
    default:
      return event.type;
  }
}
