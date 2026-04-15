import { useEffect, useMemo, useState } from 'react';
import { getTypeBiomeAffinity } from '../data';

const TYPE_COLOR = {
  normal: '#a8a878', fire: '#f08030', water: '#6890f0', electric: '#f8d030',
  grass: '#78c850', ice: '#98d8d8', fighting: '#c03028', poison: '#a040a0',
  ground: '#e0c068', flying: '#a890f0', psychic: '#f85888', bug: '#a8b820',
  rock: '#b8a038', ghost: '#705898', dragon: '#7038f8', dark: '#705848',
  steel: '#b8b8d0', fairy: '#ee99ac',
};

const BIOME_ICON = {
  cave: '🕳️', forest: '🌲', grassland: '🌾', mountain: '⛰️',
  rare: '✨', 'rough-terrain': '🪨', sea: '🌊', urban: '🏙️',
  'waters-edge': '🏞️',
};

function affinityColor(v) {
  if (v == null) return 'rgba(255,255,255,0.02)';
  if (v >= 1.0) {
    const t = Math.min((v - 1.0) / 0.6, 1);
    return `rgba(106, 216, 160, ${0.15 + t * 0.6})`; // green tint scaling
  } else {
    const t = Math.min((1.0 - v) / 0.5, 1);
    return `rgba(232, 107, 138, ${0.15 + t * 0.6})`; // red tint
  }
}

function affinityTextColor(v) {
  if (v == null) return 'rgba(255,255,255,0.25)';
  return v >= 1.15 || v <= 0.75 ? '#fff' : 'rgba(255,255,255,0.85)';
}

export default function EcologyView() {
  const [data, setData] = useState(null);
  const [hovered, setHovered] = useState(null); // { typeId, base, affinity }

  useEffect(() => {
    getTypeBiomeAffinity().then(setData);
  }, []);

  const { types, baseBiomes, grid } = useMemo(() => {
    if (!data) return { types: [], baseBiomes: [], grid: {} };
    // Group biomes by base name (strip "_N" suffix variants)
    const biomeById = {};
    const byBase = {};
    for (const b of data.biomes) {
      biomeById[b.id] = b;
      const base = b.name.split('_')[0];
      if (!byBase[base]) byBase[base] = [];
      byBase[base].push(b);
    }
    const baseList = Object.keys(byBase).sort();

    // type_id -> { base -> avg affinity }
    const matrix = {};
    const countMatrix = {};
    for (const e of data.entries) {
      const base = biomeById[e.biome_id]?.name.split('_')[0];
      if (!base) continue;
      if (!matrix[e.type_id]) { matrix[e.type_id] = {}; countMatrix[e.type_id] = {}; }
      matrix[e.type_id][base] = (matrix[e.type_id][base] || 0) + e.affinity;
      countMatrix[e.type_id][base] = (countMatrix[e.type_id][base] || 0) + 1;
    }
    const g = {};
    for (const typeId of Object.keys(matrix)) {
      g[typeId] = {};
      for (const base of baseList) {
        const sum = matrix[typeId][base];
        const cnt = countMatrix[typeId][base];
        g[typeId][base] = cnt ? sum / cnt : null;
      }
    }
    return { types: data.types, baseBiomes: baseList, grid: g };
  }, [data]);

  if (!data) {
    return <div className="ecology-loading">Loading affinity data…</div>;
  }

  return (
    <div className="ecology-view">
      <div className="ecology-header">
        <h2 style={{ margin: 0 }}>Type × Biome Affinity</h2>
        <p>
          How well each Pokemon type fares across biomes. Values are multipliers on population
          growth — below 1.0 means the type struggles, above 1.0 means it thrives.
          Averaged across variant biomes (e.g. <em>forest_1 … forest_12</em>).
        </p>
      </div>

      <div className="affinity-scroll">
        <table className="affinity-table">
          <thead>
            <tr>
              <th className="affinity-corner"></th>
              {baseBiomes.map(b => (
                <th key={b} className="affinity-col-head">
                  <div className="biome-head-icon">{BIOME_ICON[b] || '·'}</div>
                  <div className="biome-head-name">{b}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.map(t => (
              <tr key={t.id}>
                <td className="affinity-row-head">
                  <span
                    className="type-pill"
                    style={{ background: TYPE_COLOR[t.name] || '#666' }}
                  >{t.name}</span>
                </td>
                {baseBiomes.map(b => {
                  const v = grid[t.id]?.[b];
                  const isHover = hovered && hovered.typeId === t.id && hovered.base === b;
                  return (
                    <td
                      key={b}
                      className={`affinity-cell ${isHover ? 'hovered' : ''}`}
                      style={{
                        background: affinityColor(v),
                        color: affinityTextColor(v),
                      }}
                      onMouseEnter={() => setHovered({ typeId: t.id, typeName: t.name, base: b, affinity: v })}
                      onMouseLeave={() => setHovered(null)}
                    >
                      {v == null ? '—' : v.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ecology-legend">
        <div className="legend-swatches">
          <span className="legend-swatch" style={{ background: affinityColor(0.5) }}>0.50×</span>
          <span className="legend-swatch" style={{ background: affinityColor(0.8) }}>0.80×</span>
          <span className="legend-swatch" style={{ background: affinityColor(1.0) }}>1.00×</span>
          <span className="legend-swatch" style={{ background: affinityColor(1.3) }}>1.30×</span>
          <span className="legend-swatch" style={{ background: affinityColor(1.6) }}>1.60×</span>
        </div>
        <div className="legend-labels">
          <span>← hostile</span>
          <span>neutral</span>
          <span>thrives →</span>
        </div>
        {hovered && hovered.affinity != null && (
          <div className="hover-readout">
            <span className="type-pill" style={{ background: TYPE_COLOR[hovered.typeName] || '#666' }}>
              {hovered.typeName}
            </span>
            <span>in</span>
            <strong>{hovered.base}</strong>
            <span>·</span>
            <strong style={{ color: hovered.affinity >= 1.0 ? '#6ad8a0' : '#e86b8a' }}>
              {hovered.affinity.toFixed(2)}× growth
            </strong>
          </div>
        )}
      </div>
    </div>
  );
}
