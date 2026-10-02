import React, { useRef, useEffect, useState } from 'react';
import { TargetState, CameraState, TrackingTelemetry, DetectionTelemetry, DisturbanceTelemetry } from '../types';
import { satellitePovSync } from './satellitePovSync';
import {
  Crosshair,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Video,
  Eye,
  EyeOff,
  Sparkles,
  Locate,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { alarmAudio } from '../services/alarmAudio';

interface FPACameraViewportProps {
  target: TargetState | null;
  camera: CameraState | null;
  tracking: TrackingTelemetry | null;
  detection?: DetectionTelemetry | null;
  disturbance?: DisturbanceTelemetry | null;
  onGimbalNudge?: (pan_rate: number, tilt_rate: number) => void;
  onGimbalAngles?: (target_pan: number, target_tilt: number) => void;
}

export const FPACameraViewport: React.FC<FPACameraViewportProps> = ({
  target,
  camera,
  tracking,
  detection,
  disturbance,
  onGimbalNudge,
  onGimbalAngles,
}) => {
  // Default tab on load is OpenCV Annotated per requirements
  const [viewMode, setViewMode] = useState<'opencv_annotated' | 'opencv_raw'>('opencv_annotated');
  const [streamTick, setStreamTick] = useState(0);
  const [hasStreamError, setHasStreamError] = useState(false);
  const nextTickTimerRef = useRef<any>(null);

  // Smooth load-gated streaming: only request next frame once current frame finishes loading
  const handleFrameLoad = () => {
    setHasStreamError(false);
    if (nextTickTimerRef.current) clearTimeout(nextTickTimerRef.current);
    nextTickTimerRef.current = setTimeout(() => {
      setStreamTick((t) => (t + 1) % 1000000);
    }, 50);
  };

  const handleFrameError = () => {
    setHasStreamError(true);
    if (nextTickTimerRef.current) clearTimeout(nextTickTimerRef.current);
    nextTickTimerRef.current = setTimeout(() => {
      setStreamTick((t) => (t + 1) % 1000000);
    }, 600);
  };

  useEffect(() => {
    return () => {
      if (nextTickTimerRef.current) clearTimeout(nextTickTimerRef.current);
    };
  }, []);

  const [autoLOS, setAutoLOS] = useState(false);
  const autoLOSRef = useRef(false);
  autoLOSRef.current = autoLOS;

  const [isAlarmActive, setIsAlarmActive] = useState<boolean>(false);
  const [isAlarmMuted, setIsAlarmMuted] = useState<boolean>(alarmAudio.getIsMuted());
  const [isAlarmSuspended, setIsAlarmSuspended] = useState<boolean>(alarmAudio.getIsSuspended());

  // Subscribe to alarm audio service state
  useEffect(() => {
    const unsub = alarmAudio.subscribe((active, muted, suspended) => {
      setIsAlarmActive(active);
      setIsAlarmMuted(muted);
      setIsAlarmSuspended(suspended);
    });
    return unsub;
  }, []);

  // Sync autoLOS status with satellitePovSync singleton
  useEffect(() => {
    const unsub = satellitePovSync.subscribe((data) => {
      if (data.autoLOS !== undefined && data.autoLOS !== autoLOSRef.current) {
        setAutoLOS(data.autoLOS);
        autoLOSRef.current = data.autoLOS;
      }
    });
    return unsub;
  }, []);

  const handleToggleAutoLOS = () => {
    const next = !autoLOS;
    setAutoLOS(next);
    autoLOSRef.current = next;
    satellitePovSync.update({ autoLOS: next });
  };

  const nudgeIntervalRef = useRef<any>(null);

  const startNudge = (pan_rate: number, tilt_rate: number) => {
    if (nudgeIntervalRef.current) clearInterval(nudgeIntervalRef.current);
    onGimbalNudge?.(pan_rate, tilt_rate);
    nudgeIntervalRef.current = setInterval(() => {
      onGimbalNudge?.(pan_rate, tilt_rate);
    }, 50);
  };

  const stopNudge = () => {
    if (nudgeIntervalRef.current) {
      clearInterval(nudgeIntervalRef.current);
      nudgeIntervalRef.current = null;
      onGimbalNudge?.(0, 0);
    }
  };

  useEffect(() => {
    return () => {
      if (nudgeIntervalRef.current) clearInterval(nudgeIntervalRef.current);
    };
  }, []);

  // Auto LOS Align: continuously slew camera boresight toward LOS ray
  useEffect(() => {
    if (!autoLOS) return;
    if (!target || !camera || !onGimbalAngles) return;
    if (target.azimuth_cam_deg === null || target.elevation_cam_deg === null) return;

    const neededPan  = camera.pan_deg  + (target.azimuth_cam_deg  ?? 0);
    const neededTilt = camera.tilt_deg + (target.elevation_cam_deg ?? 0);
    onGimbalAngles(neededPan, neededTilt);
  }, [autoLOS, target, camera, onGimbalAngles]);

  // =========================================================================
  // SINGLE SOURCE OF TRUTH FOR LOCK & OCCLUSION STATE
  // =========================================================================
  const isLinkBlocked = Boolean(
    tracking?.is_link_blocked ||
    tracking?.state === 'LINK_BLOCKED' ||
    tracking?.state === 'NO_COVERAGE'
  );
  const isChannelOccluded = Boolean(
    disturbance?.is_occluded || disturbance?.occlusion_active
  );
  const isEffectiveOccluded = isLinkBlocked || isChannelOccluded;

  // Single source of truth for PAT lock state:
  // Cannot be locked if link is blocked/occluded; strictly requires tracker in LOCKED state
  const isLocked = !isEffectiveOccluded && Boolean(
    tracking?.is_locked || tracking?.state === 'LOCKED'
  );

  const isCvDetected = !isEffectiveOccluded && Boolean(
    detection?.beacon_detected &&
    detection.detected_centroid_x !== null &&
    detection.detected_centroid_y !== null &&
    detection.detected_centroid_x >= 0 &&
    detection.detected_centroid_x <= 640 &&
    detection.detected_centroid_y >= 0 &&
    detection.detected_centroid_y <= 480
  );

  const isTrackedInSensor = !isEffectiveOccluded && Boolean(
    tracking &&
    tracking.state !== 'LOST' &&
    tracking.state !== 'SEARCHING' &&
    tracking.filtered_x !== null &&
    tracking.filtered_x !== undefined &&
    tracking.filtered_y !== null &&
    tracking.filtered_y !== undefined &&
    tracking.filtered_x >= 0 &&
    tracking.filtered_x <= 640 &&
    tracking.filtered_y >= 0 &&
    tracking.filtered_y <= 480
  );

  const isGroundTruthInSensor = !isEffectiveOccluded && Boolean(
    target &&
    target.pixel_x !== null &&
    target.pixel_x !== undefined &&
    target.pixel_y !== null &&
    target.pixel_y !== undefined &&
    target.pixel_x >= 0 &&
    target.pixel_x <= 640 &&
    target.pixel_y >= 0 &&
    target.pixel_y <= 480
  );

  const isBeaconVisibleInFov = !isEffectiveOccluded && (
    isLocked || isCvDetected || isTrackedInSensor || isGroundTruthInSensor
  );

  const isBeaconLost = isEffectiveOccluded || !isBeaconVisibleInFov;

  // Directly trigger alarm whenever beacon is lost or occluded
  useEffect(() => {
    if (isBeaconLost) {
      alarmAudio.startLostAlarm();
    } else {
      alarmAudio.stopLostAlarm();
    }
  }, [isBeaconLost]);

  useEffect(() => {
    return () => {
      alarmAudio.stopLostAlarm();
    };
  }, []);

  return (
    <div className="flex flex-col bg-[#0b0e17] border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
      {/* Telemetry band */}
      <div className="flex flex-wrap items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800 text-xs font-mono gap-2">
        <div className="flex items-center gap-2 text-cyan-400">
          <Video className="w-4 h-4 text-cyan-400 animate-pulse" />
          <span className="font-semibold tracking-wider">FPA CAMERA VIEWPORT [640 × 480]</span>
        </div>

        {/* View Mode Selector: OpenCV Annotated and OpenCV Raw Feed only */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded border border-slate-800 text-[10px]">
          <button
            onClick={() => setViewMode('opencv_annotated')}
            className={`px-2.5 py-0.5 rounded font-bold transition flex items-center gap-1 ${
              viewMode === 'opencv_annotated'
                ? 'bg-emerald-950 text-emerald-300 border border-emerald-700 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-2.5 h-2.5" /> OpenCV Annotated
          </button>
          <button
            onClick={() => setViewMode('opencv_raw')}
            className={`px-2.5 py-0.5 rounded font-bold transition ${
              viewMode === 'opencv_raw'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            OpenCV Raw Feed
          </button>
        </div>

        <div className="flex items-center gap-2.5 text-[11px]">
          {/* Auto LOS Align toggle */}
          <button
            onClick={handleToggleAutoLOS}
            title="Automatically slew the camera boresight to align with the Line of Sight (LOS) to the target"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded border font-bold transition text-[11px] ${
              autoLOS
                ? 'bg-emerald-950 text-emerald-300 border-emerald-600 animate-pulse'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
            }`}
          >
            <Locate className="w-3.5 h-3.5" />
            {autoLOS ? 'Auto LOS: ON' : 'Auto LOS: OFF'}
          </button>

          <span className="text-slate-600">|</span>

          <span className="text-slate-400">
            FOV: <span className="text-white font-bold">{camera?.fov_horizontal_deg ? `${camera.fov_horizontal_deg.toFixed(1)}° × ${camera.fov_vertical_deg.toFixed(1)}°` : '4.0° × 3.0°'}</span>
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">
            Target:{' '}
            {(() => {
              if (isEffectiveOccluded) {
                return (
                  <span className="text-rose-400 font-bold inline-flex items-center gap-1">
                    <EyeOff className="w-3 h-3" /> {isChannelOccluded ? 'OCCLUDED (CLOUD / OBSTACLE)' : 'OCCLUDED (EARTH LIMB)'}
                  </span>
                );
              }
              if (isLocked) {
                return (
                  <span className="text-emerald-400 font-bold inline-flex items-center gap-1">
                    <Eye className="w-3 h-3" /> LOCKED IN FOV
                  </span>
                );
              }
              if (isBeaconVisibleInFov) {
                return (
                  <span className="text-amber-400 font-bold inline-flex items-center gap-1">
                    <Eye className="w-3 h-3" /> VISIBLE IN FOV ({tracking?.state || 'TRACKING'})
                  </span>
                );
              }
              return (
                <span className="text-rose-400 font-bold inline-flex items-center gap-1">
                  <EyeOff className="w-3 h-3" /> OUTSIDE FOV (CLIPPED)
                </span>
              );
            })()}
          </span>

          <span className="text-slate-600">|</span>

          {/* Alarm Audio Mute Toggle Button */}
          <button
            onClick={() => {
              alarmAudio.unlock();
              alarmAudio.toggleMute();
            }}
            title={
              isAlarmMuted
                ? 'Lost FOV Alarm Audio Muted (Click to Unmute)'
                : isAlarmActive
                ? isAlarmSuspended
                ? 'Alarm is active - Click to enable browser sound output'
                : 'ALARM BEEPING: Beacon out of sight (Click to Mute)'
                : 'Lost FOV Alarm Armed (Click to Mute)'
            }
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-mono transition ${
              isAlarmMuted
                ? 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                : isAlarmActive
                ? 'bg-rose-950 border-rose-500 text-rose-200 animate-pulse'
                : 'bg-slate-800/80 border-slate-700 text-cyan-300 hover:text-white'
            }`}
          >
            {isAlarmMuted ? (
              <VolumeX className="w-3 h-3 text-slate-400" />
            ) : (
              <Volume2 className={`w-3 h-3 ${isAlarmActive ? 'text-rose-400 animate-bounce' : 'text-cyan-400'}`} />
            )}
            <span>
              {isAlarmMuted
                ? 'Alarm: Muted'
                : isAlarmActive
                ? isAlarmSuspended
                  ? 'Alarm: Click for Sound'
                  : 'Alarm: Beeping'
                : 'Alarm: Armed'}
            </span>
          </button>
        </div>
      </div>

      {/* Main FPA Screen (Live OpenCV Camera Feed) */}
      <div className="relative p-2 flex flex-col items-center justify-center bg-black/60">
        <div className="relative w-full max-w-[640px] aspect-[4/3] rounded border border-slate-800 overflow-hidden bg-[#02050c] shadow-2xl flex items-center justify-center">
          <div className="relative w-full h-full bg-black flex items-center justify-center z-10">
            <img
              src={`/api/simulation/frame?annotated=${viewMode === 'opencv_annotated'}&t=${streamTick}`}
              alt="Live OpenCV Camera Feed"
              onLoad={handleFrameLoad}
              onError={handleFrameError}
              className={`w-full h-full object-contain transition-opacity duration-200 ${hasStreamError ? 'opacity-0' : 'opacity-100'}`}
            />

            {/* Standby / Offline HUD Overlay if stream is connecting or unavailable */}
            {hasStreamError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 text-slate-400 font-mono text-xs gap-3 p-4 select-none z-10 text-center">
                <div className="relative flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" />
                  <Video className="w-5 h-5 text-cyan-400 absolute" />
                </div>
                <div>
                  <div className="text-cyan-400 font-bold tracking-wider text-[11px] mb-1">
                    CONNECTING TO FPA CAMERA STREAM...
                  </div>
                  <div className="text-[10px] text-slate-500 max-w-[280px]">
                    Waiting for backend server on port 8000. Start backend with:
                    <br />
                    <code className="text-cyan-300 font-mono text-[9px] bg-slate-900 px-1 py-0.5 rounded border border-slate-800 mt-1 inline-block">
                      python -m uvicorn backend.app.main:app --port 8000
                    </code>
                  </div>
                </div>
              </div>
            )}

            <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/70 border border-slate-700 text-cyan-400 text-[10px] font-mono rounded pointer-events-none">
              OPENCV LIVE STREAM ({viewMode === 'opencv_annotated' ? 'ANNOTATED' : 'RAW'})
            </div>
          </div>

          {/* Tactical Overlay: Occlusion Alert Banner */}
          {isEffectiveOccluded && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 bg-rose-950/90 border border-rose-500 rounded text-[10px] font-mono text-rose-200 font-bold tracking-wider flex items-center gap-2 backdrop-blur-sm shadow-xl shadow-rose-950/80 pointer-events-none select-none animate-pulse">
              <span className="w-2 h-2 rounded-full bg-rose-500 inline-block animate-ping" />
              <span>{isChannelOccluded ? 'OPTICAL CHANNEL OCCLUDED (CLOUD / OBSTACLE)' : 'GROUND BEACON OCCLUDED BY EARTH LIMB'}</span>
            </div>
          )}

          {/* Tactical Overlay: Beacon Lost Alarm Banner */}
          {!isEffectiveOccluded && isBeaconLost && (
            <div
              onClick={() => alarmAudio.unlock()}
              title="Click anywhere to unlock audio if muted/blocked by browser"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 bg-rose-950/95 border border-rose-500 rounded text-[10px] font-mono text-rose-200 font-bold tracking-wider animate-pulse flex items-center gap-2 backdrop-blur-sm shadow-xl shadow-rose-950/80 cursor-pointer select-none"
            >
              <span>Beacon out of sight</span>
            </div>
          )}
        </div>
      </div>

      {/* Telemetry Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 bg-slate-900 border-t border-slate-800 font-mono text-[10px] text-slate-300">
        {/* Real-time Boresight & Detection Telemetry */}
        <div className="bg-slate-950 border border-slate-800 p-2.5 rounded space-y-1">
          <div className="text-cyan-400 font-bold border-b border-slate-800 pb-1 flex justify-between gap-4">
            <span>BORESIGHT ALIGNMENT</span>
            <span className={isLocked ? 'text-emerald-400' : isEffectiveOccluded ? 'text-rose-400' : 'text-amber-400'}>
              {(isEffectiveOccluded ? (tracking?.state || 'LINK_BLOCKED') : (tracking?.state || tracking?.mode || 'SEARCHING')).toUpperCase()}
            </span>
          </div>
          <div>Boresight Center: <span className="text-white font-bold">(320.0, 240.0) px</span></div>
          <div>
            CV Detected Centroid:{' '}
            {isEffectiveOccluded ? (
              <span className="text-rose-400 font-semibold">NO BEACON (LINK BLOCKED)</span>
            ) : detection?.beacon_detected && detection.detected_centroid_x !== null ? (
              <span className="text-emerald-400 font-bold">
                ({detection.detected_centroid_x.toFixed(1)}, {detection.detected_centroid_y?.toFixed(1)}) px
              </span>
            ) : (
              <span className="text-rose-400 font-semibold">NO BEACON DETECTED</span>
            )}
          </div>
          <div>
            Pixel Error (Ex, Ey):{' '}
            {isEffectiveOccluded ? (
              'N/A (LINK BLOCKED)'
            ) : detection?.pixel_error_x !== null && detection?.pixel_error_x !== undefined ? (
              <span className="text-cyan-300 font-bold">
                Ex: {detection.pixel_error_x > 0 ? `+${detection.pixel_error_x.toFixed(1)}` : detection.pixel_error_x.toFixed(1)}, Ey: {detection.pixel_error_y && detection.pixel_error_y > 0 ? `+${detection.pixel_error_y.toFixed(1)}` : detection.pixel_error_y?.toFixed(1)} | Total: {detection.total_pixel_error?.toFixed(1)} px
              </span>
            ) : '--'}
          </div>
          <div>
            Angular Error (θx, θy):{' '}
            {isEffectiveOccluded ? (
              'N/A (LINK BLOCKED)'
            ) : detection?.angular_error_x_deg !== null && detection?.angular_error_x_deg !== undefined ? (
              <span className="text-amber-300">
                θx: {detection.angular_error_x_deg > 0 ? `+${detection.angular_error_x_deg.toFixed(2)}` : detection.angular_error_x_deg.toFixed(2)}°, θy: {detection.angular_error_y_deg && detection.angular_error_y_deg > 0 ? `+${detection.angular_error_y_deg.toFixed(2)}` : detection.angular_error_y_deg?.toFixed(2)}°
              </span>
            ) : '--'}
          </div>
          <div>
            CV Confidence: <span className="text-white font-bold">{isEffectiveOccluded ? '0%' : `${((detection?.confidence ?? 0) * 100).toFixed(0)}%`}</span>
            {!isEffectiveOccluded && detection?.snr_db ? <span className="text-slate-400"> | SNR: <strong className="text-cyan-300">{detection.snr_db.toFixed(1)} dB</strong></span> : null}
            {detection?.processing_time_ms ? <span className="text-slate-400"> | Latency: {detection.processing_time_ms.toFixed(1)}ms</span> : null}
          </div>
          <div>Spot Shape: <strong className="text-white">{target?.shape || 'Square'}</strong> ({target?.size_pixels}x{target?.size_pixels} px)</div>
          {tracking && (
            <div className="border-t border-slate-800 pt-1 mt-1 space-y-0.5 text-[9.5px]">
              <div>
                <span className="text-cyan-400 font-semibold">Kalman Measured:</span>{' '}
                {!isEffectiveOccluded && tracking.measured_x !== null && tracking.measured_x !== undefined ? (
                  <span className="text-white">({tracking.measured_x.toFixed(1)}, {tracking.measured_y?.toFixed(1)}) px</span>
                ) : (
                  <span className="text-slate-500">N/A</span>
                )}
              </div>
              <div>
                <span className="text-pink-400 font-semibold">Kalman Predicted:</span>{' '}
                {!isEffectiveOccluded && tracking.predicted_x !== null && tracking.predicted_x !== undefined ? (
                  <span className="text-white">({tracking.predicted_x.toFixed(1)}, {tracking.predicted_y?.toFixed(1)}) px</span>
                ) : (
                  <span className="text-slate-500">N/A</span>
                )}
                {!isEffectiveOccluded && tracking.velocity_x !== null && tracking.velocity_x !== undefined && (
                  <span className="text-slate-400"> | V=({tracking.velocity_x.toFixed(0)}, {tracking.velocity_y?.toFixed(0)}) px/s</span>
                )}
              </div>
              <div>
                <span className="text-amber-400 font-semibold">Kalman Filtered:</span>{' '}
                {!isEffectiveOccluded && tracking.filtered_x !== null && tracking.filtered_x !== undefined ? (
                  <span className="text-emerald-300 font-bold">({tracking.filtered_x.toFixed(1)}, {tracking.filtered_y?.toFixed(1)}) px</span>
                ) : (
                  <span className="text-slate-500">N/A</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Gimbal Angles */}
        <div className="bg-slate-950 border border-slate-800 p-2.5 rounded space-y-1">
          <div className="text-cyan-400 font-bold border-b border-slate-800 pb-1">GIMBAL KINEMATICS</div>
          <div>Pan Angle: <span className="text-white font-bold">{camera?.pan_deg.toFixed(2)}°</span></div>
          <div>Tilt Angle: <span className="text-white font-bold">{camera?.tilt_deg.toFixed(2)}°</span></div>
          <div>Pan Slew: <span className="text-slate-400">{camera?.pan_rate_deg_s.toFixed(1)}°/s (Cap: {(5.0 * (camera?.adaptive_speed_factor || 1.0)).toFixed(1)}°/s)</span></div>
          <div>Tilt Slew: <span className="text-slate-400">{camera?.tilt_rate_deg_s.toFixed(1)}°/s (Cap: {(5.0 * (camera?.adaptive_speed_factor || 1.0)).toFixed(1)}°/s)</span></div>
          {camera?.adaptive_speed_factor && camera.adaptive_speed_factor > 1.0 && (
            <div className="pt-1 mt-1 border-t border-slate-800 text-amber-400 animate-pulse font-bold">
              ⚡ ADAPTIVE PURSUIT: {camera.adaptive_speed_factor.toFixed(2)}x
            </div>
          )}
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
              onPointerDown={() => startNudge(-2.5, 0)}
              onPointerUp={stopNudge}
              onPointerLeave={stopNudge}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center gap-1 transition text-[11px] select-none"
              title="Pan Left (-2.5°/s)"
            >
              <ArrowLeft className="w-3 h-3" /> Pan Left
            </button>
            <button
              onPointerDown={() => startNudge(0, 2.5)}
              onPointerUp={stopNudge}
              onPointerLeave={stopNudge}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center gap-1 transition text-[11px] select-none"
              title="Tilt Up (+2.5°/s)"
            >
              <ArrowUp className="w-3 h-3" /> Tilt Up
            </button>
            <button
              onPointerDown={() => startNudge(0, -2.5)}
              onPointerUp={stopNudge}
              onPointerLeave={stopNudge}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center gap-1 transition text-[11px] select-none"
              title="Tilt Down (-2.5°/s)"
            >
              <ArrowDown className="w-3 h-3" /> Tilt Down
            </button>
            <button
              onPointerDown={() => startNudge(2.5, 0)}
              onPointerUp={stopNudge}
              onPointerLeave={stopNudge}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center gap-1 transition text-[11px] select-none"
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
