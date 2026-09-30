import React, { useRef, useEffect } from 'react';
import { TargetState, CameraState, DisturbanceTelemetry } from '../types';
import { Compass, Crosshair, Eye, EyeOff } from 'lucide-react';

interface VirtualSceneProps {
  target: TargetState | null;
  targets?: TargetState[];
  camera: CameraState | null;
  disturbance?: DisturbanceTelemetry | null;
  worldWidth?: number;
  worldHeight?: number;
}

export const VirtualSceneCanvas: React.FC<VirtualSceneProps> = ({
  target,
  targets = [],
  camera,
  disturbance,
  worldWidth = 2000,
  worldHeight = 2000,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const scale = width / worldWidth; // Screen coordinate to Canvas pixel scale (~0.35)

    // Clear background (Deep space dark)
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, width, height);

    // Coordinate Grid (100px world spacing)
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.4)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= worldWidth; x += 100) {
      const cx = x * scale;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, height);
      ctx.stroke();
    }
    for (let y = 0; y <= worldHeight; y += 100) {
      const cy = y * scale;
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(width, cy);
      ctx.stroke();
    }

    // World Center Axis Lines (origin at 1000, 1000)
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.6)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 1. Draw Camera FOV Projection & Frustum
    if (camera) {
      const bx = camera.world_center_x * scale;
      const by = camera.world_center_y * scale;
      const camPosAx = (camera.position_x ?? 1000.0) * scale;
      const camPosAy = (camera.position_y ?? 1000.0) * scale;

      // Draw FOV Frustum Polygon if available
      if (camera.frustum_corners_world && camera.frustum_corners_world.length === 4) {
        const corners = camera.frustum_corners_world.map(([x, y]) => [x * scale, y * scale]);

        // Far FOV plane rectangle
        ctx.beginPath();
        ctx.moveTo(corners[0][0], corners[0][1]);
        for (let i = 1; i < 4; i++) {
          ctx.lineTo(corners[i][0], corners[i][1]);
        }
        ctx.closePath();
        ctx.strokeStyle = target?.is_in_fov ? '#10b981' : '#06b6d4';
        ctx.lineWidth = 1.5;
        ctx.fillStyle = target?.is_in_fov ? 'rgba(16, 185, 129, 0.08)' : 'rgba(6, 182, 212, 0.05)';
        ctx.fill();
        ctx.stroke();

        // Rays from camera aperture to frustum corners
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.25)';
        ctx.setLineDash([2, 2]);
        corners.forEach(([cx_c, cy_c]) => {
          ctx.beginPath();
          ctx.moveTo(camPosAx, camPosAy);
          ctx.lineTo(cx_c, cy_c);
          ctx.stroke();
        });
        ctx.setLineDash([]);
      }

      // Camera optical aperture position
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(camPosAx, camPosAy, 4, 0, Math.PI * 2);
      ctx.fill();

      // Camera boresight reticle at target depth
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(bx, by, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.moveTo(bx - 12, by);
      ctx.lineTo(bx + 12, by);
      ctx.moveTo(bx, by - 12);
      ctx.lineTo(bx, by + 12);
      ctx.stroke();

      // Optical Boresight Line of Sight (LOS) ray
      ctx.strokeStyle = 'rgba(96, 165, 250, 0.45)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(camPosAx, camPosAy);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 2. Draw Target Trajectory History Trail
    const allTargets = targets.length > 0 ? targets : target ? [target] : [];
    allTargets.forEach((t) => {
      if (t.trajectory_trail && t.trajectory_trail.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < t.trajectory_trail.length; i++) {
          const [wx, wy] = t.trajectory_trail[i];
          const sx = wx * scale;
          const sy = wy * scale;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }

      // Draw Target Beacon (with disturbance displacement)
      const jx = disturbance?.jitter_offset_x_px ?? 0;
      const jy = disturbance?.jitter_offset_y_px ?? 0;
      const px = disturbance?.platform_offset_x_px ?? 0;
      const py = disturbance?.platform_offset_y_px ?? 0;
      const tx = (t.world_x + (jx + px) * 2.0) * scale;
      const ty = (t.world_y + (jy + py) * 2.0) * scale;
      const tsz = Math.max(5, t.size_pixels * scale);
      const isLocked = t.is_in_fov;

      // Glow halo
      const grad = ctx.createRadialGradient(tx, ty, 1, tx, ty, 16);
      grad.addColorStop(0, isLocked ? 'rgba(16, 185, 129, 0.9)' : 'rgba(244, 63, 94, 0.8)');
      grad.addColorStop(1, 'rgba(244, 63, 94, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(tx, ty, 16, 0, Math.PI * 2);
      ctx.fill();

      // Shape rendering
      ctx.fillStyle = isLocked ? '#10b981' : '#ff4d6d';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;

      if (t.shape === 'Circle' || t.shape === 'Gaussian') {
        ctx.beginPath();
        ctx.arc(tx, ty, tsz / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        // Square
        ctx.fillRect(tx - tsz / 2, ty - tsz / 2, tsz, tsz);
        ctx.strokeRect(tx - tsz / 2, ty - tsz / 2, tsz, tsz);
      }

      // Target Label with 3D coordinates (X, Y, Z)
      ctx.fillStyle = isLocked ? '#a7f3d0' : '#fca5a5';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText(
        `BEACON #${t.target_id} (${t.world_x.toFixed(0)}, ${t.world_y.toFixed(0)}, Z:${t.world_z.toFixed(0)})`,
        tx + 10,
        ty - 6
      );
    });
  }, [target, targets, camera, disturbance, worldWidth, worldHeight]);

  return (
    <div className="relative w-full h-full flex flex-col bg-[#070a12] border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
      {/* Top Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-2 text-cyan-400 font-mono">
          <Compass className="w-4 h-4 text-cyan-400 animate-pulse" />
          <span className="font-semibold tracking-wider">VIRTUAL ENVIRONMENT [2000 × 2000px]</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-slate-400 text-[11px]">
          <span>FOV: <strong className="text-white">4.0° × 3.0°</strong></span>
          <span className="text-slate-600">|</span>
          <span>Target Status: {target?.is_in_fov ? (
            <span className="text-emerald-400 font-bold bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-700/50">INSIDE FOV</span>
          ) : (
            <span className="text-amber-400 font-bold bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-700/50">OUTSIDE FOV</span>
          )}</span>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative flex-1 flex items-center justify-center p-2">
        <canvas
          ref={canvasRef}
          width={700}
          height={700}
          className="w-full h-full max-h-[640px] aspect-square object-contain rounded border border-slate-800 shadow-inner"
        />

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-slate-950/80 backdrop-blur border border-slate-800 p-2.5 rounded font-mono text-[10px] space-y-1 text-slate-300">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block"></span>
            <span>Optical Beacon Spot ({target?.shape || 'Square'} 10x10 px)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-2 border border-cyan-400 bg-cyan-400/20 inline-block"></span>
            <span>Camera 4°×3° FOV Frustum Projection</span>
          </div>
          <div className="flex items-center gap-2">
            <Crosshair className="w-3 h-3 text-[#D6D9DC]" />
            <span>Camera Boresight (Pan: {camera?.pan_deg.toFixed(2)}°, Tilt: {camera?.tilt_deg.toFixed(2)}°)</span>
          </div>
        </div>

        <div className="absolute top-4 right-4 bg-slate-950/80 backdrop-blur border border-slate-800 px-3 py-1.5 rounded font-mono text-[11px] text-cyan-400">
          COORDINATES: X/Y/Z (CARTESIAN 3D)
        </div>
      </div>
    </div>
  );
};
