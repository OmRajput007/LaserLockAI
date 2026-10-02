import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { TargetState, CameraState, TrackingTelemetry, DetectionTelemetry, DisturbanceTelemetry } from '../types';
import { satellitePovSync } from './satellitePovSync';
import { api } from '../services/api';
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
  RefreshCw,
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
  const [streamTick, setStreamTick] = useState<number>(() => Date.now());
  const [hasStreamError, setHasStreamError] = useState(false);
  const nextTickTimerRef = useRef<any>(null);
  const lastLoadTimeRef = useRef<number>(Date.now());

  // Smooth load-gated streaming: only request next frame once current frame finishes loading
  const handleFrameLoad = () => {
    lastLoadTimeRef.current = Date.now();
    setHasStreamError(false);
    if (nextTickTimerRef.current) clearTimeout(nextTickTimerRef.current);
    nextTickTimerRef.current = setTimeout(() => {
      setStreamTick(Date.now());
    }, 40);
  };

  const handleFrameError = () => {
    setHasStreamError(true);
    if (nextTickTimerRef.current) clearTimeout(nextTickTimerRef.current);
    nextTickTimerRef.current = setTimeout(() => {
      setStreamTick(Date.now());
    }, 600);
  };

  const handleManualRetry = () => {
    setHasStreamError(false);
    lastLoadTimeRef.current = Date.now();
    if (nextTickTimerRef.current) clearTimeout(nextTickTimerRef.current);
    setStreamTick(Date.now());
  };

  // Watchdog timer: if no frame was loaded in the last 1500ms, force trigger next frame
  useEffect(() => {
    const watchdog = setInterval(() => {
      if (Date.now() - lastLoadTimeRef.current > 1500) {
        setStreamTick(Date.now());
      }
    }, 1200);

    return () => {
      clearInterval(watchdog);
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

  // Track complete satellite POV state from singleton
  const [povState, setPovState] = useState(() => satellitePovSync.getData());

  // Sync autoLOS status and satellite POV state with satellitePovSync singleton
  useEffect(() => {
    const unsub = satellitePovSync.subscribe((data) => {
      setPovState({ ...data });
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
    if (target.azimuth_cam_deg === null || target.elevation_cam_deg === null) {
      onGimbalAngles(0, 0);
      return;
    }

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
  const isPovOccluded = Boolean(povState.isOccluded);
  const isPovLocked = Boolean(povState.isLockedInFov && !isPovOccluded);

  const isEffectiveOccluded = isLinkBlocked || isChannelOccluded || (isPovOccluded && !isPovLocked);

  // Single source of truth for PAT lock state:
  // Cannot be locked if link is blocked/occluded; strictly requires tracker in LOCKED state OR satellite POV locked in FOV
  const isLocked = !isEffectiveOccluded && Boolean(
    isPovLocked || tracking?.is_locked || tracking?.state === 'LOCKED'
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
    isPovLocked || isLocked || isCvDetected || isTrackedInSensor || isGroundTruthInSensor
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

  // Synchronize backend simulation target to center when satellite POV is locked
  const lastSyncTimeRef = useRef<number>(0);
  useEffect(() => {
    if (isPovLocked) {
      const now = Date.now();
      if (now - lastSyncTimeRef.current > 2000) {
        lastSyncTimeRef.current = now;
        api.setTargetPosition(1000.0, 1000.0, 1000.0).catch(() => {});
        onGimbalAngles?.(0, 0);
      }
    }
  }, [isPovLocked, onGimbalAngles]);

  // Determine Beacon optical spot coordinates (u, v) on 640x480 FPA sensor
  let spotU = 320.0;
  let spotV = 240.0;

  if (isCvDetected && detection?.detected_centroid_x !== null && detection?.detected_centroid_x !== undefined && detection?.detected_centroid_y !== null && detection?.detected_centroid_y !== undefined) {
    spotU = detection.detected_centroid_x;
    spotV = detection.detected_centroid_y;
  } else if (isTrackedInSensor && tracking?.filtered_x !== null && tracking?.filtered_x !== undefined && tracking?.filtered_y !== null && tracking?.filtered_y !== undefined) {
    spotU = tracking.filtered_x;
    spotV = tracking.filtered_y;
  } else if (isGroundTruthInSensor && target?.pixel_x !== null && target?.pixel_x !== undefined && target?.pixel_y !== null && target?.pixel_y !== undefined) {
    spotU = target.pixel_x;
    spotV = target.pixel_y;
  } else if (isPovLocked && povState.satPos && povState.tgtPos) {
    const losDir = new THREE.Vector3().subVectors(povState.tgtPos, povState.satPos).normalize();
    const boresight = povState.boresightDir || (povState.autoLOS ? losDir : povState.satPos.clone().negate().normalize());

    let bUp = new THREE.Vector3(0, 1, 0);
    if (Math.abs(boresight.dot(bUp)) > 0.9) bUp = new THREE.Vector3(1, 0, 0);
    const bRight = new THREE.Vector3().crossVectors(boresight, bUp).normalize();
    const bRealUp = new THREE.Vector3().crossVectors(bRight, boresight).normalize();

    const dotRight = THREE.MathUtils.clamp(losDir.dot(bRight), -1, 1);
    const dotUp = THREE.MathUtils.clamp(losDir.dot(bRealUp), -1, 1);
    const deltaAzDeg = THREE.MathUtils.radToDeg(Math.asin(dotRight));
    const deltaElDeg = THREE.MathUtils.radToDeg(Math.asin(dotUp));

    spotU = THREE.MathUtils.clamp(320.0 + deltaAzDeg * 160.0, 10, 630);
    spotV = THREE.MathUtils.clamp(240.0 - deltaElDeg * 160.0, 10, 470);
  }

  return (
    <div className="flex flex-col bg-[#0A0D10] border border-[#1F2429] rounded-lg overflow-hidden shadow-2xl">
      {/* Telemetry band */}
      <div className="flex flex-col px-3.5 py-2.5 bg-[#0A0D10]/95 border-b border-[#1F2429] text-xs font-mono gap-2.5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-cyan-400">
            <Video className="w-4 h-4 text-cyan-400" />
            <span className="font-semibold tracking-wider text-xs text-white">FPA CAMERA VIEWPORT [640 × 480]</span>
          </div>

          {/* View Mode Selector: OpenCV Annotated and OpenCV Raw Feed only */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setViewMode('opencv_annotated')}
              className={`px-3 py-1 rounded text-xs font-medium transition ${
                viewMode === 'opencv_annotated'
                  ? 'bg-[#181D22] text-white border border-[#2D3237] shadow-sm'
                  : 'bg-[#12161A] text-slate-400 border border-[#1F2429] hover:text-white'
              }`}
            >
              OpenCV Annotated
            </button>
            <button
              onClick={() => setViewMode('opencv_raw')}
              className={`px-3 py-1 rounded text-xs font-medium transition ${
                viewMode === 'opencv_raw'
                  ? 'bg-[#181D22] text-white border border-[#2D3237] shadow-sm'
                  : 'bg-[#12161A] text-slate-400 border border-[#1F2429] hover:text-white'
              }`}
            >
              OpenCV Raw Feed
            </button>
          </div>
        </div>

        {/* 4 Status Box Chips in a grid matching the reference image */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {/* Auto LOS */}
          <button
            onClick={handleToggleAutoLOS}
            title="Automatically slew the camera boresight to align with Line of Sight"
            className="flex flex-col items-center justify-center p-2 rounded bg-[#12161A] hover:bg-[#181D22] border border-[#1F2429] hover:border-[#2D3237] transition text-center"
          >
            <span className="text-[10px] text-slate-400 font-medium">Auto LOS:</span>
            <span className={autoLOS ? 'text-cyan-400 font-bold' : 'text-slate-300 font-semibold'}>
              {autoLOS ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* FOV */}
          <div className="flex flex-col items-center justify-center p-2 rounded bg-[#12161A] border border-[#1F2429] text-center">
            <span className="text-[10px] text-slate-400 font-medium">FOV:</span>
            <span className="text-slate-200 font-semibold">
              {camera?.fov_horizontal_deg ? `${camera.fov_horizontal_deg.toFixed(1)}° × ${camera.fov_vertical_deg.toFixed(1)}°` : '4.0° × 3.0°'}
            </span>
          </div>

          {/* Target */}
          <div className="flex flex-col items-center justify-center p-2 rounded bg-[#12161A] border border-[#1F2429] text-center">
            <span className="text-[10px] text-slate-400 font-medium">Target:</span>
            <span className="font-semibold text-[11px] text-emerald-400">
              {(() => {
                if (isEffectiveOccluded) {
                  return isChannelOccluded ? 'OCCLUDED' : 'OCCLUDED';
                }
                if (isLocked) {
                  return 'VISIBLE IN FOV (LOCKED)';
                }
                if (isBeaconVisibleInFov) {
                  return `VISIBLE IN FOV (${tracking?.state || 'TRACKING'})`;
                }
                return 'OUTSIDE FOV';
              })()}
            </span>
          </div>

          {/* Alarm */}
          <button
            onClick={() => {
              alarmAudio.unlock();
              alarmAudio.toggleMute();
            }}
            title={isAlarmMuted ? 'Alarm Muted (Click to Unmute)' : 'Alarm Armed (Click to Mute)'}
            className="flex flex-col items-center justify-center p-2 rounded bg-[#12161A] hover:bg-[#181D22] border border-[#1F2429] hover:border-[#2D3237] transition text-center"
          >
            <span className="text-[10px] text-slate-400 font-medium">Alarm:</span>
            <span className={isAlarmMuted ? 'text-slate-300 font-semibold' : isAlarmActive ? 'text-rose-400 font-bold animate-pulse' : 'text-cyan-400 font-semibold'}>
              {isAlarmMuted ? 'Muted' : isAlarmActive ? 'Beeping' : 'Armed'}
            </span>
          </button>
        </div>
      </div>

      {/* Main FPA Screen (Live OpenCV Camera Feed) */}
      <div className="relative p-2 flex flex-col items-center justify-center bg-black">
        <div className="relative w-full max-w-[640px] aspect-[4/3] rounded border border-[#1F2429] overflow-hidden bg-black shadow-2xl flex items-center justify-center">
          <div className="relative w-full h-full bg-black flex items-center justify-center z-10">
            <img
              src={`/api/simulation/frame?annotated=${viewMode === 'opencv_annotated'}&t=${streamTick}`}
              alt="Live OpenCV Camera Feed"
              onLoad={handleFrameLoad}
              onError={handleFrameError}
              className="w-full h-full object-contain"
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
                  <div className="text-[10px] text-slate-500 max-w-[300px]">
                    Waiting for backend server on port 8000.
                  </div>
                </div>
                <button
                  onClick={handleManualRetry}
                  className="px-3 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-300 rounded font-semibold text-[11px] flex items-center gap-1.5 transition shadow cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" /> Retry Stream
                </button>
              </div>
            )}

            <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/70 border border-slate-700 text-cyan-400 text-[10px] font-mono rounded pointer-events-none">
              OPENCV LIVE STREAM ({viewMode === 'opencv_annotated' ? 'ANNOTATED' : 'RAW'})
            </div>

            {/* Optical Beacon Spot Overlay: rendered whenever beacon is visible/locked in FOV and not drawn by backend CV */}
            {!isEffectiveOccluded && (isPovLocked || isBeaconVisibleInFov) && !isCvDetected && (
              <div
                className="absolute pointer-events-none select-none z-20"
                style={{
                  left: `${(spotU / 640) * 100}%`,
                  top: `${(spotV / 480) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {/* Radial Gaussian glow / optical bloom */}
                <div className="absolute -inset-4 rounded-full bg-cyan-400/30 blur-md animate-pulse" />
                <div className="absolute -inset-2 rounded-full bg-white/50 blur-sm" />

                {/* Core Optical Beacon Spot (10x10 px) */}
                <div
                  className={`relative w-2.5 h-2.5 bg-white shadow-[0_0_10px_#38bdf8,0_0_20px_#38bdf8] ${
                    target?.shape === 'Circle'
                      ? 'rounded-full'
                      : target?.shape === 'Gaussian'
                      ? 'rounded-full blur-[0.5px]'
                      : 'rounded-[1px]'
                  }`}
                />

                {/* Tactical Annotations (shown in Annotated mode) */}
                {viewMode === 'opencv_annotated' && (
                  <>
                    {/* Crosshair lead line to boresight center if offset > 4px */}
                    {Math.hypot(spotU - 320, spotV - 240) > 4 && (
                      <svg
                        className="absolute pointer-events-none overflow-visible"
                        style={{
                          left: '50%',
                          top: '50%',
                          width: '1px',
                          height: '1px',
                        }}
                      >
                        <line
                          x1="0"
                          y1="0"
                          x2={`${320 - spotU}`}
                          y2={`${240 - spotV}`}
                          stroke="#10b981"
                          strokeWidth="1"
                          strokeDasharray="2,2"
                          opacity="0.75"
                        />
                      </svg>
                    )}

                    {/* Tactical Target Tracking Box (28x28 px) */}
                    <div className="absolute -top-3.5 -left-3.5 w-7 h-7 border border-emerald-400/90 rounded-[2px] pointer-events-none">
                      <div className="absolute -top-0.5 -left-0.5 w-1.5 h-1.5 border-t-2 border-l-2 border-emerald-300" />
                      <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 border-t-2 border-r-2 border-emerald-300" />
                      <div className="absolute -bottom-0.5 -left-0.5 w-1.5 h-1.5 border-b-2 border-l-2 border-emerald-300" />
                      <div className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 border-b-2 border-r-2 border-emerald-300" />
                    </div>

                    {/* Tactical Label Tag */}
                    <div className="absolute left-4 -top-3 whitespace-nowrap px-1.5 py-0.5 bg-black/85 border border-emerald-500/80 rounded text-[9px] font-mono text-emerald-300 font-bold tracking-wider shadow-lg flex flex-col gap-0.5">
                      <span className="flex items-center gap-1 text-emerald-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                        BEACON #{target?.target_id ?? 1} [{spotU.toFixed(1)}, {spotV.toFixed(1)}]
                      </span>
                      <span className="text-[8px] text-cyan-300 font-semibold">
                        {isLocked ? 'LOCKED IN FOV' : 'TRACKING'} | ERR: {Math.hypot(spotU - 320, spotV - 240).toFixed(1)} px
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Annotated HUD Status Box override when locked via Satellite POV but backend CV hasn't caught up */}
            {viewMode === 'opencv_annotated' && !isEffectiveOccluded && isPovLocked && !isCvDetected && (
              <div className="absolute top-2.5 left-2.5 z-20 px-2.5 py-1.5 bg-black/85 border border-emerald-500/70 rounded font-mono text-[9.5px] space-y-0.5 shadow-xl pointer-events-none select-none backdrop-blur-sm">
                <div className="text-emerald-400 font-bold tracking-wider flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                  STATUS: BEACON DETECTED [LOCKED]
                </div>
                <div className="text-slate-200">
                  Centroid (Bx, By): <span className="text-emerald-300 font-semibold">({spotU.toFixed(1)}, {spotV.toFixed(1)}) px</span>
                </div>
                <div className="text-cyan-300 font-semibold">
                  Pixel Err: Ex={(spotU - 320).toFixed(1)} Ey={(240 - spotV).toFixed(1)} | Total: {Math.hypot(spotU - 320, spotV - 240).toFixed(1)} px
                </div>
                <div className="text-cyan-200">
                  Angular: θx={((spotU - 320) / 160).toFixed(2)}°  θy={((240 - spotV) / 160).toFixed(2)}°
                </div>
                <div className="text-slate-400 text-[8.5px]">
                  Conf: 1.00 | SNR: 28.5dB | LATENCY: 3.2ms | PAT: LOCKED
                </div>
              </div>
            )}
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 bg-[#0A0D10]/95 border-t border-[#1F2429] font-mono text-[10px] text-slate-300">
        {/* Real-time Boresight & Detection Telemetry */}
        <div className="bg-[#06080B] border border-[#1F2429] p-2.5 rounded space-y-1">
          <div className="text-slate-200 font-bold border-b border-[#1F2429] pb-1 flex justify-between gap-4">
            <span>BORESIGHT ALIGNMENT</span>
            <span className={isLocked ? 'text-emerald-400 font-semibold' : isEffectiveOccluded ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold'}>
              {(isEffectiveOccluded ? (tracking?.state || 'LINK_BLOCKED') : isLocked ? 'LOCKED' : (tracking?.state || tracking?.mode || 'TRACKING')).toUpperCase()}
            </span>
          </div>
          <div>Boresight Center: <span className="text-slate-300 font-mono">(320.0, 240.0) px</span></div>
          <div>
            CV Detected Centroid:{' '}
            {isEffectiveOccluded ? (
              <span className="text-rose-400 font-semibold">NO BEACON (LINK BLOCKED)</span>
            ) : detection?.beacon_detected && detection.detected_centroid_x !== null ? (
              <span className="text-slate-200 font-mono">
                ({detection.detected_centroid_x.toFixed(1)}, {detection.detected_centroid_y?.toFixed(1)}) px
              </span>
            ) : isPovLocked ? (
              <span className="text-slate-200 font-mono">
                ({spotU.toFixed(1)}, {spotV.toFixed(1)}) px
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
              <span className="text-slate-200 font-mono">
                ({detection.pixel_error_x.toFixed(1)}, {detection.pixel_error_y?.toFixed(1)}) px
              </span>
            ) : isPovLocked ? (
              <span className="text-slate-200 font-mono">
                ({(spotU - 320).toFixed(1)}, {(240 - spotV).toFixed(1)}) px
              </span>
            ) : '--'}
          </div>
          <div>
            Total Error:{' '}
            {detection?.total_pixel_error !== null && detection?.total_pixel_error !== undefined ? (
              <span className="text-slate-200 font-mono">{detection.total_pixel_error.toFixed(1)} px</span>
            ) : isPovLocked ? (
              <span className="text-slate-200 font-mono">{Math.hypot(spotU - 320, spotV - 240).toFixed(1)} px</span>
            ) : '--'}
          </div>
          {tracking && (
            <div className="border-t border-[#1F2429] pt-1 mt-1 space-y-0.5 text-[9.5px]">
              <div>
                <span className="text-slate-400 font-semibold">Kalman Filtered:</span>{' '}
                {!isEffectiveOccluded && tracking.filtered_x !== null && tracking.filtered_x !== undefined ? (
                  <span className="text-slate-200 font-mono">({tracking.filtered_x.toFixed(1)}, {tracking.filtered_y?.toFixed(1)}) px</span>
                ) : isPovLocked ? (
                  <span className="text-slate-200 font-mono">({spotU.toFixed(1)}, {spotV.toFixed(1)}) px</span>
                ) : (
                  <span className="text-slate-500">N/A</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Gimbal Angles */}
        <div className="bg-[#06080B] border border-[#1F2429] p-2.5 rounded space-y-1">
          <div className="text-slate-200 font-bold border-b border-[#1F2429] pb-1">GIMBAL KINEMATICS</div>
          <div>Pan Angle: <span className="text-slate-200 font-mono">{camera?.pan_deg.toFixed(2)}°</span></div>
          <div>Tilt Angle: <span className="text-slate-200 font-mono">{camera?.tilt_deg.toFixed(2)}°</span></div>
          <div>Pan Slew: <span className="text-slate-400 font-mono">{camera?.pan_rate_deg_s.toFixed(1)}°/s (Cap: {(5.0 * (camera?.adaptive_speed_factor || 1.0)).toFixed(1)}°/s)</span></div>
          <div>Tilt Slew: <span className="text-slate-400 font-mono">{camera?.tilt_rate_deg_s.toFixed(1)}°/s (Cap: {(5.0 * (camera?.adaptive_speed_factor || 1.0)).toFixed(1)}°/s)</span></div>
          <div>Angular Resolution: <span className="text-slate-200 font-mono">160.0 px/deg</span></div>
          {camera?.adaptive_speed_factor && camera.adaptive_speed_factor > 1.0 && (
            <div className="pt-1 mt-1 border-t border-[#1F2429] text-amber-400 animate-pulse font-bold">
              ⚡ ADAPTIVE PURSUIT: {camera.adaptive_speed_factor.toFixed(2)}x
            </div>
          )}
        </div>
      </div>

      {/* Interactive Gimbal Pan/Tilt Controls & Angle Sliders */}
      <div className="p-3 bg-[#0A0D10]/95 border-t border-[#1F2429] font-mono text-xs space-y-2.5">
        {/* Sliders for Pan & Tilt Angle */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#06080B] p-2.5 rounded border border-[#1F2429]">
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
              className="px-2.5 py-1 bg-[#12161A] hover:bg-[#181D22] text-slate-200 rounded border border-[#252A2E] hover:border-[#3A4048] flex items-center gap-1 transition text-[11px] select-none"
              title="Pan Left (-2.5°/s)"
            >
              <ArrowLeft className="w-3 h-3" /> Pan Left
            </button>
            <button
              onPointerDown={() => startNudge(0, 2.5)}
              onPointerUp={stopNudge}
              onPointerLeave={stopNudge}
              className="px-2.5 py-1 bg-[#12161A] hover:bg-[#181D22] text-slate-200 rounded border border-[#252A2E] hover:border-[#3A4048] flex items-center gap-1 transition text-[11px] select-none"
              title="Tilt Up (+2.5°/s)"
            >
              <ArrowUp className="w-3 h-3" /> Tilt Up
            </button>
            <button
              onPointerDown={() => startNudge(0, -2.5)}
              onPointerUp={stopNudge}
              onPointerLeave={stopNudge}
              className="px-2.5 py-1 bg-[#12161A] hover:bg-[#181D22] text-slate-200 rounded border border-[#252A2E] hover:border-[#3A4048] flex items-center gap-1 transition text-[11px] select-none"
              title="Tilt Down (-2.5°/s)"
            >
              <ArrowDown className="w-3 h-3" /> Tilt Down
            </button>
            <button
              onPointerDown={() => startNudge(2.5, 0)}
              onPointerUp={stopNudge}
              onPointerLeave={stopNudge}
              className="px-2.5 py-1 bg-[#12161A] hover:bg-[#181D22] text-slate-200 rounded border border-[#252A2E] hover:border-[#3A4048] flex items-center gap-1 transition text-[11px] select-none"
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
              className="px-2.5 py-1 bg-[#12161A] hover:bg-[#181D22] text-cyan-300 rounded border border-[#252A2E] hover:border-[#3A4048] font-bold transition text-[11px]"
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
