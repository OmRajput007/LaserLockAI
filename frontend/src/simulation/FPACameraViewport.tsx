import React, { useRef, useEffect, useState } from 'react';
import { TargetState, CameraState, TrackingTelemetry, DetectionTelemetry } from '../types';
import {
  Crosshair,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Video,
  Eye,
  EyeOff,
  Sliders,
  RotateCcw,
  Sparkles,
  Layers,
} from 'lucide-react';

interface FPACameraViewportProps {
  target: TargetState | null;
  camera: CameraState | null;
  tracking: TrackingTelemetry | null;
  detection?: DetectionTelemetry | null;
  onGimbalNudge?: (pan_rate: number, tilt_rate: number) => void;
  onGimbalAngles?: (target_pan: number, target_tilt: number) => void;
}

export const FPACameraViewport: React.FC<FPACameraViewportProps> = ({
  target,
  camera,
  tracking,
  detection,
  onGimbalNudge,
  onGimbalAngles,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'opencv_annotated' | 'opencv_raw'>('canvas');
  const [streamTick, setStreamTick] = useState(0);

  // Historical projected pixel breadcrumbs for sensor trajectory trail
  const pixelHistoryRef = useRef<{ u: number; v: number }[]>([]);

  useEffect(() => {
    if (target && target.is_in_fov && target.pixel_x !== null && target.pixel_y !== null) {
      pixelHistoryRef.current.push({ u: target.pixel_x, v: target.pixel_y });
      if (pixelHistoryRef.current.length > 35) {
        pixelHistoryRef.current.shift();
      }
    } else {
      // Fade/clear trail when target lost from FOV
      if (pixelHistoryRef.current.length > 0) {
        pixelHistoryRef.current.shift();
      }
    }
  }, [target]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = 640;
    const h = 480;

    // 1. Draw monochrome FPA dark sensor background
    ctx.fillStyle = '#07090e';
    ctx.fillRect(0, 0, w, h);

    // Subtle sensor FPA pixel grid texture
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const cx = w / 2; // 320
    const cy = h / 2; // 240

    // 2. Optical Center Crosshairs & Error Tolerance Rings
    // 10px Tracking Tolerance (Problem Statement 4 Requirement: Error <= 10 pixels)
    ctx.strokeStyle = '#10b981'; // Emerald
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.stroke();

    // 20px Warning Ring
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.stroke();

    // 50px Outer Acquisition Ring
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, 50, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Boresight Crosshair ticks
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy);
    ctx.lineTo(cx - 12, cy);
    ctx.moveTo(cx + 12, cy);
    ctx.lineTo(cx + 30, cy);
    ctx.moveTo(cx, cy - 30);
    ctx.lineTo(cx, cy - 12);
    ctx.moveTo(cx, cy + 12);
    ctx.lineTo(cx, cy + 30);
    ctx.stroke();

    // Corner alignment brackets
    const bracketSize = 15;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.strokeRect(10, 10, bracketSize, bracketSize);
    ctx.strokeRect(w - 10 - bracketSize, 10, bracketSize, bracketSize);
    ctx.strokeRect(10, h - 10 - bracketSize, bracketSize, bracketSize);
    ctx.strokeRect(w - 10 - bracketSize, h - 10 - bracketSize, bracketSize, bracketSize);

    // 3. Render Projected Trajectory Trail on Sensor
    const trail = pixelHistoryRef.current;
    if (trail.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < trail.length; i++) {
        const pt = trail[i];
        if (i === 0) ctx.moveTo(pt.u, pt.v);
        else ctx.lineTo(pt.u, pt.v);
      }
      ctx.stroke();

      // Dots on recent trail
      for (let i = 0; i < trail.length; i += 3) {
        ctx.fillStyle = `rgba(244, 63, 94, ${(i / trail.length) * 0.7})`;
        ctx.fillRect(trail[i].u - 1, trail[i].v - 1, 2, 2);
      }
    }

    // 4. Render Beacon ONLY IF INSIDE FOV!
    // Strict requirement: If outside FOV, it must NOT appear in the camera image!
    if (target && target.is_in_fov && target.pixel_x !== null && target.pixel_y !== null) {
      const px = target.pixel_x;
      const py = target.pixel_y;
      const sz = target.size_pixels; // 10 px default
      const shape = target.shape || 'Square';

      // Spot halo glow
      const glow = ctx.createRadialGradient(px, py, 1, px, py, 22);
      glow.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      glow.addColorStop(0.35, 'rgba(6, 182, 212, 0.65)');
      glow.addColorStop(1, 'rgba(6, 182, 212, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, 22, 0, Math.PI * 2);
      ctx.fill();

      // Optical Spot based on shape (Square, Circle, Gaussian)
      if (shape === 'Square') {
        // Problem Statement 4 Default: Square 10x10 px
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
        ctx.strokeRect(px - sz / 2, py - sz / 2, sz, sz);
      } else if (shape === 'Circle') {
        // Circular optical aperture disk
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, sz / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (shape === 'Gaussian') {
        // Physical Gaussian intensity beam profile
        const gGrad = ctx.createRadialGradient(px, py, 0, px, py, sz / 1.5);
        gGrad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        gGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.7)');
        gGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
        ctx.fillStyle = gGrad;
        ctx.beginPath();
        ctx.arc(px, py, sz / 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Tracking error line from center boresight to spot
      ctx.strokeStyle = tracking?.is_locked ? '#10b981' : '#f59e0b';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.setLineDash([]);

      // Pixel readout tag
      ctx.fillStyle = '#38bdf8';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText(`BEACON [${px.toFixed(1)}, ${py.toFixed(1)}]`, px + 12, py - 10);
    }

    // 5. Render Computer Vision Detected Overlays (From OpenCV Detector)
    if (detection && detection.beacon_detected) {
      // Secondary candidate bounding boxes
      if (detection.candidates && detection.candidates.length > 1) {
        ctx.strokeStyle = '#eab308'; // Amber/Yellow
        ctx.lineWidth = 1.2;
        ctx.font = '9px JetBrains Mono, monospace';
        detection.candidates.slice(1).forEach((c) => {
          const [bx, by, bw, bh] = c.bbox;
          ctx.strokeRect(bx, by, bw, bh);
          ctx.fillStyle = '#eab308';
          ctx.fillText(`CAND #${c.candidate_id} (${c.confidence.toFixed(2)})`, bx, by - 3);
        });
      }

      // Primary Beacon Bounding Box (Bright Green, 2px)
      if (detection.bbox) {
        const [bx, by, bw, bh] = detection.bbox;
        ctx.strokeStyle = '#22c55e'; // Green
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, bw, bh);

        ctx.fillStyle = '#22c55e';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillText(`OPENCV BEACON [CONF: ${(detection.confidence * 100).toFixed(0)}%]`, bx, Math.max(12, by - 4));
      }

      // Primary Centroid Marker (Moments M10/M00, M01/M00)
      if (detection.detected_centroid_x !== null && detection.detected_centroid_y !== null) {
        const detX = detection.detected_centroid_x;
        const detY = detection.detected_centroid_y;

        // Centroid cyan crosshair & ring
        ctx.fillStyle = '#06b6d4';
        ctx.beginPath();
        ctx.arc(detX, detY, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(detX, detY, 7, 0, Math.PI * 2);
        ctx.stroke();

        // Error Vector Line: from camera center (320, 240) to detected centroid
        const isAligned = (detection.total_pixel_error ?? 999) <= 10.0;
        ctx.strokeStyle = isAligned ? '#10b981' : '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(detX, detY);
        ctx.stroke();

        // Vector midpoint label
        const midX = (cx + detX) / 2;
        const midY = (cy + detY) / 2;
        ctx.fillStyle = isAligned ? '#10b981' : '#f59e0b';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.fillText(
          `E=${detection.total_pixel_error?.toFixed(1)}px (θx=${detection.angular_error_x_deg?.toFixed(2)}°, θy=${detection.angular_error_y_deg?.toFixed(2)}°)`,
          midX + 6,
          midY - 4
        );
      }
    }

    // 6. Part 5: Render Kalman Filter Positions (Measured, Predicted, Filtered)
    if (tracking) {
      // (a) Measured Position (Cyan circle + label)
      if (tracking.measured_x !== null && tracking.measured_x !== undefined &&
          tracking.measured_y !== null && tracking.measured_y !== undefined) {
        const mx = tracking.measured_x;
        const my = tracking.measured_y;
        ctx.strokeStyle = '#06b6d4'; // Cyan
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(mx, my, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#06b6d4';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillText(`MEASURED (${mx.toFixed(1)}, ${my.toFixed(1)})`, mx + 8, my + 12);
      }

      // (b) Predicted Position (Magenta crosshair + velocity vector)
      if (tracking.predicted_x !== null && tracking.predicted_x !== undefined &&
          tracking.predicted_y !== null && tracking.predicted_y !== undefined) {
        const px = tracking.predicted_x;
        const py = tracking.predicted_y;
        ctx.strokeStyle = '#ec4899'; // Pink/Magenta
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(px - 8, py);
        ctx.lineTo(px + 8, py);
        ctx.moveTo(px, py - 8);
        ctx.lineTo(px, py + 8);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ec4899';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillText(`PREDICTED (${px.toFixed(1)}, ${py.toFixed(1)})`, px + 8, py - 6);

        // Velocity vector arrow
        if (tracking.velocity_x !== null && tracking.velocity_x !== undefined &&
            tracking.velocity_y !== null && tracking.velocity_y !== undefined) {
          const vx = tracking.velocity_x;
          const vy = tracking.velocity_y;
          const endX = px + vx * 0.15;
          const endY = py + vy * 0.15;
          ctx.strokeStyle = 'rgba(236, 72, 153, 0.7)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(endX, endY);
          ctx.stroke();
        }
      }

      // (c) Filtered Position (Yellow diamond + crosshair)
      if (tracking.filtered_x !== null && tracking.filtered_x !== undefined &&
          tracking.filtered_y !== null && tracking.filtered_y !== undefined) {
        const fx = tracking.filtered_x;
        const fy = tracking.filtered_y;
        ctx.strokeStyle = '#eab308'; // Amber/Yellow
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(fx, fy - 6);
        ctx.lineTo(fx + 6, fy);
        ctx.lineTo(fx, fy + 6);
        ctx.lineTo(fx - 6, fy);
        ctx.closePath();
        ctx.stroke();

        ctx.fillStyle = '#eab308';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.fillText(`FILTERED (${fx.toFixed(1)}, ${fy.toFixed(1)})`, fx + 8, fy + 3);
      }

      // (d) PAT State Machine Badge on Canvas HUD
      const patState = tracking.state || tracking.mode || 'SEARCHING';
      const stateColors: Record<string, { bg: string; text: string; border: string }> = {
        LOCKED: { bg: 'rgba(16, 185, 129, 0.85)', text: '#ffffff', border: '#10b981' },
        TRACKING: { bg: 'rgba(6, 182, 212, 0.85)', text: '#ffffff', border: '#06b6d4' },
        ACQUIRING: { bg: 'rgba(234, 179, 8, 0.85)', text: '#000000', border: '#eab308' },
        REACQUIRING: { bg: 'rgba(249, 115, 22, 0.85)', text: '#ffffff', border: '#f97316' },
        SEARCHING: { bg: 'rgba(168, 85, 247, 0.85)', text: '#ffffff', border: '#a855f7' },
        LOST: { bg: 'rgba(239, 68, 68, 0.85)', text: '#ffffff', border: '#ef4444' },
      };
      const theme = stateColors[patState] || { bg: 'rgba(100, 116, 139, 0.85)', text: '#ffffff', border: '#64748b' };

      ctx.save();
      ctx.fillStyle = theme.bg;
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1.5;
      const badgeW = 120;
      const badgeH = 22;
      const badgeX = cx - badgeW / 2;
      const badgeY = 12;
      ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
      ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);
      ctx.fillStyle = theme.text;
      ctx.font = 'bold 11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`PAT: ${patState}`, cx, badgeY + badgeH / 2);
      ctx.restore();
    }
  }, [target, camera, tracking, detection, viewMode]);

  return (
    <div className="flex flex-col bg-[#0b0e17] border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
      {/* Telemetry band */}
      <div className="flex flex-wrap items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800 text-xs font-mono gap-2">
        <div className="flex items-center gap-2 text-cyan-400">
          <Video className="w-4 h-4 text-cyan-400 animate-pulse" />
          <span className="font-semibold tracking-wider">FPA CAMERA VIEWPORT [640 × 480]</span>
        </div>

        {/* View Mode Selector */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded border border-slate-800 text-[10px]">
          <button
            onClick={() => setViewMode('canvas')}
            className={`px-2 py-0.5 rounded font-bold transition ${
              viewMode === 'canvas' ? 'bg-cyan-950 text-cyan-300 border border-cyan-700' : 'text-slate-400 hover:text-white'
            }`}
          >
            Simulated Canvas
          </button>
          <button
            onClick={() => setViewMode('opencv_annotated')}
            className={`px-2 py-0.5 rounded font-bold transition flex items-center gap-1 ${
              viewMode === 'opencv_annotated' ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-2.5 h-2.5" /> OpenCV Annotated
          </button>
          <button
            onClick={() => setViewMode('opencv_raw')}
            className={`px-2 py-0.5 rounded font-bold transition ${
              viewMode === 'opencv_raw' ? 'bg-slate-800 text-white border border-slate-700' : 'text-slate-400 hover:text-white'
            }`}
          >
            OpenCV Raw Feed
          </button>
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-slate-400">
            FOV: <span className="text-white font-bold">{camera?.fov_horizontal_deg.toFixed(1)}° × {camera?.fov_vertical_deg.toFixed(1)}°</span>
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">
            Target: {target?.is_in_fov ? (
              <span className="text-emerald-400 font-bold inline-flex items-center gap-1">
                <Eye className="w-3 h-3" /> VISIBLE IN FOV
              </span>
            ) : (
              <span className="text-rose-400 font-bold inline-flex items-center gap-1">
                <EyeOff className="w-3 h-3" /> OUTSIDE FOV (CLIPPED)
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Main 2D FPA Screen */}
      <div className="relative p-2 flex flex-col items-center justify-center bg-black/50">
        {viewMode === 'canvas' ? (
          <canvas
            ref={canvasRef}
            width={640}
            height={480}
            className="w-full max-w-[640px] aspect-[4/3] object-contain rounded border border-slate-800 bg-black shadow-inner"
          />
        ) : (
          <div className="relative w-full max-w-[640px] aspect-[4/3] rounded border border-slate-800 overflow-hidden bg-black flex items-center justify-center">
            <img
              src={`http://127.0.0.1:8000/api/simulation/frame?annotated=${viewMode === 'opencv_annotated'}&t=${streamTick}`}
              alt="Live OpenCV Camera Feed"
              className="w-full h-full object-contain"
            />
            <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/70 border border-slate-700 text-cyan-400 text-[10px] font-mono rounded">
              OPENCV LIVE STREAM ({viewMode === 'opencv_annotated' ? 'ANNOTATED' : 'RAW'})
            </div>
          </div>
        )}

        {/* Real-time Boresight & Detection Telemetry Overlay */}
        <div className="absolute top-4 left-4 bg-slate-950/85 backdrop-blur border border-slate-800 p-2.5 rounded font-mono text-[10px] space-y-1 text-slate-300 pointer-events-none">
          <div className="text-cyan-400 font-bold border-b border-slate-800 pb-1 flex justify-between gap-4">
            <span>BORESIGHT ALIGNMENT</span>
            <span className={tracking?.is_locked ? 'text-emerald-400' : 'text-amber-400'}>
              {tracking?.mode.toUpperCase()}
            </span>
          </div>
          <div>Boresight Center: <span className="text-white font-bold">(320.0, 240.0) px</span></div>
          <div>
            CV Detected Centroid: {detection?.beacon_detected && detection.detected_centroid_x !== null ? (
              <span className="text-emerald-400 font-bold">
                ({detection.detected_centroid_x.toFixed(1)}, {detection.detected_centroid_y?.toFixed(1)}) px
              </span>
            ) : (
              <span className="text-rose-400 font-semibold">NO BEACON DETECTED</span>
            )}
          </div>
          <div>
            Pixel Error (Ex, Ey): {detection?.pixel_error_x !== null && detection?.pixel_error_x !== undefined ? (
              <span className="text-cyan-300 font-bold">
                Ex: {detection.pixel_error_x > 0 ? `+${detection.pixel_error_x.toFixed(1)}` : detection.pixel_error_x.toFixed(1)}, Ey: {detection.pixel_error_y && detection.pixel_error_y > 0 ? `+${detection.pixel_error_y.toFixed(1)}` : detection.pixel_error_y?.toFixed(1)} | Total: {detection.total_pixel_error?.toFixed(1)} px
              </span>
            ) : '--'}
          </div>
          <div>
            Angular Error (θx, θy): {detection?.angular_error_x_deg !== null && detection?.angular_error_x_deg !== undefined ? (
              <span className="text-amber-300">
                θx: {detection.angular_error_x_deg > 0 ? `+${detection.angular_error_x_deg.toFixed(2)}` : detection.angular_error_x_deg.toFixed(2)}°, θy: {detection.angular_error_y_deg && detection.angular_error_y_deg > 0 ? `+${detection.angular_error_y_deg.toFixed(2)}` : detection.angular_error_y_deg?.toFixed(2)}°
              </span>
            ) : '--'}
          </div>
          <div>
            CV Confidence: <span className="text-white font-bold">{((detection?.confidence ?? 0) * 100).toFixed(0)}%</span>
            {detection?.snr_db ? <span className="text-slate-400"> | SNR: <strong className="text-cyan-300">{detection.snr_db.toFixed(1)} dB</strong></span> : null}
            {detection?.processing_time_ms ? <span className="text-slate-400"> | Latency: {detection.processing_time_ms.toFixed(1)}ms</span> : null}
          </div>
          <div>Spot Shape: <strong className="text-white">{target?.shape || 'Square'}</strong> ({target?.size_pixels}x{target?.size_pixels} px)</div>
          {tracking && (
            <div className="border-t border-slate-800 pt-1 mt-1 space-y-0.5 text-[9.5px]">
              <div>
                <span className="text-cyan-400 font-semibold">Kalman Measured:</span>{' '}
                {tracking.measured_x !== null && tracking.measured_x !== undefined ? (
                  <span className="text-white">({tracking.measured_x.toFixed(1)}, {tracking.measured_y?.toFixed(1)}) px</span>
                ) : (
                  <span className="text-slate-500">N/A</span>
                )}
              </div>
              <div>
                <span className="text-pink-400 font-semibold">Kalman Predicted:</span>{' '}
                {tracking.predicted_x !== null && tracking.predicted_x !== undefined ? (
                  <span className="text-white">({tracking.predicted_x.toFixed(1)}, {tracking.predicted_y?.toFixed(1)}) px</span>
                ) : (
                  <span className="text-slate-500">N/A</span>
                )}
                {tracking.velocity_x !== null && tracking.velocity_x !== undefined && (
                  <span className="text-slate-400"> | V=({tracking.velocity_x.toFixed(0)}, {tracking.velocity_y?.toFixed(0)}) px/s</span>
                )}
              </div>
              <div>
                <span className="text-amber-400 font-semibold">Kalman Filtered:</span>{' '}
                {tracking.filtered_x !== null && tracking.filtered_x !== undefined ? (
                  <span className="text-emerald-300 font-bold">({tracking.filtered_x.toFixed(1)}, {tracking.filtered_y?.toFixed(1)}) px</span>
                ) : (
                  <span className="text-slate-500">N/A</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Gimbal Angles Overlay */}
        <div className="absolute top-4 right-4 bg-slate-950/85 backdrop-blur border border-slate-800 p-2.5 rounded font-mono text-[10px] space-y-1 text-slate-300 text-right pointer-events-none">
          <div className="text-cyan-400 font-bold border-b border-slate-800 pb-1">GIMBAL KINEMATICS</div>
          <div>Pan Angle: <span className="text-white font-bold">{camera?.pan_deg.toFixed(2)}°</span></div>
          <div>Tilt Angle: <span className="text-white font-bold">{camera?.tilt_deg.toFixed(2)}°</span></div>
          <div>Pan Slew: <span className="text-slate-400">{camera?.pan_rate_deg_s.toFixed(1)}°/s (Max 5°/s)</span></div>
          <div>Tilt Slew: <span className="text-slate-400">{camera?.tilt_rate_deg_s.toFixed(1)}°/s (Max 5°/s)</span></div>
        </div>
      </div>

      {/* Interactive Gimbal Pan/Tilt Controls & Angle Sliders */}
      <div className="p-3 bg-slate-900/90 border-t border-slate-800 font-mono text-xs space-y-2.5">
        {/* Sliders for Pan & Tilt Angle */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950 p-2.5 rounded border border-slate-800">
          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-slate-400">Commanded Pan Angle (Azimuth):</span>
              <span className="text-cyan-300 font-bold">{camera?.target_pan_deg?.toFixed(1) ?? camera?.pan_deg.toFixed(1)}° (Lim: ±180°)</span>
            </div>
            <input
              type="range"
              min={camera?.pan_min_limit_deg ?? -180}
              max={camera?.pan_max_limit_deg ?? 180}
              step="0.5"
              value={camera?.target_pan_deg ?? camera?.pan_deg ?? 0}
              onChange={(e) => {
                const p = parseFloat(e.target.value);
                onGimbalAngles?.(p, camera?.target_tilt_deg ?? camera?.tilt_deg ?? 0);
              }}
              className="w-full accent-cyan-500 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-slate-400">Commanded Tilt Angle (Elevation):</span>
              <span className="text-cyan-300 font-bold">{camera?.target_tilt_deg?.toFixed(1) ?? camera?.tilt_deg.toFixed(1)}° (Lim: ±85°)</span>
            </div>
            <input
              type="range"
              min={camera?.tilt_min_limit_deg ?? -85}
              max={camera?.tilt_max_limit_deg ?? 85}
              step="0.5"
              value={camera?.target_tilt_deg ?? camera?.tilt_deg ?? 0}
              onChange={(e) => {
                const t = parseFloat(e.target.value);
                onGimbalAngles?.(camera?.target_pan_deg ?? camera?.pan_deg ?? 0, t);
              }}
              className="w-full accent-cyan-500 cursor-pointer"
            />
          </div>
        </div>

        {/* Nudge buttons (Respecting max 5°/s slew speed) */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
            <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
            <span>Manual Slew Nudges (Clamped to 5.0°/s):</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onGimbalNudge?.(-2.5, 0)}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center gap-1 transition text-[11px]"
              title="Pan Left (-2.5°/s)"
            >
              <ArrowLeft className="w-3 h-3" /> Pan Left
            </button>
            <button
              onClick={() => onGimbalNudge?.(0, 2.5)}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center gap-1 transition text-[11px]"
              title="Tilt Up (+2.5°/s)"
            >
              <ArrowUp className="w-3 h-3" /> Tilt Up
            </button>
            <button
              onClick={() => onGimbalNudge?.(0, -2.5)}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center gap-1 transition text-[11px]"
              title="Tilt Down (-2.5°/s)"
            >
              <ArrowDown className="w-3 h-3" /> Tilt Down
            </button>
            <button
              onClick={() => onGimbalNudge?.(2.5, 0)}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center gap-1 transition text-[11px]"
              title="Pan Right (+2.5°/s)"
            >
              <ArrowRight className="w-3 h-3" /> Pan Right
            </button>
            <button
              onClick={() => {
                onGimbalNudge?.(0, 0);
                onGimbalAngles?.(camera?.pan_deg ?? 0, camera?.tilt_deg ?? 0);
              }}
              className="px-2.5 py-1 bg-rose-950/80 hover:bg-rose-900 text-rose-300 rounded border border-rose-800 font-bold transition text-[11px]"
            >
              Halt Slew
            </button>
            <button
              onClick={() => onGimbalAngles?.(0, 0)}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-slate-700 font-bold transition text-[11px]"
              title="Center Camera to (0, 0)"
            >
              Center (0,0)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
