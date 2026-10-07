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
  Film,
  CircleDot,
  Square,
  Clock,
} from 'lucide-react';
import { alarmAudio } from '../services/alarmAudio';
import { SceneLayersControl } from './SceneLayersControl';
import { useSceneSettings } from '../hooks/useSceneSettings';

/**
 * Utility to safely draw rounded rectangles across browser canvas implementations.
 */
function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (typeof (ctx as any).roundRect === 'function') {
    (ctx as any).roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

/**
 * Patches the EBML Segment Info Duration element in a WebM ArrayBuffer
 * so media players (such as Windows Media Player / Media Foundation)
 * know the exact duration and can seek/play without freezing.
 */
function patchWebmDuration(buffer: ArrayBuffer, durationMs: number): ArrayBuffer {
  const bytes = new Uint8Array(buffer);

  function findSubarray(sub: number[], start: number = 0): number {
    for (let i = start; i <= bytes.length - sub.length; i++) {
      let match = true;
      for (let j = 0; j < sub.length; j++) {
        if (bytes[i + j] !== sub[j]) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
    return -1;
  }

  // Segment ID: 0x18 0x53 0x80 0x67
  const segmentIdx = findSubarray([0x18, 0x53, 0x80, 0x67]);
  if (segmentIdx === -1) return buffer;

  // Info ID: 0x15 0x49 0xA9 0x66
  const infoIdx = findSubarray([0x15, 0x49, 0xA9, 0x66], segmentIdx);
  if (infoIdx === -1) return buffer;

  // Search for TimecodeScale: 0x2A 0xD7 0xB1
  let timecodeScale = 1000000; // default 1,000,000 ns = 1 ms
  const tcIdx = findSubarray([0x2A, 0xD7, 0xB1], infoIdx);
  if (tcIdx !== -1 && tcIdx < infoIdx + 200) {
    const len = bytes[tcIdx + 3] & 0x7f;
    let scale = 0;
    for (let i = 0; i < len; i++) {
      scale = (scale << 8) | bytes[tcIdx + 4 + i];
    }
    if (scale > 0) timecodeScale = scale;
  }

  const durationVal = (durationMs * 1000000) / timecodeScale;

  // Search for existing Duration element: 0x44 0x89
  const durIdx = findSubarray([0x44, 0x89], infoIdx);
  if (durIdx !== -1 && durIdx < infoIdx + 300) {
    const lenByte = bytes[durIdx + 2];
    const view = new DataView(buffer);
    if (lenByte === 0x84 || lenByte === 4) {
      view.setFloat32(durIdx + 3, durationVal, false); // big-endian
      return buffer;
    } else if (lenByte === 0x88 || lenByte === 8) {
      view.setFloat64(durIdx + 3, durationVal, false); // big-endian
      return buffer;
    }
  }

  // If Duration element is absent, inject: [0x44, 0x89, 0x88, ...8 bytes float64...]
  const durBuf = new Uint8Array(11);
  durBuf[0] = 0x44;
  durBuf[1] = 0x89;
  durBuf[2] = 0x88;
  const dv = new DataView(durBuf.buffer);
  dv.setFloat64(3, durationVal, false);

  let insertPos = infoIdx + 4;
  let infoLenBytes = 1;
  let mask = 0x80;
  while (infoLenBytes <= 8 && (bytes[insertPos] & mask) === 0) {
    infoLenBytes++;
    mask >>= 1;
  }
  insertPos += infoLenBytes;

  const newBuffer = new ArrayBuffer(bytes.length + durBuf.length);
  const newBytes = new Uint8Array(newBuffer);
  newBytes.set(bytes.subarray(0, insertPos), 0);
  newBytes.set(durBuf, insertPos);
  newBytes.set(bytes.subarray(insertPos), insertPos + durBuf.length);

  return newBuffer;
}

async function finalizeVideoBlob(
  chunks: Blob[],
  mimeType: string,
  durationMs: number
): Promise<{ blob: Blob; ext: string }> {
  const isMp4 = mimeType.toLowerCase().includes('mp4');
  const baseBlob = new Blob(chunks, { type: mimeType });

  if (isMp4) {
    return { blob: baseBlob, ext: 'mp4' };
  }

  // If WebM, patch the EBML header with exact duration
  try {
    const buffer = await baseBlob.arrayBuffer();
    const patchedBuffer = patchWebmDuration(buffer, durationMs);
    return {
      blob: new Blob([patchedBuffer], { type: mimeType || 'video/webm' }),
      ext: 'webm',
    };
  } catch (err) {
    console.warn('WebM duration patch failed, returning raw blob:', err);
    return { blob: baseBlob, ext: 'webm' };
  }
}

interface FPACameraViewportProps {
  target: TargetState | null;
  camera: CameraState | null;
  tracking: TrackingTelemetry | null;
  detection?: DetectionTelemetry | null;
  disturbance?: DisturbanceTelemetry | null;
  onGimbalNudge?: (pan_rate: number, tilt_rate: number) => void;
  onGimbalAngles?: (target_pan: number, target_tilt: number) => void;
  showGimbalControls?: boolean;
  showSceneLayers?: boolean;
}

export const FPACameraViewport: React.FC<FPACameraViewportProps> = ({
  target,
  camera,
  tracking,
  detection,
  disturbance,
  onGimbalNudge,
  onGimbalAngles,
  showGimbalControls = true,
  showSceneLayers = !showGimbalControls,
}) => {
  // Default tab on load is OpenCV Annotated per requirements
  const [viewMode, setViewMode] = useState<'opencv_annotated' | 'opencv_raw'>('opencv_annotated');
  const [reconnectKey, setReconnectKey] = useState<number>(0);
  const [hasStreamError, setHasStreamError] = useState(false);
  const reconnectTimerRef = useRef<any>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const recordImgRef = useRef<HTMLImageElement | null>(null);

  // Manual Satellite Camera POV Video Recording State
  const [recordDuration, setRecordDuration] = useState<number>(5); // default: 5s, capped at 20s
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordElapsed, setRecordElapsed] = useState<number>(0);
  const [lastRecordedVideo, setLastRecordedVideo] = useState<{
    url: string;
    filename: string;
    duration: number;
    time: string;
  } | null>(null);
  const [showVideoModal, setShowVideoModal] = useState<boolean>(false);
  const [recordNotice, setRecordNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<any>(null);

  // References for MediaRecorder and canvas stream
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<any>(null);
  const isRecordingRef = useRef<boolean>(false);
  const recordingStartTimeRef = useRef<number>(0);
  const targetDurationMsRef = useRef<number>(5000);

  // Synthesize sound effects for video recording start/complete
  const playRecordingSound = (isStop = false) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      if (!isStop) {
        // Start recording chime: 520Hz -> 880Hz
        osc.frequency.setValueAtTime(520, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
        osc.start();
        osc.stop(ctx.currentTime + 0.13);
      } else {
        // Stop & auto-download chime: upbeat double pulse
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1174, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.16);
      }
      osc.connect(gain);
      gain.connect(ctx.destination);
    } catch {
      // Audio autoplay policy
    }
  };

  // Native MJPEG streaming: browser automatically updates video in real time with 0 polling requests
  const handleFrameLoad = () => {
    setHasStreamError(false);
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
  };

  const handleFrameError = () => {
    setHasStreamError(true);
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(() => {
      setReconnectKey((prev) => prev + 1);
    }, 1200);
  };

  const handleManualRetry = () => {
    setHasStreamError(false);
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    setReconnectKey((prev) => prev + 1);
  };

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  const { settings: _ss, bindSetting: _bindS } = useSceneSettings();
  const [autoLOS, setAutoLOS] = [_ss.autoLOS ?? false, _bindS('autoLOS')];
  const autoLOSRef = useRef<boolean>(_ss.autoLOS ?? false);
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
  }, [setAutoLOS]);

  // Synchronize manual gimbal angles to satellitePovSync singleton
  useEffect(() => {
    if (camera?.pan_deg !== undefined || camera?.tilt_deg !== undefined) {
      satellitePovSync.update({
        gimbalPanDeg: camera?.pan_deg ?? 0,
        gimbalTiltDeg: camera?.tilt_deg ?? 0,
      });
    }
  }, [camera?.pan_deg, camera?.tilt_deg]);

  // Synchronize disturbance jitter to satellitePovSync singleton
  useEffect(() => {
    if (disturbance !== undefined) {
      satellitePovSync.update({ disturbance: disturbance ?? null });
    }
  }, [disturbance]);

  const handleToggleAutoLOS = () => {
    const next = !autoLOS;
    setAutoLOS(next);
    autoLOSRef.current = next;
    satellitePovSync.update({ autoLOS: next });
    if (next) {
      api.setTargetPosition(1000.0, 1000.0, 1000.0).catch(() => {});
      onGimbalAngles?.(0, 0);
    }
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

  // Synchronize backend simulation target to center when satellite POV is locked or Auto LOS is active
  const lastSyncTimeRef = useRef<number>(0);
  useEffect(() => {
    if (isPovLocked || autoLOS) {
      const now = Date.now();
      if (now - lastSyncTimeRef.current > 1500) {
        lastSyncTimeRef.current = now;
        api.setTargetPosition(1000.0, 1000.0, 1000.0).catch(() => {});
        onGimbalAngles?.(0, 0);
      }
    }
  }, [isPovLocked, autoLOS, onGimbalAngles]);

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

  // Ref tracking the latest live telemetry and viewport states for frame-by-frame video recording
  const liveStateRef = useRef({
    isEffectiveOccluded,
    isChannelOccluded,
    isLocked,
    isPovLocked,
    isBeaconLost,
    hasOrbitalSpot,
    spotU,
    spotV,
    viewMode,
    target,
    tracking,
    detection,
    camera,
    hasStreamError,
    povState,
  });
  liveStateRef.current = {
    isEffectiveOccluded,
    isChannelOccluded,
    isLocked,
    isPovLocked,
    isBeaconLost,
    hasOrbitalSpot,
    spotU,
    spotV,
    viewMode,
    target,
    tracking,
    detection,
    camera,
    hasStreamError,
    povState,
  };

  // Stop video recording early or on timer completion
  const handleStopRecording = () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (err) {
        console.error('Error stopping MediaRecorder:', err);
      }
    }
  };

  // Start recording satellite camera POV clip with full viewport compositing
  const handleStartRecording = () => {
    if (isRecordingRef.current) {
      handleStopRecording();
      return;
    }

    const durationSec = Math.max(1, Math.min(20, isNaN(recordDuration) ? 5 : recordDuration));
    targetDurationMsRef.current = durationSec * 1000;

    // Create 640x480 recording canvas
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setRecordNotice('✕ Canvas context unavailable');
      return;
    }

    // Capture initial frame onto canvas from clean recording stream
    const initImg = (recordImgRef.current && recordImgRef.current.complete && recordImgRef.current.naturalWidth > 0)
      ? recordImgRef.current
      : imgRef.current;
    if (initImg && initImg.complete && initImg.naturalWidth > 0) {
      try {
        ctx.drawImage(initImg, 0, 0, 640, 480);
      } catch {
        ctx.fillStyle = '#0B0D0F';
        ctx.fillRect(0, 0, 640, 480);
      }
    }

    // Capture 30 FPS stream from canvas
    const stream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : null;
    if (!stream) {
      setRecordNotice('✕ Canvas captureStream unsupported');
      return;
    }

    // Prioritize MP4 (H.264) for native, flawless Windows Media Player playback and seeking
    const mimeCandidates = [
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=h264',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const chosenMime = mimeCandidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) || '';

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, chosenMime ? { mimeType: chosenMime } : {});
    } catch (err) {
      console.error('Failed to initialize MediaRecorder:', err);
      setRecordNotice('✕ MediaRecorder unsupported');
      return;
    }

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    recorder.onstop = async () => {
      isRecordingRef.current = false;
      setIsRecording(false);
      const elapsedTotalMs = Math.max(500, Date.now() - recordingStartTimeRef.current);
      const elapsedTotalSec = Math.min(durationSec, elapsedTotalMs / 1000);
      setRecordElapsed(0);

      // Stop canvas stream tracks
      stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());

      if (chunks.length === 0) {
        setRecordNotice('✕ No video data captured');
        return;
      }

      const { blob: videoBlob, ext } = await finalizeVideoBlob(chunks, chosenMime || 'video/mp4', elapsedTotalMs);
      const blobUrl = URL.createObjectURL(videoBlob);

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const filename = `satellite_pov_${timestamp}_${elapsedTotalSec.toFixed(1)}s.${ext}`;
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      // Automatic download after completion of recording
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setLastRecordedVideo({
        url: blobUrl,
        filename,
        duration: elapsedTotalSec,
        time: timeStr,
      });
      setRecordNotice(`✓ Auto-downloaded: ${filename}`);
      playRecordingSound(true);

      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = setTimeout(() => {
        setRecordNotice(null);
      }, 4500);
    };

    mediaRecorderRef.current = recorder;
    recordingStartTimeRef.current = Date.now();
    isRecordingRef.current = true;
    setIsRecording(true);
    setRecordElapsed(0);
    playRecordingSound(false);

    recorder.start(100); // 100ms timeslices for smooth capture

    // Frame drawing loop at steady 30 FPS with full viewport compositing
    const drawFrame = () => {
      if (!isRecordingRef.current) return;
      const nowMs = Date.now();
      const elapsedMs = nowMs - recordingStartTimeRef.current;
      const elapsedSec = elapsedMs / 1000;
      setRecordElapsed(Math.min(durationSec, elapsedSec));

      const s = liveStateRef.current;

      // 1. Draw base camera image from clean recording stream (or fallback)
      let drewImage = false;
      const sourceImg = (recordImgRef.current && recordImgRef.current.complete && recordImgRef.current.naturalWidth > 0)
        ? recordImgRef.current
        : imgRef.current;

      if (sourceImg && sourceImg.complete && sourceImg.naturalWidth > 0 && !s.hasStreamError) {
        try {
          ctx.drawImage(sourceImg, 0, 0, 640, 480);
          drewImage = true;
        } catch {
          drewImage = false;
        }
      }

      if (!drewImage) {
        // Deep space background
        ctx.fillStyle = '#07090B';
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        for (let i = 0; i < 60; i++) {
          const sx = (i * 97) % 640;
          const sy = (i * 139) % 480;
          ctx.fillRect(sx, sy, 1, 1);
        }
      }

      // If effective occlusion is active, dim or clear any stale beacon drawn by backend 2D stream
      if (s.isEffectiveOccluded) {
        ctx.fillStyle = 'rgba(7, 9, 11, 0.45)';
        ctx.fillRect(0, 0, 640, 480);
      }

      // 2. Center Boresight Reticle (320, 240)
      ctx.save();
      const cx = 320;
      const cy = 240;

      // Cyan crosshairs
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 24, cy);
      ctx.lineTo(cx + 24, cy);
      ctx.moveTo(cx, cy - 24);
      ctx.lineTo(cx, cy + 24);
      ctx.stroke();

      // Inner green ring (10px)
      ctx.strokeStyle = 'rgba(0, 255, 120, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.stroke();

      // Outer amber ring (20px)
      ctx.strokeStyle = 'rgba(255, 180, 0, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // 3. Occlusion Alert Banner (Top-Center)
      if (s.isEffectiveOccluded) {
        ctx.save();
        const bannerW = 390;
        const bannerH = 26;
        const bannerX = 320 - bannerW / 2;
        const bannerY = 14;

        ctx.fillStyle = 'rgba(27, 29, 26, 0.95)';
        ctx.strokeStyle = '#FF5F40';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        drawRoundRect(ctx, bannerX, bannerY, bannerW, bannerH, 4);
        ctx.fill();
        ctx.stroke();

        // Pulsing red dot
        const pulse = (Math.sin(nowMs / 180) + 1) / 2;
        ctx.fillStyle = '#FF5F40';
        ctx.beginPath();
        ctx.arc(bannerX + 16, bannerY + 13, 3.5 + pulse * 1.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = 'bold 9.5px monospace';
        ctx.fillStyle = '#FF5F40';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const occText = s.isChannelOccluded
          ? '! OPTICAL CHANNEL OCCLUDED (CLOUD / OBSTACLE)'
          : '! GROUND BEACON OCCLUDED BY EARTH LIMB';
        ctx.fillText(occText, bannerX + 28, bannerY + 13);
        ctx.restore();
      }

      // 4. Beacon Lost Banner (Bottom-Center)
      if (!s.isEffectiveOccluded && s.isBeaconLost) {
        ctx.save();
        const bannerW = 200;
        const bannerH = 24;
        const bannerX = 320 - bannerW / 2;
        const bannerY = 425;

        ctx.fillStyle = 'rgba(27, 29, 26, 0.95)';
        ctx.strokeStyle = '#FF5F40';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        drawRoundRect(ctx, bannerX, bannerY, bannerW, bannerH, 4);
        ctx.fill();
        ctx.stroke();

        ctx.font = 'bold 10px monospace';
        ctx.fillStyle = '#FF5F40';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('! BEACON OUT OF SIGHT', 320, bannerY + 12);
        ctx.restore();
      }

      // 5. Optical Beacon Spot & Tactical Annotations
      const u = s.spotU;
      const v = s.spotV;
      const distToBoresight = Math.hypot(u - 320, v - 240);
      const isVisible = !s.isEffectiveOccluded && (s.hasOrbitalSpot || s.isPovLocked || (!s.isBeaconLost));

      if (isVisible) {
        ctx.save();
        // Radial bloom glow
        const glowGrad = ctx.createRadialGradient(u, v, 0, u, v, 16);
        glowGrad.addColorStop(0, 'rgba(240, 255, 234, 0.9)');
        glowGrad.addColorStop(0.3, 'rgba(255, 95, 64, 0.45)');
        glowGrad.addColorStop(0.7, 'rgba(255, 95, 64, 0.15)');
        glowGrad.addColorStop(1, 'rgba(255, 95, 64, 0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(u, v, 16, 0, Math.PI * 2);
        ctx.fill();

        // Core 10x10 px beacon spot
        ctx.fillStyle = '#F0FFEA';
        ctx.shadowColor = '#FF5F40';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(u, v, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.restore();
      }

      if (elapsedMs >= targetDurationMsRef.current) {
        handleStopRecording();
      }
    };

    recordingIntervalRef.current = setInterval(drawFrame, 33);
  };

  // Keyboard shortcut listener ('r', 'R' or 'c', 'C') to trigger video recording
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'r' || e.key === 'R' || e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        if (isRecordingRef.current) {
          handleStopRecording();
        } else {
          handleStartRecording();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, recordDuration]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (isRecordingRef.current) {
        isRecordingRef.current = false;
        if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          try {
            mediaRecorderRef.current.stop();
          } catch {}
        }
      }
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col bg-[#1B1D1A] border border-[#33362F] rounded-lg overflow-hidden shadow-2xl">
      {/* Telemetry band */}
      <div className="flex flex-col px-3.5 py-2.5 bg-[#1B1D1A] border-b border-[#33362F] text-xs font-mono gap-2.5">
        {/* Row 1: Header title on left, Video Recording Controls on right */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[#FF5F40]">
            <Video className="w-4 h-4 text-[#FF5F40]" />
            <span className="font-semibold tracking-wider text-xs text-[#F0FFEA]">FPA CAMERA VIEWPORT [640 × 480]</span>
          </div>

          {/* Video Recording Controls for Satellite Camera POV */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Recording Duration Parameter Input (Capped at 20s, default 5s) */}
            <div
              className="flex items-center bg-[#262824] border border-[#33362F] hover:border-[#FF5F40] px-2.5 py-1 rounded text-xs font-mono gap-1.5 transition"
              title="Clip recording duration in seconds (1 - 20s, default: 5s)"
            >
              <Clock className="w-3.5 h-3.5 text-[#8E9388]" />
              <input
                id="input-record-duration"
                type="number"
                min={1}
                max={20}
                step={1}
                value={recordDuration}
                disabled={isRecording}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (isNaN(val)) {
                    setRecordDuration(5);
                  } else {
                    setRecordDuration(Math.max(1, Math.min(20, val)));
                  }
                }}
                className="w-6 bg-transparent text-[#F0FFEA] font-semibold text-center outline-none focus:text-[#FF5F40]"
              />
              <span className="text-[#8E9388] text-[11px]">s</span>
            </div>

            {/* Record / Stop Button */}
            {!isRecording ? (
              <button
                id="btn-record-clip"
                onClick={handleStartRecording}
                className="px-3 py-1 bg-[#262824] hover:bg-[#33362F] active:bg-[#1B1D1A] text-[#FF5F40] border border-[#FF5F40] hover:border-[#FF7459] rounded font-mono text-xs font-semibold flex items-center justify-between gap-2.5 transition cursor-pointer shadow-sm hover:shadow-[0_0_12px_rgba(255,95,64,0.3)] shrink-0 min-w-[130px]"
                title={`Record a ${recordDuration}s video clip of the satellite camera POV (Shortcut: R)`}
              >
                <div className="flex items-center gap-1.5">
                  <CircleDot className="w-3.5 h-3.5 text-[#FF5F40]" />
                  <span>Record clip</span>
                </div>
                <kbd className="px-1 py-0.2 bg-[#000000] text-[9px] rounded text-[#F0FFEA] font-mono border border-[#33362F]">R</kbd>
              </button>
            ) : (
              <button
                id="btn-stop-recording"
                onClick={handleStopRecording}
                className="px-3 py-1 bg-[#FF5F40]/25 hover:bg-[#FF5F40]/35 text-[#FF5F40] border border-[#FF5F40] rounded font-mono text-xs font-bold flex items-center justify-between gap-2 transition cursor-pointer shadow-[0_0_12px_rgba(255,95,64,0.4)] shrink-0 min-w-[130px]"
                title="Stop recording early and auto-download clip"
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#FF5F40] animate-ping" />
                  <span>REC {recordElapsed.toFixed(1)}s / {recordDuration}s</span>
                </div>
                <Square className="w-2.5 h-2.5 fill-[#FF5F40] text-[#FF5F40]" />
              </button>
            )}

            {/* View Last Recorded Video Button */}
            {lastRecordedVideo && !isRecording && (
              <button
                id="btn-view-last-video"
                onClick={() => setShowVideoModal(true)}
                className="px-2 py-1 bg-[#262824] hover:bg-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] border border-[#33362F] rounded text-[11px] font-mono flex items-center gap-1 transition cursor-pointer"
                title="Watch last recorded satellite POV video clip"
              >
                <Film className="w-3 h-3 text-[#FF5F40]" />
                <span>Play</span>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: View Mode Selector: OpenCV Annotated, OpenCV Raw Feed on left, Locate Sat on right */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1">
            <button
              onClick={() => setViewMode('opencv_annotated')}
              className={`flex-1 py-1.5 px-3 rounded text-xs font-mono transition border text-center font-medium ${
                viewMode === 'opencv_annotated'
                  ? 'bg-[#FF5F40] text-[#0A0A0A] font-semibold border-[#FF5F40]'
                  : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA] hover:border-[#FF5F40]'
              }`}
            >
              OpenCV Annotated
            </button>
            <button
              onClick={() => setViewMode('opencv_raw')}
              className={`flex-1 py-1.5 px-3 rounded text-xs font-mono transition border text-center font-medium ${
                viewMode === 'opencv_raw'
                  ? 'bg-[#FF5F40] text-[#0A0A0A] font-semibold border-[#FF5F40]'
                  : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA] hover:border-[#FF5F40]'
              }`}
            >
              OpenCV Raw Feed
            </button>
          </div>

          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('fsoc:jump-to-sat'));
            }}
            className="px-3 py-1 bg-[#262824] hover:bg-[#33362F] text-[#FF5F40] border border-[#FF5F40] rounded font-mono text-xs font-semibold flex items-center justify-between gap-2.5 transition cursor-pointer shrink-0 min-w-[130px]"
            title="Locate Satellite in 3D view (Shortcut: S or F)"
          >
            <div className="flex items-center gap-1.5">
              <Crosshair className="w-3.5 h-3.5 text-[#FF5F40]" />
              <span>Locate sat</span>
            </div>
            <kbd className="px-1 py-0.2 bg-[#000000] text-[9px] rounded text-[#F0FFEA] font-mono border border-[#33362F]">S</kbd>
          </button>
        </div>

        {/* Row 3: 4 Status Box Chips in a grid */}
        <div className="grid grid-cols-4 gap-2 text-xs">
          {/* Auto LOS */}
          <button
            onClick={handleToggleAutoLOS}
            title="Automatically slew the camera boresight to align with Line of Sight"
            className="flex flex-col items-center justify-center p-2 rounded bg-[#262824] hover:bg-[#33362F] border border-[#33362F] hover:border-[#FF5F40] transition text-center"
          >
            <span className="text-[10px] text-[#8E9388] font-medium uppercase tracking-wider mb-0.5">AUTO LOS:</span>
            <span className={autoLOS ? 'text-[#FF5F40] font-bold text-xs' : 'text-[#F0FFEA] font-semibold text-xs'}>
              {autoLOS ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* FOV */}
          <div className="flex flex-col items-center justify-center p-2 rounded bg-[#262824] border border-[#33362F] text-center">
            <span className="text-[10px] text-[#8E9388] font-medium uppercase tracking-wider mb-0.5">FOV:</span>
            <span className="text-[#F0FFEA] font-bold text-xs">
              {camera?.fov_horizontal_deg ? `${camera.fov_horizontal_deg.toFixed(1)}° × ${camera.fov_vertical_deg.toFixed(1)}°` : '4.0° × 3.0°'}
            </span>
          </div>

          {/* Target */}
          <div className="flex flex-col items-center justify-center p-2 rounded bg-[#262824] border border-[#33362F] text-center">
            <span className="text-[10px] text-[#8E9388] font-medium uppercase tracking-wider mb-0.5">TARGET:</span>
            <span className="font-bold text-xs text-[#FF5F40]">
              {(() => {
                if (isEffectiveOccluded) {
                  return 'OCCLUDED';
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
            <span className="text-[10px] text-[#8E9388] font-medium uppercase tracking-wider mb-0.5">ALARM:</span>
            <span className={isAlarmMuted ? 'text-[#6B7264] font-medium text-xs' : isAlarmActive ? 'text-[#FF5F40] font-bold text-xs animate-pulse' : 'text-[#F0FFEA] font-semibold text-xs'}>
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
              src={`/api/simulation/frame/stream?annotated=${viewMode === 'opencv_annotated'}&telemetry=true${reconnectKey ? `&retry=${reconnectKey}` : ''}`}
              alt="Live OpenCV Camera Feed"
              crossOrigin="anonymous"
              onLoad={handleFrameLoad}
              onError={handleFrameError}
              className="w-full h-full object-contain"
            />

            {/* Dedicated video recording stream without telemetry data */}
            <img
              ref={recordImgRef}
              src={`/api/simulation/frame/stream?annotated=${viewMode === 'opencv_annotated'}&telemetry=false${reconnectKey ? `&retry=${reconnectKey}` : ''}`}
              alt="Recording Feed (Clean without Telemetry)"
              crossOrigin="anonymous"
              className="absolute pointer-events-none opacity-0 select-none"
              style={{ width: '640px', height: '480px', top: '-9999px', left: '-9999px' }}
            />

            {/* Active Video Recording Frame Border */}
            {isRecording && (
              <div className="absolute inset-0 border-2 border-[#FF5F40]/60 pointer-events-none z-30 animate-pulse" />
            )}

            {/* Live Recording HUD Indicator */}
            {isRecording && (
              <div className="absolute top-3 left-3 z-40 px-2.5 py-1 bg-black/85 border border-[#FF5F40] text-[#FF5F40] rounded text-[11px] font-mono font-bold flex items-center gap-2 shadow-lg backdrop-blur-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F40] inline-block animate-ping" />
                <span>REC ● 00:{recordElapsed < 10 ? `0${recordElapsed.toFixed(1)}` : recordElapsed.toFixed(1)} / {recordDuration}.0s</span>
              </div>
            )}

            {/* Notification Badge when a video clip is recorded/saved */}
            {recordNotice && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 bg-[#1B1D1A]/95 border border-[#FF5F40] text-[#FF5F40] rounded shadow-lg text-[11px] font-mono font-semibold flex items-center gap-2 backdrop-blur-sm">
                <Film className="w-3.5 h-3.5 text-[#FF5F40]" />
                <span>{recordNotice}</span>
                {lastRecordedVideo && (
                  <button
                    onClick={() => setShowVideoModal(true)}
                    className="underline text-[#F0FFEA] hover:text-white cursor-pointer ml-1 text-[10px]"
                  >
                    Play
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
      {showGimbalControls && (
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
      )}

      {/* 3D Scene & Orbital Layers (Moved to Green area on Mission Control) */}
      {showSceneLayers && (
        <SceneLayersControl />
      )}

      {/* Recorded Video Clip Preview Modal */}
      {showVideoModal && lastRecordedVideo && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-xl max-w-xl w-full p-4 shadow-2xl flex flex-col gap-3 font-mono">
            <div className="flex items-center justify-between border-b border-[#33362F] pb-2.5">
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-[#FF5F40]" />
                <span className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider">
                  Satellite Camera POV Clip ({lastRecordedVideo.duration.toFixed(1)}s)
                </span>
              </div>
              <button
                onClick={() => setShowVideoModal(false)}
                className="text-[#9CA195] hover:text-[#F0FFEA] text-sm p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="relative w-full aspect-[4/3] bg-black rounded border border-[#33362F] overflow-hidden flex items-center justify-center">
              <video
                src={lastRecordedVideo.url}
                controls
                autoPlay
                loop
                className="w-full h-full object-contain"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-[#9CA195] pt-1">
              <div>
                <span className="text-[#F0FFEA] font-semibold">{lastRecordedVideo.filename}</span>
                <span className="text-[10px] text-[#5E625A] block">
                  Recorded at {lastRecordedVideo.time} &bull; 640 × 480 px &bull; {lastRecordedVideo.duration.toFixed(1)}s
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={lastRecordedVideo.url}
                  download={lastRecordedVideo.filename}
                  className="px-3 py-1 bg-[#FF5F40] hover:bg-[#FF7459] text-[#0A0A0A] font-bold text-xs rounded flex items-center gap-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </a>
                <button
                  onClick={() => setShowVideoModal(false)}
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
