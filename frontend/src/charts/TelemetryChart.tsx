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
import { THEME } from '../theme';

interface ChartProps {
  data: { time: number; error: number; fov: number }[];
  maxThreshold?: number;
}

export const TelemetryChart: React.FC<ChartProps> = ({ data, maxThreshold = 10 }) => {
  return (
    <div className="w-full h-full flex flex-col bg-[#1B1D1A] border border-[#33362F] rounded-lg p-3">
      <div className="flex items-center justify-between mb-2 font-mono text-xs">
        <div className="flex items-center gap-2 text-[#FF5F40] font-semibold">
          <span className="w-2 h-2 rounded-full bg-[#FF5F40]"></span>
          <span className="tracking-wide uppercase">REAL-TIME TRACKING ERROR (PIXELS)</span>
        </div>
        <div className="flex items-center gap-4 text-[#9CA195] text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[#FF5F40] inline-block"></span>
            <span className="text-[#F0FFEA]">Error (px)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[#F0FFEA] inline-block border-t border-dashed border-[#F0FFEA]"></span>
            <span>Req Limit (≤10 px)</span>
          </span>
        </div>
      </div>

      <div className="flex-1 w-full min-h-[160px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 20, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={THEME.chart.grid} />
            <XAxis
              dataKey="time"
              stroke={THEME.textMuted}
              tickFormatter={(val) => `${Number(val).toFixed(1)}s`}
              tick={{ fontSize: 10, fill: THEME.textMuted, fontFamily: 'monospace' }}
            />
            <YAxis
              stroke={THEME.textMuted}
              domain={[0, Math.max(25, ...data.map((d) => d.error))]}
              tick={{ fontSize: 10, fill: THEME.textMuted, fontFamily: 'monospace' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: THEME.chart.tooltipBg,
                borderColor: THEME.chart.tooltipBorder,
                fontSize: '11px',
                fontFamily: 'monospace',
                color: THEME.text,
                borderRadius: '6px',
              }}
              formatter={(value: any) => [`${Number(value).toFixed(2)} px`, 'Tracking Error']}
              labelFormatter={(label) => `Time: ${Number(label).toFixed(2)}s`}
            />
            <ReferenceLine
              y={maxThreshold}
              stroke={THEME.text}
              strokeDasharray="4 4"
              label={{
                value: 'Limit: 10px',
                fill: THEME.text,
                fontSize: 10,
                position: 'top',
                fontFamily: 'monospace',
              }}
            />
            <Line
              type="monotone"
              dataKey="error"
              stroke={THEME.chart.primary}
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
