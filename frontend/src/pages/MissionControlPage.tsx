import React, { useState, useCallback } from 'react';
import { SimulationTelemetry, SystemConfig } from '../types';
import { VirtualSceneCanvas } from '../simulation/VirtualSceneCanvas';
import { FPACameraViewport } from '../simulation/FPACameraViewport';
import { Scene3DViewport } from '../simulation/Scene3DViewport';
import { TelemetryChart } from '../charts/TelemetryChart';
import { api } from '../services/api';
import {
  Play,
  Pause,
  RotateCcw,
  Radio,
  Cpu,
  Box,
  Layers,
  Sparkles,
  Sliders,
  Eye,
  EyeOff,
  Crosshair,
  Gauge,
  Zap,
} from 'lucide-react';

interface Props {
  telemetry: SimulationTelemetry | null;
  config: SystemConfig | null;
  errorHistory: { time: number; error: number; fov: number }[];
  onToggleSim: (running: boolean) => void;
  onResetSim: () => void;
  onGimbalNudge: (pan_rate: number, tilt_rate: number) => void;
  onGimbalAngles: (target_pan: number, target_tilt: number) => void;
  onSelectShape: (shape: 'Square' | 'Circle' | 'Gaussian') => void;
}

export const MissionControlPage: React.FC<Props> = ({
  telemetry,
  config,
  errorHistory,
  onToggleSim,
  onResetSim,
  onGimbalNudge,
  onGimbalAngles,
  onSelectShape,
}) => {
  const [viewMode, setViewMode] = useState<'dual' | '3d' | '2d_camera'>('dual');
  const [localSpeed, setLocalSpeed] = useState<number>(
    config?.motion?.speed_pixels_per_s ?? 40
  );
  const [speedApplied, setSpeedApplied] = useState(false);

  const applySpeed = useCallback(async (spd: number) => {
    try {
      await api.setBeaconSpeed(spd);
      setSpeedApplied(true);
      setTimeout(() => setSpeedApplied(false), 800);
    } catch (e) {
      console.error('Failed to set beacon speed:', e);
    }
  }, []);

  const isRunning = telemetry?.is_running ?? false;
  const isLocked = telemetry?.tracking.is_locked ?? false;
  const inFov = telemetry?.target.is_in_fov ?? false;
  const target = telemetry?.target ?? null;

  return (
    <div className="flex flex-col gap-4 font-mono">
      {/* Top Cockpit Telemetry Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-lg flex flex-col">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Mission State</span>
          <div className="flex items-center gap-2 mt-1">
            <span className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`}></span>
            <span className="font-bold text-sm text-white">
              {isRunning ? 'ACTIVE RUN' : 'STANDBY'}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1">Sim Time: {telemetry?.simulation_time_s.toFixed(2)}s</span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-lg flex flex-col">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Target Visibility</span>
          <div className="flex items-center gap-2 mt-1">
            {inFov ? (
              <>
                <Eye className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-sm text-emerald-400">INSIDE FOV</span>
              </>
            ) : (
              <>
                <EyeOff className="w-4 h-4 text-rose-400" />
                <span className="font-bold text-sm text-rose-400">OUTSIDE FOV</span>
              </>
            )}
          </div>
          <span className="text-[10px] text-slate-500 mt-1">
            {isLocked ? 'Error ≤ 10 px (LOCKED)' : inFov ? 'Acquired in FOV' : 'Searching Target'}
          </span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-lg flex flex-col">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Tracking Error</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className={`font-bold text-xl ${
              telemetry?.tracking.total_error_px !== null && (telemetry?.tracking.total_error_px ?? 99) <= 10
                ? 'text-emerald-400'
                : 'text-amber-400'
            }`}>
              {telemetry?.tracking.total_error_px !== null ? telemetry?.tracking.total_error_px.toFixed(2) : '--'}
            </span>
            <span className="text-xs text-slate-400">px</span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1">Limit: ≤ 10.0 px</span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-lg flex flex-col">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Gimbal Slew Rate</span>
          <div className="flex items-center gap-2 mt-1 text-sm text-white">
            <span>P: <strong className="text-cyan-400">{telemetry?.camera.pan_deg.toFixed(1)}°</strong></span>
            <span>T: <strong className="text-cyan-400">{telemetry?.camera.tilt_deg.toFixed(1)}°</strong></span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1">Slew Limit: 5.0°/s</span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-lg flex flex-col">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Target Shape</span>
          <div className="flex items-center gap-1.5 mt-1">
            {(['Square', 'Circle', 'Gaussian'] as const).map((s) => (
              <button
                key={s}
                onClick={() => onSelectShape(s)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition ${
                  config?.target.shape === s
                    ? 'bg-cyan-950 text-cyan-300 border-cyan-500 shadow-sm'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-slate-500 mt-1">Size: 10×10 px</span>
        </div>

        {/* Global Controls */}
        <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg flex items-center justify-center gap-2">
          <button
            onClick={() => onToggleSim(!isRunning)}
            className={`flex-1 py-2 px-3 rounded font-bold text-xs flex items-center justify-center gap-1.5 transition ${
              isRunning
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isRunning ? 'PAUSE' : 'RUN'}
          </button>
          <button
            onClick={onResetSim}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition"
            title="Reset Simulation State"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Viewport Mode Switcher (2D Camera, 3D Scene, Dual View) */}
      <div className="flex items-center justify-between bg-slate-900/60 p-2 rounded-lg border border-slate-800 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Viewport Mode:</span>
          <button
            onClick={() => setViewMode('dual')}
            className={`px-3 py-1 rounded font-bold transition flex items-center gap-1.5 ${
              viewMode === 'dual'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-700'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> Dual Viewports (2D + Camera)
          </button>
          <button
            onClick={() => setViewMode('3d')}
            className={`px-3 py-1 rounded font-bold transition flex items-center gap-1.5 ${
              viewMode === '3d'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-700'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Box className="w-3.5 h-3.5" /> 3D Virtual Scene
          </button>
          <button
            onClick={() => setViewMode('2d_camera')}
            className={`px-3 py-1 rounded font-bold transition flex items-center gap-1.5 ${
              viewMode === '2d_camera'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-700'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" /> 2D Camera View Only
          </button>
        </div>

        <div className="text-[11px] text-slate-400 flex items-center gap-3">
          <span>Target ID: <strong className="text-white">#{target?.target_id ?? 1}</strong></span>
          <span className="text-slate-600">|</span>
          <span>Target Depth Z: <strong className="text-cyan-300">{target?.world_z.toFixed(0)}m</strong></span>
        </div>
      </div>

      {/* Main Viewports */}
      {viewMode === 'dual' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="min-h-[520px]">
            <VirtualSceneCanvas
              target={telemetry?.target ?? null}
              targets={telemetry?.targets ?? []}
              camera={telemetry?.camera ?? null}
              worldWidth={config?.motion.screen_width ?? 2000}
              worldHeight={config?.motion.screen_height ?? 2000}
            />
          </div>

          <div className="h-full">
            <FPACameraViewport
              target={telemetry?.target ?? null}
              camera={telemetry?.camera ?? null}
              tracking={telemetry?.tracking ?? null}
              onGimbalNudge={onGimbalNudge}
              onGimbalAngles={onGimbalAngles}
            />
          </div>
        </div>
      )}

      {viewMode === '3d' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 min-h-[560px]">
            <Scene3DViewport
              target={telemetry?.target ?? null}
              targets={telemetry?.targets ?? []}
              camera={telemetry?.camera ?? null}
              worldWidth={config?.motion.screen_width ?? 2000}
              worldHeight={config?.motion.screen_height ?? 2000}
            />
          </div>

          <div className="h-full">
            <FPACameraViewport
              target={telemetry?.target ?? null}
              camera={telemetry?.camera ?? null}
              tracking={telemetry?.tracking ?? null}
              onGimbalNudge={onGimbalNudge}
              onGimbalAngles={onGimbalAngles}
            />
          </div>
        </div>
      )}

      {viewMode === '2d_camera' && (
        <div className="max-w-3xl mx-auto w-full">
          <FPACameraViewport
            target={telemetry?.target ?? null}
            camera={telemetry?.camera ?? null}
            tracking={telemetry?.tracking ?? null}
            onGimbalNudge={onGimbalNudge}
            onGimbalAngles={onGimbalAngles}
          />
        </div>
      )}

      {/* Mathematical Kinematics Telemetry Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 space-y-2">
          <div className="text-cyan-400 font-bold border-b border-slate-800 pb-1 uppercase tracking-wider">
            Target 3D Position r(t)
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">X (Azimuth):</span>
            <span className="text-white font-bold">{target?.world_x.toFixed(2)} m</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Y (Elevation):</span>
            <span className="text-white font-bold">{target?.world_y.toFixed(2)} m</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Z (Range Depth):</span>
            <span className="text-white font-bold">{target?.world_z.toFixed(2)} m</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 space-y-2">
          <div className="text-cyan-400 font-bold border-b border-slate-800 pb-1 uppercase tracking-wider">
            Target 3D Velocity v(t)
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Vx:</span>
            <span className="text-cyan-300 font-bold">{target?.velocity_x.toFixed(2)} m/s</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Vy:</span>
            <span className="text-cyan-300 font-bold">{target?.velocity_y.toFixed(2)} m/s</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Vz:</span>
            <span className="text-cyan-300 font-bold">{target?.velocity_z.toFixed(2)} m/s</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 space-y-2">
          <div className="text-cyan-400 font-bold border-b border-slate-800 pb-1 uppercase tracking-wider">
            Target 3D Acceleration a(t)
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Ax:</span>
            <span className="text-amber-300 font-bold">{target?.acceleration_x.toFixed(2)} m/s²</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Ay:</span>
            <span className="text-amber-300 font-bold">{target?.acceleration_y.toFixed(2)} m/s²</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Az:</span>
            <span className="text-amber-300 font-bold">{target?.acceleration_z.toFixed(2)} m/s²</span>
          </div>
        </div>
      </div>

      {/* ─── BEACON SPEED CONTROL ─── */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 font-mono text-xs">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider">
            <Gauge className="w-4 h-4" />
            Beacon Speed Control
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded transition ${
              speedApplied ? 'bg-emerald-900 text-emerald-300 border border-emerald-700' : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}>
              {speedApplied ? '✓ APPLIED' : `${localSpeed.toFixed(0)} px/s`}
            </span>
          </div>
        </div>

        {/* Speed presets */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-slate-400 text-[10px]">Presets:</span>
          {[
            { label: 'Slow', value: 15, color: 'text-emerald-400' },
            { label: 'Normal', value: 40, color: 'text-cyan-400' },
            { label: 'Fast', value: 120, color: 'text-amber-400' },
            { label: 'Max', value: 300, color: 'text-rose-400' },
          ].map(({ label, value, color }) => (
            <button
              key={label}
              onClick={() => { setLocalSpeed(value); applySpeed(value); }}
              className={`px-2.5 py-1 rounded text-[10px] font-bold border transition ${
                Math.round(localSpeed) === value
                  ? 'bg-slate-700 border-cyan-500 ' + color
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
              }`}
            >
              {label} ({value})
            </button>
          ))}
        </div>

        {/* Live slider */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> Live Speed Adjustment</span>
            <span>
              <span className="text-white font-bold">{localSpeed.toFixed(0)}</span>
              <span className="text-slate-500"> px/s</span>
              <span className="text-slate-600 ml-2">(range: 1 – 500)</span>
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={500}
            step={1}
            value={localSpeed}
            onChange={(e) => setLocalSpeed(Number(e.target.value))}
            onMouseUp={(e) => applySpeed(Number((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => applySpeed(Number((e.target as HTMLInputElement).value))}
            className="w-full accent-cyan-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-600">
            <span>1 px/s (Slow)</span>
            <span>250 px/s</span>
            <span>500 px/s (Max)</span>
          </div>
        </div>
      </div>

      {/* Real-time Tracking Performance Strip */}
      <div className="h-44">
        <TelemetryChart
          data={errorHistory}
          maxThreshold={config?.performance.max_tracking_error_pixels ?? 10}
        />
      </div>
    </div>
  );
};
