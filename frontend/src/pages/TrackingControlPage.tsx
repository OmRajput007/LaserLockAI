import React, { useState } from 'react';
import {
  Activity,
  Target,
  Settings2,
  Sliders,
  Shield,
  Zap,
  Search,
  Lock,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Compass,
  Play,
  Pause,
  BarChart2,
  Layers,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';
import { SystemConfig, SimulationTelemetry } from '../types';
import { api } from '../services/api';

interface Props {
  config: SystemConfig | null;
  telemetry?: SimulationTelemetry | null;
  onUpdateConfig: (updater: (prev: SystemConfig) => SystemConfig) => void;
}

export const TrackingControlPage: React.FC<Props> = ({ config, telemetry, onUpdateConfig }) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const tracking = telemetry?.tracking;
  const detection = telemetry?.detection;
  const camera = telemetry?.camera;

  const patState = tracking?.state || tracking?.mode || 'SEARCHING';
  const isLocked = tracking?.is_locked ?? false;
  const isClosedLoop = config?.control.mode === 'PID Coarse Pointing';

  const showFeedback = (msg: string) => {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(null), 3500);
  };

  const handleToggleControlMode = async () => {
    const nextMode = isClosedLoop ? 'Open Loop' : 'PID Coarse Pointing';
    try {
      setIsUpdating(true);
      await api.setControlMode(nextMode);
      onUpdateConfig((prev) => ({
        ...prev,
        control: { ...prev.control, mode: nextMode },
      }));
      showFeedback(`Control Mode switched to: ${nextMode}`);
    } catch (e: any) {
      showFeedback(`Error setting mode: ${e.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleUpdatePID = async (updates: {
    kp_pan?: number;
    ki_pan?: number;
    kd_pan?: number;
    kp_tilt?: number;
    ki_tilt?: number;
    kd_tilt?: number;
  }) => {
    try {
      await api.updatePIDParameters(updates);
      onUpdateConfig((prev) => ({
        ...prev,
        control: { ...prev.control, ...updates },
      }));
    } catch (e: any) {
      console.error('Failed to update PID parameters:', e);
    }
  };

  const handleSetFilter = async (algo: 'None' | 'Kalman Filter' | 'Alpha-Beta' | 'Particle Filter') => {
    try {
      await api.setTrackingFilter(algo);
      onUpdateConfig((prev) => ({
        ...prev,
        tracking: { ...prev.tracking, algorithm: algo },
      }));
      showFeedback(`Tracking filter set to: ${algo}`);
    } catch (e: any) {
      showFeedback(`Error setting filter: ${e.message}`);
    }
  };

  const handleSearchAction = async (action: 'start' | 'stop' | 'reset', pattern?: 'Raster Search' | 'Sector Search' | 'Spiral Search') => {
    try {
      await api.triggerSearchPattern(action, pattern);
      if (pattern) {
        onUpdateConfig((prev) => ({
          ...prev,
          tracking: { ...prev.tracking, search_pattern: pattern },
        }));
      }
      showFeedback(`Search action [${action.toUpperCase()}] executed`);
    } catch (e: any) {
      showFeedback(`Error triggering search: ${e.message}`);
    }
  };

  // State badge styling
  const stateBadgeConfig: Record<string, { bg: string; text: string; border: string; desc: string }> = {
    LOCKED: {
      bg: 'bg-emerald-950/80',
      text: 'text-emerald-400',
      border: 'border-emerald-600',
      desc: 'Boresight locked within threshold for >= 5 consecutive frames',
    },
    TRACKING: {
      bg: 'bg-cyan-950/80',
      text: 'text-cyan-400',
      border: 'border-cyan-600',
      desc: 'Active optical beacon tracking via Kalman state estimation',
    },
    ACQUIRING: {
      bg: 'bg-amber-950/80',
      text: 'text-amber-400',
      border: 'border-amber-600',
      desc: 'Beacon acquired in FOV; converging PID loop towards center boresight',
    },
    REACQUIRING: {
      bg: 'bg-orange-950/80',
      text: 'text-orange-400',
      border: 'border-orange-600',
      desc: 'Beacon re-detected after temporary loss; re-centering within <= 1.0s',
    },
    SEARCHING: {
      bg: 'bg-purple-950/80',
      text: 'text-purple-400',
      border: 'border-purple-600',
      desc: 'Target outside FOV; executing systematic autonomous raster/sector search',
    },
    LOST: {
      bg: 'bg-rose-950/80',
      text: 'text-rose-400',
      border: 'border-rose-600',
      desc: 'Target lost or occluded; Kalman coasting dead-reckoning active',
    },
  };

  const currentBadge = stateBadgeConfig[patState] || stateBadgeConfig.SEARCHING;

  // Real-time tracking positions
  const xm = tracking?.measured_x;
  const ym = tracking?.measured_y;
  const xp = tracking?.predicted_x;
  const yp = tracking?.predicted_y;
  const xf = tracking?.filtered_x;
  const yf = tracking?.filtered_y;
  const vx = tracking?.velocity_x ?? 0;
  const vy = tracking?.velocity_y ?? 0;
  const speed = Math.sqrt(vx * vx + vy * vy);

  // Requirements checks
  const acqTime = tracking?.acquisition_time_s ?? null;
  const acqPass = acqTime !== null && acqTime <= (config?.performance.max_acquisition_time_s ?? 2.0);

  const reacqTime = tracking?.reacquisition_time_s ?? null;
  const reacqPass = reacqTime !== null ? reacqTime <= (config?.performance.max_reacquisition_time_s ?? 1.0) : true;

  const lossPercent = tracking?.target_loss_percent ?? 0;
  const lossPass = lossPercent < (config?.performance.max_target_loss_percent ?? 5.0);

  const errorPx = tracking?.total_error_px ?? detection?.total_pixel_error ?? 0;
  const errorPass = errorPx <= (config?.performance.max_tracking_error_pixels ?? 10.0);

  const panSlew = Math.abs(camera?.pan_rate_deg_s ?? 0);
  const tiltSlew = Math.abs(camera?.tilt_rate_deg_s ?? 0);
  const slewPass = panSlew <= 5.01 && tiltSlew <= 5.01;

  return (
    <div className="flex flex-col gap-5 font-mono text-xs">
      {/* Top Banner: Closed-Loop Overview & PAT State Machine Badge */}
      <div className="bg-[#0b0f19] border border-slate-800 p-4 rounded-lg flex flex-wrap items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-cyan-950/80 border border-cyan-700/60">
            <Activity className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Part 5: Kalman Filter & 2-Axis PID Gimbal Control
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-cyan-900/60 border border-cyan-700 text-cyan-300">
                CLOSED-LOOP ACTIVE
              </span>
            </div>
            <p className="text-slate-400 text-[11px] mt-0.5">
              Continuous Real Closed Loop: Frame → Detection → Centroid → Kalman → Error → PID → Slew Limit (≤5°/s) → Camera
            </p>
          </div>
        </div>

        {/* Live PAT State Badge */}
        <div className="flex items-center gap-3">
          <div className={`px-4 py-2 rounded-lg border flex flex-col items-center justify-center ${currentBadge.bg} ${currentBadge.border}`}>
            <span className="text-[10px] text-slate-400 uppercase font-semibold">PAT State</span>
            <span className={`text-base font-extrabold tracking-widest ${currentBadge.text}`}>
              {patState}
            </span>
          </div>

          <button
            onClick={handleToggleControlMode}
            disabled={isUpdating}
            className={`px-3.5 py-2.5 rounded-lg font-bold transition flex items-center gap-2 border text-xs shadow-md ${
              isClosedLoop
                ? 'bg-emerald-950/80 hover:bg-emerald-900 border-emerald-600 text-emerald-300'
                : 'bg-amber-950/80 hover:bg-amber-900 border-amber-600 text-amber-300'
            }`}
          >
            <Zap className={`w-4 h-4 ${isClosedLoop ? 'text-emerald-400' : 'text-amber-400'}`} />
            <span>MODE: {isClosedLoop ? 'CLOSED-LOOP PID' : 'OPEN-LOOP MANUAL'}</span>
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="p-2.5 rounded bg-cyan-950/90 border border-cyan-600 text-cyan-200 text-xs font-semibold flex items-center justify-between">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Closed-Loop Pipeline Flow Architecture Bar */}
      <div className="bg-[#0b0f19] border border-slate-800 p-3.5 rounded-lg">
        <div className="text-[11px] text-slate-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
          <span>Real Continuous Closed-Loop Pipeline Flow (Hardware Slew Limited to ≤ 5.0°/s)</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 text-center text-[10px]">
          <div className="p-2 rounded bg-slate-950 border border-slate-800">
            <div className="text-slate-500 font-bold">1. CAMERA FRAME</div>
            <div className="text-white font-semibold mt-1">640 × 480</div>
            <div className="text-[9px] text-slate-400">Mono / 30 FPS</div>
          </div>
          <div className="p-2 rounded bg-slate-950 border border-slate-800">
            <div className="text-slate-500 font-bold">2. CV DETECTION</div>
            <div className="text-emerald-400 font-semibold mt-1">
              {detection?.beacon_detected ? 'BEACON ACQ' : 'NO BEACON'}
            </div>
            <div className="text-[9px] text-slate-400">SNR: {detection?.snr_db?.toFixed(1) ?? '--'} dB</div>
          </div>
          <div className="p-2 rounded bg-slate-950 border border-slate-800">
            <div className="text-slate-500 font-bold">3. CENTROID (xm, ym)</div>
            <div className="text-cyan-400 font-semibold mt-1">
              {xm !== null && xm !== undefined ? `(${xm.toFixed(0)}, ${ym?.toFixed(0)})` : '--'}
            </div>
            <div className="text-[9px] text-slate-400">Spatial Moments</div>
          </div>
          <div className="p-2 rounded bg-slate-950 border border-cyan-800/80 bg-cyan-950/20">
            <div className="text-cyan-400 font-bold">4. KALMAN FILTER</div>
            <div className="text-white font-semibold mt-1">
              {xf !== null && xf !== undefined ? `(${xf.toFixed(0)}, ${yf?.toFixed(0)})` : '--'}
            </div>
            <div className="text-[9px] text-cyan-300">CV 4-State (x,y,vx,vy)</div>
          </div>
          <div className="p-2 rounded bg-slate-950 border border-slate-800">
            <div className="text-slate-500 font-bold">5. ANGULAR ERROR</div>
            <div className="text-amber-400 font-semibold mt-1">
              {tracking?.error_azimuth_deg !== null && tracking?.error_azimuth_deg !== undefined
                ? `${tracking.error_azimuth_deg.toFixed(2)}°, ${tracking.error_elevation_deg?.toFixed(2)}°`
                : '--'}
            </div>
            <div className="text-[9px] text-slate-400">Total: {errorPx.toFixed(1)} px</div>
          </div>
          <div className="p-2 rounded bg-slate-950 border border-emerald-800/80 bg-emerald-950/20">
            <div className="text-emerald-400 font-bold">6. 2-AXIS PID</div>
            <div className="text-white font-semibold mt-1">
              {tracking?.pan_cmd_deg_s !== undefined ? `${tracking.pan_cmd_deg_s.toFixed(2)}°/s` : '--'}
            </div>
            <div className="text-[9px] text-emerald-300">P+I+D + Anti-Windup</div>
          </div>
          <div className="p-2 rounded bg-slate-950 border border-slate-800">
            <div className="text-slate-500 font-bold">7. SLEW CLAMP</div>
            <div className="text-emerald-400 font-semibold mt-1">≤ 5.0°/s</div>
            <div className="text-[9px] text-slate-400">Strict Rate Limits</div>
          </div>
          <div className="p-2 rounded bg-slate-950 border border-slate-800">
            <div className="text-slate-500 font-bold">8. NEW ORIENTATION</div>
            <div className="text-cyan-400 font-semibold mt-1">
              {camera?.pan_deg.toFixed(1)}°, {camera?.tilt_deg.toFixed(1)}°
            </div>
            <div className="text-[9px] text-slate-400">Pan / Tilt Angles</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ========================================================================= */}
        {/* COLUMN 1: KALMAN FILTER & 3-POSITION DISPLAY                             */}
        {/* ========================================================================= */}
        <div className="bg-[#0b0f19] border border-slate-800 rounded-lg p-5 flex flex-col gap-4 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h3 className="text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-2">
              <Target className="w-4 h-4 text-cyan-400" />
              Kalman Filter (X, Y, Vx, Vy)
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
              {config?.tracking.algorithm}
            </span>
          </div>

          {/* Algorithm Selector */}
          <div className="space-y-1.5">
            <span className="text-slate-400 text-[11px] font-semibold">Filter Mode:</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['None', 'Kalman Filter', 'Alpha-Beta'] as const).map((algo) => (
                <button
                  key={algo}
                  onClick={() => handleSetFilter(algo)}
                  className={`p-1.5 rounded text-[11px] font-bold border transition ${
                    config?.tracking.algorithm === algo
                      ? 'bg-cyan-950 text-cyan-300 border-cyan-600'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  {algo === 'Kalman Filter' ? 'Kalman (CV)' : algo}
                </button>
              ))}
            </div>
          </div>

          {/* Real-time 3-Position Display: Measured, Predicted, Filtered */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2.5">
            <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-1 flex items-center justify-between">
              <span>Position Comparison</span>
              <span className="text-[9px] text-slate-500 font-normal">Pixel Coords (FPA 640x480)</span>
            </div>

            {/* Measured Position */}
            <div className="flex items-center justify-between bg-slate-900/60 p-2 rounded border border-cyan-900/40">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block" />
                <span className="text-slate-300 font-semibold">Measured Position:</span>
              </div>
              <span className="text-cyan-300 font-bold">
                {xm !== null && xm !== undefined ? `(${xm.toFixed(1)}, ${ym?.toFixed(1)}) px` : 'NO MEASUREMENT'}
              </span>
            </div>

            {/* Predicted Position */}
            <div className="flex items-center justify-between bg-slate-900/60 p-2 rounded border border-pink-900/40">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-pink-400 inline-block" />
                <span className="text-slate-300 font-semibold">Predicted Position:</span>
              </div>
              <span className="text-pink-300 font-bold">
                {xp !== null && xp !== undefined ? `(${xp.toFixed(1)}, ${yp?.toFixed(1)}) px` : 'N/A'}
              </span>
            </div>

            {/* Filtered Position */}
            <div className="flex items-center justify-between bg-slate-900/60 p-2 rounded border border-amber-900/40">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                <span className="text-slate-300 font-semibold">Filtered Position:</span>
              </div>
              <span className="text-amber-300 font-bold">
                {xf !== null && xf !== undefined ? `(${xf.toFixed(1)}, ${yf?.toFixed(1)}) px` : 'N/A'}
              </span>
            </div>

            {/* Estimated Velocity */}
            <div className="p-2 rounded bg-slate-900/80 border border-slate-800 space-y-1">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-400">Target Velocity [Vx, Vy]:</span>
                <span className="text-white font-bold">
                  ({vx.toFixed(1)}, {vy.toFixed(1)}) px/s
                </span>
              </div>
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-slate-500">Speed Magnitude |V|:</span>
                <span className="text-cyan-400 font-bold">{speed.toFixed(1)} px/s</span>
              </div>
            </div>

            {/* Coasting Status */}
            <div className="flex items-center justify-between text-[11px] pt-1">
              <span className="text-slate-400">Prediction Coasting Status:</span>
              <span className={`font-bold ${detection?.beacon_detected ? 'text-emerald-400' : 'text-amber-400'}`}>
                {detection?.beacon_detected ? 'MEASURED UPDATE' : 'COASTING PREDICTION'}
              </span>
            </div>
          </div>

          {/* Hyperparameters */}
          <div className="space-y-3 bg-slate-950 p-3 rounded border border-slate-800 text-[11px]">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Process Noise Covariance (Q):</span>
              <span className="text-cyan-300 font-bold">{config?.tracking.process_noise_q ?? 0.05}</span>
            </div>
            <input
              type="range"
              min="0.001"
              max="1.0"
              step="0.005"
              value={config?.tracking.process_noise_q ?? 0.05}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onUpdateConfig((p) => ({ ...p, tracking: { ...p.tracking, process_noise_q: v } }));
              }}
              className="w-full accent-cyan-500 cursor-pointer"
            />

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Measurement Noise Covariance (R):</span>
              <span className="text-cyan-300 font-bold">{config?.tracking.measurement_noise_r ?? 1.5}</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="20.0"
              step="0.2"
              value={config?.tracking.measurement_noise_r ?? 1.5}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onUpdateConfig((p) => ({ ...p, tracking: { ...p.tracking, measurement_noise_r: v } }));
              }}
              className="w-full accent-cyan-500 cursor-pointer"
            />

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Max Coasting Frames:</span>
              <span className="text-emerald-400 font-bold">{config?.tracking.max_coast_frames ?? 30} frames</span>
            </div>
            <input
              type="range"
              min="5"
              max="60"
              step="1"
              value={config?.tracking.max_coast_frames ?? 30}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                onUpdateConfig((p) => ({ ...p, tracking: { ...p.tracking, max_coast_frames: v } }));
              }}
              className="w-full accent-cyan-500 cursor-pointer"
            />
          </div>
        </div>

        {/* ========================================================================= */}
        {/* COLUMN 2: 2-AXIS PID CONTROLLER & GIMBAL ACTUATION                       */}
        {/* ========================================================================= */}
        <div className="bg-[#0b0f19] border border-slate-800 rounded-lg p-5 flex flex-col gap-4 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h3 className="text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-cyan-400" />
              2-Axis PID Gimbal Controller
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
              ANTI-WINDUP ON
            </span>
          </div>

          {/* Pan PID Axis */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2.5">
            <div className="flex justify-between items-center">
              <span className="text-cyan-300 font-bold uppercase text-[11px]">Pan Axis PID (Azimuth)</span>
              <span className="text-[10px] text-slate-400">
                Cmd: <strong className="text-emerald-400">{tracking?.pan_cmd_deg_s?.toFixed(2) ?? '0.00'}°/s</strong>
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="text-slate-400 text-[10px]">Kp (Pan)</span>
                <input
                  type="number"
                  step="0.05"
                  value={config?.control.kp_pan ?? 0.8}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    handleUpdatePID({ kp_pan: v });
                  }}
                  className="w-full bg-slate-900 border border-slate-750 rounded p-1 text-white text-[11px]"
                />
              </div>
              <div>
                <span className="text-slate-400 text-[10px]">Ki (Pan)</span>
                <input
                  type="number"
                  step="0.01"
                  value={config?.control.ki_pan ?? 0.02}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    handleUpdatePID({ ki_pan: v });
                  }}
                  className="w-full bg-slate-900 border border-slate-750 rounded p-1 text-white text-[11px]"
                />
              </div>
              <div>
                <span className="text-slate-400 text-[10px]">Kd (Pan)</span>
                <input
                  type="number"
                  step="0.05"
                  value={config?.control.kd_pan ?? 0.15}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    handleUpdatePID({ kd_pan: v });
                  }}
                  className="w-full bg-slate-900 border border-slate-750 rounded p-1 text-white text-[11px]"
                />
              </div>
            </div>

            {/* Live Pan PID Term Breakdown */}
            <div className="grid grid-cols-3 gap-1.5 text-[9.5px] bg-slate-900/70 p-1.5 rounded">
              <div>
                <span className="text-slate-500">P:</span>{' '}
                <span className="text-white font-mono">{tracking?.pan_pid_p?.toFixed(2) ?? '0.00'}</span>
              </div>
              <div>
                <span className="text-slate-500">I:</span>{' '}
                <span className="text-white font-mono">{tracking?.pan_pid_i?.toFixed(2) ?? '0.00'}</span>
              </div>
              <div>
                <span className="text-slate-500">D:</span>{' '}
                <span className="text-white font-mono">{tracking?.pan_pid_d?.toFixed(2) ?? '0.00'}</span>
              </div>
            </div>
          </div>

          {/* Tilt PID Axis */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2.5">
            <div className="flex justify-between items-center">
              <span className="text-cyan-300 font-bold uppercase text-[11px]">Tilt Axis PID (Elevation)</span>
              <span className="text-[10px] text-slate-400">
                Cmd: <strong className="text-emerald-400">{tracking?.tilt_cmd_deg_s?.toFixed(2) ?? '0.00'}°/s</strong>
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="text-slate-400 text-[10px]">Kp (Tilt)</span>
                <input
                  type="number"
                  step="0.05"
                  value={config?.control.kp_tilt ?? 0.8}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    handleUpdatePID({ kp_tilt: v });
                  }}
                  className="w-full bg-slate-900 border border-slate-750 rounded p-1 text-white text-[11px]"
                />
              </div>
              <div>
                <span className="text-slate-400 text-[10px]">Ki (Tilt)</span>
                <input
                  type="number"
                  step="0.01"
                  value={config?.control.ki_tilt ?? 0.02}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    handleUpdatePID({ ki_tilt: v });
                  }}
                  className="w-full bg-slate-900 border border-slate-750 rounded p-1 text-white text-[11px]"
                />
              </div>
              <div>
                <span className="text-slate-400 text-[10px]">Kd (Tilt)</span>
                <input
                  type="number"
                  step="0.05"
                  value={config?.control.kd_tilt ?? 0.15}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    handleUpdatePID({ kd_tilt: v });
                  }}
                  className="w-full bg-slate-900 border border-slate-750 rounded p-1 text-white text-[11px]"
                />
              </div>
            </div>

            {/* Live Tilt PID Term Breakdown */}
            <div className="grid grid-cols-3 gap-1.5 text-[9.5px] bg-slate-900/70 p-1.5 rounded">
              <div>
                <span className="text-slate-500">P:</span>{' '}
                <span className="text-white font-mono">{tracking?.tilt_pid_p?.toFixed(2) ?? '0.00'}</span>
              </div>
              <div>
                <span className="text-slate-500">I:</span>{' '}
                <span className="text-white font-mono">{tracking?.tilt_pid_i?.toFixed(2) ?? '0.00'}</span>
              </div>
              <div>
                <span className="text-slate-500">D:</span>{' '}
                <span className="text-white font-mono">{tracking?.tilt_pid_d?.toFixed(2) ?? '0.00'}</span>
              </div>
            </div>
          </div>

          {/* Actuator Limits and Hardware Constraints */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2 text-[11px]">
            <div className="flex justify-between items-center text-slate-300 font-bold border-b border-slate-800 pb-1">
              <span className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-400" /> Physical Slew Limit:
              </span>
              <span className="text-emerald-400">±5.0°/s MAX</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Current Pan Slew:</span>
              <span className="text-white font-mono">{camera?.pan_rate_deg_s.toFixed(2)}°/s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Current Tilt Slew:</span>
              <span className="text-white font-mono">{camera?.tilt_rate_deg_s.toFixed(2)}°/s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Anti-Windup Clamp:</span>
              <span className="text-cyan-300">±{config?.control.integral_windup_limit ?? 2.0}°/s</span>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* COLUMN 3: SEARCH PATTERNS & LOCK/REACQUISITION REQUIREMENTS              */}
        {/* ========================================================================= */}
        <div className="bg-[#0b0f19] border border-slate-800 rounded-lg p-5 flex flex-col gap-4 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h3 className="text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-2">
              <Search className="w-4 h-4 text-cyan-400" />
              Autonomous Search & Lock
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-purple-950 text-purple-400 border border-purple-800">
              {config?.tracking.search_pattern}
            </span>
          </div>

          {/* Search Pattern Controls */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2.5">
            <div className="text-[11px] font-bold text-slate-300 uppercase">Search Pattern Selection</div>
            <div className="grid grid-cols-2 gap-2">
              {(['Raster Search', 'Sector Search', 'Spiral Search'] as const).map((pat) => (
                <button
                  key={pat}
                  onClick={() => handleSearchAction('start', pat)}
                  className={`p-2 rounded text-[11px] font-bold border transition ${
                    config?.tracking.search_pattern === pat
                      ? 'bg-purple-950 text-purple-300 border-purple-600'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  {pat}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => handleSearchAction('start')}
                className="flex-1 py-1.5 px-3 rounded bg-purple-900/80 hover:bg-purple-800 text-white font-bold text-[11px] transition"
              >
                Execute Search
              </button>
              <button
                onClick={() => handleSearchAction('stop')}
                className="py-1.5 px-3 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-[11px] transition"
              >
                Halt
              </button>
              <button
                onClick={() => handleSearchAction('reset')}
                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                title="Reset Search Grid"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Lock Criteria Tuning */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2 text-[11px]">
            <div className="flex justify-between items-center text-slate-300 font-bold border-b border-slate-800 pb-1">
              <span className="flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-cyan-400" /> Lock Verification Criteria:
              </span>
              <span className={isLocked ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                {isLocked ? 'LOCKED' : 'UNLOCKED'}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-slate-400">Max Angular Error:</span>
              <span className="text-white font-mono">≤ {config?.tracking.lock_angular_error_threshold_deg ?? 0.10}°</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Max Pixel Error:</span>
              <span className="text-white font-mono">≤ {config?.tracking.lock_pixel_error_threshold_px ?? 10.0} px</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Min Confidence:</span>
              <span className="text-white font-mono">≥ {((config?.tracking.lock_confidence_threshold ?? 0.70) * 100).toFixed(0)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Consecutive Locked:</span>
              <span className="text-emerald-400 font-bold font-mono">
                {tracking?.consecutive_locked_frames ?? 0} / {config?.tracking.lock_consecutive_frames ?? 5} frames
              </span>
            </div>
          </div>

          {/* Requirements Compliance Checklist */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2 text-[11px]">
            <div className="text-slate-300 font-bold uppercase tracking-wider border-b border-slate-800 pb-1">
              PS4 Performance Compliance
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Acquisition Time (≤ 2.0s):</span>
              <span className={`font-bold flex items-center gap-1 ${acqPass ? 'text-emerald-400' : 'text-rose-400'}`}>
                {acqTime !== null ? `${acqTime.toFixed(2)}s` : '--'}
                {acqPass ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <AlertTriangle className="w-3 h-3 text-rose-400" />}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Reacquisition Time (≤ 1.0s):</span>
              <span className={`font-bold flex items-center gap-1 ${reacqPass ? 'text-emerald-400' : 'text-rose-400'}`}>
                {reacqTime !== null ? `${reacqTime.toFixed(2)}s` : 'N/A'}
                {reacqPass ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <AlertTriangle className="w-3 h-3 text-rose-400" />}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Target Loss (&lt; 5.0%):</span>
              <span className={`font-bold flex items-center gap-1 ${lossPass ? 'text-emerald-400' : 'text-rose-400'}`}>
                {lossPercent.toFixed(1)}% ({tracking?.target_lost_count ?? 0} events)
                {lossPass ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <AlertTriangle className="w-3 h-3 text-rose-400" />}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Tracking Error (≤ 10 px):</span>
              <span className={`font-bold flex items-center gap-1 ${errorPass ? 'text-emerald-400' : 'text-amber-400'}`}>
                {errorPx.toFixed(1)} px
                {errorPass ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <AlertTriangle className="w-3 h-3 text-amber-400" />}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Gimbal Slew (≤ 5.0°/s):</span>
              <span className={`font-bold flex items-center gap-1 ${slewPass ? 'text-emerald-400' : 'text-rose-400'}`}>
                Max {Math.max(panSlew, tiltSlew).toFixed(1)}°/s
                {slewPass ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <AlertTriangle className="w-3 h-3 text-rose-400" />}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
