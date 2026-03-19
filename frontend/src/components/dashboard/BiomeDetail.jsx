import { useMemo } from 'react';

const TROPHIC_BADGES = {
  producer: { label: 'PRD', color: 'var(--trophic-producer)' },
  primary_consumer: { label: 'HRB', color: 'var(--trophic-primary)' },
  secondary_consumer: { label: 'CRN', color: 'var(--trophic-secondary)' },
  apex_predator: { label: 'APX', color: 'var(--trophic-apex)' },
  decomposer: { label: 'DEC', color: 'var(--trophic-decomposer)' },
};

const SPRITE_BASE = import.meta.env.BASE_URL + 'data/sprites/';

export default function BiomeDetail({
  selectedBiomeId,
  onSelectBiome,
  currentBiomeData,
  biomeDetails,
  biomeTimeseries,
  tickIdx,
  animFrame,
  selectedSpeciesId,
  onSelectSpecies,
}) {
  // Get species list for the selected biome (or global top-10)
  const { title, speciesList, biomePopulation, biomeCapacity } = useMemo(() => {
    if (selectedBiomeId != null && currentBiomeData?.[selectedBiomeId]) {
      const bd = currentBiomeData[selectedBiomeId];
      const detail = biomeDetails?.[selectedBiomeId];
      const biomeName = detail?.name || biomeTimeseries?.biome_names?.[
        biomeTimeseries.biome_ids.indexOf(selectedBiomeId)
      ] || `Biome ${selectedBiomeId}`;

      // Deduplicate species across entries (same species may appear with different biome_ids)
      const speciesMap = {};
      for (const sp of bd.species) {
        if (!speciesMap[sp.id]) {
          speciesMap[sp.id] = { ...sp };
        } else {
          speciesMap[sp.id].population += sp.population;
        }
      }
      const sorted = Object.values(speciesMap).sort((a, b) => b.population - a.population).slice(0, 15);

      return {
        title: biomeName,
        speciesList: sorted,
        biomePopulation: bd.population,
        biomeCapacity: detail?.carrying_capacity || null,
      };
    }

    // Global top-10 species
    if (animFrame?.species) {
      const speciesMap = {};
      for (const sp of animFrame.species) {
        if (!speciesMap[sp.id]) {
          speciesMap[sp.id] = { ...sp, population: 0 };
        }
        speciesMap[sp.id].population += sp.population;
      }
      const sorted = Object.values(speciesMap).sort((a, b) => b.population - a.population).slice(0, 10);
      return {
        title: 'Top Species (Global)',
        speciesList: sorted,
        biomePopulation: null,
        biomeCapacity: null,
      };
    }

    return { title: 'Select a Biome', speciesList: [], biomePopulation: null, biomeCapacity: null };
  }, [selectedBiomeId, currentBiomeData, biomeDetails, biomeTimeseries, animFrame]);

  const maxPop = speciesList.length > 0 ? Math.max(1, speciesList[0].population) : 1;

  return (
    <div className="card" style={{ padding: '12px 14px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="panel-title" style={{ marginBottom: 0, textTransform: 'capitalize' }}>
          {title}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {selectedSpeciesId != null && (
            <button
              onClick={() => onSelectSpecies(null)}
              style={{
                background: 'var(--accent-bg)',
                border: '1px solid var(--accent-light)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 8px',
                fontSize: 10,
                color: 'var(--accent)',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Tracking #{selectedSpeciesId} &times;
            </button>
          )}
          {selectedBiomeId != null && (
            <button
              onClick={() => { onSelectBiome(null); onSelectSpecies(null); }}
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 8px',
                fontSize: 10,
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Capacity gauge */}
      {biomePopulation != null && biomeCapacity != null && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>
            <span>Capacity</span>
            <span>{biomePopulation.toLocaleString()} / {biomeCapacity.toLocaleString()}</span>
          </div>
          <div style={{ height: 4, background: 'var(--bg-secondary)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, (biomePopulation / biomeCapacity) * 100)}%`,
              background: biomePopulation > biomeCapacity ? 'var(--pink)' : 'var(--accent)',
              borderRadius: 2,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      )}

      {/* Species list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {speciesList.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '16px 0', textAlign: 'center' }}>
            {animFrame ? 'Click a biome on the map' : 'Run simulation to see species'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {speciesList.map(sp => {
              const badge = TROPHIC_BADGES[sp.trophic] || TROPHIC_BADGES.producer;
              const popPct = (sp.population / maxPop) * 100;
              const isSelected = selectedSpeciesId === sp.id;
              return (
                <div
                  key={sp.id}
                  className={`species-row ${isSelected ? 'species-row-selected' : ''}`}
                  onClick={() => onSelectSpecies(isSelected ? null : sp.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <img
                    src={`${SPRITE_BASE}${sp.id}.png`}
                    alt={sp.name}
                    width={28}
                    height={28}
                    style={{ imageRendering: 'pixelated', flexShrink: 0 }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 500, color: 'var(--text-primary)',
                        textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {sp.name}
                      </span>
                      <span style={{
                        fontSize: 10, fontFamily: 'monospace', color: 'var(--text-muted)', flexShrink: 0, marginLeft: 4,
                      }}>
                        {sp.population.toLocaleString()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <div style={{
                        flex: 1, height: 3, background: 'var(--bg-secondary)', borderRadius: 2, overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%', width: `${popPct}%`, background: badge.color, borderRadius: 2,
                          transition: 'width 0.3s ease',
                        }} />
                      </div>
                      <span style={{
                        fontSize: 8, fontWeight: 700, color: badge.color, letterSpacing: 0.5,
                      }}>
                        {badge.label}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
