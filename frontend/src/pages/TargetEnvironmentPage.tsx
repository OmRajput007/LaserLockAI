import React, { useRef, useEffect, useState } from 'react';
import { SimulationTelemetry, SystemConfig } from '../types';
import { api } from '../services/api';
import {
  Target,
  Move,
  Sun,
  Crosshair,
  Sparkles,
  Play,
  Pause,
  RotateCcw,
  Compass,
  PenTool,
  CheckCircle,
  Trash2,
  XCircle,
  Maximize2,
} from 'lucide-react';

interface Props {
  telemetry: SimulationTelemetry | null;
  config: SystemConfig | null;
  onUpdateConfig: (updater: (prev: SystemConfig) => SystemConfig) => void;
  onSelectMotion: (pattern: string) => void;
  onSelectShape: (shape: 'Square' | 'Circle' | 'Gaussian') => void;
  onToggleSim: (running: boolean) => void;
  onResetSim: () => void;
}

export const TargetEnvironmentPage: React.FC<Props> = ({
  telemetry,
  config,
  onUpdateConfig,
  onSelectMotion,
  onSelectShape,
  onToggleSim,
  onResetSim,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Custom path drawing state
  const [drawMode, setDrawMode] = useState(false);
  const [customWaypoints, setCustomWaypoints] = useState<[number, number][]>([]);
  const [submitting, setSubmitting] = useState(false);

  const target = telemetry?.target;
  const camera = telemetry?.camera;
  const isRunning = telemetry?.is_running ?? false;

  const currentShape = config?.target.shape || 'Circle';
  const currentMotion = config?.motion.trajectory_type || 'Circular';
  const currentSpeed = config?.motion.speed_pixels_per_s ?? 60;
  const currentSize = config?.target.size_pixels ?? 10;
  const currentIntensity = config?.target.intensity ?? 255;
  const flickerEnabled = config?.target.flicker_enabled ?? false;
  const flickerFreq = config?.target.flicker_frequency_hz ?? 10.0;

  // Render the interactive 2000x2000 environment radar
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const scale = w / 2000; // Map 2000x2000 space to canvas width/height

    // Background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    // Draw coordinate grid (every 250 pixels in world space)
    ctx.strokeStyle = '#262824';
    ctx.lineWidth = 1;
    for (let x = 0; x <= 2000; x += 250) {
      ctx.beginPath();
      ctx.moveTo(x * scale, 0);
      ctx.lineTo(x * scale, h);
      ctx.stroke();
    }
    for (let y = 0; y <= 2000; y += 250) {
      ctx.beginPath();
      ctx.moveTo(0, y * scale);
      ctx.lineTo(w, y * scale);
      ctx.stroke();
    }

    // Origin / Center crosshair (1000, 1000)
    ctx.strokeStyle = '#33362F';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(1000 * scale, 0);
    ctx.lineTo(1000 * scale, h);
    ctx.moveTo(0, 1000 * scale);
    ctx.lineTo(w, 1000 * scale);
    ctx.stroke();

    // Center label
    ctx.fillStyle = '#9CA195';
    ctx.font = '9px monospace';
    ctx.fillText('WORLD CENTER (1000, 1000)', 1005 * scale, 995 * scale);

    // Camera FOV Footprint
    if (camera) {
      // Camera pan/tilt maps to center position on virtual screen
      const camX = 1000 + (camera.pan_deg / 4.0) * 640;
      const camY = 1000 - (camera.tilt_deg / 3.0) * 480;
      const fovW = 640 * scale;
      const fovH = 480 * scale;
      const fovX = (camX * scale) - fovW / 2;
      const fovY = (camY * scale) - fovH / 2;

      // Draw FOV boundary box
      ctx.strokeStyle = '#FF5F40';
      ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(255, 95, 64, 0.08)';
      ctx.fillRect(fovX, fovY, fovW, fovH);
      ctx.strokeRect(fovX, fovY, fovW, fovH);

      // Camera center crosshair
      ctx.strokeStyle = '#FF5F40';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(camX * scale - 8, camY * scale);
      ctx.lineTo(camX * scale + 8, camY * scale);
      ctx.moveTo(camX * scale, camY * scale - 8);
      ctx.lineTo(camX * scale, camY * scale + 8);
      ctx.stroke();

      ctx.fillStyle = '#FF5F40';
      ctx.font = '9px monospace';
      ctx.fillText(`CAM BORESIGHT (${Math.round(camX)}, ${Math.round(camY)})`, fovX + 4, fovY + 12);
    }

    // Moving Target
    if (target) {
      const tx = target.world_x * scale;
      const ty = target.world_y * scale;
      const r = Math.max(3, (currentSize * scale) / 2);

      // Historical trajectory trail
      if (target.trajectory_trail && target.trajectory_trail.length > 1) {
        ctx.strokeStyle = target.is_in_fov ? 'rgba(255, 95, 64, 0.6)' : 'rgba(156, 161, 149, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < target.trajectory_trail.length; i++) {
          const pt = target.trajectory_trail[i];
          const px = pt[0] * scale;
          const py = pt[1] * scale;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      // Pulsing outer halo
      ctx.beginPath();
      ctx.arc(tx, ty, r * 3, 0, Math.PI * 2);
      ctx.fillStyle = target.is_in_fov ? 'rgba(255, 95, 64, 0.2)' : 'rgba(94, 98, 90, 0.2)';
      ctx.fill();

      // Beacon body
      ctx.beginPath();
      if (currentShape === 'Square') {
        ctx.rect(tx - r, ty - r, r * 2, r * 2);
      } else {
        ctx.arc(tx, ty, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = target.is_in_fov ? '#FF5F40' : '#9CA195';
      ctx.shadowColor = target.is_in_fov ? '#FF5F40' : '#9CA195';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Target coordinate label
      ctx.fillStyle = '#F0FFEA';
      ctx.font = '10px monospace';
      ctx.fillText(
        `TARGET: (${Math.round(target.world_x)}, ${Math.round(target.world_y)}) [${target.is_in_fov ? 'IN FOV' : 'LOST'}]`,
        tx + 12,
        ty - 4
      );

      // Velocity vector
      if (target.velocity_x !== undefined && target.velocity_y !== undefined) {
        ctx.strokeStyle = '#F0FFEA';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + (target.velocity_x * scale) * 0.8, ty + (target.velocity_y * scale) * 0.8);
        ctx.stroke();
      }
    }

    // Custom path preview overlay
    if (drawMode && customWaypoints.length > 0) {
      const pts = customWaypoints.map(([wx, wy]) => [wx * scale, wy * scale]);

      // Drawn segments
      ctx.strokeStyle = '#FF5F40';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      pts.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Closing segment (dashed)
      if (customWaypoints.length > 1) {
        ctx.strokeStyle = '#FF5F40';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        ctx.lineTo(pts[0][0], pts[0][1]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Waypoint dots
      pts.forEach(([px, py], i) => {
        ctx.beginPath();
        ctx.arc(px, py, i === 0 ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#FF5F40' : '#262824';
        ctx.fill();
        ctx.strokeStyle = '#FF5F40';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Index label
        ctx.fillStyle = '#F0FFEA';
        ctx.font = 'bold 9px monospace';
        ctx.fillText(String(i + 1), px + 6, py - 4);
      });
    }
  }, [target, camera, currentSize, currentShape, drawMode, customWaypoints]);

  // Click on canvas: place waypoint in draw mode, or teleport target in normal mode
  const handleCanvasClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const worldX = Math.round((clickX / canvas.clientWidth) * 2000);
    const worldY = Math.round((clickY / canvas.clientHeight) * 2000);

    if (drawMode) {
      setCustomWaypoints(prev => [...prev, [worldX, worldY]]);
      return;
    }

    try {
      await api.setTargetPosition(worldX, worldY);
    } catch (err) {
      console.error('Failed to set target position:', err);
    }
  };

  const handleActivateCustomPath = async () => {
    if (customWaypoints.length < 2) return;
    setSubmitting(true);
    try {
      await api.setCustomPath(customWaypoints, currentSpeed || 60);
      onSelectMotion('Custom Path');
      setDrawMode(false);
    } catch (err) {
      console.error('Failed to activate custom path:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClearPath = () => {
    setCustomWaypoints([]);
  };

  const handleCenterTarget = async () => {
    try {
      await api.setTargetPosition(1000, 1000);
    } catch (err) {
      console.error('Failed to center target:', err);
    }
  };

  const handleDisplaceOutsideFov = async () => {
    try {
      await api.setTargetPosition(1500, 400);
    } catch (err) {
      console.error('Failed to displace target:', err);
    }
  };

  return (
    <div className="flex flex-col gap-4 font-mono text-xs text-[#F0FFEA]">
      {/* Header bar */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-4 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-[#262824] border border-[#33362F] flex items-center justify-center">
            <Target className="w-5 h-5 text-[#FF5F40]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#F0FFEA]">
              Target & Optical Environment
            </h2>
            <p className="text-[#9CA195] text-[11px]">
              2000×2000 Virtual Coordinate Space • Kinematic Trajectories • Optical Spot Characteristics
            </p>
          </div>
        </div>

        {/* Global Sim Control Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggleSim(!isRunning)}
            className={`px-3 py-1.5 rounded text-xs font-bold transition flex items-center gap-1.5 border uppercase tracking-wider ${
              isRunning
                ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] shadow'
                : 'bg-[#262824] text-[#F0FFEA] border-[#33362F] hover:border-[#FF5F40]/50'
            }`}
          >
            {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isRunning ? 'Pause Sim' : 'Run Sim'}
          </button>
          <button
            onClick={onResetSim}
            className="px-3 py-1.5 bg-[#262824] hover:bg-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] rounded border border-[#33362F] flex items-center gap-1.5 transition text-xs font-medium"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#FF5F40]" /> Reset
          </button>
        </div>
      </div>

      {/* Main Grid: Radar Canvas on Left, Controls on Right */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left Column: 2000x2000 Interactive Arena Canvas (7 cols) */}
        <div className="xl:col-span-7 bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-[#33362F] pb-3">
            <div className="flex items-center gap-2 text-[#F0FFEA] font-semibold text-xs uppercase tracking-wider">
              <Compass className="w-4 h-4 text-[#FF5F40]" />
              <span>Virtual Screen Space (2000 × 2000)</span>
            </div>
            <span className="text-[11px] text-[#9CA195]">Click canvas to reposition beacon</span>
          </div>

          {/* Canvas Viewport */}
          <div className="relative w-full aspect-square bg-[#000000] rounded border border-[#33362F] overflow-hidden flex items-center justify-center cursor-crosshair">
            <canvas
              ref={canvasRef}
              width={700}
              height={700}
              onClick={handleCanvasClick}
              className="w-full h-full object-contain"
            />
            {drawMode && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-[#1B1D1A]/95 border border-[#FF5F40] text-[#FF5F40] text-[11px] font-mono px-3 py-1 rounded shadow-md pointer-events-none font-bold">
                Draw Mode: Click to add waypoints ({customWaypoints.length} placed)
              </div>
            )}
          </div>

          {/* Draw Mode Controls */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#33362F]">
            {!drawMode ? (
              <button
                onClick={() => { setDrawMode(true); setCustomWaypoints([]); }}
                className="px-2.5 py-1.5 rounded bg-[#262824] hover:bg-[#FF5F40]/15 text-[#FF5F40] border border-[#33362F] hover:border-[#FF5F40]/50 text-xs flex items-center gap-1.5 font-bold transition uppercase tracking-wider"
              >
                <PenTool className="w-3.5 h-3.5 text-[#FF5F40]" /> Draw Custom Path
              </button>
            ) : (
              <>
                <button
                  onClick={handleActivateCustomPath}
                  disabled={customWaypoints.length < 2 || submitting}
                  className="px-2.5 py-1.5 rounded bg-[#FF5F40] hover:bg-[#FF7459] text-[#0A0A0A] border border-[#FF5F40] text-xs flex items-center gap-1.5 font-bold transition disabled:opacity-40 disabled:cursor-not-allowed uppercase tracking-wider"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  {submitting ? 'Activating…' : `Activate Loop Path (${customWaypoints.length} pts)`}
                </button>
                <button
                  onClick={handleClearPath}
                  className="px-2.5 py-1.5 rounded bg-[#262824] hover:bg-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] border border-[#33362F] text-xs flex items-center gap-1.5 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear
                </button>
                <button
                  onClick={() => { setDrawMode(false); setCustomWaypoints([]); }}
                  className="px-2.5 py-1.5 rounded bg-[#262824] hover:bg-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] border border-[#33362F] text-xs flex items-center gap-1.5 transition"
                >
                  <XCircle className="w-3.5 h-3.5" /> Cancel
                </button>
                <span className="text-[11px] text-[#9CA195] ml-1">Minimum 2 points; loop auto-closes</span>
              </>
            )}
          </div>

          {/* Quick Reposition Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#33362F]">
            <div className="flex items-center gap-2">
              <button
                onClick={handleCenterTarget}
                className="px-2.5 py-1.5 rounded bg-[#262824] hover:bg-[#FF5F40]/20 text-[#F0FFEA] border border-[#33362F] text-xs flex items-center gap-1.5 font-medium transition"
              >
                <Crosshair className="w-3.5 h-3.5 text-[#FF5F40]" /> Center Target (1000, 1000)
              </button>
              <button
                onClick={handleDisplaceOutsideFov}
                className="px-2.5 py-1.5 rounded bg-[#262824] hover:bg-[#FF5F40]/15 text-[#FF5F40] border border-[#33362F] text-xs flex items-center gap-1.5 font-medium transition"
              >
                <Maximize2 className="w-3.5 h-3.5 text-[#FF5F40]" /> Displace Outside FOV
              </button>
            </div>
            <div className="text-xs text-[#9CA195]">
              Status:{' '}
              <span
                className={`font-bold ${
                  target?.is_in_fov ? 'text-[#FF5F40]' : 'text-[#9CA195]'
                }`}
              >
                {target?.is_in_fov ? '✓ In Field of View' : '✕ Outside Field of View'}
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Controls & Parameters (5 cols) */}
        <div className="xl:col-span-5 flex flex-col gap-4">
          {/* Target Spot Geometry Card */}
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[#F0FFEA] font-semibold text-xs border-b border-[#33362F] pb-2 uppercase tracking-wider">
              <Sun className="w-4 h-4 text-[#FF5F40]" />
              <span>Optical Beacon Spot Profile</span>
            </div>

            {/* Shape selection */}
            <div>
              <label className="text-[11px] text-[#9CA195] block mb-1.5">Beacon Geometry Shape</label>
              <div className="grid grid-cols-3 gap-2">
                {(['Square', 'Circle', 'Gaussian'] as const).map((shape) => (
                  <button
                    key={shape}
                    onClick={() => onSelectShape(shape)}
                    className={`py-1.5 px-2 rounded text-xs border flex items-center justify-center gap-1.5 transition font-mono ${
                      currentShape === shape
                        ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] font-bold'
                        : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
                    }`}
                  >
                    <Sparkles className="w-3 h-3" /> {shape}
                  </button>
                ))}
              </div>
            </div>

            {/* Size Slider */}
            <div>
              <div className="flex justify-between text-[11px] text-[#9CA195] mb-1">
                <span>Spot Size</span>
                <span className="text-[#F0FFEA] font-bold font-mono">{currentSize} px (Req: 10×10 default)</span>
              </div>
              <input
                type="range"
                min="4"
                max="40"
                step="1"
                value={currentSize}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  onUpdateConfig((prev) => ({
                    ...prev,
                    target: { ...prev.target, size_pixels: val },
                  }));
                }}
                className="w-full h-1.5 bg-[#262824] rounded appearance-none cursor-pointer accent-[#FF5F40]"
              />
            </div>

            {/* Optical Intensity Slider */}
            <div>
              <div className="flex justify-between text-[11px] text-[#9CA195] mb-1">
                <span>Peak Optical Irradiance / Intensity</span>
                <span className="text-[#F0FFEA] font-bold font-mono">{currentIntensity} / 255</span>
              </div>
              <input
                type="range"
                min="50"
                max="255"
                step="5"
                value={currentIntensity}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  onUpdateConfig((prev) => ({
                    ...prev,
                    target: { ...prev.target, intensity: val },
                  }));
                }}
                className="w-full h-1.5 bg-[#262824] rounded appearance-none cursor-pointer accent-[#FF5F40]"
              />
            </div>

            {/* Optical Wavelength Standard */}
            <div className="pt-2 border-t border-[#33362F] flex items-center justify-between text-[11px]">
              <span className="text-[#9CA195]">Laser Optical Wavelength</span>
              <span className="px-2 py-0.5 rounded bg-[#262824] text-[#F0FFEA] border border-[#33362F] font-mono">
                850 nm / 1550 nm Telecom
              </span>
            </div>

            {/* Modulation / Flicker Controls */}
            <div className="pt-2 border-t border-[#33362F] flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[#F0FFEA] text-xs font-medium">Beacon Flicker Modulation</span>
                <input
                  type="checkbox"
                  checked={flickerEnabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    onUpdateConfig((prev) => ({
                      ...prev,
                      target: { ...prev.target, flicker_enabled: checked },
                    }));
                  }}
                  className="rounded bg-[#262824] border-[#33362F] text-[#FF5F40] focus:ring-0 cursor-pointer accent-[#FF5F40]"
                />
              </div>

              {flickerEnabled && (
                <div>
                  <div className="flex justify-between text-[11px] text-[#9CA195] mb-1">
                    <span>Modulation Frequency</span>
                    <span className="text-[#FF5F40] font-bold font-mono">{flickerFreq} Hz</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="30"
                    step="1"
                    value={flickerFreq}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      onUpdateConfig((prev) => ({
                        ...prev,
                        target: { ...prev.target, flicker_frequency_hz: val },
                      }));
                    }}
                    className="w-full h-1.5 bg-[#262824] rounded appearance-none cursor-pointer accent-[#FF5F40]"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Kinematic Trajectory & Motion Card */}
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[#F0FFEA] font-semibold text-xs border-b border-[#33362F] pb-2 uppercase tracking-wider">
              <Move className="w-4 h-4 text-[#FF5F40]" />
              <span>Kinematic Trajectory Pattern</span>
            </div>

            {/* Trajectory buttons */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'Straight Line', label: 'Straight Line' },
                { id: 'Circular', label: 'Circular' },
                { id: 'Figure of 8', label: 'Figure of 8' },
                { id: 'Random', label: 'Random Walk' },
                { id: 'Spiral', label: 'Spiral' },
                { id: 'Sinusoidal', label: 'Sinusoidal' },
                { id: 'Custom Path', label: 'Custom Path' },
              ].map((item) => {
                const isSelected = (item.id === 'Custom Path' && drawMode) || ((currentMotion as string) === item.id && item.id !== 'Custom Path');
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.id === 'Custom Path') {
                        setDrawMode(true);
                        setCustomWaypoints([]);
                      } else {
                        onSelectMotion(item.id);
                        setDrawMode(false);
                      }
                    }}
                    className={`py-1.5 px-2.5 rounded text-xs border text-left flex items-center justify-between transition font-mono ${
                      isSelected
                        ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] font-bold'
                        : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
                    }`}
                  >
                    <span>{item.label}</span>
                    {isSelected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0A]" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Motion Speed Slider */}
            <div className="mt-1">
              <div className="flex justify-between text-[11px] text-[#9CA195] mb-1">
                <span>Target Velocity</span>
                <span className="text-[#FF5F40] font-bold font-mono">{currentSpeed} px/sec</span>
              </div>
              <input
                type="range"
                min="0"
                max="250"
                step="5"
                value={currentSpeed}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  onUpdateConfig((prev) => ({
                    ...prev,
                    motion: { ...prev.motion, speed_pixels_per_s: val },
                  }));
                }}
                className="w-full h-1.5 bg-[#262824] rounded appearance-none cursor-pointer accent-[#FF5F40]"
              />
            </div>

            {/* Live Kinematic Telemetry */}
            <div className="mt-2 p-3 rounded bg-[#262824]/60 border border-[#33362F] grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-[#9CA195] text-[11px] block">Position (X, Y)</span>
                <div className="text-[#F0FFEA] font-bold font-mono">
                  {target ? `${Math.round(target.world_x)}, ${Math.round(target.world_y)}` : 'N/A'}
                </div>
              </div>
              <div>
                <span className="text-[#9CA195] text-[11px] block">Velocity (Vx, Vy)</span>
                <div className="text-[#FF5F40] font-bold font-mono">
                  {target && target.velocity_x !== undefined
                    ? `${Math.round(target.velocity_x)}, ${Math.round(target.velocity_y)} px/s`
                    : 'N/A'}
                </div>
              </div>
              <div>
                <span className="text-[#9CA195] text-[11px] block">Screen Arena</span>
                <div className="text-[#F0FFEA] font-mono">2000 × 2000 px</div>
              </div>
              <div>
                <span className="text-[#9CA195] text-[11px] block">Camera FoV Size</span>
                <div className="text-[#F0FFEA] font-mono">640 × 480 px (4°×3°)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
