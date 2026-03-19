import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { runAnimationFrames, getEvents } from '../data';

function generateEventsFromFrames(frames, catalog) {
  const events = [];
  let prevSeason = null;

  // Pre-build index: species_id -> catalog indices
  const speciesIndices = new Map();
  for (let j = 0; j < catalog.length; j++) {
    const id = catalog[j].id;
    if (!speciesIndices.has(id)) speciesIndices.set(id, []);
    speciesIndices.get(id).push(j);
  }

  // Track population milestones (fire once per threshold)
  const startPop = frames[0]?.total_population || 0;
  const milestoneStep = Math.pow(10, Math.floor(Math.log10(startPop)) - 1) * 5; // e.g. 50,000 for ~474K
  let nextMilestoneDown = Math.floor(startPop / milestoneStep) * milestoneStep - milestoneStep;

  // Track unique species count milestones
  const startSpeciesSet = new Set();
  for (let j = 0; j < catalog.length; j++) {
    if (frames[0]?.populations[j] > 0) startSpeciesSet.add(catalog[j].id);
  }
  const startSpeciesCount = startSpeciesSet.size;
  let nextSpeciesMilestone = startSpeciesCount - 10; // every 10 species lost

  // Track already-extinct species (don't re-report)
  const extinctSpecies = new Set();

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const season = frame.season || getSeason(frame.tick);

    // Season change
    if (season !== prevSeason) {
      events.push({ tick: frame.tick, type: 'season_change', season });
      prevSeason = season;
    }

    if (i > 0) {
      const currPops = frame.populations;

      // Full species extinction (gone from ALL biomes)
      for (const [speciesId, indices] of speciesIndices) {
        if (extinctSpecies.has(speciesId)) continue;
        const fullyExtinct = indices.every(k => currPops[k] === 0);
        if (fullyExtinct) {
          extinctSpecies.add(speciesId);
          const sp = catalog[indices[0]];
          events.push({
            tick: frame.tick,
            type: 'extinction',
            species_id: sp.id,
            species_name: sp.name,
            detail: `${sp.name} is now extinct`,
          });
        }
      }

      // Population milestone (crossed a round number going down)
      if (frame.total_population <= nextMilestoneDown && nextMilestoneDown > 0) {
        events.push({
          tick: frame.tick,
          type: 'disaster',
          detail: `Population below ${nextMilestoneDown.toLocaleString()}`,
        });
        nextMilestoneDown -= milestoneStep;
      }

      // Species count milestone
      const currentUniqueSpecies = new Set();
      for (let j = 0; j < catalog.length; j++) {
        if (currPops[j] > 0) currentUniqueSpecies.add(catalog[j].id);
      }
      const uniqueCount = currentUniqueSpecies.size;
      if (uniqueCount <= nextSpeciesMilestone && nextSpeciesMilestone > 0) {
        const lost = startSpeciesCount - uniqueCount;
        events.push({
          tick: frame.tick,
          type: 'disease',
          detail: `${lost} species lost (${uniqueCount} remaining)`,
        });
        nextSpeciesMilestone -= 10;
      }
    }
  }

  console.log(`[Events] Generated: ${events.length} events`);
  return events;
}

function getSeason(tick) {
  const t = tick % 100;
  if (t < 25) return 'spring';
  if (t < 50) return 'summer';
  if (t < 75) return 'autumn';
  return 'winter';
}

export default function TimelineBar({ currentTick, onTicksRun, onFrame, onPlayStateChange }) {
  const [loading, setLoading] = useState(false);
  const [frames, setFrames] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(150);
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
      const data = await runAnimationFrames();
      setCatalog(data.species);
      setFrames(data.frames);
      setFrameIdx(0);
      if (onTicksRun) onTicksRun(data);

      // Load events: try server/static first, fall back to client-side generation
      let eventData = [];
      try {
        eventData = await getEvents();
      } catch (e) {
        // ignore
      }
      if (!eventData || eventData.length === 0) {
        eventData = generateEventsFromFrames(data.frames, data.species);
        console.log(`[Timeline] Generated ${eventData.length} events from frame data`);
      }
      const evMap = new Map();
      for (const ev of eventData) {
        if (!evMap.has(ev.tick)) evMap.set(ev.tick, []);
        evMap.get(ev.tick).push(ev);
      }
      eventsMapRef.current = evMap;

      setPlaying(true);
    } catch (err) {
      console.error('Simulation failed:', err);
    } finally {
      setLoading(false);
    }
  }, [onTicksRun]);

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
              {loading ? 'Loading...' : 'Run Animation'}
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
              <option value={300}>0.5x</option>
              <option value={150}>1x</option>
              <option value={75}>2x</option>
              <option value={35}>4x</option>
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

      {/* Scrub bar with season bands and event markers */}
      {frames && (
        <div style={{ position: 'relative', marginTop: 8 }}>
          {/* Season color bands */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 4,
            display: 'flex', borderRadius: 2, overflow: 'hidden',
            pointerEvents: 'none',
          }}>
            {frames.map((f, i) => {
              const s = f.season || getSeason(f.tick);
              const colors = {
                spring: 'var(--season-spring)',
                summer: 'var(--season-summer)',
                autumn: 'var(--season-autumn)',
                winter: 'var(--season-winter)',
              };
              return (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    background: colors[s] || 'var(--bg-secondary)',
                    opacity: 0.35,
                  }}
                />
              );
            })}
          </div>

          {/* Event marker dots */}
          {eventsMapRef.current && (
            <div style={{
              position: 'absolute', top: -4, left: 0, right: 0, height: 4,
              pointerEvents: 'none',
            }}>
              {Array.from(eventsMapRef.current.entries()).map(([tick, evts]) => {
                const nonSeason = evts.filter(e => e.type !== 'season_change');
                if (nonSeason.length === 0) return null;
                const startTick = frames[0]?.tick || 1;
                const endTick = frames[frames.length - 1]?.tick || 200;
                const pct = ((tick - startTick) / (endTick - startTick)) * 100;
                const hasDisaster = nonSeason.some(e => e.type === 'disaster');
                return (
                  <div
                    key={tick}
                    style={{
                      position: 'absolute',
                      left: `${pct}%`,
                      top: 0,
                      width: 3,
                      height: 3,
                      borderRadius: '50%',
                      background: hasDisaster ? '#e86b8a' : '#e8944a',
                      transform: 'translateX(-1px)',
                    }}
                  />
                );
              })}
            </div>
          )}

          <input
            type="range" min={0} max={frames.length - 1} value={frameIdx}
            onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)); }}
            style={{ width: '100%', accentColor: 'var(--accent)', height: 4, position: 'relative' }}
          />
        </div>
      )}
    </div>
  );
}
