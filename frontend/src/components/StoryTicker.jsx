import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const EVENT_STYLE = {
  extinction:          { icon: '💀', bg: 'rgba(120, 20, 40, 0.85)',  border: '#e86b8a' },
  food_chain_collapse: { icon: '📉', bg: 'rgba(100, 30, 60, 0.85)',  border: '#e86b8a' },
  disaster:            { icon: '⚠️', bg: 'rgba(180, 60, 40, 0.85)',  border: '#ff9a6a' },
  fire:                { icon: '🔥', bg: 'rgba(200, 70, 30, 0.85)',  border: '#ff9a6a' },
  drought:             { icon: '🏜️', bg: 'rgba(150, 110, 40, 0.85)', border: '#f0c060' },
  flood:               { icon: '🌊', bg: 'rgba(40, 80, 160, 0.85)',  border: '#6aa0ff' },
  disease:             { icon: '🦠', bg: 'rgba(80, 120, 50, 0.85)',  border: '#9ae070' },
  bloom:               { icon: '🌸', bg: 'rgba(170, 90, 140, 0.85)', border: '#ffb0d8' },
  population_boom:     { icon: '📈', bg: 'rgba(40, 120, 80, 0.85)',  border: '#6ad8a0' },
  mass_migration:      { icon: '🧭', bg: 'rgba(60, 100, 140, 0.85)', border: '#8ac0e0' },
  evolution_wave:      { icon: '✨', bg: 'rgba(120, 80, 180, 0.85)', border: '#c090ff' },
  invasive_species:    { icon: '⚠️', bg: 'rgba(140, 40, 40, 0.85)',  border: '#e86b6b' },
  equilibrium_reached: { icon: '⚖️', bg: 'rgba(60, 90, 120, 0.85)',  border: '#90b0d0' },
  season_change:       { icon: '🌱', bg: 'rgba(60, 90, 60, 0.85)',   border: '#a0c080' },
};

const DEFAULT_STYLE = { icon: '•', bg: 'rgba(60, 60, 80, 0.85)', border: '#909090' };
const MAX_EVENTS = 14;

function formatLabel(e) {
  if (e.type === 'season_change') return `${e.season}`;
  if (e.detail) return e.detail;
  if (e.species_name) return e.species_name;
  return e.type.replace(/_/g, ' ');
}

export default function StoryTicker({ events, currentTick }) {
  const [log, setLog] = useState([]);
  const seenRef = useRef(new Set());

  useEffect(() => {
    if (!events || events.length === 0) return;
    setLog(prev => {
      const additions = [];
      for (const e of events) {
        // Stable id per event so AnimatePresence doesn't re-animate
        const id = `${e.tick ?? currentTick}-${e.type}-${e.biome_id ?? ''}-${e.species_name ?? ''}-${e.detail ?? ''}`;
        if (seenRef.current.has(id)) continue;
        seenRef.current.add(id);
        additions.push({ id, tick: e.tick ?? currentTick, ...e });
      }
      if (additions.length === 0) return prev;
      // Newest on the left
      const next = [...additions.reverse(), ...prev].slice(0, MAX_EVENTS);
      return next;
    });
  }, [events, currentTick]);

  // Reset when sim restarts (currentTick drops back)
  useEffect(() => {
    if (currentTick === 0) {
      seenRef.current = new Set();
      setLog([]);
    }
  }, [currentTick]);

  if (log.length === 0) {
    return (
      <div className="story-ticker story-ticker-empty">
        <span style={{ opacity: 0.4, fontSize: 11, fontStyle: 'italic' }}>
          Press play — ecosystem events will appear here.
        </span>
      </div>
    );
  }

  return (
    <div className="story-ticker">
      <AnimatePresence initial={false}>
        {log.map(e => {
          const style = EVENT_STYLE[e.type] || DEFAULT_STYLE;
          const label = formatLabel(e);
          return (
            <motion.div
              key={e.id}
              layout
              initial={{ opacity: 0, x: -40, scale: 0.85 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.3 } }}
              transition={{ type: 'spring', stiffness: 280, damping: 28 }}
              className="story-ticker-pill"
              style={{ background: style.bg, borderLeft: `3px solid ${style.border}` }}
              title={label}
            >
              <span className="story-ticker-icon">{style.icon}</span>
              <span className="story-ticker-tick">T{e.tick}</span>
              <span className="story-ticker-label">{label}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
