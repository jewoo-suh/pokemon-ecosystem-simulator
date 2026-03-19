import { useState, useCallback, useEffect, useRef } from 'react';
import IsometricScene from './IsometricScene';
import StatsPanel from './StatsPanel';
import TimelineBar from './TimelineBar';
import EventToast from './EventToast';
import { getStatsOverview, getStatsTrophic } from '../data';

export default function WorldView() {
  const [currentTick, setCurrentTick] = useState(0);
  const [animFrame, setAnimFrame] = useState(null);
  const [overview, setOverview] = useState(null);
  const [trophic, setTrophic] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [toasts, setToasts] = useState([]);
  const toastTimerRef = useRef(null);

  // simState: 'idle' | 'running' | 'paused'
  const simState = !animFrame ? 'idle' : playing ? 'running' : 'paused';
  const frozen = simState !== 'running';

  useEffect(() => {
    getStatsOverview().then(setOverview);
    getStatsTrophic().then(setTrophic);
  }, []);

  // Auto-dismiss toasts
  useEffect(() => {
    if (toasts.length === 0) return;
    toastTimerRef.current = setInterval(() => {
      setToasts(prev => prev.filter(t => Date.now() - t.createdAt < 3500));
    }, 500);
    return () => clearInterval(toastTimerRef.current);
  }, [toasts.length > 0]);

  const handleTicksRun = useCallback((result) => {
    setCurrentTick(result.end_tick);
  }, []);

  const handleFrame = useCallback((frame) => {
    if (!frame) {
      // Reset to idle
      setAnimFrame(null);
      setToasts([]);
      return;
    }

    setAnimFrame(frame);
    setCurrentTick(frame.tick);

    // Create toasts for non-season events
    if (frame.events && frame.events.length > 0) {
      const newToasts = frame.events
        .filter(e => e.type !== 'season_change')
        .map(e => ({
          ...e,
          id: `${e.tick}-${e.type}-${e.species_id || ''}-${Math.random().toString(36).slice(2, 6)}`,
          createdAt: Date.now(),
        }));
      if (newToasts.length > 0) {
        setToasts(prev => [...prev, ...newToasts].slice(-3));
      }
    }
  }, []);

  const handlePlayStateChange = useCallback((isPlaying) => {
    setPlaying(isPlaying);
  }, []);

  // Compute live stats from animFrame (deduplicate species across biomes)
  const liveOverview = animFrame && animFrame.species ? (() => {
    const uniqueIds = new Set(animFrame.species.map(sp => sp.id));
    const livingCount = uniqueIds.size;
    const totalSpecies = overview?.total_species || livingCount;
    return {
      total_population: animFrame.total_population,
      living_species: livingCount,
      total_species: totalSpecies,
      survival_rate: Math.round(livingCount / totalSpecies * 1000) / 10,
    };
  })() : overview;

  const liveTrophic = animFrame && animFrame.species ? (() => {
    const tMap = {};
    for (const sp of animFrame.species) {
      const level = sp.trophic;
      if (!level) continue;
      if (!tMap[level]) tMap[level] = { level, species_count: 0, total_population: 0 };
      tMap[level].species_count++;
      tMap[level].total_population += sp.population;
    }
    return Object.values(tMap);
  })() : trophic;

  // Current events for biome pulse
  const currentEvents = animFrame?.events || [];

  return (
    <div style={{
      height: '100%', width: '100%',
      position: 'relative', overflow: 'hidden',
      background: 'var(--bg-primary)',
    }}>
      {/* 3D World */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <IsometricScene
          onTickLoaded={setCurrentTick}
          animFrame={animFrame}
          frozen={frozen}
          events={currentEvents}
        />
      </div>

      {/* Top-left: project title */}
      <div style={{
        position: 'absolute', top: 16, left: 20, zIndex: 10,
      }}>
        <div className="card-glass" style={{ padding: '10px 18px' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 14, fontWeight: 600,
            color: 'var(--text-primary)',
          }}>
            Pokemon Ecosystem
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {liveOverview ? `${liveOverview.living_species} species alive` : 'Loading...'}
          </div>
        </div>
      </div>

      {/* Event toasts */}
      <EventToast toasts={toasts} />

      {/* Top-right: stats panel */}
      <div style={{
        position: 'absolute', top: 16, right: 20, zIndex: 10,
        width: 280,
      }}>
        <StatsPanel
          overview={liveOverview}
          trophic={liveTrophic}
          currentTick={currentTick}
          season={animFrame?.season}
        />
      </div>

      {/* Bottom: timeline bar */}
      <div style={{
        position: 'absolute', bottom: 16, left: 20, right: 20, zIndex: 10,
      }}>
        <TimelineBar
          currentTick={currentTick}
          onTicksRun={handleTicksRun}
          onFrame={handleFrame}
          onPlayStateChange={handlePlayStateChange}
        />
      </div>
    </div>
  );
}
