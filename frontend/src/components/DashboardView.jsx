import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import DashboardHeader from './DashboardHeader';
import BiomeMap from './dashboard/BiomeMap';
import DataPanel from './DataPanel';
import TimelineBar from './TimelineBar';
import EventToast from './EventToast';
import { getMap, getBiomeTimeseries, getAllBiomeDetails } from '../data';

function getSeason(tick) {
  const t = tick % 100;
  if (t < 25) return 'spring';
  if (t < 50) return 'summer';
  if (t < 75) return 'autumn';
  return 'winter';
}

export default function DashboardView() {
  // Data
  const [mapData, setMapData] = useState(null);
  const [biomeTimeseries, setBiomeTimeseries] = useState(null);
  const [biomeDetails, setBiomeDetails] = useState(null);

  // Playback state
  const [currentTick, setCurrentTick] = useState(0);
  const [animFrame, setAnimFrame] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [toasts, setToasts] = useState([]);
  const toastTimerRef = useRef(null);

  // Population history — grows as animation plays
  const [popHistory, setPopHistory] = useState([]);

  // Interaction state
  const [selectedBiomeId, setSelectedBiomeId] = useState(null);
  const [hoveredBiomeId, setHoveredBiomeId] = useState(null);
  const [mapColorMode, setMapColorMode] = useState('biome');
  const [selectedSpeciesId, setSelectedSpeciesId] = useState(null);

  // Load data on mount
  useEffect(() => {
    getMap().then(setMapData);
    getBiomeTimeseries().then(setBiomeTimeseries);
    getAllBiomeDetails().then(details => {
      const map = {};
      for (const d of details) map[d.id] = d;
      setBiomeDetails(map);
    });
  }, []);

  // Auto-dismiss toasts
  useEffect(() => {
    if (toasts.length === 0) return;
    toastTimerRef.current = setInterval(() => {
      setToasts(prev => prev.filter(t => Date.now() - t.createdAt < 6000));
    }, 500);
    return () => clearInterval(toastTimerRef.current);
  }, [toasts.length > 0]);

  const handleTicksRun = useCallback((result) => {
    setCurrentTick(result.end_tick);
  }, []);

  const handleFrame = useCallback((frame) => {
    if (!frame) {
      setAnimFrame(null);
      setToasts([]);
      setPopHistory([]);
      return;
    }
    setAnimFrame(frame);
    setCurrentTick(frame.tick);

    // Accumulate population + species history for charts
    const uniqueSpecies = new Set(frame.species.map(s => s.id)).size;
    setPopHistory(prev => {
      const entry = { tick: frame.tick, total: frame.total_population, species: uniqueSpecies };
      // If scrubbing backward, trim history
      if (prev.length > 0 && frame.tick <= prev[prev.length - 1].tick) {
        const trimmed = prev.filter(p => p.tick < frame.tick);
        return [...trimmed, entry];
      }
      return [...prev, entry];
    });

    // Create toasts only for major events (disasters, disease, milestones)
    if (frame.events && frame.events.length > 0) {
      const majorEvents = frame.events.filter(e =>
        e.type === 'disaster' || e.type === 'disease' || e.type === 'fire' ||
        e.type === 'drought' || e.type === 'flood' || e.type === 'bloom'
      );
      const extinctions = frame.events.filter(e => e.type === 'extinction');

      const batch = [...majorEvents];
      // Only show extinction toast if 3+ species went extinct this tick
      if (extinctions.length >= 3) {
        batch.push({
          tick: frame.tick,
          type: 'extinction',
          species_name: `${extinctions.length} species`,
          detail: `${extinctions.length} species went extinct this tick`,
        });
      }

      if (batch.length > 0) {
        const newToasts = batch.slice(0, 2).map(e => ({
          ...e,
          id: `${e.tick}-${e.type}-${Math.random().toString(36).slice(2, 6)}`,
          createdAt: Date.now(),
        }));
        setToasts(prev => [...prev, ...newToasts].slice(-2));
      }
    }
  }, []);

  const handlePlayStateChange = useCallback((isPlaying) => {
    setPlaying(isPlaying);
  }, []);

  // Compute live stats from animFrame
  const liveStats = useMemo(() => {
    if (!animFrame || !animFrame.species) return null;
    const uniqueIds = new Set(animFrame.species.map(sp => sp.id));
    const tMap = {};
    for (const sp of animFrame.species) {
      const level = sp.trophic;
      if (!level) continue;
      if (!tMap[level]) tMap[level] = { level, species_count: 0, total_population: 0 };
      tMap[level].species_count++;
      tMap[level].total_population += sp.population;
    }
    return {
      total_population: animFrame.total_population,
      living_species: uniqueIds.size,
      season: animFrame.season || getSeason(animFrame.tick),
      year: Math.floor(animFrame.tick / 100) + 1,
      trophic: Object.values(tMap),
    };
  }, [animFrame]);

  // Biome-level data for current frame (aggregated from animFrame species)
  const currentBiomeData = useMemo(() => {
    if (!animFrame || !animFrame.species) return null;
    const biomes = {};
    for (const sp of animFrame.species) {
      const bid = sp.biome_id;
      if (!biomes[bid]) biomes[bid] = { population: 0, species: [], speciesCount: 0 };
      biomes[bid].population += sp.population;
      biomes[bid].species.push(sp);
      biomes[bid].speciesCount++;
    }
    return biomes;
  }, [animFrame]);

  // Determine current tick index for timeseries (find closest sampled tick)
  const timeseriesTickIdx = useMemo(() => {
    if (!biomeTimeseries || !biomeTimeseries.ticks.length) return 0;
    const ticks = biomeTimeseries.ticks;
    // Binary search for closest tick <= currentTick
    let lo = 0, hi = ticks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ticks[mid] <= currentTick) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }, [biomeTimeseries, currentTick]);

  const season = animFrame?.season || getSeason(currentTick);

  return (
    <div className="dashboard-root">
      {/* Header */}
      <DashboardHeader
        season={season}
        year={Math.floor(currentTick / 100) + 1}
        totalPopulation={liveStats?.total_population ?? null}
        livingSpecies={liveStats?.living_species ?? null}
        currentTick={currentTick}
      />

      {/* Main content area */}
      <div className="dashboard-main">
        {/* Left: Map */}
        <div className="dashboard-map-container">
          <BiomeMap
            mapData={mapData}
            biomeTimeseries={biomeTimeseries}
            currentBiomeData={currentBiomeData}
            tickIdx={timeseriesTickIdx}
            colorMode={mapColorMode}
            onColorModeChange={setMapColorMode}
            selectedBiomeId={selectedBiomeId}
            onSelectBiome={setSelectedBiomeId}
            hoveredBiomeId={hoveredBiomeId}
            onHoverBiome={setHoveredBiomeId}
            biomeDetails={biomeDetails}
            events={animFrame?.events}
            animFrame={animFrame}
            selectedSpeciesId={selectedSpeciesId}
          />

        </div>

        {/* Right: Data Panel */}
        <div className="dashboard-data-panel">
          <DataPanel
            liveStats={liveStats}
            biomeTimeseries={biomeTimeseries}
            popHistory={popHistory}
            currentTick={currentTick}
            tickIdx={timeseriesTickIdx}
            selectedBiomeId={selectedBiomeId}
            onSelectBiome={setSelectedBiomeId}
            currentBiomeData={currentBiomeData}
            biomeDetails={biomeDetails}
            animFrame={animFrame}
            selectedSpeciesId={selectedSpeciesId}
            onSelectSpecies={setSelectedSpeciesId}
          />
        </div>
      </div>

      {/* Event toasts */}
      <EventToast toasts={toasts} />

      {/* Bottom: Timeline */}
      <div className="dashboard-timeline">
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
