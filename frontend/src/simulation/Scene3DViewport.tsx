import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useSceneSettings } from '../hooks/useSceneSettings';
import * as THREE from 'three';
import { TargetState, CameraState, DisturbanceTelemetry } from '../types';
import { satellitePovSync, computeBeaconOmegaReal, EARTH_CIRCUMFERENCE_KM } from './satellitePovSync';
import { orbitalEngine } from './orbitalEngine';
import { formatBeaconRevolutionTime } from '../components/BeaconSpeedControl';
import { alarmAudio } from '../services/alarmAudio';
import { getOrCreateEarthTexture, createAtmosphereRimMesh, createRealisticEarthAssembly, RealisticEarthAssembly } from './earthTexture';
import { createRealSatelliteModel, updateScreenSpaceSatelliteScale } from './satelliteModel';
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
  Satellite,
  Locate,
  Ruler,
  Sun,
  Target,
  Table,
  BarChart2,
  Gauge,
  Clock,
  Minus,
  ChevronDown,
  ChevronUp,
  MapPin,
  PenTool,
  CheckCircle,
  Trash2,
  Crosshair,
  Maximize2,
  Move,
  Undo2,
  ExternalLink,
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

export type RenderScaleMode = 'TRUE_SCALE' | 'READABLE_SCALE';

export const EARTH_RENDER_R = 100.0;
export const EARTH_RADIUS_KM = 6378.0;
export const READABLE_K = 2.0;

/**
 * Computes altitude offset above Earth surface (R=100u) in 3D render units.
 * RULE 2: TRUE_SCALE: render_radius(altitude_km) = EARTH_RENDER_R * (altitude_km / 6378)
 * RULE 3: READABLE_SCALE: render_radius(altitude_km) = EARTH_RENDER_R * log10(1 + altitude_km/6378) * k
 */
export const getRenderAltitudeOffset = (
  altitudeKm: number,
  mode: RenderScaleMode = 'TRUE_SCALE',
  k: number = READABLE_K,
  earthRenderR: number = EARTH_RENDER_R
): number => {
  if (mode === 'TRUE_SCALE') {
    return earthRenderR * (altitudeKm / EARTH_RADIUS_KM);
  } else {
    return earthRenderR * Math.log10(1 + altitudeKm / EARTH_RADIUS_KM) * k;
  }
};

/**
 * Computes total orbital radius from Earth center (0, 0, 0) in 3D render units.
 */
export const getRenderOrbitRadius = (
  altitudeKm: number,
  mode: RenderScaleMode = 'TRUE_SCALE',
  k: number = READABLE_K,
  earthRenderR: number = EARTH_RENDER_R
): number => {
  return earthRenderR + getRenderAltitudeOffset(altitudeKm, mode, k, earthRenderR);
};

/**
 * Inverses the render altitude offset to physical kilometers.
 * In TRUE_SCALE: altKm = (renderOffsetU / earthRenderR) * EARTH_RADIUS_KM
 * In READABLE_SCALE: altKm = EARTH_RADIUS_KM * (10^(renderOffsetU / (earthRenderR * k)) - 1)
 */
export const getAltitudeFromRenderOffset = (
  renderOffsetU: number,
  mode: RenderScaleMode = 'TRUE_SCALE',
  k: number = READABLE_K,
  earthRenderR: number = EARTH_RENDER_R
): number => {
  if (mode === 'TRUE_SCALE') {
    return (renderOffsetU / Math.max(0.001, earthRenderR)) * EARTH_RADIUS_KM;
  } else {
    const exponent = renderOffsetU / Math.max(0.001, earthRenderR * k);
    return EARTH_RADIUS_KM * (Math.pow(10, exponent) - 1);
  }
};

/**
 * Format altitude/radius displaying both real-world km and 3D render units (u).
 * Format: "550 km (108.6u)"
 * Rule: Round km to whole numbers, u to 1 decimal.
 */
export const formatAltAndUnits = (
  altKm: number,
  mode: RenderScaleMode = 'TRUE_SCALE',
  k: number = READABLE_K,
  earthRenderR: number = EARTH_RENDER_R
): string => {
  const roundedKm = Math.round(altKm);
  const u = getRenderOrbitRadius(altKm, mode, k, earthRenderR);
  return `${roundedKm.toLocaleString()} km (${u.toFixed(1)}u)`;
};

/**
 * Format distance/slant range in km and render units.
 */
export const formatDistAndUnits = (
  distKm: number,
  renderUnits: number
): string => {
  return `${Math.round(distKm).toLocaleString()} km (${renderUnits.toFixed(1)}u)`;
};

// Earth sidereal rotation rate in inertial space (ECI): 360° / 86,164.0905 s (23 hr 56 min 4 s)
export const SIDEREAL_DAY_SEC = 86164.0905;
export const EARTH_ROT_RAD_PER_SEC = (2.0 * Math.PI) / SIDEREAL_DAY_SEC; // ~7.2921159e-5 rad/s (Matches GEO 35,786 km exactly)
export const EARTH_ROT_DEG_PER_HOUR = (360.0 / SIDEREAL_DAY_SEC) * 3600.0; // ~15.041°/hour
export const EARTH_ROT_DEG_PER_SEC = 360.0 / SIDEREAL_DAY_SEC; // ~0.004178°/s
export const GM_EARTH_KM3_S2 = 398600.4418;
export const ORBIT_DRAG_LIMIT_KM = 150.0;

/**
 * Solar Direction & Day/Night Terminator Model:
 * ASSUMPTION (v1): A single fixed solar vector in ECI space is defined:
 * FIXED_SUN_DIR = (1.0, 0.35, 0.45).normalize().
 * Full solar ephemeris (subsolar declination / right ascension over 365.25 days) is omitted as a v1 assumption.
 * This fixed vector demonstrates why Sun-Synchronous Orbits (SSO, 97.8°) maintain constant solar illumination
 * relative to the day/night terminator boundary.
 */
export const FIXED_SUN_DIR = new THREE.Vector3(1.0, 0.35, 0.45).normalize();

/**
 * Computes great circle points perpendicular to a normal vector (such as FIXED_SUN_DIR)
 * at a given sphere radius.
 */
export const computeTerminatorCirclePoints = (
  normalDir: THREE.Vector3,
  radius: number,
  segments: number = 180
): THREE.Vector3[] => {
  const upCandidate = Math.abs(normalDir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(normalDir, upCandidate).normalize();
  const v = new THREE.Vector3().crossVectors(normalDir, u).normalize();
  const pts: THREE.Vector3[] = [];
  for (let j = 0; j <= segments; j++) {
    const theta = (j / segments) * Math.PI * 2;
    pts.push(
      new THREE.Vector3()
        .addScaledVector(u, radius * Math.cos(theta))
        .addScaledVector(v, radius * Math.sin(theta))
    );
  }
  return pts;
};

/**
 * 3D Beacon Path Waypoint on Earth Globe
 * Anchored to the Earth's geographic surface in local spherical coordinates.
 * Point 1 is the starting point (Green), Point 4 is the ending point (Orange/Rose).
 */
export interface BeaconPathWaypoint {
  id: number;
  label: string;
  localPos: THREE.Vector3;
  latDeg: number;
  lonDeg: number;
}

/**
 * Spherical SLERP between two vectors on a sphere of radius R
 */
export const slerpOnSphere = (
  pA: THREE.Vector3,
  pB: THREE.Vector3,
  t: number,
  radius: number = EARTH_RENDER_R
): THREE.Vector3 => {
  const uA = pA.clone().normalize();
  const uB = pB.clone().normalize();
  const cosTheta = THREE.MathUtils.clamp(uA.dot(uB), -1.0, 1.0);
  const theta = Math.acos(cosTheta);
  if (theta < 1e-5) {
    return pA.clone().normalize().multiplyScalar(radius);
  }
  const sinTheta = Math.sin(theta);
  const w1 = Math.sin((1.0 - t) * theta) / sinTheta;
  const w2 = Math.sin(t * theta) / sinTheta;
  return new THREE.Vector3()
    .addScaledVector(uA, w1)
    .addScaledVector(uB, w2)
    .normalize()
    .multiplyScalar(radius);
};

/**
 * Generate interpolated spherical points along the great circle between pA and pB
 */
export const computeGreatCircleSegments = (
  pA: THREE.Vector3,
  pB: THREE.Vector3,
  segments: number = 24,
  radius: number = EARTH_RENDER_R
): THREE.Vector3[] => {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    pts.push(slerpOnSphere(pA, pB, i / segments, radius));
  }
  return pts;
};

/**
 * Convert Latitude / Longitude in degrees to 3D Cartesian coordinates on sphere
 */
export const latLonToVector3 = (
  latDeg: number,
  lonDeg: number,
  radius: number = EARTH_RENDER_R
): THREE.Vector3 => {
  const phi = THREE.MathUtils.degToRad(latDeg);
  const theta = THREE.MathUtils.degToRad(lonDeg);
  const cosPhi = Math.cos(phi);
  const x = radius * cosPhi * Math.sin(theta);
  const y = radius * Math.sin(phi);
  const z = radius * cosPhi * Math.cos(theta);
  return new THREE.Vector3(x, y, z);
};

/**
 * Convert 3D Vector on sphere to Latitude / Longitude in degrees
 */
export const vector3ToLatLon = (
  vec: THREE.Vector3,
  radius: number = EARTH_RENDER_R
): { latDeg: number; lonDeg: number } => {
  const latDeg = THREE.MathUtils.radToDeg(
    Math.asin(THREE.MathUtils.clamp(vec.y / radius, -1.0, 1.0))
  );
  const lonDeg = THREE.MathUtils.radToDeg(Math.atan2(vec.x, vec.z));
  return { latDeg, lonDeg };
};

/**
 * Preset 4-Point Ground Track matching the user reference image:
 * Point 1: Lower-left Starting Point (Green)
 * Point 2: Upper-middle Apex Waypoint (Amber)
 * Point 3: Mid-right Waypoint (Amber)
 * Point 4: Lower-right Ending Point (Orange)
 * Solid Line connects: 1 -> 2 -> 3 -> 4
 * Dashed Line connects: 4 -> 1
 */
export const PRESET_4POINT_WAYPOINTS: { lat: number; lon: number; label: string }[] = [
  { lat: 15.0, lon: -45.0, label: '1 (START)' },
  { lat: 48.0, lon: -10.0, label: '2' },
  { lat: 36.0, lon: 20.0, label: '3' },
  { lat: 18.0, lon: 52.0, label: '4 (END)' },
];

/**
 * High-resolution canvas billboard badge sprite for 3D waypoints (1, 2, 3, 4)
 */
export const createWaypointBadgeSprite = (
  num: number,
  isStart: boolean,
  isEnd: boolean
): THREE.Sprite => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Background color: Green for Start (Pt 1), Orange for End (Pt 4), Amber for intermediate
    const bgColor = isStart
      ? 'rgba(16, 185, 129, 0.95)'
      : isEnd
      ? 'rgba(244, 63, 94, 0.95)'
      : 'rgba(245, 158, 11, 0.95)';
    const strokeColor = isStart ? '#34d399' : isEnd ? '#fda4af' : '#fde68a';

    // Circular badge
    ctx.fillStyle = bgColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(64, 64, 48, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Number inside circle
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 54px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(num), 64, 64);

    // Pill badge for role
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') {
      (ctx as any).roundRect(124, 40, 124, 48, 10);
    } else {
      ctx.rect(124, 40, 124, 48);
    }
    ctx.fill();
    ctx.stroke();

    // Text
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = strokeColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const subText = isStart ? 'START' : isEnd ? 'END' : `WAYPOINT`;
    ctx.fillText(subText, 186, 64);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(8.0, 4.0, 1.0);
  sprite.renderOrder = 650;
  return sprite;
};

export const FOOTPRINT_SEGMENTS = 64;

/**
 * Standard Elevation-Mask Geometry (Tasks 1-3):
 * Computes the ground footprint of a satellite on Earth's surface where elevation >= min_elevation.
 *
 * Geometry:
 *   r = R_E + h (distance from Earth center to satellite)
 *   sin(η) = (R_E / r) * cos(ε)  [Law of Sines in Δ(Earth Center, Satellite, Horizon Point)]
 *   η = arcsin(sin(η))           [Nadir off-axis angle from satellite to footprint edge]
 *   θ = π/2 - ε - η              [Earth central half-angle / angular radius of footprint]
 *
 * Circle is constructed on Earth's surface (radius globeR + offset) centered at satDir.
 */
export const computeFootprintGeometry = (
  satDir: THREE.Vector3,
  globeR: number,
  thetaRad: number,
  segments: number = FOOTPRINT_SEGMENTS
) => {
  let up = Math.abs(satDir.y) < 0.92 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(satDir, up).normalize();
  const v = new THREE.Vector3().crossVectors(u, satDir).normalize();

  const cosTheta = Math.cos(thetaRad);
  const sinTheta = Math.sin(thetaRad);
  const ringR = globeR + 0.18;
  const capR = globeR + 0.12;

  // 1. Perimeter ring points for LineLoop
  const ringPoints: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const phi = (i / segments) * Math.PI * 2;
    const pt = new THREE.Vector3()
      .addScaledVector(satDir, cosTheta)
      .addScaledVector(u, sinTheta * Math.cos(phi))
      .addScaledVector(v, sinTheta * Math.sin(phi))
      .multiplyScalar(ringR);
    ringPoints.push(pt);
  }

  // 2. Spherical cap mesh vertices and indices for semi-transparent shaded fill
  const capPositions: number[] = [];
  const capIndices: number[] = [];

  // Vertex 0: Center (Sub-satellite point)
  const centerPt = satDir.clone().multiplyScalar(capR);
  capPositions.push(centerPt.x, centerPt.y, centerPt.z);

  // Ring 1: Mid-theta (theta * 0.5) to keep cap hugging sphere curve
  const halfTheta = thetaRad * 0.5;
  const cosHalf = Math.cos(halfTheta);
  const sinHalf = Math.sin(halfTheta);
  for (let i = 0; i < segments; i++) {
    const phi = (i / segments) * Math.PI * 2;
    const pt = new THREE.Vector3()
      .addScaledVector(satDir, cosHalf)
      .addScaledVector(u, sinHalf * Math.cos(phi))
      .addScaledVector(v, sinHalf * Math.sin(phi))
      .multiplyScalar(capR);
    capPositions.push(pt.x, pt.y, pt.z);
  }

  // Ring 2: Outer perimeter (theta)
  for (let i = 0; i < segments; i++) {
    const phi = (i / segments) * Math.PI * 2;
    const pt = new THREE.Vector3()
      .addScaledVector(satDir, cosTheta)
      .addScaledVector(u, sinTheta * Math.cos(phi))
      .addScaledVector(v, sinTheta * Math.sin(phi))
      .multiplyScalar(capR);
    capPositions.push(pt.x, pt.y, pt.z);
  }

  // Triangle indices: Fan from center 0 to Ring 1
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    capIndices.push(0, 1 + i, 1 + next);
  }
  // Strip between Ring 1 and Ring 2
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    const r1_a = 1 + i;
    const r1_b = 1 + next;
    const r2_a = 1 + segments + i;
    const r2_b = 1 + segments + next;
    capIndices.push(r1_a, r2_a, r1_b);
    capIndices.push(r1_b, r2_a, r2_b);
  }

  return { ringPoints, capPositions, capIndices, thetaRad };
};

/**
 * Standardized Screen-Space Billboard Marker System (Tasks 1-6)
 * Constant pixel size regardless of camera zoom or perspective distance.
 */
export const BASE_MARKER_PX = 11.0; // Standard base marker diameter (Task 2)
export const ACTIVE_MARKER_PX = 15.4; // 1.4x base diameter for selected/active state (Task 5)
export const MIN_CLICKABLE_MARKER_PX = 8.0; // Clickable minimum floor (Task 6)

let sharedFlatCircleTexture: THREE.CanvasTexture | null = null;
export const getFlatMarkerTexture = (): THREE.CanvasTexture => {
  if (sharedFlatCircleTexture) return sharedFlatCircleTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    // 30px radius = 60px diameter inside 64px canvas (anti-aliased margin)
    ctx.arc(size / 2, size / 2, 30, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  sharedFlatCircleTexture = texture;
  return texture;
};

const _tempMarkerWorldPos = new THREE.Vector3();
const _scratchVecA = new THREE.Vector3();
const _scratchVecB = new THREE.Vector3();
const _scratchVecC = new THREE.Vector3();
const _scratchVecD = new THREE.Vector3();

interface PersistentScene3DState {
  satelliteAnomaly?: number;
  satelliteMeanAnomaly?: number;
  satelliteTrueAnomaly?: number;
  satelliteRadius?: number;
  satelliteAltKm?: number;
  satelliteSpeedKmS?: number;
  beaconAnomaly?: number;
  earthRotationY?: number;
  pathLegIndex?: number;
  pathLegProgress?: number;
  pathCurrentLocalPos?: { x: number; y: number; z: number };
  pathStatusText?: string;
  pathOverallProgressPct?: number;
  pathCurrentLegDisplay?: string;
  cameraTheta?: number;
  cameraPhi?: number;
  cameraRadius?: number;
  peerAnomalies?: Record<string, number>;
}

// Module-level persistent state cache that preserves element positions across tab switches & remounts
const persistentSceneState: PersistentScene3DState = {};

export const updateScreenSpaceMarkerScale = (
  sprite: THREE.Sprite | null,
  camera: THREE.PerspectiveCamera | null,
  canvasHeight: number,
  targetPixelDiameter: number
): void => {
  if (!sprite || !camera || canvasHeight <= 0) return;
  sprite.getWorldPosition(_tempMarkerWorldPos);
  const dist = camera.position.distanceTo(_tempMarkerWorldPos);
  if (dist <= 0.001) return;
  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  const visibleWorldHeight = 2.0 * dist * Math.tan(fovRad / 2.0);
  const unitsPerPixel = visibleWorldHeight / canvasHeight;
  const clampedDiameter = Math.max(MIN_CLICKABLE_MARKER_PX, targetPixelDiameter);
  // Compensate for 60px circle inside 64px canvas
  const worldScale = clampedDiameter * (64.0 / 60.0) * unitsPerPixel;
  sprite.scale.set(worldScale, worldScale, 1.0);
};

/**
 * Solve Kepler's equation M = E - e * sin(E) for Eccentric Anomaly E (radians)
 * using Newton-Raphson iteration.
 */
export const solveKepler = (
  meanAnomalyRad: number,
  e: number,
  tolerance: number = 1e-9,
  maxIter: number = 100
): number => {
  let M = meanAnomalyRad % (2 * Math.PI);
  if (M < 0) M += 2 * Math.PI;
  if (e < 1e-8) return M;
  let E = e > 0.8 ? Math.PI : M;
  for (let i = 0; i < maxIter; i++) {
    const f = E - e * Math.sin(E) - M;
    const fPrime = 1 - e * Math.cos(E);
    const delta = f / fPrime;
    E -= delta;
    if (Math.abs(delta) < tolerance) break;
  }
  return E;
};

/**
 * Convert Eccentric Anomaly E (rad) to True Anomaly nu (rad)
 */
export const eccentricToTrueAnomaly = (E: number, e: number): number => {
  if (e < 1e-8) return E;
  const halfNu = Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  let nu = 2 * halfNu;
  if (nu < 0) nu += 2 * Math.PI;
  return nu;
};

/**
 * Convert True Anomaly nu (rad) to Eccentric Anomaly E (rad)
 */
export const trueToEccentricAnomaly = (nu: number, e: number): number => {
  if (e < 1e-8) return nu;
  const halfE = Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  let E = 2 * halfE;
  if (E < 0) E += 2 * Math.PI;
  return E;
};

/**
 * Computes Keplerian orbital period in seconds: T = 2 * pi * sqrt(a^3 / mu)
 */
export const computeOrbitalPeriodSec = (semiMajorAxisKm: number): number => {
  if (semiMajorAxisKm <= 0) return 0;
  return 2.0 * Math.PI * Math.sqrt(Math.pow(semiMajorAxisKm, 3) / GM_EARTH_KM3_S2);
};

/**
 * Computes Keplerian mean motion in radians per second: n = sqrt(mu / a^3) = 2 * pi / T
 */
export const computeMeanMotionRadS = (semiMajorAxisKm: number): number => {
  if (semiMajorAxisKm <= 0) return 0;
  return Math.sqrt(GM_EARTH_KM3_S2 / Math.pow(semiMajorAxisKm, 3));
};

/**
 * Formats speed in both km/h and km/s, exactly matching real satellite specifications:
 * e.g. "~27,320 km/h (7.59 km/s)"
 */
export const formatOrbitalSpeed = (speedKmS: number): string => {
  const kmh = Math.round(speedKmS * 3600);
  return `~${kmh.toLocaleString()} km/h (${speedKmS.toFixed(2)} km/s)`;
};

/**
 * Formats orbital period in minutes and hours/minutes, exactly matching standard specifications:
 * e.g. "~95.5 minutes (1 hr 35 min)" or "~23 hours 56 minutes (1 Sidereal Day)"
 */
export const formatOrbitalPeriod = (periodSec: number): string => {
  const totalMin = periodSec / 60.0;
  const hours = Math.floor(totalMin / 60.0);
  const mins = Math.round(totalMin % 60.0);
  if (totalMin >= 1430 && totalMin <= 1445) {
    return `~23 hours 56 minutes (1 Sidereal Day)`;
  }
  if (hours > 0) {
    return `~${totalMin.toFixed(1)} minutes (${hours} hr ${mins} min)`;
  }
  return `~${totalMin.toFixed(1)} minutes`;
};

export interface OrbitPreset {
  id: string;
  name: string;
  shortName: string;
  perigeeAltKm: number;
  apogeeAltKm: number;
  altitudeKm: number;
  radius?: number;
  incDeg: number;
  raanDeg: number;
  argPerigeeDeg?: number;
  trueAnomalyDeg?: number;
  color: number;
  description: string;
  speedKmh?: number;
  speedKmS?: number;
  periodSec?: number;
  speedFormatted?: string;
  periodFormatted?: string;
}

// Low Earth Orbit (LEO), Geostationary (GEO), and Elliptical Transfer (GTO) Presets
// Calibrated to real orbital mechanics: speed (km/h) and revolution period
export const ORBIT_PRESETS: OrbitPreset[] = [
  {
    id: 'leo-550-p1',
    name: 'LEO Walker Plane 1 (550 km, 53°)',
    shortName: 'Walker 1 (Host)',
    perigeeAltKm: 550,
    apogeeAltKm: 550,
    altitudeKm: 550,
    incDeg: 53.0,
    raanDeg: 35.0,
    argPerigeeDeg: 0.0,
    trueAnomalyDeg: 48.7,
    color: 0x38bdf8,
    description: 'Primary operational optical transceiver plane (circular e=0)',
    speedKmh: 27320,
    speedKmS: 7.59,
    periodSec: 5727.4,
    speedFormatted: '~27,320 km/h',
    periodFormatted: '~95.5 minutes (1 hr 35 min)',
  },
  {
    id: 'leo-550-p2',
    name: 'LEO Walker Plane 2 (550 km, 53°)',
    shortName: 'Walker 2',
    perigeeAltKm: 550,
    apogeeAltKm: 550,
    altitudeKm: 550,
    incDeg: 53.0,
    raanDeg: 110.0,
    argPerigeeDeg: 0.0,
    trueAnomalyDeg: 0.0,
    color: 0x0284c7,
    description: 'Adjacent constellation crosslink relay plane (circular e=0)',
    speedKmh: 27320,
    speedKmS: 7.59,
    periodSec: 5727.4,
    speedFormatted: '~27,320 km/h',
    periodFormatted: '~95.5 minutes (1 hr 35 min)',
  },
  {
    id: 'leo-550-p3',
    name: 'LEO Walker Plane 3 (550 km, 53°)',
    shortName: 'Walker 3',
    perigeeAltKm: 550,
    apogeeAltKm: 550,
    altitudeKm: 550,
    incDeg: 53.0,
    raanDeg: 185.0,
    argPerigeeDeg: 0.0,
    trueAnomalyDeg: 0.0,
    color: 0x0284c7,
    description: 'Quadrature constellation relay plane (circular e=0)',
    speedKmh: 27320,
    speedKmS: 7.59,
    periodSec: 5727.4,
    speedFormatted: '~27,320 km/h',
    periodFormatted: '~95.5 minutes (1 hr 35 min)',
  },
  {
    id: 'leo-polar-sso',
    name: 'Polar Sun-Synchronous SSO (700 km, 97.8°)',
    shortName: 'Polar SSO (97.8°)',
    perigeeAltKm: 700,
    apogeeAltKm: 700,
    altitudeKm: 700,
    incDeg: 97.8,
    raanDeg: 75.0,
    argPerigeeDeg: 0.0,
    trueAnomalyDeg: 0.0,
    color: 0x818cf8,
    description: 'Observation orbit passing over Earth north/south poles (circular e=0)',
    speedKmh: 27029,
    speedKmS: 7.51,
    periodSec: 5914.7,
    speedFormatted: '~27,029 km/h',
    periodFormatted: '~98.6 minutes (1 hr 38 min)',
  },
  {
    id: 'leo-equatorial',
    name: 'Equatorial Fast Relay (350 km, 12°)',
    shortName: 'Equatorial (12°)',
    perigeeAltKm: 350,
    apogeeAltKm: 350,
    altitudeKm: 350,
    incDeg: 12.0,
    raanDeg: 0.0,
    argPerigeeDeg: 0.0,
    trueAnomalyDeg: 0.0,
    color: 0x06b6d4,
    description: 'Low-inclination high-cadence tropical orbit (circular e=0)',
    speedKmh: 27724,
    speedKmS: 7.70,
    periodSec: 5480.4,
    speedFormatted: '~27,724 km/h',
    periodFormatted: '~91.4 minutes (1 hr 31 min)',
  },
  {
    id: 'leo-vleo',
    name: 'Very Low Earth Orbit VLEO (200 km, 34°)',
    shortName: 'VLEO / Drone (34°)',
    perigeeAltKm: 200,
    apogeeAltKm: 200,
    altitudeKm: 200,
    incDeg: 34.0,
    raanDeg: 310.0,
    argPerigeeDeg: 0.0,
    trueAnomalyDeg: 0.0,
    color: 0x10b981,
    description: 'Atmospheric boundary reconnaissance / UAV crosslink (circular e=0)',
    speedKmh: 28037,
    speedKmS: 7.79,
    periodSec: 5298.5,
    speedFormatted: '~28,037 km/h',
    periodFormatted: '~88.3 minutes (1 hr 28 min)',
  },
  {
    id: 'leo-high',
    name: 'High-LEO Broadband Shell (1,150 km, 68°)',
    shortName: 'High-LEO (68°)',
    perigeeAltKm: 1150,
    apogeeAltKm: 1150,
    altitudeKm: 1150,
    incDeg: 68.0,
    raanDeg: 145.0,
    argPerigeeDeg: 0.0,
    trueAnomalyDeg: 0.0,
    color: 0x6366f1,
    description: 'Upper boundary LEO constellation shell (circular e=0)',
    speedKmh: 26208,
    speedKmS: 7.28,
    periodSec: 6488.7,
    speedFormatted: '~26,208 km/h',
    periodFormatted: '~108.1 minutes (1 hr 48 min)',
  },
  {
    id: 'geo-equatorial',
    name: 'Geostationary Orbit GEO (35,786 km, 0°)',
    shortName: 'GEO (35,786 km)',
    perigeeAltKm: 35786,
    apogeeAltKm: 35786,
    altitudeKm: 35786,
    incDeg: 0.0,
    raanDeg: 0.0,
    argPerigeeDeg: 0.0,
    trueAnomalyDeg: 0.0,
    color: 0xf59e0b,
    description: 'Geostationary equatorial optical relay platform (circular e=0)',
    speedKmh: 11070,
    speedKmS: 3.08,
    periodSec: 86164.1,
    speedFormatted: '~11,070 km/h',
    periodFormatted: '~23 hours 56 minutes (1 Sidereal Day)',
  },
  {
    id: 'gto-demo',
    name: 'Geostationary Transfer Orbit GTO (200 × 35,786 km, 28.5°)',
    shortName: 'GTO Demo (200×35.8k)',
    perigeeAltKm: 200,
    apogeeAltKm: 35786,
    altitudeKm: (200 + 35786) / 2,
    incDeg: 28.5,
    raanDeg: 0.0,
    argPerigeeDeg: 0.0,
    trueAnomalyDeg: 0.0,
    color: 0xf43f5e,
    description: 'Elliptical GTO demo: ~10.24 km/s at perigee, ~1.60 km/s at apogee (e=0.7301)',
    speedKmh: 36864,
    speedKmS: 10.24,
    periodSec: 37920,
    speedFormatted: '~36,864 km/h (perigee) / ~5,760 km/h (apogee)',
    periodFormatted: '~10.5 hours (GTO Transfer)',
  },
];

export const LEO_PRESETS = ORBIT_PRESETS;

// Helper: calculate 3D Cartesian position from Keplerian orbital elements
export const computeOrbitPoint = (
  radius: number,
  incDeg: number,
  raanDeg: number,
  trueAnomaly: number,
  argPerigeeDeg: number = 0
): THREE.Vector3 => {
  const u = trueAnomaly + THREE.MathUtils.degToRad(argPerigeeDeg);
  const p = new THREE.Vector3(radius * Math.cos(u), 0, radius * Math.sin(u));
  p.applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(incDeg));
  p.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(raanDeg));
  return p;
};

/**
 * Helper to generate 3D billboard text sprites for atmospheric boundary labeling.
 */
export const createAtmosphereLabelSprite = (
  text: string,
  tag: string,
  color: string,
  strokeColor: string
): THREE.Sprite => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 120;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dark glass pill background
    ctx.fillStyle = 'rgba(6, 12, 26, 0.88)';
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') {
      (ctx as any).roundRect(8, 8, canvas.width - 16, canvas.height - 16, 20);
    } else {
      ctx.rect(8, 8, canvas.width - 16, canvas.height - 16);
    }
    ctx.fill();
    ctx.stroke();

    // Altitude Tag
    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`[ ${tag} ]`, 26, 42);

    // Layer Title
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(text, 26, 80);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(16, 3.8, 1);
  sprite.renderOrder = 550;
  return sprite;
};

/**
 * Updates text and tag on an existing billboard sprite without recreating the mesh.
 */
export const updateSpriteText = (
  sprite: THREE.Sprite,
  text: string,
  tag: string,
  color: string,
  strokeColor: string
) => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 120;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(6, 12, 26, 0.88)';
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') {
      (ctx as any).roundRect(8, 8, canvas.width - 16, canvas.height - 16, 20);
    } else {
      ctx.rect(8, 8, canvas.width - 16, canvas.height - 16);
    }
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`[ ${tag} ]`, 26, 42);

    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(text, 26, 80);
  }
  const oldTexture = sprite.material.map;
  if (oldTexture) oldTexture.dispose();
  const newTexture = new THREE.CanvasTexture(canvas);
  newTexture.minFilter = THREE.LinearFilter;
  sprite.material.map = newTexture;
  sprite.material.needsUpdate = true;
};

/**
 * Creates a dedicated, high-contrast billboard label sprite for the target beacon.
 */
export const createBeaconLabelSprite = (
  text: string = 'ATMOSPHERIC UAV',
  tag: string = '150 km/h'
): THREE.Sprite => {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 90;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dark cybernetic pill background
    ctx.fillStyle = 'rgba(6, 12, 26, 0.92)';
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.88)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') {
      (ctx as any).roundRect(6, 6, canvas.width - 12, canvas.height - 12, 16);
    } else {
      ctx.rect(6, 6, canvas.width - 12, canvas.height - 12);
    }
    ctx.fill();
    ctx.stroke();

    // Orange beacon status dot
    ctx.fillStyle = '#FF5F40';
    ctx.beginPath();
    ctx.arc(24, 45, 5, 0, Math.PI * 2);
    ctx.fill();

    // Top Tag: [ BEACON · tag ]
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#FF5F40';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`[ BEACON · ${tag} ]`, 38, 30);

    // Bottom Platform Name: ATMOSPHERIC UAV
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#F0FFEA';
    ctx.fillText(text, 38, 58);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.95,
    depthTest: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(9.0, 2.5, 1.0);
  sprite.renderOrder = 550;
  return sprite;
};

/**
 * Updates beacon billboard label text and status colors.
 */
export const updateBeaconLabelSprite = (
  sprite: THREE.Sprite,
  speedKmh: number,
  isLocked: boolean
) => {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 90;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(27, 29, 26, 0.95)';
    ctx.strokeStyle = isLocked ? 'rgba(255, 95, 64, 0.9)' : 'rgba(94, 98, 90, 0.88)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') {
      (ctx as any).roundRect(6, 6, canvas.width - 12, canvas.height - 12, 16);
    } else {
      ctx.rect(6, 6, canvas.width - 12, canvas.height - 12);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isLocked ? '#FF5F40' : '#5E625A';
    ctx.beginPath();
    ctx.arc(24, 45, 5, 0, Math.PI * 2);
    ctx.fill();

    const tag = speedKmh > 0 ? `${speedKmh} km/h` : 'STATIC';
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = isLocked ? '#FF5F40' : '#9CA195';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`[ BEACON · ${tag} ]`, 38, 30);

    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#F0FFEA';
    ctx.fillText(speedKmh > 0 ? 'ATMOSPHERIC UAV' : 'GROUND STATION', 38, 58);
  }

  const oldTexture = sprite.material.map;
  if (oldTexture) oldTexture.dispose();
  const newTexture = new THREE.CanvasTexture(canvas);
  newTexture.minFilter = THREE.LinearFilter;
  sprite.material.map = newTexture;
  sprite.material.needsUpdate = true;
};

export interface ReferenceAltitudeSpec {
  id: string;
  name: string;
  shortTag: string;
  altKm: number;
  color: number;
  cssColor: string;
  strokeRgba: string;
  dashSize: number;
  gapSize: number;
  labelAngle: number;
}

/**
 * Standard reference altitude lines (Task 2):
 * - 100 km: Kármán Line
 * - 2,000 km: LEO Limit
 * - 20,200 km: MEO / GPS
 * - 35,786 km: Geostationary
 */
export const REFERENCE_ALTITUDES: ReferenceAltitudeSpec[] = [
  {
    id: 'karman',
    name: 'Kármán Line',
    shortTag: 'Edge of Space',
    altKm: 100,
    color: 0xff5f40,
    cssColor: '#FF5F40',
    strokeRgba: 'rgba(255, 95, 64, 0.6)',
    dashSize: 4,
    gapSize: 3,
    labelAngle: 0.35,
  },
  {
    id: 'leo-limit',
    name: 'LEO Limit',
    shortTag: 'LEO Boundary',
    altKm: 2000,
    color: 0xf0ffea,
    cssColor: '#F0FFEA',
    strokeRgba: 'rgba(240, 255, 234, 0.6)',
    dashSize: 6,
    gapSize: 4,
    labelAngle: 0.55,
  },
  {
    id: 'meo-gps',
    name: 'MEO / GPS',
    shortTag: 'GPS Constellation',
    altKm: 20200,
    color: 0x9ca195,
    cssColor: '#9CA195',
    strokeRgba: 'rgba(156, 161, 149, 0.6)',
    dashSize: 10,
    gapSize: 6,
    labelAngle: 0.75,
  },
  {
    id: 'geo',
    name: 'Geostationary',
    shortTag: 'GEO Clarke Belt',
    altKm: 35786,
    color: 0x5e625a,
    cssColor: '#5E625A',
    strokeRgba: 'rgba(94, 98, 90, 0.6)',
    dashSize: 14,
    gapSize: 8,
    labelAngle: 0.95,
  },
];

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
  const targetCubeMeshRef = useRef<THREE.Sprite | THREE.Mesh | null>(null);
  const satSpriteRef = useRef<THREE.Sprite | null>(null);
  const sat3DModelRef = useRef<THREE.Group | null>(null);
  const beaconSpriteRef = useRef<THREE.Sprite | null>(null);
  const beaconLabelRef = useRef<THREE.Sprite | null>(null);
  const lastBeaconLabelState = useRef({ speed: -1, locked: false });
  const backupSpriteRef = useRef<THREE.Sprite | null>(null);
  const backup3DModelRef = useRef<THREE.Group | null>(null);
  const losLineRef = useRef<THREE.Line | null>(null);
  const trailLineRef = useRef<THREE.Line | null>(null);
  const frustumLinesRef = useRef<THREE.LineSegments | null>(null);
  const activeOrbitRingRef = useRef<THREE.Line | null>(null);
  const globeMeshRef = useRef<THREE.Mesh | null>(null);
  const cloudMeshRef = useRef<THREE.Mesh | null>(null);
  const realisticEarthAssemblyRef = useRef<RealisticEarthAssembly | null>(null);
  const beaconGroupRef = useRef<THREE.Group | null>(null);
  const beaconTrackRingRef = useRef<THREE.Line | null>(null);
  // Backup satellite (for handover visualisation)
  const backupSatMeshRef = useRef<THREE.Group | null>(null);
  const backupLosLineRef = useRef<THREE.Line | null>(null);

  // Atmospheric Shells (0-20km Turbulence Zone, 20-100km Thin Atmosphere, 100km Kármán Line)
  const atmosphereGroupRef = useRef<THREE.Group | null>(null);
  const turbulenceShellRef = useRef<THREE.Mesh | null>(null);
  const thinAtmoShellRef = useRef<THREE.Mesh | null>(null);
  const karmanRingRef = useRef<THREE.Line | null>(null);
  const turbulenceLabelRef = useRef<THREE.Sprite | null>(null);
  const thinAtmoLabelRef = useRef<THREE.Sprite | null>(null);
  const karmanLabelRef = useRef<THREE.Sprite | null>(null);

  // Standard Reference Altitude Rings (100km, 2000km, 20200km, 35786km - Task 2 & 3)
  const referenceRingsGroupRef = useRef<THREE.Group | null>(null);
  const refRingMeshesRef = useRef<{
    spec: ReferenceAltitudeSpec;
    ring: THREE.Line;
    label: THREE.Sprite;
  }[]>([]);

  // Solar Direction & Day/Night Terminator State (Tasks 1-4)
  const sunGroupRef = useRef<THREE.Group | null>(null);
  const terminatorRingRef = useRef<THREE.Line | null>(null);
  const terminatorLabelRef = useRef<THREE.Sprite | null>(null);
  const sunArrowRef = useRef<THREE.ArrowHelper | null>(null);
  const sunLabelRef = useRef<THREE.Sprite | null>(null);
  const nightShadingMeshRef = useRef<THREE.Mesh | null>(null);

  // Satellite Ground Footprint (Elevation Mask Geometry - Tasks 1-3)
  const footprintGroupRef = useRef<THREE.Group | null>(null);
  const footprintRingRef = useRef<THREE.LineLoop | null>(null);
  const footprintCapMeshRef = useRef<THREE.Mesh | null>(null);
  const footprintCenterMarkerRef = useRef<THREE.Mesh | null>(null);
  const footprintLabelRef = useRef<THREE.Sprite | null>(null);

  // Optimization 4.B: Direct DOM refs for high-frequency telemetry & footprint HUD
  // Completely eliminates component re-renders (10 Hz) during 60 FPS animation loop
  const footprintStatusRef = useRef<HTMLSpanElement | null>(null);
  const footprintRadiusRef = useRef<HTMLSpanElement | null>(null);
  const cameraFovStatusRef = useRef<HTMLSpanElement | null>(null);
  const trackerSlantRangeRef = useRef<HTMLSpanElement | null>(null);
  const trackerPatStateRef = useRef<HTMLSpanElement | null>(null);
  const trackerSpeedPeriodRef = useRef<HTMLSpanElement | null>(null);
  const trackerKeplerRef = useRef<HTMLDivElement | null>(null);

  // ── Persisted scene settings (survive page navigation via localStorage) ──
  const { settings: _ss, set: _setS, bindSetting: _bindS } = useSceneSettings();
  const [showAtmosphereShells, setShowAtmosphereShells] = [_ss.showAtmosphereShells, _bindS('showAtmosphereShells')];
  const [showReferenceRings, setShowReferenceRings] = [_ss.showReferenceRings, _bindS('showReferenceRings')];
  const [showSunTerminator, setShowSunTerminator] = [_ss.showSunTerminator, _bindS('showSunTerminator')];
  const [showFootprint, setShowFootprint] = [_ss.showFootprint, _bindS('showFootprint')];
  const [isBeaconInFootprint, setIsBeaconInFootprint] = useState<boolean>(false);
  const [beaconElevationDeg, setBeaconElevationDeg] = useState<number>(0.0);
  const [footprintThetaDeg, setFootprintThetaDeg] = useState<number>(14.96);
  const [footprintGroundRadiusKm, setFootprintGroundRadiusKm] = useState<number>(1665.0);
  const [isLegendMinimized, setIsLegendMinimized] = [_ss.isLegendMinimized, _bindS('isLegendMinimized')];
  const [isTrackerMinimized, setIsTrackerMinimized] = [_ss.isTrackerMinimized, _bindS('isTrackerMinimized')];
  const [isScaleMinimized, setIsScaleMinimized] = [_ss.isScaleMinimized, _bindS('isScaleMinimized')];

  // Earth Render Radius state (defaults to 100u, dynamically tunable)
  const [earthRenderRadius, setEarthRenderRadius] = useState<number>(EARTH_RENDER_R);
  const earthRenderRadiusRef = useRef<number>(EARTH_RENDER_R);
  earthRenderRadiusRef.current = earthRenderRadius;
  const globeRadius = earthRenderRadius;

  // Target Ground Station position ref (radius = 100 on surface)
  const tgtPosRef = useRef(new THREE.Vector3(38, 76, 52).normalize().multiplyScalar(globeRadius));
  const latestSatPosRef = useRef(new THREE.Vector3(0, 0, 108.6));

  // Beacon Surface Motion State (Physically grounded atmospheric UAV/Drone platform: 0 - 1200 km/h)
  const [beaconSpeedKmh, setBeaconSpeedKmh] = [_ss.beaconSpeedKmh, _bindS('beaconSpeedKmh')];
  const [beaconRevolving, setBeaconRevolving] = [_ss.beaconRevolving, _bindS('beaconRevolving')];
  const [beaconAnomalyDeg, setBeaconAnomalyDeg] = useState<number>(120.0);
  const [beaconInc, setBeaconInc] = [_ss.beaconInc, _bindS('beaconInc')];
  const [beaconRaan, setBeaconRaan] = [_ss.beaconRaan, _bindS('beaconRaan')];

  // Phase offset for backup satellite (degrees along-track)
  const backupPhaseOffsetDeg = 20.0;

  const beaconMotionRef = useRef({
    isRevolving: true,
    speedKmh: 150,
    anomaly: satellitePovSync.getData().beaconAnomaly ?? persistentSceneState.beaconAnomaly ?? THREE.MathUtils.degToRad(120.0),
    incDeg: 28.5,
    raanDeg: 65.0,
  });

  useEffect(() => {
    beaconMotionRef.current.isRevolving = beaconRevolving;
    beaconMotionRef.current.speedKmh = beaconSpeedKmh;
    beaconMotionRef.current.incDeg = beaconInc;
    beaconMotionRef.current.raanDeg = beaconRaan;
  }, [beaconRevolving, beaconSpeedKmh, beaconInc, beaconRaan]);

  // 3D BEACON GROUND PATH PLANNING (1=Start [Green] -> 4=End [Orange], reference user image)
  const [beaconPathWaypoints, setBeaconPathWaypoints] = useState<BeaconPathWaypoint[]>(() => {
    if (_ss.beaconPathCleared) {
      return [];
    }
    return PRESET_4POINT_WAYPOINTS.map((wp, idx) => ({
      id: idx + 1,
      label: wp.label,
      localPos: latLonToVector3(wp.lat, wp.lon, EARTH_RENDER_R),
      latDeg: wp.lat,
      lonDeg: wp.lon,
    }));
  });
  const beaconPathWaypointsRef = useRef<BeaconPathWaypoint[]>(beaconPathWaypoints);
  beaconPathWaypointsRef.current = beaconPathWaypoints;

  const [pathFollowMode, setPathFollowMode] = [_ss.pathFollowMode, _bindS('pathFollowMode')];
  const pathFollowModeRef = useRef<boolean>(_ss.pathFollowMode);
  pathFollowModeRef.current = pathFollowMode;

  const [pathMotionActive, setPathMotionActive] = useState<boolean>(false);
  const pathMotionActiveRef = useRef<boolean>(false);
  pathMotionActiveRef.current = pathMotionActive;

  const [isDrawingPath, setIsDrawingPath] = useState<boolean>(false);
  const isDrawingPathRef = useRef<boolean>(false);
  isDrawingPathRef.current = isDrawingPath;

  // 3D Focus & Instant Navigation Mode ('earth' overview vs 'satellite' vs 'beacon' close-up tracking)
  const [focusMode, setFocusMode] = useState<'earth' | 'satellite' | 'beacon'>('earth');
  const focusModeRef = useRef<'earth' | 'satellite' | 'beacon'>('earth');
  focusModeRef.current = focusMode;

  const [showBeaconPathPlanner, setShowBeaconPathPlanner] = [_ss.showBeaconPathPlanner, _bindS('showBeaconPathPlanner')];
  const [isPathPlannerMinimized, setIsPathPlannerMinimized] = [_ss.isPathPlannerMinimized, _bindS('isPathPlannerMinimized')];
  const [pathPlannerPosition, setPathPlannerPosition] = [_ss.pathPlannerPosition, _bindS('pathPlannerPosition')];

  const cyclePathPlannerPosition = () => {
    setPathPlannerPosition((prev) => {
      if (prev === 'top-center') return 'top-left';
      if (prev === 'top-left') return 'bottom-center';
      return 'top-center';
    });
  };

  const getPlannerPositionClass = () => {
    if (pathPlannerPosition === 'top-left') {
      return showOrbitTuner ? 'top-3 left-[340px]' : 'top-14 left-3';
    }
    if (pathPlannerPosition === 'bottom-center') {
      return 'bottom-3 left-1/2 -translate-x-1/2';
    }
    // Default: Top-Center (Zero overlap with Left/Right widgets)
    return 'top-3 left-1/2 -translate-x-1/2';
  };

  const pathLegIndexRef = useRef<number>(persistentSceneState.pathLegIndex ?? 0);
  const pathLegProgressRef = useRef<number>(persistentSceneState.pathLegProgress ?? 0.0);
  const pathCurrentLocalPosRef = useRef<THREE.Vector3>(
    persistentSceneState.pathCurrentLocalPos
      ? new THREE.Vector3(
          persistentSceneState.pathCurrentLocalPos.x,
          persistentSceneState.pathCurrentLocalPos.y,
          persistentSceneState.pathCurrentLocalPos.z
        )
      : latLonToVector3(PRESET_4POINT_WAYPOINTS[0].lat, PRESET_4POINT_WAYPOINTS[0].lon, EARTH_RENDER_R)
  );

  const [pathStatusText, setPathStatusText] = useState<string>(
    persistentSceneState.pathStatusText ?? 'Ready at Pt 1 (Starting Point)'
  );
  const [pathOverallProgressPct, setPathOverallProgressPct] = useState<number>(
    persistentSceneState.pathOverallProgressPct ?? 0
  );
  const [pathCurrentLegDisplay, setPathCurrentLegDisplay] = useState<string>(
    persistentSceneState.pathCurrentLegDisplay ?? 'Leg 1→2'
  );
  const [pathSpeedMultiplier, setPathSpeedMultiplier] = useState<number>(15);
  const pathSpeedMultiplierRef = useRef<number>(15);
  pathSpeedMultiplierRef.current = pathSpeedMultiplier;

  // 3D Three.js Objects for Path
  const beaconPathGroupRef = useRef<THREE.Group | null>(null);
  const beaconPathSolidLineRef = useRef<THREE.Line | null>(null);
  const beaconPathDashedLineRef = useRef<THREE.Line | null>(null);
  const beaconPathMarkersGroupRef = useRef<THREE.Group | null>(null);

  const rebuildBeaconPathVisuals = (
    waypoints: BeaconPathWaypoint[],
    radius: number = earthRenderRadiusRef.current
  ) => {
    if (!beaconPathSolidLineRef.current || !beaconPathDashedLineRef.current || !beaconPathMarkersGroupRef.current) return;

    const markersGroup = beaconPathMarkersGroupRef.current;
    while (markersGroup.children.length > 0) {
      const child = markersGroup.children[0];
      markersGroup.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
      if ((child as any).material) {
        if (Array.isArray((child as any).material)) {
          (child as any).material.forEach((m: any) => m.dispose());
        } else {
          (child as any).material.dispose();
        }
      }
    }

    if (waypoints.length === 0) {
      beaconPathSolidLineRef.current.visible = false;
      beaconPathDashedLineRef.current.visible = false;
      return;
    }

    waypoints.forEach((wp, idx) => {
      const isStart = idx === 0;
      const isEnd = idx === waypoints.length - 1 && waypoints.length >= 2;
      const pinColor = isStart ? 0x10b981 : isEnd ? 0xf43f5e : 0xf59e0b;

      const norm = wp.localPos.clone().normalize();
      const markerPos = norm.clone().multiplyScalar(radius + 0.25);

      const sphereGeo = new THREE.SphereGeometry(0.85, 16, 16);
      const sphereMat = new THREE.MeshBasicMaterial({ color: pinColor });
      const pinMesh = new THREE.Mesh(sphereGeo, sphereMat);
      pinMesh.position.copy(markerPos);
      pinMesh.renderOrder = 620;
      markersGroup.add(pinMesh);

      const ringGeo = new THREE.RingGeometry(0.6, 1.4, 24);
      const ringMat = new THREE.MeshBasicMaterial({ color: pinColor, side: THREE.DoubleSide });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.copy(norm.clone().multiplyScalar(radius + 0.12));
      ringMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), norm);
      ringMesh.renderOrder = 615;
      markersGroup.add(ringMesh);

      const badge = createWaypointBadgeSprite(wp.id, isStart, isEnd);
      badge.position.copy(norm.clone().multiplyScalar(radius + 3.8));
      markersGroup.add(badge);
    });

    if (waypoints.length < 2) {
      beaconPathSolidLineRef.current.visible = false;
      beaconPathDashedLineRef.current.visible = false;
      return;
    }

    const solidPts: THREE.Vector3[] = [];
    for (let k = 0; k < waypoints.length - 1; k++) {
      const legPts = computeGreatCircleSegments(
        waypoints[k].localPos,
        waypoints[k + 1].localPos,
        28,
        radius + 0.22
      );
      if (k > 0) legPts.shift();
      solidPts.push(...legPts);
    }

    beaconPathSolidLineRef.current.geometry.dispose();
    beaconPathSolidLineRef.current.geometry = new THREE.BufferGeometry().setFromPoints(solidPts);
    beaconPathSolidLineRef.current.visible = true;

    const dashedPts = computeGreatCircleSegments(
      waypoints[waypoints.length - 1].localPos,
      waypoints[0].localPos,
      28,
      radius + 0.22
    );
    beaconPathDashedLineRef.current.geometry.dispose();
    beaconPathDashedLineRef.current.geometry = new THREE.BufferGeometry().setFromPoints(dashedPts);
    beaconPathDashedLineRef.current.computeLineDistances();
    beaconPathDashedLineRef.current.visible = true;
  };

  const handleStartPathMotion = () => {
    if (beaconPathWaypoints.length < 2) return;
    if (pathLegIndexRef.current >= beaconPathWaypoints.length - 2 && pathLegProgressRef.current >= 1.0) {
      pathLegIndexRef.current = 0;
      pathLegProgressRef.current = 0.0;
      pathCurrentLocalPosRef.current.copy(beaconPathWaypoints[0].localPos);
    }
    pathFollowModeRef.current = true;
    setPathFollowMode(true);
    pathMotionActiveRef.current = true;
    setPathMotionActive(true);
    setPathStatusText(`Moving: Leg ${pathLegIndexRef.current + 1}→${pathLegIndexRef.current + 2} · ${beaconSpeedKmh} km/h`);
  };

  const handlePausePathMotion = () => {
    pathMotionActiveRef.current = false;
    setPathMotionActive(false);
    setPathStatusText(`Paused at Leg ${pathLegIndexRef.current + 1}→${pathLegIndexRef.current + 2} (${Math.round(pathLegProgressRef.current * 100)}%)`);
  };

  const handleResetPathToStart = () => {
    if (beaconPathWaypoints.length === 0) return;
    pathLegIndexRef.current = 0;
    pathLegProgressRef.current = 0.0;
    pathMotionActiveRef.current = false;
    setPathMotionActive(false);
    pathCurrentLocalPosRef.current.copy(beaconPathWaypoints[0].localPos);
    setPathOverallProgressPct(0);
    setPathCurrentLegDisplay('Leg 1→2');
    setPathStatusText('Ready at Pt 1 (Starting Point)');
  };

  const handleLoadPreset4PointPath = () => {
    const pts: BeaconPathWaypoint[] = PRESET_4POINT_WAYPOINTS.map((wp, idx) => ({
      id: idx + 1,
      label: wp.label,
      localPos: latLonToVector3(wp.lat, wp.lon, earthRenderRadiusRef.current),
      latDeg: wp.lat,
      lonDeg: wp.lon,
    }));
    setBeaconPathWaypoints(pts);
    beaconPathWaypointsRef.current = pts;
    pathLegIndexRef.current = 0;
    pathLegProgressRef.current = 0.0;
    pathMotionActiveRef.current = false;
    setPathMotionActive(false);
    pathCurrentLocalPosRef.current.copy(pts[0].localPos);
    setPathFollowMode(true);
    pathFollowModeRef.current = true;
    setPathOverallProgressPct(0);
    setPathCurrentLegDisplay('Leg 1→2');
    setPathStatusText('Ready at Pt 1 (Starting Point)');
    rebuildBeaconPathVisuals(pts, earthRenderRadiusRef.current);
    _setS({ beaconPathCleared: false, pathFollowMode: true });
  };

  const handleClearBeaconPath = () => {
    setBeaconPathWaypoints([]);
    beaconPathWaypointsRef.current = [];
    pathMotionActiveRef.current = false;
    setPathMotionActive(false);
    setPathFollowMode(false);
    pathFollowModeRef.current = false;
    setPathOverallProgressPct(0);
    setPathStatusText('Path Cleared (Static Mode)');
    rebuildBeaconPathVisuals([], earthRenderRadiusRef.current);
    _setS({ beaconPathCleared: true, pathFollowMode: false });
  };

  const handleToggleDrawMode = () => {
    setIsDrawingPath((prev) => {
      const next = !prev;
      isDrawingPathRef.current = next;
      satellitePovSync.update({ isDrawingPath: next });
      return next;
    });
  };

  const handleAddWaypoint = (localPos: THREE.Vector3, latDeg: number, lonDeg: number) => {
    setBeaconPathWaypoints((prev) => {
      const nextId = prev.length + 1;
      const label = nextId === 1 ? '1 (START)' : `Pt ${nextId}`;
      const newWp: BeaconPathWaypoint = {
        id: nextId,
        label,
        localPos,
        latDeg,
        lonDeg,
      };
      const nextList = [...prev, newWp];
      beaconPathWaypointsRef.current = nextList;
      if (nextList.length === 1) {
        pathCurrentLocalPosRef.current.copy(localPos);
        pathLegIndexRef.current = 0;
        pathLegProgressRef.current = 0.0;
        setPathStatusText('Pt 1 (Starting Point) Placed');
      }
      rebuildBeaconPathVisuals(nextList, earthRenderRadiusRef.current);
      _setS({ beaconPathCleared: false });
      return nextList;
    });
  };

  const handleRemoveWaypoint = useCallback((indexToRemove: number) => {
    setBeaconPathWaypoints((prev) => {
      if (indexToRemove < 0 || indexToRemove >= prev.length) return prev;
      const rawList = prev.filter((_, i) => i !== indexToRemove);
      const nextList: BeaconPathWaypoint[] = rawList.map((wp, idx) => ({
        ...wp,
        id: idx + 1,
        label: idx === 0 ? '1 (START)' : `Pt ${idx + 1}`,
      }));
      beaconPathWaypointsRef.current = nextList;

      if (nextList.length === 0) {
        pathMotionActiveRef.current = false;
        setPathMotionActive(false);
        setPathFollowMode(false);
        pathFollowModeRef.current = false;
        pathLegIndexRef.current = 0;
        pathLegProgressRef.current = 0.0;
        setPathOverallProgressPct(0);
        setPathCurrentLegDisplay('None');
        setPathStatusText('Path Cleared (Static Mode)');
        rebuildBeaconPathVisuals([], earthRenderRadiusRef.current);
        _setS({ beaconPathCleared: true, pathFollowMode: false });
      } else if (nextList.length === 1) {
        pathMotionActiveRef.current = false;
        setPathMotionActive(false);
        setPathFollowMode(false);
        pathFollowModeRef.current = false;
        pathLegIndexRef.current = 0;
        pathLegProgressRef.current = 0.0;
        setPathOverallProgressPct(0);
        setPathCurrentLegDisplay('Pt 1 (Static)');
        pathCurrentLocalPosRef.current.copy(nextList[0].localPos);
        setPathStatusText('Pt 1 (Starting Point) Placed');
        rebuildBeaconPathVisuals(nextList, earthRenderRadiusRef.current);
        _setS({ beaconPathCleared: false, pathFollowMode: false });
      } else {
        const maxLegIdx = nextList.length - 2;
        if (pathLegIndexRef.current > maxLegIdx) {
          pathLegIndexRef.current = maxLegIdx;
          pathLegProgressRef.current = 0.0;
          pathCurrentLocalPosRef.current.copy(nextList[maxLegIdx].localPos);
        }
        const overallPct = Math.round(
          ((pathLegIndexRef.current + Math.min(1.0, pathLegProgressRef.current)) / (nextList.length - 1)) * 100
        );
        setPathOverallProgressPct(overallPct);
        setPathCurrentLegDisplay(`Leg ${pathLegIndexRef.current + 1}→${pathLegIndexRef.current + 2}`);
        setPathStatusText(`Undone Pt ${indexToRemove + 1} (${nextList.length} pts remaining)`);
        rebuildBeaconPathVisuals(nextList, earthRenderRadiusRef.current);
        _setS({ beaconPathCleared: false });
      }
      return nextList;
    });
  }, [earthRenderRadiusRef, _setS]);

  const handleUndoLastWaypoint = useCallback(() => {
    if (beaconPathWaypointsRef.current.length > 0) {
      handleRemoveWaypoint(beaconPathWaypointsRef.current.length - 1);
    }
  }, [handleRemoveWaypoint]);

  // Instant Location Reorientation Handlers - NEVER lock or restrict the interface!
  const handleLocateSatellite = useCallback(() => {
    const satPos = latestSatPosRef.current;
    const len = satPos.length();
    if (len > 0.001) {
      const phi = Math.asin(Math.max(-0.95, Math.min(0.95, satPos.y / len)));
      const theta = Math.atan2(satPos.x, satPos.z);
      orbitStateRef.current.theta = theta;
      orbitStateRef.current.phi = phi;
      orbitStateRef.current.radius = Math.max(160.0, Math.min(260.0, orbitStateRef.current.radius));
    }
  }, []);

  const handleLocateBeacon = useCallback(() => {
    const bPos = tgtPosRef.current;
    const len = bPos.length();
    if (len > 0.001) {
      const phi = Math.asin(Math.max(-0.95, Math.min(0.95, bPos.y / len)));
      const theta = Math.atan2(bPos.x, bPos.z);
      orbitStateRef.current.theta = theta;
      orbitStateRef.current.phi = phi;
      orbitStateRef.current.radius = Math.max(150.0, Math.min(240.0, orbitStateRef.current.radius));
    }
  }, []);

  // Listen for global "fsoc:locate-satellite" and "fsoc:locate-beacon" events
  useEffect(() => {
    const onLocateSat = () => handleLocateSatellite();
    const onLocateBeacon = () => handleLocateBeacon();
    const onStopAll = () => {
      activeOrbitRef.current.autoRevolve = false;
      beaconMotionRef.current.isRevolving = false;
      earthSpinRef.current.enabled = false;
    };
    const onStartAll = () => {
      activeOrbitRef.current.autoRevolve = true;
      beaconMotionRef.current.isRevolving = true;
      earthSpinRef.current.enabled = true;
    };

    const onResetSim = () => {
      for (const k in persistentSceneState) {
        delete (persistentSceneState as any)[k];
      }
    };

    window.addEventListener('fsoc:locate-satellite', onLocateSat);
    window.addEventListener('fsoc:jump-to-sat', onLocateSat);
    window.addEventListener('fsoc:locate-beacon', onLocateBeacon);
    window.addEventListener('fsoc:stop-all-processes', onStopAll);
    window.addEventListener('fsoc:start-all-processes', onStartAll);
    window.addEventListener('fsoc:reset-sim', onResetSim);

    return () => {
      window.removeEventListener('fsoc:locate-satellite', onLocateSat);
      window.removeEventListener('fsoc:jump-to-sat', onLocateSat);
      window.removeEventListener('fsoc:locate-beacon', onLocateBeacon);
      window.removeEventListener('fsoc:stop-all-processes', onStopAll);
      window.removeEventListener('fsoc:start-all-processes', onStartAll);
      window.removeEventListener('fsoc:reset-sim', onResetSim);
    };
  }, [handleLocateSatellite, handleLocateBeacon]);

  // Global Keyboard Shortcut: Ctrl+Z (undo waypoint), S/F (instant satellite focus), Esc (return to Earth)
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

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (beaconPathWaypointsRef.current.length > 0) {
          e.preventDefault();
          handleUndoLastWaypoint();
        }
      }

      // Quick shortcut to jump to satellite view: S or F key
      if ((e.key === 's' || e.key === 'S' || e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handleLocateSatellite();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleUndoLastWaypoint, handleLocateSatellite]);

  const handleCenterTargetOnGlobe = () => {
    setAutoLOS(true);
    autoLOSRef.current = true;
    satellitePovSync.update({ autoLOS: true });
  };

  const handleDisplaceTargetOutsideFov = () => {
    setAutoLOS(false);
    autoLOSRef.current = false;
    satellitePovSync.update({ autoLOS: false });
  };

  // Interactive Orbit Controller State
  const [selectedPresetId, setSelectedPresetId] = [_ss.selectedPresetId, _bindS('selectedPresetId')];
  const selectedPresetIdRef = useRef<string>(_ss.selectedPresetId);
  selectedPresetIdRef.current = selectedPresetId;
  const [selectedMarkerType, setSelectedMarkerType] = useState<'sat' | 'beacon' | 'peer' | null>('sat');
  const selectedMarkerTypeRef = useRef<'sat' | 'beacon' | 'peer' | null>(selectedMarkerType);
  selectedMarkerTypeRef.current = selectedMarkerType;
  // Render scale mode (Rule 2 & 4: default TRUE_SCALE)
  const [scaleMode, setScaleMode] = [_ss.scaleMode, _bindS('scaleMode')];
  const scaleModeRef = useRef<RenderScaleMode>(_ss.scaleMode);
  scaleModeRef.current = scaleMode;

  // Standard Keplerian elements (Rule 1 & 4)
  const [orbitPerigeeKm, setOrbitPerigeeKm] = useState<number>(550.0);
  const [orbitApogeeKm, setOrbitApogeeKm] = useState<number>(550.0);
  const [orbitAltitudeKm, setOrbitAltitudeKm] = useState<number>(550.0);
  const [orbitRadius, setOrbitRadius] = useState<number>(getRenderOrbitRadius(550.0, _ss.scaleMode));
  const [orbitInc, setOrbitInc] = useState<number>(53.0);
  const [orbitRaan, setOrbitRaan] = useState<number>(35.0);
  const [orbitArgPerigeeDeg, setOrbitArgPerigeeDeg] = useState<number>(0.0);
  const [orbitAnomalyDeg, setOrbitAnomalyDeg] = useState<number>(48.7);
  const [autoRevolve, setAutoRevolve] = [_ss.autoRevolve, _bindS('autoRevolve')];
  const [revolveSpeed, setRevolveSpeed] = useState<number>(0.003);
  const [showOrbitTuner, setShowOrbitTuner] = [_ss.showOrbitTuner, _bindS('showOrbitTuner')];
  const [currentSlantRange, setCurrentSlantRange] = useState<number>(8.62);
  const [currentSlantRangeKm, setCurrentSlantRangeKm] = useState<number>(550.0);
  const [isOccludedByEarth, setIsOccludedByEarth] = useState<boolean>(false);

  // Live derived values: a, e, current r, current speed, and orbital period for 1 revolution
  const [derivedA, setDerivedA] = useState<number>(6928.0);
  const [derivedE, setDerivedE] = useState<number>(0.0);
  const [derivedR, setDerivedR] = useState<number>(6928.0);
  const [derivedSpeed, setDerivedSpeed] = useState<number>(7.585);
  const [derivedPeriodSec, setDerivedPeriodSec] = useState<number>(5727.4);

  // Physical Simulation Time Warp (Default 60×: 1 real second = 1 sim minute)
  // Preserves exact Keplerian periods: 550 km orbit completes in 95.5s at 60×, 95.5m at 1× real-time
  const [simTimeWarp, setSimTimeWarp] = [_ss.simTimeWarp, _bindS('simTimeWarp')];
  const simTimeWarpRef = useRef<number>(_ss.simTimeWarp);
  simTimeWarpRef.current = simTimeWarp;

  // Toggle for the Real Orbital Speeds & Periods Reference Table modal
  const [showSpecsTable, setShowSpecsTable] = useState<boolean>(false);

  // Peer constellation nodes and rings refs (Keplerian mean motion & period)
  const peerNodesRef = useRef<{
    mesh: THREE.Sprite | THREE.Mesh;
    ring: THREE.Line;
    preset: OrbitPreset;
    incDeg: number;
    raanDeg: number;
    speed: number;
    meanMotionRadS: number;
    periodSec: number;
    anomaly: number;
  }[]>([]);

  // Auto LOS alignment state (synchronized with satellitePovSync and FPACameraViewport)
  const [autoLOS, setAutoLOS] = [_ss.autoLOS ?? false, _bindS('autoLOS')];
  const autoLOSRef = useRef<boolean>(_ss.autoLOS ?? false);
  autoLOSRef.current = autoLOS;

  // Gradual slew state: current 3D optical boresight direction & angular off-axis error
  const boresightDirRef = useRef<THREE.Vector3 | null>(null);
  const slewProgressRef = useRef<number>(satellitePovSync.getData().slewProgress ?? (_ss.autoLOS ? 1.0 : 0));
  const [slewAngularError, setSlewAngularError] = useState<number>(0);

  const cameraPropRef = useRef(camera);
  cameraPropRef.current = camera;
  const disturbancePropRef = useRef(disturbance);
  disturbancePropRef.current = disturbance;

  // Sync autoLOS, beaconSpeedKmh, isDrawingPath, and pathFollowMode state from satellitePovSync
  useEffect(() => {
    const unsub = satellitePovSync.subscribe((data) => {
      if (data.autoLOS !== undefined && data.autoLOS !== autoLOSRef.current) {
        setAutoLOS(data.autoLOS);
        autoLOSRef.current = data.autoLOS;
      }
      if (data.beaconSpeedKmh !== undefined && data.beaconSpeedKmh !== beaconMotionRef.current.speedKmh) {
        setBeaconSpeedKmh(data.beaconSpeedKmh);
        beaconMotionRef.current.speedKmh = data.beaconSpeedKmh;
        setBeaconRevolving(data.beaconSpeedKmh > 0);
      }
      if (data.isDrawingPath !== undefined && data.isDrawingPath !== isDrawingPathRef.current) {
        setIsDrawingPath(data.isDrawingPath);
        isDrawingPathRef.current = data.isDrawingPath;
      }
      if (data.pathFollowMode !== undefined && data.pathFollowMode !== pathFollowModeRef.current) {
        setPathFollowMode(data.pathFollowMode);
        pathFollowModeRef.current = data.pathFollowMode;
      }
    });
    return unsub;
  }, [setPathFollowMode, setAutoLOS]);

  useEffect(() => {
    pathFollowModeRef.current = pathFollowMode;
    if (beaconPathSolidLineRef.current) beaconPathSolidLineRef.current.visible = pathFollowMode;
    if (beaconPathDashedLineRef.current) beaconPathDashedLineRef.current.visible = pathFollowMode;
    if (beaconPathMarkersGroupRef.current) beaconPathMarkersGroupRef.current.visible = pathFollowMode;
    if (beaconTrackRingRef.current) beaconTrackRingRef.current.visible = !pathFollowMode;
  }, [pathFollowMode]);

  const handleToggleAutoLOS = () => {
    const next = !autoLOS;
    setAutoLOS(next);
    autoLOSRef.current = next;
    satellitePovSync.update({ autoLOS: next });
  };

  // Earth Diurnal Rotation State (Real physical spin: 15°/hour around polar Y-axis)
  const [earthSpinEnabled, setEarthSpinEnabled] = [_ss.earthSpinEnabled, _bindS('earthSpinEnabled')];
  const [earthSpinMultiplier, setEarthSpinMultiplier] = [_ss.earthSpinMultiplier, _bindS('earthSpinMultiplier')];

  const earthSpinRef = useRef({
    enabled: true,
    multiplier: 1,
  });

  useEffect(() => {
    earthSpinRef.current.enabled = earthSpinEnabled;
    earthSpinRef.current.multiplier = earthSpinMultiplier;
  }, [earthSpinEnabled, earthSpinMultiplier]);

  // Active Orbit State Ref for 60fps render loop access
  const activeOrbitRef = useRef({
    perigeeAltKm: 550.0,
    apogeeAltKm: 550.0,
    semiMajorAxisKm: 6928.0,
    eccentricity: 0.0,
    incDeg: 53.0,
    raanDeg: 35.0,
    argPerigeeDeg: 0.0,
    meanAnomaly: satellitePovSync.getData().meanAnomaly ?? persistentSceneState.satelliteMeanAnomaly ?? THREE.MathUtils.degToRad(48.7),
    trueAnomaly: satellitePovSync.getData().anomaly ?? persistentSceneState.satelliteTrueAnomaly ?? THREE.MathUtils.degToRad(48.7),
    anomaly: satellitePovSync.getData().anomaly ?? persistentSceneState.satelliteAnomaly ?? THREE.MathUtils.degToRad(48.7),
    radius: satellitePovSync.getData().orbitRadius ?? persistentSceneState.satelliteRadius ?? getRenderOrbitRadius(550.0, 'TRUE_SCALE'),
    currentRadiusKm: satellitePovSync.getData().currentRadiusKm ?? 6928.0,
    currentSpeedKmS: satellitePovSync.getData().speedKmS ?? persistentSceneState.satelliteSpeedKmS ?? 7.585,
    altitudeKm: satellitePovSync.getData().altitudeKm ?? persistentSceneState.satelliteAltKm ?? 550.0,
    autoRevolve: true,
    speed: 0.003,
  });

  // Keep ref synchronized with state
  useEffect(() => {
    const rp = EARTH_RADIUS_KM + orbitPerigeeKm;
    const ra = EARTH_RADIUS_KM + orbitApogeeKm;
    const a = (rp + ra) / 2.0;
    const e = (ra - rp) / (ra + rp);

    activeOrbitRef.current.perigeeAltKm = orbitPerigeeKm;
    activeOrbitRef.current.apogeeAltKm = orbitApogeeKm;
    activeOrbitRef.current.semiMajorAxisKm = a;
    activeOrbitRef.current.eccentricity = e;
    activeOrbitRef.current.incDeg = orbitInc;
    activeOrbitRef.current.raanDeg = orbitRaan;
    activeOrbitRef.current.argPerigeeDeg = orbitArgPerigeeDeg;
    activeOrbitRef.current.autoRevolve = autoRevolve;
    activeOrbitRef.current.speed = revolveSpeed;

    orbitalEngine.setOrbit({
      perigeeAltKm: orbitPerigeeKm,
      apogeeAltKm: orbitApogeeKm,
      incDeg: orbitInc,
      raanDeg: orbitRaan,
      argPerigeeDeg: orbitArgPerigeeDeg,
    });
  }, [orbitPerigeeKm, orbitApogeeKm, orbitInc, orbitRaan, orbitArgPerigeeDeg, autoRevolve, revolveSpeed]);

  useEffect(() => {
    orbitalEngine.setAutoRevolve(autoRevolve);
  }, [autoRevolve]);

  useEffect(() => {
    orbitalEngine.setTimeWarp(simTimeWarp);
  }, [simTimeWarp]);

  useEffect(() => {
    orbitalEngine.setEarthSpin(earthSpinEnabled, earthSpinMultiplier);
  }, [earthSpinEnabled, earthSpinMultiplier]);

  useEffect(() => {
    orbitalEngine.setScaleMode(scaleMode);
  }, [scaleMode]);

  useEffect(() => {
    orbitalEngine.setManualGimbal(camera?.pan_deg ?? 0, camera?.tilt_deg ?? 0);
  }, [camera?.pan_deg, camera?.tilt_deg]);

  useEffect(() => {
    orbitalEngine.setDisturbance(disturbance ?? null);
  }, [disturbance]);

  useEffect(() => {
    orbitalEngine.setBeaconMotion({
      speedKmh: beaconSpeedKmh,
      incDeg: beaconInc,
      raanDeg: beaconRaan,
    });
  }, [beaconSpeedKmh, beaconInc, beaconRaan]);

  useEffect(() => {
    orbitalEngine.setAutoLOS(autoLOS);
  }, [autoLOS]);

  useEffect(() => {
    orbitalEngine.setPathWaypoints(beaconPathWaypoints);
  }, [beaconPathWaypoints]);

  useEffect(() => {
    orbitalEngine.setPathFollowMode(pathFollowMode);
  }, [pathFollowMode]);

  useEffect(() => {
    orbitalEngine.setPathMotionActive(pathMotionActive);
  }, [pathMotionActive]);

  useEffect(() => {
    orbitalEngine.setIsDrawingPath(isDrawingPath);
  }, [isDrawingPath]);

  // Orbit camera drag state
  const isDraggingRef = useRef(false);
  const previousMousePositionRef = useRef({ x: 0, y: 0 });
  const orbitStateRef = useRef({
    theta: persistentSceneState.cameraTheta ?? 0.75,
    phi: persistentSceneState.cameraPhi ?? 0.45,
    radius: persistentSceneState.cameraRadius ?? 340.0,
  });

  // Function to recompute active orbit ring line geometry (true Keplerian ellipse)
  const updateActiveOrbitRingGeometry = (
    perigeeKm: number,
    apogeeKm: number,
    incDeg: number,
    raanDeg: number,
    argPerigeeDeg: number = 0,
    mode: RenderScaleMode = scaleModeRef.current
  ) => {
    if (!activeOrbitRingRef.current) return;
    const rp = EARTH_RADIUS_KM + perigeeKm;
    const ra = EARTH_RADIUS_KM + apogeeKm;
    const a = (rp + ra) / 2.0;
    const e = (ra - rp) / (ra + rp);
    const segments = 180;
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j <= segments; j++) {
      const nu = (j / segments) * Math.PI * 2;
      const rPhys = e < 1e-8 ? a : (a * (1 - e * e)) / (1 + e * Math.cos(nu));
      const altKm = rPhys - EARTH_RADIUS_KM;
      const rRender = getRenderOrbitRadius(altKm, mode, READABLE_K, earthRenderRadiusRef.current);
      pts.push(computeOrbitPoint(rRender, incDeg, raanDeg, nu, argPerigeeDeg));
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

  // Function to recompute concentric atmosphere shells and Kármán line geometry when scale changes
  const updateAtmosphereShellGeometry = (mode: RenderScaleMode, earthR: number = earthRenderRadiusRef.current) => {
    const r20 = getRenderOrbitRadius(20.0, mode, READABLE_K, earthR);
    const r100 = getRenderOrbitRadius(100.0, mode, READABLE_K, earthR);
    const safeR20 = Math.max(earthR * 1.008, r20);
    const safeR100 = Math.max(earthR * 1.018, r100);

    if (turbulenceShellRef.current) {
      turbulenceShellRef.current.geometry.dispose();
      turbulenceShellRef.current.geometry = new THREE.SphereGeometry(safeR20, 96, 64);
    }

    if (thinAtmoShellRef.current) {
      thinAtmoShellRef.current.geometry.dispose();
      thinAtmoShellRef.current.geometry = new THREE.SphereGeometry(safeR100, 96, 64);
    }

    if (karmanRingRef.current) {
      const karmanSegments = 128;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= karmanSegments; j++) {
        const theta = (j / karmanSegments) * Math.PI * 2;
        pts.push(new THREE.Vector3(r100 * Math.cos(theta), 0, r100 * Math.sin(theta)));
      }
      karmanRingRef.current.geometry.setFromPoints(pts);
      karmanRingRef.current.geometry.attributes.position.needsUpdate = true;
      karmanRingRef.current.computeLineDistances();
    }

    if (turbulenceLabelRef.current) {
      turbulenceLabelRef.current.position.set(r20 * 0.72, r20 * 0.45, r20 * 0.52);
      updateSpriteText(turbulenceLabelRef.current, 'Turbulence Zone', `0–${formatAltAndUnits(20, mode, READABLE_K, earthR)}`, '#FF5F40', 'rgba(255, 95, 64, 0.6)');
    }
    if (thinAtmoLabelRef.current) {
      thinAtmoLabelRef.current.position.set(-r100 * 0.45, r100 * 0.85, r100 * 0.28);
      updateSpriteText(thinAtmoLabelRef.current, 'Thin Atmosphere', `20–${formatAltAndUnits(100, mode, READABLE_K, earthR)}`, '#9CA195', 'rgba(156, 161, 149, 0.6)');
    }
    if (karmanLabelRef.current) {
      karmanLabelRef.current.position.set(r100 * Math.cos(0.35), 2.5, r100 * Math.sin(0.35));
      updateSpriteText(karmanLabelRef.current, 'Kármán Line — Edge of Space', formatAltAndUnits(100, mode, READABLE_K, earthR), '#F0FFEA', 'rgba(240, 255, 234, 0.6)');
    }
  };

  // Function to recompute standard reference altitude rings (100km, 2000km, 20200km, 35786km) when scale changes
  const updateReferenceRingsGeometry = (mode: RenderScaleMode, earthR: number = earthRenderRadiusRef.current) => {
    refRingMeshesRef.current.forEach(({ spec, ring, label }) => {
      const r = getRenderOrbitRadius(spec.altKm, mode, READABLE_K, earthR);
      const segments = 180;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= segments; j++) {
        const theta = (j / segments) * Math.PI * 2;
        pts.push(new THREE.Vector3(r * Math.cos(theta), 0, r * Math.sin(theta)));
      }
      ring.geometry.setFromPoints(pts);
      ring.geometry.attributes.position.needsUpdate = true;
      ring.computeLineDistances();

      label.position.set(r * Math.cos(spec.labelAngle), 2.5, r * Math.sin(spec.labelAngle));
      const tag = formatAltAndUnits(spec.altKm, mode, READABLE_K, earthR);
      updateSpriteText(label, spec.name, tag, spec.cssColor, spec.strokeRgba);
    });
  };

  // Recompute orbit ring geometries and node radii when scale mode changes
  const updateConstellationScale = (newMode: RenderScaleMode, currentEarthR: number = earthRenderRadiusRef.current) => {
    // 1. Update active orbit radius
    updateActiveOrbitRingGeometry(
      activeOrbitRef.current.perigeeAltKm,
      activeOrbitRef.current.apogeeAltKm,
      activeOrbitRef.current.incDeg,
      activeOrbitRef.current.raanDeg,
      activeOrbitRef.current.argPerigeeDeg,
      newMode
    );

    // 2. Update peer constellation rings
    peerNodesRef.current.forEach((node) => {
      const rp = EARTH_RADIUS_KM + node.preset.perigeeAltKm;
      const ra = EARTH_RADIUS_KM + node.preset.apogeeAltKm;
      const a = (rp + ra) / 2.0;
      const e = (ra - rp) / (ra + rp);
      const segments = 120;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= segments; j++) {
        const nu = (j / segments) * Math.PI * 2;
        const rPhys = e < 1e-8 ? a : (a * (1 - e * e)) / (1 + e * Math.cos(nu));
        const altKm = rPhys - EARTH_RADIUS_KM;
        const peerRadius = getRenderOrbitRadius(altKm, newMode, READABLE_K, currentEarthR);
        pts.push(computeOrbitPoint(peerRadius, node.incDeg, node.raanDeg, nu, node.preset.argPerigeeDeg ?? 0));
      }
      node.ring.geometry.setFromPoints(pts);
      node.ring.geometry.attributes.position.needsUpdate = true;
      node.ring.computeLineDistances();
    });

    // 3. Update concentric atmospheric shells (0-20km, 20-100km, 100km Kármán line)
    updateAtmosphereShellGeometry(newMode, currentEarthR);

    // 4. Update standard reference altitude rings (100km, 2000km, 20200km, 35786km - Task 2)
    updateReferenceRingsGeometry(newMode, currentEarthR);
  };

  const handleScaleModeChange = (mode: RenderScaleMode) => {
    setScaleMode(mode);
    scaleModeRef.current = mode;
    updateConstellationScale(mode, earthRenderRadiusRef.current);
  };

  // Function to recompute sun direction arrow, label, terminator ring, and night shading when Earth radius changes
  const updateSunTerminatorGeometry = (earthR: number = earthRenderRadiusRef.current) => {
    if (terminatorRingRef.current) {
      const termPts = computeTerminatorCirclePoints(FIXED_SUN_DIR, earthR + 0.20, 180);
      terminatorRingRef.current.geometry.setFromPoints(termPts);
      terminatorRingRef.current.geometry.attributes.position.needsUpdate = true;
      terminatorRingRef.current.computeLineDistances();
    }
    if (terminatorLabelRef.current) {
      const upCand = Math.abs(FIXED_SUN_DIR.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const uTerm = new THREE.Vector3().crossVectors(FIXED_SUN_DIR, upCand).normalize();
      const vTerm = new THREE.Vector3().crossVectors(FIXED_SUN_DIR, uTerm).normalize();
      const termLabelPos = new THREE.Vector3()
        .addScaledVector(uTerm, (earthR + 2.5) * Math.cos(0.4))
        .addScaledVector(vTerm, (earthR + 2.5) * Math.sin(0.4));
      terminatorLabelRef.current.position.copy(termLabelPos);
    }
    if (sunArrowRef.current) {
      const arrowOrigin = FIXED_SUN_DIR.clone().multiplyScalar(earthR + 3.0);
      sunArrowRef.current.position.copy(arrowOrigin);
    }
    if (sunLabelRef.current) {
      sunLabelRef.current.position.copy(FIXED_SUN_DIR.clone().multiplyScalar(earthR + 48.0));
    }
    if (realisticEarthAssemblyRef.current) {
      realisticEarthAssemblyRef.current.updateSunDir(FIXED_SUN_DIR);
    }
  };

  const handleEarthRenderRadiusChange = (newRadius: number) => {
    setEarthRenderRadius(newRadius);
    earthRenderRadiusRef.current = newRadius;
    if (realisticEarthAssemblyRef.current) {
      realisticEarthAssemblyRef.current.updateRadius(newRadius);
    } else if (globeMeshRef.current) {
      const s = newRadius / 100.0;
      globeMeshRef.current.scale.set(s, s, s);
    }
    updateConstellationScale(scaleMode, newRadius);
    updateSunTerminatorGeometry(newRadius);
    updateBeaconTrackGeometry(beaconInc, beaconRaan);
    // Scale beacon path waypoints to match new globe radius
    const scaledWps = beaconPathWaypointsRef.current.map((wp) => ({
      ...wp,
      localPos: wp.localPos.clone().normalize().multiplyScalar(newRadius),
    }));
    setBeaconPathWaypoints(scaledWps);
    beaconPathWaypointsRef.current = scaledWps;
    rebuildBeaconPathVisuals(scaledWps, newRadius);
  };

  // Preset Selection Handler (Instant re-initialization with full element set)
  const handlePresetSelect = (presetId: string) => {
    setSelectedPresetId(presetId);
    const p = ORBIT_PRESETS.find((item) => item.id === presetId);
    if (p) {
      const perigee = p.perigeeAltKm;
      const apogee = p.apogeeAltKm;
      const inc = p.incDeg;
      const raan = p.raanDeg;
      const argPerigee = p.argPerigeeDeg ?? 0;
      const rp = EARTH_RADIUS_KM + perigee;
      const ra = EARTH_RADIUS_KM + apogee;
      const a = (rp + ra) / 2.0;
      const e = (ra - rp) / (ra + rp);

      setOrbitPerigeeKm(perigee);
      setOrbitApogeeKm(apogee);
      setOrbitAltitudeKm((perigee + apogee) / 2);
      setOrbitInc(inc);
      setOrbitRaan(raan);
      setOrbitArgPerigeeDeg(argPerigee);
      setOrbitAnomalyDeg(0);

      setDerivedA(a);
      setDerivedE(e);
      setDerivedR(rp);
      // Vis-viva at perigee: v = sqrt(GM * (2/rp - 1/a))
      const vPerigee = Math.sqrt(Math.max(0, GM_EARTH_KM3_S2 * (2.0 / rp - 1.0 / a)));
      setDerivedSpeed(vPerigee);
      setDerivedPeriodSec(computeOrbitalPeriodSec(a));

      // Instant re-initialization with full Keplerian element set
      activeOrbitRef.current.perigeeAltKm = perigee;
      activeOrbitRef.current.apogeeAltKm = apogee;
      activeOrbitRef.current.semiMajorAxisKm = a;
      activeOrbitRef.current.eccentricity = e;
      activeOrbitRef.current.incDeg = inc;
      activeOrbitRef.current.raanDeg = raan;
      activeOrbitRef.current.argPerigeeDeg = argPerigee;
      activeOrbitRef.current.meanAnomaly = 0;
      activeOrbitRef.current.trueAnomaly = 0;
      activeOrbitRef.current.currentRadiusKm = rp;
      activeOrbitRef.current.currentSpeedKmS = vPerigee;
      activeOrbitRef.current.altitudeKm = (perigee + apogee) / 2;

      orbitalEngine.setOrbit({
        perigeeAltKm: perigee,
        apogeeAltKm: apogee,
        incDeg: inc,
        raanDeg: raan,
        argPerigeeDeg: argPerigee,
        meanAnomaly: 0,
      });

      updateActiveOrbitRingGeometry(perigee, apogee, inc, raan, argPerigee, scaleMode);

      // In TRUE_SCALE, if selecting GEO or GTO (apogee 35,786 km), zoom camera out to frame it (only when in Earth overview)
      if (focusModeRef.current === 'earth') {
        if (scaleMode === 'TRUE_SCALE' && apogee > 30000) {
          if (orbitStateRef.current.radius < 900) {
            orbitStateRef.current.radius = 1100.0;
          }
        } else if (apogee <= 2000 && orbitStateRef.current.radius > 700) {
          orbitStateRef.current.radius = 340.0;
        }
      }
    }
  };

  // Custom Orbit Slider Handler (Full Keplerian parameters)
  const handleCustomParamChange = (
    perigee: number,
    apogee: number,
    inc: number,
    raan: number,
    argPerigee: number,
    startNuDeg?: number
  ) => {
    setSelectedPresetId('custom');
    const validPerigee = Math.max(0, perigee);
    const validApogee = Math.max(validPerigee, apogee);
    const rp = EARTH_RADIUS_KM + validPerigee;
    const ra = EARTH_RADIUS_KM + validApogee;
    const a = (rp + ra) / 2.0;
    const e = (ra - rp) / (ra + rp);

    setOrbitPerigeeKm(validPerigee);
    setOrbitApogeeKm(validApogee);
    setOrbitAltitudeKm((validPerigee + validApogee) / 2);
    setOrbitInc(inc);
    setOrbitRaan(raan);
    setOrbitArgPerigeeDeg(argPerigee);

    setDerivedA(a);
    setDerivedE(e);
    setDerivedPeriodSec(computeOrbitalPeriodSec(a));

    if (startNuDeg !== undefined) {
      setOrbitAnomalyDeg(startNuDeg);
      const nuRad = THREE.MathUtils.degToRad(startNuDeg);
      const E = trueToEccentricAnomaly(nuRad, e);
      let M = E - e * Math.sin(E);
      if (M < 0) M += 2 * Math.PI;
      activeOrbitRef.current.meanAnomaly = M;
      activeOrbitRef.current.trueAnomaly = nuRad;

      const rPhys = e < 1e-8 ? a : a * (1 - e * Math.cos(E));
      const v = Math.sqrt(Math.max(0, GM_EARTH_KM3_S2 * (2.0 / rPhys - 1.0 / a)));
      setDerivedR(rPhys);
      setDerivedSpeed(v);
      activeOrbitRef.current.currentRadiusKm = rPhys;
      activeOrbitRef.current.currentSpeedKmS = v;
    }

    activeOrbitRef.current.perigeeAltKm = validPerigee;
    activeOrbitRef.current.apogeeAltKm = validApogee;
    activeOrbitRef.current.semiMajorAxisKm = a;
    activeOrbitRef.current.eccentricity = e;
    activeOrbitRef.current.incDeg = inc;
    activeOrbitRef.current.raanDeg = raan;
    activeOrbitRef.current.argPerigeeDeg = argPerigee;
    activeOrbitRef.current.altitudeKm = (validPerigee + validApogee) / 2;

    orbitalEngine.setOrbit({
      perigeeAltKm: validPerigee,
      apogeeAltKm: validApogee,
      incDeg: inc,
      raanDeg: raan,
      argPerigeeDeg: argPerigee,
      trueAnomaly: startNuDeg !== undefined ? THREE.MathUtils.degToRad(startNuDeg) : undefined,
    });

    updateActiveOrbitRingGeometry(validPerigee, validApogee, inc, raan, argPerigee, scaleMode);
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
    scene.background = new THREE.Color(0x06080b);
    sceneRef.current = scene;

    // 2. Perspective Camera
    const perspCamera = new THREE.PerspectiveCamera(45, width / height, 1, 3000);
    cameraRef.current = perspCamera;

    // 3. WebGL Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    rendererRef.current = renderer;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 4. Lighting & Solar Direction Vector (Task 1)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambientLight);
    const sunLight = new THREE.DirectionalLight(0xfffaed, 1.35);
    sunLight.position.copy(FIXED_SUN_DIR.clone().multiplyScalar(600));
    scene.add(sunLight);

    // 5. INJECT PHOTOREALISTIC 3D NASA EARTH AT SCENE ORIGIN (0, 0, 0)
    const earthAssembly = createRealisticEarthAssembly(globeRadius, FIXED_SUN_DIR);
    realisticEarthAssemblyRef.current = earthAssembly;
    const globeMesh = earthAssembly.globeMesh;
    globeMesh.position.set(0, 0, 0);
    const initialEarthRot = satellitePovSync.getData().earthRotationY ?? persistentSceneState.earthRotationY;
    if (initialEarthRot !== undefined) {
      globeMesh.rotation.y = initialEarthRot;
      if (earthAssembly.cloudMesh) {
        earthAssembly.cloudMesh.rotation.y = initialEarthRot * 1.05;
      }
    }
    globeMesh.renderOrder = 0;
    scene.add(globeMesh);
    globeMeshRef.current = globeMesh;
    cloudMeshRef.current = earthAssembly.cloudMesh;

    // 5a. NIGHT-SIDE HEMISPHERE SHADING & CITY LIGHTS OVERLAY (Task 3)
    // Seamlessly integrated directly into realistic Earth globe material without concentric faceting
    const nightMesh = earthAssembly.nightMesh;
    nightMesh.visible = false;
    scene.add(nightMesh);
    nightShadingMeshRef.current = nightMesh;

    // 5b. CONCENTRIC ATMOSPHERIC SHELLS & KÁRMÁN LINE (Matching Physics Layer 0-20km Turbulence)
    // Sizing dynamically reuses getRenderOrbitRadius(altKm, scaleMode) with safe clearance to prevent geometric penetration
    const atmoGroup = new THREE.Group();
    atmoGroup.name = 'atmosphereGroup';
    atmoGroup.visible = showAtmosphereShells;
    atmosphereGroupRef.current = atmoGroup;

    const r20 = getRenderOrbitRadius(20.0, scaleModeRef.current);
    const r100 = getRenderOrbitRadius(100.0, scaleModeRef.current);
    const safeR20 = Math.max(globeRadius * 1.008, r20);
    const safeR100 = Math.max(globeRadius * 1.018, r100);

    // 1. Shaded Turbulence Zone Shell (0-20 km)
    // High tessellation 96x64 + AdditiveBlending ensures zero polygon facets or darkening artifacts
    const turbGeo = new THREE.SphereGeometry(safeR20, 96, 64);
    const turbMat = new THREE.MeshBasicMaterial({
      color: 0x262824,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });
    const turbMesh = new THREE.Mesh(turbGeo, turbMat);
    turbMesh.name = 'turbulenceZoneShell';
    turbMesh.renderOrder = 2;
    atmoGroup.add(turbMesh);
    turbulenceShellRef.current = turbMesh;

    // 2. Faint/Thin Atmosphere Shell (20-100 km)
    const thinGeo = new THREE.SphereGeometry(safeR100, 96, 64);
    const thinMat = new THREE.MeshBasicMaterial({
      color: 0x1B1D1A,
      transparent: true,
      opacity: 0.045,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });
    const thinMesh = new THREE.Mesh(thinGeo, thinMat);
    thinMesh.name = 'thinAtmosphereShell';
    thinMesh.renderOrder = 1;
    atmoGroup.add(thinMesh);
    thinAtmoShellRef.current = thinMesh;

    // 3. Kármán Line (100 km) — Dashed Ring Only (Edge of Space)
    const karmanSegments = 128;
    const karmanPts: THREE.Vector3[] = [];
    for (let j = 0; j <= karmanSegments; j++) {
      const theta = (j / karmanSegments) * Math.PI * 2;
      karmanPts.push(new THREE.Vector3(r100 * Math.cos(theta), 0, r100 * Math.sin(theta)));
    }
    const karmanGeo = new THREE.BufferGeometry().setFromPoints(karmanPts);
    const karmanMat = new THREE.LineDashedMaterial({
      color: 0xFF5F40,
      dashSize: 3.5,
      gapSize: 2.5,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      depthTest: true,
    });
    const karmanRing = new THREE.Line(karmanGeo, karmanMat);
    karmanRing.computeLineDistances();
    karmanRing.renderOrder = 3;
    atmoGroup.add(karmanRing);
    karmanRingRef.current = karmanRing;

    // 4. 3D Label Sprites
    const turbLabel = createAtmosphereLabelSprite(
      'Turbulence Zone',
      `0–${formatAltAndUnits(20, scaleModeRef.current)}`,
      '#FF5F40',
      'rgba(255, 95, 64, 0.6)'
    );
    turbLabel.position.set(r20 * 0.72, r20 * 0.45, r20 * 0.52);
    atmoGroup.add(turbLabel);
    turbulenceLabelRef.current = turbLabel;

    const thinLabel = createAtmosphereLabelSprite(
      'Thin Atmosphere',
      `20–${formatAltAndUnits(100, scaleModeRef.current)}`,
      '#9CA195',
      'rgba(156, 161, 149, 0.6)'
    );
    thinLabel.position.set(-r100 * 0.45, r100 * 0.85, r100 * 0.28);
    atmoGroup.add(thinLabel);
    thinAtmoLabelRef.current = thinLabel;

    const karmanLabel = createAtmosphereLabelSprite(
      'Kármán Line — Edge of Space',
      formatAltAndUnits(100, scaleModeRef.current),
      '#F0FFEA',
      'rgba(240, 255, 234, 0.6)'
    );
    karmanLabel.position.set(r100 * Math.cos(0.35), 2.5, r100 * Math.sin(0.35));
    atmoGroup.add(karmanLabel);
    karmanLabelRef.current = karmanLabel;

    scene.add(atmoGroup);

    // 5c. STANDARD REFERENCE ALTITUDE RINGS (Task 2 & 3: 100km Kármán, 2,000km LEO, 20,200km MEO, 35,786km GEO)
    const refGroup = new THREE.Group();
    refGroup.name = 'referenceRingsGroup';
    refGroup.visible = showReferenceRings; // off by default
    referenceRingsGroupRef.current = refGroup;

    const refRingList: {
      spec: ReferenceAltitudeSpec;
      ring: THREE.Line;
      label: THREE.Sprite;
    }[] = [
      { spec: REFERENCE_ALTITUDES[0], ring: karmanRing, label: karmanLabel },
    ];

    // Build the outer 3 reference rings (2,000 km, 20,200 km, 35,786 km), reusing Kármán ring for 100 km
    REFERENCE_ALTITUDES.slice(1).forEach((spec) => {
      const r = getRenderOrbitRadius(spec.altKm, scaleModeRef.current);
      const segments = 180;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= segments; j++) {
        const theta = (j / segments) * Math.PI * 2;
        pts.push(new THREE.Vector3(r * Math.cos(theta), 0, r * Math.sin(theta)));
      }
      const ringGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const ringMat = new THREE.LineDashedMaterial({
        color: spec.color,
        dashSize: spec.dashSize,
        gapSize: spec.gapSize,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        depthTest: true,
      });
      const ring = new THREE.Line(ringGeo, ringMat);
      ring.computeLineDistances();
      ring.renderOrder = 501;
      refGroup.add(ring);

      const tag = formatAltAndUnits(spec.altKm, scaleModeRef.current);
      const sprite = createAtmosphereLabelSprite(spec.name, tag, spec.cssColor, spec.strokeRgba);
      sprite.position.set(r * Math.cos(spec.labelAngle), 2.5, r * Math.sin(spec.labelAngle));
      refGroup.add(sprite);

      refRingList.push({ spec, ring, label: sprite });
    });

    refRingMeshesRef.current = refRingList;
    scene.add(refGroup);

    // 5d. SOLAR DIRECTION VECTOR & DAY/NIGHT TERMINATOR GREAT CIRCLE (Tasks 1, 2, 4)
    const sunGroup = new THREE.Group();
    sunGroup.name = 'sunTerminatorGroup';
    sunGroup.visible = showSunTerminator;
    sunGroupRef.current = sunGroup;

    // 1) Day/Night Terminator Line (Great circle perpendicular to FIXED_SUN_DIR at R = globeRadius + 0.20)
    const termPts = computeTerminatorCirclePoints(FIXED_SUN_DIR, globeRadius + 0.20, 180);
    const termGeo = new THREE.BufferGeometry().setFromPoints(termPts);
    const termMat = new THREE.LineDashedMaterial({
      color: 0xfbbf24, // solar gold/amber
      dashSize: 4.5,
      gapSize: 2.8,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: true,
    });
    const terminatorRing = new THREE.Line(termGeo, termMat);
    terminatorRing.computeLineDistances();
    terminatorRing.renderOrder = 490;
    sunGroup.add(terminatorRing);
    terminatorRingRef.current = terminatorRing;

    // Terminator 3D Billboard Sprite Label
    const termLabel = createAtmosphereLabelSprite(
      'Solar Terminator',
      'Day / Night Boundary',
      '#fbbf24',
      'rgba(251, 191, 36, 0.65)'
    );
    // Position label along terminator ring (at angle 0.4 rad on the circle)
    const upCand = Math.abs(FIXED_SUN_DIR.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const uTerm = new THREE.Vector3().crossVectors(FIXED_SUN_DIR, upCand).normalize();
    const vTerm = new THREE.Vector3().crossVectors(FIXED_SUN_DIR, uTerm).normalize();
    const termLabelPos = new THREE.Vector3()
      .addScaledVector(uTerm, (globeRadius + 2.5) * Math.cos(0.4))
      .addScaledVector(vTerm, (globeRadius + 2.5) * Math.sin(0.4));
    termLabel.position.copy(termLabelPos);
    sunGroup.add(termLabel);
    terminatorLabelRef.current = termLabel;

    // 2) Sun Direction Arrow near the globe pointing toward the Sun (Task 4)
    // Starting slightly outside the sunward limb of Earth, extending outward along FIXED_SUN_DIR
    const arrowOrigin = FIXED_SUN_DIR.clone().multiplyScalar(globeRadius + 3.0);
    const arrowLength = 36.0;
    const sunArrow = new THREE.ArrowHelper(
      FIXED_SUN_DIR,
      arrowOrigin,
      arrowLength,
      0xfacc15, // bright solar yellow
      8.0,      // headLength
      4.0       // headWidth
    );
    sunArrow.renderOrder = 495;
    sunGroup.add(sunArrow);
    sunArrowRef.current = sunArrow;

    // 3) Sun Direction Billboard Sprite Label (Task 4)
    const sunLabel = createAtmosphereLabelSprite(
      'Sun Direction',
      'Solar Vector',
      '#facc15',
      'rgba(250, 204, 21, 0.7)'
    );
    sunLabel.position.copy(FIXED_SUN_DIR.clone().multiplyScalar(globeRadius + arrowLength + 12.0));
    sunGroup.add(sunLabel);
    sunLabelRef.current = sunLabel;

    scene.add(sunGroup);

    // 5e. ACTIVE SATELLITE GROUND FOOTPRINT (Elevation Mask Geometry - Tasks 1-3)
    const footprintGroup = new THREE.Group();
    footprintGroup.name = 'satelliteFootprintGroup';
    footprintGroup.visible = showFootprint;
    footprintGroupRef.current = footprintGroup;

    // Initial footprint geometry for LEO-550 default (theta ~ 14.96 deg)
    const initFpSatDir = new THREE.Vector3(1, 0, 0);
    const initFpMinEl = 10.0;
    const initFpMinElRad = THREE.MathUtils.degToRad(initFpMinEl);
    const initFpAltKm = 550.0;
    const initFpRKm = EARTH_RADIUS_KM + initFpAltKm;
    const initFpSinEta = Math.min(1.0, Math.max(0.0, (EARTH_RADIUS_KM / initFpRKm) * Math.cos(initFpMinElRad)));
    const initFpTheta = Math.max(0.01, Math.PI / 2 - initFpMinElRad - Math.asin(initFpSinEta));

    const initFootprint = computeFootprintGeometry(initFpSatDir, globeRadius, initFpTheta, FOOTPRINT_SEGMENTS);

    // 1) Perimeter Line Loop (Task 2)
    const fpRingGeo = new THREE.BufferGeometry().setFromPoints(initFootprint.ringPoints);
    const fpRingMat = new THREE.LineBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: true,
    });
    const fpRing = new THREE.LineLoop(fpRingGeo, fpRingMat);
    fpRing.renderOrder = 620;
    footprintGroup.add(fpRing);
    footprintRingRef.current = fpRing;

    // 2) Semi-transparent shaded cap mesh
    const fpCapGeo = new THREE.BufferGeometry();
    fpCapGeo.setAttribute('position', new THREE.Float32BufferAttribute(initFootprint.capPositions, 3));
    fpCapGeo.setIndex(initFootprint.capIndices);
    fpCapGeo.computeVertexNormals();
    const fpCapMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.20,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    const fpCapMesh = new THREE.Mesh(fpCapGeo, fpCapMat);
    fpCapMesh.renderOrder = 610;
    footprintGroup.add(fpCapMesh);
    footprintCapMeshRef.current = fpCapMesh;

    // 3) Sub-satellite point (nadir) marker
    const fpDotGeo = new THREE.SphereGeometry(0.65, 12, 12);
    const fpDotMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: true,
    });
    const fpDotMesh = new THREE.Mesh(fpDotGeo, fpDotMat);
    fpDotMesh.position.copy(initFpSatDir.clone().multiplyScalar(globeRadius + 0.25));
    fpDotMesh.renderOrder = 625;
    footprintGroup.add(fpDotMesh);
    footprintCenterMarkerRef.current = fpDotMesh;

    // 4) 3D Billboard Sprite Label
    const fpLabel = createAtmosphereLabelSprite(
      'Ground Footprint',
      `Coverage [El ≥ ${initFpMinEl.toFixed(0)}°]`,
      '#FF5F40',
      'rgba(255, 95, 64, 0.7)'
    );
    fpLabel.position.copy(initFpSatDir.clone().multiplyScalar(globeRadius + 4.5));
    footprintGroup.add(fpLabel);
    footprintLabelRef.current = fpLabel;

    scene.add(footprintGroup);

    // Central 3D coordinate axes inside the globe at (0, 0, 0)
    const axesHelper = new THREE.AxesHelper(65);
    axesHelper.renderOrder = 500;
    scene.add(axesHelper);

    // Deep background grid plane shifted below the globe
    const gridHelper = new THREE.GridHelper(500, 20, 0x1e3a5f, 0x0f172a);
    gridHelper.position.set(0, -globeRadius - 20, 0);
    scene.add(gridHelper);

    // 6. INJECT BACKGROUND CONSTELLATION ORBITS & ANIMATED PEER SATELLITES
    const peerNodes: {
      mesh: THREE.Sprite | THREE.Mesh;
      ring: THREE.Line;
      preset: OrbitPreset;
      incDeg: number;
      raanDeg: number;
      speed: number;
      meanMotionRadS: number;
      periodSec: number;
      anomaly: number;
    }[] = [];

    // Background secondary orbits from presets
    ORBIT_PRESETS.slice(1).forEach((preset, index) => {
      const rp = EARTH_RADIUS_KM + preset.perigeeAltKm;
      const ra = EARTH_RADIUS_KM + preset.apogeeAltKm;
      const a = (rp + ra) / 2.0;
      const e = (ra - rp) / (ra + rp);
      const segments = 120;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= segments; j++) {
        const nu = (j / segments) * Math.PI * 2;
        const rPhys = e < 1e-8 ? a : (a * (1 - e * e)) / (1 + e * Math.cos(nu));
        const altKm = rPhys - EARTH_RADIUS_KM;
        const peerRadius = getRenderOrbitRadius(altKm, scaleModeRef.current);
        pts.push(computeOrbitPoint(peerRadius, preset.incDeg, preset.raanDeg, nu, preset.argPerigeeDeg ?? 0));
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

      // Peer satellite node: flat screen-space billboard sprite (Tasks 1-3)
      const spriteMat = new THREE.SpriteMaterial({
        map: getFlatMarkerTexture(),
        color: preset.color,
        depthTest: true,
        depthWrite: false,
        transparent: true,
      });
      const nodeSprite = new THREE.Sprite(spriteMat);
      nodeSprite.renderOrder = 10;
      const startAnomaly = persistentSceneState.peerAnomalies?.[preset.id] ?? ((index + 1) * 1.1);
      const startRPhys = e < 1e-8 ? a : (a * (1 - e * e)) / (1 + e * Math.cos(startAnomaly));
      const startRadius = getRenderOrbitRadius(startRPhys - EARTH_RADIUS_KM, scaleModeRef.current);
      nodeSprite.position.copy(computeOrbitPoint(startRadius, preset.incDeg, preset.raanDeg, startAnomaly, preset.argPerigeeDeg ?? 0));
      scene.add(nodeSprite);

      const meanMotion = computeMeanMotionRadS(a);
      const peerPeriod = computeOrbitalPeriodSec(a);

      peerNodes.push({
        mesh: nodeSprite,
        ring,
        preset,
        incDeg: preset.incDeg,
        raanDeg: preset.raanDeg,
        speed: meanMotion,
        meanMotionRadS: meanMotion,
        periodSec: peerPeriod,
        anomaly: startAnomaly,
      });
    });
    peerNodesRef.current = peerNodes;

    // 7. ACTIVE HIGHLIGHTED SATELLITE ORBIT RING (Dynamically updated Keplerian ellipse)
    const initialRp = EARTH_RADIUS_KM + activeOrbitRef.current.perigeeAltKm;
    const initialRa = EARTH_RADIUS_KM + activeOrbitRef.current.apogeeAltKm;
    const initialA = (initialRp + initialRa) / 2.0;
    const initialE = (initialRa - initialRp) / (initialRa + initialRp);
    const activeRingSegments = 180;
    const activeRingPts: THREE.Vector3[] = [];
    for (let j = 0; j <= activeRingSegments; j++) {
      const nu = (j / activeRingSegments) * Math.PI * 2;
      const rPhys = initialE < 1e-8 ? initialA : (initialA * (1 - initialE * initialE)) / (1 + initialE * Math.cos(nu));
      const altKm = rPhys - EARTH_RADIUS_KM;
      const rRender = getRenderOrbitRadius(altKm, scaleModeRef.current);
      activeRingPts.push(
        computeOrbitPoint(
          rRender,
          activeOrbitRef.current.incDeg,
          activeOrbitRef.current.raanDeg,
          nu,
          activeOrbitRef.current.argPerigeeDeg
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

    // Initial positions (Keplerian)
    const initE = solveKepler(activeOrbitRef.current.meanAnomaly, initialE);
    const initNu = eccentricToTrueAnomaly(initE, initialE);
    const initRPhys = initialE < 1e-8 ? initialA : initialA * (1 - initialE * Math.cos(initE));
    const initAltKm = initRPhys - EARTH_RADIUS_KM;
    const initRenderRadius = getRenderOrbitRadius(initAltKm, scaleModeRef.current);
    const initialSatPos = computeOrbitPoint(
      initRenderRadius,
      activeOrbitRef.current.incDeg,
      activeOrbitRef.current.raanDeg,
      initNu,
      activeOrbitRef.current.argPerigeeDeg
    );
    const tgtPos = tgtPosRef.current;

    // 8. ACTIVE SATELLITE (High-Fidelity 3D Real Satellite Model)
    const satGroup = new THREE.Group();
    satGroup.name = 'ActiveSatelliteGroup';

    // Authentic 3D Real Satellite Model: Gold MLI Bus, Dual Solar Arrays, FSOC Optical Head, Parabolic Dish
    const sat3D = createRealSatelliteModel({
      accentColor: 0x0284c7, // Standard Satellite Blue
      isGoldMLI: true,
      includeOpticalTurret: true,
      includeAntenna: true,
      includeStarTrackers: true,
      includeThrusters: true,
    });
    satGroup.add(sat3D);
    sat3DModelRef.current = sat3D;

    // Invisible hit-test target sprite to preserve raycaster clicking and selection hitbox
    const satSpriteMat = new THREE.SpriteMaterial({
      map: getFlatMarkerTexture(),
      color: 0x0284c7,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.0,
    });
    const satSprite = new THREE.Sprite(satSpriteMat);
    satSprite.renderOrder = 10;
    satGroup.add(satSprite);
    satSpriteRef.current = satSprite;

    satGroup.position.copy(initialSatPos);
    satGroup.lookAt(tgtPos);
    scene.add(satGroup);
    cameraMeshRef.current = satGroup;

    // 9. TARGET BEACON (Flat screen-space billboard marker matching satellite style - Tasks 1-5)
    // Standardized flat dot replaces 43x33 px 3D shaded box + pad ring
    const beaconGroup = new THREE.Group();
    const beaconSpriteMat = new THREE.SpriteMaterial({
      map: getFlatMarkerTexture(),
      color: 0xff3366, // Standard Beacon Red/Pink
      depthTest: true,
      depthWrite: false,
      transparent: true,
    });
    const beaconSprite = new THREE.Sprite(beaconSpriteMat);
    beaconSprite.position.set(0, 0, 0.1);
    beaconSprite.renderOrder = 10;
    beaconGroup.add(beaconSprite);
    beaconSpriteRef.current = beaconSprite;
    targetCubeMeshRef.current = beaconSprite;

    // Dedicated Billboard Label for the Beacon
    const beaconLabel = createBeaconLabelSprite(
      beaconSpeedKmh > 0 ? 'ATMOSPHERIC UAV' : 'GROUND STATION',
      beaconSpeedKmh > 0 ? `${beaconSpeedKmh} km/h` : 'STATIC'
    );
    beaconLabel.position.set(0, 0, 3.2);
    beaconGroup.add(beaconLabel);
    beaconLabelRef.current = beaconLabel;

    // Initial position on the ground from beaconMotionRef or path waypoints (R = globeRadius = 100u)
    let initialBeaconPos: THREE.Vector3;
    if (pathFollowModeRef.current && beaconPathWaypointsRef.current.length > 0) {
      initialBeaconPos = pathCurrentLocalPosRef.current.clone();
    } else {
      initialBeaconPos = computeOrbitPoint(
        globeRadius,
        beaconMotionRef.current.incDeg,
        beaconMotionRef.current.raanDeg,
        beaconMotionRef.current.anomaly
      );
    }
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
    trackRing.visible = !pathFollowModeRef.current;
    scene.add(trackRing);
    beaconTrackRingRef.current = trackRing;

    // 9b. 3D BEACON GROUND PATH GROUP (1=Start [Green] -> 4=End [Orange], anchored to Earth)
    const beaconPathGroup = new THREE.Group();
    beaconPathGroup.name = 'beaconPathGroup';

    const pathSolidGeo = new THREE.BufferGeometry();
    const pathSolidMat = new THREE.LineBasicMaterial({
      color: 0xf59e0b,
      linewidth: 3,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    });
    const pathSolidLine = new THREE.Line(pathSolidGeo, pathSolidMat);
    pathSolidLine.renderOrder = 610;
    beaconPathGroup.add(pathSolidLine);
    beaconPathSolidLineRef.current = pathSolidLine;

    const pathDashedGeo = new THREE.BufferGeometry();
    const pathDashedMat = new THREE.LineDashedMaterial({
      color: 0xf59e0b,
      dashSize: 3,
      gapSize: 2,
      transparent: true,
      opacity: 0.65,
      depthTest: true,
      depthWrite: false,
    });
    const pathDashedLine = new THREE.Line(pathDashedGeo, pathDashedMat);
    pathDashedLine.renderOrder = 610;
    beaconPathGroup.add(pathDashedLine);
    beaconPathDashedLineRef.current = pathDashedLine;

    const pathMarkersGroup = new THREE.Group();
    pathMarkersGroup.name = 'pathMarkersGroup';
    beaconPathGroup.add(pathMarkersGroup);
    beaconPathMarkersGroupRef.current = pathMarkersGroup;

    scene.add(beaconPathGroup);
    beaconPathGroupRef.current = beaconPathGroup;

    // Build visual geometry for initial waypoints (preset 1->4)
    rebuildBeaconPathVisuals(beaconPathWaypointsRef.current, globeRadius);

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
    const initBackupM = (activeOrbitRef.current.meanAnomaly + backupPhaseRad) % (2 * Math.PI);
    const initBackupE = solveKepler(initBackupM, initialE);
    const initBackupNu = eccentricToTrueAnomaly(initBackupE, initialE);
    const initBackupRPhys = initialE < 1e-8 ? initialA : initialA * (1 - initialE * Math.cos(initBackupE));
    const initBackupRenderRadius = getRenderOrbitRadius(initBackupRPhys - EARTH_RADIUS_KM, scaleModeRef.current);
    const initialBackupPos = computeOrbitPoint(
      initBackupRenderRadius,
      activeOrbitRef.current.incDeg,
      activeOrbitRef.current.raanDeg,
      initBackupNu,
      activeOrbitRef.current.argPerigeeDeg
    );
    // 12b. BACKUP SATELLITE (High-Fidelity 3D Real Satellite Model for Handover)
    const backupGroup = new THREE.Group();
    backupGroup.name = 'BackupSatelliteGroup';

    const backup3D = createRealSatelliteModel({
      accentColor: 0x818cf8, // Standard Backup Satellite Purple
      isGoldMLI: true,
      includeOpticalTurret: true,
      includeAntenna: true,
      includeStarTrackers: true,
      includeThrusters: true,
    });
    backupGroup.add(backup3D);
    backup3DModelRef.current = backup3D;

    const backupSpriteMat = new THREE.SpriteMaterial({
      map: getFlatMarkerTexture(),
      color: 0x818cf8,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.0,
    });
    const backupSprite = new THREE.Sprite(backupSpriteMat);
    backupSprite.renderOrder = 10;
    backupGroup.add(backupSprite);
    backupSpriteRef.current = backupSprite;

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
    let dragDistance = 0;
    const onMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      dragDistance = 0;
      previousMousePositionRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = e.clientX - previousMousePositionRef.current.x;
      const deltaY = e.clientY - previousMousePositionRef.current.y;
      dragDistance += Math.abs(deltaX) + Math.abs(deltaY);

      orbitStateRef.current.theta -= deltaX * 0.005;
      // Allow full spherical camera orbiting from South Pole (-88.3°) to North Pole (+88.3°)
      orbitStateRef.current.phi = Math.max(
        -Math.PI / 2 + 0.03,
        Math.min(Math.PI / 2 - 0.03, orbitStateRef.current.phi + deltaY * 0.005)
      );

      previousMousePositionRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
    };

    // Touch listeners for mobile / touchscreen orbit control
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isDraggingRef.current = true;
        dragDistance = 0;
        previousMousePositionRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current || e.touches.length !== 1) return;
      const deltaX = e.touches[0].clientX - previousMousePositionRef.current.x;
      const deltaY = e.touches[0].clientY - previousMousePositionRef.current.y;
      dragDistance += Math.abs(deltaX) + Math.abs(deltaY);

      orbitStateRef.current.theta -= deltaX * 0.005;
      orbitStateRef.current.phi = Math.max(
        -Math.PI / 2 + 0.03,
        Math.min(Math.PI / 2 - 0.03, orbitStateRef.current.phi + deltaY * 0.005)
      );

      previousMousePositionRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      if (e.cancelable) e.preventDefault();
    };

    const onTouchEnd = () => {
      isDraggingRef.current = false;
    };

    // Raycast click for comfortable marker selection and waypoint plotting
    const onClick = (e: MouseEvent) => {
      if (dragDistance > 5) return;
      const rect = container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, perspCamera);

      // If Draw Mode is active, raycast directly to 3D Earth to plot custom waypoints
      if (isDrawingPathRef.current && globeMeshRef.current) {
        const hits = raycaster.intersectObject(globeMeshRef.current, false);
        if (hits.length > 0) {
          const hitPoint = hits[0].point;
          const currentRotY = globeMeshRef.current.rotation.y;
          const r = earthRenderRadiusRef.current;
          const localHit = hitPoint
            .clone()
            .normalize()
            .multiplyScalar(r)
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), -currentRotY);
          const latDeg = THREE.MathUtils.radToDeg(
            Math.asin(THREE.MathUtils.clamp(localHit.y / r, -1.0, 1.0))
          );
          const lonDeg = THREE.MathUtils.radToDeg(Math.atan2(localHit.x, localHit.z));
          handleAddWaypoint(localHit, latDeg, lonDeg);
          return;
        }
      }

      const clickables: { obj: THREE.Object3D; action: () => void }[] = [];
      if (satSpriteRef.current) {
        clickables.push({
          obj: satSpriteRef.current,
          action: () => {
            setSelectedPresetId('leo-550-p1');
            setSelectedMarkerType('sat');
            handleLocateSatellite();
          },
        });
      }
      if (sat3DModelRef.current) {
        sat3DModelRef.current.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            clickables.push({
              obj: child,
              action: () => {
                setSelectedPresetId('leo-550-p1');
                setSelectedMarkerType('sat');
                handleLocateSatellite();
              },
            });
          }
        });
      }
      if (beaconSpriteRef.current) {
        clickables.push({
          obj: beaconSpriteRef.current,
          action: () => {
            setSelectedMarkerType('beacon');
          },
        });
      }
      if (beaconLabelRef.current) {
        clickables.push({
          obj: beaconLabelRef.current,
          action: () => {
            setSelectedMarkerType('beacon');
          },
        });
      }
      peerNodesRef.current.forEach((node) => {
        if (node.mesh) {
          clickables.push({
            obj: node.mesh,
            action: () => {
              setSelectedPresetId(node.preset.id);
              setSelectedMarkerType('peer');
            },
          });
        }
      });

      const hits = raycaster.intersectObjects(clickables.map((c) => c.obj), false);
      if (hits.length > 0) {
        const match = clickables.find((c) => c.obj === hits[0].object);
        if (match) match.action();
      }
    };

    const onWheel = (e: WheelEvent) => {
      orbitStateRef.current.radius = Math.max(
        105,
        Math.min(1800, orbitStateRef.current.radius + e.deltaY * 0.4)
      );
      e.preventDefault();
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    container.addEventListener('click', onClick);
    container.addEventListener('wheel', onWheel, { passive: false });

    // Render loop
    let animId: number;
    let frameCount = 0;
    let lastTimeMs = performance.now();
    let lastRenderMs = 0;
    const TARGET_FPS = 60;
    const FRAME_INTERVAL_MS = 1000 / TARGET_FPS; // ~16.67ms

    const animate = () => {
      animId = requestAnimationFrame(animate);

      // Skip rendering if browser tab or window is minimized/hidden, or if viewport container is hidden
      if (document.hidden || container.offsetParent === null) {
        lastTimeMs = performance.now();
        return;
      }

      // 60 FPS Target Throttling: prevents GPU overload on 120Hz/144Hz/240Hz laptop monitors
      const nowMs = performance.now();
      const elapsedSinceRender = nowMs - lastRenderMs;
      if (elapsedSinceRender < FRAME_INTERVAL_MS - 1.0) {
        return;
      }
      lastRenderMs = nowMs - (elapsedSinceRender % FRAME_INTERVAL_MS);

      frameCount++;
      const dtRealSec = Math.min(0.1, (nowMs - lastTimeMs) / 1000.0);
      lastTimeMs = nowMs;
      // 0. Fetch single-source-of-truth kinematics state from central orbitalEngine
      const f = satellitePovSync.getData();
      const currentSatPos = f.satPos;
      latestSatPosRef.current.copy(currentSatPos);
      tgtPosRef.current.copy(f.tgtPos);
      const isOccluded = f.isOccluded;
      const hitPoint = f.hitPoint ?? null;
      const backupSatPos = f.backupSatPos ?? currentSatPos;
      const currBoresight = f.boresightDir ?? new THREE.Vector3(0, 0, -1);
      boresightDirRef.current = currBoresight;
      const angDeg = f.beaconAngularErrorDeg ?? 0.0;
      let isBeaconInFp = false;

      // Keep activeOrbitRef in sync for HUD and telemetry
      activeOrbitRef.current.meanAnomaly = f.meanAnomaly ?? f.anomaly;
      activeOrbitRef.current.trueAnomaly = f.anomaly;
      activeOrbitRef.current.anomaly = f.anomaly;
      activeOrbitRef.current.currentRadiusKm = f.currentRadiusKm ?? 6928.0;
      activeOrbitRef.current.altitudeKm = f.altitudeKm ?? 550.0;
      activeOrbitRef.current.currentSpeedKmS = f.speedKmS ?? 7.585;
      activeOrbitRef.current.radius = f.orbitRadius;
      if (f.semiMajorAxisKm) activeOrbitRef.current.semiMajorAxisKm = f.semiMajorAxisKm;
      if (f.eccentricity !== undefined) activeOrbitRef.current.eccentricity = f.eccentricity;
      if (f.incDeg !== undefined) activeOrbitRef.current.incDeg = f.incDeg;
      if (f.raanDeg !== undefined) activeOrbitRef.current.raanDeg = f.raanDeg;
      if (f.argPerigeeDeg !== undefined) activeOrbitRef.current.argPerigeeDeg = f.argPerigeeDeg;
      if (f.beaconAnomaly !== undefined) beaconMotionRef.current.anomaly = f.beaconAnomaly;
      if (f.slewProgress !== undefined) slewProgressRef.current = f.slewProgress;

      // 1. Rotate Earth and clouds with diurnal spin
      if (globeMeshRef.current) {
        globeMeshRef.current.rotation.y = f.earthRotationY;
      }
      if (cloudMeshRef.current) {
        cloudMeshRef.current.rotation.y = f.earthRotationY * 1.05;
      }

      // Rotate 3D beacon path group with Earth
      if (beaconPathGroupRef.current && globeMeshRef.current) {
        beaconPathGroupRef.current.rotation.y = globeMeshRef.current.rotation.y;
      }

      // 2. Advance peer constellation satellites along their orbits according to Kepler's Third Law
      const isRevolving = activeOrbitRef.current.autoRevolve;
      const dtSimSec = isRevolving ? dtRealSec * simTimeWarpRef.current : 0;
      peerNodesRef.current.forEach((node) => {
        if (isRevolving) {
          node.anomaly = (node.anomaly + node.meanMotionRadS * dtSimSec) % (2 * Math.PI);
        }
        const rp = EARTH_RADIUS_KM + node.preset.perigeeAltKm;
        const ra = EARTH_RADIUS_KM + node.preset.apogeeAltKm;
        const a = (rp + ra) / 2.0;
        const e = (ra - rp) / (ra + rp);
        const rPhys = e < 1e-8 ? a : (a * (1 - e * e)) / (1 + e * Math.cos(node.anomaly));
        const altKm = rPhys - EARTH_RADIUS_KM;
        const currentPeerRadius = getRenderOrbitRadius(altKm, scaleModeRef.current);
        const pos = computeOrbitPoint(currentPeerRadius, node.incDeg, node.raanDeg, node.anomaly, node.preset.argPerigeeDeg ?? 0);
        node.mesh.position.copy(pos);
      });

      // 3. Backup satellite
      if (backupSatMeshRef.current) {
        backupSatMeshRef.current.position.copy(backupSatPos);
        backupSatMeshRef.current.lookAt(tgtPosRef.current);
      }

      // 4. Position and orient the beacon group strictly on top of globe surface
      if (targetMeshRef.current) {
        const beaconNormal = tgtPosRef.current.clone().normalize();
        targetMeshRef.current.position.copy(tgtPosRef.current);
        targetMeshRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), beaconNormal);
      }
      if (beaconTrackRingRef.current && globeMeshRef.current) {
        beaconTrackRingRef.current.visible = !pathFollowModeRef.current;
        beaconTrackRingRef.current.rotation.y = globeMeshRef.current.rotation.y;
      }

      // 4. Update Active Satellite Ground Footprint (Elevation Mask Geometry - Tasks 1-3)
      if (footprintGroupRef.current && footprintGroupRef.current.visible) {
        const satDir = currentSatPos.clone().normalize();
        const beaconDir = tgtPosRef.current.clone().normalize();

        // Minimum elevation angle (default 10.0°)
        const minEl = 10.0;
        const minElRad = THREE.MathUtils.degToRad(minEl);

        // Physical altitude and orbital radius in km
        const altKm = activeOrbitRef.current.altitudeKm || Math.max(150, activeOrbitRef.current.currentRadiusKm - EARTH_RADIUS_KM) || 550;
        const rKm = EARTH_RADIUS_KM + altKm;

        // Elevation mask geometry: sin(eta) = (R_Earth / r) * cos(min_el), theta = pi/2 - min_el - eta
        const sinEta = Math.min(1.0, Math.max(0.0, (EARTH_RADIUS_KM / rKm) * Math.cos(minElRad)));
        const eta = Math.asin(sinEta);
        const theta = Math.max(0.01, Math.PI / 2 - minElRad - eta);

        // Calculate topocentric elevation angle from beacon to satellite
        const satPhys = satDir.clone().multiplyScalar(rKm);
        const beaconPhys = beaconDir.clone().multiplyScalar(EARTH_RADIUS_KM);
        const rhoPhys = satPhys.clone().sub(beaconPhys);
        const rhoLen = rhoPhys.length();
        const sinEl = rhoLen > 0.001 ? beaconDir.dot(rhoPhys) / rhoLen : 0;
        const elDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sinEl, -1, 1)));

        // Angular distance on Earth's surface
        const cosAlpha = THREE.MathUtils.clamp(satDir.dot(beaconDir), -1, 1);
        const alphaRad = Math.acos(cosAlpha);
        const isInside = alphaRad <= (theta + 0.005) && elDeg >= (minEl - 0.1);
        isBeaconInFp = isInside;

        // Orthonormal basis on globe
        let up = Math.abs(satDir.y) < 0.92 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const u = new THREE.Vector3().crossVectors(satDir, up).normalize();
        const v = new THREE.Vector3().crossVectors(u, satDir).normalize();

        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);
        const ringR = globeRadius + 0.18;
        const capR = globeRadius + 0.12;

        // 1. Update perimeter ring geometry (Task 2)
        if (footprintRingRef.current) {
          const ringPos = footprintRingRef.current.geometry.attributes.position as THREE.BufferAttribute;
          if (ringPos) {
            for (let i = 0; i < FOOTPRINT_SEGMENTS; i++) {
              const phi = (i / FOOTPRINT_SEGMENTS) * Math.PI * 2;
              const pt = satDir.clone().multiplyScalar(cosTheta)
                .addScaledVector(u, sinTheta * Math.cos(phi))
                .addScaledVector(v, sinTheta * Math.sin(phi))
                .multiplyScalar(ringR);
              ringPos.setXYZ(i, pt.x, pt.y, pt.z);
            }
            ringPos.needsUpdate = true;
          }

          // Color differently if beacon is inside vs outside (Task 3)
          const ringMat = footprintRingRef.current.material as THREE.LineBasicMaterial;
          if (ringMat) {
            ringMat.color.setHex(isInside ? 0x10b981 : 0xf43f5e);
            ringMat.opacity = isInside ? 0.95 : 0.75;
          }
        }

        // 2. Update spherical cap fill geometry
        if (footprintCapMeshRef.current) {
          const capPos = footprintCapMeshRef.current.geometry.attributes.position as THREE.BufferAttribute;
          if (capPos) {
            // Vertex 0: Center
            const centerPt = satDir.clone().multiplyScalar(capR);
            capPos.setXYZ(0, centerPt.x, centerPt.y, centerPt.z);

            // Ring 1: Mid-theta
            const halfTheta = theta * 0.5;
            const cosHalf = Math.cos(halfTheta);
            const sinHalf = Math.sin(halfTheta);
            for (let i = 0; i < FOOTPRINT_SEGMENTS; i++) {
              const phi = (i / FOOTPRINT_SEGMENTS) * Math.PI * 2;
              const pt = satDir.clone().multiplyScalar(cosHalf)
                .addScaledVector(u, sinHalf * Math.cos(phi))
                .addScaledVector(v, sinHalf * Math.sin(phi))
                .multiplyScalar(capR);
              capPos.setXYZ(1 + i, pt.x, pt.y, pt.z);
            }

            // Ring 2: Outer theta
            for (let i = 0; i < FOOTPRINT_SEGMENTS; i++) {
              const phi = (i / FOOTPRINT_SEGMENTS) * Math.PI * 2;
              const pt = satDir.clone().multiplyScalar(cosTheta)
                .addScaledVector(u, sinTheta * Math.cos(phi))
                .addScaledVector(v, sinTheta * Math.sin(phi))
                .multiplyScalar(capR);
              capPos.setXYZ(1 + FOOTPRINT_SEGMENTS + i, pt.x, pt.y, pt.z);
            }
            capPos.needsUpdate = true;
          }

          const capMat = footprintCapMeshRef.current.material as THREE.MeshBasicMaterial;
          if (capMat) {
            capMat.color.setHex(isInside ? 0x10b981 : 0xf43f5e);
            capMat.opacity = isInside ? 0.20 : 0.12;
          }
        }

        // 3. Update sub-satellite point (nadir) marker
        if (footprintCenterMarkerRef.current) {
          footprintCenterMarkerRef.current.position.copy(satDir.clone().multiplyScalar(globeRadius + 0.25));
          const dotMat = footprintCenterMarkerRef.current.material as THREE.MeshBasicMaterial;
          if (dotMat) {
            dotMat.color.setHex(isInside ? 0x10b981 : 0xf43f5e);
          }
        }

        // 4. Update billboard sprite label
        if (footprintLabelRef.current) {
          const labelPos = satDir.clone().multiplyScalar(globeRadius + 4.5);
          footprintLabelRef.current.position.copy(labelPos);

          if (frameCount % 15 === 0) {
            const statusTag = isInside
              ? `COVERAGE OK: El ${elDeg.toFixed(1)}° (≥ ${minEl.toFixed(0)}°)`
              : `BELOW MASK: El ${elDeg.toFixed(1)}° (< ${minEl.toFixed(0)}°)`;
            const statusColor = isInside ? '#FF5F40' : '#5E625A';
            const strokeColor = isInside ? 'rgba(255, 95, 64, 0.7)' : 'rgba(94, 98, 90, 0.7)';
            updateSpriteText(
              footprintLabelRef.current,
              'Ground Footprint',
              statusTag,
              statusColor,
              strokeColor
            );
          }
        }

        // Update direct DOM refs periodically (every 6 frames) without React re-render (Optimization 4.B)
        if (frameCount % 6 === 0) {
          if (footprintStatusRef.current) {
            footprintStatusRef.current.textContent = isInside
              ? `✓ BEACON IN COVERAGE (El = ${elDeg.toFixed(1)}°)`
              : `✕ BEACON OUTSIDE (El = ${elDeg.toFixed(1)}°)`;
            footprintStatusRef.current.className = isInside ? 'text-[#FF5F40] font-bold' : 'text-[#9CA195] font-bold';
          }
          if (footprintRadiusRef.current) {
            footprintRadiusRef.current.textContent = `Radius θ = ${THREE.MathUtils.radToDeg(theta).toFixed(1)}° (${Math.round(EARTH_RADIUS_KM * theta).toLocaleString()} km)`;
          }
          if (cameraFovStatusRef.current) {
            const inFov = !isOccluded && isInside;
            cameraFovStatusRef.current.textContent = inFov ? '✓ IN FIELD OF VIEW' : '[!] OUTSIDE FIELD OF VIEW';
            cameraFovStatusRef.current.className = `font-bold ${inFov ? 'text-[#F0FFEA]' : 'text-[#FF5F40]'}`;
          }
        }
      }

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
        if (bkMat) {
          if (bkOccluded) {
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

      // Synchronize beacon color: GREEN when locked in FOV, RED when lost from FOV (Task 3)
      if (targetCubeMeshRef.current) {
        const mat = (targetCubeMeshRef.current as any).material as THREE.SpriteMaterial;
        if (mat && mat.color) {
          mat.color.setHex(isLockedInFov ? 0x10b981 : 0xff3366);
        }
      }

      // Update telemetry text elements directly (every 6 frames) without React re-render (Optimization 4.B)
      if (frameCount % 6 === 0) {
        const dist = currentSatPos.distanceTo(tgtPosRef.current);
        const slantKm = f.slantRangeKm ?? 550.0;
        if (trackerSlantRangeRef.current) {
          trackerSlantRangeRef.current.textContent = formatDistAndUnits(slantKm, dist);
        }
        if (trackerPatStateRef.current) {
          if (isOccluded) {
            trackerPatStateRef.current.textContent = '! OCCLUDED BY EARTH LIMB (NO LOS)';
            trackerPatStateRef.current.className = 'text-[#FF5F40] font-bold animate-pulse';
          } else if (!autoLOSRef.current) {
            trackerPatStateRef.current.textContent = 'AUTO LOS OFF (HOLDING NADIR ATTITUDE)';
            trackerPatStateRef.current.className = 'text-[#9CA195] font-bold';
          } else if (angDeg > 1.5) {
            trackerPatStateRef.current.textContent = `! SLEWING TO BEACON LOS (${angDeg.toFixed(1)}° OFF-AXIS)`;
            trackerPatStateRef.current.className = 'text-[#FF5F40] font-bold animate-pulse';
          } else if (activeOrbitRef.current.autoRevolve) {
            trackerPatStateRef.current.textContent = '✓ ACTIVE PAT TRACKING (CLEAR LOS)';
            trackerPatStateRef.current.className = 'text-[#F0FFEA] font-bold';
          } else {
            trackerPatStateRef.current.textContent = '✓ LOCKED ON BEACON (CLEAR LOS)';
            trackerPatStateRef.current.className = 'text-[#F0FFEA] font-bold';
          }
        }
        if (trackerSpeedPeriodRef.current) {
          const curSpeed = activeOrbitRef.current.currentSpeedKmS;
          const curPeriod = computeOrbitalPeriodSec(activeOrbitRef.current.semiMajorAxisKm);
          trackerSpeedPeriodRef.current.textContent = `${formatOrbitalSpeed(curSpeed)} | 1 Rev: ${formatOrbitalPeriod(curPeriod)}`;
        }
        if (trackerKeplerRef.current) {
          const curA = activeOrbitRef.current.semiMajorAxisKm;
          const curR = activeOrbitRef.current.currentRadiusKm;
          trackerKeplerRef.current.textContent = `Kepler Orbit: a = ${formatDistAndUnits(curA, getRenderOrbitRadius(curA - EARTH_RADIUS_KM, scaleModeRef.current))} | r = ${formatDistAndUnits(curR, getRenderOrbitRadius(curR - EARTH_RADIUS_KM, scaleModeRef.current))}`;
        }
      }

      // 14. Standardized screen-space billboard scaling for all scene markers (Tasks 1, 2, 5, 6)
      const canvasH = container.clientHeight || 480;

      // 1) Active primary satellite: size strictly matches standard marker diameter (15.4px if selected, otherwise base 11.0px)
      const isPrimarySatActive =
        selectedMarkerTypeRef.current === 'sat' ||
        selectedPresetIdRef.current === 'leo-550-p1' ||
        selectedPresetIdRef.current === 'custom';
      const satTargetPx = isPrimarySatActive ? ACTIVE_MARKER_PX : BASE_MARKER_PX;
      updateScreenSpaceMarkerScale(
        satSpriteRef.current,
        perspCamera,
        canvasH,
        satTargetPx
      );
      if (sat3DModelRef.current) {
        updateScreenSpaceSatelliteScale(
          sat3DModelRef.current,
          perspCamera,
          canvasH,
          satTargetPx,
          1.8
        );
      }

      // 2) Beacon target marker: 15.4px when active/locked/in-footprint, otherwise base 11.0px
      const isBeaconActive =
        selectedMarkerTypeRef.current === 'beacon' ||
        isLockedInFov ||
        isBeaconInFp;
      updateScreenSpaceMarkerScale(
        beaconSpriteRef.current,
        perspCamera,
        canvasH,
        isBeaconActive ? ACTIVE_MARKER_PX : BASE_MARKER_PX
      );

      // Update Beacon Label text & scale if state changed
      const effectiveBeaconSpeedKmh = pathFollowModeRef.current
        ? (pathMotionActiveRef.current ? (f.beaconSpeedKmh || 450) : 0)
        : (f.beaconSpeedKmh && f.beaconSpeedKmh > 0 ? f.beaconSpeedKmh : 0);

      if (beaconLabelRef.current) {
        if (
          lastBeaconLabelState.current.speed !== effectiveBeaconSpeedKmh ||
          lastBeaconLabelState.current.locked !== isLockedInFov
        ) {
          lastBeaconLabelState.current.speed = effectiveBeaconSpeedKmh;
          lastBeaconLabelState.current.locked = isLockedInFov;
          updateBeaconLabelSprite(beaconLabelRef.current, effectiveBeaconSpeedKmh, isLockedInFov);
        }

        // Dynamically scale beacon label to stay crisp and readable at any distance
        if (perspCamera) {
          _tempMarkerWorldPos.setFromMatrixPosition(beaconLabelRef.current.matrixWorld);
          const distToCam = perspCamera.position.distanceTo(_tempMarkerWorldPos);
          if (distToCam > 0.1) {
            const fovRad = THREE.MathUtils.degToRad(perspCamera.fov);
            const visibleWorldH = 2.0 * distToCam * Math.tan(fovRad / 2.0);
            const unitsPerPx = visibleWorldH / canvasH;
            const targetW = Math.max(6.5, Math.min(18.0, 92.0 * unitsPerPx));
            const targetH = targetW * (90.0 / 320.0);
            beaconLabelRef.current.scale.set(targetW, targetH, 1.0);
            beaconLabelRef.current.position.set(0, 0, Math.max(2.4, targetH * 0.95));
          }
        }
      }

      // 3) Backup satellite: base 11.0px
      const backupTargetPx = BASE_MARKER_PX;
      updateScreenSpaceMarkerScale(
        backupSpriteRef.current,
        perspCamera,
        canvasH,
        backupTargetPx
      );
      if (backup3DModelRef.current) {
        updateScreenSpaceSatelliteScale(
          backup3DModelRef.current,
          perspCamera,
          canvasH,
          backupTargetPx,
          1.8
        );
      }

      // 4) Peer constellation satellites: 15.4px if selected in UI, otherwise base 11.0px
      peerNodesRef.current.forEach((node) => {
        const isNodeSelected = selectedPresetIdRef.current === node.preset.id;
        updateScreenSpaceMarkerScale(
          node.mesh as THREE.Sprite,
          perspCamera,
          canvasH,
          isNodeSelected ? ACTIVE_MARKER_PX : BASE_MARKER_PX
        );
      });

      // Keep track of latest satellite position for instant locating
      latestSatPosRef.current.copy(currentSatPos);

      // Spherical camera view around scene origin (0, 0, 0)
      const { theta, phi, radius } = orbitStateRef.current;
      perspCamera.position.x = radius * Math.sin(theta) * Math.cos(phi);
      perspCamera.position.y = radius * Math.sin(phi);
      perspCamera.position.z = radius * Math.cos(theta) * Math.cos(phi);
      perspCamera.lookAt(0, 0, 0);

      // Persist runtime element positions continuously so navigation across tabs preserves exact element states
      persistentSceneState.satelliteAnomaly = activeOrbitRef.current.anomaly;
      persistentSceneState.satelliteMeanAnomaly = activeOrbitRef.current.meanAnomaly;
      persistentSceneState.satelliteTrueAnomaly = activeOrbitRef.current.trueAnomaly;
      persistentSceneState.satelliteRadius = activeOrbitRef.current.radius;
      persistentSceneState.satelliteAltKm = activeOrbitRef.current.altitudeKm;
      persistentSceneState.satelliteSpeedKmS = activeOrbitRef.current.currentSpeedKmS;
      persistentSceneState.beaconAnomaly = beaconMotionRef.current.anomaly;
      if (globeMeshRef.current) {
        persistentSceneState.earthRotationY = globeMeshRef.current.rotation.y;
      }
      persistentSceneState.pathLegIndex = pathLegIndexRef.current;
      persistentSceneState.pathLegProgress = pathLegProgressRef.current;
      if (pathCurrentLocalPosRef.current) {
        persistentSceneState.pathCurrentLocalPos = {
          x: pathCurrentLocalPosRef.current.x,
          y: pathCurrentLocalPosRef.current.y,
          z: pathCurrentLocalPosRef.current.z,
        };
      }
      persistentSceneState.pathStatusText = pathStatusText;
      persistentSceneState.pathOverallProgressPct = pathOverallProgressPct;
      persistentSceneState.pathCurrentLegDisplay = pathCurrentLegDisplay;
      persistentSceneState.cameraTheta = orbitStateRef.current.theta;
      persistentSceneState.cameraPhi = orbitStateRef.current.phi;
      persistentSceneState.cameraRadius = orbitStateRef.current.radius;
      if (!persistentSceneState.peerAnomalies) persistentSceneState.peerAnomalies = {};
      peerNodesRef.current.forEach((node) => {
        persistentSceneState.peerAnomalies![node.preset.id] = node.anomaly;
      });

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

    const onVisibilityChange = () => {
      if (!document.hidden) {
        lastTimeMs = performance.now();
        lastRenderMs = performance.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelAnimationFrame(animId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('click', onClick);
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
      const mat = (targetCubeMeshRef.current as any).material as THREE.SpriteMaterial;
      if (mat && mat.color) {
        mat.color.setHex(target.is_in_fov ? 0x10b981 : 0xff3366);
      }
    }
  }, [target, worldWidth, worldHeight]);

  const resetCameraView = () => {
    focusModeRef.current = 'earth';
    setFocusMode('earth');
    orbitStateRef.current = { theta: 0.75, phi: 0.45, radius: 340.0 };
  };

  // Synchronize atmosphere shells & reference rings visibility with toggle state (Task 3)
  useEffect(() => {
    if (atmosphereGroupRef.current) {
      atmosphereGroupRef.current.visible = showAtmosphereShells;
    }
    if (karmanRingRef.current) {
      karmanRingRef.current.visible = showAtmosphereShells || showReferenceRings;
    }
    if (karmanLabelRef.current) {
      karmanLabelRef.current.visible = showAtmosphereShells || showReferenceRings;
    }
    if (referenceRingsGroupRef.current) {
      referenceRingsGroupRef.current.visible = showReferenceRings;
    }
    if (sunGroupRef.current) {
      sunGroupRef.current.visible = showSunTerminator;
    }
    if (nightShadingMeshRef.current) {
      nightShadingMeshRef.current.visible = false;
    }
    if (realisticEarthAssemblyRef.current?.setShowSunTerminator) {
      realisticEarthAssemblyRef.current.setShowSunTerminator(showSunTerminator);
    }
    if (footprintGroupRef.current) {
      footprintGroupRef.current.visible = showFootprint;
    }
  }, [showAtmosphereShells, showReferenceRings, showSunTerminator, showFootprint]);

  const activePreset = LEO_PRESETS.find((p) => p.id === selectedPresetId);

  return (
    <div className="relative w-full h-full flex flex-col bg-[#000000] border border-[#33362F] rounded-lg overflow-hidden">
      {/* 3D Viewport Canvas & Isolated HUD Layer (prevents any HUD overlay from overlapping the controls bar) */}
      <div className="relative flex-1 w-full h-full min-h-[380px] overflow-hidden">
        {/* Three.js Canvas Mount */}
        <div
          ref={mountRef}
          className={`w-full h-full ${isDrawingPath ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
        />

        {/* Floating Quick Locate Buttons (Unrestricted global access) */}
        {!isDrawingPath && (
          <div className="absolute bottom-3 right-4 z-20 pointer-events-auto flex items-center gap-2">
            <button
              onClick={handleLocateSatellite}
              className="bg-[#1B1D1A]/95 hover:bg-[#262824] border border-[#33362F] hover:border-[#FF5F40] text-[#F0FFEA] rounded px-3 py-1.5 flex items-center gap-1.5 text-xs font-mono transition group cursor-pointer"
              title="Instantly orient camera to face satellite on the globe (Shortcut: S)"
            >
              <Satellite className="w-3.5 h-3.5 text-[#FF5F40] group-hover:scale-110 transition" />
              <span className="font-semibold text-[11px]">LOCATE SATELLITE</span>
            </button>
            <button
              onClick={handleLocateBeacon}
              className="bg-[#1B1D1A]/95 hover:bg-[#262824] border border-[#33362F] hover:border-[#FF5F40] text-[#F0FFEA] rounded px-3 py-1.5 flex items-center gap-1.5 text-xs font-mono transition group cursor-pointer"
              title="Instantly orient camera to face beacon on the globe (Shortcut: B)"
            >
              <Radio className="w-3.5 h-3.5 text-[#FF5F40] group-hover:scale-110 transition" />
              <span className="font-semibold text-[11px]">LOCATE BEACON</span>
            </button>
          </div>
        )}

        {/* Draw Mode Top Floating Indicator Banner (Only shown if Beacon Path Planner panel is closed) */}
        {isDrawingPath && !showBeaconPathPlanner && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-[#1B1D1A]/95 border border-[#FF5F40] text-[#F0FFEA] text-xs font-mono px-4 py-1.5 rounded shadow-2xl z-30 flex items-center gap-3 pointer-events-auto animate-in fade-in slide-in-from-top-2 duration-150">
            <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F40] animate-ping" />
            <span className="font-semibold">
              DRAW MODE ACTIVE: Click on 3D Earth to plot waypoints ({beaconPathWaypoints.length} placed) · Pt 1 is Start, Pt {beaconPathWaypoints.length || 4} is End
            </span>
            <button
              onClick={handleUndoLastWaypoint}
              disabled={beaconPathWaypoints.length === 0}
              className="px-2 py-0.5 rounded bg-[#262824] hover:bg-[#1B1D1A] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40] text-[10px] font-bold transition flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Undo last placed waypoint (Ctrl+Z)"
            >
              <Undo2 className="w-3 h-3 text-[#FF5F40]" />
              <span>Undo</span>
            </button>
            <button
              onClick={() => setIsDrawingPath(false)}
              className="px-2 py-0.5 rounded bg-[#FF5F40] hover:bg-[#FF7459] text-[#0A0A0A] text-[10px] font-bold transition"
            >
              Done
            </button>
          </div>
        )}

        {/* 3D Beacon Ground Path Planner Drawer / Floating Card */}
        {showBeaconPathPlanner && (
          <div
            className={`absolute ${getPlannerPositionClass()} z-30 font-mono text-xs text-[#F0FFEA] pointer-events-auto select-none transition-all duration-200 ${
              isPathPlannerMinimized ? 'w-auto' : 'w-84 max-w-[calc(100%-24px)]'
            }`}
          >
            {isPathPlannerMinimized ? (
              <div
                className="bg-[#1B1D1A]/95 border border-[#33362F] hover:border-[#FF5F40] rounded px-3 py-1.5 flex items-center gap-2.5 cursor-pointer transition"
                onClick={() => setIsPathPlannerMinimized(false)}
                title="Click to expand 3D Beacon Ground Path Planner"
              >
                <div className="flex items-center gap-1.5 text-[#FF5F40] font-bold text-[9px] uppercase tracking-wider">
                  <MapPin className="w-3.5 h-3.5 text-[#FF5F40] shrink-0" />
                  <span>BEACON PATH</span>
                </div>
                <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold bg-[#262824] text-[#F0FFEA] border border-[#33362F]">
                  {beaconPathWaypoints.length} PTS
                </span>
                <span className={`text-[8.5px] font-bold ${isDrawingPath ? 'text-[#FF5F40] animate-pulse' : pathMotionActive ? 'text-[#FF5F40] animate-pulse' : 'text-[#9CA195]'}`}>
                  {isDrawingPath ? 'DRAWING' : pathMotionActive ? 'RUNNING' : 'STOPPED'}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    cyclePathPlannerPosition();
                  }}
                  className="p-1 hover:bg-[#262824] text-[#9CA195] hover:text-[#F0FFEA] rounded transition cursor-pointer"
                  title={`Docked at ${pathPlannerPosition}. Click to cycle position.`}
                  aria-label="Cycle panel position"
                >
                  <Move className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsPathPlannerMinimized(false);
                  }}
                  className="p-0.5 hover:bg-[#262824] text-[#9CA195] hover:text-[#F0FFEA] rounded transition cursor-pointer"
                  title="Expand path planner"
                  aria-label="Expand path planner"
                >
                  <ChevronDown className="w-3.5 h-3.5 text-[#FF5F40]" />
                </button>
              </div>
            ) : (
              <div className="bg-[#1B1D1A]/95 border border-[#33362F] rounded-lg p-3 space-y-2.5 max-h-[calc(100vh-220px)] overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-150">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-[#33362F] pb-1.5">
                  <div className="flex items-center gap-1.5 text-[#FF5F40] font-bold text-xs">
                    <MapPin className="w-4 h-4 text-[#FF5F40]" />
                    <span>BEACON 3D GROUND PATH</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={cyclePathPlannerPosition}
                      className="text-[#9CA195] hover:text-[#F0FFEA] p-1 rounded hover:bg-[#262824] transition"
                      title={`Docked at ${pathPlannerPosition}. Click to cycle position.`}
                      aria-label="Cycle panel position"
                    >
                      <Move className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsPathPlannerMinimized(true)}
                      className="text-[#9CA195] hover:text-[#F0FFEA] p-0.5 rounded transition"
                      title="Minimize panel"
                      aria-label="Minimize panel"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBeaconPathPlanner(false)}
                      className="text-[#9CA195] hover:text-[#F0FFEA] p-0.5 rounded transition"
                      title="Close panel"
                      aria-label="Close panel"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Draw Mode Active Banner (Integrated inside card) */}
                {isDrawingPath && (
                  <div className="bg-[#262824] border border-[#FF5F40] rounded p-2 text-[#F0FFEA] text-[10.5px] flex items-center justify-between gap-2 animate-in fade-in duration-150">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="w-2 h-2 rounded-full bg-[#FF5F40] animate-ping shrink-0" />
                      <span className="truncate">Click 3D Earth to plot waypoints ({beaconPathWaypoints.length} placed)</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={handleUndoLastWaypoint}
                        disabled={beaconPathWaypoints.length === 0}
                        className="px-1.5 py-0.5 rounded bg-[#1B1D1A] hover:bg-[#262824] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40] text-[9.5px] font-bold flex items-center gap-1 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Undo last waypoint (Ctrl+Z)"
                      >
                        <Undo2 className="w-2.5 h-2.5 text-[#FF5F40]" />
                        <span>Undo</span>
                      </button>
                      <button
                        onClick={() => setIsDrawingPath(false)}
                        className="px-2 py-0.5 rounded bg-[#FF5F40] hover:bg-[#FF7459] text-[#0A0A0A] text-[9.5px] font-bold transition"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}

                {/* Primary Motion Controls */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    {!pathMotionActive ? (
                      <button
                        onClick={handleStartPathMotion}
                        disabled={beaconPathWaypoints.length < 2}
                        className="flex-1 px-2.5 py-1.5 rounded bg-[#FF5F40] hover:bg-[#FF7459] text-[#0A0A0A] text-xs flex items-center justify-center gap-1.5 font-bold transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Play className="w-3.5 h-3.5 fill-[#0A0A0A] text-[#0A0A0A]" />
                        <span>
                          {pathLegIndexRef.current >= beaconPathWaypoints.length - 2 && pathLegProgressRef.current >= 1.0
                            ? `Restart Path (Pt 1→${beaconPathWaypoints.length})`
                            : `Start Motion (${beaconPathWaypoints.length} pts)`}
                        </span>
                      </button>
                    ) : (
                      <button
                        onClick={handlePausePathMotion}
                        className="flex-1 px-2.5 py-1.5 rounded bg-[#262824] hover:bg-[#1B1D1A] text-[#FF5F40] border border-[#FF5F40] text-xs flex items-center justify-center gap-1.5 font-bold transition"
                      >
                        <Pause className="w-3.5 h-3.5 fill-[#FF5F40] text-[#FF5F40]" />
                        <span>Pause Motion</span>
                      </button>
                    )}

                    <button
                      onClick={handleResetPathToStart}
                      disabled={beaconPathWaypoints.length === 0}
                      className="px-2 py-1.5 rounded bg-[#262824] hover:bg-[#1B1D1A] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40] text-xs flex items-center gap-1 transition disabled:opacity-40"
                      title="Reset beacon back to Point 1 (Starting Point)"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-[#FF5F40]" />
                      <span>Pt 1</span>
                    </button>
                  </div>

                  {/* Draw Custom Path & Preset 1->4 Action Strip */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={handleToggleDrawMode}
                      className={`px-2 py-1 rounded text-[11px] border flex items-center justify-center gap-1 transition ${
                        isDrawingPath
                          ? 'bg-[#FF5F40]/25 text-[#FF5F40] border-[#FF5F40] font-bold'
                          : 'bg-[#262824] hover:bg-[#1B1D1A] text-[#F0FFEA] border-[#33362F] hover:border-[#FF5F40]'
                      }`}
                      title="Click anywhere on the 3D Earth globe to plot custom waypoints"
                    >
                      <PenTool className="w-3 h-3 text-[#FF5F40]" />
                      <span>{isDrawingPath ? 'Plotting…' : 'Draw Custom'}</span>
                    </button>

                    <button
                      onClick={handleLoadPreset4PointPath}
                      className="px-2 py-1 rounded text-[11px] bg-[#262824] hover:bg-[#1B1D1A] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40] flex items-center justify-center gap-1 transition"
                      title="Load 4-Point Path from reference image (1=Start, 4=End)"
                    >
                      <CheckCircle className="w-3 h-3 text-[#FF5F40]" />
                      <span>Preset 1→4</span>
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-[#9CA195] px-0.5">
                    <span>Min 2 pts · Stops at end (Pt {beaconPathWaypoints.length || 4})</span>
                  </div>

                  {/* Undo Point & Delete Path Action Buttons */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={handleUndoLastWaypoint}
                      disabled={beaconPathWaypoints.length === 0}
                      className="px-2 py-1.5 rounded bg-[#262824] hover:bg-[#1B1D1A] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40] text-[10.5px] flex items-center justify-center gap-1.5 font-semibold transition disabled:opacity-35 disabled:cursor-not-allowed"
                      title="Undo the last waypoint placed on the beacon path (Ctrl+Z)"
                    >
                      <Undo2 className="w-3.5 h-3.5 text-[#FF5F40]" />
                      <span>Undo Point</span>
                    </button>

                    <button
                      onClick={handleClearBeaconPath}
                      disabled={beaconPathWaypoints.length === 0}
                      className="px-2 py-1.5 rounded bg-[#262824] hover:bg-[#1B1D1A] text-[#9CA195] hover:text-[#FF5F40] border border-[#33362F] hover:border-[#FF5F40] text-[10.5px] flex items-center justify-center gap-1.5 font-semibold transition disabled:opacity-35 disabled:cursor-not-allowed"
                      title="Delete all beacon path waypoints and clear the 3D path line from the simulation"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-[#FF5F40]" />
                      <span>Delete Path</span>
                    </button>
                  </div>
                </div>

                {/* Live Status Readout */}
                <div className="bg-[#262824] border border-[#33362F] p-2 rounded space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-[#9CA195]">Path Status:</span>
                    <span
                      className={`font-bold ${
                        pathMotionActive
                          ? 'text-[#FF5F40] animate-pulse'
                          : pathLegProgressRef.current >= 1.0 && pathLegIndexRef.current >= beaconPathWaypoints.length - 2
                          ? 'text-[#F0FFEA] font-bold'
                          : 'text-[#9CA195]'
                      }`}
                    >
                      {pathStatusText}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-[#1B1D1A] h-1.5 rounded-full overflow-hidden border border-[#33362F]">
                    <div
                      className="h-full transition-all duration-150 bg-[#FF5F40]"
                      style={{ width: `${pathOverallProgressPct}%` }}
                    />
                  </div>

                  <div className="flex justify-between items-center text-[9px] text-[#9CA195]">
                    <span>{pathCurrentLegDisplay}</span>
                    <span>{pathOverallProgressPct}% Completed</span>
                  </div>
                </div>

                {/* Plotted Waypoints List */}
                <div className="border border-[#33362F] rounded bg-[#262824] p-1.5 space-y-1">
                  <div className="text-[10px] text-[#9CA195] uppercase tracking-wider flex justify-between items-center">
                    <span>Plotted Waypoints ({beaconPathWaypoints.length})</span>
                    <button
                      onClick={handleUndoLastWaypoint}
                      disabled={beaconPathWaypoints.length === 0}
                      className="text-[9px] text-[#FF5F40] hover:underline flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed transition font-semibold"
                      title="Undo last plotted waypoint (Ctrl+Z)"
                    >
                      <Undo2 className="w-2.5 h-2.5" />
                      <span>Undo</span>
                    </button>
                  </div>
                  <div className="space-y-1 max-h-28 overflow-y-auto pr-0.5">
                    {beaconPathWaypoints.map((wp, idx) => {
                      const isStart = idx === 0;
                      const isEnd = idx === beaconPathWaypoints.length - 1 && beaconPathWaypoints.length >= 2;
                      const isCurrent = pathLegIndexRef.current === idx && pathMotionActive;
                      return (
                        <div
                          key={wp.id}
                          className={`flex items-center justify-between px-1.5 py-0.5 rounded text-[9.5px] font-mono border ${
                            isCurrent
                              ? 'bg-[#FF5F40]/15 border-[#FF5F40] text-[#F0FFEA]'
                              : 'bg-[#1B1D1A] border-[#33362F] text-[#F0FFEA]'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold ${
                                isStart
                                  ? 'bg-[#FF5F40] text-[#0A0A0A]'
                                  : isEnd
                                  ? 'bg-[#F0FFEA] text-[#0A0A0A]'
                                  : 'bg-[#262824] text-[#F0FFEA] border border-[#33362F]'
                              }`}
                            >
                              {wp.id}
                            </span>
                            <span className={isStart ? 'text-[#FF5F40] font-bold' : isEnd ? 'text-[#F0FFEA] font-bold' : 'text-[#9CA195]'}>
                              {isStart ? '1 (START)' : isEnd ? `${wp.id} (END)` : `Point ${wp.id}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[#9CA195] text-[8.5px]">
                              {wp.latDeg.toFixed(1)}°, {wp.lonDeg.toFixed(1)}°
                            </span>
                            <button
                              onClick={() => handleRemoveWaypoint(idx)}
                              className="text-[#9CA195] hover:text-[#FF5F40] p-0.5 rounded transition"
                              title={`Remove Point ${wp.id}`}
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Speed & Warp Control */}
                <div className="border-t border-[#33362F] pt-1.5 space-y-1 text-[10px]">
                  <div className="flex justify-between items-center text-[#9CA195]">
                    <span>Beacon Ground Speed:</span>
                    <span className="text-[#FF5F40] font-bold">{beaconSpeedKmh} km/h · {beaconSpeedKmh} px/s</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="1200"
                    step="25"
                    value={beaconSpeedKmh}
                    onChange={(e) => {
                      const spd = Number(e.target.value);
                      setBeaconSpeedKmh(spd);
                      beaconMotionRef.current.speedKmh = spd;
                      satellitePovSync.update({ beaconSpeedKmh: spd });
                    }}
                    className="w-full h-1.5 bg-[#262824] rounded-lg appearance-none cursor-pointer accent-[#FF5F40]"
                  />
                  <div className="flex justify-between gap-1 pt-0.5">
                    {[
                      { label: 'UAV 150', speed: 150 },
                      { label: 'Jet 450', speed: 450 },
                      { label: 'Fast 900', speed: 900 },
                    ].map((r) => (
                      <button
                        key={r.label}
                        onClick={() => {
                          setBeaconSpeedKmh(r.speed);
                          beaconMotionRef.current.speedKmh = r.speed;
                          satellitePovSync.update({ beaconSpeedKmh: r.speed });
                        }}
                        className={`flex-1 py-0.5 rounded text-[9px] border transition ${
                          beaconSpeedKmh === r.speed
                            ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] font-bold'
                            : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quick Reposition & Field of View Status */}
                <div className="border-t border-[#33362F] pt-1.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleCenterTargetOnGlobe}
                      className="flex-1 px-2 py-1 rounded bg-[#262824] hover:bg-[#1B1D1A] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40] text-[10px] flex items-center justify-center gap-1 font-medium transition"
                      title="Center target in satellite optical boresight"
                    >
                      <Crosshair className="w-3 h-3 text-[#FF5F40]" />
                      <span>Center Target</span>
                    </button>
                    <button
                      onClick={handleDisplaceTargetOutsideFov}
                      className="flex-1 px-2 py-1 rounded bg-[#262824] hover:bg-[#1B1D1A] text-[#9CA195] hover:text-[#FF5F40] border border-[#33362F] hover:border-[#FF5F40] text-[10px] flex items-center justify-center gap-1 font-medium transition"
                      title="Displace target outside optical FOV"
                    >
                      <Maximize2 className="w-3 h-3 text-[#FF5F40]" />
                      <span>Displace FOV</span>
                    </button>
                  </div>

                  <div className="flex justify-between items-center text-[10px] bg-[#262824] p-1.5 rounded border border-[#33362F]">
                    <span className="text-[#9CA195]">Status:</span>
                    <span
                      ref={cameraFovStatusRef}
                      className={`font-bold ${!isOccludedByEarth && isBeaconInFootprint ? 'text-[#F0FFEA]' : 'text-[#FF5F40]'}`}
                    >
                      {!isOccludedByEarth && isBeaconInFootprint ? '✓ IN FIELD OF VIEW' : '[!] OUTSIDE FIELD OF VIEW'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Interactive Orbit Tuner Drawer / Popover */}
        {showOrbitTuner && (
          <div className="absolute top-3 left-3 w-80 max-h-[calc(100%-24px)] overflow-y-auto bg-[#1B1D1A]/95 backdrop-blur-md border border-[#33362F] rounded-lg p-3 font-mono text-xs text-[#F0FFEA] shadow-2xl z-30 space-y-3 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between border-b border-[#33362F] pb-1.5">
            <div className="flex items-center gap-1.5 text-[#FF5F40] font-bold text-xs">
              <Orbit className="w-4 h-4 text-[#FF5F40]" />
              <span>SATELLITE ORBIT TUNER</span>
            </div>
            <button
              onClick={() => setShowOrbitTuner(false)}
              className="text-[#9CA195] hover:text-[#F0FFEA] p-0.5 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Scale Mode Selector in Tuner */}
          <div className="border-b border-[#33362F] pb-2">
            <div className="flex justify-between items-center text-[#9CA195] mb-1 text-[10px]">
              <span className="uppercase tracking-wider">3D Scale Mode:</span>
              <span className="text-[#FF5F40] font-bold">
                {scaleMode === 'TRUE_SCALE' ? '1:1 True Physical' : 'Readable Logarithmic'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => handleScaleModeChange('TRUE_SCALE')}
                className={`px-2 py-1 rounded text-center border text-[10px] transition ${
                  scaleMode === 'TRUE_SCALE'
                    ? 'bg-[#FF5F40]/15 text-[#F0FFEA] border-[#FF5F40] font-bold'
                    : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
                }`}
              >
                True Scale (R=100u)
              </button>
              <button
                onClick={() => handleScaleModeChange('READABLE_SCALE')}
                className={`px-2 py-1 rounded text-center border text-[10px] transition ${
                  scaleMode === 'READABLE_SCALE'
                    ? 'bg-[#FF5F40]/15 text-[#F0FFEA] border-[#FF5F40] font-bold'
                    : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
                }`}
              >
                Readable Scale
              </button>
            </div>

            {/* Earth Render Radius Slider */}
            <div className="pt-2">
              <div className="flex justify-between items-center text-[#9CA195] mb-1 text-[10px]">
                <span>Earth Render Radius ($R_E$):</span>
                <span className="text-[#FF5F40] font-bold font-mono">{earthRenderRadius.toFixed(0)}u = 6,378 km</span>
              </div>
              <input
                type="range"
                min="50"
                max="200"
                step="5"
                value={earthRenderRadius}
                onChange={(e) => handleEarthRenderRadiusChange(Number(e.target.value))}
                className="w-full h-1.5 bg-[#262824] rounded-lg appearance-none cursor-pointer accent-[#FF5F40]"
                title="Adjust Earth 3D render radius"
              />
            </div>
          </div>

          {/* Atmosphere Shells & Kármán Line Control */}
          <div className="border-b border-[#33362F] pb-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5 text-[#FF5F40] font-bold uppercase tracking-wider">
                <Layers className="w-3.5 h-3.5 text-[#FF5F40]" />
                <span>Atmosphere Layers:</span>
              </div>
              <button
                onClick={() => setShowAtmosphereShells(!showAtmosphereShells)}
                className={`px-2 py-0.5 rounded text-[10px] border transition ${
                  showAtmosphereShells
                    ? 'bg-[#FF5F40]/15 text-[#F0FFEA] border-[#FF5F40] font-bold'
                    : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
                }`}
              >
                {showAtmosphereShells ? 'Visible (ON)' : 'Hidden (OFF)'}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1 text-[9px] font-mono">
              <div className="bg-[#262824] border border-[#33362F] p-1 rounded">
                <div className="text-[#F0FFEA] font-bold">0–20 km</div>
                <div className="text-[#9CA195] text-[8px] leading-tight">Turbulence Zone</div>
                <div className="text-[#9CA195] text-[8px]">{formatAltAndUnits(20, scaleMode)}</div>
              </div>
              <div className="bg-[#262824] border border-[#33362F] p-1 rounded">
                <div className="text-[#F0FFEA] font-bold">20–100 km</div>
                <div className="text-[#9CA195] text-[8px] leading-tight">Thin Atmosphere</div>
                <div className="text-[#9CA195] text-[8px]">{formatAltAndUnits(100, scaleMode)}</div>
              </div>
              <div className="bg-[#262824] border border-[#33362F] p-1 rounded">
                <div className="text-[#FF5F40] font-bold">100 km</div>
                <div className="text-[#9CA195] text-[8px] leading-tight">Kármán Line</div>
                <div className="text-[#9CA195] text-[8px]">{formatAltAndUnits(100, scaleMode)}</div>
              </div>
            </div>
          </div>

          {/* Standard Reference Altitude Rings Control */}
          <div className="border-b border-[#33362F] pb-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5 text-[#FF5F40] font-bold uppercase tracking-wider">
                <Compass className="w-3.5 h-3.5 text-[#FF5F40]" />
                <span>Reference Altitude Rings:</span>
              </div>
              <button
                onClick={() => setShowReferenceRings(!showReferenceRings)}
                className={`px-2 py-0.5 rounded text-[10px] border transition ${
                  showReferenceRings
                    ? 'bg-[#FF5F40]/15 text-[#F0FFEA] border-[#FF5F40] font-bold'
                    : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
                }`}
              >
                {showReferenceRings ? 'Visible (ON)' : 'Hidden (OFF)'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1 text-[9px] font-mono">
              {REFERENCE_ALTITUDES.map((spec) => (
                <div
                  key={spec.id}
                  className="bg-[#262824] border border-[#33362F] p-1 rounded"
                >
                  <div className="font-bold flex items-center justify-between text-[#F0FFEA]">
                    <span>{spec.name}</span>
                    <span className="text-[7.5px] uppercase text-[#9CA195]">{spec.shortTag}</span>
                  </div>
                  <div className="text-[#9CA195] text-[8.5px] font-medium pt-0.5">
                    {formatAltAndUnits(spec.altKm, scaleMode)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sun Direction & Day/Night Terminator Control */}
          <div className="border-b border-[#33362F] pb-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5 text-[#FF5F40] font-bold uppercase tracking-wider">
                <Sun className="w-3.5 h-3.5 text-[#FF5F40]" />
                <span>Sun Direction & Terminator:</span>
              </div>
              <button
                onClick={() => setShowSunTerminator(!showSunTerminator)}
                className={`px-2 py-0.5 rounded text-[10px] border transition ${
                  showSunTerminator
                    ? 'bg-[#FF5F40]/15 text-[#F0FFEA] border-[#FF5F40] font-bold'
                    : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
                }`}
              >
                {showSunTerminator ? 'Visible (ON)' : 'Hidden (OFF)'}
              </button>
            </div>
            <div className="text-[9px] text-[#9CA195] leading-tight">
              Fixed ECI solar vector with perpendicular day/night terminator circle & shaded night hemisphere.
            </div>
          </div>

          {/* Active Satellite Ground Footprint */}
          <div className="border-b border-[#33362F] pb-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5 text-[#FF5F40] font-bold uppercase tracking-wider">
                <Target className="w-3.5 h-3.5 text-[#FF5F40]" />
                <span>Ground Footprint Mask:</span>
              </div>
              <button
                onClick={() => setShowFootprint(!showFootprint)}
                className={`px-2 py-0.5 rounded text-[10px] border transition ${
                  showFootprint
                    ? 'bg-[#FF5F40]/15 text-[#F0FFEA] border-[#FF5F40] font-bold'
                    : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
                }`}
              >
                {showFootprint ? 'Visible (ON)' : 'Hidden (OFF)'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1 text-[9px] font-mono">
              <div className="bg-[#262824] border border-[#33362F] p-1 rounded">
                <div className="text-[#9CA195] text-[8px]">Min Elevation (ε)</div>
                <div className="text-[#F0FFEA] font-bold">10.0°</div>
              </div>
              <div className="bg-[#262824] border border-[#33362F] p-1 rounded">
                <div className="text-[#9CA195] text-[8px]">Angular Radius (θ)</div>
                <div className="text-[#F0FFEA] font-bold">{footprintThetaDeg.toFixed(1)}° (~{Math.round(footprintGroundRadiusKm)} km)</div>
              </div>
              <div className="col-span-2 bg-[#262824] border border-[#33362F] p-1 rounded flex justify-between items-center">
                <span className="text-[#9CA195] text-[8px]">Beacon Status:</span>
                <span className={isBeaconInFootprint ? 'text-[#F0FFEA] font-bold' : 'text-[#FF5F40] font-bold'}>
                  {isBeaconInFootprint ? `✓ IN COVERAGE (El = ${beaconElevationDeg.toFixed(1)}°)` : `[!] OUTSIDE (El = ${beaconElevationDeg.toFixed(1)}°)`}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Preset Selector Buttons */}
          <div>
            <div className="text-[10px] text-[#9CA195] uppercase tracking-wider mb-1.5">Quick Presets:</div>
            <div className="grid grid-cols-2 gap-1.5">
              {ORBIT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handlePresetSelect(p.id)}
                  className={`px-2 py-1 text-[10px] rounded text-left border truncate transition ${
                    selectedPresetId === p.id
                      ? 'bg-[#FF5F40]/15 text-[#F0FFEA] border-[#FF5F40] font-semibold'
                      : 'bg-[#262824] hover:bg-[#1B1D1A] text-[#9CA195] hover:text-[#F0FFEA] border-[#33362F]'
                  }`}
                  title={p.description}
                >
                  {p.shortName}
                </button>
              ))}
            </div>
          </div>

          {/* Informational Re-initialization Note */}
          <div className="bg-[#262824] border border-[#33362F] p-2 rounded text-[10px] text-[#9CA195] leading-tight">
            <span className="text-[#FF5F40] font-bold">Orbit Re-initialization:</span> Instant Keplerian state re-initialization.
          </div>

          {/* Live Derived Values Panel */}
          <div className="bg-[#262824] border border-[#33362F] p-2 rounded space-y-1 text-[10px]">
            <div className="text-[#FF5F40] font-bold uppercase tracking-wider text-[9px] border-b border-[#33362F] pb-0.5 flex justify-between">
              <span>Live Derived Keplerian Metrics</span>
              <span className="text-[#F0FFEA] font-mono">Vis-Viva Active</span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1 font-mono">
              <div>
                <span className="text-[#9CA195]">Semi-major ($a$):</span>{' '}
                <span className="text-[#F0FFEA] font-bold">
                  {formatDistAndUnits(derivedA, getRenderOrbitRadius(derivedA - EARTH_RADIUS_KM, scaleMode))}
                </span>
              </div>
              <div>
                <span className="text-[#9CA195]">Eccentricity ($e$):</span>{' '}
                <span className="text-[#F0FFEA] font-bold">{derivedE.toFixed(4)}</span>
              </div>
              <div>
                <span className="text-[#9CA195]">Current dist ($r$):</span>{' '}
                <span className="text-[#F0FFEA] font-bold">
                  {formatDistAndUnits(derivedR, getRenderOrbitRadius(derivedR - EARTH_RADIUS_KM, scaleMode))}
                </span>
              </div>
              <div className="col-span-2 pt-0.5 border-t border-[#33362F] flex justify-between">
                <span className="text-[#9CA195]">Real Speed ($v$):</span>{' '}
                <span className="text-[#FF5F40] font-bold">{formatOrbitalSpeed(derivedSpeed)}</span>
              </div>
              <div className="col-span-2 pt-0.5 border-t border-[#33362F] flex justify-between">
                <span className="text-[#9CA195]">Orbital Period ($T$):</span>
                <span className="text-[#F0FFEA] font-bold">{formatOrbitalPeriod(derivedPeriodSec)}</span>
              </div>
              <div className="col-span-2 pt-0.5 border-t border-[#33362F] flex justify-between">
                <span className="text-[#9CA195]">Current Altitude ($h$):</span>
                <span className="text-[#F0FFEA] font-bold">
                  {formatAltAndUnits(derivedR - EARTH_RADIUS_KM, scaleMode)}
                </span>
              </div>
            </div>
          </div>

          {/* Validation Warnings */}
          {orbitPerigeeKm < 150 && (
            <div className="bg-[#1B1D1A] border border-[#FF5F40] p-1.5 rounded text-[10px] text-[#FF5F40] font-bold">
              [!] Atmospheric Drag Violation: Perigee ({orbitPerigeeKm} km) must be ≥ 150 km.
            </div>
          )}
          {orbitApogeeKm < orbitPerigeeKm && (
            <div className="bg-[#1B1D1A] border border-[#FF5F40] p-1.5 rounded text-[10px] text-[#FF5F40] font-bold">
              [!] Invalid Geometry: Apogee ({orbitApogeeKm} km) must be ≥ Perigee ({orbitPerigeeKm} km).
            </div>
          )}

          {/* Manual Dials (UI) */}
          <div className="space-y-2 border-t border-[#33362F] pt-2 text-[11px]">
            {/* Perigee Altitude (hp) */}
            <div>
              <div className="flex justify-between items-center text-[#9CA195] mb-0.5 text-[10px]">
                <span>
                  Perigee Alt ($h_p$):{' '}
                  <span className="text-[#5E625A] font-mono text-[9px]">
                    ({getRenderOrbitRadius(orbitPerigeeKm, scaleMode).toFixed(1)}u)
                  </span>
                </span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="150"
                    max="45000"
                    step="25"
                    value={orbitPerigeeKm}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      handleCustomParamChange(val, Math.max(val, orbitApogeeKm), orbitInc, orbitRaan, orbitArgPerigeeDeg);
                    }}
                    className={`w-16 bg-[#262824] border rounded px-1 py-0.5 text-right font-bold font-mono text-[10px] ${
                      orbitPerigeeKm < 150 ? 'border-[#FF5F40] text-[#FF5F40]' : 'border-[#33362F] text-[#F0FFEA]'
                    }`}
                  />
                  <span className="text-[#9CA195]">km</span>
                </div>
              </div>
              <input
                type="range"
                min="150"
                max="2500"
                step="25"
                value={Math.min(2500, Math.max(150, orbitPerigeeKm))}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  handleCustomParamChange(val, Math.max(val, orbitApogeeKm), orbitInc, orbitRaan, orbitArgPerigeeDeg);
                }}
                className="w-full h-1.5 bg-[#262824] rounded-lg appearance-none cursor-pointer accent-[#FF5F40]"
                title="Perigee altitude slider (min 150 km drag limit)"
              />
            </div>

            {/* Apogee Altitude (ha) */}
            <div>
              <div className="flex justify-between items-center text-[#9CA195] mb-0.5 text-[10px]">
                <span>
                  Apogee Alt ($h_a$):{' '}
                  <span className="text-[#5E625A] font-mono text-[9px]">
                    ({getRenderOrbitRadius(orbitApogeeKm, scaleMode).toFixed(1)}u)
                  </span>
                </span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={orbitPerigeeKm}
                    max="45000"
                    step="50"
                    value={orbitApogeeKm}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      handleCustomParamChange(orbitPerigeeKm, val, orbitInc, orbitRaan, orbitArgPerigeeDeg);
                    }}
                    className={`w-16 bg-[#262824] border rounded px-1 py-0.5 text-right font-bold font-mono text-[10px] ${
                      orbitApogeeKm < orbitPerigeeKm ? 'border-[#FF5F40] text-[#FF5F40]' : 'border-[#33362F] text-[#F0FFEA]'
                    }`}
                  />
                  <span className="text-[#9CA195]">km</span>
                </div>
              </div>
              <input
                type="range"
                min="150"
                max="36000"
                step="100"
                value={Math.min(36000, Math.max(orbitPerigeeKm, orbitApogeeKm))}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  handleCustomParamChange(orbitPerigeeKm, val, orbitInc, orbitRaan, orbitArgPerigeeDeg);
                }}
                className="w-full h-1.5 bg-[#262824] rounded-lg appearance-none cursor-pointer accent-[#FF5F40]"
                title="Apogee altitude slider (min = perigee)"
              />
            </div>

            {/* Inclination (i) */}
            <div>
              <div className="flex justify-between items-center text-[#9CA195] mb-0.5 text-[10px]">
                <span>Inclination ($i$):</span>
                <span className="text-[#F0FFEA] font-bold">{orbitInc.toFixed(1)}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="180"
                step="0.5"
                value={orbitInc}
                onChange={(e) => handleCustomParamChange(orbitPerigeeKm, orbitApogeeKm, Number(e.target.value), orbitRaan, orbitArgPerigeeDeg)}
                className="w-full h-1.5 bg-[#262824] rounded-lg appearance-none cursor-pointer accent-[#FF5F40]"
              />
            </div>

            {/* RAAN (Omega) */}
            <div>
              <div className="flex justify-between items-center text-[#9CA195] mb-0.5 text-[10px]">
                <span>RAAN ($\Omega$):</span>
                <span className="text-[#F0FFEA] font-bold">{orbitRaan.toFixed(1)}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={orbitRaan}
                onChange={(e) => handleCustomParamChange(orbitPerigeeKm, orbitApogeeKm, orbitInc, Number(e.target.value), orbitArgPerigeeDeg)}
                className="w-full h-1.5 bg-[#262824] rounded-lg appearance-none cursor-pointer accent-[#FF5F40]"
              />
            </div>

            {/* Argument of Perigee (omega) */}
            <div>
              <div className="flex justify-between items-center text-[#9CA195] mb-0.5 text-[10px]">
                <span>Arg of Perigee ($\omega$):</span>
                <span className="text-[#F0FFEA] font-bold">{orbitArgPerigeeDeg.toFixed(1)}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={orbitArgPerigeeDeg}
                onChange={(e) => handleCustomParamChange(orbitPerigeeKm, orbitApogeeKm, orbitInc, orbitRaan, Number(e.target.value))}
                className="w-full h-1.5 bg-[#262824] rounded-lg appearance-none cursor-pointer accent-[#FF5F40]"
              />
            </div>

            {/* True Anomaly / Orbit Position Scrubber */}
            <div>
              <div className="flex justify-between items-center text-[#9CA195] mb-0.5 text-[10px]">
                <span>Starting True Anomaly ($\nu_0$):</span>
                <span className="text-[#F0FFEA] font-bold">{orbitAnomalyDeg.toFixed(0)}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={orbitAnomalyDeg}
                onChange={(e) => {
                  const deg = Number(e.target.value);
                  handleCustomParamChange(orbitPerigeeKm, orbitApogeeKm, orbitInc, orbitRaan, orbitArgPerigeeDeg, deg);
                }}
                className="w-full h-1.5 bg-[#262824] rounded-lg appearance-none cursor-pointer accent-[#FF5F40]"
              />
            </div>
          </div>

          {/* Physical Simulation Time Warp Controls */}
          <div className="border-t border-[#33362F] pt-2 text-[10px] space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[#9CA195] font-bold uppercase tracking-wider">Physics Time Warp:</span>
              <span className="text-[#FF5F40] font-bold">
                {simTimeWarp}× {simTimeWarp === 1 ? '(Real-Time)' : `(1s = ${simTimeWarp >= 60 ? `${simTimeWarp / 60}m` : `${simTimeWarp}s`})`}
              </span>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setAutoRevolve(!autoRevolve)}
                className="px-2 py-1 bg-[#262824] hover:bg-[#1B1D1A] text-[#F0FFEA] rounded border border-[#33362F] hover:border-[#FF5F40] flex items-center gap-1 font-semibold"
              >
                {autoRevolve ? <Pause className="w-2.5 h-2.5 text-[#FF5F40]" /> : <Play className="w-2.5 h-2.5 text-[#FF5F40]" />}
                <span>{autoRevolve ? 'Pause' : 'Revolve'}</span>
              </button>
              {[1, 60, 120, 360, 1440].map((warp) => (
                <button
                  key={warp}
                  onClick={() => setSimTimeWarp(warp)}
                  className={`px-1.5 py-1 rounded border text-[9px] font-mono transition ${
                    simTimeWarp === warp
                      ? 'bg-[#FF5F40]/15 text-[#F0FFEA] border-[#FF5F40] font-bold'
                      : 'bg-[#262824] hover:bg-[#1B1D1A] text-[#9CA195] border-[#33362F]'
                  }`}
                  title={warp === 1 ? '1× Real-Time physics (1s = 1s)' : `${warp}× Time Warp`}
                >
                  {warp === 1 ? '1× Real' : warp === 60 ? '60×' : warp === 120 ? '120×' : warp === 360 ? '360×' : '1440×'}
                </button>
              ))}
              <button
                onClick={() => handlePresetSelect('leo-550-p1')}
                className="ml-auto text-[#9CA195] hover:text-[#F0FFEA] flex items-center gap-1 px-1.5 py-1 rounded bg-[#262824] border border-[#33362F] text-[9px]"
                title="Reset to LEO-550 Default Orbit"
              >
                <RotateCcw className="w-2.5 h-2.5 text-[#FF5F40]" />
                <span>Reset</span>
              </button>
            </div>
            <div className="flex items-center justify-between text-[9px] text-[#9CA195] pt-0.5">
              <span>Orbital 1-Rev at {simTimeWarp}×:</span>
              <span className="text-[#F0FFEA] font-mono">
                {simTimeWarp === 1
                  ? formatOrbitalPeriod(derivedPeriodSec)
                  : `~${(derivedPeriodSec / simTimeWarp).toFixed(1)}s real elapsed`}
              </span>
            </div>
          </div>

          {/* Ground Beacon Dynamics Controls */}
          <div className="border-t border-[#33362F] pt-2 text-[11px] space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[#FF5F40] font-bold text-[10px] uppercase tracking-wider">
                <Radio className="w-3.5 h-3.5 text-[#FF5F40]" />
                <span>Ground Beacon Dynamics</span>
              </div>
              <button
                onClick={() => setBeaconRevolving(!beaconRevolving)}
                className={`px-2 py-0.5 rounded text-[10px] border flex items-center gap-1 transition ${
                  beaconRevolving
                    ? 'bg-[#FF5F40]/15 text-[#F0FFEA] border-[#FF5F40] font-semibold'
                    : 'bg-[#262824] text-[#9CA195] border-[#33362F] font-semibold'
                }`}
              >
                {beaconRevolving ? <Pause className="w-2.5 h-2.5 text-[#FF5F40]" /> : <Play className="w-2.5 h-2.5 text-[#FF5F40]" />}
                <span>{beaconRevolving ? 'Revolving' : 'Static (Locked)'}</span>
              </button>
            </div>

            {/* Beacon Ground Phase / Position Scrubber */}
            <div>
              <div className="flex justify-between text-[#9CA195] mb-0.5 text-[10px]">
                <span>Ground Position Phase ($\nu$):</span>
                <span className="text-[#F0FFEA] font-bold">{beaconAnomalyDeg.toFixed(0)}°</span>
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
                className="w-full h-1.5 bg-[#262824] rounded-lg appearance-none cursor-pointer accent-[#FF5F40]"
              />
            </div>

            {/* Beacon Speed (km/h) & Presets */}
            <div className="space-y-1.5 pt-1 border-t border-[#33362F]">
              <div className="flex items-center justify-between text-[#9CA195] text-[10px]">
                <span>Beacon Velocity:</span>
                <span className="font-mono text-[#FF5F40] font-bold">{beaconSpeedKmh} km/h · {beaconSpeedKmh} px/s</span>
              </div>

              <input
                type="range"
                min={0}
                max={1200}
                step={10}
                value={beaconSpeedKmh}
                onChange={(e) => {
                  const spd = Number(e.target.value);
                  setBeaconSpeedKmh(spd);
                  setBeaconRevolving(spd > 0);
                  satellitePovSync.update({ beaconSpeedKmh: spd });
                }}
                className="w-full h-1.5 bg-[#262824] rounded-lg appearance-none cursor-pointer accent-[#FF5F40]"
              />

              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { label: 'Static (0)', speed: 0 },
                  { label: 'Loiter (150)', speed: 150 },
                  { label: 'Cruise (600)', speed: 600 },
                  { label: 'Max (1200)', speed: 1200 },
                ].map((rate) => (
                  <button
                    key={rate.label}
                    onClick={() => {
                      setBeaconSpeedKmh(rate.speed);
                      setBeaconRevolving(rate.speed > 0);
                      satellitePovSync.update({ beaconSpeedKmh: rate.speed });
                    }}
                    className={`px-1.5 py-0.5 rounded border text-[9px] font-mono transition ${
                      beaconSpeedKmh === rate.speed
                        ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] font-bold'
                        : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
                    }`}
                  >
                    {rate.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between text-[8.5px] text-[#9CA195] font-mono">
                <span>1 Rev (40,075 km):</span>
                <span className="text-[#F0FFEA] font-bold">
                  {formatBeaconRevolutionTime(beaconSpeedKmh)}
                </span>
              </div>
            </div>

            {/* Track Inclination Slider */}
            <div>
              <div className="flex justify-between text-[#9CA195] mb-0.5 text-[10px]">
                <span>Ground Track Inclination ($i$):</span>
                <span className="text-[#F0FFEA] font-bold">{beaconInc.toFixed(1)}°</span>
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
                className="w-full h-1.5 bg-[#262824] rounded-lg appearance-none cursor-pointer accent-[#FF5F40]"
              />
            </div>
          </div>
          <div className="border-t border-[#33362F] pt-2 text-[11px] space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[#FF5F40] font-bold text-[10px] uppercase tracking-wider">
                <Globe className="w-3.5 h-3.5 text-[#FF5F40]" />
                <span>Earth Diurnal Spin (15°/hr)</span>
              </div>
              <button
                onClick={() => setEarthSpinEnabled(!earthSpinEnabled)}
                className={`px-1.5 py-0.5 rounded text-[10px] border ${
                  earthSpinEnabled
                    ? 'bg-[#FF5F40]/15 text-[#F0FFEA] border-[#FF5F40] font-semibold'
                    : 'bg-[#262824] text-[#9CA195] border-[#33362F]'
                }`}
              >
                {earthSpinEnabled ? 'Active (15°/hr)' : 'Paused'}
              </button>
            </div>
            <div className="flex items-center justify-between text-[#9CA195] text-[10px]">
              <span>Speed Warp:</span>
              <div className="flex items-center gap-1">
                {[
                  { label: '1× (Real)', mult: 1, desc: '15°/hr (0.0042°/s)' },
                  { label: '60×', mult: 60, desc: '15°/min (0.25°/s)' },
                  { label: '360×', mult: 360, desc: '1.5°/s' },
                  { label: '1440×', mult: 1440, desc: '1 day / min' },
                ].map((rate) => (
                  <button
                    key={rate.label}
                    onClick={() => {
                      setEarthSpinMultiplier(rate.mult);
                      setEarthSpinEnabled(true);
                    }}
                    className={`px-1.5 py-0.5 rounded border text-[9px] transition ${
                      earthSpinEnabled && earthSpinMultiplier === rate.mult
                        ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] font-bold'
                        : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
                    }`}
                    title={rate.desc}
                  >
                    {rate.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* On-Screen Scale Indicator (Compact Corner HUD Widget) with Minimize / Expand Feature */}
      <div
        className={`absolute z-20 pointer-events-auto select-none transition-all duration-200 ${
          showOrbitTuner ? 'top-3 left-[340px]' : 'top-3 left-3'
        }`}
      >
        {isScaleMinimized ? (
          <div
            className="bg-[#000000]/95 backdrop-blur-md border border-[#33362F] rounded px-2.5 py-1.5 font-mono text-[10px] text-[#F0FFEA] shadow-xl flex items-center gap-2 cursor-pointer hover:border-[#FF5F40]/50 transition"
            onClick={() => setIsScaleMinimized(false)}
            title="Click to expand scale indicator"
          >
            <div className="flex items-center gap-1.5 text-[#FF5F40] font-bold text-[9px] uppercase tracking-wider">
              <Ruler className="w-3.5 h-3.5 text-[#FF5F40] shrink-0" />
              <span>SCALE</span>
            </div>
            <span
              className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold ${
                scaleMode === 'TRUE_SCALE'
                  ? 'bg-[#FF5F40]/15 text-[#FF5F40] border border-[#FF5F40]/40'
                  : 'bg-[#262824] text-[#9CA195] border border-[#33362F]'
              }`}
            >
              {scaleMode === 'TRUE_SCALE' ? 'TRUE (100u)' : 'LOG SCALE'}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsScaleMinimized(false);
              }}
              className="p-0.5 hover:bg-[#262824] text-[#9CA195] hover:text-[#F0FFEA] rounded transition cursor-pointer"
              title="Expand scale indicator"
              aria-label="Expand scale indicator"
            >
              <ChevronDown className="w-3.5 h-3.5 text-[#FF5F40]" />
            </button>
          </div>
        ) : (
          <div className="bg-[#000000]/95 backdrop-blur-md border border-[#33362F] rounded p-2.5 font-mono text-[10px] text-[#F0FFEA] shadow-xl space-y-1.5 w-64 animate-in fade-in duration-200">
            <div
              className="flex items-center justify-between border-b border-[#33362F] pb-1 cursor-pointer"
              onClick={() => setIsScaleMinimized(true)}
              title="Click to minimize scale indicator"
            >
              <div className="flex items-center gap-1.5 text-[#9CA195] font-bold uppercase tracking-wider text-[9px]">
                <Ruler className="w-3.5 h-3.5 text-[#FF5F40]" />
                <span>Scale Indicator</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold ${
                    scaleMode === 'TRUE_SCALE'
                      ? 'bg-[#FF5F40]/15 text-[#FF5F40] border border-[#FF5F40]/40'
                      : 'bg-[#262824] text-[#9CA195] border border-[#33362F]'
                  }`}
                >
                  {scaleMode === 'TRUE_SCALE' ? 'TRUE SCALE' : 'READABLE LOG'}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsScaleMinimized(true);
                  }}
                  className="p-0.5 hover:bg-[#262824] text-[#9CA195] hover:text-[#F0FFEA] rounded transition cursor-pointer"
                  title="Minimize scale indicator"
                  aria-label="Minimize scale indicator"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Primary Readout */}
            <div className="flex items-baseline justify-between pt-0.5">
              <div className="text-[#F0FFEA] font-bold text-[11px]">
                {scaleMode === 'TRUE_SCALE' ? (
                  <span className="text-[#FF5F40]">
                    {earthRenderRadius.toFixed(0)}u = {Math.round(EARTH_RADIUS_KM).toLocaleString()} km
                  </span>
                ) : (
                  <span className="text-[#F0FFEA]">
                    100u alt = {Math.round(getAltitudeFromRenderOffset(100, scaleMode, READABLE_K, earthRenderRadius)).toLocaleString()} km
                  </span>
                )}
              </div>
              <div className="text-[8.5px] text-[#9CA195] font-mono">
                {scaleMode === 'TRUE_SCALE' ? (
                  <span>1u = {(EARTH_RADIUS_KM / earthRenderRadius).toFixed(1)} km</span>
                ) : (
                  <span>R₀: {earthRenderRadius.toFixed(0)}u = {Math.round(EARTH_RADIUS_KM).toLocaleString()} km</span>
                )}
              </div>
            </div>

            {/* Visual Scale Bar */}
            <div className="pt-0.5">
              <div className="relative flex items-center">
                {/* Left tick */}
                <div className="w-[1.5px] h-2.5 bg-[#5E625A]" />
                {/* Left segment */}
                <div
                  className={`flex-1 h-[2px] ${
                    scaleMode === 'TRUE_SCALE'
                      ? 'bg-[#FF5F40]'
                      : 'bg-[#FF5F40]/60'
                  }`}
                />
                {/* Center tick */}
                <div className="w-[1.5px] h-2 bg-[#5E625A]" />
                {/* Right segment */}
                <div
                  className={`flex-1 h-[2px] ${
                    scaleMode === 'TRUE_SCALE'
                      ? 'bg-[#FF5F40]'
                      : 'bg-[#FF5F40]/40'
                  }`}
                />
                {/* Right tick */}
                <div className="w-[1.5px] h-2.5 bg-[#5E625A]" />
              </div>

              {/* Under-bar tick labels */}
              <div className="flex justify-between text-[8px] font-mono text-[#9CA195] pt-0.5">
                <span>0u</span>
                <span>
                  {scaleMode === 'TRUE_SCALE'
                    ? `${(earthRenderRadius / 2).toFixed(0)}u (${Math.round(EARTH_RADIUS_KM / 2).toLocaleString()} km)`
                    : `50u (${Math.round(getAltitudeFromRenderOffset(50, scaleMode, READABLE_K, earthRenderRadius)).toLocaleString()} km)`}
                </span>
                <span>
                  {scaleMode === 'TRUE_SCALE'
                    ? `${earthRenderRadius.toFixed(0)}u (${Math.round(EARTH_RADIUS_KM).toLocaleString()} km)`
                    : `100u (${Math.round(getAltitudeFromRenderOffset(100, scaleMode, READABLE_K, earthRenderRadius)).toLocaleString()} km)`}
                </span>
              </div>
            </div>

            {/* Dynamic active orbit readout */}
            {scaleMode === 'READABLE_SCALE' && (
              <div className="text-[8.5px] pt-1 border-t border-[#33362F] text-[#9CA195] flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#FF5F40] animate-pulse" />
                  <span>Active Orbit:</span>
                </span>
                <span className="font-bold font-mono text-[#F0FFEA]">
                  {getRenderAltitudeOffset(orbitAltitudeKm, scaleMode, READABLE_K, earthRenderRadius).toFixed(1)}u = {Math.round(orbitAltitudeKm).toLocaleString()} km
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Overlay HUD Telemetry in 3D with Minimize / Expand Feature */}
      <div
        className={`absolute bottom-3 left-3 bg-[#000000]/95 backdrop-blur border border-[#33362F] p-2.5 rounded font-mono text-[10px] space-y-1 text-[#F0FFEA] pointer-events-auto shadow-xl z-20 select-none transition-all duration-200 ${
          isTrackerMinimized ? 'max-w-[280px]' : 'max-w-[min(540px,calc(100%-320px))]'
        }`}
      >
        <div
          className={`text-[#FF5F40] font-bold flex justify-between items-center gap-3 cursor-pointer ${
            !isTrackerMinimized ? 'border-b border-[#33362F] pb-1.5 mb-1.5' : ''
          }`}
          onClick={() => setIsTrackerMinimized((prev) => !prev)}
          title={isTrackerMinimized ? 'Click to expand constellation tracker' : 'Click to minimize constellation tracker'}
        >
          <div className="flex items-center gap-1.5 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF5F40] shrink-0"></span>
            <span className="tracking-wider truncate">ORBITAL CONSTELLATION TRACKER</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={scaleMode === 'TRUE_SCALE' ? 'text-[#FF5F40] text-[9px] font-bold' : 'text-[#9CA195] text-[9px] font-bold'}>
              [{scaleMode}]
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsTrackerMinimized((prev) => !prev);
              }}
              className="p-0.5 hover:bg-[#262824] text-[#9CA195] hover:text-[#F0FFEA] rounded transition cursor-pointer"
              title={isTrackerMinimized ? 'Expand tracker' : 'Minimize tracker'}
              aria-label={isTrackerMinimized ? 'Expand tracker' : 'Minimize tracker'}
            >
              {isTrackerMinimized ? (
                <ChevronDown className="w-3.5 h-3.5 text-[#FF5F40]" />
              ) : (
                <Minus className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {!isTrackerMinimized && (
          <div className="space-y-1 max-h-[55vh] overflow-y-auto pr-1">
            <div>Central Body: <span className="text-[#F0FFEA] font-semibold">Earth ({formatDistAndUnits(EARTH_RADIUS_KM, globeRadius)})</span></div>
            <div>
              Active Satellite: <span className="text-[#FF5F40] font-bold">{activePreset ? activePreset.shortName : 'Custom Orbit'}</span>
            </div>
            <div>
              Orbit Shape:{' '}
              <span className="text-[#F0FFEA] font-bold">
                {formatAltAndUnits(orbitPerigeeKm, scaleMode)} × {formatAltAndUnits(orbitApogeeKm, scaleMode)} (e={derivedE.toFixed(4)}) | Inc: {orbitInc.toFixed(1)}°
              </span>
            </div>
            <div>
              Orbital Speed & Period (1 Rev):{' '}
              <span ref={trackerSpeedPeriodRef} className="text-[#FF5F40] font-bold">
                {formatOrbitalSpeed(derivedSpeed)} | 1 Rev: {formatOrbitalPeriod(derivedPeriodSec)}
              </span>
            </div>
            <div ref={trackerKeplerRef} className="text-[9px] text-[#9CA195]">
              Kepler Orbit: a = {formatDistAndUnits(derivedA, getRenderOrbitRadius(derivedA - EARTH_RADIUS_KM, scaleMode))} | r = {formatDistAndUnits(derivedR, getRenderOrbitRadius(derivedR - EARTH_RADIUS_KM, scaleMode))}
            </div>
            <div>Target Entity: <span className="text-[#F0FFEA] font-bold">Ground Station ({formatAltAndUnits(0, scaleMode)})</span></div>
            <div>
              Beacon Platform:{' '}
              <span className={beaconSpeedKmh > 0 ? 'text-[#FF5F40] font-bold' : 'text-[#9CA195] font-bold'}>
                {beaconSpeedKmh > 0
                  ? `ATMOSPHERIC UAV (${beaconSpeedKmh} km/h [1 Rev = ${formatBeaconRevolutionTime(beaconSpeedKmh)}])`
                  : 'STATIC GROUND STATION (HOVER / LOCKED)'}
              </span>
            </div>
            <div>
              Earth Spin & Clock:{' '}
              <span className={earthSpinEnabled ? 'text-[#F0FFEA] font-bold' : 'text-[#5E625A] font-bold'}>
                {earthSpinEnabled
                  ? `SIDEREAL SPIN (${simTimeWarp}× Time Warp [${simTimeWarp === 1 ? '1s=1s Real-Time' : `1s = ${simTimeWarp >= 60 ? `${simTimeWarp / 60}m` : `${simTimeWarp}s`}`}])`
                  : 'INERTIAL LOCKED (PAUSED)'}
              </span>
            </div>
            <div>
              Slant Range:{' '}
              <span ref={trackerSlantRangeRef} className="text-[#FF5F40] font-bold">
                {formatDistAndUnits(currentSlantRangeKm, currentSlantRange)}
              </span>
            </div>
            <div>
              PAT State:{' '}
              <span
                ref={trackerPatStateRef}
                className={
                  isOccludedByEarth
                    ? 'text-[#FF5F40] font-bold animate-pulse'
                    : !autoLOS
                    ? 'text-[#9CA195] font-bold'
                    : slewAngularError > 1.5
                    ? 'text-[#FF5F40] font-bold animate-pulse'
                    : 'text-[#F0FFEA] font-bold'
                }
              >
                {isOccludedByEarth ? (
                  '! OCCLUDED BY EARTH LIMB (NO LOS)'
                ) : !autoLOS ? (
                  'AUTO LOS OFF (HOLDING NADIR ATTITUDE)'
                ) : slewAngularError > 1.5 ? (
                  `! SLEWING TO BEACON LOS (${slewAngularError.toFixed(1)}° OFF-AXIS)`
                ) : autoRevolve ? (
                  '✓ ACTIVE PAT TRACKING (CLEAR LOS)'
                ) : (
                  '✓ LOCKED ON BEACON (CLEAR LOS)'
                )}
              </span>
            </div>
            {showAtmosphereShells && (
              <div className="pt-1 border-t border-[#33362F] text-[10px]">
                Atmospheric Shells:{' '}
                <span className="text-[#F0FFEA] font-bold">
                  Turbulence ({formatAltAndUnits(20, scaleMode)})
                </span>{' '}
                |{' '}
                <span className="text-[#9CA195] font-bold">
                  Thin ({formatAltAndUnits(100, scaleMode)})
                </span>{' '}
                |{' '}
                <span className="text-[#FF5F40] font-bold">
                  Kármán Line ({formatAltAndUnits(100, scaleMode)})
                </span>
              </div>
            )}
            {showReferenceRings && (
              <div className="pt-1 border-t border-[#33362F] text-[10px]">
                Reference Rings:{' '}
                {REFERENCE_ALTITUDES.map((spec, i) => (
                  <span key={spec.id} className="text-[#F0FFEA]">
                    {spec.name} ({formatAltAndUnits(spec.altKm, scaleMode)}){i < REFERENCE_ALTITUDES.length - 1 ? ' | ' : ''}
                  </span>
                ))}
              </div>
            )}
            {showSunTerminator && (
              <div className="pt-1 border-t border-[#33362F] text-[10px]">
                Solar Illumination:{' '}
                <span className="text-[#FF5F40] font-bold">
                  Sun Vector [{FIXED_SUN_DIR.x.toFixed(2)}, {FIXED_SUN_DIR.y.toFixed(2)}, {FIXED_SUN_DIR.z.toFixed(2)}]
                </span>{' '}
                |{' '}
                <span className="text-[#F0FFEA] font-bold">
                  Terminator Great Circle
                </span>{' '}
                |{' '}
                <span className="text-[#9CA195] font-bold">
                  Night Shading
                </span>
              </div>
            )}
            {showFootprint && (
              <div className="pt-1 border-t border-[#33362F] text-[10px]">
                Ground Footprint (El ≥ 10°):{' '}
                <span
                  ref={footprintStatusRef}
                  className={isBeaconInFootprint ? 'text-[#FF5F40] font-bold' : 'text-[#9CA195] font-bold'}
                >
                  {isBeaconInFootprint
                    ? `✓ BEACON IN COVERAGE (El = ${beaconElevationDeg.toFixed(1)}°)`
                    : `✕ BEACON OUTSIDE (El = ${beaconElevationDeg.toFixed(1)}°)`}
                </span>{' '}
                |{' '}
                <span ref={footprintRadiusRef} className="text-[#9CA195]">
                  Radius θ = {footprintThetaDeg.toFixed(1)}° ({Math.round(footprintGroundRadiusKm).toLocaleString()} km)
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend with Minimize / Expand Feature */}
      <div
        className={`absolute top-3 right-3 bg-[#000000]/95 backdrop-blur border border-[#33362F] px-3 py-2 rounded font-mono text-[10px] text-[#9CA195] pointer-events-auto shadow-xl hidden sm:block z-20 transition-all duration-200 select-none ${
          isLegendMinimized ? 'max-w-[195px]' : 'max-w-[340px]'
        }`}
      >
        <div
          className={`flex items-center justify-between gap-3 cursor-pointer ${
            !isLegendMinimized ? 'border-b border-[#33362F] pb-1.5 mb-1.5' : ''
          }`}
          onClick={() => setIsLegendMinimized((prev) => !prev)}
          title={isLegendMinimized ? 'Click to expand legend' : 'Click to minimize legend'}
        >
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF5F40] shrink-0"></span>
            <span className="text-[11px] font-bold text-[#F0FFEA] tracking-wider">LEO CONSTELLATION</span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsLegendMinimized((prev) => !prev);
            }}
            className="p-0.5 hover:bg-[#262824] text-[#9CA195] hover:text-[#F0FFEA] rounded transition cursor-pointer"
            title={isLegendMinimized ? 'Expand legend' : 'Minimize legend'}
            aria-label={isLegendMinimized ? 'Expand legend' : 'Minimize legend'}
          >
            {isLegendMinimized ? (
              <ChevronDown className="w-3.5 h-3.5 text-[#FF5F40]" />
            ) : (
              <Minus className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {!isLegendMinimized && (
          <div className="space-y-1.5 max-h-[min(50vh,calc(100vh-420px))] overflow-y-auto pr-1">
            <div className="flex items-center gap-2">
              <span className="w-3 h-0.5 bg-[#FF5F40] inline-block border-dashed"></span>
              <span className="text-[#FF5F40] font-medium">Active Optical LOS Beam</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-0.5 bg-[#5E625A] inline-block border-dashed"></span>
              <span className="text-[#9CA195] font-medium">Earth Limb Blocked LOS</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-0.5 bg-[#F0FFEA] inline-block"></span>
              <span>Selected Satellite Orbit ({formatAltAndUnits(orbitAltitudeKm, scaleMode)})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-0.5 bg-[#33362F] inline-block border-dashed"></span>
              <span>Walker Constellation Shells ({formatAltAndUnits(550, scaleMode)})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-0.5 bg-[#9CA195] inline-block border-dashed"></span>
              <span>Polar Sun-Synchronous SSO ({formatAltAndUnits(700, scaleMode)}, 97.8°)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-0.5 bg-[#FF5F40] inline-block border-dashed"></span>
              <span className="text-[#FF5F40]">Beacon Ground Track ({formatAltAndUnits(0, scaleMode)})</span>
            </div>

            {/* Scene Markers (Fixed Screen-Space Billboards) */}
            <div className="text-[10px] font-bold text-[#F0FFEA] pt-1 border-t border-[#33362F]">SCENE MARKERS (SCREEN-SPACE)</div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F40] inline-block"></span>
              <span>Satellite Marker ({BASE_MARKER_PX}px / {ACTIVE_MARKER_PX}px active)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#F0FFEA] inline-block border border-[#33362F]"></span>
              <span>Beacon Target Marker ({BASE_MARKER_PX}px / {ACTIVE_MARKER_PX}px active)</span>
            </div>

            {/* Atmospheric Shells in Legend */}
            {showAtmosphereShells && (
              <>
                <div className="text-[10px] font-bold text-[#F0FFEA] pt-1 border-t border-[#33362F]">ATMOSPHERIC LAYERS</div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-2 bg-[#262824] border border-[#33362F] rounded-[2px] inline-block"></span>
                  <span className="text-[#F0FFEA]">Turbulence Zone (0–20 km, {formatAltAndUnits(20, scaleMode)})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-2 bg-[#1B1D1A] border border-[#33362F] rounded-[2px] inline-block"></span>
                  <span className="text-[#9CA195]">Thin Atmosphere (20–100 km, {formatAltAndUnits(100, scaleMode)})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-[#FF5F40] border-dashed inline-block"></span>
                  <span className="text-[#FF5F40]">Kármán Line — Edge of Space ({formatAltAndUnits(100, scaleMode)})</span>
                </div>
              </>
            )}

            {/* Ground Footprint in Legend */}
            {showFootprint && (
              <>
                <div className="text-[10px] font-bold text-[#F0FFEA] pt-1 border-t border-[#33362F]">GROUND FOOTPRINT</div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-[#FF5F40] inline-block"></span>
                  <span className="text-[#FF5F40] font-medium">In Coverage (El ≥ 10°)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-[#5E625A] inline-block"></span>
                  <span className="text-[#9CA195] font-medium">Outside Mask (El &lt; 10°)</span>
                </div>
              </>
            )}

            {/* Solar Direction & Day/Night Terminator in Legend */}
            {showSunTerminator && (
              <>
                <div className="text-[10px] font-bold text-[#F0FFEA] pt-1 border-t border-[#33362F]">SOLAR ILLUMINATION</div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-[#FF5F40] border-dashed inline-block"></span>
                  <span className="text-[#FF5F40] font-medium">Day/Night Terminator (Dawn/Dusk)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-[#F0FFEA] inline-block"></span>
                  <span className="text-[#F0FFEA]">Sun Direction Vector (ECI Fixed)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-2 bg-[#1B1D1A] border border-[#33362F] rounded-[2px] inline-block"></span>
                  <span className="text-[#9CA195]">Night-Side Shaded Hemisphere</span>
                </div>
              </>
            )}

            {/* Standard Reference Altitude Rings in Legend */}
            {showReferenceRings && (
              <>
                <div className="text-[10px] font-bold text-[#F0FFEA] pt-1 border-t border-[#33362F]">REFERENCE ALTITUDES</div>
                {REFERENCE_ALTITUDES.map((spec) => (
                  <div key={spec.id} className="flex items-center gap-2">
                    <span
                      className="w-3 h-0.5 border-dashed inline-block bg-[#9CA195]"
                    ></span>
                    <span className="text-[#9CA195]">
                      {spec.name} ({formatAltAndUnits(spec.altKm, scaleMode)})
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
      </div>

      {/* 3D Viewport Controls Bar - Space-Optimized Mission Control Bar (Flipped to Bottom) */}
      <div className="flex flex-col bg-[#1B1D1A] border-t border-[#33362F] text-xs font-mono z-10 shrink-0 select-none">
        {/* Row 1: Title, Simulation Playback, Time Warp & Quick Camera Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-[#33362F]">
          <div className="flex items-center gap-2 text-[#FF5F40]">
            <Box className="w-4 h-4 text-[#FF5F40]" />
            <span className="font-semibold tracking-wider text-xs text-[#F0FFEA]">3D LEO KINEMATICS — LaserLockAI</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {/* Play / Pause Satellite Orbital Motion */}
            <button
              onClick={() => setAutoRevolve(!autoRevolve)}
              className="px-2.5 py-1 rounded bg-[#262824] hover:bg-[#1B1D1A] border border-[#33362F] hover:border-[#FF5F40] text-xs flex items-center gap-2 transition"
              title={autoRevolve ? 'Pause Satellite Orbital Motion (Spacecraft in Space)' : 'Resume Satellite Orbital Motion'}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  autoRevolve
                    ? 'bg-[#FF5F40]'
                    : 'bg-[#5E625A]'
                }`}
              />
              <span className="text-[#9CA195]">
                Sat Orbit:{' '}
                <strong className={autoRevolve ? 'text-[#FF5F40] font-medium' : 'text-[#9CA195] font-medium'}>
                  {autoRevolve ? 'Active' : 'Paused'}
                </strong>
              </span>
            </button>

            {/* Quick Time Warp Badge in Controls Bar */}
            <div className="flex items-center gap-1.5 bg-[#262824] hover:border-[#FF5F40] px-2.5 py-1 rounded border border-[#33362F] text-xs transition">
              <Clock className="w-3.5 h-3.5 text-[#9CA195] shrink-0" />
              <span className="text-[#9CA195] font-medium shrink-0">Time:</span>
              <select
                value={simTimeWarp}
                onChange={(e) => setSimTimeWarp(Number(e.target.value))}
                className="bg-transparent text-[#F0FFEA] font-medium focus:outline-none cursor-pointer text-xs pr-1"
                title="Simulation Physical Time Warp (Keplerian Rate)"
              >
                <option value={1} className="bg-[#1B1D1A] text-[#F0FFEA]">1× (Real)</option>
                <option value={60} className="bg-[#1B1D1A] text-[#F0FFEA]">60× (1m)</option>
                <option value={120} className="bg-[#1B1D1A] text-[#F0FFEA]">120× (2m)</option>
                <option value={360} className="bg-[#1B1D1A] text-[#F0FFEA]">360× (6m)</option>
                <option value={1440} className="bg-[#1B1D1A] text-[#F0FFEA]">1440× (1d)</option>
              </select>
              <ChevronDown className="w-3 h-3 text-[#9CA195] pointer-events-none -ml-1 shrink-0" />
            </div>

            {/* Lower Pole View */}
            <button
              onClick={() => {
                focusModeRef.current = 'earth';
                setFocusMode('earth');
                orbitStateRef.current = { theta: 0, phi: -1.35, radius: 340.0 };
              }}
              className="px-2.5 py-1 bg-[#262824] hover:bg-[#1B1D1A] text-[#F0FFEA] hover:text-[#FF5F40] rounded border border-[#33362F] hover:border-[#FF5F40] flex items-center gap-1.5 text-xs transition"
              title="Tilt camera directly to Lower Pole (South Pole / Antarctica)"
            >
              <Compass className="w-3.5 h-3.5 text-[#9CA195]" /> <span>S-Pole</span>
            </button>

            {/* Upper Pole View */}
            <button
              onClick={() => {
                focusModeRef.current = 'earth';
                setFocusMode('earth');
                orbitStateRef.current = { theta: 0, phi: 1.35, radius: 340.0 };
              }}
              className="px-2.5 py-1 bg-[#262824] hover:bg-[#1B1D1A] text-[#F0FFEA] hover:text-[#FF5F40] rounded border border-[#33362F] hover:border-[#FF5F40] flex items-center gap-1.5 text-xs transition"
              title="Tilt camera directly to Upper Pole (North Pole / Arctic)"
            >
              <Compass className="w-3.5 h-3.5 text-[#9CA195] rotate-180" /> <span>N-Pole</span>
            </button>


            {/* Reset Camera View */}
            <button
              onClick={resetCameraView}
              className="px-2.5 py-1 bg-[#262824] hover:bg-[#1B1D1A] text-[#F0FFEA] hover:text-[#FF5F40] rounded border border-[#33362F] hover:border-[#FF5F40] flex items-center gap-1.5 text-xs transition"
              title="Reset 3D Orbit Camera to Default Earth View"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#9CA195]" /> <span>Reset</span>
            </button>

            {/* Pop out in new tab option */}
            <button
              onClick={() => {
                const url = new URL(window.location.origin + window.location.pathname);
                url.searchParams.set('popout', '3d');
                window.open(url.toString(), '_blank', 'noopener,noreferrer');
              }}
              className="px-2.5 py-1 bg-[#262824] hover:bg-[#1B1D1A] text-[#F0FFEA] hover:text-[#FF5F40] rounded border border-[#33362F] hover:border-[#FF5F40] flex items-center gap-1.5 text-xs transition cursor-pointer font-medium ml-1"
              title="Pop out 3D Virtual Scene & all settings into a new browser tab"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[#FF5F40]" />
              <span>Pop out</span>
            </button>
          </div>
        </div>

        {/* Row 2: Orbit Selection, Scale Mode, Tune & Speeds */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#1B1D1A]/95">
          <div className="flex flex-wrap items-center gap-2">
            {/* Render Scale Mode Toggle (Compact Segmented Pill) */}
            <div className="flex items-center bg-[#262824] p-0.5 rounded border border-[#33362F] text-xs">
              <button
                onClick={() => handleScaleModeChange('TRUE_SCALE')}
                className={`px-2.5 py-1 rounded transition text-xs ${
                  scaleMode === 'TRUE_SCALE'
                    ? 'border border-[#FF5F40] bg-[#FF5F40]/15 text-[#F0FFEA] font-medium'
                    : 'text-[#9CA195] hover:text-[#F0FFEA] border border-transparent'
                }`}
                title="True Physical Scale (1:1): Earth R=100u, LEO 550km = +8.6u, GEO = +561u"
              >
                True Scale
              </button>
              <button
                onClick={() => handleScaleModeChange('READABLE_SCALE')}
                className={`px-2.5 py-1 rounded transition text-xs ${
                  scaleMode === 'READABLE_SCALE'
                    ? 'border border-[#FF5F40] bg-[#FF5F40]/15 text-[#F0FFEA] font-medium'
                    : 'text-[#9CA195] hover:text-[#F0FFEA] border border-transparent'
                }`}
                title="Readable Logarithmic Scale: Simultaneously view LEO and GEO"
              >
                Readable Scale
              </button>
            </div>

            {/* Quick Preset Selector Dropdown (Space-Optimized with max-w & truncate) */}
            <div className="flex items-center gap-2 bg-[#262824] hover:border-[#FF5F40] px-2.5 py-1 rounded border border-[#33362F] text-xs max-w-[280px] transition">
              <Compass className="w-3.5 h-3.5 text-[#9CA195] shrink-0" />
              <span className="text-[#9CA195] text-xs shrink-0 font-medium">Orbit:</span>
              <select
                value={selectedPresetId}
                onChange={(e) => handlePresetSelect(e.target.value)}
                className="bg-transparent text-[#F0FFEA] font-medium focus:outline-none cursor-pointer truncate text-xs w-full pr-1"
                title="Select Orbit Preset or Custom Parameters"
              >
                {ORBIT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id} className="bg-[#1B1D1A] text-[#F0FFEA]">
                    {p.name}
                  </option>
                ))}
                <option value="custom" className="bg-[#1B1D1A] text-[#FF5F40]">
                  [Custom Parameters]
                </option>
              </select>
              <ChevronDown className="w-3 h-3 text-[#9CA195] pointer-events-none -ml-1 shrink-0" />
            </div>

            {/* Toggle Interactive Tuning Drawer */}
            <button
              onClick={() => setShowOrbitTuner(!showOrbitTuner)}
              className={`px-2.5 py-1 rounded border text-xs flex items-center gap-1.5 transition ${
                showOrbitTuner
                  ? 'border-[#FF5F40] bg-[#FF5F40]/15 text-[#F0FFEA] font-medium'
                  : 'bg-[#262824] hover:bg-[#1B1D1A] text-[#F0FFEA] border-[#33362F] hover:border-[#FF5F40]'
              }`}
              title="Open Interactive Orbit Parameter Sliders"
            >
              <Sliders className="w-3.5 h-3.5 text-[#9CA195] shrink-0" />
              <span>Tune Orbit</span>
            </button>

            {/* Real Orbital Speeds & Revolution Periods Reference Table Modal Toggle */}
            <button
              onClick={() => setShowSpecsTable(!showSpecsTable)}
              className={`px-2.5 py-1 rounded border text-xs flex items-center gap-1.5 transition ${
                showSpecsTable
                  ? 'border-[#FF5F40] bg-[#FF5F40]/15 text-[#F0FFEA] font-medium'
                  : 'bg-[#262824] hover:bg-[#1B1D1A] text-[#F0FFEA] border-[#33362F] hover:border-[#FF5F40]'
              }`}
              title="View Real Satellite Speeds & Revolution Periods Table (Keplerian Reference)"
            >
              <BarChart2 className="w-3.5 h-3.5 text-[#9CA195] shrink-0" />
              <span>Speeds & Periods</span>
            </button>

            {/* 3D Beacon Ground Path Planner Toggle */}
            <button
              onClick={() => setShowBeaconPathPlanner(!showBeaconPathPlanner)}
              className={`px-2.5 py-1 rounded border text-xs flex items-center gap-2 transition ${
                showBeaconPathPlanner
                  ? 'border-[#FF5F40] bg-[#FF5F40]/15 text-[#F0FFEA] font-medium'
                  : 'bg-[#262824] hover:bg-[#1B1D1A] text-[#F0FFEA] border-[#33362F] hover:border-[#FF5F40]'
              }`}
              title="Open 3D Beacon Ground Path Planner (Define Waypoints 1→4 on Earth)"
            >
              <MapPin className="w-3.5 h-3.5 text-[#9CA195] shrink-0" />
              <span>Beacon Path</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1B1D1A] text-[#9CA195] font-mono border border-[#33362F]">
                {beaconPathWaypoints.length} pts
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Real Satellite Speeds & Revolution Periods Reference Modal */}
      {showSpecsTable && (
        <div className="absolute inset-0 bg-[#000000]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto flex flex-col font-mono text-xs animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#33362F] bg-[#000000]/70">
              <div className="flex items-center gap-2">
                <Table className="w-4 h-4 text-[#FF5F40]" />
                <span className="font-bold text-[#F0FFEA] text-sm tracking-wide">
                  REAL SATELLITE SPEEDS & REVOLUTION PERIODS
                </span>
                <span className="px-2 py-0.5 rounded bg-[#FF5F40]/15 border border-[#FF5F40]/40 text-[#FF5F40] text-[10px] font-bold">
                  Keplerian Physics
                </span>
              </div>
              <button
                onClick={() => setShowSpecsTable(false)}
                className="p-1 text-[#9CA195] hover:text-[#F0FFEA] rounded hover:bg-[#262824] transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Explanation / Verification Notice */}
            <div className="px-4 py-2 bg-[#000000]/40 border-b border-[#33362F] text-[11px] text-[#F0FFEA] space-y-1">
              <p>
                In the simulation, every satellite revolves at its exact physical speed derived from{' '}
                <span className="text-[#FF5F40] font-bold">Kepler's Third Law</span> (T = 2π√(a³/μ)) and{' '}
                <span className="text-[#FF5F40] font-bold">Vis-Viva equation</span> (v = √(μ/r)).
              </p>
              <p className="text-[#9CA195] text-[10px]">
                Earth Gravitational Parameter μ = 398,600.44 km³/s², Earth Radius R_E = 6,378.14 km.
              </p>
            </div>

            {/* Reference Table */}
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#33362F] text-[#9CA195] text-[10px] uppercase tracking-wider">
                    <th className="py-2 px-2.5">Orbit Profile</th>
                    <th className="py-2 px-2.5">Altitude</th>
                    <th className="py-2 px-2.5">Speed (km/h)</th>
                    <th className="py-2 px-2.5">Orbital Period (1 Revolution)</th>
                    <th className="py-2 px-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#33362F] text-[11px]">
                  {[
                    {
                      id: 'leo-vleo',
                      profile: 'Very Low Earth Orbit VLEO',
                      alt: '200 km',
                      speed: '~28,037 km/h',
                      speedKms: '7.79 km/s',
                      period: '~88.3 minutes (1 hr 28 min)',
                    },
                    {
                      id: 'leo-equatorial',
                      profile: 'Equatorial Fast Relay',
                      alt: '350 km',
                      speed: '~27,724 km/h',
                      speedKms: '7.70 km/s',
                      period: '~91.4 minutes (1 hr 31 min)',
                    },
                    {
                      id: 'leo-550-p1',
                      profile: 'LEO Walker Planes 1, 2, & 3',
                      alt: '550 km',
                      speed: '~27,320 km/h',
                      speedKms: '7.59 km/s',
                      period: '~95.5 minutes (1 hr 35 min)',
                    },
                    {
                      id: 'leo-polar-sso',
                      profile: 'Polar Sun-Synchronous SSO',
                      alt: '700 km',
                      speed: '~27,029 km/h',
                      speedKms: '7.51 km/s',
                      period: '~98.6 minutes (1 hr 38 min)',
                    },
                    {
                      id: 'leo-high',
                      profile: 'High-LEO Broadband Shell',
                      alt: '1,150 km',
                      speed: '~26,208 km/h',
                      speedKms: '7.28 km/s',
                      period: '~108.1 minutes (1 hr 48 min)',
                    },
                    {
                      id: 'geo-equatorial',
                      profile: 'Geostationary Orbit GEO',
                      alt: '35,786 km',
                      speed: '~11,070 km/h',
                      speedKms: '3.08 km/s',
                      period: '~23 hours 56 minutes (1 Sidereal Day)',
                    },
                  ].map((row) => {
                    const isActive = selectedPresetId === row.id;
                    return (
                      <tr
                        key={row.id}
                        className={`transition hover:bg-[#262824]/50 ${
                          isActive ? 'bg-[#FF5F40]/10 font-semibold' : ''
                        }`}
                      >
                        <td className="py-2.5 px-2.5">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-[#FF5F40] animate-pulse' : 'bg-[#5E625A]'}`} />
                            <span className={isActive ? 'text-[#F0FFEA] font-bold' : 'text-[#9CA195]'}>
                              {row.profile}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 text-[#F0FFEA] font-mono">
                          {row.alt}
                        </td>
                        <td className="py-2.5 px-2.5 font-mono">
                          <span className="font-bold text-[#FF5F40]">{row.speed}</span>
                          <span className="text-[#9CA195] text-[10px] ml-1.5 font-normal">({row.speedKms})</span>
                        </td>
                        <td className="py-2.5 px-2.5 text-[#F0FFEA] font-mono">
                          {row.period}
                        </td>
                        <td className="py-2.5 px-2.5 text-right">
                          {isActive ? (
                            <span className="px-2 py-0.5 rounded text-[9.5px] font-bold bg-[#FF5F40] text-[#0A0A0A] shadow-sm">
                              Active Orbit
                            </span>
                          ) : (
                            <button
                              onClick={() => {
                                handlePresetSelect(row.id);
                                setShowSpecsTable(false);
                              }}
                              className="px-2.5 py-1 rounded text-[10px] bg-[#262824] hover:bg-[#FF5F40]/20 hover:text-[#FF5F40] text-[#F0FFEA] border border-[#33362F] transition"
                            >
                              Engage Orbit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Simulation Clock & Time Warp Controls */}
            <div className="p-4 border-t border-[#33362F] bg-[#000000]/60 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-[#F0FFEA] font-bold text-[11px] flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#FF5F40]" />
                    <span>Physical Simulation Time Warp:</span>
                    <span className="text-[#FF5F40] font-bold">{simTimeWarp}×</span>
                  </div>
                  <div className="text-[10px] text-[#9CA195]">
                    {simTimeWarp === 1
                      ? '1:1 True Real-Time (1 satellite revolution takes the full orbital period in real life)'
                      : `At ${simTimeWarp}× warp: 1 second = ${simTimeWarp >= 60 ? `${simTimeWarp / 60} minutes` : `${simTimeWarp} seconds`}. 550 km revolution completes in ~${(5727.4 / simTimeWarp).toFixed(1)}s.`}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {[1, 60, 120, 360, 1440].map((warp) => (
                    <button
                      key={warp}
                      onClick={() => setSimTimeWarp(warp)}
                      className={`px-2 py-1 rounded border text-[10px] font-mono transition ${
                        simTimeWarp === warp
                          ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] font-bold shadow'
                          : 'bg-[#262824] hover:bg-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] border-[#33362F]'
                      }`}
                    >
                      {warp === 1 ? '1× (Real)' : warp === 60 ? '60× (1s=1m)' : warp === 120 ? '120×' : warp === 360 ? '360×' : '1440× (1m=1d)'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


