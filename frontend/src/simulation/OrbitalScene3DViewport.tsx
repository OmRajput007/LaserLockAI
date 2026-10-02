import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitalTelemetry } from '../types';
import { Globe, RefreshCw, Crosshair, Eye, Compass, ShieldAlert, CheckCircle, AlertTriangle, Satellite, Radio } from 'lucide-react';
import HandoverPanel from './HandoverPanel';
import { satellitePovSync } from './satellitePovSync';
import { getRealisticEarthTextures } from './earthTexture';
import { createRealSatelliteModel } from './satelliteModel';

interface Props {
  orbitalTelemetry: OrbitalTelemetry | null;
  cameraPreset?: string;
  beaconPreset?: string;
}

export const OrbitalScene3DViewport: React.FC<Props> = ({
  orbitalTelemetry,
  cameraPreset = 'LEO-550',
  beaconPreset = 'LEO-550',
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Three.js Core
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // Dynamic 3D Objects
  const earthGlobeRef = useRef<THREE.Mesh | null>(null);
  const atmosphereRef = useRef<THREE.Mesh | null>(null);
  const cameraMarkerRef = useRef<THREE.Group | null>(null);
  const backupMarkerRef = useRef<THREE.Group | null>(null);
  const beaconMarkerRef = useRef<THREE.Group | null>(null);
  const losLineRef = useRef<THREE.Line | null>(null);
  const backupLosLineRef = useRef<THREE.Line | null>(null);
  const frustumLinesRef = useRef<THREE.LineSegments | null>(null);
  const beaconTrailRef = useRef<THREE.Line | null>(null);
  const cameraTrailRef = useRef<THREE.Line | null>(null);

  // Dynamic orbit rings
  const cameraOrbitRingRef = useRef<THREE.Line | null>(null);
  const beaconOrbitRingRef = useRef<THREE.Line | null>(null);

  // Interaction State
  const [followCamera, setFollowCamera] = useState(false);
  const followCameraRef = useRef(false);
  followCameraRef.current = followCamera;

  const isDraggingRef = useRef(false);
  const previousMousePositionRef = useRef({ x: 0, y: 0 });
  const orbitStateRef = useRef({
    theta: 0.8,    // Azimuth
    phi: 0.5,      // Elevation
    radius: 18.0,  // Distance in scene units (1 unit = 1000 km, Earth = 6.378 units)
  });

  // Target look-at position (Earth center or camera platform)
  const currentLookAtRef = useRef(new THREE.Vector3(0, 0, 0));
  const boresightDirRef = useRef<THREE.Vector3 | null>(null);
  const slewProgressRef = useRef<number>(0);

  // Helper to create texture for billboard sprites
  const createMarkerSprite = (text: string, color: string, iconChar: string): THREE.Sprite => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Background badge
      ctx.fillStyle = 'rgba(7, 10, 18, 0.85)';
      ctx.roundRect ? ctx.roundRect(4, 4, 248, 72, 10) : ctx.rect(4, 4, 248, 72);
      ctx.fill();

      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.stroke();

      // Icon circle
      ctx.beginPath();
      ctx.arc(36, 40, 20, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Icon letter
      ctx.font = 'bold 20px monospace';
      ctx.fillStyle = '#070a12';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(iconChar, 36, 40);

      // Label text
      ctx.font = 'bold 22px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(text, 68, 36);

      // Subtitle
      ctx.font = '14px monospace';
      ctx.fillStyle = color;
      ctx.fillText('LaserLockAI', 68, 56);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(3.2, 1.0, 1.0);
    return sprite;
  };

  // Helper to create Earth procedural canvas texture
  const createEarthTexture = (): THREE.CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Ocean deep blue gradient
      const grad = ctx.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0, '#0d1d36');
      grad.addColorStop(0.5, '#07152b');
      grad.addColorStop(1, '#0d1d36');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1024, 512);

      // Latitude and Longitude Grid lines
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
      ctx.lineWidth = 1;

      // Parallels (Latitude)
      for (let lat = -80; lat <= 80; lat += 20) {
        const y = ((90 - lat) / 180) * 512;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(1024, y);
        ctx.stroke();
      }

      // Equator (highlighted)
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 256);
      ctx.lineTo(1024, 256);
      ctx.stroke();

      // Meridians (Longitude)
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
      ctx.lineWidth = 1;
      for (let lon = -180; lon <= 180; lon += 30) {
        const x = ((lon + 180) / 360) * 1024;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 512);
        ctx.stroke();
      }

      // Prime Meridian
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(512, 0);
      ctx.lineTo(512, 512);
      ctx.stroke();

      // Simplified continent landmass patches for visual depth
      ctx.fillStyle = 'rgba(30, 58, 95, 0.65)';
      // North America
      ctx.beginPath();
      ctx.ellipse(280, 160, 90, 60, -0.2, 0, Math.PI * 2);
      ctx.fill();
      // South America
      ctx.beginPath();
      ctx.ellipse(340, 320, 55, 90, 0.2, 0, Math.PI * 2);
      ctx.fill();
      // Eurasia
      ctx.beginPath();
      ctx.ellipse(650, 160, 160, 70, 0.1, 0, Math.PI * 2);
      ctx.fill();
      // Africa
      ctx.beginPath();
      ctx.ellipse(540, 270, 65, 85, 0, 0, Math.PI * 2);
      ctx.fill();
      // Australia
      ctx.beginPath();
      ctx.ellipse(820, 340, 55, 45, 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  };

  // Helper to create circle orbit ring geometry
  const createOrbitRing = (radiusKm: number, color: number, opacity: number = 0.35, dashed: boolean = false) => {
    const radiusUnits = radiusKm / 1000.0;
    const segments = 128;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(radiusUnits * Math.cos(theta), 0, radiusUnits * Math.sin(theta)));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    let material: THREE.Material;
    if (dashed) {
      material = new THREE.LineDashedMaterial({
        color,
        transparent: true,
        opacity,
        dashSize: 0.5,
        gapSize: 0.25,
      });
    } else {
      material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    }
    const line = new THREE.Line(geometry, material);
    if (dashed) line.computeLineDistances();
    return line;
  };

  // Setup Three.js scene on mount
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 480;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03060c);
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 500);
    cameraRef.current = camera;

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 4. Lighting (Simulating Sun in space)
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
    sunLight.position.set(30, 15, 30);
    scene.add(sunLight);

    const ambientLight = new THREE.AmbientLight(0x38bdf8, 0.25);
    scene.add(ambientLight);

    // 5. Earth Globe (Scale: 1 scene unit = 1000 km)
    // Earth radius: 6378.137 km = 6.378137 scene units
    const EARTH_RADIUS_UNITS = 6.378137;
    const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS_UNITS, 96, 64);
    const textures = getRealisticEarthTextures();
    const earthMat = new THREE.MeshStandardMaterial({
      map: textures.day,
      normalMap: textures.normal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: textures.specular,
      roughness: 0.68,
      metalness: 0.05,
    });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    scene.add(earthMesh);
    earthGlobeRef.current = earthMesh;

    // Realistic transparent cloud layer
    const cloudGeo = new THREE.SphereGeometry(EARTH_RADIUS_UNITS * 1.006, 64, 32);
    const cloudMat = new THREE.MeshStandardMaterial({
      map: textures.clouds,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    earthMesh.add(cloudMesh);

    // 6. Faint Atmosphere Shell at 100 km
    // Atmosphere radius = (6378.137 + 100.0) / 1000 = 6.478137 units
    const ATMOSPHERE_RADIUS_UNITS = 6.478137;
    const atmosGeo = new THREE.SphereGeometry(ATMOSPHERE_RADIUS_UNITS, 48, 48);
    const atmosMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const atmosMesh = new THREE.Mesh(atmosGeo, atmosMat);
    scene.add(atmosMesh);
    atmosphereRef.current = atmosMesh;

    // 7. Preset Orbit Reference Rings
    // Spot check: LEO 550 km -> 6.928 units
    const presetRingsGroup = new THREE.Group();
    presetRingsGroup.add(createOrbitRing(6378.137 + 300, 0x334155, 0.25, true));   // LEO 300
    presetRingsGroup.add(createOrbitRing(6378.137 + 550, 0x0284c7, 0.4, true));    // LEO 550 (default)
    presetRingsGroup.add(createOrbitRing(6378.137 + 2000, 0x334155, 0.25, true));  // LEO 2000
    presetRingsGroup.add(createOrbitRing(6378.137 + 20200, 0x1e293b, 0.2, true)); // MEO
    presetRingsGroup.add(createOrbitRing(6378.137 + 35786, 0x475569, 0.35, true)); // GEO
    scene.add(presetRingsGroup);

    // 8. Active Camera Platform 3D Satellite Model & Billboard
    const camGroup = new THREE.Group();
    // Authentic 3D Real Satellite: Gold MLI, Solar Wings, FSOC Optical Terminal
    const camSat3D = createRealSatelliteModel({
      size: 0.44, // Preserves exact 0.4-unit footprint (matching previous r=0.2 sphere)
      accentColor: 0x06b6d4,
      isGoldMLI: true,
      includeOpticalTurret: true,
      includeAntenna: true,
      includeStarTrackers: true,
      includeThrusters: true,
    });
    camGroup.add(camSat3D);

    // Glowing sprite halo & label
    const camSprite = createMarkerSprite('CAMERA', '#06b6d4', 'C');
    camSprite.position.set(0, 0.6, 0);
    camGroup.add(camSprite);
    scene.add(camGroup);
    cameraMarkerRef.current = camGroup;

    // 9. Active Beacon Platform 3D Satellite Model & Billboard
    const beaconGroup = new THREE.Group();
    const beaconSat3D = createRealSatelliteModel({
      size: 0.44, // Preserves exact 0.4-unit footprint
      accentColor: 0x10b981,
      isGoldMLI: true,
      includeOpticalTurret: true,
      includeAntenna: true,
      includeStarTrackers: true,
      includeThrusters: true,
    });
    beaconGroup.add(beaconSat3D);

    const beaconSprite = createMarkerSprite('BEACON', '#10b981', 'B');
    beaconSprite.position.set(0, 0.6, 0);
    beaconGroup.add(beaconSprite);
    scene.add(beaconGroup);
    beaconMarkerRef.current = beaconGroup;

    // 9b. Backup Satellite Platform 3D Satellite Model & Billboard
    const backupGroup = new THREE.Group();
    const backupSat3D = createRealSatelliteModel({
      size: 0.40, // Preserves exact footprint (matching previous r=0.18 sphere)
      accentColor: 0x818cf8,
      isGoldMLI: true,
      includeOpticalTurret: true,
      includeAntenna: true,
      includeStarTrackers: true,
      includeThrusters: true,
    });
    backupGroup.add(backupSat3D);

    const backupSprite = createMarkerSprite('BACKUP SAT', '#818cf8', 'S2');
    backupSprite.position.set(0, 0.6, 0);
    backupGroup.add(backupSprite);
    backupGroup.visible = false;
    scene.add(backupGroup);
    backupMarkerRef.current = backupGroup;

    // 10. Active Line of Sight (LOS) — Solid Line
    const losGeo = new THREE.BufferGeometry();
    losGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const losMat = new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 2 });
    const losLine = new THREE.Line(losGeo, losMat);
    scene.add(losLine);
    losLineRef.current = losLine;

    // 10b. Backup Line of Sight (LOS) — Dashed Line
    const backupLosGeo = new THREE.BufferGeometry();
    backupLosGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const backupLosMat = new THREE.LineDashedMaterial({
      color: 0x818cf8,
      linewidth: 1.5,
      dashSize: 0.3,
      gapSize: 0.15,
      transparent: true,
      opacity: 0.75,
    });
    const backupLosLine = new THREE.Line(backupLosGeo, backupLosMat);
    backupLosLine.computeLineDistances();
    backupLosLine.visible = false;
    scene.add(backupLosLine);
    backupLosLineRef.current = backupLosLine;

    // 11. Camera FOV Frustum (4° x 3° Cone wireframe)
    const frustumGeo = new THREE.BufferGeometry();
    const frustumMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.8 });
    const frustumLines = new THREE.LineSegments(frustumGeo, frustumMat);
    scene.add(frustumLines);
    frustumLinesRef.current = frustumLines;

    // 12. Trajectory Trails
    const beaconTrailGeo = new THREE.BufferGeometry();
    const beaconTrailMat = new THREE.LineBasicMaterial({ color: 0xf43f5e, linewidth: 2 });
    const beaconTrail = new THREE.Line(beaconTrailGeo, beaconTrailMat);
    scene.add(beaconTrail);
    beaconTrailRef.current = beaconTrail;

    const cameraTrailGeo = new THREE.BufferGeometry();
    const cameraTrailMat = new THREE.LineBasicMaterial({ color: 0x0284c7, linewidth: 1.5 });
    const cameraTrail = new THREE.Line(cameraTrailGeo, cameraTrailMat);
    scene.add(cameraTrail);
    cameraTrailRef.current = cameraTrail;

    // Mouse Drag Listeners for Interactive Orbiting & Zooming
    const onMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      previousMousePositionRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = e.clientX - previousMousePositionRef.current.x;
      const deltaY = e.clientY - previousMousePositionRef.current.y;

      orbitStateRef.current.theta -= deltaX * 0.005;
      orbitStateRef.current.phi = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, orbitStateRef.current.phi + deltaY * 0.005));

      previousMousePositionRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
    };

    const onWheel = (e: WheelEvent) => {
      // Zoom limits: min 0.25 units when following satellite, otherwise min 7.2 units (just above atmosphere), max 85.0 units (beyond GEO)
      const minR = followCameraRef.current ? 0.25 : 7.2;
      const zoomStep = followCameraRef.current ? 0.005 : 0.02;
      orbitStateRef.current.radius = Math.max(minR, Math.min(85.0, orbitStateRef.current.radius + e.deltaY * zoomStep));
      e.preventDefault();
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    container.addEventListener('wheel', onWheel, { passive: false });

    // Render loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);

      // Rotate Earth slowly for a subtle living feel
      if (earthGlobeRef.current) {
        earthGlobeRef.current.rotation.y += 0.0003;
      }

      const { theta, phi, radius } = orbitStateRef.current;
      const targetLookAt = currentLookAtRef.current;

      camera.position.x = targetLookAt.x + radius * Math.cos(phi) * Math.sin(theta);
      camera.position.y = targetLookAt.y + radius * Math.sin(phi);
      camera.position.z = targetLookAt.z + radius * Math.cos(phi) * Math.cos(theta);
      camera.lookAt(targetLookAt);

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 640;
      const h = container.clientHeight || 480;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
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

  // Synchronize 3D Scene with incoming Orbital Telemetry
  useEffect(() => {
    if (!orbitalTelemetry) return;

    const { camera, beacon, link } = orbitalTelemetry;

    // Convert double precision ECI km positions to Three.js scene units (1 unit = 1000 km)
    const camPos = new THREE.Vector3(
      camera.pos_eci[0] / 1000.0,
      camera.pos_eci[2] / 1000.0, // Map Z to Y for standard 3D upright orientation
      camera.pos_eci[1] / 1000.0
    );

    const beaconPos = new THREE.Vector3(
      beacon.pos_eci[0] / 1000.0,
      beacon.pos_eci[2] / 1000.0,
      beacon.pos_eci[1] / 1000.0
    );

    // Safeguard: Ensure platforms never sink inside Earth globe (R = 6.378 units)
    const earthRUnits = 6.378137 + 0.02;
    if (camPos.length() < earthRUnits) {
      camPos.normalize().multiplyScalar(earthRUnits);
    }
    if (beaconPos.length() < earthRUnits) {
      beaconPos.normalize().multiplyScalar(earthRUnits);
    }

    // 1. Update Camera Platform position & orientation towards beacon
    if (cameraMarkerRef.current) {
      cameraMarkerRef.current.position.copy(camPos);
      cameraMarkerRef.current.lookAt(beaconPos);
    }

    // 2. Update Beacon Platform position
    if (beaconMarkerRef.current) {
      beaconMarkerRef.current.position.copy(beaconPos);
    }

    // 3. Update Camera Target Follow State
    if (followCameraRef.current) {
      currentLookAtRef.current.lerp(camPos, 0.1);
    } else {
      currentLookAtRef.current.lerp(new THREE.Vector3(0, 0, 0), 0.1);
    }

    // 4. Update Line of Sight (LOS) and Color by Link State
    // Color mapping: OK -> Green (0x10b981), BLOCKED -> Red (0xef4444), OUT_OF_FOV -> Amber (0xf59e0b)
    if (losLineRef.current) {
      const positions = losLineRef.current.geometry.attributes.position as THREE.BufferAttribute;
      if (positions) {
        positions.setXYZ(0, camPos.x, camPos.y, camPos.z);
        positions.setXYZ(1, beaconPos.x, beaconPos.y, beaconPos.z);
        positions.needsUpdate = true;
      }

      let losColor = 0x10b981; // OK
      if (link.link_state === 'LINK_BLOCKED') {
        losColor = 0xef4444; // Red: Earth occultation / blocked
      } else if (link.is_out_of_fov || Math.abs(link.az_body_deg) > 2.0 || Math.abs(link.el_body_deg) > 1.5) {
        losColor = 0xf59e0b; // Amber: Outside 4° x 3° FOV
      }

      const mat = losLineRef.current.material as THREE.LineBasicMaterial;
      if (mat) {
        mat.color.setHex(losColor);
      }
    }

    // 4b. Update Backup Satellite & Backup Dashed LOS Line
    const backupCam = orbitalTelemetry.backup_camera;
    if (backupCam && backupMarkerRef.current && backupLosLineRef.current) {
      const backupPos = new THREE.Vector3(
        backupCam.pos_eci[0] / 1000.0,
        backupCam.pos_eci[2] / 1000.0,
        backupCam.pos_eci[1] / 1000.0
      );
      if (backupPos.length() < earthRUnits) {
        backupPos.normalize().multiplyScalar(earthRUnits);
      }
      backupMarkerRef.current.position.copy(backupPos);
      backupMarkerRef.current.lookAt(beaconPos);
      backupMarkerRef.current.visible = true;

      const backupPositions = backupLosLineRef.current.geometry.attributes.position as THREE.BufferAttribute;
      if (backupPositions) {
        backupPositions.setXYZ(0, backupPos.x, backupPos.y, backupPos.z);
        backupPositions.setXYZ(1, beaconPos.x, beaconPos.y, beaconPos.z);
        backupPositions.needsUpdate = true;
      }
      backupLosLineRef.current.computeLineDistances();
      backupLosLineRef.current.visible = true;

      // Color backup link: indigo when seeing, red when blocked
      const hoData = orbitalTelemetry.handover;
      const backupCanSee = hoData ? hoData.backup_vis_can_see : true;
      const bMat = backupLosLineRef.current.material as THREE.LineDashedMaterial;
      if (bMat) {
        bMat.color.setHex(backupCanSee ? 0x818cf8 : 0xef4444);
        bMat.opacity = backupCanSee ? 0.8 : 0.4;
      }
    } else {
      if (backupMarkerRef.current) backupMarkerRef.current.visible = false;
      if (backupLosLineRef.current) backupLosLineRef.current.visible = false;
    }

    // 5. Update Camera Frustum Cone (4° horizontal x 3° vertical)
    if (frustumLinesRef.current) {
      const isAutoLOS = satellitePovSync.getData().autoLOS;
      const nadirDir = camPos.clone().negate().normalize();
      const losTargetDir = new THREE.Vector3().subVectors(beaconPos, camPos).normalize();

      if (isAutoLOS) {
        slewProgressRef.current = Math.min(1.0, slewProgressRef.current + 0.025);
      } else {
        slewProgressRef.current = Math.max(0.0, slewProgressRef.current - 0.025);
      }
      const p = slewProgressRef.current;
      const t = p * p * (3 - 2 * p); // smoothstep
      const dot = THREE.MathUtils.clamp(nadirDir.dot(losTargetDir), -1, 1);
      const omega = Math.acos(dot);
      let losDir: THREE.Vector3;
      if (p <= 0.0001) {
        losDir = nadirDir.clone();
      } else if (p >= 0.9999 || omega < 0.001) {
        losDir = losTargetDir.clone();
      } else {
        const sinOmega = Math.sin(omega);
        losDir = new THREE.Vector3()
          .addScaledVector(nadirDir, Math.sin((1 - t) * omega) / sinOmega)
          .addScaledVector(losTargetDir, Math.sin(t * omega) / sinOmega)
          .normalize();
      }
      boresightDirRef.current = losDir;

      const frustumDepth = Math.min(
        isAutoLOS ? camPos.distanceTo(beaconPos) : Math.max(1.0, camPos.length() - earthRUnits),
        6.0
      );

      // Build orthogonal basis for frustum
      const upRef = new THREE.Vector3(0, 1, 0);
      if (Math.abs(losDir.dot(upRef)) > 0.95) upRef.set(1, 0, 0);
      const right = new THREE.Vector3().crossVectors(losDir, upRef).normalize();
      const up = new THREE.Vector3().crossVectors(right, losDir).normalize();

      // Half angles: 4° x 3° -> 2° horizontal, 1.5° vertical
      const hHalfRad = THREE.MathUtils.degToRad(2.0);
      const vHalfRad = THREE.MathUtils.degToRad(1.5);
      const halfW = frustumDepth * Math.tan(hHalfRad);
      const halfH = frustumDepth * Math.tan(vHalfRad);

      const centerFar = new THREE.Vector3().copy(camPos).addScaledVector(losDir, frustumDepth);
      const tl = new THREE.Vector3().copy(centerFar).addScaledVector(right, -halfW).addScaledVector(up, halfH);
      const tr = new THREE.Vector3().copy(centerFar).addScaledVector(right, halfW).addScaledVector(up, halfH);
      const br = new THREE.Vector3().copy(centerFar).addScaledVector(right, halfW).addScaledVector(up, -halfH);
      const bl = new THREE.Vector3().copy(centerFar).addScaledVector(right, -halfW).addScaledVector(up, -halfH);

      const frustumPoints = [
        // Rays from aperture to 4 corners
        camPos.x, camPos.y, camPos.z, tl.x, tl.y, tl.z,
        camPos.x, camPos.y, camPos.z, tr.x, tr.y, tr.z,
        camPos.x, camPos.y, camPos.z, br.x, br.y, br.z,
        camPos.x, camPos.y, camPos.z, bl.x, bl.y, bl.z,
        // Perimeter rectangle
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
    }

    // 6. Update Beacon Trail
    if (beaconTrailRef.current && beacon.trail && beacon.trail.length > 1) {
      const trailPoints: number[] = [];
      beacon.trail.forEach(([x, y, z]) => {
        trailPoints.push(x / 1000.0, z / 1000.0, y / 1000.0);
      });
      beaconTrailRef.current.geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(trailPoints, 3)
      );
      beaconTrailRef.current.geometry.attributes.position.needsUpdate = true;
    }

    // 7. Update Camera Trail
    if (cameraTrailRef.current && camera.trail && camera.trail.length > 1) {
      const trailPoints: number[] = [];
      camera.trail.forEach(([x, y, z]) => {
        trailPoints.push(x / 1000.0, z / 1000.0, y / 1000.0);
      });
      cameraTrailRef.current.geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(trailPoints, 3)
      );
      cameraTrailRef.current.geometry.attributes.position.needsUpdate = true;
    }
  }, [orbitalTelemetry]);

  const handleResetView = () => {
    orbitStateRef.current = { theta: 0.8, phi: 0.5, radius: 18.0 };
    setFollowCamera(false);
    followCameraRef.current = false;
    currentLookAtRef.current.set(0, 0, 0);
  };

  const handleJumpToSatellite = () => {
    setFollowCamera(true);
    followCameraRef.current = true;
    orbitStateRef.current = { theta: 0.8, phi: 0.35, radius: 1.2 };
    if (cameraMarkerRef.current) {
      currentLookAtRef.current.copy(cameraMarkerRef.current.position);
    }
  };

  // Keyboard shortcut: S / F toggles satellite chase focus, Esc returns to Earth overview
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          (target as any).isContentEditable)
      ) {
        return;
      }
      if ((e.key === 's' || e.key === 'S' || e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (followCameraRef.current) {
          handleResetView();
        } else {
          handleJumpToSatellite();
        }
      }
      if (e.key === 'Escape' && followCameraRef.current) {
        e.preventDefault();
        handleResetView();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleLocateSatellite = () => {
    const camPos = cameraMarkerRef.current?.position;
    if (camPos) {
      const len = camPos.length();
      if (len > 0.001) {
        const phi = Math.asin(Math.max(-0.95, Math.min(0.95, camPos.y / len)));
        const theta = Math.atan2(camPos.x, camPos.z);
        orbitStateRef.current.theta = theta;
        orbitStateRef.current.phi = phi;
        orbitStateRef.current.radius = Math.max(12.0, Math.min(22.0, orbitStateRef.current.radius));
      }
    }
    setFollowCamera(false);
    followCameraRef.current = false;
    currentLookAtRef.current.set(0, 0, 0);
  };

  const handleLocateBeacon = () => {
    const bPos = beaconMarkerRef.current?.position;
    if (bPos) {
      const len = bPos.length();
      if (len > 0.001) {
        const phi = Math.asin(Math.max(-0.95, Math.min(0.95, bPos.y / len)));
        const theta = Math.atan2(bPos.x, bPos.z);
        orbitStateRef.current.theta = theta;
        orbitStateRef.current.phi = phi;
        orbitStateRef.current.radius = Math.max(12.0, Math.min(20.0, orbitStateRef.current.radius));
      }
    }
    setFollowCamera(false);
    followCameraRef.current = false;
    currentLookAtRef.current.set(0, 0, 0);
  };

  // Listen for global "fsoc:locate-satellite" and "fsoc:locate-beacon" events
  useEffect(() => {
    const handleSat = () => handleLocateSatellite();
    const handleBeacon = () => handleLocateBeacon();

    window.addEventListener('fsoc:locate-satellite', handleSat);
    window.addEventListener('fsoc:jump-to-sat', handleSat);
    window.addEventListener('fsoc:locate-beacon', handleBeacon);

    return () => {
      window.removeEventListener('fsoc:locate-satellite', handleSat);
      window.removeEventListener('fsoc:jump-to-sat', handleSat);
      window.removeEventListener('fsoc:locate-beacon', handleBeacon);
    };
  }, []);

  const getLinkStatusBadge = () => {
    if (!orbitalTelemetry) return null;
    const { link } = orbitalTelemetry;
    if (link.link_state === 'LINK_BLOCKED') {
      return (
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-700 font-bold">
          <ShieldAlert className="w-3 h-3 text-rose-400" /> LINK BLOCKED (EARTH OCCULTATION)
        </span>
      );
    }
    if (link.is_out_of_fov || Math.abs(link.az_body_deg) > 2.0 || Math.abs(link.el_body_deg) > 1.5) {
      return (
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-700 font-bold">
          <AlertTriangle className="w-3 h-3 text-amber-400" /> OUT OF FOV (FOV: 4°×3°)
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700 font-bold">
        <CheckCircle className="w-3 h-3 text-emerald-400" /> OPTICAL LINK ESTABLISHED (OK)
      </span>
    );
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-[#03060c] border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
      {/* 3D Viewport Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800 text-xs font-mono">
        <div className="flex items-center gap-2 text-cyan-400">
          <Globe className="w-4 h-4 text-cyan-400 animate-spin" style={{ animationDuration: '30s' }} />
          <span className="font-semibold tracking-wider">3D ORBITAL EARTH VIEW [THREE.JS DOUBLE-PRECISION]</span>
          <span className="text-[10px] text-slate-500 font-normal">(1 UNIT = 1000 KM)</span>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          {/* Locate Satellite Button */}
          <button
            onClick={handleLocateSatellite}
            className="px-2.5 py-1 rounded border flex items-center gap-1.5 transition font-semibold cursor-pointer bg-cyan-950/50 hover:bg-cyan-900 text-cyan-300 border-cyan-700/80 hover:border-cyan-400"
            title="Instantly orient camera to face satellite in 3D orbit (Shortcut: S)"
          >
            <Satellite className="w-3.5 h-3.5 text-cyan-400" />
            <span>Locate Sat</span>
          </button>

          {/* Locate Beacon Button */}
          <button
            onClick={handleLocateBeacon}
            className="px-2.5 py-1 rounded border flex items-center gap-1.5 transition font-semibold cursor-pointer bg-rose-950/50 hover:bg-rose-900 text-rose-300 border-rose-700/80 hover:border-rose-400"
            title="Instantly orient camera to face beacon in 3D orbit (Shortcut: B)"
          >
            <Radio className="w-3.5 h-3.5 text-rose-400" />
            <span>Locate Beacon</span>
          </button>

          {/* Follow Camera Toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white select-none">
            <input
              type="checkbox"
              checked={followCamera}
              onChange={(e) => {
                if (e.target.checked) {
                  handleJumpToSatellite();
                } else {
                  handleResetView();
                }
              }}
              className="rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-0 focus:ring-offset-0"
            />
            <Eye className="w-3 h-3 text-cyan-400" /> Follow Camera
          </label>

          <span className="text-slate-600">|</span>

          {/* Reset View Button */}
          <button
            onClick={handleResetView}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-slate-700 flex items-center gap-1.5 transition font-semibold"
            title="Reset 3D Orbit Camera to Default Earth View"
          >
            <RefreshCw className="w-3 h-3" /> Reset View
          </button>
        </div>
      </div>

      {/* WebGL Canvas Container */}
      <div ref={mountRef} className="relative flex-1 w-full h-full min-h-[380px] cursor-grab active:cursor-grabbing" />

      {/* Top Left Link Status Overlay */}
      <div className="absolute top-12 left-3 font-mono text-[11px] pointer-events-none">
        {getLinkStatusBadge()}
      </div>

      {/* Top Right Legend Overlay */}
      <div className="absolute top-12 right-3 bg-slate-950/85 backdrop-blur border border-slate-800 p-2.5 rounded font-mono text-[10px] text-slate-300 pointer-events-none space-y-1.5 shadow-xl">
        <div className="text-cyan-400 font-bold border-b border-slate-800/80 pb-1 uppercase tracking-wider">
          Visual Legend & Scale
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block"></span>
          <span>Camera Platform (Satellite / UAV)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block"></span>
          <span>Beacon Platform (Satellite / UAV)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-emerald-400 inline-block"></span>
          <span>Active Link (Solid)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 border-t-2 border-dashed border-indigo-400 inline-block"></span>
          <span className="text-indigo-300">Backup Link (Dashed)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-rose-500 inline-block"></span>
          <span>LOS Blocked (Earth Body)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-amber-400 inline-block"></span>
          <span>LOS Out of FOV</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-rose-400 inline-block border-t border-dashed"></span>
          <span>Beacon Orbit Trail</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded border border-cyan-400/50 bg-cyan-900/20 inline-block"></span>
          <span>100 km Atmosphere Shell</span>
        </div>
      </div>

      {/* Handover Status Panel HUD Overlay */}
      {orbitalTelemetry?.handover && (
        <div className="absolute bottom-3 right-3 z-20 pointer-events-auto">
          <HandoverPanel handover={orbitalTelemetry.handover} />
        </div>
      )}

      {/* Floating Quick Locate Buttons (Unrestricted global access) */}
      <div className="absolute bottom-3 right-4 z-20 pointer-events-auto flex items-center gap-2">
        <button
          onClick={handleLocateSatellite}
          className="bg-slate-950/95 hover:bg-cyan-950/80 backdrop-blur-md border border-cyan-500/80 hover:border-cyan-400 text-cyan-300 hover:text-white rounded-full px-3.5 py-1.5 shadow-[0_0_12px_rgba(6,182,212,0.25)] flex items-center gap-1.5 text-xs font-mono transition group cursor-pointer"
          title="Instantly orient camera to face satellite in 3D orbit (Shortcut: S)"
        >
          <Satellite className="w-3.5 h-3.5 text-cyan-400 group-hover:scale-110 transition" />
          <span className="font-semibold text-[11px]">Locate satellite</span>
        </button>
        <button
          onClick={handleLocateBeacon}
          className="bg-slate-950/95 hover:bg-rose-950/80 backdrop-blur-md border border-rose-500/80 hover:border-rose-400 text-rose-300 hover:text-white rounded-full px-3.5 py-1.5 shadow-[0_0_12px_rgba(244,63,94,0.25)] flex items-center gap-1.5 text-xs font-mono transition group cursor-pointer"
          title="Instantly orient camera to face beacon in 3D orbit (Shortcut: B)"
        >
          <Radio className="w-3.5 h-3.5 text-rose-400 group-hover:scale-110 transition" />
          <span className="font-semibold text-[11px]">Locate beacon</span>
        </button>
      </div>

      {/* Bottom Floating Stats Strip */}
      <div className="absolute bottom-3 left-3 bg-slate-950/85 backdrop-blur border border-slate-800 p-2.5 rounded font-mono text-[11px] text-slate-300 pointer-events-none flex flex-wrap gap-4 shadow-xl">
        <div>
          <span className="text-slate-400">Scale: </span>
          <span className="text-white font-bold">1 unit = 1000 km</span>
        </div>
        <div>
          <span className="text-slate-400">Earth Radius: </span>
          <span className="text-cyan-300 font-bold">6378.1 km (6.378u)</span>
        </div>
        <div>
          <span className="text-slate-400">Atmosphere Rim: </span>
          <span className="text-cyan-300 font-bold">100 km (6.478u)</span>
        </div>
        <div>
          <span className="text-slate-400">Controls: </span>
          <span className="text-slate-300">Drag = Orbit | Scroll = Zoom</span>
        </div>
      </div>
    </div>
  );
};
