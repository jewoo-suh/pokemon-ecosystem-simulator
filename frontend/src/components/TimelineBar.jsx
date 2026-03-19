import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { runAnimationFrames, getEvents } from '../data';

function getSeason(tick) {
  const t = tick % 100;
  if (t < 25) return 'spring';
  if (t < 50) return 'summer';
  if (t < 75) return 'autumn';
  return 'winter';
}

export default function TimelineBar({ currentTick, onTicksRun, onFrame, onPlayStateChange }) {
  const [tickCount, setTickCount] = useState(100);
  const [loading, setLoading] = useState(false);
  const [frames, setFrames] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(100);
  const timerRef = useRef(null);
  const eventsMapRef = useRef(null);

  // Notify parent of play state changes
  useEffect(() => {
    if (onPlayStateChange) onPlayStateChange(playing);
  }, [playing, onPlayStateChange]);

  // Playback loop
  useEffect(() => {
    if (!playing || !frames) return;
    timerRef.current = setInterval(() => {
      setFrameIdx(prev => {
        const next = prev + 1;
        if (next >= frames.length) { setPlaying(false); return prev; }
        return next;
      });
    }, speed);
    return () => clearInterval(timerRef.current);
  }, [playing, frames, speed]);

  // Push frame data to parent
  useEffect(() => {
    if (!frames || !catalog || frameIdx >= frames.length) return;
    const frame = frames[frameIdx];
    const pops = frame.populations;
    const species = [];
    for (let i = 0; i < catalog.length; i++) {
      if (pops[i] > 0) species.push({ ...catalog[i], population: pops[i] });
    }
    const tickEvents = eventsMapRef.current?.get(frame.tick) || [];
    if (onFrame) onFrame({
      tick: frame.tick,
      season: frame.season || getSeason(frame.tick),
      species,
      total_population: frame.total_population,
      living_species: frame.living_species,
      events: tickEvents,
    });
  }, [frameIdx, frames, catalog]);

  const simulate = useCallback(async () => {
    setLoading(true);
    setFrames(null); setFrameIdx(0); setPlaying(false);
    eventsMapRef.current = null;
    try {
      const data = await runAnimationFrames(tickCount);
      setCatalog(data.species);
      setFrames(data.frames);
      setFrameIdx(0);
      if (onTicksRun) onTicksRun(data);

      // Load events and index by tick
      try {
        const eventData = await getEvents();
        const evMap = new Map();
        for (const ev of eventData) {
          if (!evMap.has(ev.tick)) evMap.set(ev.tick, []);
          evMap.get(ev.tick).push(ev);
        }
        eventsMapRef.current = evMap;
      } catch (e) {
        console.warn('[Timeline] Events not available:', e);
      }

      setPlaying(true);
    } catch (err) {
      console.error('Simulation failed:', err);
    } finally {
      setLoading(false);
    }
  }, [tickCount, onTicksRun]);

  const togglePlay = () => {
    if (!frames) return;
    if (frameIdx >= frames.length - 1) { setFrameIdx(0); setPlaying(true); }
    else setPlaying(p => !p);
  };

  const handleReset = () => {
    setFrames(null);
    setCatalog(null);
    setPlaying(false);
    setFrameIdx(0);
    eventsMapRef.current = null;
    // Push null frame to signal idle
    if (onFrame) onFrame(null);
  };

  const displayTick = frames && frames[frameIdx] ? frames[frameIdx].tick : currentTick;
  const season = frames && frames[frameIdx]?.season ? frames[frameIdx].season : getSeason(displayTick);
  const totalPop = frames && frames[frameIdx] ? frames[frameIdx].total_population : null;
  const livingSpecies = frames && frames[frameIdx] ? frames[frameIdx].living_species : null;

  return (
    <div className="card-glass" style={{ padding: '10px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {/* Tick + Season */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
          <span style={{
            fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-display)',
          }}>
            Tick <strong style={{ color: 'var(--accent)' }}>{displayTick}</strong>
          </span>
          <span className={`badge badge-${season}`} style={{ textTransform: 'capitalize' }}>
            {season}
          </span>
        </div>

        <div style={{ width: 1, height: 20, background: 'rgba(0,0,0,0.08)' }} />

        {!frames ? (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Simulate</span>
            <input
              type="range" min={10} max={200} step={10} value={tickCount}
              onChange={e => setTickCount(Number(e.target.value))}
              style={{ width: 100, accentColor: 'var(--accent)' }}
              disabled={loading}
            />
            <span style={{ fontSize: 12, color: 'var(--text-primary)', minWidth: 30, fontFamily: 'monospace' }}>
              {tickCount}
            </span>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={simulate}
              disabled={loading}
              style={{
                background: loading ? 'var(--bg-secondary)' : 'var(--accent)',
                color: loading ? 'var(--text-muted)' : '#fff',
                border: 'none', borderRadius: 'var(--radius-sm)',
                padding: '6px 16px', fontSize: 12, fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer',
                fontFamily: 'var(--font-display)',
              }}
            >
              {loading ? 'Computing...' : 'Run & Animate'}
            </motion.button>
          </>
        ) : (
          <>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={togglePlay}
              style={{
                background: 'var(--accent)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius-sm)',
                padding: '6px 14px', fontSize: 12, cursor: 'pointer',
                fontFamily: 'var(--font-display)', fontWeight: 600,
              }}
            >
              {playing ? 'Pause' : 'Play'}
            </motion.button>

            <select
              value={speed}
              onChange={e => setSpeed(Number(e.target.value))}
              style={{
                background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                border: '1px solid rgba(0,0,0,0.08)', borderRadius: 'var(--radius-sm)',
                fontSize: 11, padding: '3px 6px',
              }}
            >
              <option value={200}>0.5x</option>
              <option value={100}>1x</option>
              <option value={50}>2x</option>
              <option value={25}>4x</option>
            </select>

            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {frameIdx + 1}/{frames.length}
            </span>

            {totalPop != null && (
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {livingSpecies} spp | {totalPop.toLocaleString()} pop
              </span>
            )}

            <div style={{ flex: 1 }} />
            <button
              onClick={handleReset}
              style={{
                background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                border: '1px solid rgba(0,0,0,0.08)', borderRadius: 'var(--radius-sm)',
                padding: '4px 12px', fontSize: 11, cursor: 'pointer',
              }}
            >
              Reset
            </button>
          </>
        )}
      </div>

      {/* Scrub bar */}
      {frames && (
        <input
          type="range" min={0} max={frames.length - 1} value={frameIdx}
          onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)); }}
          style={{ width: '100%', accentColor: 'var(--accent)', marginTop: 8, height: 4 }}
        />
      )}
    </div>
  );
}
