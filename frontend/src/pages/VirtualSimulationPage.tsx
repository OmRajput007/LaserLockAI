import React, { useState } from 'react';
import { SimulationTelemetry, SystemConfig } from '../types';
import { VirtualSceneCanvas } from '../simulation/VirtualSceneCanvas';
import { Scene3DViewport } from '../simulation/Scene3DViewport';
import { Compass, Box, Layers, Play, Pause, RotateCcw, Activity } from 'lucide-react';

interface Props {
  telemetry: SimulationTelemetry | null;
  config: SystemConfig | null;
  onUpdateConfig: (updater: (prev: SystemConfig) => SystemConfig) => void;
  onToggleSim: (running: boolean) => void;
  onResetSim: () => void;
  onSelectMotion: (pattern: string) => void;
  onSelectShape: (shape: 'Square' | 'Circle' | 'Gaussian') => void;
}

export const VirtualSimulationPage: React.FC<Props> = ({
  telemetry,
  config,
  onUpdateConfig,
  onToggleSim,
  onResetSim,
  onSelectMotion,
  onSelectShape,
}) => {
  const [view3D, setView3D] = useState(false);
  const isRunning = telemetry?.is_running ?? false;
  const target = telemetry?.target ?? null;

  const mandatoryTrajectories = ['Straight Line', 'Circular', 'Figure of 8', 'Random'] as const;
  const optionalTrajectories = ['Spiral', 'Sinusoidal', 'Waypoint', 'User-defined'] as const;

  return (
    <div className="flex flex-col gap-4 font-mono text-xs">
      {/* Configuration & Trajectory Selector Strip */}
      <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Compass className="w-5 h-5 text-cyan-400" />
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Virtual Environment & 3D Kinematics
            </h2>
            <p className="text-slate-400 text-[11px]">
              Mathematical Trajectory Synthesis & 3D Frustum Geometry
            </p>
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView3D(false)}
            className={`px-3 py-1.5 rounded font-bold transition flex items-center gap-1.5 ${
              !view3D ? 'bg-cyan-950 text-cyan-300 border border-cyan-600' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> 2D World Grid
          </button>
          <button
            onClick={() => setView3D(true)}
            className={`px-3 py-1.5 rounded font-bold transition flex items-center gap-1.5 ${
              view3D ? 'bg-cyan-950 text-cyan-300 border border-cyan-600' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Box className="w-3.5 h-3.5" /> 3D Scene View
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggleSim(!isRunning)}
            className={`px-3.5 py-1.5 rounded font-bold transition flex items-center gap-1.5 ${
              isRunning ? 'bg-amber-600 text-white' : 'bg-emerald-600 text-white'
            }`}
          >
            {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isRunning ? 'PAUSE' : 'START SIM'}
          </button>
          <button
            onClick={onResetSim}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition"
            title="Reset Simulation"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Trajectory & Shape Bar */}
      <div className="bg-slate-900/60 border border-slate-800 p-3 rounded-lg flex flex-wrap items-center justify-between gap-4">
        {/* Mandatory Patterns */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-400 font-bold">Mandatory PS4:</span>
          {mandatoryTrajectories.map((m) => (
            <button
              key={m}
              onClick={() => onSelectMotion(m)}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition ${
                config?.motion.trajectory_type === m
                  ? 'bg-cyan-950 text-cyan-300 border-cyan-500 shadow-sm'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Optional Patterns */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-400 font-bold">Extended Patterns:</span>
          {optionalTrajectories.map((o) => (
            <button
              key={o}
              onClick={() => onSelectMotion(o)}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition ${
                config?.motion.trajectory_type === o
                  ? 'bg-cyan-950 text-cyan-300 border-cyan-500 shadow-sm'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
              }`}
            >
              {o}
            </button>
          ))}
        </div>

        {/* Shape selector */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-bold">Beacon Shape:</span>
          {(['Square', 'Circle', 'Gaussian'] as const).map((s) => (
            <button
              key={s}
              onClick={() => onSelectShape(s)}
              className={`px-2.5 py-1 rounded text-[11px] font-bold border transition ${
                config?.target.shape === s
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Main Viewport & Telemetry Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 h-[600px]">
          {view3D ? (
            <Scene3DViewport
              target={telemetry?.target ?? null}
              targets={telemetry?.targets ?? []}
              camera={telemetry?.camera ?? null}
              worldWidth={config?.motion.screen_width ?? 2000}
              worldHeight={config?.motion.screen_height ?? 2000}
            />
          ) : (
            <VirtualSceneCanvas
              target={telemetry?.target ?? null}
              targets={telemetry?.targets ?? []}
              camera={telemetry?.camera ?? null}
              worldWidth={config?.motion.screen_width ?? 2000}
              worldHeight={config?.motion.screen_height ?? 2000}
            />
          )}
        </div>

        {/* Kinematics Telemetry Cards */}
        <div className="flex flex-col gap-3 font-mono text-xs">
          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 space-y-2.5">
            <h3 className="text-cyan-400 font-bold border-b border-slate-800 pb-1.5 uppercase tracking-wider">
              Target 3D Kinematics State
            </h3>
            <div className="flex justify-between">
              <span className="text-slate-400">Position X (Azimuth):</span>
              <span className="text-white font-bold">{target?.world_x.toFixed(2)} m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Position Y (Elevation):</span>
              <span className="text-white font-bold">{target?.world_y.toFixed(2)} m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Position Z (Optical Depth):</span>
              <span className="text-white font-bold">{target?.world_z.toFixed(2)} m</span>
            </div>
            <div className="flex justify-between border-t border-slate-800/60 pt-1.5">
              <span className="text-slate-400">Velocity Vector (Vx, Vy, Vz):</span>
              <span className="text-cyan-300 font-bold">
                [{target?.velocity_x.toFixed(1)}, {target?.velocity_y.toFixed(1)}, {target?.velocity_z.toFixed(1)}] m/s
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Acceleration (Ax, Ay, Az):</span>
              <span className="text-amber-300 font-bold">
                [{target?.acceleration_x.toFixed(1)}, {target?.acceleration_y.toFixed(1)}, {target?.acceleration_z.toFixed(1)}] m/s²
              </span>
            </div>
            <div className="flex justify-between border-t border-slate-800/60 pt-1.5">
              <span className="text-slate-400">Visibility inside FOV:</span>
              <span className={target?.is_in_fov ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                {target?.is_in_fov ? 'VISIBLE (INSIDE CONE)' : 'CLIPPED (OUTSIDE CONE)'}
              </span>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 space-y-2.5">
            <h3 className="text-cyan-400 font-bold border-b border-slate-800 pb-1.5 uppercase tracking-wider">
              Virtual Camera & 3D Frustum
            </h3>
            <div className="flex justify-between">
              <span className="text-slate-400">Camera 3D Center:</span>
              <span className="text-white">({telemetry?.camera.position_x.toFixed(0)}, {telemetry?.camera.position_y.toFixed(0)}, {telemetry?.camera.position_z.toFixed(0)})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Pan Angle:</span>
              <span className="text-cyan-300 font-bold">{telemetry?.camera.pan_deg.toFixed(2)}° (Limit: ±180°)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Tilt Angle:</span>
              <span className="text-cyan-300 font-bold">{telemetry?.camera.tilt_deg.toFixed(2)}° (Limit: ±85°)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Max Slew Speed:</span>
              <span className="text-emerald-400 font-bold">5.0°/s (Clamped)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Angular Resolution:</span>
              <span className="text-white">160.0 px/degree (640x480)</span>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 space-y-1.5 text-[11px] text-slate-400">
            <div className="text-cyan-400 font-bold uppercase tracking-wider">
              3D Coordinate Architecture
            </div>
            <p className="leading-relaxed">
              Target movement is generated by continuous analytical mathematical differential equations. The camera frustum projects the 3D ray bundle directly to 640x480 focal plane pixels.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
