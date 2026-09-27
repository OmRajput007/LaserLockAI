import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { TargetState, CameraState } from '../types';
import { Box, Layers, Eye, RefreshCw } from 'lucide-react';

interface Scene3DProps {
  target: TargetState | null;
  targets?: TargetState[];
  camera: CameraState | null;
  worldWidth?: number;
  worldHeight?: number;
  worldDepth?: number;
}

export const Scene3DViewport: React.FC<Scene3DProps> = ({
  target,
  targets = [],
  camera,
  worldWidth = 2000,
  worldHeight = 2000,
  worldDepth = 2000,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // References to dynamic 3D objects
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cameraMeshRef = useRef<THREE.Group | null>(null);
  const targetMeshRef = useRef<THREE.Mesh | null>(null);
  const targetGlowRef = useRef<THREE.Sprite | null>(null);
  const losLineRef = useRef<THREE.Line | null>(null);
  const trailLineRef = useRef<THREE.Line | null>(null);
  const frustumLinesRef = useRef<THREE.LineSegments | null>(null);

  // Mouse interaction state for orbital camera
  const isDraggingRef = useRef(false);
  const previousMousePositionRef = useRef({ x: 0, y: 0 });
  const orbitStateRef = useRef({
    theta: 0.65,    // Azimuth angle
    phi: 0.45,      // Elevation angle
    radius: 1800.0, // Distance to target center
  });

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 480;

    // 1. Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070e);
    sceneRef.current = scene;

    // 2. Perspective Camera
    const perspCamera = new THREE.PerspectiveCamera(50, width / height, 10, 8000);
    cameraRef.current = perspCamera;

    // 3. WebGL Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0x38bdf8, 0.8);
    dirLight.position.set(1000, 2500, 1000);
    scene.add(dirLight);

    // 5. World Coordinate Grid & Axis Center
    const gridHelper = new THREE.GridHelper(worldWidth, 20, 0x1e293b, 0x0f172a);
    gridHelper.position.set(worldWidth / 2, 0, worldDepth / 2);
    scene.add(gridHelper);

    // Axis indicator
    const axesHelper = new THREE.AxesHelper(150);
    axesHelper.position.set(worldWidth / 2, 0, worldDepth / 2);
    scene.add(axesHelper);

    // 6. Camera Base & Gimbal Mesh
    const camGroup = new THREE.Group();
    // Gimbal pedestal
    const pedestalGeo = new THREE.CylinderGeometry(20, 30, 40, 16);
    const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.8 });
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestal.position.y = 20;
    camGroup.add(pedestal);

    // Gimbal optical turret head
    const headGeo = new THREE.SphereGeometry(25, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.2, metalness: 0.9 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 45;
    camGroup.add(head);

    // Optical Lens Barrel
    const lensGeo = new THREE.CylinderGeometry(10, 14, 30, 16);
    lensGeo.rotateX(Math.PI / 2);
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1 });
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.position.set(0, 45, 18);
    camGroup.add(lens);

    camGroup.position.set(1000, 1000, 0);
    scene.add(camGroup);
    cameraMeshRef.current = camGroup;

    // 7. Target Beacon Mesh (3D glowing sphere / cube)
    const targetGeo = new THREE.BoxGeometry(20, 20, 20);
    const targetMat = new THREE.MeshBasicMaterial({ color: 0xff3366 });
    const targetMesh = new THREE.Mesh(targetGeo, targetMat);
    targetMesh.position.set(1000, 1000, 1000);
    scene.add(targetMesh);
    targetMeshRef.current = targetMesh;

    // 8. Line of Sight (LOS) Ray
    const losGeo = new THREE.BufferGeometry();
    losGeo.setAttribute('position', new THREE.Float32BufferAttribute([1000, 1000, 0, 1000, 1000, 1000], 3));
    const losMat = new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 20, gapSize: 10 });
    const losLine = new THREE.Line(losGeo, losMat);
    losLine.computeLineDistances();
    scene.add(losLine);
    losLineRef.current = losLine;

    // 9. Trajectory History 3D Line
    const trailGeo = new THREE.BufferGeometry();
    const trailMat = new THREE.LineBasicMaterial({ color: 0xf43f5e, linewidth: 2 });
    const trailLine = new THREE.Line(trailGeo, trailMat);
    scene.add(trailLine);
    trailLineRef.current = trailLine;

    // 10. FOV Frustum Pyramid Wireframe
    const frustumGeo = new THREE.BufferGeometry();
    const frustumMat = new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.75 });
    const frustumLines = new THREE.LineSegments(frustumGeo, frustumMat);
    scene.add(frustumLines);
    frustumLinesRef.current = frustumLines;

    // Mouse Drag Listeners for Interactive Orbiting
    const onMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      previousMousePositionRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = e.clientX - previousMousePositionRef.current.x;
      const deltaY = e.clientY - previousMousePositionRef.current.y;

      orbitStateRef.current.theta -= deltaX * 0.005;
      orbitStateRef.current.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, orbitStateRef.current.phi + deltaY * 0.005));

      previousMousePositionRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
    };

    const onWheel = (e: WheelEvent) => {
      orbitStateRef.current.radius = Math.max(500, Math.min(4500, orbitStateRef.current.radius + e.deltaY * 1.5));
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

      // Update camera viewpoint using spherical coordinates around world center
      const { theta, phi, radius } = orbitStateRef.current;
      const targetCenter = new THREE.Vector3(1000, 1000, 500);

      perspCamera.position.x = targetCenter.x + radius * Math.sin(theta) * Math.cos(phi);
      perspCamera.position.y = targetCenter.y + radius * Math.sin(phi);
      perspCamera.position.z = targetCenter.z + radius * Math.cos(theta) * Math.cos(phi);
      perspCamera.lookAt(targetCenter);

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
  }, [worldWidth, worldHeight, worldDepth]);

  // Synchronize 3D scene objects with live telemetry
  useEffect(() => {
    if (!target || !camera) return;

    // 1. Update Camera Position & Pan/Tilt Rotation in 3D
    if (cameraMeshRef.current) {
      cameraMeshRef.current.position.set(camera.position_x, camera.position_y, camera.position_z);
      // Pan about Y axis (clockwise), Tilt about X axis
      cameraMeshRef.current.rotation.y = THREE.MathUtils.degToRad(-camera.pan_deg);
      cameraMeshRef.current.rotation.x = THREE.MathUtils.degToRad(camera.tilt_deg);
    }

    // 2. Update Target Beacon Position in 3D
    if (targetMeshRef.current) {
      targetMeshRef.current.position.set(target.world_x, target.world_y, target.world_z);

      // Color based on FOV state
      const mat = targetMeshRef.current.material as THREE.MeshBasicMaterial;
      if (mat) {
        mat.color.setHex(target.is_in_fov ? 0x10b981 : 0xff3366);
      }
    }

    // 3. Update Line of Sight (LOS)
    if (losLineRef.current) {
      const positions = losLineRef.current.geometry.attributes.position as THREE.BufferAttribute;
      if (positions) {
        positions.setXYZ(0, camera.position_x, camera.position_y, camera.position_z);
        positions.setXYZ(1, target.world_x, target.world_y, target.world_z);
        positions.needsUpdate = true;
        losLineRef.current.computeLineDistances();
      }
    }

    // 4. Update 3D Trajectory Trail
    if (trailLineRef.current && target.trajectory_trail && target.trajectory_trail.length > 1) {
      const points: number[] = [];
      target.trajectory_trail.forEach(([x, y, z]) => {
        points.push(x, y, z);
      });
      trailLineRef.current.geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(points, 3)
      );
      trailLineRef.current.geometry.attributes.position.needsUpdate = true;
    }

    // 5. Update FOV Frustum Cone
    if (frustumLinesRef.current && camera.frustum_corners_world && camera.frustum_corners_world.length === 4) {
      const c = camera;
      const [tl, tr, br, bl] = c.frustum_corners_world;
      const apex = [c.position_x, c.position_y, c.position_z];

      // Lines: Apex to 4 corners, plus 4 perimeter edges (24 floats)
      const frustumPoints = [
        // Rays from aperture to corners
        ...apex, ...tl,
        ...apex, ...tr,
        ...apex, ...br,
        ...apex, ...bl,
        // Far base rectangle
        ...tl, ...tr,
        ...tr, ...br,
        ...br, ...bl,
        ...bl, ...tl,
      ];

      frustumLinesRef.current.geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(frustumPoints, 3)
      );
      frustumLinesRef.current.geometry.attributes.position.needsUpdate = true;

      // Color frustum green when locked, cyan otherwise
      const mat = frustumLinesRef.current.material as THREE.LineBasicMaterial;
      if (mat) {
        mat.color.setHex(target.is_in_fov ? 0x10b981 : 0x06b6d4);
      }
    }
  }, [target, camera]);

  const resetCameraView = () => {
    orbitStateRef.current = { theta: 0.65, phi: 0.45, radius: 1800.0 };
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-[#05070e] border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
      {/* 3D Viewport Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800 text-xs font-mono">
        <div className="flex items-center gap-2 text-cyan-400">
          <Box className="w-4 h-4 text-cyan-400 animate-pulse" />
          <span className="font-semibold tracking-wider">3D VIRTUAL SCENE [THREE.JS WEBGL]</span>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-slate-400">Orbit: <span className="text-white">Click & Drag</span></span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">Zoom: <span className="text-white">Scroll</span></span>
          <button
            onClick={resetCameraView}
            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-slate-700 flex items-center gap-1 transition"
            title="Reset 3D Orbit Camera"
          >
            <RefreshCw className="w-3 h-3" /> Reset View
          </button>
        </div>
      </div>

      {/* WebGL Canvas Container */}
      <div ref={mountRef} className="relative flex-1 w-full h-full min-h-[380px] cursor-grab active:cursor-grabbing" />

      {/* Overlay HUD Telemetry in 3D */}
      <div className="absolute bottom-3 left-3 bg-slate-950/85 backdrop-blur border border-slate-800 p-2.5 rounded font-mono text-[10px] space-y-1 text-slate-300 pointer-events-none">
        <div className="text-cyan-400 font-bold border-b border-slate-800 pb-1">3D ENTITY TRACKER</div>
        <div>Camera Pos: <span className="text-white">({camera?.position_x.toFixed(0)}, {camera?.position_y.toFixed(0)}, {camera?.position_z.toFixed(0)})</span></div>
        <div>Target Pos: <span className="text-emerald-400 font-bold">({target?.world_x.toFixed(1)}, {target?.world_y.toFixed(1)}, {target?.world_z.toFixed(1)})</span></div>
        <div>LOS Range: <span className="text-cyan-300 font-bold">{target?.range_z_cam !== null ? `${target?.range_z_cam?.toFixed(1)} m` : '--'}</span></div>
        <div>Frustum State: {target?.is_in_fov ? (
          <span className="text-emerald-400 font-bold">INSIDE FOV CONE</span>
        ) : (
          <span className="text-rose-400 font-bold">OUTSIDE FOV CONE</span>
        )}</div>
      </div>

      <div className="absolute top-12 right-3 bg-slate-950/80 backdrop-blur border border-slate-800 px-2.5 py-1.5 rounded font-mono text-[10px] text-slate-400 pointer-events-none space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 bg-emerald-400 inline-block"></span>
          <span>4° × 3° Optical FOV Cone</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 bg-blue-400 inline-block border-dashed"></span>
          <span>Optical Line of Sight (LOS)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 bg-rose-500 inline-block"></span>
          <span>Target 3D Flight Trail</span>
        </div>
      </div>
    </div>
  );
};
