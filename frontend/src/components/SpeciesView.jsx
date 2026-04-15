import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { getAllSpecies, getFoodChain, getAllAnimationFrames } from '../data';

const SPRITE_BASE = import.meta.env.BASE_URL + 'data/sprites/';

const TROPHIC_COLOR = {
  producer: '#6abf69',
  primary_consumer: '#5b9bd5',
  secondary_consumer: '#e8944a',
  apex_predator: '#e86b8a',
  decomposer: '#8b6bbf',
};

const TYPE_COLOR = {
  normal: '#a8a878', fire: '#f08030', water: '#6890f0', electric: '#f8d030',
  grass: '#78c850', ice: '#98d8d8', fighting: '#c03028', poison: '#a040a0',
  ground: '#e0c068', flying: '#a890f0', psychic: '#f85888', bug: '#a8b820',
  rock: '#b8a038', ghost: '#705898', dragon: '#7038f8', dark: '#705848',
  steel: '#b8b8d0', fairy: '#ee99ac',
};

function SpriteImg({ id, size = 64, alt }) {
  return (
    <img
      src={`${SPRITE_BASE}${id}.png`}
      width={size}
      height={size}
      alt={alt || `#${id}`}
      style={{ imageRendering: 'pixelated' }}
      onError={(e) => { e.target.style.visibility = 'hidden'; }}
    />
  );
}

// ---- Left list ----
function SpeciesList({ species, selectedId, onSelect, populations }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name'); // 'name' | 'pop' | 'extinct'

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = Object.values(species);
    if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || String(s.id).includes(q));

    const peak = (id) => populations?.[id]?.peak ?? 0;
    const latest = (id) => populations?.[id]?.latest ?? 0;

    if (sort === 'name') list.sort((a, b) => a.id - b.id);
    else if (sort === 'pop') list.sort((a, b) => latest(b.id) - latest(a.id));
    else if (sort === 'extinct') list.sort((a, b) => {
      const aExt = peak(a.id) > 0 && latest(a.id) === 0 ? 1 : 0;
      const bExt = peak(b.id) > 0 && latest(b.id) === 0 ? 1 : 0;
      return bExt - aExt || a.id - b.id;
    });

    return list;
  }, [species, query, sort, populations]);

  return (
    <div className="species-list">
      <input
        className="species-search"
        placeholder="Search by name or dex #..."
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <div className="species-sort">
        <button className={sort==='name'?'active':''} onClick={() => setSort('name')}>Dex #</button>
        <button className={sort==='pop'?'active':''} onClick={() => setSort('pop')}>Population</button>
        <button className={sort==='extinct'?'active':''} onClick={() => setSort('extinct')}>Extinct first</button>
      </div>
      <div className="species-list-scroll">
        {filtered.map(sp => {
          const p = populations?.[sp.id];
          const pop = p?.latest ?? 0;
          const extinct = p && p.peak > 0 && pop === 0;
          return (
            <div
              key={sp.id}
              className={`species-row ${selectedId === sp.id ? 'selected' : ''}`}
              onClick={() => onSelect(sp.id)}
            >
              <SpriteImg id={sp.id} size={40} alt={sp.name} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="species-row-name" style={extinct ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                  {sp.name}
                </div>
                <div className="species-row-meta">
                  <span style={{ color: TROPHIC_COLOR[sp.trophic_level] || '#999', fontWeight: 600 }}>
                    {sp.trophic_level?.replace(/_/g, ' ') || '—'}
                  </span>
                  <span>·</span>
                  <span>{extinct ? 'extinct' : `${pop.toLocaleString()} alive`}</span>
                </div>
              </div>
              {sp.is_legendary && <span title="Legendary" style={{ fontSize: 14 }}>★</span>}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', opacity: 0.5, fontSize: 12 }}>
            No species match "{query}"
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Stat bar ----
function StatBar({ label, value, max = 255 }) {
  const pct = Math.min(100, (value / max) * 100);
  const hue = Math.min(120, (value / max) * 140);
  return (
    <div className="stat-bar">
      <span className="stat-label">{label}</span>
      <div className="stat-track">
        <div className="stat-fill" style={{ width: `${pct}%`, background: `hsl(${hue}, 65%, 52%)` }} />
      </div>
      <span className="stat-value">{value}</span>
    </div>
  );
}

// ---- Food web mini ----
function FoodWeb({ speciesId, speciesMap, edges, onSelectSpecies }) {
  const { predators, prey } = useMemo(() => {
    if (!edges) return { predators: [], prey: [] };
    const preds = [];
    const prs = [];
    for (const e of edges) {
      if (e.prey_id === speciesId) {
        preds.push({ id: e.predator_id, name: e.predator_name, probability: e.probability });
      } else if (e.predator_id === speciesId) {
        prs.push({ id: e.prey_id, name: e.prey_name, probability: e.probability });
      }
    }
    preds.sort((a, b) => b.probability - a.probability);
    prs.sort((a, b) => b.probability - a.probability);
    return { predators: preds.slice(0, 8), prey: prs.slice(0, 8) };
  }, [speciesId, edges]);

  const Node = ({ node }) => {
    const sp = speciesMap[node.id];
    return (
      <div className="foodweb-node" onClick={() => onSelectSpecies(node.id)} title={`${node.name} (p=${node.probability})`}>
        <SpriteImg id={node.id} size={44} alt={node.name} />
        <div className="foodweb-node-name">{node.name}</div>
        <div className="foodweb-node-trophic" style={{ color: TROPHIC_COLOR[sp?.trophic_level] || '#888' }}>
          {sp?.trophic_level?.replace(/_/g, ' ') || ''}
        </div>
      </div>
    );
  };

  const self = speciesMap[speciesId];

  return (
    <div className="foodweb">
      <div className="foodweb-row foodweb-row-top">
        <div className="foodweb-label">Hunted by</div>
        <div className="foodweb-nodes">
          {predators.length === 0 && <div className="foodweb-empty">No known predators (apex or untargeted)</div>}
          {predators.map(n => <Node key={n.id} node={n} />)}
        </div>
      </div>
      <div className="foodweb-arrows">↑  eaten by  ↑</div>
      <div className="foodweb-self">
        <SpriteImg id={speciesId} size={72} alt={self?.name} />
        <div style={{ fontWeight: 700, fontSize: 14, textTransform: 'capitalize' }}>{self?.name}</div>
      </div>
      <div className="foodweb-arrows">↓  hunts  ↓</div>
      <div className="foodweb-row foodweb-row-bottom">
        <div className="foodweb-label">Hunts</div>
        <div className="foodweb-nodes">
          {prey.length === 0 && <div className="foodweb-empty">No prey (producer or decomposer)</div>}
          {prey.map(n => <Node key={n.id} node={n} />)}
        </div>
      </div>
    </div>
  );
}

// ---- Main detail panel ----
function SpeciesDetail({ speciesId, speciesMap, edges, timeline, onSelectSpecies }) {
  const sp = speciesMap[speciesId];
  if (!sp) return null;

  const chartData = useMemo(() => {
    if (!timeline || !timeline[speciesId]) return [];
    const t = timeline[speciesId];
    return t.ticks.map((tk, i) => ({ tick: tk, population: t.pops[i] }));
  }, [timeline, speciesId]);

  const latestPop = chartData.length > 0 ? chartData[chartData.length - 1].population : 0;
  const peakPop = chartData.reduce((m, p) => Math.max(m, p.population), 0);
  const extinct = peakPop > 0 && latestPop === 0;
  const extinctTick = extinct
    ? chartData.find(d => d.population === 0 && chartData[chartData.findIndex(dd => dd === d) - 1]?.population > 0)?.tick
    : null;

  return (
    <div className="species-detail">
      {/* Header: sprite + name + stats */}
      <div className="species-header">
        <div style={{ flexShrink: 0 }}>
          <SpriteImg id={sp.id} size={96} alt={sp.name} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
            <h2 style={{ margin: 0, textTransform: 'capitalize', fontSize: 22 }}>{sp.name}</h2>
            <span style={{ opacity: 0.5, fontSize: 14 }}>#{sp.id}</span>
            {sp.is_legendary && <span style={{ fontSize: 12, color: '#f0c060' }}>★ legendary</span>}
            {sp.is_mythical && <span style={{ fontSize: 12, color: '#c090ff' }}>✦ mythical</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {sp.types.map(t => (
              <span key={t} className="type-pill" style={{ background: TYPE_COLOR[t] || '#888' }}>{t}</span>
            ))}
            <span className="type-pill" style={{ background: TROPHIC_COLOR[sp.trophic_level] || '#888' }}>
              {sp.trophic_level?.replace(/_/g, ' ')}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 18, fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
            <div><strong style={{ color: '#fff' }}>{latestPop.toLocaleString()}</strong> alive</div>
            <div><strong style={{ color: '#fff' }}>{peakPop.toLocaleString()}</strong> peak</div>
            {extinct && <div style={{ color: '#e86b8a' }}>💀 extinct{extinctTick != null ? ` at T${extinctTick}` : ''}</div>}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="species-stats">
        <StatBar label="HP" value={sp.hp} />
        <StatBar label="ATK" value={sp.attack} />
        <StatBar label="DEF" value={sp.defense} />
        <StatBar label="SpA" value={sp.sp_attack} />
        <StatBar label="SpD" value={sp.sp_defense} />
        <StatBar label="SPE" value={sp.speed} />
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
          Base Stat Total: <strong style={{ color: '#fff' }}>{sp.bst}</strong>
        </div>
      </div>

      {/* Population timeline */}
      <div className="species-chart">
        <div className="species-section-title">Population over time</div>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="tick" tick={{ fontSize: 10, fill: '#aaa' }} />
              <YAxis tick={{ fontSize: 10, fill: '#aaa' }} domain={[0, 'auto']} />
              <RTooltip
                contentStyle={{ background: 'rgba(26,26,46,0.95)', border: '1px solid rgba(255,255,255,0.15)', fontSize: 12 }}
                labelStyle={{ color: '#fff' }}
              />
              <Line
                type="monotone"
                dataKey="population"
                stroke={TROPHIC_COLOR[sp.trophic_level] || '#6abf69'}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ padding: 20, textAlign: 'center', opacity: 0.5, fontSize: 12 }}>
            No timeline data (this species wasn't in the simulation).
          </div>
        )}
      </div>

      {/* Food web */}
      <div className="species-chart">
        <div className="species-section-title">Food web</div>
        <FoodWeb
          speciesId={speciesId}
          speciesMap={speciesMap}
          edges={edges}
          onSelectSpecies={onSelectSpecies}
        />
      </div>
    </div>
  );
}

// ---- Main view ----
export default function SpeciesView() {
  const [speciesMap, setSpeciesMap] = useState(null);
  const [edges, setEdges] = useState(null);
  const [timeline, setTimeline] = useState(null); // { [id]: { ticks: [], pops: [], peak, latest } }
  const [loadingTimeline, setLoadingTimeline] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    getAllSpecies().then(setSpeciesMap);
    getFoodChain().then(fc => setEdges(fc?.edges || []));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingTimeline(true);
    getAllAnimationFrames().then(data => {
      if (cancelled || !data) return;
      // Aggregate populations per species across all biomes per frame
      const speciesMeta = data.species; // [{id, biome_id, ...}, ...]
      const frames = data.frames;
      const numFrames = frames.length;
      const ticks = new Array(numFrames);
      const perSpecies = {}; // id -> Int32Array(numFrames)

      // Pre-init per unique species id
      const uniqueIds = new Set();
      for (const sm of speciesMeta) uniqueIds.add(sm.id);
      for (const id of uniqueIds) perSpecies[id] = new Int32Array(numFrames);

      for (let fi = 0; fi < numFrames; fi++) {
        const f = frames[fi];
        ticks[fi] = f.tick;
        const pops = f.populations;
        for (let ei = 0; ei < pops.length; ei++) {
          const sid = speciesMeta[ei].id;
          perSpecies[sid][fi] += pops[ei];
        }
      }

      const out = {};
      for (const id of uniqueIds) {
        const arr = perSpecies[id];
        let peak = 0;
        for (let i = 0; i < arr.length; i++) if (arr[i] > peak) peak = arr[i];
        out[id] = {
          ticks,
          pops: Array.from(arr),
          peak,
          latest: arr[arr.length - 1],
        };
      }
      if (!cancelled) {
        setTimeline(out);
        setLoadingTimeline(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Auto-select first species with data once available
  useEffect(() => {
    if (selectedId || !speciesMap || !timeline) return;
    // Pick a species with high peak population for a good initial view
    const ids = Object.keys(speciesMap).map(Number);
    let best = ids[0], bestPeak = 0;
    for (const id of ids) {
      const p = timeline[id]?.peak || 0;
      if (p > bestPeak) { bestPeak = p; best = id; }
    }
    setSelectedId(best);
  }, [speciesMap, timeline, selectedId]);

  if (!speciesMap) {
    return <div className="species-view-loading">Loading species…</div>;
  }

  return (
    <div className="species-view">
      <SpeciesList
        species={speciesMap}
        selectedId={selectedId}
        onSelect={setSelectedId}
        populations={timeline}
      />
      <div className="species-detail-scroll">
        {loadingTimeline && (
          <div style={{ padding: '6px 14px', fontSize: 11, opacity: 0.6 }}>
            Computing population history…
          </div>
        )}
        {selectedId && (
          <SpeciesDetail
            speciesId={selectedId}
            speciesMap={speciesMap}
            edges={edges}
            timeline={timeline}
            onSelectSpecies={setSelectedId}
          />
        )}
      </div>
    </div>
  );
}
