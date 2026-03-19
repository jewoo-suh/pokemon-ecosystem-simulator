import { useRef, useEffect, useMemo } from 'react';

const EVENT_ICONS = {
  extinction: { icon: '\u2620', color: '#e86b8a' },
  fire: { icon: '\uD83D\uDD25', color: '#e8944a' },
  drought: { icon: '\u2600', color: '#e8944a' },
  flood: { icon: '\uD83C\uDF0A', color: '#5b9bd5' },
  bloom: { icon: '\uD83C\uDF3F', color: '#5cb85c' },
  disease: { icon: '\uD83E\uDDA0', color: '#8b6bbf' },
  disaster: { icon: '\u26A0', color: '#e86b8a' },
  season_change: { icon: '\uD83C\uDF43', color: '#9a9aad' },
};

const DEFAULT_ICON = { icon: '\u2139', color: '#9a9aad' };

export default function EventLog({ animFrame, selectedBiomeId, biomeTimeseries }) {
  const scrollRef = useRef(null);

  // Collect all events up to current tick
  const events = useMemo(() => {
    if (!animFrame?.allEvents && !animFrame?.events) return [];

    let evts = animFrame.allEvents || animFrame.events;
    // Filter out season changes for cleaner log
    evts = evts.filter(e => e.type !== 'season_change');
    // Filter by selected biome if applicable
    if (selectedBiomeId != null) {
      evts = evts.filter(e =>
        e.biome_id === selectedBiomeId ||
        e.type === 'disaster' ||
        e.type === 'disease'
      );
    }
    return evts;
  }, [animFrame?.allEvents, animFrame?.events, selectedBiomeId]);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className="card" style={{ padding: '12px 14px', maxHeight: 160, display: 'flex', flexDirection: 'column' }}>
      <div className="panel-title">Events</div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {events.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', padding: '8px 0' }}>
            No events yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {events.map((e, i) => {
              const style = EVENT_ICONS[e.type] || DEFAULT_ICON;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 11, padding: '2px 0',
                }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>{style.icon}</span>
                  <span style={{
                    color: style.color, fontWeight: 500, flex: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {formatEvent(e)}
                  </span>
                  <span style={{
                    fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', flexShrink: 0,
                  }}>
                    T{e.tick}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function formatEvent(e) {
  switch (e.type) {
    case 'extinction': return `${e.species_name} extinct`;
    case 'season_change': return `${e.season} begins`;
    case 'disaster': return e.detail || 'Population crash';
    case 'disease': return e.detail || 'Disease outbreak';
    case 'fire': return `Fire in ${e.biome_name || 'biome'}`;
    case 'drought': return `Drought in ${e.biome_name || 'biome'}`;
    case 'flood': return `Flood in ${e.biome_name || 'biome'}`;
    case 'bloom': return `Bloom in ${e.biome_name || 'biome'}`;
    default: return e.detail || e.type;
  }
}
