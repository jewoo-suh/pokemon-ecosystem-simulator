import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RTooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { getAllSpecies, getSpeciesTimeline } from '../data';

const SPRITE_BASE = import.meta.env.BASE_URL + 'data/sprites/';
const MAX_SELECTED = 5;

const SERIES_COLORS = ['#6abf69', '#5b9bd5', '#e8944a', '#e86b8a', '#8caaff'];

const TYPE_COLOR = {
  normal: '#a8a878', fire: '#f08030', water: '#6890f0', electric: '#f8d030',
  grass: '#78c850', ice: '#98d8d8', fighting: '#c03028', poison: '#a040a0',
  ground: '#e0c068', flying: '#a890f0', psychic: '#f85888', bug: '#a8b820',
  rock: '#b8a038', ghost: '#705898', dragon: '#7038f8', dark: '#705848',
  steel: '#b8b8d0', fairy: '#ee99ac',
};

function parseSelectedFromArg(arg) {
  if (!arg) return [];
  return arg.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0).slice(0, MAX_SELECTED);
}

function selectedToArg(ids) {
  return ids.join(',');
}

export default function CompareView({ initialIdsArg, onChangeIds }) {
  const [speciesMap, setSpeciesMap] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [loadingTimeline, setLoadingTimeline] = useState(true);
  const [selectedIds, setSelectedIds] = useState(() => parseSelectedFromArg(initialIdsArg));
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { getAllSpecies().then(setSpeciesMap); }, []);
  useEffect(() => {
    setLoadingTimeline(true);
    getSpeciesTimeline().then(({ timeline }) => {
      setTimeline(timeline);
      setLoadingTimeline(false);
    });
  }, []);

  // Sync if URL changes externally
  useEffect(() => {
    const next = parseSelectedFromArg(initialIdsArg);
    if (next.join(',') !== selectedIds.join(',')) setSelectedIds(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIdsArg]);

  const writeUrl = (ids) => { if (onChangeIds) onChangeIds(selectedToArg(ids)); };

  const addSpecies = (id) => {
    if (selectedIds.includes(id) || selectedIds.length >= MAX_SELECTED) return;
    const next = [...selectedIds, id];
    setSelectedIds(next);
    writeUrl(next);
    setQuery('');
    inputRef.current?.focus();
  };

  const removeSpecies = (id) => {
    const next = selectedIds.filter(x => x !== id);
    setSelectedIds(next);
    writeUrl(next);
  };

  const clearAll = () => {
    setSelectedIds([]);
    writeUrl([]);
  };

  // Suggestions for the picker
  const suggestions = useMemo(() => {
    if (!speciesMap) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const list = [];
    for (const sp of Object.values(speciesMap)) {
      if (selectedIds.includes(sp.id)) continue;
      if (sp.name.toLowerCase().includes(q) || String(sp.id).startsWith(q)) {
        list.push(sp);
        if (list.length >= 8) break;
      }
    }
    return list;
  }, [speciesMap, query, selectedIds]);

  // Build chart data: one row per tick, with one column per selected species
  const chartData = useMemo(() => {
    if (!timeline || selectedIds.length === 0 || !speciesMap) return [];
    const first = timeline[selectedIds[0]];
    if (!first) return [];
    const ticks = first.ticks;
    return ticks.map((t, i) => {
      const row = { tick: t };
      for (const id of selectedIds) {
        const tl = timeline[id];
        const name = speciesMap[id]?.name || `#${id}`;
        row[name] = tl?.pops[i] ?? 0;
      }
      return row;
    });
  }, [selectedIds, timeline, speciesMap]);

  // Stat comparison rows (HP/ATK/DEF/etc)
  const statRows = useMemo(() => {
    if (!speciesMap || selectedIds.length === 0) return [];
    const stats = ['hp', 'attack', 'defense', 'sp_attack', 'sp_defense', 'speed', 'bst'];
    const labels = { hp: 'HP', attack: 'ATK', defense: 'DEF', sp_attack: 'SpA', sp_defense: 'SpD', speed: 'SPE', bst: 'BST' };
    return stats.map(s => ({
      key: s, label: labels[s],
      values: selectedIds.map(id => speciesMap[id]?.[s] ?? 0),
    }));
  }, [selectedIds, speciesMap]);

  const summaryRow = useMemo(() => {
    if (!timeline || selectedIds.length === 0 || !speciesMap) return [];
    return selectedIds.map(id => {
      const tl = timeline[id];
      const sp = speciesMap[id];
      return {
        id, sp,
        peak: tl?.peak ?? 0,
        latest: tl?.latest ?? 0,
        extinct: tl && tl.peak > 0 && tl.latest === 0,
      };
    });
  }, [selectedIds, timeline, speciesMap]);

  if (!speciesMap) return <div style={{ padding: 20, opacity: 0.5 }}>Loading…</div>;

  return (
    <div className="data-panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="data-toolbar" style={{ flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', minWidth: 220 }}>
          <input
            ref={inputRef}
            placeholder={selectedIds.length >= MAX_SELECTED ? 'Max 5 selected' : 'add species (name or #)'}
            disabled={selectedIds.length >= MAX_SELECTED}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && suggestions[0]) addSpecies(suggestions[0].id);
              if (e.key === 'Escape') setQuery('');
            }}
            className="data-search"
            style={{ width: 220 }}
          />
          {suggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4,
              background: '#0c0c18', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 4, padding: 4, zIndex: 20, width: 280,
              maxHeight: 280, overflowY: 'auto',
            }}>
              {suggestions.map(sp => (
                <div
                  key={sp.id}
                  onClick={() => addSpecies(sp.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '4px 6px', cursor: 'pointer', borderRadius: 3,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(140,170,255,0.12)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <img src={`${SPRITE_BASE}${sp.id}.png`} width={24} height={24}
                       style={{ imageRendering: 'pixelated' }}
                       onError={e => e.target.style.visibility = 'hidden'} alt="" />
                  <span style={{ flex: 1, textTransform: 'capitalize', fontSize: 12 }}>{sp.name}</span>
                  <span style={{ fontSize: 10, opacity: 0.5, fontFamily: 'monospace' }}>#{sp.id}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 4, flex: 1, flexWrap: 'wrap' }}>
          {selectedIds.length === 0 && (
            <span style={{ fontSize: 11, opacity: 0.5, alignSelf: 'center' }}>
              Try: <button onClick={() => { setSelectedIds([1, 4, 7]); writeUrl([1,4,7]); }} style={{ background: 'none', border: 'none', color: '#8caaff', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 11 }}>starters</button>
              {' or '}
              <button onClick={() => { setSelectedIds([25, 133, 132, 143, 149]); writeUrl([25,133,132,143,149]); }} style={{ background: 'none', border: 'none', color: '#8caaff', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 11 }}>iconic 5</button>
            </span>
          )}
          {selectedIds.map((id, i) => {
            const sp = speciesMap[id];
            const color = SERIES_COLORS[i];
            return (
              <div key={id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '3px 6px 3px 4px',
                background: `${color}22`, border: `1px solid ${color}88`,
                borderRadius: 4, fontSize: 11,
              }}>
                <img src={`${SPRITE_BASE}${id}.png`} width={20} height={20}
                     style={{ imageRendering: 'pixelated' }}
                     onError={e => e.target.style.visibility = 'hidden'} alt="" />
                <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{sp?.name || `#${id}`}</span>
                <button
                  onClick={() => removeSpecies(id)}
                  style={{
                    background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)',
                    cursor: 'pointer', padding: '0 2px', fontSize: 14, lineHeight: 1,
                  }}
                  title="Remove"
                >×</button>
              </div>
            );
          })}
        </div>

        {selectedIds.length > 0 && (
          <button
            onClick={clearAll}
            style={{
              padding: '4px 10px', fontSize: 10, fontFamily: 'inherit',
              background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4,
              cursor: 'pointer', textTransform: 'uppercase', letterSpacing: 0.4,
            }}
          >Clear</button>
        )}
      </div>

      {/* Chart */}
      <div style={{ padding: 16, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {selectedIds.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 13 }}>
            Add up to 5 species to compare their population timelines.
          </div>
        ) : loadingTimeline ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
            Computing population timelines…
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="tick" tick={{ fontSize: 10, fill: '#aaa' }} />
                <YAxis tick={{ fontSize: 10, fill: '#aaa' }} />
                <RTooltip
                  contentStyle={{ background: 'rgba(18,18,32,0.97)', border: '1px solid rgba(255,255,255,0.15)', fontSize: 11 }}
                  labelStyle={{ color: '#fff' }}
                  itemSorter={(it) => -it.value}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                {selectedIds.map((id, i) => {
                  const sp = speciesMap[id];
                  return (
                    <Line
                      key={id}
                      type="monotone"
                      dataKey={sp?.name || `#${id}`}
                      stroke={SERIES_COLORS[i]}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>

            {/* Summary + stat comparison */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16, fontFamily: 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace' }}>
              <div>
                <div className="species-section-title">Outcome</div>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 6px' }}>Species</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px' }}>Peak</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px' }}>Final</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryRow.map((r, i) => (
                      <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '4px 6px', textTransform: 'capitalize', color: SERIES_COLORS[i], fontWeight: 600 }}>● {r.sp?.name || `#${r.id}`}</td>
                        <td style={{ textAlign: 'right', padding: '4px 6px' }}>{r.peak.toLocaleString()}</td>
                        <td style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 600 }}>{r.latest.toLocaleString()}</td>
                        <td style={{ textAlign: 'right', padding: '4px 6px', color: r.extinct ? '#e86b8a' : '#6ad8a0' }}>
                          {r.extinct ? '💀 extinct' : '● alive'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <div className="species-section-title">Base stats</div>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 6px' }}>Stat</th>
                      {selectedIds.map((id, i) => (
                        <th key={id} style={{ textAlign: 'right', padding: '4px 6px', color: SERIES_COLORS[i], textTransform: 'capitalize' }}>
                          {speciesMap[id]?.name?.slice(0, 4) || `#${id}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {statRows.map(r => {
                      const max = Math.max(...r.values);
                      return (
                        <tr key={r.key} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '4px 6px', color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>{r.label}</td>
                          {r.values.map((v, i) => (
                            <td key={i} style={{
                              textAlign: 'right', padding: '4px 6px',
                              color: v === max && r.values.filter(x => x === max).length === 1 ? SERIES_COLORS[i] : 'rgba(255,255,255,0.85)',
                              fontWeight: v === max ? 700 : 400,
                            }}>{v}</td>
                          ))}
                        </tr>
                      );
                    })}
                    <tr>
                      <td style={{ padding: '4px 6px', color: 'rgba(255,255,255,0.45)', fontSize: 10 }}>type</td>
                      {selectedIds.map((id, i) => {
                        const types = speciesMap[id]?.types || [];
                        return (
                          <td key={id} style={{ textAlign: 'right', padding: '4px 6px' }}>
                            {types.map(t => (
                              <span key={t} className="type-pill-mini" style={{ background: TYPE_COLOR[t] || '#888', marginLeft: 2 }}>{t.slice(0,3)}</span>
                            ))}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
