import { useState } from 'react';
import DashboardView from './DashboardView';
import SpeciesView from './SpeciesView';
import EcologyView from './EcologyView';

export default function WorldView() {
  const [tab, setTab] = useState('dashboard');
  const [speciesMounted, setSpeciesMounted] = useState(false);
  const [ecologyMounted, setEcologyMounted] = useState(false);

  const switchTab = (t) => {
    setTab(t);
    if (t === 'species') setSpeciesMounted(true);
    if (t === 'ecology') setEcologyMounted(true);
  };

  return (
    <div className="world-root">
      <div className="world-tabs">
        <button
          className={`world-tab ${tab === 'dashboard' ? 'active' : ''}`}
          onClick={() => switchTab('dashboard')}
        >
          <span className="world-tab-icon">🗺️</span> Dashboard
        </button>
        <button
          className={`world-tab ${tab === 'species' ? 'active' : ''}`}
          onClick={() => switchTab('species')}
        >
          <span className="world-tab-icon">📖</span> Species
        </button>
        <button
          className={`world-tab ${tab === 'ecology' ? 'active' : ''}`}
          onClick={() => switchTab('ecology')}
        >
          <span className="world-tab-icon">🌍</span> Ecology
        </button>
      </div>

      <div className="world-body">
        <div className="world-pane" style={{ display: tab === 'dashboard' ? 'flex' : 'none' }}>
          <DashboardView />
        </div>
        {speciesMounted && (
          <div className="world-pane" style={{ display: tab === 'species' ? 'flex' : 'none' }}>
            <SpeciesView />
          </div>
        )}
        {ecologyMounted && (
          <div className="world-pane" style={{ display: tab === 'ecology' ? 'flex' : 'none' }}>
            <EcologyView />
          </div>
        )}
      </div>
    </div>
  );
}
