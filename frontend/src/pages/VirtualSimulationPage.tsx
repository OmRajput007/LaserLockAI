import React, { useState, useEffect } from 'react';
import { SimulationTelemetry, SystemConfig, OrbitalScenarioConfig } from '../types';
import { VirtualSceneCanvas } from '../simulation/VirtualSceneCanvas';
import { Scene3DViewport } from '../simulation/Scene3DViewport';
import { OrbitalScene3DViewport } from '../simulation/OrbitalScene3DViewport';
import { OrbitalControlsPanel } from '../simulation/OrbitalControlsPanel';
import { OrbitalTelemetryPanel } from '../simulation/OrbitalTelemetryPanel';
import { Compass, Box, Layers, Play, Pause, RotateCcw, Globe } from 'lucide-react';
import { api } from '../services/api';
import { useSceneSettings } from '../hooks/useSceneSettings';

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
  onToggleSim,
  onResetSim,
  onSelectMotion,
  onSelectShape,
}) => {
  const { settings, bindSetting } = useSceneSettings();
  const [activeViewTab, setActiveViewTab] = [settings.virtualSimTab, bindSetting('virtualSimTab')];
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
    if (isRunning) return;
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
    <div className="flex flex-col gap-4 font-sans text-xs text-slate-200">
      {/* Header & View Mode Switcher */}
      <div className="bg-[#121518] border border-[#252A2E] p-4 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-[#1E2124] border border-[#3A4048] flex items-center justify-center text-[#D6D9DC]">
            <Compass className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Virtual Environment & 3D Kinematics
            </h2>
            <p className="text-slate-400 text-xs mt-0.5">
              {activeViewTab === 'orbital'
                ? '3D Orbital Scenario (Earth-Scale Physics & Three.js Double Precision)'
                : 'Mathematical Trajectory Synthesis & 3D Frustum Geometry (Local UAV-Scale)'}
            </p>
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2">
          <div className="flex bg-[#0D1012] p-1 rounded-md border border-[#252A2E]">
            <button
              onClick={() => setActiveViewTab('2d')}
              className={`px-3 py-1 rounded text-xs font-medium transition flex items-center gap-1.5 ${
                activeViewTab === '2d'
                  ? 'bg-[#252A2E] text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-slate-400" /> 2D World Grid
            </button>
            <button
              onClick={() => setActiveViewTab('3d')}
              className={`px-3 py-1 rounded text-xs font-medium transition flex items-center gap-1.5 ${
                activeViewTab === '3d'
                  ? 'bg-[#252A2E] text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Box className="w-3.5 h-3.5 text-slate-400" /> 3D Scene View
            </button>
            <button
              onClick={() => setActiveViewTab('orbital')}
              className={`px-3 py-1 rounded text-xs font-medium transition flex items-center gap-1.5 ${
                activeViewTab === 'orbital'
                  ? 'bg-[#252A2E] text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-slate-400" /> Orbital View
            </button>
          </div>

          <div className="flex items-center gap-1.5 ml-2">
            <button
              onClick={() => onToggleSim(!isRunning)}
              className={`px-3.5 py-1.5 rounded-md font-medium text-xs transition flex items-center gap-1.5 ${
                isRunning ? 'bg-amber-600 hover:bg-amber-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isRunning ? 'Pause' : 'Start'}
            </button>
            <button
              onClick={() => {
                onResetSim();
                if (activeViewTab === 'orbital') handleResetOrbital();
              }}
              className="p-1.5 bg-[#1A1D20] hover:bg-[#202c42] text-slate-300 rounded-md border border-[#2D3237] transition"
              title="Reset Simulation"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Sub-panel based on active tab */}
      {activeViewTab === 'orbital' ? (
        <OrbitalControlsPanel
          config={orbitalConfig}
          isRunning={isRunning}
          timeWarp={timeWarp}
          onApplyConfig={handleApplyOrbitalConfig}
          onTimeWarpChange={handleTimeWarpChange}
          onReset={handleResetOrbital}
        />
      ) : (
        /* Trajectory & Beacon Shape Controls */
        <div className="bg-[#121518] border border-[#252A2E] p-3 rounded-lg flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Mandatory Patterns */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-400 font-medium text-xs">Mandatory:</span>
              {mandatoryTrajectories.map((m) => (
                <button
                  key={m}
                  onClick={() => onSelectMotion(m)}
                  className={`px-2.5 py-1 rounded text-xs font-medium border transition ${
                    config?.motion.trajectory_type === m
                      ? 'bg-[#1E2124] text-[#E8EAED] border-[#3A4048]'
                      : 'bg-[#1A1D20] text-slate-300 border-[#2D3237] hover:bg-[#202b40]'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Extended Patterns */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-400 font-medium text-xs">Extended:</span>
              {optionalTrajectories.map((o) => (
                <button
                  key={o}
                  onClick={() => onSelectMotion(o)}
                  className={`px-2.5 py-1 rounded text-xs font-medium border transition ${
                    config?.motion.trajectory_type === o
                      ? 'bg-[#1E2124] text-[#E8EAED] border-[#3A4048]'
                      : 'bg-[#1A1D20] text-slate-400 border-[#2D3237] hover:bg-[#202b40]'
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>

          {/* Shape selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-medium text-xs">Beacon:</span>
            {(['Square', 'Circle', 'Gaussian'] as const).map((s) => (
              <button
                key={s}
                onClick={() => onSelectShape(s)}
                className={`px-2.5 py-1 rounded text-xs font-medium border transition ${
                  config?.target.shape === s
                    ? 'bg-emerald-950/60 text-emerald-400 border-emerald-700/60'
                    : 'bg-[#1A1D20] text-slate-400 border-[#2D3237] hover:text-white'
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
        <div className="lg:col-span-2 h-[600px] rounded-lg overflow-hidden border border-[#252A2E] bg-[#0D1012]">
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
              disturbance={telemetry?.disturbance ?? null}
              worldWidth={config?.motion.screen_width ?? 2000}
              worldHeight={config?.motion.screen_height ?? 2000}
            />
          ) : (
            <VirtualSceneCanvas
              target={telemetry?.target ?? null}
              targets={telemetry?.targets ?? []}
              camera={telemetry?.camera ?? null}
              disturbance={telemetry?.disturbance ?? null}
              worldWidth={config?.motion.screen_width ?? 2000}
              worldHeight={config?.motion.screen_height ?? 2000}
            />
          )}
        </div>

        {/* Telemetry Inspector (Col Span 1) */}
        <div className="flex flex-col gap-3">
          {activeViewTab === 'orbital' ? (
            <OrbitalTelemetryPanel telemetry={telemetry?.orbital ?? null} />
          ) : (
            <>
              {/* Target 3D Kinematics State */}
              <div className="bg-[#121518] border border-[#252A2E] rounded-lg p-4 space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-200 border-b border-[#252A2E] pb-2">
                  Target Kinematics State
                </h3>
                <div className="flex justify-between num-mono text-xs">
                  <span className="text-slate-400 font-sans">Position X (Azimuth):</span>
                  <span className="text-slate-100 font-medium">{target?.world_x.toFixed(2)} m</span>
                </div>
                <div className="flex justify-between num-mono text-xs">
                  <span className="text-slate-400 font-sans">Position Y (Elevation):</span>
                  <span className="text-slate-100 font-medium">{target?.world_y.toFixed(2)} m</span>
                </div>
                <div className="flex justify-between num-mono text-xs">
                  <span className="text-slate-400 font-sans">Position Z (Optical Depth):</span>
                  <span className="text-slate-100 font-medium">{target?.world_z.toFixed(2)} m</span>
                </div>
                <div className="flex justify-between border-t border-[#252A2E] pt-2 num-mono text-xs">
                  <span className="text-slate-400 font-sans">Velocity Vector [Vx, Vy, Vz]:</span>
                  <span className="text-[#E8EAED] font-medium">
                    [{target?.velocity_x.toFixed(1)}, {target?.velocity_y.toFixed(1)}, {target?.velocity_z.toFixed(1)}] m/s
                  </span>
                </div>
                <div className="flex justify-between num-mono text-xs">
                  <span className="text-slate-400 font-sans">Acceleration [Ax, Ay, Az]:</span>
                  <span className="text-amber-300 font-medium">
                    [{target?.acceleration_x.toFixed(1)}, {target?.acceleration_y.toFixed(1)}, {target?.acceleration_z.toFixed(1)}] m/s²
                  </span>
                </div>
                <div className="flex justify-between items-center border-t border-[#252A2E] pt-2 text-xs">
                  <span className="text-slate-400">Sensor Visibility:</span>
                  <div className="flex items-center gap-1.5 font-medium">
                    <span className={`w-2 h-2 rounded-full ${target?.is_in_fov ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    <span className={target?.is_in_fov ? 'text-emerald-400' : 'text-rose-400'}>
                      {target?.is_in_fov ? 'Inside FOV' : 'Clipped (Outside Cone)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Virtual Camera & Frustum */}
              <div className="bg-[#121518] border border-[#252A2E] rounded-lg p-4 space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-200 border-b border-[#252A2E] pb-2">
                  Camera Orientation & Limits
                </h3>
                <div className="flex justify-between num-mono text-xs">
                  <span className="text-slate-400 font-sans">Camera Origin:</span>
                  <span className="text-slate-300">({telemetry?.camera.position_x.toFixed(0)}, {telemetry?.camera.position_y.toFixed(0)}, {telemetry?.camera.position_z.toFixed(0)})</span>
                </div>
                <div className="flex justify-between num-mono text-xs">
                  <span className="text-slate-400 font-sans">Pan Angle:</span>
                  <span className="text-slate-100 font-medium">{telemetry?.camera.pan_deg.toFixed(2)}° (±180°)</span>
                </div>
                <div className="flex justify-between num-mono text-xs">
                  <span className="text-slate-400 font-sans">Tilt Angle:</span>
                  <span className="text-slate-100 font-medium">{telemetry?.camera.tilt_deg.toFixed(2)}° (±85°)</span>
                </div>
                <div className="flex justify-between num-mono text-xs">
                  <span className="text-slate-400 font-sans">Max Slew Speed:</span>
                  <span className="text-emerald-400 font-medium">5.0°/s (Clamped)</span>
                </div>
                <div className="flex justify-between num-mono text-xs">
                  <span className="text-slate-400 font-sans">Angular Resolution:</span>
                  <span className="text-slate-300">160 px/° (640 × 480)</span>
                </div>
              </div>

              {/* 3D Coordinate Architecture note */}
              <div className="bg-[#121518] border border-[#252A2E] rounded-lg p-3.5 space-y-1.5 text-xs text-slate-400">
                <div className="text-slate-300 font-medium">
                  Continuous Coordinate Space
                </div>
                <p className="leading-relaxed text-[11px] text-slate-400">
                  Target trajectories are evaluated analytically using continuous physical equations. The camera pin-hole model projects ray vectors onto the 640 × 480 focal plane.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
