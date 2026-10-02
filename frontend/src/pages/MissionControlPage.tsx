import React, { useState, useCallback } from 'react';
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
  const [viewMode, setViewMode] = [settings.missionViewMode, bindSetting('missionViewMode')];
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

  return (
    <div className="flex flex-col gap-4 font-sans text-xs text-slate-200">
      {/* Top Telemetry Cockpit Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Mission Status */}
        <div className="bg-[#0A0D10] border border-[#1F2429] p-3 rounded-lg flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium">Mission Status</span>
          <div className="flex items-center gap-2 my-1">
            <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-500' : 'bg-slate-500'}`} />
            <span className="font-semibold text-sm text-slate-100">
              {isRunning ? 'Active Run' : 'Standby'}
            </span>
          </div>
          <span className="text-[11px] text-slate-500 num-mono">
            Sim Time: {telemetry?.simulation_time_s.toFixed(2)}s
          </span>
        </div>

        {/* Target Visibility */}
        <div className="bg-[#0A0D10] border border-[#1F2429] p-3 rounded-lg flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium">Target Visibility</span>
          <div className="flex items-center gap-2 my-1">
            <span className={`w-2 h-2 rounded-full ${inFov ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            <span className={`font-semibold text-sm ${inFov ? 'text-emerald-400' : 'text-rose-400'}`}>
              {inFov ? 'Inside FOV' : 'Outside FOV'}
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            {isLocked ? 'Locked (≤ 10 px)' : inFov ? 'Acquired in Sensor' : 'Searching Target'}
          </span>
        </div>

        {/* Tracking Error */}
        <div className="bg-[#0A0D10] border border-[#1F2429] p-3 rounded-lg flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium">Tracking Error</span>
          <div className="flex items-baseline gap-1 my-1">
            <span className={`font-semibold text-xl num-mono ${
              telemetry?.tracking.total_error_px !== null && (telemetry?.tracking.total_error_px ?? 99) <= 10
                ? 'text-emerald-400'
                : 'text-amber-400'
            }`}>
              {telemetry?.tracking.total_error_px !== null ? telemetry?.tracking.total_error_px.toFixed(2) : '--'}
            </span>
            <span className="text-xs text-slate-400">px</span>
          </div>
          <span className="text-[11px] text-slate-500 num-mono">Gate Limit: ≤ 10.0 px</span>
        </div>

        {/* Gimbal Orientation */}
        <div className="bg-[#0A0D10] border border-[#1F2429] p-3 rounded-lg flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium">Gimbal Angles</span>
          <div className="flex items-center gap-2 my-1 text-sm num-mono text-slate-200">
            <span>P: <strong className="text-slate-100 font-medium">{telemetry?.camera.pan_deg.toFixed(1)}°</strong></span>
            <span>•</span>
            <span>T: <strong className="text-slate-100 font-medium">{telemetry?.camera.tilt_deg.toFixed(1)}°</strong></span>
          </div>
          <span className="text-[11px] text-slate-500 num-mono">Max Slew: 5.0°/s</span>
        </div>

        {/* Target Shape */}
        <div className="bg-[#0A0D10] border border-[#1F2429] p-3 rounded-lg flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium">Beacon Shape</span>
          <div className="relative my-1">
            <select
              value={config?.target.shape ?? 'Gaussian'}
              onChange={(e) => onSelectShape(e.target.value as 'Square' | 'Circle' | 'Gaussian')}
              className="w-full bg-[#12161A] border border-[#1F2429] hover:border-[#2D3237] text-slate-200 text-xs px-2.5 py-1.5 rounded font-medium appearance-none pr-7 cursor-pointer focus:outline-none focus:border-[#3A4048] transition"
            >
              <option value="Gaussian" className="bg-[#12161A] text-slate-200">Gaussian</option>
              <option value="Square" className="bg-[#12161A] text-slate-200">Square</option>
              <option value="Circle" className="bg-[#12161A] text-slate-200">Circle</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2 pointer-events-none" />
          </div>
          <span className="text-[11px] text-slate-500 num-mono">Profile: {config?.target.size_pixels ?? 10}×{config?.target.size_pixels ?? 10} px</span>
        </div>

        {/* Quick Simulation Controls */}
        <div className="bg-[#0A0D10] border border-[#1F2429] p-3 rounded-lg flex items-center justify-center gap-2">
          <button
            onClick={() => onToggleSim(!isRunning)}
            className={`flex-1 py-2 px-3 rounded-md font-medium text-xs flex items-center justify-center gap-1.5 transition ${
              isRunning
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isRunning ? 'Pause' : 'Run'}
          </button>
          <button
            onClick={onResetSim}
            className="p-2 bg-[#12161A] hover:bg-[#181D22] text-slate-400 hover:text-slate-200 rounded-md border border-[#1F2429] hover:border-[#2D3237] transition"
            title="Reset Simulation State"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Viewport Mode Switcher */}
      <div className="flex items-center justify-between bg-[#0A0D10] px-3 py-2 rounded-lg border border-[#1F2429] text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-medium">Viewport:</span>
          <button
            onClick={() => setViewMode('dual')}
            className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 ${
              viewMode === 'dual'
                ? 'bg-[#181D22] text-white border border-[#2D3237]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#12161A]'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-slate-400" /> Dual (2D + Camera)
          </button>
          <button
            onClick={() => setViewMode('3d')}
            className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 ${
              viewMode === '3d'
                ? 'bg-[#181D22] text-white border border-[#2D3237]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#12161A]'
            }`}
          >
            <Box className="w-3.5 h-3.5 text-slate-400" /> 3D Virtual Scene
          </button>
          <button
            onClick={() => setViewMode('2d_camera')}
            className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 ${
              viewMode === '2d_camera'
                ? 'bg-[#181D22] text-white border border-[#2D3237]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#12161A]'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5 text-slate-400" /> 2D Camera Only
          </button>
        </div>

        <div className="text-[11px] text-slate-400 flex items-center gap-3 num-mono">
          <span>Target ID: <strong className="text-slate-200">#{target?.target_id ?? 1}</strong></span>
          <span className="text-slate-600">|</span>
          <span>Depth: <strong className="text-[#D6D9DC]">{target?.world_z.toFixed(0)} m</strong></span>
        </div>
      </div>

      {/* Main Viewports */}
      {viewMode === 'dual' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="min-h-[520px] rounded-lg overflow-hidden border border-[#1F2429] bg-[#06080B]">
            <VirtualSceneCanvas
              target={telemetry?.target ?? null}
              targets={telemetry?.targets ?? []}
              camera={telemetry?.camera ?? null}
              disturbance={telemetry?.disturbance ?? null}
              worldWidth={config?.motion.screen_width ?? 2000}
              worldHeight={config?.motion.screen_height ?? 2000}
            />
          </div>

          <div className="h-full rounded-lg overflow-hidden border border-[#1F2429] bg-[#06080B]">
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
          <div className="lg:col-span-2 min-h-[560px] rounded-lg overflow-hidden border border-[#1F2429] bg-[#06080B]">
            <Scene3DViewport
              target={telemetry?.target ?? null}
              targets={telemetry?.targets ?? []}
              camera={telemetry?.camera ?? null}
              disturbance={telemetry?.disturbance ?? null}
              worldWidth={config?.motion.screen_width ?? 2000}
              worldHeight={config?.motion.screen_height ?? 2000}
            />
          </div>

          <div className="h-full rounded-lg overflow-hidden border border-[#1F2429] bg-[#06080B]">
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
        <div className="max-w-3xl mx-auto w-full rounded-lg overflow-hidden border border-[#1F2429] bg-[#06080B]">
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
      <div className="bg-[#0A0D10] border border-[#1F2429] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowKinematics(!showKinematics)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-[#12161A] hover:bg-[#181D22] transition text-left"
        >
          <span className="font-semibold text-xs text-slate-200">
            Target 3D Kinematics Readout
          </span>
          <div className="flex items-center gap-2 text-slate-400">
            <span className="text-[11px] num-mono">
              X: {target?.world_x.toFixed(1)}m • Y: {target?.world_y.toFixed(1)}m • Z: {target?.world_z.toFixed(0)}m
            </span>
            {showKinematics ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {showKinematics && (
          <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-[#1F2429]">
            {/* Position */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300 pb-1 border-b border-[#1F2429]">
                Position r(t)
              </div>
              <div className="flex justify-between num-mono text-xs">
                <span className="text-slate-400">X (Azimuth):</span>
                <span className="text-slate-100 font-medium">{target?.world_x.toFixed(2)} m</span>
              </div>
              <div className="flex justify-between num-mono text-xs">
                <span className="text-slate-400">Y (Elevation):</span>
                <span className="text-slate-100 font-medium">{target?.world_y.toFixed(2)} m</span>
              </div>
              <div className="flex justify-between num-mono text-xs">
                <span className="text-slate-400">Z (Range Depth):</span>
                <span className="text-slate-100 font-medium">{target?.world_z.toFixed(2)} m</span>
              </div>
            </div>

            {/* Velocity */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300 pb-1 border-b border-[#1F2429]">
                Velocity v(t)
              </div>
              <div className="flex justify-between num-mono text-xs">
                <span className="text-slate-400">Vx:</span>
                <span className="text-[#E8EAED] font-medium">{target?.velocity_x.toFixed(2)} m/s</span>
              </div>
              <div className="flex justify-between num-mono text-xs">
                <span className="text-slate-400">Vy:</span>
                <span className="text-[#E8EAED] font-medium">{target?.velocity_y.toFixed(2)} m/s</span>
              </div>
              <div className="flex justify-between num-mono text-xs">
                <span className="text-slate-400">Vz:</span>
                <span className="text-[#E8EAED] font-medium">{target?.velocity_z.toFixed(2)} m/s</span>
              </div>
            </div>

            {/* Acceleration */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300 pb-1 border-b border-[#1F2429]">
                Acceleration a(t)
              </div>
              <div className="flex justify-between num-mono text-xs">
                <span className="text-slate-400">Ax:</span>
                <span className="text-amber-300 font-medium">{target?.acceleration_x.toFixed(2)} m/s²</span>
              </div>
              <div className="flex justify-between num-mono text-xs">
                <span className="text-slate-400">Ay:</span>
                <span className="text-amber-300 font-medium">{target?.acceleration_y.toFixed(2)} m/s²</span>
              </div>
              <div className="flex justify-between num-mono text-xs">
                <span className="text-slate-400">Az:</span>
                <span className="text-amber-300 font-medium">{target?.acceleration_z.toFixed(2)} m/s²</span>
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
      <div className="bg-[#0A0D10] border border-[#1F2429] rounded-lg p-3">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#1F2429]">
          <span className="font-semibold text-xs text-slate-200">
            Real-Time Tracking Error History (FPA Centroid Distance)
          </span>
          <span className="text-[11px] text-slate-400 num-mono">
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
