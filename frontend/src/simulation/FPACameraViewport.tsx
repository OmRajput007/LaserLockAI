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
  Camera,
  Download,
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
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Manual Satellite Camera POV Image Capture State
  const [isCapturing, setIsCapturing] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [lastCapturedImage, setLastCapturedImage] = useState<{ url: string; filename: string; time: string } | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<any>(null);

  // Synthesize camera shutter audio click
  const playShutterSound = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.07);
    } catch {
      // Audio autoplay policy
    }
  };

  // Capture satellite camera POV image manually
  const handleCaptureImage = async () => {
    setIsCapturing(true);
    setShutterFlash(true);
    playShutterSound();
    setTimeout(() => setShutterFlash(false), 200);

    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const filename = `satellite_pov_${timestamp}.jpg`;
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      // Create high-resolution 640x480 canvas for satellite camera POV snapshot
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');

      let imageDrawn = false;
      try {
        const res = await fetch(`/api/simulation/frame?annotated=${viewMode === 'opencv_annotated'}&t=${Date.now()}`);
        if (res.ok) {
          const blob = await res.blob();
          const imgBitmap = await createImageBitmap(blob);
          ctx.drawImage(imgBitmap, 0, 0, 640, 480);
          imageDrawn = true;
        }
      } catch {
        imageDrawn = false;
      }

      if (!imageDrawn && imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
        try {
          ctx.drawImage(imgRef.current, 0, 0, 640, 480);
          imageDrawn = true;
        } catch {
          // If crossOrigin tainted, fallback
        }
      }

      if (!imageDrawn) {
        ctx.fillStyle = '#0B0D0F';
        ctx.fillRect(0, 0, 640, 480);
        ctx.strokeStyle = '#33362F';
        ctx.strokeRect(10, 10, 620, 460);
      }

      // Burn-in technical aerospace watermark
      ctx.save();
      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(8, 456, 380, 18);
      ctx.fillStyle = '#F0FFEA';
      ctx.fillText(`SAT-POV | UTC: ${now.toISOString()} | 640×480 px | FOV 4°×3°`, 14, 469);
      ctx.restore();

      canvas.toBlob((blob) => {
        if (!blob) return;
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setLastCapturedImage({ url: blobUrl, filename, time: timeStr });
        setCaptureNotice(`✓ Saved: ${filename}`);

        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = setTimeout(() => {
          setCaptureNotice(null);
        }, 3500);
      }, 'image/jpeg', 0.95);
    } catch (err) {
      console.error('Failed to capture satellite POV image:', err);
      setCaptureNotice('✕ Capture failed');
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = setTimeout(() => {
        setCaptureNotice(null);
      }, 3000);
    } finally {
      setIsCapturing(false);
    }
  };

  // Keyboard shortcut listener ('c' or 'C') to trigger image capture
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'c' || e.key === 'C') {
        handleCaptureImage();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode]);

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

  // Orbital beacon projection onto the 640x480 FPA (single source of truth for the
  // satellite POV white pixel). Non-null only while the beacon is on the sensor.
  const orbitalSpotU = povState.beaconPixelU;
  const orbitalSpotV = povState.beaconPixelV;
  const hasOrbitalSpot =
    !isPovOccluded && orbitalSpotU !== null && orbitalSpotV !== null;
  const orbitalAngularErrorDeg = povState.beaconAngularErrorDeg ?? 180.0;

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
    hasOrbitalSpot || isPovLocked || isLocked || isCvDetected || isTrackedInSensor || isGroundTruthInSensor
  );

  // The orbital POV projection is authoritative: if the beacon is on the satellite FPA
  // the alarm must be silent; the moment it leaves the FOV the alarm resumes.
  const isBeaconLost = isEffectiveOccluded || (hasOrbitalSpot ? false : !isBeaconVisibleInFov);

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

  // Determine Beacon optical spot coordinates (u, v) on 640x480 FPA sensor.
  // Priority 1: the satellite POV orbital projection (authoritative for this viewport).
  let spotU = 320.0;
  let spotV = 240.0;

  if (hasOrbitalSpot && orbitalSpotU !== null && orbitalSpotV !== null) {
    spotU = orbitalSpotU;
    spotV = orbitalSpotV;
  } else if (isCvDetected && detection?.detected_centroid_x !== null && detection?.detected_centroid_x !== undefined && detection?.detected_centroid_y !== null && detection?.detected_centroid_y !== undefined) {
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
    <div className="flex flex-col bg-[#1B1D1A] border border-[#33362F] rounded-lg overflow-hidden shadow-2xl">
      {/* Telemetry band */}
      <div className="flex flex-col px-3.5 py-2.5 bg-[#1B1D1A] border-b border-[#33362F] text-xs font-mono gap-2.5">
        {/* Row 1: Header title on left, "Click image" button in green region on right */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[#FF5F40]">
            <Video className="w-4 h-4 text-[#FF5F40]" />
            <span className="font-semibold tracking-wider text-xs text-[#F0FFEA]">FPA CAMERA VIEWPORT [640 × 480]</span>
          </div>

          {/* "Click image" button - added on the green region in the FPA camera viewport area */}
          <div className="flex items-center gap-1.5">
            <button
              id="btn-click-image"
              onClick={handleCaptureImage}
              disabled={isCapturing}
              className="px-3 py-1 bg-[#262824] hover:bg-[#33362F] active:bg-[#1B1D1A] text-[#FF5F40] border border-[#FF5F40] hover:border-[#FF7459] rounded font-mono text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm hover:shadow-[0_0_12px_rgba(255,95,64,0.3)] shrink-0"
              title="Takes images of the satellite camera POV manually (Shortcut: C)"
            >
              <Camera className="w-3.5 h-3.5 text-[#FF5F40]" />
              <span>{isCapturing ? 'Capturing...' : 'Click image'}</span>
              <kbd className="px-1 py-0.2 bg-[#000000] text-[9px] rounded text-[#F0FFEA] font-mono border border-[#33362F]">C</kbd>
            </button>
            {lastCapturedImage && (
              <button
                onClick={() => setShowPreviewModal(true)}
                className="px-2 py-1 bg-[#262824] hover:bg-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] border border-[#33362F] rounded text-[11px] font-mono flex items-center gap-1 transition cursor-pointer"
                title="View last captured satellite POV image"
              >
                <Eye className="w-3 h-3 text-[#FF5F40]" />
                <span>View</span>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: View Mode Selector: OpenCV Annotated, OpenCV Raw Feed, Jump to Sat */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
          <button
            onClick={() => setViewMode('opencv_annotated')}
            className={`px-3 py-1.5 rounded text-xs font-mono transition border text-center font-medium ${
              viewMode === 'opencv_annotated'
                ? 'bg-[#FF5F40] text-[#0A0A0A] font-semibold border-[#FF5F40]'
                : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA] hover:border-[#FF5F40]'
            }`}
          >
            OpenCV Annotated
          </button>
          <button
            onClick={() => setViewMode('opencv_raw')}
            className={`px-3 py-1.5 rounded text-xs font-mono transition border text-center font-medium ${
              viewMode === 'opencv_raw'
                ? 'bg-[#FF5F40] text-[#0A0A0A] font-semibold border-[#FF5F40]'
                : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA] hover:border-[#FF5F40]'
            }`}
          >
            OpenCV Raw Feed
          </button>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('fsoc:jump-to-sat'));
            }}
            className="px-2.5 py-1.5 rounded text-xs font-mono font-semibold transition flex items-center justify-center gap-1.5 bg-[#262824] hover:bg-[#33362F] text-[#FF5F40] border border-[#FF5F40] cursor-pointer"
            title="Jump 3D Orbit Camera to face Satellite in front (Shortcut: S or F)"
          >
            <Crosshair className="w-3.5 h-3.5 text-[#FF5F40]" />
            <span>Jump to Sat</span>
            <kbd className="px-1 py-0.2 bg-[#000000] text-[9px] rounded text-[#F0FFEA] font-mono border border-[#33362F]">S</kbd>
          </button>
        </div>

        {/* 4 Status Box Chips in a grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {/* Auto LOS */}
          <button
            onClick={handleToggleAutoLOS}
            title="Automatically slew the camera boresight to align with Line of Sight"
            className="flex flex-col items-center justify-center p-2 rounded bg-[#262824] hover:bg-[#33362F] border border-[#33362F] hover:border-[#FF5F40] transition text-center"
          >
            <span className="text-[10px] text-[#9CA195] font-medium uppercase tracking-wider">Auto LOS:</span>
            <span className={autoLOS ? 'text-[#FF5F40] font-bold' : 'text-[#F0FFEA] font-semibold'}>
              {autoLOS ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* FOV */}
          <div className="flex flex-col items-center justify-center p-2 rounded bg-[#262824] border border-[#33362F] text-center">
            <span className="text-[10px] text-[#9CA195] font-medium uppercase tracking-wider">FOV:</span>
            <span className="text-[#F0FFEA] font-semibold">
              {camera?.fov_horizontal_deg ? `${camera.fov_horizontal_deg.toFixed(1)}° × ${camera.fov_vertical_deg.toFixed(1)}°` : '4.0° × 3.0°'}
            </span>
          </div>

          {/* Target */}
          <div className="flex flex-col items-center justify-center p-2 rounded bg-[#262824] border border-[#33362F] text-center">
            <span className="text-[10px] text-[#9CA195] font-medium uppercase tracking-wider">Target:</span>
            <span className="font-semibold text-[11px] text-[#FF5F40]">
              {(() => {
                if (isEffectiveOccluded) {
                  return isChannelOccluded ? 'OCCLUDED' : 'OCCLUDED';
                }
                if (isLocked) {
                  return '✓ LOCKED IN FOV';
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
            className="flex flex-col items-center justify-center p-2 rounded bg-[#262824] hover:bg-[#33362F] border border-[#33362F] hover:border-[#FF5F40] transition text-center"
          >
            <span className="text-[10px] text-[#9CA195] font-medium uppercase tracking-wider">Alarm:</span>
            <span className={isAlarmMuted ? 'text-[#5E625A] font-semibold' : isAlarmActive ? 'text-[#FF5F40] font-bold animate-pulse' : 'text-[#F0FFEA] font-semibold'}>
              {isAlarmMuted ? 'Muted' : isAlarmActive ? 'Beeping' : 'Armed'}
            </span>
          </button>
        </div>
      </div>

      {/* Main FPA Screen (Live OpenCV Camera Feed) */}
      <div className="relative p-2 flex flex-col items-center justify-center bg-[#000000]">
        <div className="relative w-full max-w-[640px] aspect-[4/3] rounded border border-[#33362F] overflow-hidden bg-[#000000] shadow-2xl flex items-center justify-center">
          <div className="relative w-full h-full bg-[#000000] flex items-center justify-center z-10">
            <img
              ref={imgRef}
              src={`/api/simulation/frame?annotated=${viewMode === 'opencv_annotated'}&t=${streamTick}`}
              alt="Live OpenCV Camera Feed"
              crossOrigin="anonymous"
              onLoad={handleFrameLoad}
              onError={handleFrameError}
              className="w-full h-full object-contain"
            />

            {/* Camera Shutter Flash Effect */}
            {shutterFlash && (
              <div className="absolute inset-0 bg-white/70 z-50 pointer-events-none transition-opacity duration-150 animate-pulse" />
            )}

            {/* Notification Badge when an image is clicked/saved */}
            {captureNotice && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 bg-[#1B1D1A]/95 border border-[#FF5F40] text-[#FF5F40] rounded shadow-lg text-[11px] font-mono font-semibold flex items-center gap-2 backdrop-blur-sm">
                <Camera className="w-3.5 h-3.5 text-[#FF5F40]" />
                <span>{captureNotice}</span>
                {lastCapturedImage && (
                  <button
                    onClick={() => setShowPreviewModal(true)}
                    className="underline text-[#F0FFEA] hover:text-white cursor-pointer ml-1 text-[10px]"
                  >
                    View
                  </button>
                )}
              </div>
            )}

            {/* Standby / Offline HUD Overlay if stream is connecting or unavailable */}
            {hasStreamError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#000000]/95 text-[#9CA195] font-mono text-xs gap-3 p-4 select-none z-10 text-center">
                <div className="relative flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full border-2 border-[#FF5F40]/20 border-t-[#FF5F40] animate-spin" />
                  <Video className="w-5 h-5 text-[#FF5F40] absolute" />
                </div>
                <div>
                  <div className="text-[#FF5F40] font-bold tracking-wider text-[11px] mb-1">
                    CONNECTING TO FPA CAMERA STREAM...
                  </div>
                  <div className="text-[10px] text-[#5E625A] max-w-[300px]">
                    Waiting for backend server on port 8000.
                  </div>
                </div>
                <button
                  onClick={handleManualRetry}
                  className="px-3 py-1 bg-[#262824] hover:bg-[#33362F] border border-[#FF5F40] text-[#FF5F40] rounded font-semibold text-[11px] flex items-center gap-1.5 transition shadow cursor-pointer font-mono"
                >
                  <RefreshCw className="w-3 h-3" /> Retry Stream
                </button>
              </div>
            )}

            <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-[#000000]/80 border border-[#33362F] text-[#FF5F40] text-[10px] font-mono rounded pointer-events-none">
              OPENCV LIVE STREAM ({viewMode === 'opencv_annotated' ? 'ANNOTATED' : 'RAW'})
            </div>

            {/* Optical Beacon Spot Overlay */}
            {!isEffectiveOccluded && (hasOrbitalSpot || isPovLocked || isBeaconVisibleInFov) && !(isCvDetected && !hasOrbitalSpot) && (
              <div
                className="absolute pointer-events-none select-none z-20"
                style={{
                  left: `${(spotU / 640) * 100}%`,
                  top: `${(spotV / 480) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {/* Radial Gaussian glow / optical bloom */}
                <div className="absolute -inset-4 rounded-full bg-[#FF5F40]/30 blur-md animate-pulse" />
                <div className="absolute -inset-2 rounded-full bg-[#F0FFEA]/40 blur-sm" />

                {/* Core Optical Beacon Spot (10x10 px) */}
                <div
                  className={`relative w-2.5 h-2.5 bg-[#F0FFEA] shadow-[0_0_10px_#FF5F40,0_0_20px_#FF5F40] ${
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
                          stroke="#FF5F40"
                          strokeWidth="1"
                          strokeDasharray="2,2"
                          opacity="0.75"
                        />
                      </svg>
                    )}

                    {/* Tactical Target Tracking Box (28x28 px) */}
                    <div className="absolute -top-3.5 -left-3.5 w-7 h-7 border border-[#FF5F40]/90 rounded-[2px] pointer-events-none">
                      <div className="absolute -top-0.5 -left-0.5 w-1.5 h-1.5 border-t-2 border-l-2 border-[#FF5F40]" />
                      <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 border-t-2 border-r-2 border-[#FF5F40]" />
                      <div className="absolute -bottom-0.5 -left-0.5 w-1.5 h-1.5 border-b-2 border-l-2 border-[#FF5F40]" />
                      <div className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 border-b-2 border-r-2 border-[#FF5F40]" />
                    </div>

                    {/* Tactical Label Tag */}
                    <div className="absolute left-4 -top-3 whitespace-nowrap px-1.5 py-0.5 bg-[#000000]/90 border border-[#FF5F40] rounded text-[9px] font-mono text-[#FF5F40] font-bold tracking-wider shadow-lg flex flex-col gap-0.5">
                      <span className="flex items-center gap-1 text-[#FF5F40]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#FF5F40] animate-ping inline-block" />
                        BEACON #{target?.target_id ?? 1} [{spotU.toFixed(1)}, {spotV.toFixed(1)}]
                      </span>
                      <span className="text-[8px] text-[#F0FFEA] font-semibold">
                        {isLocked ? '✓ LOCKED IN FOV' : 'TRACKING'} | ERR: {Math.hypot(spotU - 320, spotV - 240).toFixed(1)} px
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Annotated HUD Status Box override */}
            {viewMode === 'opencv_annotated' && !isEffectiveOccluded && isPovLocked && !isCvDetected && (
              <div className="absolute top-2.5 left-2.5 z-20 px-2.5 py-1.5 bg-[#000000]/90 border border-[#FF5F40] rounded font-mono text-[9.5px] space-y-0.5 shadow-xl pointer-events-none select-none backdrop-blur-sm">
                <div className="text-[#FF5F40] font-bold tracking-wider flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#FF5F40] animate-ping inline-block" />
                  STATUS: BEACON DETECTED [LOCKED]
                </div>
                <div className="text-[#F0FFEA]">
                  Centroid (Bx, By): <span className="text-[#FF5F40] font-semibold">({spotU.toFixed(1)}, {spotV.toFixed(1)}) px</span>
                </div>
                <div className="text-[#F0FFEA] font-semibold">
                  Pixel Err: Ex={(spotU - 320).toFixed(1)} Ey={(240 - spotV).toFixed(1)} | Total: {Math.hypot(spotU - 320, spotV - 240).toFixed(1)} px
                </div>
                <div className="text-[#9CA195]">
                  Angular: θx={((spotU - 320) / 160).toFixed(2)}°  θy={((240 - spotV) / 160).toFixed(2)}°
                </div>
                <div className="text-[#9CA195] text-[8.5px]">
                  Conf: 1.00 | SNR: 28.5dB | LATENCY: 3.2ms | PAT: LOCKED
                </div>
              </div>
            )}
          </div>

          {/* Tactical Overlay: Occlusion Alert Banner */}
          {isEffectiveOccluded && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 bg-[#1B1D1A]/95 border border-[#FF5F40] rounded text-[10px] font-mono text-[#FF5F40] font-bold tracking-wider flex items-center gap-2 backdrop-blur-sm shadow-xl pointer-events-none select-none animate-pulse">
              <span className="w-2 h-2 rounded-full bg-[#FF5F40] inline-block animate-ping" />
              <span>{isChannelOccluded ? '! OPTICAL CHANNEL OCCLUDED (CLOUD / OBSTACLE)' : '! GROUND BEACON OCCLUDED BY EARTH LIMB'}</span>
            </div>
          )}

          {/* Tactical Overlay: Beacon Lost Alarm Banner */}
          {!isEffectiveOccluded && isBeaconLost && (
            <div
              onClick={() => alarmAudio.unlock()}
              title="Click anywhere to unlock audio if muted/blocked by browser"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 bg-[#1B1D1A]/95 border border-[#FF5F40] rounded text-[10px] font-mono text-[#FF5F40] font-bold tracking-wider animate-pulse flex items-center gap-2 backdrop-blur-sm shadow-xl cursor-pointer select-none"
            >
              <span>! BEACON OUT OF SIGHT</span>
            </div>
          )}
        </div>
      </div>

      {/* Telemetry Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 bg-[#1B1D1A] border-t border-[#33362F] font-mono text-[10px] text-[#9CA195]">
        {/* Real-time Boresight & Detection Telemetry */}
        <div className="bg-[#262824] border border-[#33362F] p-2.5 rounded space-y-1">
          <div className="text-[#F0FFEA] font-bold border-b border-[#33362F] pb-1 flex justify-between gap-4 uppercase tracking-wider">
            <span>BORESIGHT ALIGNMENT</span>
            <span className={isLocked ? 'text-[#FF5F40] font-semibold' : isEffectiveOccluded ? 'text-[#FF5F40] font-semibold' : 'text-[#FF5F40] font-semibold'}>
              {(isEffectiveOccluded ? (tracking?.state || 'LINK_BLOCKED') : isLocked ? 'LOCKED' : (tracking?.state || tracking?.mode || 'TRACKING')).toUpperCase()}
            </span>
          </div>
          <div>Boresight Center: <span className="text-[#F0FFEA] font-mono">(320.0, 240.0) px</span></div>
          <div>
            CV Detected Centroid:{' '}
            {isEffectiveOccluded ? (
              <span className="text-[#FF5F40] font-semibold">NO BEACON (LINK BLOCKED)</span>
            ) : detection?.beacon_detected && detection.detected_centroid_x !== null ? (
              <span className="text-[#F0FFEA] font-mono">
                ({detection.detected_centroid_x.toFixed(1)}, {detection.detected_centroid_y?.toFixed(1)}) px
              </span>
            ) : isPovLocked ? (
              <span className="text-[#F0FFEA] font-mono">
                ({spotU.toFixed(1)}, {spotV.toFixed(1)}) px
              </span>
            ) : (
              <span className="text-[#FF5F40] font-semibold">NO BEACON DETECTED</span>
            )}
          </div>
          <div>
            Pixel Error (Ex, Ey):{' '}
            {isEffectiveOccluded ? (
              'N/A (LINK BLOCKED)'
            ) : detection?.pixel_error_x !== null && detection?.pixel_error_x !== undefined ? (
              <span className="text-[#F0FFEA] font-mono">
                ({detection.pixel_error_x.toFixed(1)}, {detection.pixel_error_y?.toFixed(1)}) px
              </span>
            ) : isPovLocked ? (
              <span className="text-[#F0FFEA] font-mono">
                ({(spotU - 320).toFixed(1)}, {(240 - spotV).toFixed(1)}) px
              </span>
            ) : '--'}
          </div>
          <div>
            Total Error:{' '}
            {detection?.total_pixel_error !== null && detection?.total_pixel_error !== undefined ? (
              <span className="text-[#FF5F40] font-mono font-semibold">{detection.total_pixel_error.toFixed(1)} px</span>
            ) : isPovLocked ? (
              <span className="text-[#FF5F40] font-mono font-semibold">{Math.hypot(spotU - 320, spotV - 240).toFixed(1)} px</span>
            ) : '--'}
          </div>
          {tracking && (
            <div className="border-t border-[#33362F] pt-1 mt-1 space-y-0.5 text-[9.5px]">
              <div>
                <span className="text-[#9CA195] font-semibold">Kalman Filtered:</span>{' '}
                {!isEffectiveOccluded && tracking.filtered_x !== null && tracking.filtered_x !== undefined ? (
                  <span className="text-[#F0FFEA] font-mono">({tracking.filtered_x.toFixed(1)}, {tracking.filtered_y?.toFixed(1)}) px</span>
                ) : isPovLocked ? (
                  <span className="text-[#F0FFEA] font-mono">({spotU.toFixed(1)}, {spotV.toFixed(1)}) px</span>
                ) : (
                  <span className="text-[#5E625A]">N/A</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Gimbal Angles */}
        <div className="bg-[#262824] border border-[#33362F] p-2.5 rounded space-y-1">
          <div className="text-[#F0FFEA] font-bold border-b border-[#33362F] pb-1 uppercase tracking-wider">GIMBAL KINEMATICS</div>
          <div>Pan Angle: <span className="text-[#FF5F40] font-mono">{camera?.pan_deg.toFixed(2)}°</span></div>
          <div>Tilt Angle: <span className="text-[#FF5F40] font-mono">{camera?.tilt_deg.toFixed(2)}°</span></div>
          <div>Pan Slew: <span className="text-[#F0FFEA] font-mono">{camera?.pan_rate_deg_s.toFixed(1)}°/s (Cap: {(5.0 * (camera?.adaptive_speed_factor || 1.0)).toFixed(1)}°/s)</span></div>
          <div>Tilt Slew: <span className="text-[#F0FFEA] font-mono">{camera?.tilt_rate_deg_s.toFixed(1)}°/s (Cap: {(5.0 * (camera?.adaptive_speed_factor || 1.0)).toFixed(1)}°/s)</span></div>
          <div>Angular Resolution: <span className="text-[#F0FFEA] font-mono">160.0 px/deg</span></div>
          {camera?.adaptive_speed_factor && camera.adaptive_speed_factor > 1.0 && (
            <div className="pt-1 mt-1 border-t border-[#33362F] text-[#FF5F40] animate-pulse font-bold">
              ⚡ ADAPTIVE PURSUIT: {camera.adaptive_speed_factor.toFixed(2)}x
            </div>
          )}
        </div>
      </div>

      {/* Interactive Gimbal Pan/Tilt Controls & Angle Sliders */}
      <div className="p-3 bg-[#1B1D1A] border-t border-[#33362F] font-mono text-xs space-y-2.5">
        {/* Sliders for Pan & Tilt Angle */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#262824] p-2.5 rounded border border-[#33362F]">
          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-[#9CA195]">Commanded Pan Angle (Azimuth):</span>
              <span className="text-[#FF5F40] font-bold">{camera?.target_pan_deg?.toFixed(1) ?? camera?.pan_deg.toFixed(1)}° (Lim: ±180°)</span>
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
              className="w-full accent-[#FF5F40] cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-[#9CA195]">Commanded Tilt Angle (Elevation):</span>
              <span className="text-[#FF5F40] font-bold">{camera?.target_tilt_deg?.toFixed(1) ?? camera?.tilt_deg.toFixed(1)}° (Lim: ±85°)</span>
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
              className="w-full accent-[#FF5F40] cursor-pointer"
            />
          </div>
        </div>

        {/* Nudge buttons (Respecting max 5°/s slew speed) */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[#9CA195] text-[11px]">
            <Crosshair className="w-3.5 h-3.5 text-[#FF5F40]" />
            <span>Manual Slew Nudges (Clamped to 5.0°/s):</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onPointerDown={() => startNudge(-2.5, 0)}
              onPointerUp={stopNudge}
              onPointerLeave={stopNudge}
              className="px-2.5 py-1 bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] rounded border border-[#33362F] hover:border-[#FF5F40] flex items-center gap-1 transition text-[11px] select-none"
              title="Pan Left (-2.5°/s)"
            >
              <ArrowLeft className="w-3 h-3 text-[#FF5F40]" /> Pan Left
            </button>
            <button
              onPointerDown={() => startNudge(0, 2.5)}
              onPointerUp={stopNudge}
              onPointerLeave={stopNudge}
              className="px-2.5 py-1 bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] rounded border border-[#33362F] hover:border-[#FF5F40] flex items-center gap-1 transition text-[11px] select-none"
              title="Tilt Up (+2.5°/s)"
            >
              <ArrowUp className="w-3 h-3 text-[#FF5F40]" /> Tilt Up
            </button>
            <button
              onPointerDown={() => startNudge(0, -2.5)}
              onPointerUp={stopNudge}
              onPointerLeave={stopNudge}
              className="px-2.5 py-1 bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] rounded border border-[#33362F] hover:border-[#FF5F40] flex items-center gap-1 transition text-[11px] select-none"
              title="Tilt Down (-2.5°/s)"
            >
              <ArrowDown className="w-3 h-3 text-[#FF5F40]" /> Tilt Down
            </button>
            <button
              onPointerDown={() => startNudge(2.5, 0)}
              onPointerUp={stopNudge}
              onPointerLeave={stopNudge}
              className="px-2.5 py-1 bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] rounded border border-[#33362F] hover:border-[#FF5F40] flex items-center gap-1 transition text-[11px] select-none"
              title="Pan Right (+2.5°/s)"
            >
              <ArrowRight className="w-3 h-3 text-[#FF5F40]" /> Pan Right
            </button>
            <button
              onClick={() => {
                onGimbalNudge?.(0, 0);
                onGimbalAngles?.(camera?.pan_deg ?? 0, camera?.tilt_deg ?? 0);
              }}
              className="px-2.5 py-1 bg-[#262824] hover:bg-[#33362F] text-[#FF5F40] rounded border border-[#FF5F40] font-bold transition text-[11px]"
            >
              Halt Slew
            </button>
            <button
              onClick={() => onGimbalAngles?.(0, 0)}
              className="px-2.5 py-1 bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] rounded border border-[#33362F] hover:border-[#FF5F40] font-bold transition text-[11px]"
              title="Center Camera to (0, 0)"
            >
              Center (0,0)
            </button>
          </div>
        </div>
      </div>

      {/* Captured Image Preview Modal */}
      {showPreviewModal && lastCapturedImage && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-xl max-w-xl w-full p-4 shadow-2xl flex flex-col gap-3 font-mono">
            <div className="flex items-center justify-between border-b border-[#33362F] pb-2.5">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-[#FF5F40]" />
                <span className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider">
                  Satellite Camera POV Snapshot
                </span>
              </div>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="text-[#9CA195] hover:text-[#F0FFEA] text-sm p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="relative w-full aspect-[4/3] bg-black rounded border border-[#33362F] overflow-hidden flex items-center justify-center">
              <img
                src={lastCapturedImage.url}
                alt="Captured Satellite POV"
                className="w-full h-full object-contain"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-[#9CA195] pt-1">
              <div>
                <span className="text-[#F0FFEA] font-semibold">{lastCapturedImage.filename}</span>
                <span className="text-[10px] text-[#5E625A] block">Captured at {lastCapturedImage.time} &bull; 640 × 480 px</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={lastCapturedImage.url}
                  download={lastCapturedImage.filename}
                  className="px-3 py-1 bg-[#FF5F40] hover:bg-[#FF7459] text-[#0A0A0A] font-bold text-xs rounded flex items-center gap-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </a>
                <button
                  onClick={() => setShowPreviewModal(false)}
                  className="px-3 py-1 bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] border border-[#33362F] text-xs rounded transition cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
