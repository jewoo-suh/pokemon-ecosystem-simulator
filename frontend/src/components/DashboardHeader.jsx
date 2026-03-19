export default function DashboardHeader({ season, year, totalPopulation, livingSpecies, currentTick }) {
  return (
    <div className="dashboard-header card-glass">
      <div className="dashboard-header-left">
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 15,
          fontWeight: 700,
          color: 'var(--text-primary)',
        }}>
          Pokemon Ecosystem
        </span>
      </div>
      <div className="dashboard-header-stats">
        {season && (
          <span className={`badge badge-${season}`} style={{ textTransform: 'capitalize' }}>
            {season}
          </span>
        )}
        {year > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Year {year}
          </span>
        )}
        {totalPopulation != null && (
          <span className="header-stat">
            <span className="header-stat-label">Pop</span>
            <span className="header-stat-value">{totalPopulation.toLocaleString()}</span>
          </span>
        )}
        {livingSpecies != null && (
          <span className="header-stat">
            <span className="header-stat-label">Species</span>
            <span className="header-stat-value">{livingSpecies.toLocaleString()}</span>
          </span>
        )}
        {currentTick > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            T{currentTick}
          </span>
        )}
      </div>
    </div>
  );
}
