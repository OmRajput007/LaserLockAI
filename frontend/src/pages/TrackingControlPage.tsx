import React, { useState } from 'react';
import {
  Activity,
  Target,
  Settings2,
  Shield,
  Zap,
  Search,
  Lock,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
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
      showFeedback(`✓ Control Mode switched to: ${nextMode}`);
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
      showFeedback(`✓ Tracking filter set to: ${algo}`);
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
      showFeedback(`✓ Search action [${action.toUpperCase()}] executed`);
    } catch (e: any) {
      showFeedback(`Error triggering search: ${e.message}`);
    }
  };

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

  const isStateLocked = patState === 'LOCKED';
  const isStateActive = ['TRACKING', 'ACQUIRING', 'REACQUIRING'].includes(patState);

  return (
    <div className="flex flex-col gap-4 font-mono text-xs text-[#F0FFEA]">
      {/* Top Banner: Closed-Loop Overview & PAT State Machine Badge */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-4 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-[#262824] border border-[#33362F] flex items-center justify-center">
            <Activity className="w-5 h-5 text-[#FF5F40]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#F0FFEA]">
                Kalman Filter & 2-Axis PID Gimbal Control
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-[#FF5F40]/15 border border-[#FF5F40]/40 text-[#FF5F40]">
                Closed-Loop Active
              </span>
            </div>
            <p className="text-[#9CA195] text-[11px] mt-0.5">
              Continuous Closed Loop: Frame → Detection → Centroid → Kalman → Error → PID → Slew Limit (≤5°/s) → Camera
            </p>
          </div>
        </div>

        {/* Live PAT State Badge */}
        <div className="flex items-center gap-3">
          <div className={`px-4 py-2 rounded border flex flex-col items-center justify-center ${
            isStateLocked
              ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40]'
              : isStateActive
              ? 'bg-[#FF5F40]/15 text-[#FF5F40] border-[#FF5F40]/40'
              : 'bg-[#262824] text-[#9CA195] border-[#33362F]'
          }`}>
            <span className={`text-[10px] uppercase font-bold ${isStateLocked ? 'text-[#0A0A0A]' : 'text-[#9CA195]'}`}>PAT State</span>
            <span className="text-sm font-bold tracking-wider">
              {patState}
            </span>
          </div>

          <button
            onClick={handleToggleControlMode}
            disabled={isUpdating}
            className={`px-3 py-2 rounded font-bold transition flex items-center gap-2 border text-xs uppercase tracking-wider ${
              isClosedLoop
                ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] shadow'
                : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Mode: {isClosedLoop ? 'Closed-Loop PID' : 'Open-Loop Manual'}</span>
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="p-2.5 rounded bg-[#262824] border border-[#FF5F40] text-[#FF5F40] text-xs font-bold flex items-center justify-between">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)} className="text-[#9CA195] hover:text-[#F0FFEA]">✕</button>
        </div>
      )}

      {/* Closed-Loop Pipeline Flow Architecture Bar */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-3.5 rounded-lg">
        <div className="text-xs text-[#F0FFEA] font-semibold uppercase tracking-wider mb-2.5 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-[#FF5F40]" />
          <span>Closed-Loop Pipeline Stages (Hardware Slew Limit: ≤ 5.0°/s)</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-center text-xs">
          <div className="p-2.5 rounded bg-[#262824] border border-[#33362F]">
            <div className="text-[#9CA195] font-medium text-[11px]">Camera Frame</div>
            <div className="text-[#F0FFEA] font-bold mt-1 font-mono">640 × 480</div>
            <div className="text-[10px] text-[#9CA195]">Mono / 30 FPS</div>
          </div>
          <div className="p-2.5 rounded bg-[#262824] border border-[#33362F]">
            <div className="text-[#9CA195] font-medium text-[11px]">Detection</div>
            <div className={`font-bold mt-1 ${detection?.beacon_detected ? 'text-[#FF5F40]' : 'text-[#9CA195]'}`}>
              {detection?.beacon_detected ? 'Acquired' : 'No Beacon'}
            </div>
            <div className="text-[10px] text-[#9CA195] font-mono">SNR: {detection?.snr_db?.toFixed(1) ?? '--'} dB</div>
          </div>
          <div className="p-2.5 rounded bg-[#262824] border border-[#33362F]">
            <div className="text-[#9CA195] font-medium text-[11px]">Centroid</div>
            <div className="text-[#F0FFEA] font-bold mt-1 font-mono">
              {xm !== null && xm !== undefined ? `(${xm.toFixed(0)}, ${ym?.toFixed(0)})` : '--'}
            </div>
            <div className="text-[10px] text-[#9CA195]">Spatial Moments</div>
          </div>
          <div className="p-2.5 rounded bg-[#262824] border border-[#FF5F40]/40">
            <div className="text-[#FF5F40] font-bold text-[11px]">Kalman Filter</div>
            <div className="text-[#F0FFEA] font-bold mt-1 font-mono">
              {xf !== null && xf !== undefined ? `(${xf.toFixed(0)}, ${yf?.toFixed(0)})` : '--'}
            </div>
            <div className="text-[10px] text-[#9CA195]">4-State Kinematic</div>
          </div>
          <div className="p-2.5 rounded bg-[#262824] border border-[#33362F]">
            <div className="text-[#9CA195] font-medium text-[11px]">Angular Error</div>
            <div className="text-[#FF5F40] font-bold mt-1 font-mono">
              {tracking?.error_azimuth_deg !== null && tracking?.error_azimuth_deg !== undefined
                ? `${tracking.error_azimuth_deg.toFixed(2)}°, ${tracking.error_elevation_deg?.toFixed(2)}°`
                : '--'}
            </div>
            <div className="text-[10px] text-[#9CA195] font-mono">Total: {errorPx.toFixed(1)} px</div>
          </div>
          <div className="p-2.5 rounded bg-[#262824] border border-[#33362F]">
            <div className="text-[#9CA195] font-medium text-[11px]">2-Axis PID</div>
            <div className="text-[#F0FFEA] font-bold mt-1 font-mono">
              {tracking?.pan_cmd_deg_s !== undefined ? `${tracking.pan_cmd_deg_s.toFixed(2)}°/s` : '--'}
            </div>
            <div className="text-[10px] text-[#9CA195]">Anti-Windup Active</div>
          </div>
          <div className="p-2.5 rounded bg-[#262824] border border-[#33362F]">
            <div className="text-[#9CA195] font-medium text-[11px]">Slew Clamp</div>
            <div className="text-[#FF5F40] font-bold mt-1 font-mono">≤ 5.0°/s</div>
            <div className="text-[10px] text-[#9CA195]">Rate Limited</div>
          </div>
          <div className="p-2.5 rounded bg-[#262824] border border-[#33362F]">
            <div className="text-[#9CA195] font-medium text-[11px]">Orientation</div>
            <div className="text-[#F0FFEA] font-bold mt-1 font-mono">
              {camera?.pan_deg.toFixed(1)}°, {camera?.tilt_deg.toFixed(1)}°
            </div>
            <div className="text-[10px] text-[#9CA195]">Pan / Tilt Angles</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ========================================================================= */}
        {/* COLUMN 1: KALMAN FILTER & 3-POSITION DISPLAY                             */}
        {/* ========================================================================= */}
        <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-[#33362F] pb-2.5">
            <h3 className="text-[#F0FFEA] font-semibold uppercase tracking-wider flex items-center gap-2 text-xs">
              <Target className="w-4 h-4 text-[#FF5F40]" />
              Kalman Filter (X, Y, Vx, Vy)
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#262824] text-[#9CA195] border border-[#33362F]">
              {config?.tracking.algorithm}
            </span>
          </div>

          {/* Algorithm Selector */}
          <div className="space-y-1.5">
            <span className="text-[#9CA195] text-xs">Filter Mode:</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['None', 'Kalman Filter', 'Alpha-Beta'] as const).map((algo) => {
                const active = config?.tracking.algorithm === algo;
                return (
                  <button
                    key={algo}
                    onClick={() => handleSetFilter(algo)}
                    className={`py-1.5 px-2 rounded text-xs font-mono transition border ${
                      active
                        ? 'bg-[#FF5F40] text-[#0A0A0A] font-bold border-[#FF5F40]'
                        : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
                    }`}
                  >
                    {algo === 'Kalman Filter' ? 'Kalman' : algo}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Real-time 3-Position Display: Measured, Predicted, Filtered */}
          <div className="bg-[#262824] border border-[#33362F] rounded-lg p-3 space-y-2.5">
            <div className="text-xs font-medium text-[#F0FFEA] border-b border-[#33362F] pb-1 flex items-center justify-between uppercase tracking-wider">
              <span>Position Comparison</span>
              <span className="text-[10px] text-[#9CA195]">Pixel Coords (640×480)</span>
            </div>

            {/* Measured Position */}
            <div className="flex items-center justify-between bg-[#1B1D1A] p-2 rounded border border-[#33362F]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#F0FFEA] inline-block" />
                <span className="text-[#9CA195]">Measured:</span>
              </div>
              <span className="text-[#F0FFEA] font-mono font-medium">
                {xm !== null && xm !== undefined ? `(${xm.toFixed(1)}, ${ym?.toFixed(1)}) px` : 'No measurement'}
              </span>
            </div>

            {/* Predicted Position */}
            <div className="flex items-center justify-between bg-[#1B1D1A] p-2 rounded border border-[#33362F]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#9CA195] inline-block" />
                <span className="text-[#9CA195]">Predicted:</span>
              </div>
              <span className="text-[#9CA195] font-mono font-medium">
                {xp !== null && xp !== undefined ? `(${xp.toFixed(1)}, ${yp?.toFixed(1)}) px` : 'N/A'}
              </span>
            </div>

            {/* Filtered Position */}
            <div className="flex items-center justify-between bg-[#1B1D1A] p-2 rounded border border-[#33362F]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#FF5F40] inline-block" />
                <span className="text-[#F0FFEA] font-bold">Filtered:</span>
              </div>
              <span className="text-[#FF5F40] font-mono font-bold">
                {xf !== null && xf !== undefined ? `(${xf.toFixed(1)}, ${yf?.toFixed(1)}) px` : 'N/A'}
              </span>
            </div>

            {/* Estimated Velocity */}
            <div className="p-2.5 rounded bg-[#1B1D1A] border border-[#33362F] space-y-1">
              <div className="flex justify-between items-center text-xs">
                <span className="text-[#9CA195]">Target Velocity [Vx, Vy]:</span>
                <span className="text-[#F0FFEA] font-bold font-mono">
                  ({vx.toFixed(1)}, {vy.toFixed(1)}) px/s
                </span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-[#9CA195]">Speed Magnitude |V|:</span>
                <span className="text-[#FF5F40] font-bold font-mono">{speed.toFixed(1)} px/s</span>
              </div>
            </div>

            {/* Coasting Status */}
            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-[#9CA195]">Coasting Status:</span>
              <span className={`font-bold ${detection?.beacon_detected ? 'text-[#FF5F40]' : 'text-[#9CA195]'}`}>
                {detection?.beacon_detected ? '✓ Measured Update' : '● Coasting Prediction'}
              </span>
            </div>
          </div>

          {/* Hyperparameters */}
          <div className="space-y-3 bg-[#262824] p-3 rounded border border-[#33362F] text-xs">
            <div className="flex justify-between items-center">
              <span className="text-[#9CA195]">Process Noise (Q):</span>
              <span className="text-[#FF5F40] font-bold font-mono">{config?.tracking.process_noise_q ?? 0.05}</span>
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
              className="w-full h-1.5 bg-[#1B1D1A] rounded appearance-none cursor-pointer accent-[#FF5F40]"
            />

            <div className="flex justify-between items-center">
              <span className="text-[#9CA195]">Measurement Noise (R):</span>
              <span className="text-[#FF5F40] font-bold font-mono">{config?.tracking.measurement_noise_r ?? 1.5}</span>
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
              className="w-full h-1.5 bg-[#1B1D1A] rounded appearance-none cursor-pointer accent-[#FF5F40]"
            />

            <div className="flex justify-between items-center">
              <span className="text-[#9CA195]">Max Coasting Frames:</span>
              <span className="text-[#F0FFEA] font-bold font-mono">{config?.tracking.max_coast_frames ?? 30} frames</span>
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
              className="w-full h-1.5 bg-[#1B1D1A] rounded appearance-none cursor-pointer accent-[#FF5F40]"
            />
          </div>
        </div>

        {/* ========================================================================= */}
        {/* COLUMN 2: 2-AXIS PID CONTROLLER & GIMBAL ACTUATION                       */}
        {/* ========================================================================= */}
        <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-[#33362F] pb-2.5">
            <h3 className="text-[#F0FFEA] font-semibold uppercase tracking-wider flex items-center gap-2 text-xs">
              <Settings2 className="w-4 h-4 text-[#FF5F40]" />
              2-Axis PID Gimbal Controller
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#262824] text-[#FF5F40] border border-[#33362F]">
              Anti-Windup On
            </span>
          </div>

          {/* Pan PID Axis */}
          <div className="p-3 bg-[#262824] rounded border border-[#33362F] space-y-2.5">
            <div className="flex justify-between items-center">
              <span className="text-[#F0FFEA] font-bold uppercase text-xs">Pan Axis PID (Azimuth)</span>
              <span className="text-[11px] text-[#9CA195]">
                Cmd: <strong className="text-[#FF5F40] font-mono">{tracking?.pan_cmd_deg_s?.toFixed(2) ?? '0.00'}°/s</strong>
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="text-[#9CA195] text-[10px]">Kp (Pan)</span>
                <input
                  type="number"
                  step="0.05"
                  value={config?.control.kp_pan ?? 0.8}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    handleUpdatePID({ kp_pan: v });
                  }}
                  className="w-full bg-[#1B1D1A] border border-[#33362F] rounded p-1.5 text-[#F0FFEA] text-xs font-mono focus:outline-none focus:border-[#FF5F40]"
                />
              </div>
              <div>
                <span className="text-[#9CA195] text-[10px]">Ki (Pan)</span>
                <input
                  type="number"
                  step="0.01"
                  value={config?.control.ki_pan ?? 0.02}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    handleUpdatePID({ ki_pan: v });
                  }}
                  className="w-full bg-[#1B1D1A] border border-[#33362F] rounded p-1.5 text-[#F0FFEA] text-xs font-mono focus:outline-none focus:border-[#FF5F40]"
                />
              </div>
              <div>
                <span className="text-[#9CA195] text-[10px]">Kd (Pan)</span>
                <input
                  type="number"
                  step="0.05"
                  value={config?.control.kd_pan ?? 0.15}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    handleUpdatePID({ kd_pan: v });
                  }}
                  className="w-full bg-[#1B1D1A] border border-[#33362F] rounded p-1.5 text-[#F0FFEA] text-xs font-mono focus:outline-none focus:border-[#FF5F40]"
                />
              </div>
            </div>

            {/* Live Pan PID Term Breakdown */}
            <div className="grid grid-cols-3 gap-1.5 text-[10px] bg-[#1B1D1A] p-1.5 rounded border border-[#33362F]">
              <div>
                <span className="text-[#9CA195]">P:</span>{' '}
                <span className="text-[#F0FFEA] font-mono">{tracking?.pan_pid_p?.toFixed(2) ?? '0.00'}</span>
              </div>
              <div>
                <span className="text-[#9CA195]">I:</span>{' '}
                <span className="text-[#F0FFEA] font-mono">{tracking?.pan_pid_i?.toFixed(2) ?? '0.00'}</span>
              </div>
              <div>
                <span className="text-[#9CA195]">D:</span>{' '}
                <span className="text-[#F0FFEA] font-mono">{tracking?.pan_pid_d?.toFixed(2) ?? '0.00'}</span>
              </div>
            </div>
          </div>

          {/* Tilt PID Axis */}
          <div className="p-3 bg-[#262824] rounded border border-[#33362F] space-y-2.5">
            <div className="flex justify-between items-center">
              <span className="text-[#F0FFEA] font-bold uppercase text-xs">Tilt Axis PID (Elevation)</span>
              <span className="text-[11px] text-[#9CA195]">
                Cmd: <strong className="text-[#FF5F40] font-mono">{tracking?.tilt_cmd_deg_s?.toFixed(2) ?? '0.00'}°/s</strong>
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="text-[#9CA195] text-[10px]">Kp (Tilt)</span>
                <input
                  type="number"
                  step="0.05"
                  value={config?.control.kp_tilt ?? 0.8}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    handleUpdatePID({ kp_tilt: v });
                  }}
                  className="w-full bg-[#1B1D1A] border border-[#33362F] rounded p-1.5 text-[#F0FFEA] text-xs font-mono focus:outline-none focus:border-[#FF5F40]"
                />
              </div>
              <div>
                <span className="text-[#9CA195] text-[10px]">Ki (Tilt)</span>
                <input
                  type="number"
                  step="0.01"
                  value={config?.control.ki_tilt ?? 0.02}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    handleUpdatePID({ ki_tilt: v });
                  }}
                  className="w-full bg-[#1B1D1A] border border-[#33362F] rounded p-1.5 text-[#F0FFEA] text-xs font-mono focus:outline-none focus:border-[#FF5F40]"
                />
              </div>
              <div>
                <span className="text-[#9CA195] text-[10px]">Kd (Tilt)</span>
                <input
                  type="number"
                  step="0.05"
                  value={config?.control.kd_tilt ?? 0.15}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    handleUpdatePID({ kd_tilt: v });
                  }}
                  className="w-full bg-[#1B1D1A] border border-[#33362F] rounded p-1.5 text-[#F0FFEA] text-xs font-mono focus:outline-none focus:border-[#FF5F40]"
                />
              </div>
            </div>

            {/* Live Tilt PID Term Breakdown */}
            <div className="grid grid-cols-3 gap-1.5 text-[10px] bg-[#1B1D1A] p-1.5 rounded border border-[#33362F]">
              <div>
                <span className="text-[#9CA195]">P:</span>{' '}
                <span className="text-[#F0FFEA] font-mono">{tracking?.tilt_pid_p?.toFixed(2) ?? '0.00'}</span>
              </div>
              <div>
                <span className="text-[#9CA195]">I:</span>{' '}
                <span className="text-[#F0FFEA] font-mono">{tracking?.tilt_pid_i?.toFixed(2) ?? '0.00'}</span>
              </div>
              <div>
                <span className="text-[#9CA195]">D:</span>{' '}
                <span className="text-[#F0FFEA] font-mono">{tracking?.tilt_pid_d?.toFixed(2) ?? '0.00'}</span>
              </div>
            </div>
          </div>

          {/* Actuator Limits and Hardware Constraints */}
          <div className="p-3 bg-[#262824] rounded border border-[#33362F] space-y-2 text-xs">
            <div className="flex justify-between items-center text-[#F0FFEA] font-bold border-b border-[#33362F] pb-1.5">
              <span className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-[#FF5F40]" /> Physical Slew Limit:
              </span>
              <span className="text-[#FF5F40] font-bold font-mono">±5.0°/s Max</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9CA195]">Current Pan Slew:</span>
              <span className="text-[#F0FFEA] font-mono">{camera?.pan_rate_deg_s.toFixed(2)}°/s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9CA195]">Current Tilt Slew:</span>
              <span className="text-[#F0FFEA] font-mono">{camera?.tilt_rate_deg_s.toFixed(2)}°/s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9CA195]">Anti-Windup Clamp:</span>
              <span className="text-[#F0FFEA] font-mono">±{config?.control.integral_windup_limit ?? 2.0}°/s</span>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* COLUMN 3: SEARCH PATTERNS & LOCK/REACQUISITION REQUIREMENTS              */}
        {/* ========================================================================= */}
        <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-[#33362F] pb-2.5">
            <h3 className="text-[#F0FFEA] font-semibold uppercase tracking-wider flex items-center gap-2 text-xs">
              <Search className="w-4 h-4 text-[#FF5F40]" />
              Autonomous Search & Lock
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#262824] text-[#9CA195] border border-[#33362F]">
              {config?.tracking.search_pattern}
            </span>
          </div>

          {/* Search Pattern Controls */}
          <div className="p-3 bg-[#262824] rounded border border-[#33362F] space-y-2.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-[#F0FFEA]">Search Pattern Selection</div>
            <div className="grid grid-cols-2 gap-2">
              {(['Raster Search', 'Sector Search', 'Spiral Search'] as const).map((pat) => {
                const active = config?.tracking.search_pattern === pat;
                return (
                  <button
                    key={pat}
                    onClick={() => handleSearchAction('start', pat)}
                    className={`p-2 rounded text-xs font-mono transition border ${
                      active
                        ? 'bg-[#FF5F40] text-[#0A0A0A] font-bold border-[#FF5F40]'
                        : 'bg-[#1B1D1A] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
                    }`}
                  >
                    {pat}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => handleSearchAction('start')}
                className="flex-1 py-1.5 px-3 rounded bg-[#FF5F40] hover:bg-[#FF7459] text-[#0A0A0A] font-bold text-xs transition uppercase tracking-wider shadow"
              >
                Execute Search
              </button>
              <button
                onClick={() => handleSearchAction('stop')}
                className="py-1.5 px-3 rounded bg-[#1B1D1A] hover:bg-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] border border-[#33362F] font-medium text-xs transition"
              >
                Halt
              </button>
              <button
                onClick={() => handleSearchAction('reset')}
                className="p-1.5 rounded bg-[#1B1D1A] hover:bg-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] border border-[#33362F] transition"
                title="Reset Search Grid"
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#FF5F40]" />
              </button>
            </div>
          </div>

          {/* Lock Criteria Tuning */}
          <div className="p-3 bg-[#262824] rounded border border-[#33362F] space-y-2 text-xs">
            <div className="flex justify-between items-center text-[#F0FFEA] font-semibold border-b border-[#33362F] pb-1.5 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-[#FF5F40]" /> Lock Criteria:
              </span>
              <span className={isLocked ? 'text-[#FF5F40] font-bold' : 'text-[#9CA195]'}>
                {isLocked ? '✓ Locked' : '● Unlocked'}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-[#9CA195]">Max Angular Error:</span>
              <span className="text-[#F0FFEA] font-mono">≤ {config?.tracking.lock_angular_error_threshold_deg ?? 0.10}°</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9CA195]">Max Pixel Error:</span>
              <span className="text-[#F0FFEA] font-mono">≤ {config?.tracking.lock_pixel_error_threshold_px ?? 10.0} px</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9CA195]">Min Confidence:</span>
              <span className="text-[#F0FFEA] font-mono">≥ {((config?.tracking.lock_confidence_threshold ?? 0.70) * 100).toFixed(0)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9CA195]">Consecutive Locked:</span>
              <span className="text-[#FF5F40] font-bold font-mono">
                {tracking?.consecutive_locked_frames ?? 0} / {config?.tracking.lock_consecutive_frames ?? 5} frames
              </span>
            </div>
          </div>

          {/* Requirements Compliance Checklist */}
          <div className="p-3 bg-[#262824] rounded border border-[#33362F] space-y-2 text-xs">
            <div className="text-[#F0FFEA] font-semibold uppercase tracking-wider border-b border-[#33362F] pb-1.5">
              Performance Compliance
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[#9CA195]">Acquisition Time (≤ 2.0s):</span>
              <span className={`font-bold font-mono flex items-center gap-1 ${acqPass ? 'text-[#FF5F40]' : 'text-[#9CA195]'}`}>
                {acqTime !== null ? `${acqTime.toFixed(2)}s` : '--'}
                {acqPass ? <CheckCircle className="w-3 h-3 text-[#FF5F40]" /> : <AlertTriangle className="w-3 h-3 text-[#9CA195]" />}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[#9CA195]">Reacquisition Time (≤ 1.0s):</span>
              <span className={`font-bold font-mono flex items-center gap-1 ${reacqPass ? 'text-[#FF5F40]' : 'text-[#9CA195]'}`}>
                {reacqTime !== null ? `${reacqTime.toFixed(2)}s` : 'N/A'}
                {reacqPass ? <CheckCircle className="w-3 h-3 text-[#FF5F40]" /> : <AlertTriangle className="w-3 h-3 text-[#9CA195]" />}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[#9CA195]">Target Loss (&lt; 5.0%):</span>
              <span className={`font-bold font-mono flex items-center gap-1 ${lossPass ? 'text-[#FF5F40]' : 'text-[#9CA195]'}`}>
                {lossPercent.toFixed(1)}% ({tracking?.target_lost_count ?? 0} events)
                {lossPass ? <CheckCircle className="w-3 h-3 text-[#FF5F40]" /> : <AlertTriangle className="w-3 h-3 text-[#9CA195]" />}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[#9CA195]">Tracking Error (≤ 10 px):</span>
              <span className={`font-bold font-mono flex items-center gap-1 ${errorPass ? 'text-[#FF5F40]' : 'text-[#9CA195]'}`}>
                {errorPx.toFixed(1)} px
                {errorPass ? <CheckCircle className="w-3 h-3 text-[#FF5F40]" /> : <AlertTriangle className="w-3 h-3 text-[#9CA195]" />}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[#9CA195]">Gimbal Slew (≤ 5.0°/s):</span>
              <span className={`font-bold font-mono flex items-center gap-1 ${slewPass ? 'text-[#FF5F40]' : 'text-[#9CA195]'}`}>
                Max {Math.max(panSlew, tiltSlew).toFixed(1)}°/s
                {slewPass ? <CheckCircle className="w-3 h-3 text-[#FF5F40]" /> : <AlertTriangle className="w-3 h-3 text-[#9CA195]" />}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
