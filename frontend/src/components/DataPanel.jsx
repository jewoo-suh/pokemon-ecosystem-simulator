import PopulationChart from './dashboard/PopulationChart';
import TrophicBars from './dashboard/TrophicBars';
import BiomeDetail from './dashboard/BiomeDetail';
import EventLog from './dashboard/EventLog';

export default function DataPanel({
  liveStats,
  biomeTimeseries,
  popHistory,
  currentTick,
  tickIdx,
  selectedBiomeId,
  onSelectBiome,
  currentBiomeData,
  biomeDetails,
  animFrame,
  selectedSpeciesId,
  onSelectSpecies,
}) {
  return (
    <div className="data-panel-inner">
      <PopulationChart
        popHistory={popHistory}
        currentTick={currentTick}
      />

      <TrophicBars trophic={liveStats?.trophic} />

      <BiomeDetail
        selectedBiomeId={selectedBiomeId}
        onSelectBiome={onSelectBiome}
        currentBiomeData={currentBiomeData}
        biomeDetails={biomeDetails}
        biomeTimeseries={biomeTimeseries}
        tickIdx={tickIdx}
        animFrame={animFrame}
        selectedSpeciesId={selectedSpeciesId}
        onSelectSpecies={onSelectSpecies}
      />

      <EventLog
        animFrame={animFrame}
        selectedBiomeId={selectedBiomeId}
        biomeTimeseries={biomeTimeseries}
      />
    </div>
  );
}
