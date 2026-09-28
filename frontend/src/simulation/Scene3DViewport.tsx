import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { TargetState, CameraState, DisturbanceTelemetry } from '../types';
import { satellitePovSync } from './satellitePovSync';
import { alarmAudio } from '../services/alarmAudio';
import HandoverPanel from './HandoverPanel';
import {
  Box,
  RefreshCw,
  Compass,
  Sliders,
  Play,
  Pause,
  RotateCcw,
  X,
  Orbit,
  Layers,
  Globe,
  Radio,
  Locate,
} from 'lucide-react';

interface Scene3DProps {
  target: TargetState | null;
  targets?: TargetState[];
  camera: CameraState | null;
  disturbance?: DisturbanceTelemetry | null;
  worldWidth?: number;
  worldHeight?: number;
  worldDepth?: number;
}

export interface OrbitPreset {
  id: string;
  name: string;
  shortName: string;
  radius: number;
  altitudeKm: number;
  incDeg: number;
  raanDeg: number;
  color: number;
  description: string;
}

// Low Earth Orbit (LEO) Presets (All within 115u to 165u altitude)
export const LEO_PRESETS: OrbitPreset[] = [
  {
    id: 'leo-550-p1',
    name: 'LEO Walker Plane 1 (550 km, 53°)',
    shortName: 'Walker 1 (Host)',
    radius: 150,
    altitudeKm: 550,
    incDeg: 53.0,
    raanDeg: 35.0,
    color: 0x38bdf8,
    description: 'Primary operational optical transceiver plane',
  },
  {
    id: 'leo-550-p2',
    name: 'LEO Walker Plane 2 (550 km, 53°)',
    shortName: 'Walker 2',
    radius: 150,
    altitudeKm: 550,
    incDeg: 53.0,
    raanDeg: 110.0,
    color: 0x0284c7,
    description: 'Adjacent constellation crosslink relay plane',
  },
  {
    id: 'leo-550-p3',
    name: 'LEO Walker Plane 3 (550 km, 53°)',
    shortName: 'Walker 3',
    radius: 150,
    altitudeKm: 550,
    incDeg: 53.0,
    raanDeg: 185.0,
    color: 0x0284c7,
    description: 'Quadrature constellation relay plane',
  },
  {
    id: 'leo-polar-sso',
    name: 'Polar Sun-Synchronous SSO (700 km, 97.8°)',
    shortName: 'Polar SSO (97.8°)',
    radius: 140,
    altitudeKm: 700,
    incDeg: 97.8,
    raanDeg: 75.0,
    color: 0x818cf8,
    description: 'Observation orbit passing over Earth north/south poles',
  },
  {
    id: 'leo-equatorial',
    name: 'Equatorial Fast Relay (350 km, 12°)',
    shortName: 'Equatorial (12°)',
    radius: 125,
    altitudeKm: 350,
    incDeg: 12.0,
    raanDeg: 0.0,
    color: 0x06b6d4,
    description: 'Low-inclination high-cadence tropical orbit',
  },
  {
    id: 'leo-vleo',
    name: 'Very Low Earth Orbit VLEO (200 km, 34°)',
    shortName: 'VLEO / Drone (34°)',
    radius: 115,
    altitudeKm: 200,
    incDeg: 34.0,
    raanDeg: 310.0,
    color: 0x10b981,
    description: 'Atmospheric boundary reconnaissance / UAV crosslink',
  },
  {
    id: 'leo-high',
    name: 'High-LEO Broadband Shell (1,150 km, 68°)',
    shortName: 'High-LEO (68°)',
    radius: 165,
    altitudeKm: 1150,
    incDeg: 68.0,
    raanDeg: 145.0,
    color: 0x6366f1,
    description: 'Upper boundary LEO constellation shell',
  },
];

// Helper: calculate 3D Cartesian position from Keplerian orbital elements
const computeOrbitPoint = (
  radius: number,
  incDeg: number,
  raanDeg: number,
  trueAnomaly: number
): THREE.Vector3 => {
  const p = new THREE.Vector3(radius * Math.cos(trueAnomaly), 0, radius * Math.sin(trueAnomaly));
  p.applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(incDeg));
  p.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(raanDeg));
  return p;
};

export const Scene3DViewport: React.FC<Scene3DProps> = ({
  target,
  camera,
  disturbance,
  worldWidth = 2000,
  worldHeight = 2000,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Dynamic 3D Object references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cameraMeshRef = useRef<THREE.Group | null>(null);
  const targetMeshRef = useRef<THREE.Group | null>(null);
  const targetCubeMeshRef = useRef<THREE.Mesh | null>(null);
  const losLineRef = useRef<THREE.Line | null>(null);
  const trailLineRef = useRef<THREE.Line | null>(null);
  const frustumLinesRef = useRef<THREE.LineSegments | null>(null);
  const activeOrbitRingRef = useRef<THREE.Line | null>(null);
  const globeMeshRef = useRef<THREE.Mesh | null>(null);
  const beaconGroupRef = useRef<THREE.Group | null>(null);
  const beaconTrackRingRef = useRef<THREE.Line | null>(null);
  // Backup satellite (for handover visualisation)
  const backupSatMeshRef = useRef<THREE.Group | null>(null);
  const backupLosLineRef = useRef<THREE.Line | null>(null);

  // Target Ground Station position ref (radius = 100 on surface)
  const globeRadius = 100;
  const tgtPosRef = useRef(new THREE.Vector3(38, 76, 52).normalize().multiplyScalar(globeRadius));

  // Beacon Surface Motion State (Revolve on Ground at R = 100u, with Static toggle)
  const [beaconRevolving, setBeaconRevolving] = useState<boolean>(true);
  const [beaconSpeed, setBeaconSpeed] = useState<number>(0.0018);
  const [beaconAnomalyDeg, setBeaconAnomalyDeg] = useState<number>(120.0);
  const [beaconInc, setBeaconInc] = useState<number>(28.5);
  const [beaconRaan, setBeaconRaan] = useState<number>(65.0);

  // Handover state (populated from satellitePovSync or sim telemetry)
  const [handoverData, setHandoverData] = useState<any>(null);
  const handoverRef = useRef<any>(null);

  // Phase offset for backup satellite (degrees along-track)
  const backupPhaseOffsetDeg = 20.0;

  const beaconMotionRef = useRef({
    isRevolving: true,
    speed: 0.0018,
    anomaly: THREE.MathUtils.degToRad(120.0),
    incDeg: 28.5,
    raanDeg: 65.0,
  });

  useEffect(() => {
    beaconMotionRef.current.isRevolving = beaconRevolving;
    beaconMotionRef.current.speed = beaconSpeed;
    beaconMotionRef.current.incDeg = beaconInc;
    beaconMotionRef.current.raanDeg = beaconRaan;
  }, [beaconRevolving, beaconSpeed, beaconInc, beaconRaan]);

  // Interactive Orbit Controller State
  const [selectedPresetId, setSelectedPresetId] = useState<string>('leo-550-p1');
  const [orbitRadius, setOrbitRadius] = useState<number>(150);
  const [orbitInc, setOrbitInc] = useState<number>(53.0);
  const [orbitRaan, setOrbitRaan] = useState<number>(35.0);
  const [orbitAnomalyDeg, setOrbitAnomalyDeg] = useState<number>(48.7);
  const [autoRevolve, setAutoRevolve] = useState<boolean>(true);
  const [revolveSpeed, setRevolveSpeed] = useState<number>(0.003);
  const [showOrbitTuner, setShowOrbitTuner] = useState<boolean>(false);
  const [currentSlantRange, setCurrentSlantRange] = useState<number>(85.4);
  const [isOccludedByEarth, setIsOccludedByEarth] = useState<boolean>(false);

  // Auto LOS alignment state (synchronized with satellitePovSync and FPACameraViewport)
  const [autoLOS, setAutoLOS] = useState<boolean>(false);
  const autoLOSRef = useRef<boolean>(false);
  autoLOSRef.current = autoLOS;

  // Gradual slew state: current 3D optical boresight direction & angular off-axis error
  const boresightDirRef = useRef<THREE.Vector3 | null>(null);
  const slewProgressRef = useRef<number>(0);
  const [slewAngularError, setSlewAngularError] = useState<number>(0);

  const cameraPropRef = useRef(camera);
  cameraPropRef.current = camera;
  const disturbancePropRef = useRef(disturbance);
  disturbancePropRef.current = disturbance;

  // Sync autoLOS state from satellitePovSync
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

  // Earth Diurnal Rotation State (Spin around polar Y-axis)
  const [earthSpinEnabled, setEarthSpinEnabled] = useState<boolean>(true);
  const [earthSpinSpeed, setEarthSpinSpeed] = useState<number>(0.0004);

  const earthSpinRef = useRef({
    enabled: true,
    speed: 0.0004,
  });

  useEffect(() => {
    earthSpinRef.current.enabled = earthSpinEnabled;
    earthSpinRef.current.speed = earthSpinSpeed;
  }, [earthSpinEnabled, earthSpinSpeed]);

  // Active Orbit State Ref for 60fps render loop access
  const activeOrbitRef = useRef({
    radius: 150,
    incDeg: 53.0,
    raanDeg: 35.0,
    anomaly: THREE.MathUtils.degToRad(48.7),
    autoRevolve: true,
    speed: 0.003,
  });

  // Keep ref synchronized with state
  useEffect(() => {
    activeOrbitRef.current.radius = orbitRadius;
    activeOrbitRef.current.incDeg = orbitInc;
    activeOrbitRef.current.raanDeg = orbitRaan;
    activeOrbitRef.current.autoRevolve = autoRevolve;
    activeOrbitRef.current.speed = revolveSpeed;
  }, [orbitRadius, orbitInc, orbitRaan, autoRevolve, revolveSpeed]);

  // Orbit camera drag state
  const isDraggingRef = useRef(false);
  const previousMousePositionRef = useRef({ x: 0, y: 0 });
  const orbitStateRef = useRef({
    theta: 0.75,
    phi: 0.45,
    radius: 340.0,
  });

  // Function to recompute active orbit ring line geometry
  const updateActiveOrbitRingGeometry = (radius: number, incDeg: number, raanDeg: number) => {
    if (!activeOrbitRingRef.current) return;
    const segments = 120;
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      pts.push(computeOrbitPoint(radius, incDeg, raanDeg, a));
    }
    activeOrbitRingRef.current.geometry.setFromPoints(pts);
    activeOrbitRingRef.current.geometry.attributes.position.needsUpdate = true;
    activeOrbitRingRef.current.computeLineDistances();
  };

  // Function to recompute beacon ground track ring line geometry
  const updateBeaconTrackGeometry = (incDeg: number, raanDeg: number) => {
    if (!beaconTrackRingRef.current) return;
    const segments = 120;
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      pts.push(computeOrbitPoint(globeRadius + 0.15, incDeg, raanDeg, a));
    }
    beaconTrackRingRef.current.geometry.setFromPoints(pts);
    beaconTrackRingRef.current.geometry.attributes.position.needsUpdate = true;
    beaconTrackRingRef.current.computeLineDistances();
  };

  // Preset Selection Handler
  const handlePresetSelect = (presetId: string) => {
    setSelectedPresetId(presetId);
    const p = LEO_PRESETS.find((item) => item.id === presetId);
    if (p) {
      setOrbitRadius(p.radius);
      setOrbitInc(p.incDeg);
      setOrbitRaan(p.raanDeg);
      activeOrbitRef.current.radius = p.radius;
      activeOrbitRef.current.incDeg = p.incDeg;
      activeOrbitRef.current.raanDeg = p.raanDeg;
      updateActiveOrbitRingGeometry(p.radius, p.incDeg, p.raanDeg);
    }
  };

  // Custom Orbit Slider Handler
  const handleCustomParamChange = (radius: number, inc: number, raan: number) => {
    setSelectedPresetId('custom');
    setOrbitRadius(radius);
    setOrbitInc(inc);
    setOrbitRaan(raan);
    activeOrbitRef.current.radius = radius;
    activeOrbitRef.current.incDeg = inc;
    activeOrbitRef.current.raanDeg = raan;
    updateActiveOrbitRingGeometry(radius, inc, raan);
  };

  // Helper: check if line segment between satellite and target intersects Earth sphere
  const checkEarthOcclusion = (
    satPos: THREE.Vector3,
    tgtPos: THREE.Vector3,
    radius: number = 100
  ): { isOccluded: boolean; hitPoint: THREE.Vector3 | null; hitDistance: number | null } => {
    const seg = new THREE.Vector3().subVectors(tgtPos, satPos);
    const segLen = seg.length();
    if (segLen < 0.001) return { isOccluded: false, hitPoint: null, hitDistance: null };
    const dir = seg.clone().normalize();

    // Line: p(t) = satPos + t * dir. Check intersection with sphere |p(t)| = radius
    const b = 2 * satPos.dot(dir);
    const c = satPos.lengthSq() - radius * radius;
    const discriminant = b * b - 4 * c;

    if (discriminant >= 0) {
      const sqrtDisc = Math.sqrt(discriminant);
      const t1 = (-b - sqrtDisc) / 2;
      const t2 = (-b + sqrtDisc) / 2;

      // Check if intersection occurs between satellite and target
      const epsilon = 1.5;
      if (t1 > 0.1 && t1 < segLen - epsilon) {
        const hitPoint = satPos.clone().addScaledVector(dir, t1 * 0.998);
        return { isOccluded: true, hitPoint, hitDistance: t1 };
      }
      if (t2 > 0.1 && t2 < segLen - epsilon) {
        const hitPoint = satPos.clone().addScaledVector(dir, t2 * 0.998);
        return { isOccluded: true, hitPoint, hitDistance: t2 };
      }
    }

    return { isOccluded: false, hitPoint: null, hitDistance: null };
  };

  // Helper to recompute mathematical FOV frustum pointing along boresightDir, stopping at Earth surface
  const updateFrustum = (
    apex: THREE.Vector3,
    boresightDir: THREE.Vector3,
    targetPoint: THREE.Vector3,
    isInFov: boolean,
    isAutoLOS: boolean,
    slewErrorDeg: number = 0
  ) => {
    if (!frustumLinesRef.current) return;

    const dir = boresightDir.clone().normalize();

    // Check if line of sight is occluded by the Earth globe
    const { isOccluded, hitDistance } = checkEarthOcclusion(apex, targetPoint, globeRadius);

    // Ray-sphere intersection with Earth surface (R = 100) along current boresight direction
    const b = 2 * apex.dot(dir);
    const c = apex.lengthSq() - globeRadius * globeRadius;
    const disc = b * b - 4 * c;
    let frustumDist: number;

    if (disc >= 0) {
      const tHit = (-b - Math.sqrt(disc)) / 2;
      if (tHit > 0.1) {
        frustumDist = Math.max(8.0, tHit * 0.998);
      } else {
        frustumDist = Math.max(8.0, apex.length() - globeRadius);
      }
    } else {
      frustumDist = Math.max(8.0, apex.length() - globeRadius);
    }

    // When aligned with beacon or in line of sight, clamp to target distance if direct
    if (isAutoLOS && slewErrorDeg < 2.5 && !isOccluded) {
      const targetDist = apex.distanceTo(targetPoint);
      frustumDist = Math.min(frustumDist, targetDist * 0.95);
    } else if (isAutoLOS && isOccluded && hitDistance !== null) {
      frustumDist = Math.max(8.0, hitDistance * 0.995);
    }

    const baseCenter = apex.clone().addScaledVector(dir, frustumDist);
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(dir.dot(up)) > 0.92) {
      up = new THREE.Vector3(1, 0, 0);
    }
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, dir).normalize();

    // 4° × 3° Optical FOV cone dimensions
    const hw = Math.tan(THREE.MathUtils.degToRad(2.0)) * frustumDist;
    const hh = Math.tan(THREE.MathUtils.degToRad(1.5)) * frustumDist;

    // Corner points before Earth clamping
    let tl = baseCenter.clone().addScaledVector(right, -hw).addScaledVector(realUp, hh);
    let tr = baseCenter.clone().addScaledVector(right, hw).addScaledVector(realUp, hh);
    let br = baseCenter.clone().addScaledVector(right, hw).addScaledVector(realUp, -hh);
    let bl = baseCenter.clone().addScaledVector(right, -hw).addScaledVector(realUp, -hh);

    // Mathematical clamping for each corner ray against the Earth sphere (stops at surface)
    const clampToEarthSurface = (corner: THREE.Vector3): THREE.Vector3 => {
      const cDir = new THREE.Vector3().subVectors(corner, apex).normalize();
      const cLen = corner.distanceTo(apex);
      const bCorner = 2 * apex.dot(cDir);
      const cCorner = apex.lengthSq() - globeRadius * globeRadius;
      const disc = bCorner * bCorner - 4 * cCorner;
      if (disc >= 0) {
        const tHit = (-bCorner - Math.sqrt(disc)) / 2;
        if (tHit > 0.1 && tHit < cLen) {
          return apex.clone().addScaledVector(cDir, tHit * 0.998);
        }
      }
      return corner;
    };

    tl = clampToEarthSurface(tl);
    tr = clampToEarthSurface(tr);
    br = clampToEarthSurface(br);
    bl = clampToEarthSurface(bl);

    const frustumPoints = [
      apex.x, apex.y, apex.z, tl.x, tl.y, tl.z,
      apex.x, apex.y, apex.z, tr.x, tr.y, tr.z,
      apex.x, apex.y, apex.z, br.x, br.y, br.z,
      apex.x, apex.y, apex.z, bl.x, bl.y, bl.z,
      tl.x, tl.y, tl.z, tr.x, tr.y, tr.z,
      tr.x, tr.y, tr.z, br.x, br.y, br.z,
      br.x, br.y, br.z, bl.x, bl.y, bl.z,
      bl.x, bl.y, bl.z, tl.x, tl.y, tl.z,
    ];

    frustumLinesRef.current.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(frustumPoints, 3)
    );
    frustumLinesRef.current.geometry.attributes.position.needsUpdate = true;

    const mat = frustumLinesRef.current.material as THREE.LineBasicMaterial;
    if (mat) {
      if (isOccluded || slewErrorDeg > 2.0) {
        // Red: Lost sight of beacon from satellite's FOV (the moment it turns red, alarm beeps)
        mat.color.setHex(0xef4444);
        mat.opacity = 0.9;
      } else {
        // Green: Locked inside satellite's FOV (when it turns green, alarm is silent)
        mat.color.setHex(0x10b981);
        mat.opacity = 0.9;
      }
    }
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 480;

    // 1. Scene setup with deep space background
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070e);
    sceneRef.current = scene;

    // 2. Perspective Camera
    const perspCamera = new THREE.PerspectiveCamera(45, width / height, 1, 3000);
    cameraRef.current = perspCamera;

    // 3. WebGL Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambientLight);
    const sunLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
    sunLight.position.set(300, 400, 300);
    scene.add(sunLight);

    // 5. INJECT THE GLOBE (Earth) AT SCENE ORIGIN (0, 0, 0)
    const globeGeo = new THREE.SphereGeometry(globeRadius, 36, 18);
    const globeMat = new THREE.MeshBasicMaterial({
      color: 0x141a29,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      depthWrite: true,
      depthTest: true,
    });
    const globeMesh = new THREE.Mesh(globeGeo, globeMat);
    globeMesh.position.set(0, 0, 0);
    globeMesh.renderOrder = 0;
    scene.add(globeMesh);
    globeMeshRef.current = globeMesh;

    // Wireframe overlay grid (latitudinal/longitudinal neon cyan lines)
    const wireframeGeo = new THREE.WireframeGeometry(globeGeo);
    const wireframeMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.5,
    });
    const globeWireframe = new THREE.LineSegments(wireframeGeo, wireframeMat);
    globeMesh.add(globeWireframe);

    // Subtle atmospheric rim
    const atmoGeo = new THREE.SphereGeometry(globeRadius + 1.2, 36, 18);
    const atmoMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
    });
    const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
    scene.add(atmoMesh);

    // Central 3D coordinate axes inside the globe at (0, 0, 0)
    const axesHelper = new THREE.AxesHelper(65);
    axesHelper.renderOrder = 500;
    scene.add(axesHelper);

    // Deep background grid plane shifted below the globe
    const gridHelper = new THREE.GridHelper(500, 20, 0x1e3a5f, 0x0f172a);
    gridHelper.position.set(0, -globeRadius - 20, 0);
    scene.add(gridHelper);

    // 6. INJECT BACKGROUND LEO CONSTELLATION ORBITS & ANIMATED PEER SATELLITES
    const peerNodes: {
      mesh: THREE.Mesh;
      radius: number;
      incDeg: number;
      raanDeg: number;
      speed: number;
      anomaly: number;
    }[] = [];

    // Background secondary orbits from presets
    LEO_PRESETS.slice(1).forEach((preset, index) => {
      const segments = 120;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= segments; j++) {
        const a = (j / segments) * Math.PI * 2;
        pts.push(computeOrbitPoint(preset.radius, preset.incDeg, preset.raanDeg, a));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineDashedMaterial({
        color: preset.color,
        dashSize: 4,
        gapSize: 3,
        transparent: true,
        opacity: 0.35,
        depthTest: true,
      });
      const ring = new THREE.Line(geo, mat);
      ring.computeLineDistances();
      scene.add(ring);

      // Peer satellite node drifting along secondary LEO orbit
      const nodeGeo = new THREE.SphereGeometry(1.8, 14, 14);
      const nodeMat = new THREE.MeshBasicMaterial({ color: preset.color });
      const nodeMesh = new THREE.Mesh(nodeGeo, nodeMat);
      const startAnomaly = (index + 1) * 1.1;
      nodeMesh.position.copy(computeOrbitPoint(preset.radius, preset.incDeg, preset.raanDeg, startAnomaly));
      scene.add(nodeMesh);

      peerNodes.push({
        mesh: nodeMesh,
        radius: preset.radius,
        incDeg: preset.incDeg,
        raanDeg: preset.raanDeg,
        speed: 0.0025 + index * 0.0004,
        anomaly: startAnomaly,
      });
    });

    // 7. ACTIVE HIGHLIGHTED SATELLITE ORBIT RING (Dynamically updated)
    const activeRingSegments = 120;
    const activeRingPts: THREE.Vector3[] = [];
    for (let j = 0; j <= activeRingSegments; j++) {
      const a = (j / activeRingSegments) * Math.PI * 2;
      activeRingPts.push(
        computeOrbitPoint(
          activeOrbitRef.current.radius,
          activeOrbitRef.current.incDeg,
          activeOrbitRef.current.raanDeg,
          a
        )
      );
    }
    const activeRingGeo = new THREE.BufferGeometry().setFromPoints(activeRingPts);
    const activeRingMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 6,
      gapSize: 2.5,
      transparent: true,
      opacity: 0.85,
      depthTest: true,
    });
    const activeRing = new THREE.Line(activeRingGeo, activeRingMat);
    activeRing.computeLineDistances();
    activeRing.renderOrder = 502;
    scene.add(activeRing);
    activeOrbitRingRef.current = activeRing;

    // Initial positions
    const initialSatPos = computeOrbitPoint(
      activeOrbitRef.current.radius,
      activeOrbitRef.current.incDeg,
      activeOrbitRef.current.raanDeg,
      activeOrbitRef.current.anomaly
    );
    const tgtPos = tgtPosRef.current;

    // 8. SATELLITE (Blue Sphere) with Solar Panels and Optical Lens Barrel
    const satGroup = new THREE.Group();

    // Blue sphere main body
    const satBodyGeo = new THREE.SphereGeometry(6, 24, 24);
    const satBodyMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.25,
      metalness: 0.85,
    });
    const satBody = new THREE.Mesh(satBodyGeo, satBodyMat);
    satGroup.add(satBody);

    // Solar panels
    const panelGeo = new THREE.BoxGeometry(16, 0.4, 4);
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x0f2942,
      metalness: 0.9,
      roughness: 0.3,
    });
    const panelMesh = new THREE.Mesh(panelGeo, panelMat);
    satGroup.add(panelMesh);

    // Optical aperture barrel
    const lensGeo = new THREE.CylinderGeometry(2, 2.8, 6, 16);
    lensGeo.rotateX(Math.PI / 2);
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.1 });
    const lensMesh = new THREE.Mesh(lensGeo, lensMat);
    lensMesh.position.set(0, 0, 4);
    satGroup.add(lensMesh);

    satGroup.position.copy(initialSatPos);
    satGroup.lookAt(tgtPos);
    scene.add(satGroup);
    cameraMeshRef.current = satGroup;

    // 9. TARGET BEACON (Red Cube Ground Station mounted flat ON the Globe Surface)
    // To guarantee the red square beacon NEVER penetrates or gets inside the globe:
    // 1) Translate box geometry so the bottom face is at Z = 0 (pivot at bottom face).
    // 2) Position group at the surface (R = globeRadius + 0.05).
    // 3) Orient group so local +Z points outward along the surface normal.
    // 4) Every point of the cube is at distance >= (globeRadius + 0.05) > globeRadius.
    const beaconGroup = new THREE.Group();

    // Ground Station Base Pad Ring (flush with globe surface)
    const padGeo = new THREE.RingGeometry(2.0, 5.5, 24);
    const padMat = new THREE.MeshBasicMaterial({
      color: 0xff3366,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45,
      depthTest: true,
    });
    const padMesh = new THREE.Mesh(padGeo, padMat);
    padMesh.position.set(0, 0, 0.02);
    beaconGroup.add(padMesh);

    // Red Cube Beacon Body (5.5 × 5.5 × 5.5, bottom face at Z = 0)
    const cubeHeight = 5.5;
    const targetGeo = new THREE.BoxGeometry(5.5, 5.5, cubeHeight);
    targetGeo.translate(0, 0, cubeHeight / 2); // Shifts pivot so bottom face rests on surface
    const targetMat = new THREE.MeshBasicMaterial({ color: 0xff3366, depthTest: true });
    const targetCubeMesh = new THREE.Mesh(targetGeo, targetMat);
    beaconGroup.add(targetCubeMesh);
    targetCubeMeshRef.current = targetCubeMesh;

    // Optical Emitter Aperture on top of the beacon
    const emitterGeo = new THREE.CylinderGeometry(0.8, 1.4, 0.8, 16);
    emitterGeo.rotateX(Math.PI / 2);
    emitterGeo.translate(0, 0, cubeHeight + 0.4);
    const emitterMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: true });
    const emitterMesh = new THREE.Mesh(emitterGeo, emitterMat);
    beaconGroup.add(emitterMesh);

    // Initial position on the ground from beaconMotionRef (R = globeRadius = 100u)
    const initialBeaconPos = computeOrbitPoint(
      globeRadius,
      beaconMotionRef.current.incDeg,
      beaconMotionRef.current.raanDeg,
      beaconMotionRef.current.anomaly
    );
    tgtPosRef.current.copy(initialBeaconPos);

    // Position and orient the beacon group strictly on top of the globe surface
    const beaconNormal = initialBeaconPos.clone().normalize();
    beaconGroup.position.copy(beaconNormal.clone().multiplyScalar(globeRadius + 0.05));
    beaconGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), beaconNormal);
    beaconGroup.renderOrder = 6;
    scene.add(beaconGroup);
    beaconGroupRef.current = beaconGroup;
    targetMeshRef.current = beaconGroup;

    // Ground Track of the Beacon (Great circle / path on the surface at R = globeRadius + 0.15)
    const trackSegments = 120;
    const trackPts: THREE.Vector3[] = [];
    for (let j = 0; j <= trackSegments; j++) {
      const a = (j / trackSegments) * Math.PI * 2;
      trackPts.push(
        computeOrbitPoint(
          globeRadius + 0.15,
          beaconMotionRef.current.incDeg,
          beaconMotionRef.current.raanDeg,
          a
        )
      );
    }
    const trackGeo = new THREE.BufferGeometry().setFromPoints(trackPts);
    const trackMat = new THREE.LineDashedMaterial({
      color: 0xf43f5e,
      dashSize: 3,
      gapSize: 2,
      transparent: true,
      opacity: 0.4,
      depthTest: true,
    });
    const trackRing = new THREE.Line(trackGeo, trackMat);
    trackRing.computeLineDistances();
    trackRing.renderOrder = 4;
    scene.add(trackRing);
    beaconTrackRingRef.current = trackRing;

    // 10. LINE OF SIGHT (LOS) RAY (Dashed line, depthTest=true to prevent crossing through Earth)
    const losGeo = new THREE.BufferGeometry();
    losGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [initialSatPos.x, initialSatPos.y, initialSatPos.z, tgtPos.x, tgtPos.y, tgtPos.z],
        3
      )
    );
    const losMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 4,
      gapSize: 2,
      depthTest: true, // Prevents crossing through globe
      transparent: true,
      opacity: 0.95,
    });
    const losLine = new THREE.Line(losGeo, losMat);
    losLine.computeLineDistances();
    losLine.renderOrder = 11;
    scene.add(losLine);
    losLineRef.current = losLine;

    // 11. TRAJECTORY HISTORY 3D LINE
    const trailGeo = new THREE.BufferGeometry();
    const trailMat = new THREE.LineBasicMaterial({
      color: 0xf43f5e,
      linewidth: 2,
      depthTest: true,
      transparent: true,
      opacity: 0.8,
    });
    const trailLine = new THREE.Line(trailGeo, trailMat);
    trailLine.renderOrder = 8;
    scene.add(trailLine);
    trailLineRef.current = trailLine;

    // 12. FOV FRUSTUM PYRAMID WIREFRAME (depthTest=true to prevent crossing through Earth)
    const frustumGeo = new THREE.BufferGeometry();
    const frustumMat = new THREE.LineBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.85,
      depthTest: true, // Prevents crossing through globe
    });
    const frustumLines = new THREE.LineSegments(frustumGeo, frustumMat);
    frustumLines.renderOrder = 10;
    scene.add(frustumLines);
    frustumLinesRef.current = frustumLines;

    const initialNadirDir = initialSatPos.clone().negate().normalize();
    boresightDirRef.current = initialNadirDir;
    slewProgressRef.current = autoLOSRef.current ? 1.0 : 0.0;
    const initialLosDir = new THREE.Vector3().subVectors(tgtPos, initialSatPos).normalize();
    const initialAngDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(initialNadirDir.dot(initialLosDir), -1, 1)));
    updateFrustum(initialSatPos, initialNadirDir, tgtPos, target?.is_in_fov ?? true, autoLOSRef.current, autoLOSRef.current ? 0 : initialAngDeg);

    // 12b. BACKUP SATELLITE (purple sphere, phase-offset along active orbit)
    const backupPhaseRad = THREE.MathUtils.degToRad(backupPhaseOffsetDeg);
    const initialBackupPos = computeOrbitPoint(
      activeOrbitRef.current.radius,
      activeOrbitRef.current.incDeg,
      activeOrbitRef.current.raanDeg,
      activeOrbitRef.current.anomaly + backupPhaseRad
    );
    const backupGroup = new THREE.Group();
    const bkBodyGeo = new THREE.SphereGeometry(5, 20, 20);
    const bkBodyMat = new THREE.MeshStandardMaterial({
      color: 0x818cf8, roughness: 0.3, metalness: 0.8,
    });
    backupGroup.add(new THREE.Mesh(bkBodyGeo, bkBodyMat));
    const bkPanelGeo = new THREE.BoxGeometry(14, 0.35, 3.5);
    const bkPanelMat = new THREE.MeshStandardMaterial({ color: 0x1e1b4b, metalness: 0.9, roughness: 0.3 });
    backupGroup.add(new THREE.Mesh(bkPanelGeo, bkPanelMat));
    backupGroup.position.copy(initialBackupPos);
    backupGroup.lookAt(tgtPos);
    scene.add(backupGroup);
    backupSatMeshRef.current = backupGroup;

    // 12c. BACKUP LOS LINE (dashed purple, becomes solid amber during TRANSFERRING)
    const bkLosGeo = new THREE.BufferGeometry();
    bkLosGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [initialBackupPos.x, initialBackupPos.y, initialBackupPos.z, tgtPos.x, tgtPos.y, tgtPos.z],
        3
      )
    );
    const bkLosMat = new THREE.LineDashedMaterial({
      color: 0x818cf8,
      dashSize: 3,
      gapSize: 4,
      depthTest: true,
      transparent: true,
      opacity: 0.55,
    });
    const bkLosLine = new THREE.Line(bkLosGeo, bkLosMat);
    bkLosLine.computeLineDistances();
    bkLosLine.renderOrder = 10;
    scene.add(bkLosLine);
    backupLosLineRef.current = bkLosLine;

    // Mouse drag listeners for interactive orbit camera around globe
    const onMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      previousMousePositionRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = e.clientX - previousMousePositionRef.current.x;
      const deltaY = e.clientY - previousMousePositionRef.current.y;

      orbitStateRef.current.theta -= deltaX * 0.005;
      orbitStateRef.current.phi = Math.max(
        0.05,
        Math.min(Math.PI / 2 - 0.05, orbitStateRef.current.phi + deltaY * 0.005)
      );

      previousMousePositionRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
    };

    const onWheel = (e: WheelEvent) => {
      orbitStateRef.current.radius = Math.max(
        140,
        Math.min(800, orbitStateRef.current.radius + e.deltaY * 0.4)
      );
      e.preventDefault();
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    container.addEventListener('wheel', onWheel, { passive: false });

    // Render loop
    let animId: number;
    let frameCount = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      frameCount++;

      // 0. Advance Earth's diurnal rotation around its polar axis (Y)
      if (globeMeshRef.current && earthSpinRef.current.enabled) {
        globeMeshRef.current.rotation.y += earthSpinRef.current.speed;
      }

      // 1. Advance peer constellation satellites along their LEO orbits
      peerNodes.forEach((node) => {
        node.anomaly += node.speed;
        const pos = computeOrbitPoint(node.radius, node.incDeg, node.raanDeg, node.anomaly);
        node.mesh.position.copy(pos);
      });

      // 2. Advance active primary satellite along its user-selected orbit
      if (activeOrbitRef.current.autoRevolve) {
        activeOrbitRef.current.anomaly += activeOrbitRef.current.speed;
      }

      // Compute current position of satellite
      const currentSatPos = computeOrbitPoint(
        activeOrbitRef.current.radius,
        activeOrbitRef.current.incDeg,
        activeOrbitRef.current.raanDeg,
        activeOrbitRef.current.anomaly
      );

      // 2b. Advance backup satellite (same orbit, constant phase offset)
      const backupPhaseRad = THREE.MathUtils.degToRad(backupPhaseOffsetDeg);
      const backupSatPos = computeOrbitPoint(
        activeOrbitRef.current.radius,
        activeOrbitRef.current.incDeg,
        activeOrbitRef.current.raanDeg,
        activeOrbitRef.current.anomaly + backupPhaseRad
      );
      if (backupSatMeshRef.current) {
        backupSatMeshRef.current.position.copy(backupSatPos);
        backupSatMeshRef.current.lookAt(tgtPosRef.current);
      }

      // 3. Advance or maintain beacon ground position (revolving around Earth center on the ground at R=100)
      if (beaconMotionRef.current.isRevolving) {
        beaconMotionRef.current.anomaly += beaconMotionRef.current.speed;
      }

      const currentBeaconGroundPos = computeOrbitPoint(
        globeRadius,
        beaconMotionRef.current.incDeg,
        beaconMotionRef.current.raanDeg,
        beaconMotionRef.current.anomaly
      );
      tgtPosRef.current.copy(currentBeaconGroundPos);

      // Position and orient the beacon group strictly on top of the globe surface (with platform motion / jitter)
      if (targetMeshRef.current) {
        const beaconNormal = currentBeaconGroundPos.clone().normalize();
        let up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(beaconNormal.dot(up)) > 0.9) up = new THREE.Vector3(1, 0, 0);
        const tangentX = new THREE.Vector3().crossVectors(beaconNormal, up).normalize();
        const tangentY = new THREE.Vector3().crossVectors(tangentX, beaconNormal).normalize();

        const dist = disturbancePropRef.current;
        const jx = dist?.jitter_offset_x_px ?? 0;
        const jy = dist?.jitter_offset_y_px ?? 0;
        const px = dist?.platform_offset_x_px ?? 0;
        const py = dist?.platform_offset_y_px ?? 0;

        const dispScale = 0.08;
        const surfacePos = beaconNormal.clone().multiplyScalar(globeRadius + 0.05)
          .addScaledVector(tangentX, (jx + px) * dispScale)
          .addScaledVector(tangentY, (jy + py) * dispScale);

        targetMeshRef.current.position.copy(surfacePos);
        targetMeshRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), beaconNormal);
        tgtPosRef.current.copy(surfacePos);
      }

      // Check whether line of sight to ground station is blocked by Earth
      const { isOccluded, hitPoint } = checkEarthOcclusion(
        currentSatPos,
        tgtPosRef.current,
        globeRadius
      );

      // Broadcast live satellite orbital position and beacon state to FPA Camera Viewport
      satellitePovSync.update({
        satPos: currentSatPos,
        tgtPos: tgtPosRef.current,
        earthRotationY: globeMeshRef.current?.rotation.y ?? 0,
        isOccluded,
        orbitRadius: activeOrbitRef.current.radius,
        incDeg: activeOrbitRef.current.incDeg,
        raanDeg: activeOrbitRef.current.raanDeg,
        anomaly: activeOrbitRef.current.anomaly,
      });

      // 1. Nominal Nadir pointing direction (Earth center 0, 0, 0), modified by manual gimbal pan/tilt
      let nadirDir = currentSatPos.clone().negate().normalize();
      const currentCam = cameraPropRef.current;
      const panDeg = currentCam?.pan_deg ?? 0;
      const tiltDeg = currentCam?.tilt_deg ?? 0;
      const panRad = THREE.MathUtils.degToRad(panDeg);
      const tiltRad = THREE.MathUtils.degToRad(tiltDeg);

      if (Math.abs(panRad) > 0.0001 || Math.abs(tiltRad) > 0.0001) {
        let up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(nadirDir.dot(up)) > 0.92) up = new THREE.Vector3(1, 0, 0);
        let right = new THREE.Vector3().crossVectors(nadirDir, up).normalize();
        let realUp = new THREE.Vector3().crossVectors(right, nadirDir).normalize();
        nadirDir.applyAxisAngle(realUp, -panRad);
        right.crossVectors(nadirDir, realUp).normalize();
        nadirDir.applyAxisAngle(right, tiltRad);
      }

      // 2. Line of sight (LOS) ray direction from satellite directly to beacon
      const losDir = new THREE.Vector3().subVectors(tgtPosRef.current, currentSatPos).normalize();

      // 3. Update slew progress alpha in [0, 1]
      // 0.025 per frame at 60 FPS -> 40 frames (~0.67s) smooth gimbal slew
      if (autoLOSRef.current) {
        slewProgressRef.current = Math.min(1.0, slewProgressRef.current + 0.025);
      } else {
        slewProgressRef.current = Math.max(0.0, slewProgressRef.current - 0.025);
      }
      const p = slewProgressRef.current;
      // Smoothstep easing for natural, gradual acceleration and gentle deceleration
      const t = p * p * (3 - 2 * p);

      // 4. Closed-form Spherical Linear Interpolation (SLERP) between Nadir and LOS
      const dot = THREE.MathUtils.clamp(nadirDir.dot(losDir), -1, 1);
      const omega = Math.acos(dot);
      let currBoresight: THREE.Vector3;
      if (p <= 0.0001) {
        currBoresight = nadirDir.clone();
      } else if (p >= 0.9999 || omega < 0.001) {
        currBoresight = losDir.clone();
      } else {
        const sinOmega = Math.sin(omega);
        currBoresight = new THREE.Vector3()
          .addScaledVector(nadirDir, Math.sin((1 - t) * omega) / sinOmega)
          .addScaledVector(losDir, Math.sin(t * omega) / sinOmega)
          .normalize();
      }

      // Apply mechanical vibration to current boresight
      const dist = disturbancePropRef.current;
      const jx = dist?.jitter_offset_x_px ?? 0;
      const jy = dist?.jitter_offset_y_px ?? 0;
      if (Math.abs(jx) > 0.001 || Math.abs(jy) > 0.001) {
        let bUp = new THREE.Vector3(0, 1, 0);
        if (Math.abs(currBoresight.dot(bUp)) > 0.9) bUp = new THREE.Vector3(1, 0, 0);
        const bRight = new THREE.Vector3().crossVectors(currBoresight, bUp).normalize();
        const bRealUp = new THREE.Vector3().crossVectors(bRight, currBoresight).normalize();
        const vibPanRad = THREE.MathUtils.degToRad((jx * 4.0) / 640);
        const vibTiltRad = THREE.MathUtils.degToRad((jy * 3.0) / 480);
        currBoresight.applyAxisAngle(bRealUp, -vibPanRad);
        currBoresight.applyAxisAngle(bRight, vibTiltRad);
      }
      boresightDirRef.current = currBoresight;

      // Angular error between current optical boresight and LOS ray (in degrees)
      const dotToLos = THREE.MathUtils.clamp(currBoresight.dot(losDir), -1, 1);
      const angRad = Math.acos(dotToLos);
      const angDeg = THREE.MathUtils.radToDeg(angRad);

      // Re-orient satellite mesh and optical turret smoothly along with current boresight
      if (cameraMeshRef.current) {
        cameraMeshRef.current.position.copy(currentSatPos);
        const lookTarget = currentSatPos.clone().add(currBoresight);
        cameraMeshRef.current.lookAt(lookTarget);
      }

      // Update Line of Sight (LOS) ray (stops at Earth limb/horizon if occluded)
      if (losLineRef.current) {
        const positions = losLineRef.current.geometry.attributes.position as THREE.BufferAttribute;
        if (positions) {
          positions.setXYZ(0, currentSatPos.x, currentSatPos.y, currentSatPos.z);
          if (isOccluded && hitPoint) {
            // Terminate LOS ray at the Earth horizon hit point - DO NOT penetrate globe!
            positions.setXYZ(1, hitPoint.x, hitPoint.y, hitPoint.z);
          } else {
            positions.setXYZ(1, tgtPosRef.current.x, tgtPosRef.current.y, tgtPosRef.current.z);
          }
          positions.needsUpdate = true;
          losLineRef.current.computeLineDistances();
        }

        const losMat = losLineRef.current.material as THREE.LineDashedMaterial;
        if (losMat) {
          if (!autoLOSRef.current) {
            losMat.color.setHex(0x64748b); // Slate dashed line: Auto LOS OFF / Standby
            losMat.opacity = 0.35;
          } else if (isOccluded) {
            losMat.color.setHex(0xf43f5e); // Red dashed line: BLOCKED BY EARTH
            losMat.opacity = 0.55;
          } else if (angDeg > 1.5) {
            losMat.color.setHex(0xf59e0b); // Amber dashed line: SLEWING / ACQUIRING LOS
            losMat.opacity = 0.85;
          } else {
            losMat.color.setHex(0x38bdf8); // Cyan dashed line: CLEAR OPTICAL LINK
            losMat.opacity = 0.95;
          }
        }
      }

      // Update backup LOS line (dashed purple, solid amber during TRANSFERRING)
      if (backupLosLineRef.current) {
        const bkPositions = backupLosLineRef.current.geometry.attributes.position as THREE.BufferAttribute;
        const { isOccluded: bkOccluded, hitPoint: bkHit } = checkEarthOcclusion(backupSatPos, tgtPosRef.current, globeRadius);
        if (bkPositions) {
          bkPositions.setXYZ(0, backupSatPos.x, backupSatPos.y, backupSatPos.z);
          if (bkOccluded && bkHit) {
            bkPositions.setXYZ(1, bkHit.x, bkHit.y, bkHit.z);
          } else {
            bkPositions.setXYZ(1, tgtPosRef.current.x, tgtPosRef.current.y, tgtPosRef.current.z);
          }
          bkPositions.needsUpdate = true;
          backupLosLineRef.current.computeLineDistances();
        }
        const bkMat = backupLosLineRef.current.material as THREE.LineDashedMaterial;
        const ho = handoverRef.current;
        if (bkMat) {
          if (ho && ho.state === 'TRANSFERRING') {
            bkMat.color.setHex(0xf59e0b); // amber — transfer in progress
            bkMat.opacity = 0.85;
            bkMat.dashSize = 8;
            bkMat.gapSize = 0;
          } else if (bkOccluded) {
            bkMat.color.setHex(0xef4444);
            bkMat.opacity = 0.35;
          } else {
            bkMat.color.setHex(0x818cf8); // purple — standby
            bkMat.opacity = 0.55;
            bkMat.dashSize = 3;
            bkMat.gapSize = 4;
          }
        }
      }

      // Update FOV Frustum cone pointing (clamped to Earth surface so it never penetrates the globe)
      updateFrustum(
        currentSatPos,
        currBoresight,
        tgtPosRef.current,
        target?.is_in_fov ?? !isOccluded,
        autoLOSRef.current,
        angDeg
      );

      // Frustum color state: GREEN when beacon is locked in satellite's FOV, RED when sight is lost
      const isLockedInFov = Boolean(!isOccluded && angDeg <= 2.0);
      const isLostFromFov = Boolean(isOccluded || angDeg > 2.0);

      // Alarm immediately stops when locked in FOV (turns green), and starts beeping the moment sight is lost (turns red)
      if (isLockedInFov) {
        alarmAudio.stopLostAlarm();
      } else if (isLostFromFov) {
        alarmAudio.startLostAlarm();
      }

      // Synchronize beacon cube color: GREEN when locked in FOV, RED when lost from FOV
      if (targetCubeMeshRef.current) {
        const mat = targetCubeMeshRef.current.material as THREE.MeshBasicMaterial;
        if (mat) {
          mat.color.setHex(isLockedInFov ? 0x10b981 : 0xff3366);
        }
      }

      satellitePovSync.update({
        satPos: currentSatPos,
        tgtPos: tgtPosRef.current,
        earthRotationY: globeMeshRef.current?.rotation.y ?? 0,
        isOccluded,
        orbitRadius: activeOrbitRef.current.radius,
        incDeg: activeOrbitRef.current.incDeg,
        raanDeg: activeOrbitRef.current.raanDeg,
        anomaly: activeOrbitRef.current.anomaly,
        isLockedInFov,
        isLostFromFov,
      });

      // Update telemetry state occasionally
      if (frameCount % 6 === 0) {
        const dist = currentSatPos.distanceTo(tgtPosRef.current);
        setCurrentSlantRange(dist);
        setIsOccludedByEarth(isOccluded);
        setSlewAngularError(angDeg);
      }

      // Spherical camera view around scene origin (0, 0, 0)
      const { theta, phi, radius } = orbitStateRef.current;
      perspCamera.position.x = radius * Math.sin(theta) * Math.cos(phi);
      perspCamera.position.y = radius * Math.sin(phi);
      perspCamera.position.z = radius * Math.cos(theta) * Math.cos(phi);
      perspCamera.lookAt(0, 0, 0);

      renderer.render(scene, perspCamera);
    };
    animate();


    // Resize handler
    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 640;
      const h = container.clientHeight || 480;
      perspCamera.aspect = w / h;
      perspCamera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
  }, []);

  // Synchronize target telemetry position if available
  useEffect(() => {
    if (!target) return;
    if (Math.abs(target.world_x) > 300 || Math.abs(target.world_y) > 300) {
      const nx = (target.world_x - worldWidth / 2) / (worldWidth / 2);
      const ny = (target.world_y - worldHeight / 2) / (worldHeight / 2);
      const lon = nx * 0.4 + 0.38;
      const lat = ny * 0.4 + 0.82;
      tgtPosRef.current.set(
        globeRadius * Math.sin(lon) * Math.cos(lat),
        globeRadius * Math.sin(lat),
        globeRadius * Math.cos(lon) * Math.cos(lat)
      );
    } else if (target.world_x !== 0 || target.world_y !== 0 || target.world_z !== 0) {
      tgtPosRef.current.set(target.world_x, target.world_y, target.world_z).normalize().multiplyScalar(globeRadius);
    }

    if (targetMeshRef.current) {
      const normal = tgtPosRef.current.clone().normalize();
      targetMeshRef.current.position.copy(normal.clone().multiplyScalar(globeRadius + 0.05));
      targetMeshRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    }

    if (targetCubeMeshRef.current) {
      const mat = targetCubeMeshRef.current.material as THREE.MeshBasicMaterial;
      if (mat) {
        mat.color.setHex(target.is_in_fov ? 0x10b981 : 0xff3366);
      }
    }
  }, [target, worldWidth, worldHeight]);

  const resetCameraView = () => {
    orbitStateRef.current = { theta: 0.75, phi: 0.45, radius: 340.0 };
  };

  // Poll handover metrics from backend every 2 seconds to keep the HandoverPanel fresh
  useEffect(() => {
    const pollHandover = async () => {
      try {
        const resp = await fetch('/api/orbital/handover/metrics');
        if (resp.ok) {
          const data = await resp.json();
          if (!data.error) {
            // Build a HandoverData compatible object from metrics + last orbital telemetry
            const orbResp = await fetch('/api/simulation/telemetry');
            if (orbResp.ok) {
              const tel = await orbResp.json();
              const ho = tel?.handover ?? tel?.orbital?.handover ?? null;
              if (ho) {
                handoverRef.current = ho;
                setHandoverData(ho);
              }
            }
          }
        }
      } catch (_) { /* silent */ }
    };

    const id = setInterval(pollHandover, 2000);
    pollHandover(); // immediate first poll
    return () => clearInterval(id);
  }, []);

  const activePreset = LEO_PRESETS.find((p) => p.id === selectedPresetId);

  return (
    <div className="relative w-full h-full flex flex-col bg-[#05070e] border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
      {/* 3D Viewport Header */}
      <div className="flex flex-wrap items-center justify-between px-3 py-2 bg-slate-900/95 border-b border-slate-800 text-xs font-mono gap-2 z-10">
        <div className="flex items-center gap-2 text-cyan-400">
          <Box className="w-4 h-4 text-cyan-400 animate-pulse" />
          <span className="font-semibold tracking-wider">3D LEO KINEMATICS TESTBENCH</span>
        </div>

        {/* Orbit Change Controls */}
        <div className="flex items-center gap-2">
          {/* Quick Preset Selector Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded border border-slate-800 text-[11px]">
            <Compass className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-400 hidden sm:inline">Orbit:</span>
            <select
              value={selectedPresetId}
              onChange={(e) => handlePresetSelect(e.target.value)}
              className="bg-transparent text-cyan-300 font-semibold focus:outline-none cursor-pointer pr-1"
            >
              {LEO_PRESETS.map((p) => (
                <option key={p.id} value={p.id} className="bg-slate-900 text-slate-200">
                  {p.name}
                </option>
              ))}
              <option value="custom" className="bg-slate-900 text-amber-400">
                [Custom Parameters]
              </option>
            </select>
          </div>

          {/* Toggle Interactive Tuning Drawer */}
          <button
            onClick={() => setShowOrbitTuner(!showOrbitTuner)}
            className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1.5 transition ${
              showOrbitTuner
                ? 'bg-cyan-950 text-cyan-300 border-cyan-700 shadow-sm shadow-cyan-900/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title="Open Interactive Orbit Parameter Sliders"
          >
            <Sliders className="w-3 h-3 text-cyan-400" />
            <span>Tune Orbit</span>
          </button>

          {/* Play / Pause Auto Revolve */}
          <button
            onClick={() => setAutoRevolve(!autoRevolve)}
            className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 transition ${
              autoRevolve
                ? 'bg-slate-800 hover:bg-slate-700 text-emerald-400 border-slate-700'
                : 'bg-amber-950/80 hover:bg-amber-900 text-amber-300 border-amber-800'
            }`}
            title={autoRevolve ? 'Pause Satellite Orbit' : 'Resume Satellite Orbit'}
          >
            {autoRevolve ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span className="hidden sm:inline">{autoRevolve ? 'Orbiting' : 'Paused'}</span>
          </button>

          {/* Beacon Motion Toggle (Revolve vs Static on Ground) */}
          <button
            onClick={() => setBeaconRevolving(!beaconRevolving)}
            className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 transition ${
              beaconRevolving
                ? 'bg-rose-950/80 hover:bg-rose-900 text-rose-300 border-rose-800'
                : 'bg-amber-950/80 hover:bg-amber-900 text-amber-300 border-amber-800'
            }`}
            title={beaconRevolving ? 'Put Beacon Static on Ground' : 'Revolve Beacon Around Center of Earth on Ground'}
          >
            <Radio className={`w-3 h-3 ${beaconRevolving ? 'text-rose-400 animate-pulse' : 'text-amber-400'}`} />
            <span className="hidden sm:inline">{beaconRevolving ? 'Beacon: Revolving' : 'Beacon: Static'}</span>
          </button>

          {/* Earth Diurnal Spin Toggle */}
          <button
            onClick={() => setEarthSpinEnabled(!earthSpinEnabled)}
            className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 transition ${
              earthSpinEnabled
                ? 'bg-slate-800 hover:bg-slate-700 text-sky-300 border-slate-700'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-500 border-slate-800'
            }`}
            title={earthSpinEnabled ? 'Pause Earth Diurnal Spin' : 'Resume Earth Diurnal Spin'}
          >
            <Globe className={`w-3 h-3 ${earthSpinEnabled ? 'text-sky-400' : 'text-slate-600'}`} />
            <span className="hidden sm:inline">Earth {earthSpinEnabled ? 'Spin' : 'Static'}</span>
          </button>

          {/* Auto LOS Alignment Toggle */}
          <button
            onClick={handleToggleAutoLOS}
            className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 transition ${
              autoLOS
                ? 'bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border-emerald-700 animate-pulse'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-700'
            }`}
            title={autoLOS ? 'Auto LOS is ON (Calibrating FOV to Beacon). Click to turn OFF (Hold Nadir)' : 'Auto LOS is OFF (Nadir / Gimbal Hold). Click to turn ON (Track Beacon)'}
          >
            <Locate className={`w-3 h-3 ${autoLOS ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span className="hidden sm:inline">{autoLOS ? 'Auto LOS: ON' : 'Auto LOS: OFF'}</span>
          </button>

          {/* Reset Camera View */}
          <button
            onClick={resetCameraView}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-slate-700 flex items-center gap-1 text-[11px] transition"
            title="Reset 3D Orbit Camera"
          >
            <RefreshCw className="w-3 h-3" /> <span className="hidden sm:inline">Reset View</span>
          </button>
        </div>
      </div>

      {/* WebGL Canvas Container */}
      <div ref={mountRef} className="relative flex-1 w-full h-full min-h-[380px] cursor-grab active:cursor-grabbing" />

      {/* Handover Status Panel — absolute overlay, bottom-right */}
      <div style={{
        position: 'absolute',
        bottom: 8,
        right: 8,
        zIndex: 25,
        pointerEvents: 'none',
      }}>
        <HandoverPanel handover={handoverData} backupAcquireSteps={3} />
      </div>

      {/* Interactive Orbit Tuner Drawer / Popover */}
      {showOrbitTuner && (
        <div className="absolute top-12 left-3 w-80 bg-slate-950/95 backdrop-blur-md border border-cyan-800/80 rounded-lg p-3 font-mono text-xs text-slate-300 shadow-2xl z-20 space-y-3 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs">
              <Orbit className="w-4 h-4 text-cyan-400" />
              <span>SATELLITE ORBIT TUNER</span>
            </div>
            <button
              onClick={() => setShowOrbitTuner(false)}
              className="text-slate-400 hover:text-white p-0.5 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Quick Preset Selector Buttons */}
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1.5">Quick Presets:</div>
            <div className="grid grid-cols-2 gap-1.5">
              {LEO_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handlePresetSelect(p.id)}
                  className={`px-2 py-1 text-[10px] rounded text-left border truncate transition ${
                    selectedPresetId === p.id
                      ? 'bg-cyan-950 text-cyan-300 border-cyan-600 font-semibold'
                      : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border-slate-800'
                  }`}
                  title={p.description}
                >
                  {p.shortName}
                </button>
              ))}
            </div>
          </div>

          {/* Sliders for Custom Orbital Elements */}
          <div className="space-y-2 border-t border-slate-800/80 pt-2 text-[11px]">
            {/* Radius / Altitude */}
            <div>
              <div className="flex justify-between text-slate-400 mb-0.5">
                <span>Altitude ($R$):</span>
                <span className="text-cyan-300 font-bold">
                  {orbitRadius} u (+{(orbitRadius - globeRadius).toFixed(0)} u / ~{(orbitRadius - globeRadius) * 11} km)
                </span>
              </div>
              <input
                type="range"
                min="115"
                max="175"
                step="1"
                value={orbitRadius}
                onChange={(e) => handleCustomParamChange(Number(e.target.value), orbitInc, orbitRaan)}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* Inclination */}
            <div>
              <div className="flex justify-between text-slate-400 mb-0.5">
                <span>Inclination ($i$):</span>
                <span className="text-cyan-300 font-bold">{orbitInc.toFixed(1)}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="115"
                step="0.5"
                value={orbitInc}
                onChange={(e) => handleCustomParamChange(orbitRadius, Number(e.target.value), orbitRaan)}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* RAAN */}
            <div>
              <div className="flex justify-between text-slate-400 mb-0.5">
                <span>RAAN ($\Omega$):</span>
                <span className="text-cyan-300 font-bold">{orbitRaan.toFixed(1)}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={orbitRaan}
                onChange={(e) => handleCustomParamChange(orbitRadius, orbitInc, Number(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* True Anomaly / Orbit Scrubber */}
            <div>
              <div className="flex justify-between text-slate-400 mb-0.5">
                <span>Orbital Phase ($\nu$):</span>
                <span className="text-cyan-300 font-bold">{orbitAnomalyDeg.toFixed(0)}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={orbitAnomalyDeg}
                onChange={(e) => {
                  const deg = Number(e.target.value);
                  setOrbitAnomalyDeg(deg);
                  activeOrbitRef.current.anomaly = THREE.MathUtils.degToRad(deg);
                }}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>
          </div>

          {/* Speed & Motion Controls */}
          <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 text-[10px]">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setAutoRevolve(!autoRevolve)}
                className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-slate-700 flex items-center gap-1"
              >
                {autoRevolve ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                <span>{autoRevolve ? 'Pause' : 'Revolve'}</span>
              </button>
              <select
                value={revolveSpeed}
                onChange={(e) => setRevolveSpeed(Number(e.target.value))}
                className="bg-slate-900 border border-slate-800 text-slate-300 px-1 py-0.5 rounded text-[10px]"
              >
                <option value={0.0015}>0.5x Speed</option>
                <option value={0.003}>1.0x Speed</option>
                <option value={0.006}>2.0x Speed</option>
                <option value={0.012}>4.0x Speed</option>
              </select>
            </div>
            <button
              onClick={() => handlePresetSelect('leo-550-p1')}
              className="text-slate-400 hover:text-cyan-300 flex items-center gap-1"
              title="Reset to LEO-550 Default Orbit"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              <span>Reset</span>
            </button>
          </div>

          {/* Ground Beacon Dynamics Controls */}
          <div className="border-t border-slate-800/80 pt-2 text-[11px] space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-rose-400 font-bold text-[10px] uppercase tracking-wider">
                <Radio className="w-3.5 h-3.5 text-rose-400" />
                <span>Ground Beacon Dynamics</span>
              </div>
              <button
                onClick={() => setBeaconRevolving(!beaconRevolving)}
                className={`px-2 py-0.5 rounded text-[10px] border flex items-center gap-1 transition ${
                  beaconRevolving
                    ? 'bg-rose-950 text-rose-300 border-rose-700 font-semibold'
                    : 'bg-amber-950 text-amber-300 border-amber-700 font-semibold'
                }`}
              >
                {beaconRevolving ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                <span>{beaconRevolving ? 'Revolving' : 'Static (Locked)'}</span>
              </button>
            </div>

            {/* Beacon Ground Phase / Position Scrubber */}
            <div>
              <div className="flex justify-between text-slate-400 mb-0.5 text-[10px]">
                <span>Ground Position Phase ($\nu$):</span>
                <span className="text-rose-300 font-bold">{beaconAnomalyDeg.toFixed(0)}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={beaconAnomalyDeg}
                onChange={(e) => {
                  const deg = Number(e.target.value);
                  setBeaconAnomalyDeg(deg);
                  beaconMotionRef.current.anomaly = THREE.MathUtils.degToRad(deg);
                }}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
              />
            </div>

            {/* Beacon Speed & Track Inclination */}
            <div className="flex items-center justify-between text-slate-400 text-[10px]">
              <span>Ground Speed:</span>
              <div className="flex items-center gap-1">
                {[
                  { label: '0.5×', speed: 0.0009 },
                  { label: '1.0×', speed: 0.0018 },
                  { label: '2.0×', speed: 0.0036 },
                ].map((rate) => (
                  <button
                    key={rate.label}
                    onClick={() => {
                      setBeaconSpeed(rate.speed);
                      setBeaconRevolving(true);
                    }}
                    className={`px-1.5 py-0.5 rounded border text-[9px] transition ${
                      beaconRevolving && Math.abs(beaconSpeed - rate.speed) < 0.0001
                        ? 'bg-rose-900 text-rose-200 border-rose-600'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {rate.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Track Inclination Slider */}
            <div>
              <div className="flex justify-between text-slate-400 mb-0.5 text-[10px]">
                <span>Ground Track Inclination ($i$):</span>
                <span className="text-rose-300 font-bold">{beaconInc.toFixed(1)}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="90"
                step="1"
                value={beaconInc}
                onChange={(e) => {
                  const inc = Number(e.target.value);
                  setBeaconInc(inc);
                  updateBeaconTrackGeometry(inc, beaconRaan);
                }}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
              />
            </div>
          </div>
          <div className="border-t border-slate-800/80 pt-2 text-[11px] space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sky-400 font-bold text-[10px] uppercase tracking-wider">
                <Globe className="w-3.5 h-3.5 text-sky-400" />
                <span>Earth Diurnal Spin</span>
              </div>
              <button
                onClick={() => setEarthSpinEnabled(!earthSpinEnabled)}
                className={`px-1.5 py-0.5 rounded text-[10px] border ${
                  earthSpinEnabled
                    ? 'bg-sky-950 text-sky-300 border-sky-700 font-semibold'
                    : 'bg-slate-900 text-slate-400 border-slate-800'
                }`}
              >
                {earthSpinEnabled ? 'Active' : 'Paused'}
              </button>
            </div>
            <div className="flex items-center justify-between text-slate-400 text-[10px]">
              <span>Spin Rate:</span>
              <div className="flex items-center gap-1">
                {[
                  { label: '0.5×', speed: 0.0002 },
                  { label: '1.0×', speed: 0.0004 },
                  { label: '2.5×', speed: 0.001 },
                ].map((rate) => (
                  <button
                    key={rate.label}
                    onClick={() => {
                      setEarthSpinSpeed(rate.speed);
                      setEarthSpinEnabled(true);
                    }}
                    className={`px-1.5 py-0.5 rounded border text-[9px] transition ${
                      earthSpinEnabled && Math.abs(earthSpinSpeed - rate.speed) < 0.0001
                        ? 'bg-sky-900 text-sky-200 border-sky-600'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {rate.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Overlay HUD Telemetry in 3D */}
      <div className="absolute bottom-3 left-3 bg-slate-950/85 backdrop-blur border border-slate-800 p-2.5 rounded font-mono text-[10px] space-y-1 text-slate-300 pointer-events-none z-10">
        <div className="text-cyan-400 font-bold border-b border-slate-800 pb-1">LEO CONSTELLATION TRACKER</div>
        <div>Central Body: <span className="text-white">Earth (R=100.0 u)</span></div>
        <div>
          Active Satellite: <span className="text-cyan-300 font-bold">{activePreset ? activePreset.shortName : 'Custom Orbit'}</span>
        </div>
        <div>
          Parameters: <span className="text-sky-300 font-bold">R={orbitRadius} u (+{orbitRadius - 100}u) | Inc: {orbitInc}°</span>
        </div>
        <div>Target Entity: <span className="text-emerald-400 font-bold">Ground Station (R=100.0 u)</span></div>
        <div>
          Beacon Motion:{' '}
          <span className={beaconRevolving ? 'text-rose-300 font-bold' : 'text-amber-400 font-bold'}>
            {beaconRevolving ? `REVOLVING ON GROUND (~${(beaconSpeed * 60 * 180 / Math.PI).toFixed(1)}°/s)` : 'STATIC (LOCKED ON GROUND)'}
          </span>
        </div>
        <div>
          Earth Spin:{' '}
          <span className={earthSpinEnabled ? 'text-sky-300 font-bold' : 'text-slate-500 font-bold'}>
            {earthSpinEnabled ? `ROTATING (~${(earthSpinSpeed * 60 * 180 / Math.PI).toFixed(1)}°/s)` : 'INERTIAL LOCKED'}
          </span>
        </div>
        <div>
          Slant Range: <span className="text-cyan-300 font-bold">{currentSlantRange.toFixed(1)} u</span>
        </div>
        <div>
          PAT State:{' '}
          {isOccludedByEarth ? (
            <span className="text-rose-400 font-bold animate-pulse">OCCLUDED BY EARTH LIMB (NO LOS)</span>
          ) : !autoLOS ? (
            <span className="text-slate-400 font-bold">AUTO LOS OFF (HOLDING NADIR ATTITUDE)</span>
          ) : slewAngularError > 1.5 ? (
            <span className="text-amber-400 font-bold animate-pulse">
              SLEWING TO BEACON LOS ({slewAngularError.toFixed(1)}° OFF-AXIS)
            </span>
          ) : autoRevolve ? (
            <span className="text-emerald-400 font-bold">ACTIVE PAT TRACKING (CLEAR LOS)</span>
          ) : (
            <span className="text-emerald-400 font-bold">LOCKED ON BEACON (CLEAR LOS)</span>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="absolute top-14 right-3 bg-slate-950/85 backdrop-blur border border-slate-800 px-3 py-2 rounded font-mono text-[10px] text-slate-400 pointer-events-none space-y-1.5 shadow-xl hidden sm:block z-10">
        <div className="text-[11px] font-bold text-slate-200 border-b border-slate-800 pb-1">LEO CONSTELLATION</div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-cyan-400 inline-block border-dashed"></span>
          <span className="text-cyan-300 font-medium">Active Optical LOS Beam</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-rose-500 inline-block border-dashed"></span>
          <span className="text-rose-400 font-medium">Earth Limb Blocked LOS</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-sky-400 inline-block"></span>
          <span>Selected Satellite Orbit ({orbitRadius}u)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-blue-500 inline-block border-dashed"></span>
          <span>Walker Constellation Shells</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-indigo-400 inline-block border-dashed"></span>
          <span>Polar Sun-Synchronous SSO (97.8°)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-rose-500 inline-block border-dashed"></span>
          <span className="text-rose-300">Beacon Ground Track (100u)</span>
        </div>
      </div>
    </div>
  );
};


