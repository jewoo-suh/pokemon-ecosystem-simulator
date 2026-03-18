import { useState, useEffect } from 'react';
import { getStatsOverview, getStatsTrophic, getSpeciesDetail } from '../data';

export default function Sidebar({ selectedSpecies, onClose }) {
  const [details, setDetails] = useState(null);
  const [overview, setOverview] = useState(null);
  const [trophic, setTrophic] = useState(null);

  // Load overview stats
  useEffect(() => {
    getStatsOverview().then(setOverview);
    getStatsTrophic().then(setTrophic);
  }, []);

  // Load species details when selected
  useEffect(() => {
    if (!selectedSpecies) { setDetails(null); return; }
    getSpeciesDetail(selectedSpecies.id).then(setDetails);
  }, [selectedSpecies]);

  const trophicColors = {
    producer: '#78C850',
    primary_consumer: '#6890F0',
    secondary_consumer: '#F08030',
    apex_predator: '#C03028',
    decomposer: '#705898',
  };

  return (
    <div style={{
      width: 300,
      height: '100vh',
      background: '#16171d',
      borderLeft: '1px solid #2e303a',
      padding: 16,
      overflowY: 'auto',
      flexShrink: 0,
    }}>
      <h2 style={{ fontSize: 18, marginBottom: 12, color: '#c084fc' }}>
        Pokemon Ecosystem
      </h2>

      {/* Overview stats */}
      {overview && (
        <div style={{ marginBottom: 20 }}>
          <div style={statRow}>
            <span style={statLabel}>Tick</span>
            <span style={statValue}>{overview.current_tick}</span>
          </div>
          <div style={statRow}>
            <span style={statLabel}>Species Alive</span>
            <span style={statValue}>{overview.living_species} / {overview.total_species}</span>
          </div>
          <div style={statRow}>
            <span style={statLabel}>Survival Rate</span>
            <span style={statValue}>{overview.survival_rate}%</span>
          </div>
          <div style={statRow}>
            <span style={statLabel}>Total Pop</span>
            <span style={statValue}>{overview.total_population?.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Trophic breakdown */}
      {trophic && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={sectionTitle}>Trophic Pyramid</h3>
          {trophic.map(t => (
            <div key={t.level} style={{ ...statRow, alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: trophicColors[t.level] || '#888',
                  display: 'inline-block',
                }} />
                <span style={{ fontSize: 12, color: '#9ca3af' }}>
                  {t.level.replace('_', ' ')}
                </span>
              </span>
              <span style={{ fontSize: 12, color: '#eee' }}>
                {t.species_count} spp / {t.total_population?.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Selected species detail */}
      {details && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ ...sectionTitle, textTransform: 'capitalize' }}>{details.name}</h3>
            <button onClick={onClose} style={closeBtn}>x</button>
          </div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>
            {details.types?.join(' / ')} | {details.trophic_level?.replace('_', ' ')}
            {details.is_legendary && ' | Legendary'}
            {details.is_mythical && ' | Mythical'}
          </div>

          <div style={statRow}>
            <span style={statLabel}>BST</span>
            <span style={statValue}>{details.bst}</span>
          </div>
          <div style={statRow}>
            <span style={statLabel}>Total Pop</span>
            <span style={statValue}>{details.total_population}</span>
          </div>
          <div style={statRow}>
            <span style={statLabel}>Predators</span>
            <span style={statValue}>{details.predator_count}</span>
          </div>
          <div style={statRow}>
            <span style={statLabel}>Prey</span>
            <span style={statValue}>{details.prey_count}</span>
          </div>

          {/* Per-biome breakdown */}
          <h4 style={{ fontSize: 12, color: '#9ca3af', marginTop: 12, marginBottom: 4 }}>
            Biome Populations
          </h4>
          {details.biomes?.map(b => (
            <div key={b.biome_id} style={statRow}>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>{b.biome_name}</span>
              <span style={{ fontSize: 12, color: '#eee' }}>
                {b.population} (food: {b.food_satiation.toFixed(2)})
              </span>
            </div>
          ))}

          {/* Stats bar */}
          <h4 style={{ fontSize: 12, color: '#9ca3af', marginTop: 12, marginBottom: 4 }}>
            Stats
          </h4>
          {['hp', 'attack', 'defense', 'sp_attack', 'sp_defense', 'speed'].map(stat => (
            <div key={stat} style={{ marginBottom: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af' }}>
                <span>{stat.replace('_', ' ')}</span>
                <span>{details[stat]}</span>
              </div>
              <div style={{ background: '#2e303a', height: 4, borderRadius: 2 }}>
                <div style={{
                  background: '#c084fc',
                  height: '100%',
                  borderRadius: 2,
                  width: `${Math.min(100, details[stat] / 255 * 100)}%`,
                }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {!details && (
        <p style={{ fontSize: 12, color: '#666', marginTop: 20 }}>
          Click a dot on the map to see species details.
        </p>
      )}
    </div>
  );
}

const statRow = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '3px 0',
  borderBottom: '1px solid #2e303a',
};
const statLabel = { fontSize: 12, color: '#9ca3af' };
const statValue = { fontSize: 12, color: '#eee', fontFamily: 'monospace' };
const sectionTitle = { fontSize: 14, color: '#eee', marginBottom: 8 };
const closeBtn = {
  background: 'none', border: '1px solid #2e303a', color: '#9ca3af',
  borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 12,
};
