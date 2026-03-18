import { useState, useRef, useCallback, useEffect } from 'react';

const API = 'http://localhost:8000';

export default function TimelineBar({ currentTick, onTicksRun, onFrame }) {
  const [tickCount, setTickCount] = useState(50);
  const [loading, setLoading] = useState(false);
  const [frames, setFrames] = useState(null);
  const [catalog, setCatalog] = useState(null); // species catalog from API
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(100); // ms per frame
  const timerRef = useRef(null);

  // Playback loop
  useEffect(() => {
    if (!playing || !frames) return;

    timerRef.current = setInterval(() => {
      setFrameIdx(prev => {
        const next = prev + 1;
        if (next >= frames.length) {
          setPlaying(false);
          return prev;
        }
        return next;
      });
    }, speed);

    return () => clearInterval(timerRef.current);
  }, [playing, frames, speed]);

  // Push current frame to parent — reconstruct species data from catalog + populations
  useEffect(() => {
    if (!frames || !catalog || frameIdx >= frames.length) return;
    const frame = frames[frameIdx];
    const pops = frame.populations;

    // Rebuild species array from catalog + population array
    const species = [];
    for (let i = 0; i < catalog.length; i++) {
      if (pops[i] > 0) {
        species.push({ ...catalog[i], population: pops[i] });
      }
    }

    if (onFrame) onFrame({
      tick: frame.tick,
      species,
      total_population: frame.total_population,
      living_species: frame.living_species,
    });
  }, [frameIdx, frames, catalog]);

  const simulate = useCallback(async () => {
    setLoading(true);
    setFrames(null);
    setFrameIdx(0);
    setPlaying(false);
    try {
      const res = await fetch(`${API}/simulation/run-frames?ticks=${tickCount}`, { method: 'POST' });
      const data = await res.json();
      setCatalog(data.species);
      setFrames(data.frames);
      setFrameIdx(0);
      if (onTicksRun) onTicksRun(data);
      // Auto-play
      setPlaying(true);
    } catch (err) {
      console.error('Simulation failed:', err);
    } finally {
      setLoading(false);
    }
  }, [tickCount, onTicksRun]);

  const togglePlay = () => {
    if (!frames) return;
    if (frameIdx >= frames.length - 1) {
      setFrameIdx(0);
      setPlaying(true);
    } else {
      setPlaying(p => !p);
    }
  };

  const displayTick = frames && frames[frameIdx] ? frames[frameIdx].tick : currentTick;
  const totalPop = frames && frames[frameIdx] ? frames[frameIdx].total_population : null;
  const livingSpecies = frames && frames[frameIdx] ? frames[frameIdx].living_species : null;
  const currentSeason = frames && frames[frameIdx]?.season
    ? frames[frameIdx].season
    : getSeason(displayTick);

  const SEASON_STYLE = {
    spring: { label: 'Spring', color: '#86efac' },
    summer: { label: 'Summer', color: '#fbbf24' },
    autumn: { label: 'Autumn', color: '#f97316' },
    winter: { label: 'Winter', color: '#93c5fd' },
  };
  const seasonInfo = SEASON_STYLE[currentSeason] || SEASON_STYLE.spring;

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 300,
      background: 'rgba(13, 13, 26, 0.95)',
      borderTop: '1px solid #2e303a',
      padding: '8px 16px',
      zIndex: 50,
    }}>
      {/* Top row: simulate controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: frames ? 6 : 0 }}>
        <span style={{ fontSize: 13, color: '#9ca3af', whiteSpace: 'nowrap' }}>
          Tick: <strong style={{ color: '#c084fc' }}>{displayTick}</strong>
        </span>

        <span style={{
          fontSize: 11, color: seasonInfo.color, fontWeight: 600,
          padding: '2px 8px', borderRadius: 4,
          background: `${seasonInfo.color}18`,
          border: `1px solid ${seasonInfo.color}40`,
        }}>
          {seasonInfo.label}
        </span>

        <span style={{ fontSize: 11, color: '#666' }}>
          Y{Math.floor(displayTick / 100) + 1}
        </span>

        <div style={{ width: 1, height: 20, background: '#2e303a' }} />

        {!frames && (
          <>
            <label style={{ fontSize: 12, color: '#9ca3af' }}>Simulate</label>
            <input
              type="range" min={10} max={500} step={10} value={tickCount}
              onChange={e => setTickCount(Number(e.target.value))}
              style={{ width: 100, accentColor: '#c084fc' }}
              disabled={loading}
            />
            <span style={{ fontSize: 12, color: '#eee', minWidth: 30 }}>{tickCount}</span>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>ticks</span>
            <button onClick={simulate} disabled={loading} style={btnStyle(loading)}>
              {loading ? 'Computing...' : 'Run & Animate'}
            </button>
          </>
        )}

        {frames && (
          <>
            {/* Playback controls */}
            <button onClick={togglePlay} style={btnStyle(false)}>
              {playing ? '⏸' : '▶'}
            </button>

            <label style={{ fontSize: 11, color: '#9ca3af' }}>Speed</label>
            <select
              value={speed}
              onChange={e => setSpeed(Number(e.target.value))}
              style={{ background: '#2e303a', color: '#eee', border: '1px solid #444', borderRadius: 4, fontSize: 11, padding: '2px 4px' }}
            >
              <option value={200}>0.5x</option>
              <option value={100}>1x</option>
              <option value={50}>2x</option>
              <option value={25}>4x</option>
            </select>

            <span style={{ fontSize: 11, color: '#9ca3af' }}>
              {frameIdx + 1} / {frames.length}
            </span>

            {totalPop != null && (
              <span style={{ fontSize: 11, color: '#9ca3af' }}>
                | {livingSpecies} spp | {totalPop.toLocaleString()} pop
              </span>
            )}

            <div style={{ flex: 1 }} />
            <button
              onClick={() => { setFrames(null); setCatalog(null); setPlaying(false); setFrameIdx(0); }}
              style={{ ...btnStyle(false), background: '#2e303a' }}
            >
              Reset
            </button>
          </>
        )}
      </div>

      {/* Scrub bar */}
      {frames && (
        <input
          type="range"
          min={0}
          max={frames.length - 1}
          value={frameIdx}
          onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)); }}
          style={{ width: '100%', accentColor: '#c084fc', height: 4 }}
        />
      )}
    </div>
  );
}

function getSeason(tick) {
  const t = tick % 100;
  if (t < 25) return 'spring';
  if (t < 50) return 'summer';
  if (t < 75) return 'autumn';
  return 'winter';
}

function btnStyle(disabled) {
  return {
    background: disabled ? '#2e303a' : '#7c3aed',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    padding: '5px 14px',
    fontSize: 12,
    cursor: disabled ? 'wait' : 'pointer',
    whiteSpace: 'nowrap',
  };
}
