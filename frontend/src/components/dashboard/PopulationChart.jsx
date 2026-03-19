import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer,
} from 'recharts';

const TROPHIC_ORDER = ['producer', 'primary_consumer', 'secondary_consumer', 'apex_predator', 'decomposer'];
const TROPHIC_COLORS = {
  producer: 'var(--trophic-producer)',
  primary_consumer: 'var(--trophic-primary)',
  secondary_consumer: 'var(--trophic-secondary)',
  apex_predator: 'var(--trophic-apex)',
  decomposer: 'var(--trophic-decomposer)',
};

// Raw color values for recharts (CSS vars don't work in SVG fills)
const TROPHIC_RAW = {
  producer: '#6abf69',
  primary_consumer: '#5b9bd5',
  secondary_consumer: '#e8944a',
  apex_predator: '#e86b8a',
  decomposer: '#8b6bbf',
};

export default function PopulationChart({ biomeTimeseries, currentTick, tickIdx, animFrame }) {
  // Build chart data from animation frames or timeseries
  const chartData = useMemo(() => {
    if (!animFrame?.allFrames && !biomeTimeseries) return null;

    // If we have all frames cached (injected from TimelineBar), use those
    // Otherwise build from biomeTimeseries total population
    if (biomeTimeseries) {
      const data = [];
      const numTicks = biomeTimeseries.ticks.length;
      for (let t = 0; t < numTicks; t++) {
        let totalPop = 0;
        for (let b = 0; b < biomeTimeseries.biome_ids.length; b++) {
          totalPop += biomeTimeseries.population[b]?.[t] || 0;
        }
        data.push({ tick: t + 1, total: totalPop });
      }
      return data;
    }
    return null;
  }, [biomeTimeseries, animFrame?.allFrames]);

  if (!chartData || chartData.length === 0) {
    return (
      <div className="card" style={{ padding: '12px 14px' }}>
        <div className="panel-title">Population Over Time</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
          Run simulation to see population trends
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="panel-title">Population Over Time</div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
          <defs>
            <linearGradient id="popGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7c6cf0" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#7c6cf0" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="tick"
            tick={{ fontSize: 10, fill: '#9a9aad' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#9a9aad' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(26, 26, 46, 0.95)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              fontSize: 12,
              color: '#fff',
            }}
            formatter={(value) => [value.toLocaleString(), 'Population']}
            labelFormatter={(tick) => `Tick ${tick}`}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke="#7c6cf0"
            strokeWidth={2}
            fill="url(#popGradient)"
          />
          {currentTick > 0 && (
            <ReferenceLine
              x={currentTick}
              stroke="#7c6cf0"
              strokeWidth={2}
              strokeDasharray="4 2"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
