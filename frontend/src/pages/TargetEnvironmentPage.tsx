import React, { useRef, useEffect, useState } from 'react';
import { SimulationTelemetry, SystemConfig } from '../types';
import { api } from '../services/api';
import {
  Target,
  Move,
  Sun,
  Radio,
  Sliders,
  Maximize2,
  Minimize2,
  RefreshCw,
  Crosshair,
  Sparkles,
  Zap,
  Play,
  RotateCcw,
  Compass,
  PenTool,
  CheckCircle,
  Trash2,
  XCircle,
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
    ctx.fillStyle = '#060911';
    ctx.fillRect(0, 0, w, h);

    // Draw coordinate grid (every 250 pixels in world space)
    ctx.strokeStyle = '#141e33';
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
    ctx.strokeStyle = '#223254';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(1000 * scale, 0);
    ctx.lineTo(1000 * scale, h);
    ctx.moveTo(0, 1000 * scale);
    ctx.lineTo(w, 1000 * scale);
    ctx.stroke();

    // Center label
    ctx.fillStyle = '#475569';
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
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(6, 182, 212, 0.07)';
      ctx.fillRect(fovX, fovY, fovW, fovH);
      ctx.strokeRect(fovX, fovY, fovW, fovH);

      // Camera center crosshair
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(camX * scale - 8, camY * scale);
      ctx.lineTo(camX * scale + 8, camY * scale);
      ctx.moveTo(camX * scale, camY * scale - 8);
      ctx.lineTo(camX * scale, camY * scale + 8);
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
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
        ctx.strokeStyle = target.is_in_fov ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)';
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
      ctx.fillStyle = target.is_in_fov ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
      ctx.fill();

      // Beacon body
      ctx.beginPath();
      if (currentShape === 'Square') {
        ctx.rect(tx - r, ty - r, r * 2, r * 2);
      } else {
        ctx.arc(tx, ty, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = target.is_in_fov ? '#10b981' : '#ef4444';
      ctx.shadowColor = target.is_in_fov ? '#10b981' : '#ef4444';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Target coordinate label
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px monospace';
      ctx.fillText(
        `TARGET: (${Math.round(target.world_x)}, ${Math.round(target.world_y)}) [${target.is_in_fov ? 'IN FOV' : 'LOST'}]`,
        tx + 12,
        ty - 4
      );

      // Velocity vector
      if (target.velocity_x !== undefined && target.velocity_y !== undefined) {
        ctx.strokeStyle = '#facc15';
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
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      pts.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Closing segment (dashed)
      if (customWaypoints.length > 1) {
        ctx.strokeStyle = '#f59e0b';
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
        ctx.fillStyle = i === 0 ? '#10b981' : '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Index label
        ctx.fillStyle = '#fff';
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
    // Put target near edge away from center to test reacquisition
    try {
      await api.setTargetPosition(1500, 400);
    } catch (err) {
      console.error('Failed to displace target:', err);
    }
  };

  return (
    <div className="flex flex-col gap-4 font-mono text-xs">
      {/* Header bar */}
      <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-950/80 border border-emerald-700/60 flex items-center justify-center">
            <Target className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              5. Target & Optical Environment Configuration
            </h2>
            <p className="text-slate-400 text-[11px]">
              2000×2000 Virtual Coordinate Space • Kinematic Trajectories • Optical Spot Characteristics
            </p>
          </div>
        </div>

        {/* Global Sim Control Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggleSim(!isRunning)}
            className={`px-3 py-1.5 rounded font-bold transition flex items-center gap-1.5 ${
              isRunning
                ? 'bg-amber-950 text-amber-300 border border-amber-600 hover:bg-amber-900'
                : 'bg-emerald-950 text-emerald-300 border border-emerald-600 hover:bg-emerald-900'
            }`}
          >
            <Play className="w-3.5 h-3.5" /> {isRunning ? 'Pause Sim' : 'Run Sim'}
          </button>
          <button
            onClick={onResetSim}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 flex items-center gap-1.5 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
        </div>
      </div>

      {/* Main Grid: Radar Canvas on Left, Controls on Right */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left Column: 2000x2000 Interactive Arena Canvas (7 cols) */}
        <div className="xl:col-span-7 bg-slate-900/80 border border-slate-800 rounded-lg p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2 text-slate-200 font-bold">
              <Compass className="w-4 h-4 text-cyan-400" />
              <span>2000 × 2000 VIRTUAL SCREEN RADAR VIEW</span>
            </div>
            <span className="text-[10px] text-cyan-400/80">Click canvas to reposition beacon</span>
          </div>

          {/* Canvas Viewport */}
          <div className="relative w-full aspect-square bg-[#060911] rounded border border-slate-800 overflow-hidden flex items-center justify-center cursor-crosshair">
            <canvas
              ref={canvasRef}
              width={700}
              height={700}
              onClick={handleCanvasClick}
              className="w-full h-full object-contain"
            />
            {drawMode && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-amber-950/90 border border-amber-600 text-amber-300 text-[11px] font-mono px-3 py-1 rounded-full pointer-events-none">
                ✏️ DRAW MODE — Click canvas to place waypoints ({customWaypoints.length} placed)
              </div>
            )}
          </div>

          {/* Draw Mode Controls */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60">
            {!drawMode ? (
              <button
                onClick={() => { setDrawMode(true); setCustomWaypoints([]); }}
                className="px-2.5 py-1 rounded bg-amber-950/70 hover:bg-amber-900 text-amber-300 border border-amber-700 text-[11px] flex items-center gap-1.5 font-bold transition"
              >
                <PenTool className="w-3.5 h-3.5" /> Draw Custom Path
              </button>
            ) : (
              <>
                <button
                  onClick={handleActivateCustomPath}
                  disabled={customWaypoints.length < 2 || submitting}
                  className="px-2.5 py-1 rounded bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-600 text-[11px] flex items-center gap-1.5 font-bold transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  {submitting ? 'Activating…' : `Activate Loop Path (${customWaypoints.length} pts)`}
                </button>
                <button
                  onClick={handleClearPath}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] flex items-center gap-1.5 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear
                </button>
                <button
                  onClick={() => { setDrawMode(false); setCustomWaypoints([]); }}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-red-900 text-slate-400 hover:text-red-300 border border-slate-700 text-[11px] flex items-center gap-1.5 transition"
                >
                  <XCircle className="w-3.5 h-3.5" /> Cancel
                </button>
                <span className="text-[10px] text-slate-500 ml-1">Min 2 pts · loop auto-closes</span>
              </>
            )}
          </div>

          {/* Quick Reposition Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
            <div className="flex items-center gap-2">
              <button
                onClick={handleCenterTarget}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] flex items-center gap-1"
              >
                <Crosshair className="w-3.5 h-3.5 text-cyan-400" /> Center Target (1000, 1000)
              </button>
              <button
                onClick={handleDisplaceOutsideFov}
                className="px-2.5 py-1 rounded bg-red-950/60 hover:bg-red-900/80 text-red-200 border border-red-800/60 text-[11px] flex items-center gap-1"
              >
                <Maximize2 className="w-3.5 h-3.5 text-red-400" /> Displace Outside FOV
              </button>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              Status:{' '}
              <span
                className={`font-bold ${
                  target?.is_in_fov ? 'text-emerald-400' : 'text-red-400 animate-pulse'
                }`}
              >
                {target?.is_in_fov ? 'LOCKED IN FOV' : 'OUTSIDE FIELD OF VIEW'}
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Controls & Parameters (5 cols) */}
        <div className="xl:col-span-5 flex flex-col gap-4">
          {/* Target Spot Geometry Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-slate-200 font-bold border-b border-slate-800/80 pb-2">
              <Sun className="w-4 h-4 text-amber-400" />
              <span>OPTICAL BEACON SPOT PROFILE</span>
            </div>

            {/* Shape selection */}
            <div>
              <label className="text-[11px] text-slate-400 block mb-1.5">Beacon Geometry Shape</label>
              <div className="grid grid-cols-3 gap-2">
                {(['Square', 'Circle', 'Gaussian'] as const).map((shape) => (
                  <button
                    key={shape}
                    onClick={() => onSelectShape(shape)}
                    className={`py-1.5 px-2 rounded font-mono text-[11px] border flex items-center justify-center gap-1.5 transition ${
                      currentShape === shape
                        ? 'bg-cyan-950 text-cyan-300 border-cyan-500 font-bold'
                        : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-white'
                    }`}
                  >
                    <Sparkles className="w-3 h-3 text-cyan-400" /> {shape}
                  </button>
                ))}
              </div>
            </div>

            {/* Size Slider */}
            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Spot Size (Pixels)</span>
                <span className="text-white font-bold">{currentSize} px (Req: 10×10 default)</span>
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
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* Optical Intensity Slider */}
            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Peak Optical Irradiance / Intensity</span>
                <span className="text-white font-bold">{currentIntensity} / 255</span>
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
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
              />
            </div>

            {/* Optical Wavelength Standard */}
            <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
              <span className="text-slate-400">FSOC Optical Wavelength</span>
              <span className="px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800 font-mono">
                850 nm / 1550 nm Telecom
              </span>
            </div>

            {/* Modulation / Flicker Controls */}
            <div className="pt-2 border-t border-slate-800/60 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-300 text-[11px] font-bold">Beacon Flicker Modulation</span>
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
                  className="rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-0 cursor-pointer"
                />
              </div>

              {flickerEnabled && (
                <div>
                  <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                    <span>Modulation Frequency</span>
                    <span className="text-white font-bold">{flickerFreq} Hz</span>
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
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Kinematic Trajectory & Motion Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-slate-200 font-bold border-b border-slate-800/80 pb-2">
              <Move className="w-4 h-4 text-cyan-400" />
              <span>KINEMATIC TRAJECTORY PATTERN</span>
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
                { id: 'Custom Path', label: '✏️ Custom Path' },
              ].map((item) => (
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
                  className={`py-1.5 px-2 rounded font-mono text-[11px] border text-left flex items-center justify-between transition ${
                    (item.id === 'Custom Path' && drawMode) || ((currentMotion as string) === item.id && item.id !== 'Custom Path')
                      ? 'bg-amber-950 text-amber-300 border-amber-500 font-bold'
                      : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-white'
                  }`}
                >
                  <span>{item.label}</span>
                  {((item.id === 'Custom Path' && drawMode) || ((currentMotion as string) === item.id && item.id !== 'Custom Path')) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  )}
                </button>
              ))}
            </div>

            {/* Motion Speed Slider */}
            <div className="mt-1">
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Target Velocity</span>
                <span className="text-white font-bold">{currentSpeed} px/sec</span>
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
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* Live Kinematic Telemetry */}
            <div className="mt-2 p-2.5 rounded bg-slate-950/70 border border-slate-800/80 grid grid-cols-2 gap-2 text-[10px] font-mono">
              <div>
                <span className="text-slate-400">Position (X, Y):</span>
                <div className="text-white font-bold">
                  {target ? `${Math.round(target.world_x)}, ${Math.round(target.world_y)}` : 'N/A'}
                </div>
              </div>
              <div>
                <span className="text-slate-400">Velocity (Vx, Vy):</span>
                <div className="text-cyan-300 font-bold">
                  {target && target.velocity_x !== undefined
                    ? `${Math.round(target.velocity_x)}, ${Math.round(target.velocity_y)} px/s`
                    : 'N/A'}
                </div>
              </div>
              <div>
                <span className="text-slate-400">Screen Arena:</span>
                <div className="text-emerald-400 font-bold">2000 × 2000 px</div>
              </div>
              <div>
                <span className="text-slate-400">Camera FoV Size:</span>
                <div className="text-blue-400 font-bold">640 × 480 px (4°×3°)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
