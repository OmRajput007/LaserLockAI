import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { TargetState, CameraState, TrackingTelemetry, DetectionTelemetry, DisturbanceTelemetry } from '../types';
import { satellitePovSync } from './satellitePovSync';
import { createEarthTexture, createAtmosphereRimMesh } from './earthTexture';
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

  // Periodic stream tick for live OpenCV video feed
  useEffect(() => {
    if (viewMode === 'canvas') return;
    const interval = setInterval(() => {
      setStreamTick((t) => (t + 1) % 1000000);
    }, 50);
    return () => clearInterval(interval);
  }, [viewMode]);

  const [autoLOS, setAutoLOS] = useState(false);
  const autoLOSRef = useRef(false);
  autoLOSRef.current = autoLOS;

  // Satellite POV 3D Display Controls & State
  const [showSatellitePov, setShowSatellitePov] = useState(true);
  const [fovMode, setFovMode] = useState<'telephoto' | 'wide'>('wide');
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
  const emitterMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const coreMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const beamMatRef = useRef<THREE.MeshBasicMaterial | null>(null);

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

    // Directional Sunlight & Ambient Illumination (matches Mission Control Sun angle)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambientLight);
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.85);
    const FIXED_SUN_DIR = new THREE.Vector3(1, 0.3, 0.8).normalize();
    sunLight.position.copy(FIXED_SUN_DIR.clone().multiplyScalar(600));
    scene.add(sunLight);

    // 2. Dense 3D Starfield (6000 stars distributed in spherical space shell)
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

      const bright = 0.6 + Math.random() * 0.4;
      const isCyan = Math.random() > 0.65;
      starColors[i * 3] = isCyan ? 0.38 * bright : 0.90 * bright;
      starColors[i * 3 + 1] = isCyan ? 0.85 * bright : 0.94 * bright;
      starColors[i * 3 + 2] = isCyan ? 1.0 * bright : 1.0 * bright;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    const starMat = new THREE.PointsMaterial({
      size: 2.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // 3. Central 3D Earth Globe with Continents, Oceans, and Coordinate Graticule
    const globeRadius = 100;
    const globeGeo = new THREE.SphereGeometry(globeRadius, 96, 48);
    const earthTex = createEarthTexture();
    const globeMat = new THREE.MeshStandardMaterial({
      map: earthTex,
      roughness: 0.70,
      metalness: 0.05,
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

    // Latitudinal/longitudinal aerospace wireframe grid lines
    const wireGeo = new THREE.WireframeGeometry(new THREE.SphereGeometry(globeRadius + 0.04, 48, 24));
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.22,
    });
    const wireMesh = new THREE.LineSegments(wireGeo, wireMat);
    globeMesh.add(wireMesh);

    // Vivid glowing Equator guide ring
    const eqPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      eqPts.push(new THREE.Vector3((globeRadius + 0.12) * Math.cos(a), 0, (globeRadius + 0.12) * Math.sin(a)));
    }
    const eqGeo = new THREE.BufferGeometry().setFromPoints(eqPts);
    const eqLine = new THREE.Line(
      eqGeo,
      new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.85 })
    );
    globeMesh.add(eqLine);

    // Atmospheric outer rim glow
    const atmoGeo = new THREE.SphereGeometry(globeRadius * 1.018, 64, 32);
    const atmoMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.22,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
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
    emitterMatRef.current = emitterMat;
    const emitterMesh = new THREE.Mesh(emitterGeo, emitterMat);
    emitterMesh.position.y = 1.0;
    beaconGroup.add(emitterMesh);

    // Pulsing bright core point
    const coreGeo = new THREE.SphereGeometry(0.5, 12, 12);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    coreMatRef.current = coreMat;
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.y = 1.0;
    beaconGroup.add(coreMesh);

    // Optical guide beam pointing into space from beacon
    const beamGeo = new THREE.CylinderGeometry(0.12, 0.45, 28, 8);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.65,
    });
    beamMatRef.current = beamMat;
    const beamMesh = new THREE.Mesh(beamGeo, beamMat);
    beamMesh.position.y = 14.0;
    beaconGroup.add(beamMesh);

    scene.add(beaconGroup);
    beaconGroupRef.current = beaconGroup;

    // 5. Satellite Onboard Perspective Camera (Mounted directly in scene)
    const initialFov = fovModeRef.current === 'telephoto' ? (cameraPropRef.current?.fov_vertical_deg ?? 3.0) : 42.0;
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

        const currentDist = disturbancePropRef.current;
        const isChannelOcc = Boolean(currentDist?.is_occluded || currentDist?.occlusion_active);
        const isTotalOcc = povData.isOccluded || isChannelOcc;
        const currentCam = cameraPropRef.current;
        const isWide = fovModeRef.current === 'wide';

        // 1. Nadir direction (downward toward Earth center 0, 0, 0)
        const nadirDir = satPos.clone().negate().normalize();

        // 2. Orbital velocity / forward direction (perpendicular to nadir)
        let velDir = new THREE.Vector3(-satPos.z, 0, satPos.x);
        if (velDir.lengthSq() < 0.001) velDir.set(1, 0, 0);
        velDir.normalize();

        // 3. Line-of-sight vector to beacon
        const losDir = tgtPos.clone().sub(satPos).normalize();

        // 4. Use synchronized boresightDir from Scene3DViewport or fallback
        const boresightDir = povData.boresightDir || (autoLOSRef.current ? losDir : nadirDir);

        let aimDir: THREE.Vector3;

        if (isWide) {
          // WIDE HORIZON SATELLITE POV (42° FOV):
          // Provides the authentic, breathtaking orbital horizon view.
          // Frames the curved Earth limb, radiant cyan atmosphere glow, continents, and space stars!
          if (autoLOSRef.current && !isTotalOcc) {
            // Tracking beacon: aim directly at the beacon while keeping the horizon in view
            aimDir = losDir.clone();
          } else {
            // Forward-nadir horizon view: blends nadir (down) and orbital forward track
            aimDir = new THREE.Vector3()
              .addScaledVector(nadirDir, 0.45)
              .addScaledVector(velDir, 0.85)
              .normalize();
          }
        } else {
          // TELEPHOTO / FPA SENSOR ZOOM (4.0° FOV):
          // High-magnification optical payload tracking view
          if (autoLOSRef.current && !isTotalOcc) {
            aimDir = losDir.clone();
          } else {
            aimDir = boresightDir.clone();
          }
        }

        // Apply fine disturbance jitter & vibration
        const jx = currentDist?.jitter_offset_x_px ?? 0;
        const jy = currentDist?.jitter_offset_y_px ?? 0;
        const px = currentDist?.platform_offset_x_px ?? 0;
        const py = currentDist?.platform_offset_y_px ?? 0;
        const fovH = isWide ? 45.0 : (currentCam?.fov_horizontal_deg ?? 4.0);
        const fovV = isWide ? 34.0 : (currentCam?.fov_vertical_deg ?? 3.0);
        const jitPanRad = THREE.MathUtils.degToRad(((jx + px) * fovH) / 640);
        const jitTiltRad = THREE.MathUtils.degToRad(((jy + py) * fovV) / 480);

        // Compute stable camera Up vector (Earth polar / orbital plane)
        let upRef = new THREE.Vector3(0, 1, 0);
        if (Math.abs(aimDir.dot(upRef)) > 0.90) {
          upRef = new THREE.Vector3(1, 0, 0);
        }
        const rightVec = new THREE.Vector3().crossVectors(aimDir, upRef).normalize();
        const realUpVec = new THREE.Vector3().crossVectors(rightVec, aimDir).normalize();

        if (Math.abs(jitPanRad) > 0.0001 || Math.abs(jitTiltRad) > 0.0001) {
          aimDir.applyAxisAngle(realUpVec, -jitPanRad);
          aimDir.applyAxisAngle(rightVec, jitTiltRad);
        }

        const targetLookPoint = satPos.clone().add(aimDir.multiplyScalar(100));

        if (!currentAimTargetRef.current) {
          currentAimTargetRef.current = targetLookPoint.clone();
        } else {
          currentAimTargetRef.current.lerp(targetLookPoint, 0.08);
        }

        cam.up.copy(realUpVec);
        cam.lookAt(currentAimTargetRef.current);

        // Smooth FOV zoom transition between telephoto and wide
        const targetFov = isWide ? 42.0 : (currentCam?.fov_vertical_deg ?? 3.0);
        if (Math.abs(cam.fov - targetFov) > 0.05) {
          cam.fov += (targetFov - cam.fov) * 0.15;
          cam.updateProjectionMatrix();
        }
      }

      // Modulate 3D beacon optical intensity with SNR attenuation, atmosphere, flicker, and Poisson noise
      const currentDist = disturbancePropRef.current;
      const isChannelOcc = Boolean(currentDist?.is_occluded || currentDist?.occlusion_active);
      const isTotalOcc = povData.isOccluded || isChannelOcc;
      const snrAttDb = currentDist?.snr_reduction_db ?? 0.0;
      const atmoTrans = currentDist?.atmospheric_transmittance ?? currentDist?.transmission_factor ?? 1.0;
      const snrFactor = Math.pow(10, -snrAttDb / 20.0);
      let effBeaconFrac = isTotalOcc ? 0.0 : Math.max(0.06, Math.min(1.0, snrFactor * atmoTrans));

      if (!isTotalOcc && currentDist?.beacon_flicker_enabled) {
        const fHz = currentDist?.beacon_flicker_frequency_hz ?? 10.0;
        const tSec = performance.now() / 1000.0;
        const flick = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(2.0 * Math.PI * fHz * tSec));
        effBeaconFrac *= flick;
      }

      if (!isTotalOcc && (currentDist?.poisson_active || currentDist?.applied_noise_types?.includes('Poisson'))) {
        const fluct = (Math.random() - 0.5) * 0.35;
        effBeaconFrac = Math.max(0.04, Math.min(1.3, effBeaconFrac * (1.0 + fluct)));
      }

      if (emitterMatRef.current) {
        emitterMatRef.current.color.setRGB(0.957 * effBeaconFrac, 0.247 * effBeaconFrac, 0.369 * effBeaconFrac);
      }
      if (coreMatRef.current) {
        coreMatRef.current.color.setRGB(effBeaconFrac, effBeaconFrac, effBeaconFrac);
      }
      if (beamMatRef.current) {
        beamMatRef.current.opacity = isTotalOcc ? 0.0 : Math.max(0.04, 0.65 * effBeaconFrac);
      }

      // Check occlusion state changes (combines orbital Earth limb and temporary channel obstruction)
      if (isTotalOcc !== lastOccluded) {
        lastOccluded = isTotalOcc;
        setIsOccludedState(isTotalOcc);
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
      padGeo.dispose();
      padMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      emitterGeo.dispose();
      emitterMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      beamGeo.dispose();
      beamMat.dispose();
      eqGeo.dispose();
      (eqLine.material as THREE.Material).dispose();
      earthTex.dispose();
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

    const dist = disturbance;
    const isChannelOccluded = Boolean(dist?.is_occluded || dist?.occlusion_active);
    const isEffectiveOccluded = isOccludedState || isChannelOccluded;

    // Atmospheric Channel Environmental Effects on Sensor
    const atmoCond = dist?.atmospheric_condition || 'Clear';
    const atmoFrac = Math.max(0.0, Math.min(1.0, tracking?.atmosphere_path_frac ?? 1.0));

    if (atmoFrac > 0.001) {
      if (atmoCond === 'Fog') {
        // Diffuse milky path radiance wash
        ctx.fillStyle = `rgba(200, 215, 230, ${(0.16 * atmoFrac).toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      } else if (atmoCond === 'Haze') {
        // Aerosol contrast attenuation wash
        ctx.fillStyle = `rgba(215, 200, 160, ${(0.08 * atmoFrac).toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      } else if (atmoCond === 'Rain') {
        // Precipitation darkening
        ctx.fillStyle = `rgba(15, 23, 42, ${(0.12 * atmoFrac).toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
        // Falling slanted rain precipitation streaks
        ctx.strokeStyle = `rgba(186, 230, 253, ${(0.40 * atmoFrac).toFixed(3)})`;
        ctx.lineWidth = 1;
        const rainCount = Math.round(50 * atmoFrac);
        for (let r = 0; r < rainCount; r++) {
          const rx = (Math.random() * (w + 40)) - 20;
          const ry = Math.random() * (h - 20);
          const rLen = 8 + Math.random() * 14;
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx - 3, ry + rLen);
          ctx.stroke();
        }
      } else if (atmoCond === 'Low Light') {
        // Deep ambient sensor darkness
        ctx.fillStyle = 'rgba(2, 4, 8, 0.45)';
        ctx.fillRect(0, 0, w, h);
      }
    }

    const isGaussian = Boolean(dist?.gaussian_active || dist?.applied_noise_types?.includes('Gaussian') || (dist?.noise_level_sigma ?? 0) > 0.1);
    const noiseSigma = Math.min(20, Math.max(0, dist?.noise_level_sigma ?? (isGaussian ? 12.0 : 0.0)));

    const isSaltPepper = Boolean(dist?.salt_pepper_active || dist?.applied_noise_types?.includes('Salt & Pepper') || (dist?.salt_pepper_ratio ?? 0) > 0.001);
    const spDensity = Math.min(0.20, Math.max(0, dist?.salt_pepper_ratio ?? (isSaltPepper ? 0.04 : 0.0)));

    const isPoisson = Boolean(dist?.poisson_active || dist?.applied_noise_types?.includes('Poisson'));

    const snrReductionDb = Math.max(0, dist?.snr_reduction_db ?? 0.0);
    const atmoTransmittance = Math.max(0.01, Math.min(1.0, dist?.atmospheric_transmittance ?? dist?.transmission_factor ?? 1.0));

    // Forced SNR reduction attenuation factor: 10^(-SNR_dB / 20)
    const snrAttFactor = Math.pow(10, -snrReductionDb / 20.0);
    const totalTransmittance = Math.min(1.0, Math.max(0.03, snrAttFactor * atmoTransmittance));

    // Target intensity (properly incorporates atmospheric transmittance & SNR reduction)
    const targetRawIntensity = target?.intensity ?? 255.0;
    const effectiveIntensity = Math.min(255, Math.max(8, targetRawIntensity * totalTransmittance));
    let intensityFrac = effectiveIntensity / 255.0;

    // Optical Beacon 10 Hz Flicker Modulation
    const isFlicker = Boolean(dist?.beacon_flicker_enabled);
    if (isFlicker) {
      const fHz = dist?.beacon_flicker_frequency_hz ?? 10.0;
      const tSec = Date.now() / 1000.0;
      const flickerFactor = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(2.0 * Math.PI * fHz * tSec));
      intensityFrac = Math.max(0.04, Math.min(1.0, intensityFrac * flickerFactor));
    }

    // Ambient sensor grain under Gaussian noise
    if (isGaussian && noiseSigma > 0.5) {
      const grainCount = Math.min(160, Math.round(noiseSigma * 8));
      for (let i = 0; i < grainCount; i++) {
        const gx = Math.floor(Math.random() * w);
        const gy = Math.floor(Math.random() * h);
        const isBright = Math.random() >= 0.5;
        const gAlpha = Math.min(0.25, (noiseSigma / 20.0) * 0.20);
        ctx.fillStyle = isBright ? `rgba(255, 255, 255, ${gAlpha.toFixed(3)})` : `rgba(0, 0, 0, ${gAlpha.toFixed(3)})`;
        ctx.fillRect(gx, gy, 1.5, 1.5);
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

    if (target && beaconInSensor && !isEffectiveOccluded && beaconPx !== null && beaconPy !== null) {
      const px = beaconPx;
      const py = beaconPy;
      const sz = target.size_pixels; // 10 px default
      const shape = target.shape || 'Square';

      // (a) Quantum photon shot scintillation (temporal variance ~ sqrt(mean))
      let poissonScint = 1.0;
      if (isPoisson) {
        const relVariance = Math.min(0.40, 0.12 + (1.0 - intensityFrac) * 0.28);
        poissonScint = Math.max(0.25, Math.min(1.5, 1.0 + (Math.random() - 0.5) * 2.0 * relVariance));
      }
      const finalIntensityFrac = Math.max(0.04, Math.min(1.0, intensityFrac * poissonScint));

      // (b) Gaussian spatial dispersion of the readout centroid
      let effPx = px;
      let effPy = py;
      if (isGaussian && noiseSigma > 0.5) {
        const u1 = Math.max(1e-6, Math.random());
        const u2 = Math.random();
        const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
        const jitterAmp = Math.min(noiseSigma / 4.5, 3.8); // std dev in pixels
        effPx += z0 * jitterAmp;
        effPy += z1 * jitterAmp;
      }

      // (c) Spot halo glow (attenuated by forced SNR reduction and Poisson scintillation)
      const haloRadius = Math.max(8, 22 * (0.45 + 0.55 * finalIntensityFrac));
      const glow = ctx.createRadialGradient(effPx, effPy, 1, effPx, effPy, haloRadius);
      const coreGlowAlpha = Math.max(0.08, 0.95 * finalIntensityFrac);
      const midGlowAlpha = Math.max(0.04, 0.65 * finalIntensityFrac);
      glow.addColorStop(0, `rgba(255, 255, 255, ${coreGlowAlpha.toFixed(3)})`);
      glow.addColorStop(0.35, `rgba(6, 182, 212, ${midGlowAlpha.toFixed(3)})`);
      glow.addColorStop(1, 'rgba(6, 182, 212, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(effPx, effPy, haloRadius, 0, Math.PI * 2);
      ctx.fill();

      // Atmospheric Fog Mie Scattering Diffusion Halo
      if (atmoCond === 'Fog' && atmoFrac > 0.05) {
        const fogHaloRadius = Math.max(25, 45 * atmoFrac);
        const fogGlow = ctx.createRadialGradient(effPx, effPy, 2, effPx, effPy, fogHaloRadius);
        fogGlow.addColorStop(0, `rgba(225, 235, 250, ${(0.30 * atmoFrac * finalIntensityFrac).toFixed(3)})`);
        fogGlow.addColorStop(0.5, `rgba(180, 205, 235, ${(0.12 * atmoFrac * finalIntensityFrac).toFixed(3)})`);
        fogGlow.addColorStop(1, 'rgba(180, 205, 235, 0)');
        ctx.fillStyle = fogGlow;
        ctx.beginPath();
        ctx.arc(effPx, effPy, fogHaloRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      // (d) Spot geometry with Gaussian dispersion layers and SNR dimming
      const rVal = Math.round(244 * (0.35 + 0.65 * finalIntensityFrac));
      const gVal = Math.round(63 * (0.25 + 0.75 * finalIntensityFrac));
      const bVal = Math.round(94 * (0.25 + 0.75 * finalIntensityFrac));
      const spotAlpha = Math.max(0.20, finalIntensityFrac);

      // (e) Dynamic Motion Blur Slices (Kernel 5x5) along camera pan/tilt & platform velocity
      const isMotionBlur = Boolean(dist?.motion_blur_applied || dist?.motion_blur_enabled);
      if (isMotionBlur) {
        const panRate = camera?.pan_rate_deg_s ?? 0;
        const tiltRate = camera?.tilt_rate_deg_s ?? 0;
        const platDx = dist?.platform_dx_px ?? 0;
        const platDy = dist?.platform_dy_px ?? 0;
        let blurVx = 3.5;
        let blurVy = 2.5;
        if (Math.abs(panRate) > 0.02 || Math.abs(tiltRate) > 0.02) {
          const speed = Math.sqrt(panRate * panRate + tiltRate * tiltRate);
          const blurLen = Math.min(10, Math.max(3.5, speed * 2.0));
          blurVx = (panRate / speed) * blurLen;
          blurVy = (-tiltRate / speed) * blurLen;
        } else if (Math.abs(platDx) > 0.1 || Math.abs(platDy) > 0.1) {
          const pSpeed = Math.sqrt(platDx * platDx + platDy * platDy);
          const blurLen = Math.min(8, Math.max(3.5, pSpeed * 1.5));
          blurVx = (platDx / pSpeed) * blurLen;
          blurVy = (platDy / pSpeed) * blurLen;
        }
        const blurSlices = 5;
        for (let s = 1; s <= blurSlices; s++) {
          const sFrac = (s / (blurSlices + 1)) - 0.5; // -0.5 to +0.5
          const sxOff = blurVx * sFrac * 2.2;
          const syOff = blurVy * sFrac * 2.2;
          const sAlpha = (spotAlpha * 0.35) * (1.0 - Math.abs(sFrac) * 0.7);
          ctx.fillStyle = `rgba(${rVal}, ${gVal}, ${bVal}, ${sAlpha.toFixed(3)})`;
          if (shape === 'Square') {
            ctx.fillRect(effPx - sz / 2 + sxOff, effPy - sz / 2 + syOff, sz, sz);
          } else {
            ctx.beginPath();
            ctx.arc(effPx + sxOff, effPy + syOff, sz / 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      if (shape === 'Square') {
        // Problem Statement 4 Default: Square 10x10 px (Red square beacon)
        // If Gaussian noise active: render subtle dispersion / blur layers
        if (isGaussian && noiseSigma > 1.0) {
          const dispersionLayers = Math.min(4, Math.ceil(noiseSigma / 4));
          for (let l = 1; l <= dispersionLayers; l++) {
            const spread = (noiseSigma * 0.18 * l) / dispersionLayers;
            const layerAlpha = (spotAlpha * 0.22) / l;
            const lOffX = (Math.random() - 0.5) * spread;
            const lOffY = (Math.random() - 0.5) * spread;
            ctx.fillStyle = `rgba(${rVal}, ${gVal}, ${bVal}, ${layerAlpha.toFixed(3)})`;
            ctx.fillRect(effPx - sz / 2 + lOffX, effPy - sz / 2 + lOffY, sz, sz);
          }
        }

        // Primary spot
        ctx.fillStyle = `rgba(${rVal}, ${gVal}, ${bVal}, ${spotAlpha.toFixed(3)})`;
        ctx.strokeStyle = `rgba(255, 255, 255, ${Math.max(0.15, finalIntensityFrac).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.fillRect(effPx - sz / 2, effPy - sz / 2, sz, sz);
        ctx.strokeRect(effPx - sz / 2, effPy - sz / 2, sz, sz);

        // Core white center point (dimmed by SNR attenuation)
        const coreAlpha = Math.max(0.10, finalIntensityFrac);
        ctx.fillStyle = `rgba(255, 255, 255, ${coreAlpha.toFixed(3)})`;
        ctx.fillRect(effPx - 1.5, effPy - 1.5, 3, 3);
      } else if (shape === 'Circle') {
        if (isGaussian && noiseSigma > 1.0) {
          const dispersionLayers = Math.min(4, Math.ceil(noiseSigma / 4));
          for (let l = 1; l <= dispersionLayers; l++) {
            const spread = (noiseSigma * 0.18 * l) / dispersionLayers;
            const layerAlpha = (spotAlpha * 0.22) / l;
            const lOffX = (Math.random() - 0.5) * spread;
            const lOffY = (Math.random() - 0.5) * spread;
            ctx.strokeStyle = `rgba(56, 189, 248, ${layerAlpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(effPx + lOffX, effPy + lOffY, sz / 2 + (l * 0.5), 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        ctx.fillStyle = `rgba(255, 255, 255, ${spotAlpha.toFixed(3)})`;
        ctx.strokeStyle = `rgba(56, 189, 248, ${spotAlpha.toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(effPx, effPy, sz / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (shape === 'Gaussian') {
        const gGrad = ctx.createRadialGradient(effPx, effPy, 0, effPx, effPy, sz / 1.5);
        gGrad.addColorStop(0, `rgba(255, 255, 255, ${spotAlpha.toFixed(3)})`);
        gGrad.addColorStop(0.5, `rgba(56, 189, 248, ${(0.7 * spotAlpha).toFixed(3)})`);
        gGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
        ctx.fillStyle = gGrad;
        ctx.beginPath();
        ctx.arc(effPx, effPy, sz / 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // (e) Salt & Pepper Impulsive Noise on Beacon & Sensor
      if (isSaltPepper && spDensity > 0.002) {
        // Impulsive bit corruptions directly cutting through the beacon
        const spotSpeckCount = Math.max(2, Math.round(sz * sz * spDensity * 1.6));
        for (let i = 0; i < spotSpeckCount; i++) {
          const spX = effPx - sz / 2 + Math.random() * sz;
          const spY = effPy - sz / 2 + Math.random() * sz;
          const isSalt = Math.random() >= 0.5;
          ctx.fillStyle = isSalt ? 'rgba(255, 255, 255, 0.95)' : 'rgba(0, 0, 0, 0.95)';
          ctx.fillRect(Math.floor(spX), Math.floor(spY), 1.5, 1.5);
        }

        // Surrounding sensor field specks
        const sensorSpeckCount = Math.max(8, Math.round(200 * spDensity));
        for (let i = 0; i < sensorSpeckCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const radius = sz + Math.random() * 85;
          const sx = Math.floor(effPx + Math.cos(angle) * radius);
          const sy = Math.floor(effPy + Math.sin(angle) * radius);
          if (sx >= 0 && sx <= w && sy >= 0 && sy <= h) {
            const isSalt = Math.random() >= 0.5;
            ctx.fillStyle = isSalt ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.85)';
            ctx.fillRect(sx, sy, 1.5, 1.5);
          }
        }
      }

      // Tracking error line from center boresight to spot
      ctx.strokeStyle = tracking?.is_locked ? '#10b981' : '#f59e0b';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(effPx, effPy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Pixel readout tag + Disturbance indicators
      ctx.fillStyle = '#38bdf8';
      ctx.font = '10px JetBrains Mono, monospace';
      const activeList: string[] = [];
      if (isGaussian) activeList.push(`GAUSS σ=${noiseSigma.toFixed(0)}`);
      if (isSaltPepper) activeList.push(`S&P ${(spDensity * 100).toFixed(0)}%`);
      if (isPoisson) activeList.push('POISSON');
      if (snrReductionDb > 0) activeList.push(`-${snrReductionDb.toFixed(0)}dB`);
      if (isFlicker) activeList.push('FLICKER 10Hz');
      if (isMotionBlur) activeList.push('BLUR 5x5');
      if (atmoCond !== 'Clear' && atmoFrac > 0.05) activeList.push(`${atmoCond.toUpperCase()} T=${((dist?.atmospheric_transmittance ?? 1.0) * 100).toFixed(0)}%`);
      const distTag = activeList.length > 0 ? ` [${activeList.join(', ')}]` : '';
      ctx.fillText(`BEACON [${effPx.toFixed(1)}, ${effPy.toFixed(1)}]${distTag}`, effPx + 14, effPy - 10);
    } else if (target && isEffectiveOccluded) {
      // Occlusion alert badge & mask on sensor
      ctx.save();
      if (isChannelOccluded) {
        // Channel Obstacle / Cloud Occlusion Mask
        const ox = beaconPx ?? cx;
        const oy = beaconPy ?? cy;
        // Smoky diffuse cloud gradient over beacon spot
        const cloudGrad = ctx.createRadialGradient(ox, oy, 4, ox, oy, 44);
        cloudGrad.addColorStop(0, 'rgba(71, 85, 105, 0.95)');
        cloudGrad.addColorStop(0.5, 'rgba(51, 65, 85, 0.80)');
        cloudGrad.addColorStop(1, 'rgba(30, 41, 59, 0)');
        ctx.fillStyle = cloudGrad;
        ctx.beginPath();
        ctx.ellipse(ox, oy, 44, 28, Math.PI / 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Channel occlusion alert badge
        ctx.fillStyle = 'rgba(244, 63, 94, 0.20)';
        ctx.fillRect(cx - 145, cy + 30, 290, 26);
        ctx.strokeStyle = '#f43f5e';
        ctx.strokeRect(cx - 145, cy + 30, 290, 26);
        ctx.fillStyle = '#fca5a5';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('OPTICAL CHANNEL OCCLUDED (CLOUD / OBSTACLE)', cx, cy + 43);
      } else {
        // Earth horizon / limb occlusion
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
      }
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
      if (isEffectiveOccluded && patState !== 'NO_COVERAGE') {
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
  }, [target, camera, tracking, detection, disturbance, viewMode, showSatellitePov, fovMode, isOccludedState]);

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

  const isChannelOccluded = Boolean(disturbance?.is_occluded || disturbance?.occlusion_active);
  const isEffectiveOccluded = isOccludedState || isChannelOccluded;

  // When satellite FOV locks onto beacon (rectangular frustum turns green), beacon is locked in FOV
  // The moment sight is lost (rectangular frustum turns red or channel is occluded), it is lost from FOV
  const isBeaconVisibleInFov = !isEffectiveOccluded && (
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
              title={fovMode === 'telephoto' ? 'Switch to Wide Horizon View (42°)' : 'Switch to Narrow FPA Sensor View (4.0°)'}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px] transition"
            >
              {fovMode === 'telephoto' ? (
                <>
                  <ZoomIn className="w-3 h-3 text-amber-400" />
                  <span>4.0° FPA Zoom</span>
                </>
              ) : (
                <>
                  <ZoomOut className="w-3 h-3 text-emerald-400" />
                  <span>42° Wide Horizon</span>
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
            FOV: <span className="text-white font-bold">{fovMode === 'telephoto' ? `${camera?.fov_horizontal_deg.toFixed(1)}° × ${camera?.fov_vertical_deg.toFixed(1)}°` : '56.0° × 42.0°'}</span>
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">
            Target: {(() => {
              if (isEffectiveOccluded) {
                return (
                  <span className="text-rose-400 font-bold inline-flex items-center gap-1">
                    <EyeOff className="w-3 h-3" /> {isChannelOccluded ? 'OCCLUDED (CLOUD / OBSTACLE)' : 'OCCLUDED (EARTH LIMB)'}
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
                src={`/api/simulation/frame?annotated=${viewMode === 'opencv_annotated'}&t=${streamTick}`}
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
              <span>SATELLITE POV • {fovMode === 'telephoto' ? '4.0° FPA SENSOR' : '42.0° WIDE HORIZON'} • {autoLOS ? 'BEACON TRACK' : 'EARTH HORIZON'}</span>
            </div>
          )}

          {/* Tactical Overlay: Beacon Lost Alarm Banner */}
          {isBeaconLost && viewMode === 'canvas' && (
            <div
              onClick={() => alarmAudio.unlock()}
              title="Click anywhere to unlock audio if muted/blocked by browser"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 bg-rose-950/95 border border-rose-500 rounded text-[10px] font-mono text-rose-200 font-bold tracking-wider animate-pulse flex items-center gap-2 backdrop-blur-sm shadow-xl shadow-rose-950/80 cursor-pointer select-none"
            >
              <span>
                {isEffectiveOccluded
                  ? (isChannelOccluded ? 'Optical Channel Occluded (Cloud / Obstacle)' : 'Beacon out of sight')
                  : 'Beacon out of sight'}
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
