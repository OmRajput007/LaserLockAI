# FPA Camera Viewport: Satellite POV Video Recording Specification

> **Instructions for the Coding Agent:**  
> Implement the high-fidelity Satellite POV Video Recording feature in `frontend/src/simulation/FPACameraViewport.tsx`.  
> Follow the complete specification below to replace the legacy snapshot ("Click image") button with a full-featured video recorder that captures real-time FPA sensor views, complete with all tactical HUD overlays and occlusion indicators, while producing videos that play seamlessly in desktop media players (such as Windows Media Player).

---

## 1. Feature Overview & Requirements

### 1.1 Objective
Replace the static snapshot capture feature in the **FPA Camera Viewport** with an in-browser video recording engine that records the live satellite camera point of view (POV) at 640×480 resolution (30 FPS).

### 1.2 Core Requirements
1. **Configurable Duration Parameter**:
   - Add a numeric duration input directly into the viewport header.
   - Allowed range: **1 to 20 seconds** (capped at 20s maximum).
   - Default value: **5 seconds**.
2. **One-Click Recording & Auto-Download**:
   - Clicking **"Record clip"** (or pressing shortcut key **`R`**) starts recording.
   - The button transforms into an active recording state displaying live elapsed time (`REC X.Xs / Ys`) with an animated pulsing indicator.
   - Clicking the active recording button stops recording immediately.
   - Upon completion (either when duration expires or stopped manually), the video file is **automatically downloaded** to the user's computer with an informative aerospace filename (e.g., `satellite_pov_20261005_164500_5.0s.mp4`).
3. **In-App Video Preview Modal**:
   - Once a clip is recorded, a **"Play"** button appears next to the record controls.
   - Clicking **"Play"** opens a modal with a video player allowing instant review, playback looping, and manual re-download.
4. **Keyboard Shortcuts & Audio Cues**:
   - Global keyboard shortcut **`R`** (and **`C`** for backward compatibility) toggles recording start and stop.
   - Built-in Web Audio API chimes provide immediate feedback on recording start (rising chime) and completion/download (double pulse).

---

## 2. Critical Gotchas & Root Causes to Prevent

### 2.1 Viewport Compositing Mismatch (Visual Discrepancy)
- **Problem**: In Chromium/Blink, capturing only the underlying `<img>` element (`ctx.drawImage(imgRef.current)`) misses all dynamic React DOM overlays (e.g., the prominent `! GROUND BEACON OCCLUDED BY EARTH LIMB` banner, the optical spot bloom, the tracking box, the dashed lead line, and the status HUD). Additionally, drawing an MJPEG `<img>` onto a canvas often renders a single cached frame.
- **Solution**: The canvas recording loop (`drawFrame`) must act as a **full viewport compositor**, drawing:
  1. Camera background stream (or deep space starfield if stream is inactive or occluded).
  2. Boresight reticle (crosshairs, 10px inner green ring, 20px outer amber ring).
  3. Tactical Occlusion Banner (`! GROUND BEACON OCCLUDED BY EARTH LIMB` or `! OPTICAL CHANNEL OCCLUDED`).
  4. Beacon Lost Banner (`! BEACON OUT OF SIGHT`) when target is outside FOV.
  5. Optical Beacon Spot: radial bloom, core spot, 28×28 tracking box with corner brackets, dashed line to center with error label, and `BEACON #1 [x, y]` tactical tag.
  6. Tactical HUD Status Card (Top-Left): live centroid, pixel error, angular error, and PAT state.
  7. Badges and watermarks: `OPENCV LIVE STREAM` badge, aerospace timestamp watermark, and REC time counter.

### 2.2 Desktop Media Player Freeze (Windows Media Player Playback Failure)
- **Problem**: When `MediaRecorder` outputs WebM in Chromium, it omits the EBML `Duration` and `Cues` metadata from the Segment Info header because the final duration is unknown during streaming. The default Windows 10/11 Media Player ("Player" using Media Foundation) cannot parse files without a duration header, causing it to freeze on frame 0 with an unseekable scrubber.
- **Solution**:
  1. **MP4 Priority**: Prioritize `video/mp4;codecs=avc1` and `video/mp4` first in the MIME candidates list. Modern Chromium (Chrome & Edge on Windows) supports native MP4 recording out of the box, producing `.mp4` files that play with hardware acceleration and working seek bars in Windows Media Player.
  2. **EBML Duration Patching**: Provide a binary `patchWebmDuration()` utility as a fallback. When WebM is recorded, it parses the EBML buffer and injects the exact duration in milliseconds into the Segment Info header before triggering the download.

---

## 3. Implementation Steps

All changes are contained in:  
📁 `frontend/src/simulation/FPACameraViewport.tsx`

### Step 1: Update Lucide Icon Imports
Ensure the following icons are imported from `lucide-react`:
```typescript
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
```

---

### Step 2: Add Top-Level Helpers (Outside the Component)
Add these two helper functions above `export const FPACameraViewport`:

```typescript
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
```

---

### Step 3: Add Component State, Refs & Sound Synthesizer
Inside `FPACameraViewport`:
```typescript
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
```

---

### Step 4: Add Real-Time Live State Ref & Recording Engine
Place this logic **after** all viewport variables (`isEffectiveOccluded`, `spotU`, `spotV`, `isLocked`, `isBeaconLost`, etc.) are computed, right before `return (`:

```typescript
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

    // Capture initial frame onto canvas
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      try {
        ctx.drawImage(imgRef.current, 0, 0, 640, 480);
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

      // 1. Draw base camera image or fallback background
      let drewImage = false;
      if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0 && !s.hasStreamError) {
        try {
          ctx.drawImage(imgRef.current, 0, 0, 640, 480);
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

        if (s.viewMode === 'opencv_annotated') {
          // Dashed lead line to boresight
          if (distToBoresight > 4) {
            ctx.strokeStyle = '#FF5F40';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(320, 240);
            ctx.lineTo(u, v);
            ctx.stroke();
            ctx.setLineDash([]);

            // Midpoint error label
            const midX = (320 + u) / 2 + 6;
            const midY = (240 + v) / 2 - 4;
            ctx.fillStyle = '#FF5F40';
            ctx.font = 'bold 8.5px monospace';
            ctx.fillText(`E=${distToBoresight.toFixed(1)}px`, midX, midY);
          }

          // Tactical tracking box (28x28 px)
          const boxX = u - 14;
          const boxY = v - 14;
          ctx.strokeStyle = 'rgba(255, 95, 64, 0.9)';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(boxX, boxY, 28, 28);

          // 4 Corner brackets (2px thick)
          ctx.strokeStyle = '#FF5F40';
          ctx.lineWidth = 2;
          ctx.beginPath();
          // Top-Left
          ctx.moveTo(boxX, boxY + 5); ctx.lineTo(boxX, boxY); ctx.lineTo(boxX + 5, boxY);
          // Top-Right
          ctx.moveTo(boxX + 23, boxY); ctx.lineTo(boxX + 28, boxY); ctx.lineTo(boxX + 28, boxY + 5);
          // Bottom-Left
          ctx.moveTo(boxX, boxY + 23); ctx.lineTo(boxX, boxY + 28); ctx.lineTo(boxX + 5, boxY + 28);
          // Bottom-Right
          ctx.moveTo(boxX + 23, boxY + 28); ctx.lineTo(boxX + 28, boxY + 28); ctx.lineTo(boxX + 28, boxY + 23);
          ctx.stroke();

          // Tactical label tag
          const tagX = Math.min(480, Math.max(10, u + 18));
          const tagY = Math.min(440, Math.max(10, v - 12));
          const tagW = 145;
          const tagH = 26;

          ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
          ctx.strokeStyle = '#FF5F40';
          ctx.lineWidth = 1;
          ctx.beginPath();
          drawRoundRect(ctx, tagX, tagY, tagW, tagH, 3);
          ctx.fill();
          ctx.stroke();

          ctx.font = 'bold 8.5px monospace';
          ctx.fillStyle = '#FF5F40';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(`BEACON #${s.target?.target_id ?? 1} [${u.toFixed(1)}, ${v.toFixed(1)}]`, tagX + 6, tagY + 4);

          ctx.font = '8px monospace';
          ctx.fillStyle = '#F0FFEA';
          ctx.fillText(`${s.isLocked ? '✓ LOCKED IN FOV' : 'TRACKING'} | ERR: ${distToBoresight.toFixed(1)}px`, tagX + 6, tagY + 15);
        }
        ctx.restore();
      }

      // 6. Tactical HUD Status Card (Top-Left)
      if (s.viewMode === 'opencv_annotated') {
        ctx.save();
        const hudW = 270;
        const hudH = 105;
        const hudX = 8;
        const hudY = 8;

        ctx.fillStyle = 'rgba(15, 20, 30, 0.92)';
        ctx.strokeStyle = 'rgba(60, 80, 100, 0.9)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        drawRoundRect(ctx, hudX, hudY, hudW, hudH, 4);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        if (s.isEffectiveOccluded) {
          ctx.font = 'bold 9.5px monospace';
          ctx.fillStyle = '#FF5F40';
          ctx.fillText('STATUS: LINK_BLOCKED (OCCLUDED)', hudX + 8, hudY + 10);

          ctx.font = '8.5px monospace';
          ctx.fillStyle = '#DCDCDC';
          ctx.fillText('Centroid: NONE (LOS BLOCKED BY EARTH)', hudX + 8, hudY + 28);

          ctx.fillStyle = '#64DCFF';
          ctx.fillText('Pixel Err: N/A (LINK BLOCKED)', hudX + 8, hudY + 46);

          ctx.fillStyle = '#64DCFF';
          ctx.fillText('Angular: N/A (LINK BLOCKED)', hudX + 8, hudY + 64);

          ctx.fillStyle = '#B4B4B4';
          ctx.fillText('PAT State: LINK_BLOCKED | OCCLUDED', hudX + 8, hudY + 82);
        } else if (isVisible) {
          const patState = s.isLocked ? 'LOCKED' : (s.tracking?.state || 'TRACKING');
          ctx.font = 'bold 9.5px monospace';
          ctx.fillStyle = s.isLocked ? '#00FF78' : '#FFB400';
          ctx.fillText(`STATUS: BEACON DETECTED [${patState}]`, hudX + 8, hudY + 10);

          ctx.font = '8.5px monospace';
          ctx.fillStyle = '#F0FFEA';
          ctx.fillText(`Centroid (Bx, By): (${u.toFixed(1)}, ${v.toFixed(1)}) px`, hudX + 8, hudY + 28);

          ctx.fillStyle = '#64DCFF';
          ctx.fillText(`Pixel Err: Ex=${(u - 320).toFixed(1)} Ey=${(240 - v).toFixed(1)} | Total: ${distToBoresight.toFixed(1)} px`, hudX + 8, hudY + 46);

          ctx.fillStyle = '#9CA195';
          ctx.fillText(`Angular: θx=${((u - 320) / 160).toFixed(2)}°  θy=${((240 - v) / 160).toFixed(2)}°`, hudX + 8, hudY + 64);

          ctx.fillStyle = '#B4B4B4';
          const conf = (s.detection?.confidence ?? 1.0).toFixed(2);
          const snr = (s.detection?.snr_db ?? 28.5).toFixed(1);
          ctx.fillText(`Conf: ${conf} | SNR: ${snr}dB | PAT: ${patState}`, hudX + 8, hudY + 82);
        } else {
          ctx.font = 'bold 9.5px monospace';
          ctx.fillStyle = '#FF5F40';
          ctx.fillText('STATUS: SEARCHING / NO BEACON', hudX + 8, hudY + 10);

          ctx.font = '8.5px monospace';
          ctx.fillStyle = '#DCDCDC';
          ctx.fillText('Centroid: NONE (TARGET OUT OF FOV)', hudX + 8, hudY + 28);

          ctx.fillStyle = '#64DCFF';
          ctx.fillText('Pixel Err: N/A', hudX + 8, hudY + 46);

          ctx.fillStyle = '#64DCFF';
          ctx.fillText('Angular: N/A', hudX + 8, hudY + 64);

          ctx.fillStyle = '#B4B4B4';
          ctx.fillText('Candidates: 0 | PAT: SEARCHING', hudX + 8, hudY + 82);
        }
        ctx.restore();
      }

      // 7. Bottom-Right Badge: OPENCV LIVE STREAM
      ctx.save();
      const badgeW = 205;
      const badgeH = 18;
      const badgeX = 640 - badgeW - 8;
      const badgeY = 480 - badgeH - 8;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.strokeStyle = '#33362F';
      ctx.lineWidth = 1;
      ctx.beginPath();
      drawRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, 3);
      ctx.fill();
      ctx.stroke();

      ctx.font = '8px monospace';
      ctx.fillStyle = '#FF5F40';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`OPENCV LIVE STREAM (${s.viewMode === 'opencv_annotated' ? 'ANNOTATED' : 'RAW'})`, badgeX + badgeW / 2, badgeY + badgeH / 2);
      ctx.restore();

      // 8. Bottom-Left Aerospace Telemetry Watermark
      ctx.save();
      const wmW = 390;
      const wmH = 18;
      const wmX = 8;
      const wmY = 480 - wmH - 8;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.strokeStyle = 'rgba(255, 95, 64, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      drawRoundRect(ctx, wmX, wmY, wmW, wmH, 3);
      ctx.fill();
      ctx.stroke();

      ctx.font = 'bold 8.5px monospace';
      ctx.fillStyle = '#FF5F40';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const timeIso = new Date().toISOString().slice(11, 19);
      ctx.fillText(`● REC [SAT-POV] | ${timeIso} UTC | 640×480 | 30 FPS`, wmX + 6, wmY + wmH / 2);
      ctx.restore();

      // 9. Top-Right REC Time Indicator
      ctx.save();
      const recW = 120;
      const recH = 20;
      const recX = 640 - recW - 8;
      const recY = 10;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.strokeStyle = '#FF5F40';
      ctx.lineWidth = 1;
      ctx.beginPath();
      drawRoundRect(ctx, recX, recY, recW, recH, 3);
      ctx.fill();
      ctx.stroke();

      const pulse = (Math.sin(nowMs / 150) + 1) / 2;
      ctx.fillStyle = '#FF5F40';
      ctx.beginPath();
      ctx.arc(recX + 12, recY + 10, 3 + pulse * 1.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = '#FF5F40';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`REC ${elapsedSec.toFixed(1)}s / ${durationSec}s`, recX + 22, recY + 10);
      ctx.restore();

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
```

---

### Step 5: Update the Header UI Controls
Replace the header's right-hand region (where the old snapshot button was) with the following JSX:

```tsx
          {/* Video Recording Controls for Satellite Camera POV */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Recording Duration Parameter Input (Capped at 20s, default 5s) */}
            <div
              className="flex items-center bg-[#262824] border border-[#33362F] hover:border-[#FF5F40] px-2 py-0.5 rounded text-xs font-mono gap-1 transition"
              title="Clip recording duration in seconds (1 - 20s, default: 5s)"
            >
              <Clock className="w-3 h-3 text-[#9CA195]" />
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
                className="w-7 bg-transparent text-[#F0FFEA] font-semibold text-center outline-none focus:text-[#FF5F40]"
              />
              <span className="text-[#9CA195] text-[10px]">s</span>
            </div>

            {/* Record / Stop Button */}
            {!isRecording ? (
              <button
                id="btn-record-clip"
                onClick={handleStartRecording}
                className="px-3 py-1 bg-[#262824] hover:bg-[#33362F] active:bg-[#1B1D1A] text-[#FF5F40] border border-[#FF5F40] hover:border-[#FF7459] rounded font-mono text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm hover:shadow-[0_0_12px_rgba(255,95,64,0.3)] shrink-0"
                title={`Record a ${recordDuration}s video clip of the satellite camera POV (Shortcut: R)`}
              >
                <CircleDot className="w-3.5 h-3.5 text-[#FF5F40]" />
                <span>Record clip</span>
                <kbd className="px-1 py-0.2 bg-[#000000] text-[9px] rounded text-[#F0FFEA] font-mono border border-[#33362F]">R</kbd>
              </button>
            ) : (
              <button
                id="btn-stop-recording"
                onClick={handleStopRecording}
                className="px-3 py-1 bg-[#FF5F40]/25 hover:bg-[#FF5F40]/35 text-[#FF5F40] border border-[#FF5F40] rounded font-mono text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-[0_0_12px_rgba(255,95,64,0.4)] shrink-0"
                title="Stop recording early and auto-download clip"
              >
                <span className="w-2 h-2 rounded-full bg-[#FF5F40] animate-ping" />
                <span>REC {recordElapsed.toFixed(1)}s / {recordDuration}s</span>
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
```

---

### Step 6: Add Viewport Overlays & Video Modal
Inside the viewport container (`relative w-full max-w-[640px] aspect-[4/3] ...`):
```tsx
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
```

And right before the final `</div>` of `FPACameraViewport`, add the video preview modal:
```tsx
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
```

---

## 4. Verification & Testing Checklist

1. **Build Validation**:
   Run in `frontend/`:
   ```bash
   npm run build
   ```
   Must pass with **0 errors**.
2. **Recording Verification**:
   - Start the frontend and backend.
   - Enter duration (e.g. `5` seconds) and click **"Record clip"** (or press **`R`**).
   - Verify that the recording pulses and counts down to 5.0 seconds.
   - Verify that the video is automatically downloaded to Downloads folder.
   - Verify that clicking **"Play"** opens the recorded video modal and plays smoothly.
3. **Desktop Media Player Check**:
   - Open the downloaded file in **Windows Media Player** ("Player").
   - Confirm the video starts playing immediately, the timeline scrubber moves smoothly, and seeking works without freezing.
4. **Earth Occlusion Accuracy Check**:
   - In 3D satellite view, let the satellite orbit behind Earth until `: GROUND BEACON OCCLUDED BY EARTH LIMB` appears.
   - Record a 5-second clip.
   - Open the downloaded video: verify that the occlusion banner and occluded telemetry are clearly rendered in the video.
