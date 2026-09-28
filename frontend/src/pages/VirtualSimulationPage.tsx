import React, { useState, useEffect } from 'react';
import { SimulationTelemetry, SystemConfig, OrbitalScenarioConfig, OrbitalTelemetry } from '../types';
import { VirtualSceneCanvas } from '../simulation/VirtualSceneCanvas';
import { Scene3DViewport } from '../simulation/Scene3DViewport';
import { OrbitalScene3DViewport } from '../simulation/OrbitalScene3DViewport';
import { OrbitalControlsPanel } from '../simulation/OrbitalControlsPanel';
import { OrbitalTelemetryPanel } from '../simulation/OrbitalTelemetryPanel';
import { Compass, Box, Layers, Play, Pause, RotateCcw, Globe } from 'lucide-react';
import { api } from '../services/api';

interface Props {
  telemetry: SimulationTelemetry | null;
  config: SystemConfig | null;
  onUpdateConfig: (updater: (prev: SystemConfig) => SystemConfig) => void;
  onToggleSim: (running: boolean) => void;
  onResetSim: () => void;
  onSelectMotion: (pattern: string) => void;
  onSelectShape: (shape: 'Square' | 'Circle' | 'Gaussian') => void;
}

type ViewTab = '2d' | '3d' | 'orbital';

export const VirtualSimulationPage: React.FC<Props> = ({
  telemetry,
  config,
  onUpdateConfig,
  onToggleSim,
  onResetSim,
  onSelectMotion,
  onSelectShape,
}) => {
  const [activeViewTab, setActiveViewTab] = useState<ViewTab>('2d');
  const isRunning = telemetry?.is_running ?? false;
  const target = telemetry?.target ?? null;

  // Orbital Scenario state
  const [timeWarp, setTimeWarp] = useState<number>(1);
  const [orbitalConfig, setOrbitalConfig] = useState<OrbitalScenarioConfig>({
    camera_type: 'SATELLITE',
    beacon_type: 'UAV',
    camera_sat: { preset: 'LEO-550', altitude_km: 550.0, inclination_deg: 53.0, phase_deg: 0.0, raan_deg: 0.0 },
    camera_uav: { lat_deg: 28.6, lon_deg: 77.2, altitude_km: 10.0, pattern: 'Circular', radius_km: 50.0, speed_km_s: 0.25, phase_deg: 0.0 },
    beacon_sat: { preset: 'LEO-550', altitude_km: 550.0, inclination_deg: 53.0, phase_deg: 180.0, raan_deg: 0.0 },
    beacon_uav: { lat_deg: 28.6, lon_deg: 77.2, altitude_km: 10.0, pattern: 'Circular', radius_km: 50.0, speed_km_s: 0.25, phase_deg: 0.0 },
    atmosphere_margin_km: 100.0,
    tilt_limit_deg: 30.0,
  });

  // Fetch initial orbital config from API
  useEffect(() => {
    api
      .getOrbitalConfig()
      .then((cfg) => {
        if (cfg) setOrbitalConfig(cfg);
      })
      .catch((err) => console.warn('Could not fetch orbital config:', err));
  }, []);

  // Force time-warp to 1x when simulation starts running
  useEffect(() => {
    if (isRunning && timeWarp !== 1) {
      setTimeWarp(1);
      api.setTimeWarp(1).catch(() => {});
    }
  }, [isRunning, timeWarp]);

  const handleApplyOrbitalConfig = async (newCfg: OrbitalScenarioConfig) => {
    setOrbitalConfig(newCfg);
    try {
      await api.updateOrbitalConfig(newCfg);
    } catch (err: any) {
      console.error('Failed to update orbital configuration:', err);
    }
  };

  const handleTimeWarpChange = async (warp: number) => {
    if (isRunning) return; // Enforce lock when running
    setTimeWarp(warp);
    try {
      await api.setTimeWarp(warp);
    } catch (err: any) {
      console.error('Failed to set time-warp:', err);
    }
  };

  const handleResetOrbital = async () => {
    try {
      await api.resetOrbital();
    } catch (err: any) {
      console.error('Failed to reset orbital:', err);
    }
  };

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
              {activeViewTab === 'orbital'
                ? '3D Orbital Scenario (Earth-Scale Physics & Three.js Double Precision)'
                : 'Mathematical Trajectory Synthesis & 3D Frustum Geometry (Local UAV-Scale)'}
            </p>
          </div>
        </div>

        {/* View Mode Toggle: Keep 2D World Grid, 3D Scene View, and add Orbital View */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveViewTab('2d')}
            className={`px-3 py-1.5 rounded font-bold transition flex items-center gap-1.5 ${
              activeViewTab === '2d'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-600'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> 2D World Grid
          </button>
          <button
            onClick={() => setActiveViewTab('3d')}
            className={`px-3 py-1.5 rounded font-bold transition flex items-center gap-1.5 ${
              activeViewTab === '3d'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-600'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Box className="w-3.5 h-3.5" /> 3D Scene View
          </button>
          <button
            onClick={() => setActiveViewTab('orbital')}
            className={`px-3 py-1.5 rounded font-bold transition flex items-center gap-1.5 ${
              activeViewTab === 'orbital'
                ? 'bg-gradient-to-r from-blue-950 to-cyan-950 text-cyan-200 border border-cyan-500 shadow-sm'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-cyan-400" /> Orbital View
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
            onClick={() => {
              onResetSim();
              if (activeViewTab === 'orbital') handleResetOrbital();
            }}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition"
            title="Reset Simulation"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Conditional Sub-panel based on active tab */}
      {activeViewTab === 'orbital' ? (
        /* Orbital Controls Panel */
        <OrbitalControlsPanel
          config={orbitalConfig}
          isRunning={isRunning}
          timeWarp={timeWarp}
          onApplyConfig={handleApplyOrbitalConfig}
          onTimeWarpChange={handleTimeWarpChange}
          onReset={handleResetOrbital}
        />
      ) : (
        /* Local Scenario: Trajectory & Shape Bar (Untouched) */
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
      )}

      {/* Main Viewport & Telemetry Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main Viewport Canvas (Col Span 2) */}
        <div className="lg:col-span-2 h-[600px]">
          {activeViewTab === 'orbital' ? (
            <OrbitalScene3DViewport
              orbitalTelemetry={telemetry?.orbital ?? null}
              cameraPreset={orbitalConfig.camera_sat?.preset}
              beaconPreset={orbitalConfig.beacon_sat?.preset}
            />
          ) : activeViewTab === '3d' ? (
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

        {/* Telemetry Inspector (Col Span 1) */}
        <div className="flex flex-col gap-3 font-mono text-xs">
          {activeViewTab === 'orbital' ? (
            <OrbitalTelemetryPanel telemetry={telemetry?.orbital ?? null} />
          ) : (
            /* Local Scenario Kinematics Telemetry Cards (Untouched) */
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};
