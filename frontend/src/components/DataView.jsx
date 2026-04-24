import { useEffect, useMemo, useState } from 'react';
import { getAllSpecies, getTypeEffectiveness, getEvents } from '../data';
import EcologyView from './EcologyView';
import BiomesView from './BiomesView';
import CompareView from './CompareView';

const EVENT_ICON = {
  extinction: '💀', food_chain_collapse: '📉', fire: '🔥', flood: '🌊',
  drought: '🏜️', disease: '🦠', bloom: '🌸', population_boom: '📈',
  mass_migration: '🧭', evolution_wave: '✨', disaster: '⚠️',
  invasive_species: '⚠️', equilibrium_reached: '⚖️', season_change: '🌱',
};

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

function statColor(v, max = 200) {
  const t = Math.min(v / max, 1);
  const hue = Math.min(130, t * 150);
  return `hsl(${hue}, 55%, ${30 + t * 15}%)`;
}

function SortHead({ label, sortKey, sort, setSort, align = 'left' }) {
  const active = sort.key === sortKey;
  const dir = active ? sort.dir : null;
  return (
    <th
      onClick={() => setSort({ key: sortKey, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
      style={{ textAlign: align, cursor: 'pointer', userSelect: 'none' }}
    >
      {label}{active ? (dir === 'desc' ? ' ▼' : ' ▲') : ''}
    </th>
  );
}

// --- Species catalog ---
function SpeciesTable() {
  const [species, setSpecies] = useState(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sort, setSort] = useState({ key: 'id', dir: 'asc' });

  useEffect(() => { getAllSpecies().then(setSpecies); }, []);

  const rows = useMemo(() => {
    if (!species) return [];
    let list = Object.values(species);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || String(s.id).includes(q));
    if (typeFilter) list = list.filter(s => s.types.includes(typeFilter));
    list.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number') return sort.dir === 'desc' ? bv - av : av - bv;
      return sort.dir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
    });
    return list;
  }, [species, query, typeFilter, sort]);

  if (!species) return <div style={{ padding: 20, opacity: 0.5 }}>Loading species…</div>;

  const allTypes = Object.keys(TYPE_COLOR);

  return (
    <div className="data-panel">
      <div className="data-toolbar">
        <input
          placeholder="search name or dex #"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="data-search"
        />
        <div className="data-type-filter">
          <button className={typeFilter === '' ? 'active' : ''} onClick={() => setTypeFilter('')}>all</button>
          {allTypes.map(t => (
            <button
              key={t}
              className={typeFilter === t ? 'active' : ''}
              style={typeFilter === t ? { background: TYPE_COLOR[t], color: '#fff', borderColor: TYPE_COLOR[t] } : {}}
              onClick={() => setTypeFilter(typeFilter === t ? '' : t)}
            >{t}</button>
          ))}
        </div>
        <span className="data-count">{rows.length.toLocaleString()} / {Object.keys(species).length.toLocaleString()}</span>
      </div>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <SortHead label="#" sortKey="id" sort={sort} setSort={setSort} align="right" />
              <SortHead label="Name" sortKey="name" sort={sort} setSort={setSort} />
              <th>Types</th>
              <SortHead label="Role" sortKey="trophic_level" sort={sort} setSort={setSort} />
              <SortHead label="HP" sortKey="hp" sort={sort} setSort={setSort} align="right" />
              <SortHead label="ATK" sortKey="attack" sort={sort} setSort={setSort} align="right" />
              <SortHead label="DEF" sortKey="defense" sort={sort} setSort={setSort} align="right" />
              <SortHead label="SpA" sortKey="sp_attack" sort={sort} setSort={setSort} align="right" />
              <SortHead label="SpD" sortKey="sp_defense" sort={sort} setSort={setSort} align="right" />
              <SortHead label="SPE" sortKey="speed" sort={sort} setSort={setSort} align="right" />
              <SortHead label="BST" sortKey="bst" sort={sort} setSort={setSort} align="right" />
              <SortHead label="H(m)" sortKey="height" sort={sort} setSort={setSort} align="right" />
              <SortHead label="W(kg)" sortKey="weight" sort={sort} setSort={setSort} align="right" />
              <SortHead label="Catch" sortKey="catch_rate" sort={sort} setSort={setSort} align="right" />
              <SortHead label="Growth" sortKey="growth_rate" sort={sort} setSort={setSort} />
              <SortHead label="Pop" sortKey="total_population" sort={sort} setSort={setSort} align="right" />
              <SortHead label="Preds" sortKey="predator_count" sort={sort} setSort={setSort} align="right" />
              <SortHead label="Prey" sortKey="prey_count" sort={sort} setSort={setSort} align="right" />
              <th style={{ textAlign: 'right' }}>Bio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(s => (
              <tr
                key={s.id}
                onClick={() => { window.location.hash = `species/${s.id}`; }}
                className="data-row"
              >
                <td style={{ textAlign: 'right', opacity: 0.55 }}>{s.id}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <img src={`${SPRITE_BASE}${s.id}.png`} width={24} height={24}
                         style={{ imageRendering: 'pixelated' }}
                         onError={e => e.target.style.visibility = 'hidden'} alt="" />
                    <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>
                      {s.name}{s.is_legendary ? ' ★' : s.is_mythical ? ' ✦' : ''}
                    </span>
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {s.types.map(t => (
                      <span key={t} className="type-pill-mini" style={{ background: TYPE_COLOR[t] }}>{t}</span>
                    ))}
                  </div>
                </td>
                <td style={{ color: TROPHIC_COLOR[s.trophic_level] || '#999', fontSize: 10, fontWeight: 600 }}>
                  {(s.trophic_level || '').replace(/_/g, ' ')}
                </td>
                <td className="num" style={{ background: statColor(s.hp, 255) }}>{s.hp}</td>
                <td className="num" style={{ background: statColor(s.attack, 190) }}>{s.attack}</td>
                <td className="num" style={{ background: statColor(s.defense, 230) }}>{s.defense}</td>
                <td className="num" style={{ background: statColor(s.sp_attack, 194) }}>{s.sp_attack}</td>
                <td className="num" style={{ background: statColor(s.sp_defense, 230) }}>{s.sp_defense}</td>
                <td className="num" style={{ background: statColor(s.speed, 200) }}>{s.speed}</td>
                <td className="num" style={{ background: statColor(s.bst, 780), fontWeight: 700 }}>{s.bst}</td>
                <td className="num">{(s.height / 10).toFixed(1)}</td>
                <td className="num">{(s.weight / 10).toFixed(1)}</td>
                <td className="num" style={{ color: s.catch_rate <= 45 ? '#e86b8a' : s.catch_rate >= 200 ? '#6ad8a0' : '#d0d0d0' }}>
                  {s.catch_rate != null ? `${Math.round(s.catch_rate / 2.55)}%` : '—'}
                </td>
                <td style={{ fontSize: 10 }}>{(s.growth_rate || '').replace(/-/g, ' ')}</td>
                <td className="num" style={{ color: s.total_population === 0 ? '#e86b8a' : '#d0d0d0', fontWeight: 600 }}>
                  {s.total_population.toLocaleString()}
                </td>
                <td className="num">{s.predator_count}</td>
                <td className="num">{s.prey_count}</td>
                <td className="num" style={{ opacity: 0.7 }}>{s.biomes?.length || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Type effectiveness matrix ---
function MatchupsTable() {
  const [data, setData] = useState(null);
  useEffect(() => { getTypeEffectiveness().then(setData); }, []);

  const grid = useMemo(() => {
    if (!data) return null;
    const g = {};
    for (const t of data.types) g[t.id] = {};
    for (const e of data.entries) g[e.atk_type_id][e.def_type_id] = e.multiplier;
    return g;
  }, [data]);

  if (!data) return <div style={{ padding: 20, opacity: 0.5 }}>Loading matchups…</div>;

  const cellColor = v => {
    if (v == null || v === 1) return 'transparent';
    if (v === 0) return 'rgba(40,40,60,0.85)';
    if (v === 0.5) return 'rgba(232,107,138,0.35)';
    if (v === 2) return 'rgba(106,216,160,0.45)';
    return 'transparent';
  };
  const cellText = v => {
    if (v == null || v === 1) return '';
    if (v === 0) return '0';
    if (v === 0.5) return '½';
    if (v === 2) return '2×';
    return v.toFixed(1);
  };

  return (
    <div className="data-panel">
      <div className="data-toolbar">
        <span className="data-count">{data.entries.length} non-neutral matchups · blanks = 1× neutral</span>
      </div>
      <div className="data-table-wrap" style={{ overflow: 'auto' }}>
        <table className="data-table matchup-grid">
          <thead>
            <tr>
              <th style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.5)' }}>
                ATK ↓ / DEF →
              </th>
              {data.types.map(t => (
                <th key={t.id} style={{ background: TYPE_COLOR[t.name], padding: '4px 6px', color: '#fff', fontSize: 10 }}>
                  {t.name.slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.types.map(atk => (
              <tr key={atk.id}>
                <td style={{ background: TYPE_COLOR[atk.name], color: '#fff', fontWeight: 700, fontSize: 10, padding: '4px 8px' }}>
                  {atk.name}
                </td>
                {data.types.map(def => {
                  const v = grid[atk.id]?.[def.id];
                  return (
                    <td key={def.id}
                        title={`${atk.name} → ${def.name}: ${v ?? 1}×`}
                        className="matchup-cell"
                        style={{ background: cellColor(v), textAlign: 'center', fontSize: 10, fontWeight: 700 }}>
                      {cellText(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Event log ---
function EventsTable() {
  const [events, setEvents] = useState(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sort, setSort] = useState({ key: 'tick', dir: 'asc' });

  useEffect(() => { getEvents().then(e => setEvents(e || [])); }, []);

  const typeCounts = useMemo(() => {
    if (!events) return {};
    const c = {};
    for (const e of events) c[e.type] = (c[e.type] || 0) + 1;
    return c;
  }, [events]);

  const rows = useMemo(() => {
    if (!events) return [];
    let list = [...events];
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(e =>
        (e.detail || '').toLowerCase().includes(q) ||
        (e.biome_name || '').toLowerCase().includes(q) ||
        (e.species_name || '').toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q)
      );
    }
    if (typeFilter) list = list.filter(e => e.type === typeFilter);
    list.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number') return sort.dir === 'desc' ? bv - av : av - bv;
      return sort.dir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
    });
    return list;
  }, [events, query, typeFilter, sort]);

  if (!events) return <div style={{ padding: 20, opacity: 0.5 }}>Loading events…</div>;

  const allTypes = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a]);

  return (
    <div className="data-panel">
      <div className="data-toolbar">
        <input
          placeholder="search detail / biome / species / type"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="data-search"
          style={{ minWidth: 260 }}
        />
        <div className="data-type-filter">
          <button className={typeFilter === '' ? 'active' : ''} onClick={() => setTypeFilter('')}>all</button>
          {allTypes.map(t => (
            <button
              key={t}
              className={typeFilter === t ? 'active' : ''}
              onClick={() => setTypeFilter(typeFilter === t ? '' : t)}
              title={`${typeCounts[t]} events`}
            >
              {EVENT_ICON[t] || '·'} {t.replace(/_/g, ' ')} · {typeCounts[t]}
            </button>
          ))}
        </div>
        <span className="data-count">{rows.length.toLocaleString()} / {events.length.toLocaleString()}</span>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <SortHead label="Tick" sortKey="tick" sort={sort} setSort={setSort} align="right" />
              <SortHead label="Type" sortKey="type" sort={sort} setSort={setSort} />
              <SortHead label="Biome" sortKey="biome_name" sort={sort} setSort={setSort} />
              <SortHead label="Species" sortKey="species_name" sort={sort} setSort={setSort} />
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr
                key={i}
                className={e.species_name || e.biome_name ? 'data-row' : ''}
                onClick={() => {
                  if (e.pokemon_id) window.location.hash = `species/${e.pokemon_id}`;
                  else if (e.biome_id) window.location.hash = `biomes/${e.biome_id}`;
                }}
              >
                <td className="num" style={{ color: 'rgba(255,255,255,0.65)', fontWeight: 600 }}>T{e.tick}</td>
                <td style={{ fontWeight: 600 }}>
                  <span style={{ marginRight: 4 }}>{EVENT_ICON[e.type] || '·'}</span>
                  <span style={{ textTransform: 'capitalize' }}>{e.type.replace(/_/g, ' ')}</span>
                </td>
                <td style={{ textTransform: 'capitalize', color: 'rgba(255,255,255,0.75)' }}>
                  {e.biome_name || '—'}
                </td>
                <td style={{ textTransform: 'capitalize', color: 'rgba(255,255,255,0.75)' }}>
                  {e.species_name || (e.season ? `season: ${e.season}` : '—')}
                </td>
                <td style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, whiteSpace: 'normal' }}>
                  {e.detail || ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Main container ---
const VALID_SUBTABS = new Set(['species', 'biomes', 'matchups', 'affinity', 'events', 'compare']);

export default function DataView({ initialSubtab, subtabArg }) {
  const [tab, setTab] = useState(
    VALID_SUBTABS.has(initialSubtab) ? initialSubtab : 'species'
  );

  // Sync subtab if parent sends a new routed value
  useEffect(() => {
    if (VALID_SUBTABS.has(initialSubtab) && initialSubtab !== tab) {
      setTab(initialSubtab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSubtab]);

  const switchSubtab = (next) => {
    setTab(next);
    window.location.hash = `data/${next}`;
  };

  const onChangeBiomeId = (id) => {
    window.location.hash = id != null ? `data/biomes/${id}` : 'data/biomes';
  };

  const onChangeCompareIds = (idsArg) => {
    window.location.hash = idsArg ? `data/compare/${idsArg}` : 'data/compare';
  };

  const biomeArg = tab === 'biomes' && subtabArg ? Number(subtabArg) : null;
  const compareArg = tab === 'compare' ? subtabArg : null;

  return (
    <div className="data-view">
      <div className="data-subtabs">
        <button className={tab === 'species' ? 'active' : ''} onClick={() => switchSubtab('species')}>Species</button>
        <button className={tab === 'biomes' ? 'active' : ''} onClick={() => switchSubtab('biomes')}>Biomes</button>
        <button className={tab === 'matchups' ? 'active' : ''} onClick={() => switchSubtab('matchups')}>Type Matchups</button>
        <button className={tab === 'affinity' ? 'active' : ''} onClick={() => switchSubtab('affinity')}>Biome Affinity</button>
        <button className={tab === 'events' ? 'active' : ''} onClick={() => switchSubtab('events')}>Event Log</button>
        <button className={tab === 'compare' ? 'active' : ''} onClick={() => switchSubtab('compare')}>Compare</button>
      </div>
      {tab === 'species' && <SpeciesTable />}
      {tab === 'biomes' && <BiomesView routedBiomeId={biomeArg} onChangeBiomeId={onChangeBiomeId} />}
      {tab === 'matchups' && <MatchupsTable />}
      {tab === 'affinity' && <EcologyView />}
      {tab === 'events' && <EventsTable />}
      {tab === 'compare' && <CompareView initialIdsArg={compareArg} onChangeIds={onChangeCompareIds} />}
    </div>
  );
}
