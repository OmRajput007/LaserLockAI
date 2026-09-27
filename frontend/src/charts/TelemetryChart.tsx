import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface ChartProps {
  data: { time: number; error: number; fov: number }[];
  maxThreshold?: number;
}

export const TelemetryChart: React.FC<ChartProps> = ({ data, maxThreshold = 10 }) => {
  return (
    <div className="w-full h-full flex flex-col bg-slate-900/60 border border-slate-800 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2 font-mono text-xs">
        <div className="flex items-center gap-2 text-cyan-400 font-semibold">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
          <span>REAL-TIME TRACKING ERROR (PIXELS)</span>
        </div>
        <div className="flex items-center gap-4 text-slate-400 text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-cyan-400 inline-block"></span>
            <span>Error (px)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-emerald-500 inline-block"></span>
            <span>Req Limit (≤10 px)</span>
          </span>
        </div>
      </div>

      <div className="flex-1 w-full min-h-[160px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 20, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="time"
              stroke="#64748b"
              tickFormatter={(val) => `${Number(val).toFixed(1)}s`}
              tick={{ fontSize: 10, fill: '#64748b', fontFamily: 'monospace' }}
            />
            <YAxis
              stroke="#64748b"
              domain={[0, Math.max(25, ...data.map((d) => d.error))]}
              tick={{ fontSize: 10, fill: '#64748b', fontFamily: 'monospace' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#090d16',
                borderColor: '#334155',
                fontSize: '11px',
                fontFamily: 'monospace',
                color: '#f8fafc',
              }}
              formatter={(value: any) => [`${Number(value).toFixed(2)} px`, 'Tracking Error']}
              labelFormatter={(label) => `Time: ${Number(label).toFixed(2)}s`}
            />
            <ReferenceLine
              y={maxThreshold}
              stroke="#10b981"
              strokeDasharray="4 4"
              label={{
                value: 'Limit: 10px',
                fill: '#10b981',
                fontSize: 10,
                position: 'top',
                fontFamily: 'monospace',
              }}
            />
            <Line
              type="monotone"
              dataKey="error"
              stroke="#38bdf8"
              strokeWidth={1.8}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
