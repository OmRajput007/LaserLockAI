import React, { useState, useEffect, useRef } from 'react';
import {
  BarChart3,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Clock,
  Zap,
  Target,
  Crosshair,
  TrendingDown,
  Layers,
  Eye,
  Sliders,
  Play,
  Pause,
} from 'lucide-react';
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
import {
  SimulationTelemetry,
  SystemConfig,
  AnalyticsSummaryResponse,
  OfficialRequirementStatus,
  TelemetryPoint,
} from '../types';
import { api } from '../services/api';

interface Props {
  telemetry: SimulationTelemetry | null;
  config: SystemConfig | null;
  errorHistory?: { time: number; error: number; fov: number }[];
}

type ChartMetricId =
  | 'tracking_error'
  | 'centroid_error'
  | 'angular_error'
  | 'centroid_x'
  | 'centroid_y'
  | 'pan'
  | 'tilt'
  | 'fps'
  | 'processing_time'
  | 'confidence'
  | 'snr';

interface ChartMeta {
  id: ChartMetricId;
  title: string;
  unit: string;
  dataKey: keyof TelemetryPoint;
  stroke: string;
  refLine?: number;
  refLabel?: string;
  refColor?: string;
  domain?: [number | string, number | string];
}

const CHARTS: ChartMeta[] = [
  {
    id: 'tracking_error',
    title: 'Tracking Error vs Time',
    unit: 'px',
    dataKey: 'tracking_error_px',
    stroke: '#38bdf8', // sky-400
    refLine: 10.0,
    refLabel: 'Max Limit (≤10 px)',
    refColor: '#ef4444',
  },
  {
    id: 'centroid_error',
    title: 'Centroid Error vs Time (vs Ground Truth)',
    unit: 'px',
    dataKey: 'centroid_error_px',
    stroke: '#10b981', // emerald-500
    refLine: 5.0,
    refLabel: 'Nominal Beam (5 px)',
    refColor: '#10b981',
  },
  {
    id: 'angular_error',
    title: 'Angular Error vs Time (Azimuth/Elevation)',
    unit: 'deg',
    dataKey: 'angular_error_deg',
    stroke: '#a855f7', // purple-500
    refLine: 0.1,
    refLabel: 'Lock Threshold (0.1°)',
    refColor: '#c084fc',
  },
  {
    id: 'centroid_x',
    title: 'Centroid X vs Time',
    unit: 'px',
    dataKey: 'centroid_x',
    stroke: '#06b6d4', // cyan-500
    refLine: 320.0,
    refLabel: 'Boresight X (320 px)',
    refColor: '#eab308',
  },
  {
    id: 'centroid_y',
    title: 'Centroid Y vs Time',
    unit: 'px',
    dataKey: 'centroid_y',
    stroke: '#0ea5e9', // sky-500
    refLine: 240.0,
    refLabel: 'Boresight Y (240 px)',
    refColor: '#eab308',
  },
  {
    id: 'pan',
    title: 'Pan Gimbal Angle vs Time',
    unit: 'deg',
    dataKey: 'pan_deg',
    stroke: '#f97316', // orange-500
  },
  {
    id: 'tilt',
    title: 'Tilt Gimbal Angle vs Time',
    unit: 'deg',
    dataKey: 'tilt_deg',
    stroke: '#f43f5e', // rose-500
  },
  {
    id: 'fps',
    title: 'Frame Rate (FPS) vs Time',
    unit: 'FPS',
    dataKey: 'fps',
    stroke: '#22c55e', // green-500
    refLine: 20.0,
    refLabel: 'Minimum Req (≥20 FPS)',
    refColor: '#ef4444',
  },
  {
    id: 'processing_time',
    title: 'Processing Time (Latency) vs Time',
    unit: 'ms',
    dataKey: 'processing_time_ms',
    stroke: '#eab308', // yellow-500
    refLine: 33.3,
    refLabel: '30 FPS Frame Budget (33.3 ms)',
    refColor: '#ef4444',
  },
  {
    id: 'confidence',
    title: 'Detection Confidence vs Time',
    unit: 'score',
    dataKey: 'confidence',
    stroke: '#6366f1', // indigo-500
    refLine: 0.7,
    refLabel: 'Lock Confidence (0.70)',
    refColor: '#818cf8',
    domain: [0, 1.0],
  },
  {
    id: 'snr',
    title: 'Signal-to-Noise Ratio (SNR) vs Time',
    unit: 'dB',
    dataKey: 'snr_db',
    stroke: '#14b8a6', // teal-500
    refLine: 15.0,
    refLabel: 'Threshold (15 dB)',
    refColor: '#f59e0b',
  },
];

export const AnalyticsPage: React.FC<Props> = ({ telemetry, config }) => {
  const [summary, setSummary] = useState<AnalyticsSummaryResponse | null>(null);
  const [chartData, setChartData] = useState<TelemetryPoint[]>([]);
  const [activeChartId, setActiveChartId] = useState<ChartMetricId>('tracking_error');
  const [timeWindow, setTimeWindow] = useState<number>(60); // 15, 30, 60, 0 (all)
  const [isLivePaused, setIsLivePaused] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'single' | 'grid'>('single');

  const pollIntervalRef = useRef<any>(null);

  const fetchAnalytics = async () => {
    try {
      const [sumRes, seriesRes] = await Promise.all([
        api.getAnalyticsSummary(),
        api.getChartSeries(timeWindow > 0 ? timeWindow * 30 : undefined),
      ]);
      setSummary(sumRes);
      if (!isLivePaused) {
        setChartData(seriesRes);
      }
    } catch (e) {
      console.error('Failed to fetch analytics:', e);
    }
  };

  useEffect(() => {
    fetchAnalytics();
    pollIntervalRef.current = setInterval(fetchAnalytics, 1000);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [timeWindow, isLivePaused]);

  const handleResetMetrics = async () => {
    try {
      await api.resetAnalytics();
      fetchAnalytics();
    } catch (e) {
      console.error('Failed to reset analytics:', e);
    }
  };

  const metrics = summary?.metrics;
  const requirements = summary?.requirements || [];
  const selectedChart = CHARTS.find((c) => c.id === activeChartId) || CHARTS[0];

  return (
    <div className="flex flex-col gap-4 font-sans text-xs pb-12">
      {/* Page Header */}
      <div className="bg-[#121518] border border-[#252A2E] p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-[#3A4048]/20 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-[#D6D9DC]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100 uppercase tracking-wider">
              Performance Analytics & Validation
            </h2>
            <p className="text-slate-400 text-[11px]">
              Objective Telemetry Evaluation, Problem Statement 4 KPI Compliance & Multi-Stream Time-Series
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setIsLivePaused(!isLivePaused)}
            className={`px-3 py-1.5 rounded-lg font-medium text-xs flex items-center gap-1.5 transition border ${
              isLivePaused
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                : 'bg-[#1A1D20] border-[#22324e] text-slate-300 hover:bg-[#1e2b44]'
            }`}
          >
            {isLivePaused ? <Play className="w-3.5 h-3.5 text-amber-400" /> : <Pause className="w-3.5 h-3.5" />}
            {isLivePaused ? 'Resume Stream' : 'Pause Charts'}
          </button>

          <button
            onClick={handleResetMetrics}
            className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 rounded-lg font-medium text-xs flex items-center gap-1.5 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset Accumulation
          </button>
        </div>
      </div>

      {/* Primary KPI Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Tracking Error */}
        <div className="bg-[#121518] border border-[#252A2E] p-3.5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Tracking Error</span>
            <Target className="w-3.5 h-3.5 text-[#D6D9DC]" />
          </div>
          <div className="flex items-baseline gap-1.5 mt-2">
            <span className="text-xl font-semibold text-slate-100 num-mono">
              {metrics?.average_tracking_error_px !== null && metrics?.average_tracking_error_px !== undefined
                ? metrics.average_tracking_error_px.toFixed(2)
                : '--'}
            </span>
            <span className="text-slate-400 text-[11px]">px avg</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex justify-between num-mono">
            <span>Max: {metrics?.max_tracking_error_px?.toFixed(1) ?? '--'} px</span>
            <span>RMSE: {metrics?.rmse_px?.toFixed(1) ?? '--'} px</span>
          </div>
        </div>

        {/* Centroid Error */}
        <div className="bg-[#121518] border border-[#252A2E] p-3.5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Centroid Error</span>
            <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-1.5 mt-2">
            <span className="text-xl font-semibold text-emerald-400 num-mono">
              {metrics?.average_centroid_error_px !== null && metrics?.average_centroid_error_px !== undefined
                ? metrics.average_centroid_error_px.toFixed(2)
                : '--'}
            </span>
            <span className="text-slate-400 text-[11px]">px avg</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex justify-between num-mono">
            <span>Max: {metrics?.max_centroid_error_px?.toFixed(1) ?? '--'} px</span>
            <span className="text-emerald-500">vs GT</span>
          </div>
        </div>

        {/* Lock Retention */}
        <div className="bg-[#121518] border border-[#252A2E] p-3.5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Lock Retention</span>
            <Activity className="w-3.5 h-3.5 text-[#D6D9DC]" />
          </div>
          <div className="flex items-baseline gap-1.5 mt-2">
            <span className="text-xl font-semibold text-[#D6D9DC] num-mono">
              {metrics ? `${metrics.lock_retention_percent.toFixed(1)}%` : '--'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex justify-between num-mono">
            <span>Loss: {metrics?.target_loss_percent?.toFixed(1) ?? '0'}%</span>
          </div>
        </div>

        {/* Acquisition & Reacquisition */}
        <div className="bg-[#121518] border border-[#252A2E] p-3.5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Acquisition Time</span>
            <Clock className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="flex items-baseline gap-1.5 mt-2">
            <span className="text-xl font-semibold text-amber-300 num-mono">
              {metrics?.acquisition_time_s !== null && metrics?.acquisition_time_s !== undefined
                ? `${metrics.acquisition_time_s.toFixed(2)}s`
                : 'Searching'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex justify-between num-mono">
            <span>Re-acq: {metrics?.reacquisition_time_s ? `${metrics.reacquisition_time_s.toFixed(2)}s` : '0.0s'}</span>
          </div>
        </div>

        {/* Processing FPS */}
        <div className="bg-[#121518] border border-[#252A2E] p-3.5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Throughput Rate</span>
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-1.5 mt-2">
            <span className="text-xl font-semibold text-emerald-400 num-mono">
              {metrics ? `${metrics.average_fps.toFixed(1)}` : '--'}
            </span>
            <span className="text-slate-400 text-[11px]">FPS</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex justify-between num-mono">
            <span>Min: {metrics?.min_fps?.toFixed(0) ?? '--'}</span>
            <span>Max: {metrics?.max_fps?.toFixed(0) ?? '--'}</span>
          </div>
        </div>

        {/* Latency & SNR */}
        <div className="bg-[#121518] border border-[#252A2E] p-3.5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Execution Latency</span>
            <Sliders className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="flex items-baseline gap-1.5 mt-2">
            <span className="text-xl font-semibold text-purple-300 num-mono">
              {metrics ? `${metrics.average_processing_time_ms.toFixed(2)}` : '--'}
            </span>
            <span className="text-slate-400 text-[11px]">ms</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex justify-between num-mono">
            <span>SNR: {metrics?.average_snr_db ? `${metrics.average_snr_db.toFixed(1)} dB` : '--'}</span>
            <span>Conf: {metrics?.average_confidence ? `${(metrics.average_confidence * 100).toFixed(0)}%` : '--'}</span>
          </div>
        </div>
      </div>

      {/* Official Requirements Compliance Dashboard */}
      <div className="bg-[#121518] border border-[#252A2E] rounded-xl overflow-hidden">
        <div className="p-3.5 bg-[#121518] border-b border-[#252A2E] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-[#D6D9DC]" />
            <span className="font-semibold text-slate-100 uppercase tracking-wider text-xs">
              Official Requirement Validation (Problem Statement 4)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-0.5 rounded text-[10px] font-medium border ${
                summary?.overall_compliance
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              }`}
            >
              {summary?.overall_compliance ? 'Overall: 100% Compliant' : 'Overall: Attention Needed'}
            </span>
            <span className="text-[11px] text-slate-400 num-mono">
              Passed {summary?.passed_count ?? 0} / {summary?.total_count ?? 5} Criteria
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0B0D0F] border-b border-[#252A2E] text-[11px] text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="p-3 font-medium">Official Parameter</th>
                <th className="p-3 font-medium">Required Threshold</th>
                <th className="p-3 font-medium">Actual Measured</th>
                <th className="p-3 font-medium">Compliance Margin</th>
                <th className="p-3 text-right font-medium">Verification Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#252A2E]/50 text-slate-300">
              {requirements.map((req, idx) => {
                const isPass = req.status === 'PASS';
                const isFail = req.status === 'FAIL';
                return (
                  <tr key={idx} className="hover:bg-[#1A1D20]/40 transition">
                    <td className="p-3 font-medium text-slate-200 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#252A2E]"></span>
                      {req.parameter}
                    </td>
                    <td className="p-3 text-slate-300 num-mono">{req.required}</td>
                    <td className="p-3 font-medium text-slate-100 num-mono">{req.actual}</td>
                    <td className="p-3 text-slate-400 num-mono">
                      {req.margin !== null && req.margin !== undefined
                        ? `${req.margin > 0 ? '+' : ''}${req.margin.toFixed(2)} ${req.unit}`
                        : '--'}
                    </td>
                    <td className="p-3 text-right">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium border ${
                          isPass
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                            : isFail
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                            : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                        }`}
                      >
                        {isPass ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        ) : isFail ? (
                          <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        )}
                        {req.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="p-2.5 bg-[#121518] border-t border-[#252A2E] text-[11px] text-slate-400 flex items-center justify-between">
          <span>PASS/FAIL status is calculated continuously from active telemetry measurements.</span>
          <span className="text-[#D6D9DC] num-mono">Testbench Rate: {telemetry?.fps.toFixed(0) || 30} Hz</span>
        </div>
      </div>

      {/* Real-Time Multi-Chart Suite */}
      <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-4">
        {/* Chart Top Bar & Channel Selector */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-[#252A2E]">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-100 text-xs uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#D6D9DC]" />
              Telemetry Time-Series Plotter
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* View Mode Toggle */}
            <div className="inline-flex rounded-lg bg-[#121518] p-0.5 border border-[#252A2E]">
              <button
                onClick={() => setViewMode('single')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  viewMode === 'single' ? 'bg-[#1E2124] text-[#E8EAED] border border-[#3A4048]' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Focus View
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  viewMode === 'grid' ? 'bg-[#1E2124] text-[#E8EAED] border border-[#3A4048]' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Multi-Grid
              </button>
            </div>

            {/* Time Window Buttons */}
            <div className="inline-flex rounded-lg bg-[#121518] p-0.5 border border-[#252A2E]">
              {[15, 30, 60, 0].map((w) => (
                <button
                  key={w}
                  onClick={() => setTimeWindow(w)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    timeWindow === w ? 'bg-[#1e2b44] text-[#E8EAED]' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {w === 0 ? 'All' : `${w}s`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Channel Selector Pills (for single view) */}
        {viewMode === 'single' && (
          <div className="flex items-center gap-1.5 overflow-x-auto py-2.5 scrollbar-thin">
            {CHARTS.map((c) => {
              const active = c.id === activeChartId;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveChartId(c.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition border ${
                    active
                      ? 'bg-[#1E2124] border-[#3A4048] text-[#E8EAED]'
                      : 'bg-[#121518] border-[#252A2E] text-slate-400 hover:border-[#2D3237] hover:text-slate-200'
                  }`}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-1.5"
                    style={{ backgroundColor: c.stroke }}
                  ></span>
                  {c.title}
                </button>
              );
            })}
          </div>
        )}

        {/* Chart Render Area */}
        {viewMode === 'single' ? (
          <div className="h-80 w-full mt-2">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5 px-2">
              <span className="font-semibold text-slate-200">{selectedChart.title}</span>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-0.5 inline-block" style={{ backgroundColor: selectedChart.stroke }}></span>
                  <span>Signal ({selectedChart.unit})</span>
                </span>
                {selectedChart.refLine !== undefined && (
                  <span className="flex items-center gap-1 text-slate-400">
                    <span
                      className="w-2.5 h-0.5 inline-block"
                      style={{ backgroundColor: selectedChart.refColor || '#ef4444' }}
                    ></span>
                    <span>{selectedChart.refLabel}</span>
                  </span>
                )}
              </div>
            </div>

            <ResponsiveContainer width="100%" height="90%">
              <LineChart data={chartData} margin={{ top: 10, right: 25, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#252A2E" />
                <XAxis
                  dataKey="time_s"
                  stroke="#475569"
                  tickFormatter={(val) => `${Number(val).toFixed(1)}s`}
                  tick={{ fontSize: 10, fill: '#64748b', fontFamily: 'monospace' }}
                />
                <YAxis
                  stroke="#475569"
                  domain={selectedChart.domain || ['auto', 'auto']}
                  tick={{ fontSize: 10, fill: '#64748b', fontFamily: 'monospace' }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#121518',
                    borderColor: '#252A2E',
                    borderRadius: '8px',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    color: '#f8fafc',
                  }}
                  formatter={(val: any) => [`${Number(val).toFixed(2)} ${selectedChart.unit}`, selectedChart.title]}
                  labelFormatter={(lbl) => `Time: ${Number(lbl).toFixed(2)}s`}
                />
                {selectedChart.refLine !== undefined && (
                  <ReferenceLine
                    y={selectedChart.refLine}
                    stroke={selectedChart.refColor || '#ef4444'}
                    strokeDasharray="4 4"
                    label={{
                      value: selectedChart.refLabel,
                      fill: selectedChart.refColor || '#ef4444',
                      fontSize: 10,
                      position: 'top',
                      fontFamily: 'monospace',
                    }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey={selectedChart.dataKey}
                  stroke={selectedChart.stroke}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          /* Multi-Grid 11 Charts */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
            {CHARTS.map((c) => (
              <div key={c.id} className="bg-[#121518] border border-[#252A2E] rounded-xl p-3 flex flex-col h-56">
                <div className="flex items-center justify-between text-xs font-medium text-slate-300 mb-1">
                  <span className="truncate">{c.title}</span>
                  <span className="text-[10px] text-slate-500 num-mono">{c.unit}</span>
                </div>
                <div className="flex-1 w-full min-h-[140px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="2 2" stroke="#252A2E" />
                      <XAxis
                        dataKey="time_s"
                        stroke="#475569"
                        tickFormatter={(v) => `${Number(v).toFixed(0)}s`}
                        tick={{ fontSize: 9, fill: '#475569' }}
                      />
                      <YAxis stroke="#475569" domain={c.domain || ['auto', 'auto']} tick={{ fontSize: 9, fill: '#475569' }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#121518',
                          borderColor: '#252A2E',
                          borderRadius: '8px',
                          fontSize: '10px',
                        }}
                        formatter={(val: any) => [`${Number(val).toFixed(2)} ${c.unit}`, c.title]}
                        labelFormatter={(lbl) => `${Number(lbl).toFixed(1)}s`}
                      />
                      {c.refLine !== undefined && (
                        <ReferenceLine y={c.refLine} stroke={c.refColor || '#ef4444'} strokeDasharray="3 3" />
                      )}
                      <Line
                        type="monotone"
                        dataKey={c.dataKey}
                        stroke={c.stroke}
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Real-Time Live Telemetry HUD Strip */}
      <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-3.5">
        <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-2">
          <Eye className="w-3.5 h-3.5 text-[#D6D9DC]" />
          <span>Instantaneous Telemetry Stream</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5 text-xs">
          <div className="bg-[#121518] p-2.5 rounded-lg border border-[#252A2E]">
            <span className="text-slate-400 block text-[10px]">Centroid (X, Y)</span>
            <span className="text-[#D6D9DC] font-medium num-mono">
              {telemetry?.detection.detected_centroid_x !== null && telemetry?.detection.detected_centroid_x !== undefined
                ? `(${telemetry.detection.detected_centroid_x.toFixed(1)}, ${telemetry.detection.detected_centroid_y?.toFixed(1)})`
                : 'Searching'}
            </span>
          </div>

          <div className="bg-[#121518] p-2.5 rounded-lg border border-[#252A2E]">
            <span className="text-slate-400 block text-[10px]">Total Error</span>
            <span className="text-amber-300 font-medium num-mono">
              {telemetry?.tracking.total_error_px !== null && telemetry?.tracking.total_error_px !== undefined
                ? `${telemetry.tracking.total_error_px.toFixed(2)} px`
                : '--'}
            </span>
          </div>

          <div className="bg-[#121518] p-2.5 rounded-lg border border-[#252A2E]">
            <span className="text-slate-400 block text-[10px]">Angular Error</span>
            <span className="text-purple-300 font-medium num-mono">
              {telemetry?.tracking.error_azimuth_deg !== null && telemetry?.tracking.error_elevation_deg !== null
                ? `${Math.sqrt(
                    (telemetry?.tracking.error_azimuth_deg || 0) ** 2 +
                      (telemetry?.tracking.error_elevation_deg || 0) ** 2
                  ).toFixed(3)}°`
                : '--'}
            </span>
          </div>

          <div className="bg-[#121518] p-2.5 rounded-lg border border-[#252A2E]">
            <span className="text-slate-400 block text-[10px]">Pan / Tilt</span>
            <span className="text-slate-100 font-medium num-mono">
              {telemetry?.camera.pan_deg.toFixed(1)}° / {telemetry?.camera.tilt_deg.toFixed(1)}°
            </span>
          </div>

          <div className="bg-[#121518] p-2.5 rounded-lg border border-[#252A2E]">
            <span className="text-slate-400 block text-[10px]">Target State</span>
            <span
              className={`font-medium ${
                telemetry?.tracking.is_locked ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {telemetry?.tracking.state || 'SEARCHING'}
            </span>
          </div>

          <div className="bg-[#121518] p-2.5 rounded-lg border border-[#252A2E]">
            <span className="text-slate-400 block text-[10px]">Confidence / SNR</span>
            <span className="text-[#D6D9DC] font-medium num-mono">
              {telemetry?.detection.confidence ? `${(telemetry.detection.confidence * 100).toFixed(0)}%` : '0%'} /{' '}
              {telemetry?.detection.snr_db ? `${telemetry.detection.snr_db.toFixed(1)}dB` : '--'}
            </span>
          </div>

          <div className="bg-[#121518] p-2.5 rounded-lg border border-[#252A2E]">
            <span className="text-slate-400 block text-[10px]">Throughput</span>
            <span className="text-emerald-400 font-medium num-mono">
              {telemetry?.fps.toFixed(1) || '30.0'} FPS
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
