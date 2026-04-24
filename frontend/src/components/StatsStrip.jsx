import { useMemo, useRef, useEffect, useState } from 'react';

const EVENT_ICON = {
  extinction: '💀', food_chain_collapse: '📉', fire: '🔥', flood: '🌊',
  drought: '🏜️', disease: '🦠', bloom: '🌸', population_boom: '📈',
  mass_migration: '🧭', evolution_wave: '✨', disaster: '⚠️',
  invasive_species: '⚠️', equilibrium_reached: '⚖️', season_change: '🌱',
};

export default function StatsStrip({ currentTick, animFrame, popHistory }) {
  const lastPopRef = useRef(null);
  const [lastEvent, setLastEvent] = useState(null);

  // Track most-recent event across frames
  useEffect(() => {
    if (!animFrame?.events || animFrame.events.length === 0) return;
    const meaningful = animFrame.events.find(e => e.type !== 'season_change') || animFrame.events[0];
    setLastEvent({ ...meaningful, seenTick: animFrame.tick });
  }, [animFrame?.events, animFrame?.tick]);

  const stats = useMemo(() => {
    if (!animFrame?.species) return null;

    const aliveIds = new Set();
    const popBySpecies = {};
    let totalPop = 0;
    for (const sp of animFrame.species) {
      if (sp.population > 0) aliveIds.add(sp.id);
      popBySpecies[sp.id] = (popBySpecies[sp.id] || 0) + sp.population;
      totalPop += sp.population;
    }
    const topEntries = Object.entries(popBySpecies).sort((a, b) => b[1] - a[1]).slice(0, 1);
    const topId = topEntries[0]?.[0];
    const topPop = topEntries[0]?.[1] || 0;
    const topName = animFrame.species.find(sp => String(sp.id) === topId)?.name || '—';

    // Pop delta from last observed tick
    let popDelta = 0;
    if (lastPopRef.current != null) popDelta = totalPop - lastPopRef.current;
    lastPopRef.current = totalPop;

    return {
      alive: aliveIds.size,
      totalPop,
      topName,
      topPop,
      popDelta,
    };
  }, [animFrame]);

  const Cell = ({ label, value, accent }) => (
    <div className="strip-cell">
      <span className="strip-label">{label}</span>
      <span className="strip-value" style={accent ? { color: accent } : undefined}>{value}</span>
    </div>
  );

  return (
    <div className="stats-strip">
      <Cell label="TICK" value={currentTick.toString().padStart(4, '0')} accent="#8caaff" />
      <Cell label="SEASON" value={(animFrame?.season || '—').toUpperCase().slice(0, 3)} />
      <Cell
        label="ALIVE"
        value={stats ? `${stats.alive}` : '—'}
        accent={stats && stats.alive < 500 ? '#e8944a' : undefined}
      />
      <Cell
        label="POP"
        value={stats ? stats.totalPop.toLocaleString() : '—'}
      />
      {stats && (
        <Cell
          label="Δ"
          value={stats.popDelta === 0 ? '0' : `${stats.popDelta > 0 ? '+' : ''}${stats.popDelta.toLocaleString()}`}
          accent={stats.popDelta > 0 ? '#6ad8a0' : stats.popDelta < 0 ? '#e86b8a' : undefined}
        />
      )}
      <Cell
        label="TOP"
        value={stats ? `${stats.topName} ${stats.topPop.toLocaleString()}` : '—'}
        accent="#f0c060"
      />
      <Cell
        label="LAST EVENT"
        value={
          lastEvent ? (
            <>
              <span style={{ marginRight: 4 }}>{EVENT_ICON[lastEvent.type] || '•'}</span>
              <span>T{lastEvent.tick} {lastEvent.type.replace(/_/g, ' ')}</span>
              {lastEvent.biome_name && <span style={{ opacity: 0.6 }}> · {lastEvent.biome_name}</span>}
            </>
          ) : '—'
        }
      />
    </div>
  );
}
