import React, { useState, useEffect } from 'react';
import { SimulationTelemetry, SystemConfig, OrbitalScenarioConfig } from '../types';
import { VirtualSceneCanvas } from '../simulation/VirtualSceneCanvas';
import { Scene3DViewport } from '../simulation/Scene3DViewport';
import { OrbitalScene3DViewport } from '../simulation/OrbitalScene3DViewport';
import { OrbitalControlsPanel } from '../simulation/OrbitalControlsPanel';
import { OrbitalTelemetryPanel } from '../simulation/OrbitalTelemetryPanel';
import { Compass, Box, Layers, Play, Pause, RotateCcw, Globe, ChevronDown, Crosshair } from 'lucide-react';
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
    <div className="flex flex-col gap-4 font-mono text-xs text-[#F0FFEA]">
      {/* Header & View Mode Switcher */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-4 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#262824] border border-[#33362F] flex items-center justify-center text-[#FF5F40]">
            <Compass className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#F0FFEA] uppercase tracking-wide">
              Virtual Environment & 3D Kinematics
            </h2>
            <p className="text-[#9CA195] text-xs mt-0.5">
              {activeViewTab === 'orbital'
                ? '3D Orbital Scenario (Earth-Scale Physics & Double Precision)'
                : 'Mathematical Trajectory Synthesis & 3D Frustum Geometry'}
            </p>
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2">
          <div className="flex bg-[#262824] p-1 rounded border border-[#33362F]">
            <button
              onClick={() => setActiveViewTab('2d')}
              className={`px-3 py-1 rounded text-xs font-mono transition flex items-center gap-1.5 border ${
                activeViewTab === '2d'
                  ? 'bg-[#FF5F40] text-[#0A0A0A] font-semibold border-[#FF5F40]'
                  : 'border-transparent text-[#9CA195] hover:text-[#F0FFEA]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" /> 2D World Grid
            </button>
            <button
              onClick={() => setActiveViewTab('3d')}
              className={`px-3 py-1 rounded text-xs font-mono transition flex items-center gap-1.5 border ${
                activeViewTab === '3d'
                  ? 'bg-[#FF5F40] text-[#0A0A0A] font-semibold border-[#FF5F40]'
                  : 'border-transparent text-[#9CA195] hover:text-[#F0FFEA]'
              }`}
            >
              <Box className="w-3.5 h-3.5" /> 3D Scene View
            </button>
            <button
              onClick={() => setActiveViewTab('orbital')}
              className={`px-3 py-1 rounded text-xs font-mono transition flex items-center gap-1.5 border ${
                activeViewTab === 'orbital'
                  ? 'bg-[#FF5F40] text-[#0A0A0A] font-semibold border-[#FF5F40]'
                  : 'border-transparent text-[#9CA195] hover:text-[#F0FFEA]'
              }`}
            >
              <Globe className="w-3.5 h-3.5" /> Orbital View
            </button>
          </div>

          <div className="flex items-center gap-1.5 ml-2">
            <button
              onClick={() => onToggleSim(!isRunning)}
              className={`px-3.5 py-1.5 rounded font-mono text-xs transition flex items-center gap-1.5 ${
                isRunning
                  ? 'bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] border border-[#33362F]'
                  : 'bg-[#FF5F40] hover:bg-[#FF7459] active:bg-[#E5492B] text-[#0A0A0A] font-semibold'
              }`}
            >
              {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isRunning ? 'PAUSE' : 'START'}
            </button>
            <button
              onClick={() => {
                onResetSim();
                if (activeViewTab === 'orbital') handleResetOrbital();
              }}
              className="p-1.5 bg-[#262824] hover:bg-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] rounded border border-[#33362F] hover:border-[#FF5F40] transition"
              title="Reset Simulation"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Jump to Sat Button */}
            <button
              onClick={() => {
                if (activeViewTab === '2d') {
                  setActiveViewTab('3d');
                }
                window.dispatchEvent(new CustomEvent('fsoc:jump-to-sat'));
              }}
              className="px-3 py-1.5 rounded font-mono font-semibold text-xs transition flex items-center gap-1.5 bg-[#262824] hover:bg-[#33362F] text-[#FF5F40] border border-[#FF5F40] cursor-pointer"
              title="Jump 3D Camera Directly in Front of Satellite (Shortcut: S or F)"
            >
              <Crosshair className="w-3.5 h-3.5 text-[#FF5F40]" />
              <span>LOCATE SAT</span>
              <kbd className="px-1 py-0.2 bg-[#000000] text-[9px] rounded text-[#F0FFEA] font-mono border border-[#33362F]">S</kbd>
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
        <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Mandatory Patterns */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[#9CA195] font-medium text-xs uppercase tracking-wider">Mandatory:</span>
              {mandatoryTrajectories.map((m) => (
                <button
                  key={m}
                  onClick={() => onSelectMotion(m)}
                  className={`px-2.5 py-1 rounded text-xs font-mono transition border ${
                    config?.motion.trajectory_type === m
                      ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] font-semibold'
                      : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA] hover:border-[#FF5F40]'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Extended Patterns */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[#9CA195] font-medium text-xs uppercase tracking-wider">Extended:</span>
              {optionalTrajectories.map((o) => (
                <button
                  key={o}
                  onClick={() => onSelectMotion(o)}
                  className={`px-2.5 py-1 rounded text-xs font-mono transition border ${
                    config?.motion.trajectory_type === o
                      ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] font-semibold'
                      : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA] hover:border-[#FF5F40]'
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>

          {/* Beacon Shape Dropdown */}
          <div className="bg-[#262824] border border-[#33362F] p-2.5 rounded flex flex-col justify-between min-w-[140px]">
            <span className="text-xs text-[#9CA195] font-medium uppercase tracking-wider">Beacon Shape</span>
            <div className="relative my-1">
              <select
                value={config?.target.shape ?? 'Gaussian'}
                onChange={(e) => onSelectShape(e.target.value as 'Square' | 'Circle' | 'Gaussian')}
                className="w-full bg-[#1B1D1A] border border-[#33362F] hover:border-[#FF5F40] text-[#F0FFEA] text-xs px-2.5 py-1.5 rounded font-mono appearance-none pr-7 cursor-pointer focus:outline-none focus:border-[#FF5F40] transition"
              >
                <option value="Gaussian" className="bg-[#1B1D1A] text-[#F0FFEA]">Gaussian</option>
                <option value="Square" className="bg-[#1B1D1A] text-[#F0FFEA]">Square</option>
                <option value="Circle" className="bg-[#1B1D1A] text-[#F0FFEA]">Circle</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-[#9CA195] absolute right-2 top-2 pointer-events-none" />
            </div>
            <span className="text-[11px] text-[#9CA195] font-mono">
              Profile: {config?.target.size_pixels ?? 10}×{config?.target.size_pixels ?? 10} px
            </span>
          </div>
        </div>
      )}

      {/* Main Viewport & Telemetry Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main Viewport Canvas (Col Span 2) */}
        <div className="lg:col-span-2 h-[600px] rounded-lg overflow-hidden border border-[#33362F] bg-[#000000]">
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
              <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 space-y-2.5">
                <h3 className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider border-b border-[#33362F] pb-2">
                  Target Kinematics State
                </h3>
                <div className="flex justify-between font-mono text-xs">
                  <span className="text-[#9CA195]">Position X (Azimuth):</span>
                  <span className="text-[#F0FFEA] font-medium">{target?.world_x.toFixed(2)} m</span>
                </div>
                <div className="flex justify-between font-mono text-xs">
                  <span className="text-[#9CA195]">Position Y (Elevation):</span>
                  <span className="text-[#F0FFEA] font-medium">{target?.world_y.toFixed(2)} m</span>
                </div>
                <div className="flex justify-between font-mono text-xs">
                  <span className="text-[#9CA195]">Position Z (Optical Depth):</span>
                  <span className="text-[#F0FFEA] font-medium">{target?.world_z.toFixed(2)} m</span>
                </div>
                <div className="flex justify-between border-t border-[#33362F] pt-2 font-mono text-xs">
                  <span className="text-[#9CA195]">Velocity Vector [Vx, Vy, Vz]:</span>
                  <span className="text-[#F0FFEA] font-medium">
                    [{target?.velocity_x.toFixed(1)}, {target?.velocity_y.toFixed(1)}, {target?.velocity_z.toFixed(1)}] m/s
                  </span>
                </div>
                <div className="flex justify-between font-mono text-xs">
                  <span className="text-[#9CA195]">Acceleration [Ax, Ay, Az]:</span>
                  <span className="text-[#FF5F40] font-medium">
                    [{target?.acceleration_x.toFixed(1)}, {target?.acceleration_y.toFixed(1)}, {target?.acceleration_z.toFixed(1)}] m/s²
                  </span>
                </div>
                <div className="flex justify-between items-center border-t border-[#33362F] pt-2 text-xs">
                  <span className="text-[#9CA195]">Sensor Visibility:</span>
                  <div className="flex items-center gap-1.5 font-medium">
                    <span className={`w-2 h-2 rounded-full ${target?.is_in_fov ? 'bg-[#FF5F40]' : 'border border-[#FF5F40]'}`} />
                    <span className={target?.is_in_fov ? 'text-[#FF5F40]' : 'text-[#F0FFEA]'}>
                      {target?.is_in_fov ? '✓ INSIDE FOV' : '✕ CLIPPED (OUTSIDE CONE)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Virtual Camera & Frustum */}
              <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 space-y-2.5">
                <h3 className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider border-b border-[#33362F] pb-2">
                  Camera Orientation & Limits
                </h3>
                <div className="flex justify-between font-mono text-xs">
                  <span className="text-[#9CA195]">Camera Origin:</span>
                  <span className="text-[#F0FFEA]">({telemetry?.camera.position_x.toFixed(0)}, {telemetry?.camera.position_y.toFixed(0)}, {telemetry?.camera.position_z.toFixed(0)})</span>
                </div>
                <div className="flex justify-between font-mono text-xs">
                  <span className="text-[#9CA195]">Pan Angle:</span>
                  <span className="text-[#FF5F40] font-medium">{telemetry?.camera.pan_deg.toFixed(2)}° (±180°)</span>
                </div>
                <div className="flex justify-between font-mono text-xs">
                  <span className="text-[#9CA195]">Tilt Angle:</span>
                  <span className="text-[#FF5F40] font-medium">{telemetry?.camera.tilt_deg.toFixed(2)}° (±85°)</span>
                </div>
                <div className="flex justify-between font-mono text-xs">
                  <span className="text-[#9CA195]">Max Slew Speed:</span>
                  <span className="text-[#FF5F40] font-medium">5.0°/s (Clamped)</span>
                </div>
                <div className="flex justify-between font-mono text-xs">
                  <span className="text-[#9CA195]">Angular Resolution:</span>
                  <span className="text-[#F0FFEA]">160 px/° (640 × 480)</span>
                </div>
              </div>

              {/* 3D Coordinate Architecture note */}
              <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-3.5 space-y-1.5 text-xs text-[#9CA195]">
                <div className="text-[#F0FFEA] font-medium uppercase tracking-wider">
                  Continuous Coordinate Space
                </div>
                <p className="leading-relaxed text-[11px] text-[#9CA195]">
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
