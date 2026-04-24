import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RTooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  getBiomes, getAllBiomeDetails, getBiomeTimeseries,
  getEvents, getTypeBiomeAffinity, getAllSpecies,
} from '../data';

const SPRITE_BASE = import.meta.env.BASE_URL + 'data/sprites/';

const TYPE_COLOR = {
  normal: '#a8a878', fire: '#f08030', water: '#6890f0', electric: '#f8d030',
  grass: '#78c850', ice: '#98d8d8', fighting: '#c03028', poison: '#a040a0',
  ground: '#e0c068', flying: '#a890f0', psychic: '#f85888', bug: '#a8b820',
  rock: '#b8a038', ghost: '#705898', dragon: '#7038f8', dark: '#705848',
  steel: '#b8b8d0', fairy: '#ee99ac',
};

const TROPHIC_COLOR = {
  producer: '#6abf69', primary_consumer: '#5b9bd5',
  secondary_consumer: '#e8944a', apex_predator: '#e86b8a', decomposer: '#8b6bbf',
};

const EVENT_ICON = {
  extinction: '💀', food_chain_collapse: '📉', fire: '🔥', flood: '🌊',
  drought: '🏜️', disease: '🦠', bloom: '🌸', population_boom: '📈',
  mass_migration: '🧭', evolution_wave: '✨', disaster: '⚠️',
  invasive_species: '⚠️', equilibrium_reached: '⚖️', season_change: '🌱',
};

// --- List ---
function BiomeList({ biomes, selectedId, onSelect, details }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');

  const filtered = useMemo(() => {
    if (!biomes) return [];
    let list = [...biomes];
    const q = query.trim().toLowerCase();
    if (q) list = list.filter(b => b.name.toLowerCase().includes(q));
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'pop') list.sort((a, b) => (b.total_population || 0) - (a.total_population || 0));
    else if (sort === 'fill') {
      list.sort((a, b) => (b.total_population / b.carrying_capacity) - (a.total_population / a.carrying_capacity));
    }
    return list;
  }, [biomes, query, sort]);

  return (
    <div className="species-list">
      <input
        className="species-search"
        placeholder="search biomes..."
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <div className="species-sort">
        <button className={sort==='name'?'active':''} onClick={() => setSort('name')}>Name</button>
        <button className={sort==='pop'?'active':''} onClick={() => setSort('pop')}>Population</button>
        <button className={sort==='fill'?'active':''} onClick={() => setSort('fill')}>Fill</button>
      </div>
      <div className="species-list-scroll">
        {filtered.map(b => {
          const fill = b.total_population / b.carrying_capacity;
          return (
            <div
              key={b.id}
              className={`species-row ${selectedId === b.id ? 'selected' : ''}`}
              onClick={() => onSelect(b.id)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="species-row-name" style={{ textTransform: 'capitalize' }}>
                  {b.name.replace(/_/g, ' ')}
                </div>
                <div className="species-row-meta">
                  <span>{b.total_population.toLocaleString()} pop</span>
                  <span>·</span>
                  <span>{b.species_count} species</span>
                </div>
                <div style={{
                  width: '100%', height: 3, background: 'rgba(255,255,255,0.08)',
                  borderRadius: 2, overflow: 'hidden', marginTop: 4,
                }}>
                  <div style={{
                    width: `${Math.min(100, fill * 100)}%`, height: '100%',
                    background: fill > 1 ? '#e86b8a' : fill > 0.7 ? '#e8944a' : '#6ad8a0',
                  }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Detail page ---
function BiomeDetail({
  biomeId, biomes, details, speciesMap,
  biomeTimeseries, events, affinity,
}) {
  const biome = biomes.find(b => b.id === biomeId);
  const detail = details?.[biomeId];
  if (!biome) return null;

  const tsIdx = useMemo(() => {
    if (!biomeTimeseries) return -1;
    return biomeTimeseries.biome_ids.indexOf(biomeId);
  }, [biomeTimeseries, biomeId]);

  const chartData = useMemo(() => {
    if (!biomeTimeseries || tsIdx < 0) return [];
    const ticks = biomeTimeseries.ticks;
    const pop = biomeTimeseries.population[tsIdx];
    const food = biomeTimeseries.avg_food[tsIdx];
    const species = biomeTimeseries.species_count[tsIdx];
    return ticks.map((t, i) => ({
      tick: t,
      population: pop[i],
      food: Math.round((food[i] || 0) * 100),
      species: species[i],
    }));
  }, [biomeTimeseries, tsIdx]);

  const biomeEvents = useMemo(() => {
    if (!events) return [];
    return events
      .filter(e => e.biome_id === biomeId)
      .slice(0, 50);
  }, [events, biomeId]);

  // Affinity profile for this biome: which types thrive here?
  const affinityRows = useMemo(() => {
    if (!affinity) return [];
    const rows = affinity.entries
      .filter(e => e.biome_id === biomeId)
      .map(e => {
        const t = affinity.types.find(tt => tt.id === e.type_id);
        return { type: t?.name || `#${e.type_id}`, affinity: e.affinity };
      });
    rows.sort((a, b) => b.affinity - a.affinity);
    return rows;
  }, [affinity, biomeId]);

  // Trophic composition from current species list
  const trophicBreakdown = useMemo(() => {
    if (!detail?.species) return [];
    const groups = {};
    for (const s of detail.species) {
      const tl = s.trophic_level || 'unknown';
      if (!groups[tl]) groups[tl] = { trophic: tl, count: 0, population: 0 };
      groups[tl].count++;
      groups[tl].population += s.population;
    }
    const total = Object.values(groups).reduce((a, b) => a + b.population, 0) || 1;
    return Object.values(groups)
      .map(g => ({ ...g, pct: g.population / total }))
      .sort((a, b) => b.population - a.population);
  }, [detail]);

  const topSpecies = useMemo(() => {
    if (!detail?.species) return [];
    return [...detail.species].sort((a, b) => b.population - a.population).slice(0, 12);
  }, [detail]);

  const fillPct = biome.total_population / biome.carrying_capacity;

  return (
    <div className="species-detail">
      {/* Header */}
      <div className="species-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, textTransform: 'capitalize', fontSize: 22 }}>
            {biome.name.replace(/_/g, ' ')}
          </h2>
          <div style={{ opacity: 0.55, fontSize: 13, marginTop: 2 }}>
            Biome #{biome.id} · capacity {biome.carrying_capacity.toLocaleString()} · biomass ×{biome.biomass_factor.toFixed(2)}
          </div>
          <div style={{ display: 'flex', gap: 18, fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 10 }}>
            <div><strong style={{ color: '#fff' }}>{biome.total_population.toLocaleString()}</strong> alive</div>
            <div><strong style={{ color: '#fff' }}>{biome.species_count}</strong> species</div>
            <div><strong style={{ color: '#fff' }}>{Math.round(biome.avg_food_satiation * 100)}%</strong> food</div>
            <div>
              <strong style={{ color: fillPct > 1 ? '#e86b8a' : fillPct > 0.7 ? '#e8944a' : '#6ad8a0' }}>
                {Math.round(fillPct * 100)}%
              </strong> full
            </div>
          </div>
        </div>
      </div>

      {/* Trophic composition strip */}
      {trophicBreakdown.length > 0 && (
        <div className="species-chart">
          <div className="species-section-title">Trophic composition</div>
          <div style={{ display: 'flex', height: 16, borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
            {trophicBreakdown.map(g => (
              <div
                key={g.trophic}
                title={`${g.trophic.replace(/_/g, ' ')}: ${g.population.toLocaleString()} (${(g.pct * 100).toFixed(0)}%)`}
                style={{
                  width: `${g.pct * 100}%`,
                  background: TROPHIC_COLOR[g.trophic] || '#888',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 10 }}>
            {trophicBreakdown.map(g => (
              <span key={g.trophic} style={{ color: TROPHIC_COLOR[g.trophic] || '#888' }}>
                ● <span style={{ color: '#fff' }}>
                  {g.trophic.replace(/_/g, ' ')}
                </span> {g.count} sp · {(g.pct * 100).toFixed(0)}%
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Population timeline */}
      <div className="species-chart">
        <div className="species-section-title">Population & food over time</div>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="tick" tick={{ fontSize: 10, fill: '#aaa' }} />
              <YAxis yAxisId="pop" tick={{ fontSize: 10, fill: '#aaa' }} />
              <YAxis yAxisId="food" orientation="right" tick={{ fontSize: 10, fill: '#aaa' }} domain={[0, 100]} />
              <RTooltip contentStyle={{ background: 'rgba(18,18,32,0.97)', border: '1px solid rgba(255,255,255,0.15)', fontSize: 12 }} />
              <Line yAxisId="pop" type="monotone" dataKey="population" stroke="#8caaff" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="food" type="monotone" dataKey="food" stroke="#f0c060" strokeWidth={1.5} dot={false} strokeDasharray="4 4" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ padding: 16, opacity: 0.5, fontSize: 12 }}>No timeseries data.</div>
        )}
        <div style={{ fontSize: 10, opacity: 0.55, display: 'flex', gap: 16, marginTop: 4 }}>
          <span><span style={{ color: '#8caaff' }}>—</span> population</span>
          <span><span style={{ color: '#f0c060' }}>┄</span> food availability %</span>
        </div>
      </div>

      {/* Top species + Type affinity side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="species-chart" style={{ margin: 0 }}>
          <div className="species-section-title">Top species here</div>
          {topSpecies.length === 0 && <div style={{ opacity: 0.5, fontSize: 12 }}>No species active.</div>}
          {topSpecies.map(sp => {
            const maxPop = topSpecies[0].population || 1;
            const barPct = (sp.population / maxPop) * 100;
            const tl = sp.trophic_level || 'producer';
            return (
              <div
                key={sp.pokemon_id}
                onClick={() => { window.location.hash = `species/${sp.pokemon_id}`; }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                  cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
              >
                <img
                  src={`${SPRITE_BASE}${sp.pokemon_id}.png`}
                  width={28} height={28}
                  style={{ imageRendering: 'pixelated', flexShrink: 0 }}
                  onError={e => e.target.style.visibility = 'hidden'}
                  alt=""
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>{sp.name}</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace' }}>
                      {sp.population.toLocaleString()}
                    </span>
                  </div>
                  <div style={{
                    height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2,
                    overflow: 'hidden', marginTop: 2,
                  }}>
                    <div style={{ height: '100%', width: `${barPct}%`, background: TROPHIC_COLOR[tl] }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="species-chart" style={{ margin: 0 }}>
          <div className="species-section-title">Type affinity in this biome</div>
          {affinityRows.length === 0 && <div style={{ opacity: 0.5, fontSize: 12 }}>No affinity data.</div>}
          {affinityRows.map(r => {
            const deviation = r.affinity - 1.0;
            const barWidth = Math.min(Math.abs(deviation) / 0.6, 1) * 50;
            const isPositive = deviation >= 0;
            return (
              <div key={r.type} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                <span className="type-pill-mini" style={{ background: TYPE_COLOR[r.type] || '#888', minWidth: 46, textAlign: 'center' }}>
                  {r.type}
                </span>
                <div style={{ flex: 1, height: 12, position: 'relative', background: 'rgba(255,255,255,0.03)' }}>
                  <div style={{
                    position: 'absolute', left: '50%', top: 0, width: 1, height: '100%',
                    background: 'rgba(255,255,255,0.2)',
                  }} />
                  <div style={{
                    position: 'absolute', top: 0, height: '100%',
                    width: `${barWidth}%`,
                    left: isPositive ? '50%' : `${50 - barWidth}%`,
                    background: isPositive ? '#6ad8a0' : '#e86b8a',
                  }} />
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: 10, minWidth: 36, textAlign: 'right', color: isPositive ? '#6ad8a0' : '#e86b8a', fontWeight: 700 }}>
                  {r.affinity.toFixed(2)}×
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Events in this biome */}
      <div className="species-chart">
        <div className="species-section-title">
          Events in this biome ({biomeEvents.length})
        </div>
        {biomeEvents.length === 0 ? (
          <div style={{ opacity: 0.5, fontSize: 12 }}>No recorded events for this biome.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
            {biomeEvents.map((e, i) => (
              <div key={i} style={{
                display: 'flex', gap: 8, padding: '5px 8px',
                background: 'rgba(255,255,255,0.02)', borderRadius: 4, fontSize: 11,
                alignItems: 'flex-start',
              }}>
                <span style={{ fontFamily: 'monospace', color: 'rgba(255,255,255,0.5)', minWidth: 40 }}>T{e.tick}</span>
                <span style={{ minWidth: 16 }}>{EVENT_ICON[e.type] || '·'}</span>
                <span style={{ fontWeight: 600, textTransform: 'capitalize', minWidth: 90 }}>
                  {e.type.replace(/_/g, ' ')}
                </span>
                <span style={{ opacity: 0.75, flex: 1 }}>{e.detail || ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main view ---
export default function BiomesView({ routedBiomeId, onChangeBiomeId }) {
  const [biomes, setBiomes] = useState(null);
  const [details, setDetails] = useState(null);
  const [timeseries, setTimeseries] = useState(null);
  const [events, setEvents] = useState(null);
  const [affinity, setAffinity] = useState(null);
  const [speciesMap, setSpeciesMap] = useState(null);
  const [selectedId, setSelectedId] = useState(routedBiomeId ?? null);

  useEffect(() => {
    getBiomes().then(setBiomes);
    getAllBiomeDetails().then(arr => {
      const map = {};
      for (const d of arr) map[d.id] = d;
      setDetails(map);
    });
    getBiomeTimeseries().then(setTimeseries);
    getEvents().then(e => setEvents(e || []));
    getTypeBiomeAffinity().then(setAffinity);
    getAllSpecies().then(setSpeciesMap);
  }, []);

  // Sync down from URL
  useEffect(() => {
    if (routedBiomeId != null && routedBiomeId !== selectedId) {
      setSelectedId(routedBiomeId);
    }
  }, [routedBiomeId]);

  // Auto-pick first biome once data loads if nothing selected
  useEffect(() => {
    if (selectedId == null && biomes && biomes.length > 0) {
      setSelectedId(biomes[0].id);
    }
  }, [biomes, selectedId]);

  const handleSelect = (id) => {
    setSelectedId(id);
    if (onChangeBiomeId) onChangeBiomeId(id);
  };

  if (!biomes) return <div className="species-view-loading">Loading biomes…</div>;

  return (
    <div className="species-view">
      <BiomeList
        biomes={biomes}
        selectedId={selectedId}
        onSelect={handleSelect}
        details={details}
      />
      <div className="species-detail-scroll">
        {selectedId != null && (
          <BiomeDetail
            biomeId={selectedId}
            biomes={biomes}
            details={details}
            speciesMap={speciesMap}
            biomeTimeseries={timeseries}
            events={events}
            affinity={affinity}
          />
        )}
      </div>
    </div>
  );
}
