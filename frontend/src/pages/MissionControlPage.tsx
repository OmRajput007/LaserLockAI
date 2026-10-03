import React, { useState, useCallback, useRef, useEffect } from 'react';
import { SimulationTelemetry, SystemConfig } from '../types';
import { VirtualSceneCanvas } from '../simulation/VirtualSceneCanvas';
import { FPACameraViewport } from '../simulation/FPACameraViewport';
import { Scene3DViewport } from '../simulation/Scene3DViewport';
import { TelemetryChart } from '../charts/TelemetryChart';
import { api } from '../services/api';
import { useSceneSettings } from '../hooks/useSceneSettings';
import BeaconSpeedControl from '../components/BeaconSpeedControl';
import {
  Play,
  Pause,
  RotateCcw,
  Box,
  Layers,
  Crosshair,
  ChevronDown,
  ChevronUp,
  Square,
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
  const { settings, bindSetting, set } = useSceneSettings();
  const [viewMode, setViewMode] = [settings.missionViewMode || '3d', bindSetting('missionViewMode')];
  const [showKinematics, setShowKinematics] = [settings.missionShowKinematics, bindSetting('missionShowKinematics')];
  const [localSpeed, setLocalSpeed] = useState<number>(
    () => settings.beaconSpeedKmh || config?.motion?.speed_kmh || config?.motion?.speed_pixels_per_s || 150
  );
  const [speedApplied, setSpeedApplied] = useState(false);

  const applySpeed = useCallback(async (spd: number) => {
    try {
      setLocalSpeed(spd);
      set({ beaconSpeedKmh: spd });
      await api.setBeaconSpeed(spd);
      setSpeedApplied(true);
      setTimeout(() => setSpeedApplied(false), 800);
    } catch (e) {
      console.error('Failed to set beacon speed:', e);
    }
  }, [set]);

  const isRunning = telemetry?.is_running ?? false;
  const isLocked = telemetry?.tracking.is_locked ?? false;
  const inFov = telemetry?.target.is_in_fov ?? false;
  const target = telemetry?.target ?? null;

  // Stop / Start All Calculating Processes State
  const [isProcessesRunning, setIsProcessesRunning] = useState<boolean>(true);
  const initialMountRef = useRef<boolean>(true);

  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      return;
    }
    if (telemetry?.is_running !== undefined) {
      setIsProcessesRunning(telemetry.is_running);
    }
  }, [telemetry?.is_running]);

  const handleToggleAllProcesses = useCallback(async () => {
    if (isProcessesRunning) {
      // Stop all calculating processes across backend simulation & frontend 3D kinetics
      setIsProcessesRunning(false);
      try {
        onToggleSim(false);
        await api.pauseSimulation();
      } catch (err) {
        console.error('Failed to pause simulation backend:', err);
      }
      set({
        autoRevolve: false,
        beaconRevolving: false,
        earthSpinEnabled: false,
      });
      window.dispatchEvent(new CustomEvent('fsoc:stop-all-processes'));
    } else {
      // Start all calculating processes across backend simulation & frontend 3D kinetics
      setIsProcessesRunning(true);
      try {
        onToggleSim(true);
        await api.startSimulation();
      } catch (err) {
        console.error('Failed to start simulation backend:', err);
      }
      set({
        autoRevolve: true,
        beaconRevolving: true,
        earthSpinEnabled: true,
      });
      window.dispatchEvent(new CustomEvent('fsoc:start-all-processes'));
    }
  }, [isProcessesRunning, onToggleSim, set]);

  return (
    <div className="flex flex-col gap-4 font-mono text-xs text-[#F0FFEA]">
      {/* Top Telemetry Cockpit Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Mission Status */}
        <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex flex-col justify-between">
          <span className="text-xs text-[#9CA195] font-medium uppercase tracking-wider">Mission Status</span>
          <div className="flex items-center gap-2 my-1">
            <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-[#FF5F40] ring-2 ring-[#FF5F40]/30 animate-pulse' : 'bg-[#5E625A]'}`} />
            <span className="font-semibold text-sm text-[#F0FFEA]">
              {isRunning ? 'ACTIVE RUN' : 'STANDBY'}
            </span>
          </div>
          <span className="text-[11px] text-[#9CA195] font-mono">
            Sim Time: {telemetry?.simulation_time_s.toFixed(2)}s
          </span>
        </div>

        {/* Target Visibility */}
        <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex flex-col justify-between">
          <span className="text-xs text-[#9CA195] font-medium uppercase tracking-wider">Target Visibility</span>
          <div className="flex items-center gap-2 my-1">
            <span className={`w-2 h-2 rounded-full ${inFov ? 'bg-[#FF5F40]' : 'border border-[#FF5F40]'}`} />
            <span className={`font-semibold text-sm ${inFov ? 'text-[#FF5F40]' : 'text-[#F0FFEA]'}`}>
              {inFov ? '✓ INSIDE FOV' : '✕ OUTSIDE FOV'}
            </span>
          </div>
          <span className="text-[11px] text-[#9CA195]">
            {isLocked ? 'Locked (≤ 10 px)' : inFov ? 'Acquired in Sensor' : 'Searching Target'}
          </span>
        </div>

        {/* Tracking Error */}
        <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex flex-col justify-between">
          <span className="text-xs text-[#9CA195] font-medium uppercase tracking-wider">Tracking Error</span>
          <div className="flex items-baseline gap-1 my-1">
            <span className={`font-semibold text-xl font-mono ${
              telemetry?.tracking.total_error_px !== null && (telemetry?.tracking.total_error_px ?? 99) <= 10
                ? 'text-[#F0FFEA]'
                : 'text-[#FF5F40]'
            }`}>
              {telemetry?.tracking.total_error_px !== null ? telemetry?.tracking.total_error_px.toFixed(2) : '--'}
            </span>
            <span className="text-xs text-[#9CA195]">px</span>
          </div>
          <span className="text-[11px] text-[#9CA195] font-mono">Gate Limit: ≤ 10.0 px</span>
        </div>

        {/* Gimbal Orientation */}
        <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex flex-col justify-between">
          <span className="text-xs text-[#9CA195] font-medium uppercase tracking-wider">Gimbal Angles</span>
          <div className="flex items-center gap-2 my-1 text-sm font-mono text-[#F0FFEA]">
            <span>P: <strong className="text-[#FF5F40] font-medium">{telemetry?.camera.pan_deg.toFixed(1)}°</strong></span>
            <span className="text-[#5E625A]">•</span>
            <span>T: <strong className="text-[#FF5F40] font-medium">{telemetry?.camera.tilt_deg.toFixed(1)}°</strong></span>
          </div>
          <span className="text-[11px] text-[#9CA195] font-mono">Max Slew: 5.0°/s</span>
        </div>

        {/* Target Shape */}
        <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex flex-col justify-between">
          <span className="text-xs text-[#9CA195] font-medium uppercase tracking-wider">Beacon Shape</span>
          <div className="relative my-1">
            <select
              value={config?.target.shape ?? 'Gaussian'}
              onChange={(e) => onSelectShape(e.target.value as 'Square' | 'Circle' | 'Gaussian')}
              className="w-full bg-[#262824] border border-[#33362F] hover:border-[#FF5F40] text-[#F0FFEA] text-xs px-2.5 py-1.5 rounded font-mono appearance-none pr-7 cursor-pointer focus:outline-none focus:border-[#FF5F40] transition"
            >
              <option value="Gaussian" className="bg-[#262824] text-[#F0FFEA]">Gaussian</option>
              <option value="Square" className="bg-[#262824] text-[#F0FFEA]">Square</option>
              <option value="Circle" className="bg-[#262824] text-[#F0FFEA]">Circle</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-[#9CA195] absolute right-2 top-2 pointer-events-none" />
          </div>
          <span className="text-[11px] text-[#9CA195] font-mono">Profile: {config?.target.size_pixels ?? 10}×{config?.target.size_pixels ?? 10} px</span>
        </div>

        {/* Quick Simulation Controls */}
        <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex items-center justify-center gap-2">
          <button
            onClick={() => onToggleSim(!isRunning)}
            className={`flex-1 py-2 px-3 rounded font-mono text-xs flex items-center justify-center gap-1.5 transition ${
              isRunning
                ? 'bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] border border-[#33362F]'
                : 'bg-[#FF5F40] hover:bg-[#FF7459] active:bg-[#E5492B] text-[#0A0A0A] font-semibold'
            }`}
          >
            {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isRunning ? 'PAUSE' : 'RUN'}
          </button>
          <button
            onClick={onResetSim}
            className="p-2 bg-[#262824] hover:bg-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] rounded border border-[#33362F] hover:border-[#FF5F40] transition"
            title="Reset Simulation State"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Viewport Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#1B1D1A] px-3 py-2 rounded-lg border border-[#33362F] text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[#9CA195] font-medium uppercase tracking-wider">Viewport:</span>
          <button
            onClick={() => setViewMode('3d')}
            className={`px-3 py-1 rounded font-mono transition flex items-center gap-1.5 border cursor-pointer ${
              viewMode === '3d'
                ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] font-semibold'
                : 'bg-[#262824] border-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] hover:border-[#FF5F40]'
            }`}
          >
            <Box className="w-3.5 h-3.5" /> 3D Virtual Scene
          </button>
          <button
            onClick={() => setViewMode('dual')}
            className={`px-3 py-1 rounded font-mono transition flex items-center gap-1.5 border cursor-pointer ${
              viewMode === 'dual'
                ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] font-semibold'
                : 'bg-[#262824] border-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] hover:border-[#FF5F40]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> Dual (2D + Camera)
          </button>
          <button
            onClick={() => setViewMode('2d_camera')}
            className={`px-3 py-1 rounded font-mono transition flex items-center gap-1.5 border cursor-pointer ${
              viewMode === '2d_camera'
                ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] font-semibold'
                : 'bg-[#262824] border-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] hover:border-[#FF5F40]'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" /> 2D Camera Only
          </button>

          {/* Stop / Start All Calculating Processes Toggle Button */}
          <button
            id="btn-toggle-all-processes"
            onClick={handleToggleAllProcesses}
            className={`ml-2 px-3 py-1 rounded font-mono text-xs font-semibold transition flex items-center gap-1.5 border shadow-sm cursor-pointer ${
              isProcessesRunning
                ? 'bg-[#DC2626] hover:bg-[#B91C1C] active:bg-[#991B1B] text-white border-[#EF4444]'
                : 'bg-[#16A34A] hover:bg-[#15803D] active:bg-[#166534] text-white border-[#22C55E]'
            }`}
            title={
              isProcessesRunning
                ? 'Stop all calculation and simulation processes across the software'
                : 'Start all calculation and simulation processes across the software'
            }
          >
            {isProcessesRunning ? (
              <Square className="w-3 h-3 fill-current" />
            ) : (
              <Play className="w-3 h-3 fill-current" />
            )}
            <span>{isProcessesRunning ? 'Stop all processes' : 'Start all processes'}</span>
          </button>
        </div>

        <div className="text-[11px] text-[#9CA195] flex items-center gap-3 font-mono">
          <span>Target ID: <strong className="text-[#F0FFEA]">#{target?.target_id ?? 1}</strong></span>
          <span className="text-[#33362F]">|</span>
          <span>Depth: <strong className="text-[#FF5F40]">{target?.world_z.toFixed(0)} m</strong></span>
        </div>
      </div>

      {/* Main Viewports */}
      {viewMode === 'dual' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="min-h-[520px] rounded-lg overflow-hidden border border-[#33362F] bg-[#000000]">
            <VirtualSceneCanvas
              target={telemetry?.target ?? null}
              targets={telemetry?.targets ?? []}
              camera={telemetry?.camera ?? null}
              disturbance={telemetry?.disturbance ?? null}
              worldWidth={config?.motion.screen_width ?? 2000}
              worldHeight={config?.motion.screen_height ?? 2000}
            />
          </div>

          <div className="h-full rounded-lg overflow-hidden border border-[#33362F] bg-[#000000]">
            <FPACameraViewport
              target={telemetry?.target ?? null}
              camera={telemetry?.camera ?? null}
              tracking={telemetry?.tracking ?? null}
              detection={telemetry?.detection ?? null}
              disturbance={telemetry?.disturbance ?? null}
              onGimbalNudge={onGimbalNudge}
              onGimbalAngles={onGimbalAngles}
            />
          </div>
        </div>
      )}

      {viewMode === '3d' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 min-h-[560px] rounded-lg overflow-hidden border border-[#33362F] bg-[#000000]">
            <Scene3DViewport
              target={telemetry?.target ?? null}
              targets={telemetry?.targets ?? []}
              camera={telemetry?.camera ?? null}
              disturbance={telemetry?.disturbance ?? null}
              worldWidth={config?.motion.screen_width ?? 2000}
              worldHeight={config?.motion.screen_height ?? 2000}
            />
          </div>

          <div className="h-full rounded-lg overflow-hidden border border-[#33362F] bg-[#000000]">
            <FPACameraViewport
              target={telemetry?.target ?? null}
              camera={telemetry?.camera ?? null}
              tracking={telemetry?.tracking ?? null}
              detection={telemetry?.detection ?? null}
              disturbance={telemetry?.disturbance ?? null}
              onGimbalNudge={onGimbalNudge}
              onGimbalAngles={onGimbalAngles}
            />
          </div>
        </div>
      )}

      {viewMode === '2d_camera' && (
        <div className="max-w-3xl mx-auto w-full rounded-lg overflow-hidden border border-[#33362F] bg-[#000000]">
          <FPACameraViewport
            target={telemetry?.target ?? null}
            camera={telemetry?.camera ?? null}
            tracking={telemetry?.tracking ?? null}
            detection={telemetry?.detection ?? null}
            disturbance={telemetry?.disturbance ?? null}
            onGimbalNudge={onGimbalNudge}
            onGimbalAngles={onGimbalAngles}
          />
        </div>
      )}

      {/* Target Kinematics Telemetry (Collapsible) */}
      <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowKinematics(!showKinematics)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-[#262824] hover:bg-[#33362F] transition text-left"
        >
          <span className="font-semibold text-xs text-[#F0FFEA] uppercase tracking-wider">
            Target 3D Kinematics Readout
          </span>
          <div className="flex items-center gap-2 text-[#9CA195]">
            <span className="text-[11px] font-mono">
              X: {target?.world_x.toFixed(1)}m • Y: {target?.world_y.toFixed(1)}m • Z: {target?.world_z.toFixed(0)}m
            </span>
            {showKinematics ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {showKinematics && (
          <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-[#33362F]">
            {/* Position */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-[#9CA195] pb-1 border-b border-[#33362F] uppercase tracking-wider">
                Position r(t)
              </div>
              <div className="flex justify-between font-mono text-xs">
                <span className="text-[#9CA195]">X (Azimuth):</span>
                <span className="text-[#F0FFEA] font-medium">{target?.world_x.toFixed(2)} m</span>
              </div>
              <div className="flex justify-between font-mono text-xs">
                <span className="text-[#9CA195]">Y (Elevation):</span>
                <span className="text-[#F0FFEA] font-medium">{target?.world_y.toFixed(2)} m</span>
              </div>
              <div className="flex justify-between font-mono text-xs">
                <span className="text-[#9CA195]">Z (Range Depth):</span>
                <span className="text-[#F0FFEA] font-medium">{target?.world_z.toFixed(2)} m</span>
              </div>
            </div>

            {/* Velocity */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-[#9CA195] pb-1 border-b border-[#33362F] uppercase tracking-wider">
                Velocity v(t)
              </div>
              <div className="flex justify-between font-mono text-xs">
                <span className="text-[#9CA195]">Vx:</span>
                <span className="text-[#F0FFEA] font-medium">{target?.velocity_x.toFixed(2)} m/s</span>
              </div>
              <div className="flex justify-between font-mono text-xs">
                <span className="text-[#9CA195]">Vy:</span>
                <span className="text-[#F0FFEA] font-medium">{target?.velocity_y.toFixed(2)} m/s</span>
              </div>
              <div className="flex justify-between font-mono text-xs">
                <span className="text-[#9CA195]">Vz:</span>
                <span className="text-[#F0FFEA] font-medium">{target?.velocity_z.toFixed(2)} m/s</span>
              </div>
            </div>

            {/* Acceleration */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-[#9CA195] pb-1 border-b border-[#33362F] uppercase tracking-wider">
                Acceleration a(t)
              </div>
              <div className="flex justify-between font-mono text-xs">
                <span className="text-[#9CA195]">Ax:</span>
                <span className="text-[#FF5F40] font-medium">{target?.acceleration_x.toFixed(2)} m/s²</span>
              </div>
              <div className="flex justify-between font-mono text-xs">
                <span className="text-[#9CA195]">Ay:</span>
                <span className="text-[#FF5F40] font-medium">{target?.acceleration_y.toFixed(2)} m/s²</span>
              </div>
              <div className="flex justify-between font-mono text-xs">
                <span className="text-[#9CA195]">Az:</span>
                <span className="text-[#FF5F40] font-medium">{target?.acceleration_z.toFixed(2)} m/s²</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Beacon Velocity Control */}
      <BeaconSpeedControl
        currentSpeed={localSpeed}
        onSpeedChange={applySpeed}
        speedApplied={speedApplied}
      />

      {/* Real-time Tracking Performance Chart */}
      <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-3">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#33362F]">
          <span className="font-semibold text-xs text-[#F0FFEA] uppercase tracking-wider">
            Real-Time Tracking Error History (FPA Centroid Distance)
          </span>
          <span className="text-[11px] text-[#9CA195] font-mono">
            Lock Limit: ≤ {config?.performance.max_tracking_error_pixels ?? 10} px
          </span>
        </div>
        <div className="h-44">
          <TelemetryChart
            data={errorHistory}
            maxThreshold={config?.performance.max_tracking_error_pixels ?? 10}
          />
        </div>
      </div>
    </div>
  );
};
