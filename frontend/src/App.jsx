import { useState, useCallback } from 'react';
import StardewMap from './components/StardewMap';
import Sidebar from './components/Sidebar';
import TimelineBar from './components/TimelineBar';

function App() {
  const [selectedSpecies, setSelectedSpecies] = useState(null);
  const [currentTick, setCurrentTick] = useState(0);
  const [animFrame, setAnimFrame] = useState(null);

  const handleTicksRun = useCallback((result) => {
    setCurrentTick(result.end_tick);
    setSelectedSpecies(null);
  }, []);

  const handleFrame = useCallback((frame) => {
    setAnimFrame(frame);
    setCurrentTick(frame.tick);
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <StardewMap
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
    </div>
  );
}

export default App;
