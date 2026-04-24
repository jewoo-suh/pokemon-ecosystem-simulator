import { useEffect, useState } from 'react';
import DashboardView from './DashboardView';
import SpeciesView from './SpeciesView';
import DataView from './DataView';
import RulesView from './RulesView';

const VALID_TABS = new Set(['dashboard', 'species', 'data', 'rules']);

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  const first = parts[0] || '';

  // Legacy aliases
  if (first === 'ecology') return { tab: 'data', subtab: 'affinity', arg: null };
  if (first === 'biomes') return { tab: 'data', subtab: 'biomes', arg: parts[1] || null };

  if (first === 'data') {
    return { tab: 'data', subtab: parts[1] || null, arg: parts[2] || null };
  }
  if (first === 'species') {
    return { tab: 'species', subtab: null, arg: parts[1] || null };
  }
  return {
    tab: VALID_TABS.has(first) ? first : 'dashboard',
    subtab: null,
    arg: null,
  };
}

export default function WorldView() {
  const [route, setRoute] = useState(parseHash);
  const [speciesMounted, setSpeciesMounted] = useState(() => parseHash().tab === 'species');
  const [dataMounted, setDataMounted] = useState(() => parseHash().tab === 'data');

  // React to browser back/forward + external hash edits
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Lazy-mount tabs as they become active
  useEffect(() => {
    if (route.tab === 'species') setSpeciesMounted(true);
    if (route.tab === 'data') setDataMounted(true);
  }, [route.tab]);

  const switchTab = (t) => {
    window.location.hash = t;
  };

  const onChangeSpeciesId = (id) => {
    window.location.hash = id != null ? `species/${id}` : 'species';
  };

  const speciesIdFromRoute = route.tab === 'species' && route.arg
    ? Number(route.arg)
    : null;

  return (
    <div className="world-root">
      <div className="world-tabs">
        <button
          className={`world-tab ${route.tab === 'dashboard' ? 'active' : ''}`}
          onClick={() => switchTab('dashboard')}
        >
          <span className="world-tab-icon">🗺️</span> Dashboard
        </button>
        <button
          className={`world-tab ${route.tab === 'species' ? 'active' : ''}`}
          onClick={() => switchTab('species')}
        >
          <span className="world-tab-icon">📖</span> Pokédex
        </button>
        <button
          className={`world-tab ${route.tab === 'data' ? 'active' : ''}`}
          onClick={() => switchTab('data')}
        >
          <span className="world-tab-icon">📊</span> Data
        </button>
        <button
          className={`world-tab ${route.tab === 'rules' ? 'active' : ''}`}
          onClick={() => switchTab('rules')}
        >
          <span className="world-tab-icon">📜</span> Rules
        </button>
      </div>

      <div className="world-body">
        <div className="world-pane" style={{ display: route.tab === 'dashboard' ? 'flex' : 'none' }}>
          <DashboardView />
        </div>
        {speciesMounted && (
          <div className="world-pane" style={{ display: route.tab === 'species' ? 'flex' : 'none' }}>
            <SpeciesView
              routedSpeciesId={speciesIdFromRoute}
              onChangeSpeciesId={onChangeSpeciesId}
            />
          </div>
        )}
        {dataMounted && (
          <div className="world-pane" style={{ display: route.tab === 'data' ? 'flex' : 'none' }}>
            <DataView
              initialSubtab={route.tab === 'data' ? route.subtab : null}
              subtabArg={route.tab === 'data' ? route.arg : null}
            />
          </div>
        )}
        <div className="world-pane" style={{ display: route.tab === 'rules' ? 'flex' : 'none' }}>
          <RulesView />
        </div>
      </div>
    </div>
  );
}
