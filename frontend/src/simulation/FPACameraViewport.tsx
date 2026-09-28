import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
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
  Sliders,
  RotateCcw,
  Sparkles,
  Layers,
  Locate,
  Globe,
  ZoomIn,
  ZoomOut,
  Compass,
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'opencv_annotated' | 'opencv_raw'>('canvas');
  const [streamTick, setStreamTick] = useState(0);
  const [autoLOS, setAutoLOS] = useState(false);
  const autoLOSRef = useRef(false);
  autoLOSRef.current = autoLOS;

  // Satellite POV 3D Display Controls & State
  const [showSatellitePov, setShowSatellitePov] = useState(true);
  const [fovMode, setFovMode] = useState<'telephoto' | 'wide'>('telephoto');
  const [pointingMode, setPointingMode] = useState<'beacon' | 'nadir'>('nadir');
  const [isOccludedState, setIsOccludedState] = useState(false);
  const [isAlarmActive, setIsAlarmActive] = useState<boolean>(false);
  const [isAlarmMuted, setIsAlarmMuted] = useState<boolean>(alarmAudio.getIsMuted());
  const [isAlarmSuspended, setIsAlarmSuspended] = useState<boolean>(alarmAudio.getIsSuspended());
  const [isLockedInFov, setIsLockedInFov] = useState<boolean>(satellitePovSync.getData().isLockedInFov);
  const [isLostFromFov, setIsLostFromFov] = useState<boolean>(satellitePovSync.getData().isLostFromFov);

  // Subscribe to alarm audio service state
  useEffect(() => {
    const unsub = alarmAudio.subscribe((active, muted, suspended) => {
      setIsAlarmActive(active);
      setIsAlarmMuted(muted);
      setIsAlarmSuspended(suspended);
    });
    return unsub;
  }, []);

  // Sync autoLOS and FOV lock status with satellitePovSync singleton
  useEffect(() => {
    const unsub = satellitePovSync.subscribe((data) => {
      if (data.autoLOS !== undefined && data.autoLOS !== autoLOSRef.current) {
        setAutoLOS(data.autoLOS);
        autoLOSRef.current = data.autoLOS;
        const mode = data.autoLOS ? 'beacon' : 'nadir';
        setPointingMode(mode);
        pointingModeRef.current = mode;
      }
      if (data.isLockedInFov !== undefined) {
        setIsLockedInFov(data.isLockedInFov);
      }
      if (data.isLostFromFov !== undefined) {
        setIsLostFromFov(data.isLostFromFov);
      }
    });
    return unsub;
  }, []);

  const handleToggleAutoLOS = () => {
    const next = !autoLOS;
    setAutoLOS(next);
    autoLOSRef.current = next;
    const mode = next ? 'beacon' : 'nadir';
    setPointingMode(mode);
    pointingModeRef.current = mode;
    satellitePovSync.update({ autoLOS: next });
  };

  const handleToggleAimMode = () => {
    const nextMode = pointingMode === 'beacon' ? 'nadir' : 'beacon';
    setPointingMode(nextMode);
    pointingModeRef.current = nextMode;
    const nextAuto = nextMode === 'beacon';
    setAutoLOS(nextAuto);
    autoLOSRef.current = nextAuto;
    satellitePovSync.update({ autoLOS: nextAuto });
  };

  // Three.js 3D Satellite Camera POV Mount & Scene References
  const threeMountRef = useRef<HTMLDivElement | null>(null);
  const threeSceneRef = useRef<THREE.Scene | null>(null);
  const threeCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const threeRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const globeMeshRef = useRef<THREE.Mesh | null>(null);
  const beaconGroupRef = useRef<THREE.Group | null>(null);

  // Sync refs so 60 FPS animation loop always reads latest prop values without restarting Three.js scene
  const cameraPropRef = useRef(camera);
  cameraPropRef.current = camera;
  const disturbancePropRef = useRef(disturbance);
  disturbancePropRef.current = disturbance;
  const showSatellitePovRef = useRef(showSatellitePov);
  showSatellitePovRef.current = showSatellitePov;
  const fovModeRef = useRef(fovMode);
  fovModeRef.current = fovMode;
  const pointingModeRef = useRef(pointingMode);
  pointingModeRef.current = pointingMode;
  const currentAimTargetRef = useRef<THREE.Vector3 | null>(null);

  // 3D Continuous Satellite POV WebGL Scene Lifecycle
  useEffect(() => {
    const container = threeMountRef.current;
    if (!container) return;

    // 1. Scene with deep space background
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02050c);
    threeSceneRef.current = scene;

    // 2. Dense Starfield (6000 stars distributed in spherical space shell)
    const starCount = 6000;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const r = 800 + Math.random() * 450;
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);

      const bright = 0.5 + Math.random() * 0.5;
      const isCyan = Math.random() > 0.6;
      starColors[i * 3] = isCyan ? 0.35 * bright : 0.88 * bright;
      starColors[i * 3 + 1] = isCyan ? 0.85 * bright : 0.92 * bright;
      starColors[i * 3 + 2] = isCyan ? 1.0 * bright : 0.99 * bright;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    const starMat = new THREE.PointsMaterial({
      size: 1.8,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // 3. Central Earth Globe with Dense 180x90 Wireframe (2° spacing for vivid telephoto detail)
    const globeRadius = 100;
    const globeGeo = new THREE.SphereGeometry(globeRadius, 180, 90);
    const globeMat = new THREE.MeshBasicMaterial({
      color: 0x0c1424,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      depthWrite: true,
      depthTest: true,
    });
    const globeMesh = new THREE.Mesh(globeGeo, globeMat);
    globeMesh.position.set(0, 0, 0);
    scene.add(globeMesh);
    globeMeshRef.current = globeMesh;

    // Neon cyan latitudinal/longitudinal wireframe grid lines
    const wireGeo = new THREE.WireframeGeometry(globeGeo);
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.65,
    });
    const wireMesh = new THREE.LineSegments(wireGeo, wireMat);
    globeMesh.add(wireMesh);

    // Vivid glowing Equator guide ring
    const eqPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      eqPts.push(new THREE.Vector3((globeRadius + 0.15) * Math.cos(a), 0, (globeRadius + 0.15) * Math.sin(a)));
    }
    const eqGeo = new THREE.BufferGeometry().setFromPoints(eqPts);
    const eqLine = new THREE.Line(
      eqGeo,
      new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.9 })
    );
    globeMesh.add(eqLine);

    // Atmospheric rim glow
    const atmoGeo = new THREE.SphereGeometry(globeRadius + 1.2, 72, 36);
    const atmoMat = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
      transparent: true,
      opacity: 0.14,
      side: THREE.BackSide,
    });
    const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
    scene.add(atmoMesh);

    // 4. Ground Station Optical Beacon
    const beaconGroup = new THREE.Group();

    // Beacon base landing platform on Earth surface
    const padGeo = new THREE.CylinderGeometry(2.4, 2.4, 0.3, 16);
    const padMat = new THREE.MeshBasicMaterial({ color: 0x0f2942 });
    const padMesh = new THREE.Mesh(padGeo, padMat);
    padMesh.position.y = 0.15;
    beaconGroup.add(padMesh);

    // Beacon outer neon ring
    const ringGeo = new THREE.RingGeometry(2.2, 2.6, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = 0.31;
    beaconGroup.add(ringMesh);

    // Beacon optical emitter head (Red glowing box)
    const emitterGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
    const emitterMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
    const emitterMesh = new THREE.Mesh(emitterGeo, emitterMat);
    emitterMesh.position.y = 1.0;
    beaconGroup.add(emitterMesh);

    // Pulsing bright core point
    const coreGeo = new THREE.SphereGeometry(0.5, 12, 12);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.y = 1.0;
    beaconGroup.add(coreMesh);

    // Optical guide beam pointing into space from beacon
    const beamGeo = new THREE.CylinderGeometry(0.1, 0.4, 20, 8);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.5,
    });
    const beamMesh = new THREE.Mesh(beamGeo, beamMat);
    beamMesh.position.y = 10.0;
    beaconGroup.add(beamMesh);

    scene.add(beaconGroup);
    beaconGroupRef.current = beaconGroup;

    // 5. Satellite Onboard Perspective Camera (Mounted directly in scene)
    const initialFov = fovModeRef.current === 'telephoto' ? (cameraPropRef.current?.fov_vertical_deg ?? 3.0) : 24.0;
    const povCamera = new THREE.PerspectiveCamera(initialFov, 640 / 480, 0.5, 4000);
    scene.add(povCamera);
    threeCameraRef.current = povCamera;

    // 6. WebGL Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(640, 480, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.objectFit = 'contain';

    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    threeRendererRef.current = renderer;

    // 7. Continuous 60 FPS Animation Loop
    let animId: number;
    let lastOccluded = false;

    const animatePov = () => {
      animId = requestAnimationFrame(animatePov);

      if (!showSatellitePovRef.current) return;

      const povData = satellitePovSync.getData();
      const satPos = povData.satPos;
      const tgtPos = povData.tgtPos;

      // Rotate Earth with diurnal spin
      if (globeMeshRef.current) {
        globeMeshRef.current.rotation.y = povData.earthRotationY;
      }

      // Position beacon on Earth surface and align with surface normal (with mobile platform motion offset)
      if (beaconGroupRef.current) {
        const normal = tgtPos.clone().normalize();
        let up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(normal.dot(up)) > 0.9) up = new THREE.Vector3(1, 0, 0);
        const tangentX = new THREE.Vector3().crossVectors(normal, up).normalize();
        const tangentY = new THREE.Vector3().crossVectors(tangentX, normal).normalize();
        const dist = disturbancePropRef.current;
        const px = dist?.platform_offset_x_px ?? 0;
        const py = dist?.platform_offset_y_px ?? 0;
        const dispScale = 0.05;
        const groundPos = tgtPos.clone()
          .addScaledVector(tangentX, px * dispScale)
          .addScaledVector(tangentY, py * dispScale);

        beaconGroupRef.current.position.copy(groundPos);
        beaconGroupRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      }

      // Position onboard satellite camera directly at orbital coordinates
      if (threeCameraRef.current) {
        const cam = threeCameraRef.current;
        cam.position.copy(satPos);

        // Aim target: Ground station beacon or Earth nadir (0, 0, 0)
        const desiredAimTarget = pointingModeRef.current === 'nadir' ? new THREE.Vector3(0, 0, 0) : tgtPos;
        if (!currentAimTargetRef.current) {
          currentAimTargetRef.current = desiredAimTarget.clone();
        } else {
          // Smoothly shift aim target towards desired aim (Nadir or Beacon) along Line of Sight
          currentAimTargetRef.current.lerp(desiredAimTarget, 0.055);
          if (currentAimTargetRef.current.distanceTo(desiredAimTarget) < 0.25) {
            currentAimTargetRef.current.copy(desiredAimTarget);
          }
        }

        // Keep camera upright relative to Earth polar axis (0, 1, 0)
        cam.up.set(0, 1, 0);
        cam.lookAt(currentAimTargetRef.current);

        // Apply gimbal pan & tilt rotations locally in camera space
        const currentCam = cameraPropRef.current;
        const panDeg = currentCam?.pan_deg ?? 0;
        const tiltDeg = currentCam?.tilt_deg ?? 0;
        const panRad = THREE.MathUtils.degToRad(panDeg);
        const tiltRad = THREE.MathUtils.degToRad(tiltDeg);

        // Compute high-frequency jitter & vibration angular displacement
        const dist = disturbancePropRef.current;
        const jx = dist?.jitter_offset_x_px ?? 0;
        const jy = dist?.jitter_offset_y_px ?? 0;
        const px = dist?.platform_offset_x_px ?? 0;
        const py = dist?.platform_offset_y_px ?? 0;
        const fovH = currentCam?.fov_horizontal_deg ?? 4.0;
        const fovV = currentCam?.fov_vertical_deg ?? 3.0;
        const jitPanRad = THREE.MathUtils.degToRad(((jx + px) * fovH) / 640);
        const jitTiltRad = THREE.MathUtils.degToRad(((jy + py) * fovV) / 480);

        // rotateY(-panRad - jitPanRad): panning right shifts view right, targets move left
        // rotateX(tiltRad + jitTiltRad): tilting up shifts view up, targets move down
        cam.rotateY(-panRad - jitPanRad);
        cam.rotateX(tiltRad + jitTiltRad);

        // Smooth FOV zoom transition between telephoto and wide
        const targetFov = fovModeRef.current === 'telephoto' ? (currentCam?.fov_vertical_deg ?? 3.0) : 24.0;
        if (Math.abs(cam.fov - targetFov) > 0.05) {
          cam.fov += (targetFov - cam.fov) * 0.15;
          cam.updateProjectionMatrix();
        }
      }

      // Check occlusion state changes
      if (povData.isOccluded !== lastOccluded) {
        lastOccluded = povData.isOccluded;
        setIsOccludedState(povData.isOccluded);
      }

      renderer.render(scene, povCamera);
    };

    animatePov();

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
      globeGeo.dispose();
      globeMat.dispose();
      wireGeo.dispose();
      wireMat.dispose();
      atmoGeo.dispose();
      atmoMat.dispose();
      starGeo.dispose();
      starMat.dispose();
    };
  }, []);

  // Historical projected pixel breadcrumbs for sensor trajectory trail
  const pixelHistoryRef = useRef<{ u: number; v: number }[]>([]);

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

  // Auto LOS Align: continuously slew the camera boresight toward the LOS ray.
  // azimuth_cam_deg / elevation_cam_deg are the angular offsets between the camera
  // boresight and the actual target direction in camera space, so:
  //   needed_pan  = camera.pan_deg  + azimuth_cam_deg
  //   needed_tilt = camera.tilt_deg + elevation_cam_deg
  useEffect(() => {
    if (!autoLOS) return;
    if (!target || !camera || !onGimbalAngles) return;
    if (target.azimuth_cam_deg === null || target.elevation_cam_deg === null) return;

    const neededPan  = camera.pan_deg  + (target.azimuth_cam_deg  ?? 0);
    const neededTilt = camera.tilt_deg + (target.elevation_cam_deg ?? 0);
    onGimbalAngles(neededPan, neededTilt);
  }, [autoLOS, target, camera, onGimbalAngles]);

  useEffect(() => {
    const px = target?.pixel_x ?? null;
    const py = target?.pixel_y ?? null;
    const inSensor = px !== null && py !== null && px >= 0 && px <= 640 && py >= 0 && py <= 480;
    if (target && inSensor && px !== null && py !== null) {
      pixelHistoryRef.current.push({ u: px, v: py });
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

    // 1. Draw FPA sensor background (transparent if 3D POV active so Three.js renders behind HUD)
    if (showSatellitePov) {
      ctx.clearRect(0, 0, w, h);

      // Subtle high-tech sensor grid texture
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.04)';
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
    } else {
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

    // 4. Render Beacon — visible when pixel coordinate is within sensor bounds
    // Use pixel_x/pixel_y directly (backend always returns them even when is_in_fov flickers at edges)
    const beaconPx = target?.pixel_x ?? null;
    const beaconPy = target?.pixel_y ?? null;
    const beaconInSensor = beaconPx !== null && beaconPy !== null
      && beaconPx >= 0 && beaconPx <= 640
      && beaconPy >= 0 && beaconPy <= 480;

    if (target && beaconInSensor && !isOccludedState && beaconPx !== null && beaconPy !== null) {
      const px = beaconPx;
      const py = beaconPy;
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
        // Problem Statement 4 Default: Square 10x10 px (Red square beacon)
        ctx.fillStyle = '#f43f5e';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
        ctx.strokeRect(px - sz / 2, py - sz / 2, sz, sz);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
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
    } else if (target && isOccludedState) {
      // Earth horizon occlusion alert badge on sensor
      ctx.save();
      ctx.fillStyle = 'rgba(244, 63, 94, 0.15)';
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(cx - 130, cy + 30, 260, 26);
      ctx.fillRect(cx - 130, cy + 30, 260, 26);
      ctx.fillStyle = '#fca5a5';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('GROUND BEACON OCCLUDED BY EARTH HORIZON', cx, cy + 43);
      ctx.restore();
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
      let patState = tracking.state || tracking.mode || 'SEARCHING';
      if (isOccludedState && patState !== 'NO_COVERAGE') {
        patState = 'LINK_BLOCKED';
      }
      const stateColors: Record<string, { bg: string; text: string; border: string }> = {
        LOCKED: { bg: 'rgba(16, 185, 129, 0.85)', text: '#ffffff', border: '#10b981' },
        TRACKING: { bg: 'rgba(6, 182, 212, 0.85)', text: '#ffffff', border: '#06b6d4' },
        ACQUIRING: { bg: 'rgba(234, 179, 8, 0.85)', text: '#000000', border: '#eab308' },
        REACQUIRING: { bg: 'rgba(249, 115, 22, 0.85)', text: '#ffffff', border: '#f97316' },
        SEARCHING: { bg: 'rgba(168, 85, 247, 0.85)', text: '#ffffff', border: '#a855f7' },
        LOST: { bg: 'rgba(239, 68, 68, 0.85)', text: '#ffffff', border: '#ef4444' },
        LINK_BLOCKED: { bg: 'rgba(225, 29, 72, 0.85)', text: '#ffffff', border: '#f43f5e' },
        NO_COVERAGE: { bg: 'rgba(239, 68, 68, 0.90)', text: '#ffffff', border: '#ef4444' },
      };
      const theme = stateColors[patState] || { bg: 'rgba(100, 116, 139, 0.85)', text: '#ffffff', border: '#64748b' };

      ctx.save();
      ctx.fillStyle = theme.bg;
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1.5;
      const badgeW = Math.max(120, patState.length * 9 + 40);
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
  }, [target, camera, tracking, detection, viewMode, showSatellitePov, fovMode, isOccludedState]);

  const isCvDetected = Boolean(
    detection?.beacon_detected &&
    detection.detected_centroid_x !== null &&
    detection.detected_centroid_y !== null &&
    detection.detected_centroid_x >= 0 &&
    detection.detected_centroid_x <= 640 &&
    detection.detected_centroid_y >= 0 &&
    detection.detected_centroid_y <= 480
  );

  const isTrackingLocked = Boolean(
    tracking?.is_locked ||
    tracking?.state === 'LOCKED' ||
    tracking?.state === 'TRACKING' ||
    tracking?.mode === 'TRACKING' ||
    tracking?.mode === 'LOCKED'
  );

  const isTrackedInSensor = Boolean(
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

  const isGroundTruthInSensor = Boolean(
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

  // When satellite FOV locks onto beacon (rectangular frustum turns green), beacon is locked in FOV
  // The moment sight is lost (rectangular frustum turns red), it is lost from FOV
  const isBeaconVisibleInFov = !isOccludedState && (
    isLockedInFov ||
    (!isLostFromFov && (isCvDetected || isTrackingLocked || isTrackedInSensor || isGroundTruthInSensor))
  );

  const isBeaconLost = isLostFromFov || !isBeaconVisibleInFov;

  // Directly trigger alarm whenever beacon is lost from this satellite camera FOV
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

        <div className="flex items-center gap-2.5 text-[11px]">
          {/* Satellite POV 3D Toggle */}
          <button
            onClick={() => setShowSatellitePov((v) => !v)}
            title="Toggle Continuous 3D Satellite Camera Point of View"
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded border font-bold transition text-[10px] ${
              showSatellitePov
                ? 'bg-cyan-950 text-cyan-300 border-cyan-700 shadow-sm'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
            }`}
          >
            <Globe className="w-3 h-3 text-cyan-400" />
            {showSatellitePov ? 'Sat POV: ON' : 'Sat POV: OFF'}
          </button>

          {/* FOV Mode Toggle (Telephoto vs Wide) */}
          {showSatellitePov && (
            <button
              onClick={() => setFovMode((m) => (m === 'telephoto' ? 'wide' : 'telephoto'))}
              title={fovMode === 'telephoto' ? 'Switch to Wide Horizon View (24°)' : 'Switch to Narrow Telescope View (4°)'}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px] transition"
            >
              {fovMode === 'telephoto' ? (
                <>
                  <ZoomIn className="w-3 h-3 text-amber-400" />
                  <span>4° Telephoto</span>
                </>
              ) : (
                <>
                  <ZoomOut className="w-3 h-3 text-emerald-400" />
                  <span>24° Wide</span>
                </>
              )}
            </button>
          )}

          {/* Aim Mode Toggle: Beacon / Nadir */}
          {showSatellitePov && (
            <button
              onClick={handleToggleAimMode}
              title={pointingMode === 'beacon' ? 'Camera tracking Ground Beacon (Click to point Nadir directly at Earth)' : 'Camera pointing Nadir to Earth Center (Click to track Ground Beacon)'}
              className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono transition ${
                pointingMode === 'beacon'
                  ? 'bg-slate-800 border-slate-700 text-cyan-300 hover:text-white'
                  : 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
              }`}
            >
              <Compass className="w-3 h-3 text-cyan-400" />
              <span>{pointingMode === 'beacon' ? 'Aim: Beacon' : 'Aim: Nadir'}</span>
            </button>
          )}

          <span className="text-slate-600">|</span>

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
            FOV: <span className="text-white font-bold">{fovMode === 'telephoto' ? `${camera?.fov_horizontal_deg.toFixed(1)}° × ${camera?.fov_vertical_deg.toFixed(1)}°` : '32.0° × 24.0°'}</span>
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">
            Target: {(() => {
              if (isOccludedState) {
                return (
                  <span className="text-rose-400 font-bold inline-flex items-center gap-1">
                    <EyeOff className="w-3 h-3" /> OCCLUDED (EARTH LIMB)
                  </span>
                );
              }
              if (isBeaconVisibleInFov) {
                return (
                  <span className="text-emerald-400 font-bold inline-flex items-center gap-1">
                    <Eye className="w-3 h-3" /> {isLockedInFov || isTrackingLocked ? 'LOCKED IN FOV' : 'VISIBLE IN FOV'}
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
                  : 'ALARM BEEPING: Beacon is lost from camera FOV (Click to Mute)'
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

      {/* Main FPA Screen (Continuous 3D Satellite Camera POV + 2D Tactical HUD) */}
      <div className="relative p-2 flex flex-col items-center justify-center bg-black/60">
        <div className="relative w-full max-w-[640px] aspect-[4/3] rounded border border-slate-800 overflow-hidden bg-[#02050c] shadow-2xl flex items-center justify-center">
          {/* Three.js 3D Satellite Point-Of-View Canvas */}
          <div
            ref={threeMountRef}
            className={`absolute inset-0 w-full h-full ${showSatellitePov && viewMode === 'canvas' ? 'block' : 'hidden'}`}
          />

          {viewMode === 'canvas' ? (
            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none z-10"
            />
          ) : (
            <div className="relative w-full h-full bg-black flex items-center justify-center z-10">
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

          {/* Tactical Overlay: Continuous Satellite POV Watermark */}
          {showSatellitePov && viewMode === 'canvas' && (
            <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5 px-2 py-0.5 bg-slate-950/85 border border-cyan-800/60 rounded text-[9px] font-mono text-cyan-300 backdrop-blur-sm pointer-events-none select-none">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
              <span>SATELLITE POV • {fovMode === 'telephoto' ? '4.0° FPA' : '24.0° WIDE'} • {pointingMode === 'beacon' ? 'BEACON TRACK' : 'EARTH NADIR'}</span>
            </div>
          )}

          {/* Tactical Overlay: Beacon Lost Alarm Banner */}
          {isBeaconLost && viewMode === 'canvas' && (
            <div
              onClick={() => alarmAudio.unlock()}
              title="Click anywhere to unlock audio if muted/blocked by browser"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 bg-rose-950/95 border border-rose-500 rounded text-[10px] font-mono text-rose-200 font-bold tracking-wider animate-pulse flex items-center gap-2 backdrop-blur-sm shadow-xl shadow-rose-950/80 cursor-pointer select-none"
            >
              <Volume2 className="w-3.5 h-3.5 text-rose-400 animate-bounce flex-shrink-0" />
              <span>
                {isOccludedState
                  ? 'ALARM: BEACON OCCLUDED BY EARTH LIMB'
                  : 'ALARM: BEACON LOST FROM SATELLITE FOV'}
                {isAlarmMuted
                  ? ' • [MUTED]'
                  : isAlarmSuspended
                  ? ' • [CLICK VIEWPORT FOR SOUND]'
                  : ' • [BEEPING]'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Telemetry Dashboard (Moved out of viewport) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 bg-slate-900 border-t border-slate-800 font-mono text-[10px] text-slate-300">
        {/* Real-time Boresight & Detection Telemetry */}
        <div className="bg-slate-950 border border-slate-800 p-2.5 rounded space-y-1">
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
