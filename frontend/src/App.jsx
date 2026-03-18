import { useState, useCallback } from 'react';
import IsometricScene from './components/IsometricScene';
import BiomeMap from './components/BiomeMap';
import Sidebar from './components/Sidebar';
import TimelineBar from './components/TimelineBar';

function App() {
  const [selectedSpecies, setSelectedSpecies] = useState(null);
  const [currentTick, setCurrentTick] = useState(0);
  const [animFrame, setAnimFrame] = useState(null);
  const [use3D, setUse3D] = useState(true);

  const handleTicksRun = useCallback((result) => {
    setCurrentTick(result.end_tick);
    setSelectedSpecies(null);
  }, []);

  const handleFrame = useCallback((frame) => {
    setAnimFrame(frame);
    setCurrentTick(frame.tick);
  }, []);

  const MapComponent = use3D ? IsometricScene : BiomeMap;

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <MapComponent
        onSpeciesClick={(dot) => setSelectedSpecies(dot)}
        onTickLoaded={setCurrentTick}
        animFrame={animFrame}
      />
      <Sidebar
        selectedSpecies={selectedSpecies}
        onClose={() => setSelectedSpecies(null)}
      />
      <TimelineBar
        currentTick={currentTick}
        onTicksRun={handleTicksRun}
        onFrame={handleFrame}
      />
      {/* View toggle */}
      <button
        onClick={() => setUse3D(v => !v)}
        style={{
          position: 'fixed', top: 10, left: 10, zIndex: 100,
          background: 'rgba(0,0,0,0.7)', color: '#eee', border: '1px solid #444',
          borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
        }}
      >
        {use3D ? '2D View' : '3D View'}
      </button>
    </div>
  );
}

export default App;
