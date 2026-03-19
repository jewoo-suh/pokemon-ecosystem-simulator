import { useState } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from 'recharts';

export default function PopulationChart({ popHistory, currentTick }) {
  const [mode, setMode] = useState('population'); // 'population' | 'species'

  if (!popHistory || popHistory.length === 0) {
    return (
      <div className="card" style={{ padding: '12px 14px' }}>
        <div className="panel-title">Population Over Time</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
          Run animation to see trends
        </div>
      </div>
    );
  }

  const startSpecies = popHistory[0]?.species || 0;
  const currentSpecies = popHistory[popHistory.length - 1]?.species || 0;
  const extinct = startSpecies - currentSpecies;

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      {/* Toggle between population and species views */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setMode('population')}
            className={`map-color-mode-btn ${mode === 'population' ? 'active' : ''}`}
          >
            Population
          </button>
          <button
            onClick={() => setMode('species')}
            className={`map-color-mode-btn ${mode === 'species' ? 'active' : ''}`}
          >
            Species Alive
          </button>
        </div>
        {mode === 'species' && extinct > 0 && (
          <span style={{ fontSize: 10, color: 'var(--pink)', fontWeight: 600 }}>
            {extinct} extinct
          </span>
        )}
      </div>

      {mode === 'population' ? (
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={popHistory} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
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
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={popHistory} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
            <defs>
              <linearGradient id="speciesGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e86b8a" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#e86b8a" stopOpacity={0.05} />
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
              formatter={(value) => [value.toLocaleString(), 'Species Alive']}
              labelFormatter={(tick) => `Tick ${tick}`}
            />
            <Area
              type="monotone"
              dataKey="species"
              stroke="#e86b8a"
              strokeWidth={2}
              fill="url(#speciesGradient)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
