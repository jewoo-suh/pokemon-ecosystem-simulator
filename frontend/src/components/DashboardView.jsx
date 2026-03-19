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

  // Interaction state
  const [selectedBiomeId, setSelectedBiomeId] = useState(null);
  const [hoveredBiomeId, setHoveredBiomeId] = useState(null);
  const [mapColorMode, setMapColorMode] = useState('biome');

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
      setToasts(prev => prev.filter(t => Date.now() - t.createdAt < 3500));
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
      return;
    }
    setAnimFrame(frame);
    setCurrentTick(frame.tick);

    // Create toasts for non-season events
    if (frame.events && frame.events.length > 0) {
      const tickEvents = frame.events.filter(e => e.type !== 'season_change');
      if (tickEvents.length > 0) {
        const disasters = tickEvents.filter(e => e.type === 'disaster');
        const extinctions = tickEvents.filter(e => e.type === 'extinction');
        const others = tickEvents.filter(e => e.type !== 'disaster' && e.type !== 'extinction');

        const batch = [];
        for (const e of disasters) batch.push(e);
        if (extinctions.length <= 2) {
          for (const e of extinctions) batch.push(e);
        } else {
          batch.push(extinctions[0]);
          batch.push({
            tick: frame.tick,
            type: 'extinction',
            species_name: `+${extinctions.length - 1} more`,
            detail: `${extinctions.length} species lost habitat this tick`,
          });
        }
        for (const e of others) batch.push(e);

        const newToasts = batch.slice(0, 3).map(e => ({
          ...e,
          id: `${e.tick}-${e.type}-${e.species_id || ''}-${Math.random().toString(36).slice(2, 6)}`,
          createdAt: Date.now(),
        }));
        setToasts(prev => [...prev, ...newToasts].slice(-3));
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

  // Determine current tick index for timeseries
  const timeseriesTickIdx = biomeTimeseries
    ? Math.max(0, Math.min(currentTick - 1, biomeTimeseries.ticks.length - 1))
    : 0;

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
          />
        </div>

        {/* Right: Data Panel */}
        <div className="dashboard-data-panel">
          <DataPanel
            liveStats={liveStats}
            biomeTimeseries={biomeTimeseries}
            currentTick={currentTick}
            tickIdx={timeseriesTickIdx}
            selectedBiomeId={selectedBiomeId}
            onSelectBiome={setSelectedBiomeId}
            currentBiomeData={currentBiomeData}
            biomeDetails={biomeDetails}
            animFrame={animFrame}
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
