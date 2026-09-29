import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { TargetState, CameraState, DisturbanceTelemetry } from '../types';
import { satellitePovSync, computeBeaconOmegaReal, EARTH_CIRCUMFERENCE_KM } from './satellitePovSync';
import { formatBeaconRevolutionTime } from '../components/BeaconSpeedControl';
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
  Ruler,
  Sun,
  Target,
  Table,
  Gauge,
  Clock,
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

    // Red beacon status dot
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(24, 45, 5, 0, Math.PI * 2);
    ctx.fill();

    // Top Tag: [ BEACON · tag ]
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#fca5a5';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`[ BEACON · ${tag} ]`, 38, 30);

    // Bottom Platform Name: ATMOSPHERIC UAV
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#ffffff';
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

    ctx.fillStyle = 'rgba(6, 12, 26, 0.92)';
    ctx.strokeStyle = isLocked ? 'rgba(16, 185, 129, 0.9)' : 'rgba(244, 63, 94, 0.88)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') {
      (ctx as any).roundRect(6, 6, canvas.width - 12, canvas.height - 12, 16);
    } else {
      ctx.rect(6, 6, canvas.width - 12, canvas.height - 12);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isLocked ? '#10b981' : '#f43f5e';
    ctx.beginPath();
    ctx.arc(24, 45, 5, 0, Math.PI * 2);
    ctx.fill();

    const tag = speedKmh > 0 ? `${speedKmh} km/h` : 'STATIC';
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = isLocked ? '#34d399' : '#fca5a5';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`[ BEACON · ${tag} ]`, 38, 30);

    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#ffffff';
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
    color: 0x38bdf8,
    cssColor: '#38bdf8',
    strokeRgba: 'rgba(56, 189, 248, 0.6)',
    dashSize: 4,
    gapSize: 3,
    labelAngle: 0.35,
  },
  {
    id: 'leo-limit',
    name: 'LEO Limit',
    shortTag: 'LEO Boundary',
    altKm: 2000,
    color: 0xfbbf24,
    cssColor: '#fbbf24',
    strokeRgba: 'rgba(251, 191, 36, 0.6)',
    dashSize: 6,
    gapSize: 4,
    labelAngle: 0.55,
  },
  {
    id: 'meo-gps',
    name: 'MEO / GPS',
    shortTag: 'GPS Constellation',
    altKm: 20200,
    color: 0xa855f7,
    cssColor: '#c084fc',
    strokeRgba: 'rgba(168, 85, 247, 0.6)',
    dashSize: 10,
    gapSize: 6,
    labelAngle: 0.75,
  },
  {
    id: 'geo',
    name: 'Geostationary',
    shortTag: 'GEO Clarke Belt',
    altKm: 35786,
    color: 0xf43f5e,
    cssColor: '#fb7185',
    strokeRgba: 'rgba(244, 63, 94, 0.6)',
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
  const beaconSpriteRef = useRef<THREE.Sprite | null>(null);
  const beaconLabelRef = useRef<THREE.Sprite | null>(null);
  const lastBeaconLabelState = useRef({ speed: -1, locked: false });
  const backupSpriteRef = useRef<THREE.Sprite | null>(null);
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

  // Atmospheric Shells (0-20km Turbulence Zone, 20-100km Thin Atmosphere, 100km Kármán Line)
  const atmosphereGroupRef = useRef<THREE.Group | null>(null);
  const turbulenceShellRef = useRef<THREE.Mesh | null>(null);
  const thinAtmoShellRef = useRef<THREE.Mesh | null>(null);
  const karmanRingRef = useRef<THREE.Line | null>(null);
  const turbulenceLabelRef = useRef<THREE.Sprite | null>(null);
  const thinAtmoLabelRef = useRef<THREE.Sprite | null>(null);
  const karmanLabelRef = useRef<THREE.Sprite | null>(null);
  const [showAtmosphereShells, setShowAtmosphereShells] = useState<boolean>(true);

  // Standard Reference Altitude Rings (100km, 2000km, 20200km, 35786km - Task 2 & 3)
  const referenceRingsGroupRef = useRef<THREE.Group | null>(null);
  const refRingMeshesRef = useRef<{
    spec: ReferenceAltitudeSpec;
    ring: THREE.Line;
    label: THREE.Sprite;
  }[]>([]);
  const [showReferenceRings, setShowReferenceRings] = useState<boolean>(false); // Off by default

  // Solar Direction & Day/Night Terminator State (Tasks 1-4)
  const sunGroupRef = useRef<THREE.Group | null>(null);
  const terminatorRingRef = useRef<THREE.Line | null>(null);
  const terminatorLabelRef = useRef<THREE.Sprite | null>(null);
  const sunArrowRef = useRef<THREE.ArrowHelper | null>(null);
  const sunLabelRef = useRef<THREE.Sprite | null>(null);
  const nightShadingMeshRef = useRef<THREE.Mesh | null>(null);
  const [showSunTerminator, setShowSunTerminator] = useState<boolean>(true); // Active by default

  // Satellite Ground Footprint (Elevation Mask Geometry - Tasks 1-3)
  const footprintGroupRef = useRef<THREE.Group | null>(null);
  const footprintRingRef = useRef<THREE.LineLoop | null>(null);
  const footprintCapMeshRef = useRef<THREE.Mesh | null>(null);
  const footprintCenterMarkerRef = useRef<THREE.Mesh | null>(null);
  const footprintLabelRef = useRef<THREE.Sprite | null>(null);
  const [showFootprint, setShowFootprint] = useState<boolean>(true); // Active by default
  const [isBeaconInFootprint, setIsBeaconInFootprint] = useState<boolean>(false);
  const [beaconElevationDeg, setBeaconElevationDeg] = useState<number>(0.0);
  const [footprintThetaDeg, setFootprintThetaDeg] = useState<number>(14.96);
  const [footprintGroundRadiusKm, setFootprintGroundRadiusKm] = useState<number>(1665.0);

  // Earth Render Radius state (defaults to 100u, dynamically tunable)
  const [earthRenderRadius, setEarthRenderRadius] = useState<number>(EARTH_RENDER_R);
  const earthRenderRadiusRef = useRef<number>(EARTH_RENDER_R);
  earthRenderRadiusRef.current = earthRenderRadius;
  const globeRadius = earthRenderRadius;

  // Target Ground Station position ref (radius = 100 on surface)
  const tgtPosRef = useRef(new THREE.Vector3(38, 76, 52).normalize().multiplyScalar(globeRadius));

  // Beacon Surface Motion State (Physically grounded atmospheric UAV/Drone platform: 0 - 1200 km/h)
  const [beaconSpeedKmh, setBeaconSpeedKmh] = useState<number>(150);
  const [beaconRevolving, setBeaconRevolving] = useState<boolean>(true);
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
    speedKmh: 150,
    anomaly: THREE.MathUtils.degToRad(120.0),
    incDeg: 28.5,
    raanDeg: 65.0,
  });

  useEffect(() => {
    beaconMotionRef.current.isRevolving = beaconRevolving;
    beaconMotionRef.current.speedKmh = beaconSpeedKmh;
    beaconMotionRef.current.incDeg = beaconInc;
    beaconMotionRef.current.raanDeg = beaconRaan;
  }, [beaconRevolving, beaconSpeedKmh, beaconInc, beaconRaan]);

  // Interactive Orbit Controller State
  const [selectedPresetId, setSelectedPresetId] = useState<string>('leo-550-p1');
  const selectedPresetIdRef = useRef<string>(selectedPresetId);
  selectedPresetIdRef.current = selectedPresetId;
  const [selectedMarkerType, setSelectedMarkerType] = useState<'sat' | 'beacon' | 'peer' | null>('sat');
  const selectedMarkerTypeRef = useRef<'sat' | 'beacon' | 'peer' | null>(selectedMarkerType);
  selectedMarkerTypeRef.current = selectedMarkerType;
  // Render scale mode (Rule 2 & 4: default TRUE_SCALE)
  const [scaleMode, setScaleMode] = useState<RenderScaleMode>('TRUE_SCALE');
  const scaleModeRef = useRef<RenderScaleMode>('TRUE_SCALE');
  scaleModeRef.current = scaleMode;

  // Standard Keplerian elements (Rule 1 & 4)
  const [orbitPerigeeKm, setOrbitPerigeeKm] = useState<number>(550.0);
  const [orbitApogeeKm, setOrbitApogeeKm] = useState<number>(550.0);
  const [orbitAltitudeKm, setOrbitAltitudeKm] = useState<number>(550.0);
  const [orbitRadius, setOrbitRadius] = useState<number>(getRenderOrbitRadius(550.0, 'TRUE_SCALE'));
  const [orbitInc, setOrbitInc] = useState<number>(53.0);
  const [orbitRaan, setOrbitRaan] = useState<number>(35.0);
  const [orbitArgPerigeeDeg, setOrbitArgPerigeeDeg] = useState<number>(0.0);
  const [orbitAnomalyDeg, setOrbitAnomalyDeg] = useState<number>(48.7);
  const [autoRevolve, setAutoRevolve] = useState<boolean>(true);
  const [revolveSpeed, setRevolveSpeed] = useState<number>(0.003);
  const [showOrbitTuner, setShowOrbitTuner] = useState<boolean>(false);
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
  const [simTimeWarp, setSimTimeWarp] = useState<number>(60);
  const simTimeWarpRef = useRef<number>(60);
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

  // Sync autoLOS and beaconSpeedKmh state from satellitePovSync
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
    });
    return unsub;
  }, []);

  const handleToggleAutoLOS = () => {
    const next = !autoLOS;
    setAutoLOS(next);
    autoLOSRef.current = next;
    satellitePovSync.update({ autoLOS: next });
  };

  // Earth Diurnal Rotation State (Real physical spin: 15°/hour around polar Y-axis)
  const [earthSpinEnabled, setEarthSpinEnabled] = useState<boolean>(true);
  const [earthSpinMultiplier, setEarthSpinMultiplier] = useState<number>(1); // Default 1x real-time (15°/hr)

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
    meanAnomaly: THREE.MathUtils.degToRad(48.7),
    trueAnomaly: THREE.MathUtils.degToRad(48.7),
    anomaly: THREE.MathUtils.degToRad(48.7),
    radius: getRenderOrbitRadius(550.0, 'TRUE_SCALE'),
    currentRadiusKm: 6928.0,
    currentSpeedKmS: 7.585,
    altitudeKm: 550.0,
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
  }, [orbitPerigeeKm, orbitApogeeKm, orbitInc, orbitRaan, orbitArgPerigeeDeg, autoRevolve, revolveSpeed]);

  // Orbit camera drag state
  const isDraggingRef = useRef(false);
  const previousMousePositionRef = useRef({ x: 0, y: 0 });
  const orbitStateRef = useRef({
    theta: 0.75,
    phi: 0.45,
    radius: 340.0,
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

    if (turbulenceShellRef.current) {
      turbulenceShellRef.current.geometry.dispose();
      turbulenceShellRef.current.geometry = new THREE.SphereGeometry(r20, 48, 24);
    }

    if (thinAtmoShellRef.current) {
      thinAtmoShellRef.current.geometry.dispose();
      thinAtmoShellRef.current.geometry = new THREE.SphereGeometry(r100, 48, 24);
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
      updateSpriteText(turbulenceLabelRef.current, 'Turbulence Zone', `0–${formatAltAndUnits(20, mode, READABLE_K, earthR)}`, '#38bdf8', 'rgba(14, 165, 233, 0.6)');
    }
    if (thinAtmoLabelRef.current) {
      thinAtmoLabelRef.current.position.set(-r100 * 0.45, r100 * 0.85, r100 * 0.28);
      updateSpriteText(thinAtmoLabelRef.current, 'Thin Atmosphere', `20–${formatAltAndUnits(100, mode, READABLE_K, earthR)}`, '#818cf8', 'rgba(99, 102, 241, 0.6)');
    }
    if (karmanLabelRef.current) {
      karmanLabelRef.current.position.set(r100 * Math.cos(0.35), 2.5, r100 * Math.sin(0.35));
      updateSpriteText(karmanLabelRef.current, 'Kármán Line — Edge of Space', formatAltAndUnits(100, mode, READABLE_K, earthR), '#34d399', 'rgba(16, 185, 129, 0.6)');
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
    if (nightShadingMeshRef.current) {
      nightShadingMeshRef.current.geometry.dispose();
      nightShadingMeshRef.current.geometry = new THREE.SphereGeometry(earthR + 0.08, 48, 24);
    }
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
  };

  const handleEarthRenderRadiusChange = (newRadius: number) => {
    setEarthRenderRadius(newRadius);
    earthRenderRadiusRef.current = newRadius;
    if (globeMeshRef.current) {
      const s = newRadius / 100.0;
      globeMeshRef.current.scale.set(s, s, s);
    }
    updateConstellationScale(scaleMode, newRadius);
    updateSunTerminatorGeometry(newRadius);
    updateBeaconTrackGeometry(beaconInc, beaconRaan);
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

      updateActiveOrbitRingGeometry(perigee, apogee, inc, raan, argPerigee, scaleMode);

      // In TRUE_SCALE, if selecting GEO or GTO (apogee 35,786 km), zoom camera out to frame it
      if (scaleMode === 'TRUE_SCALE' && apogee > 30000) {
        if (orbitStateRef.current.radius < 900) {
          orbitStateRef.current.radius = 1100.0;
        }
      } else if (apogee <= 2000 && orbitStateRef.current.radius > 700) {
        orbitStateRef.current.radius = 340.0;
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

    // 4. Lighting & Solar Direction Vector (Task 1)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambientLight);
    const sunLight = new THREE.DirectionalLight(0xfffaed, 1.35);
    sunLight.position.copy(FIXED_SUN_DIR.clone().multiplyScalar(600));
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

    // 5a. NIGHT-SIDE HEMISPHERE SHADING OVERLAY (Task 3)
    // Darkens the night hemisphere (dot(vWorldNormal, sunDir) < 0) smoothly with twilight penumbra
    const nightShaderMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: FIXED_SUN_DIR.clone() },
      },
      vertexShader: `
        varying vec3 vWorldNormal;
        void main() {
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        varying vec3 vWorldNormal;
        void main() {
          float dotSun = dot(vWorldNormal, uSunDir);
          // Twilight transition across the terminator (-0.08 to +0.08)
          float nightFactor = smoothstep(0.08, -0.08, dotSun);
          // Darken night hemisphere by shading over globe and wireframe
          gl_FragColor = vec4(0.01, 0.02, 0.06, nightFactor * 0.62);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
    });
    const nightGeo = new THREE.SphereGeometry(globeRadius + 0.08, 48, 24);
    const nightMesh = new THREE.Mesh(nightGeo, nightShaderMat);
    nightMesh.name = 'nightSideShading';
    nightMesh.visible = showSunTerminator;
    nightMesh.renderOrder = 1;
    scene.add(nightMesh);
    nightShadingMeshRef.current = nightMesh;

    // 5b. CONCENTRIC ATMOSPHERIC SHELLS & KÁRMÁN LINE (Matching Physics Layer 0-20km Turbulence)
    // Sizing dynamically reuses getRenderOrbitRadius(altKm, scaleMode)
    const atmoGroup = new THREE.Group();
    atmoGroup.name = 'atmosphereGroup';
    atmoGroup.visible = showAtmosphereShells;
    atmosphereGroupRef.current = atmoGroup;

    const r20 = getRenderOrbitRadius(20.0, scaleModeRef.current);
    const r100 = getRenderOrbitRadius(100.0, scaleModeRef.current);

    // 1. Shaded Turbulence Zone Shell (0-20 km)
    // Primary optical disturbance region (scintillation, jitter, beam wander)
    const turbGeo = new THREE.SphereGeometry(r20, 48, 24);
    const turbMat = new THREE.MeshBasicMaterial({
      color: 0x0284c7, // sky-600 shaded cyan-blue
      transparent: true,
      opacity: 0.16,
      depthWrite: false, // Prevents occluding satellites/lines behind or inside
      depthTest: true,
      side: THREE.FrontSide,
    });
    const turbMesh = new THREE.Mesh(turbGeo, turbMat);
    turbMesh.name = 'turbulenceZoneShell';
    turbMesh.renderOrder = 2;
    atmoGroup.add(turbMesh);
    turbulenceShellRef.current = turbMesh;

    // 2. Faint/Thin Atmosphere Shell (20-100 km)
    // Upper stratosphere, mesosphere & thermosphere up to edge of space
    const thinGeo = new THREE.SphereGeometry(r100, 48, 24);
    const thinMat = new THREE.MeshBasicMaterial({
      color: 0x60a5fa, // light indigo/periwinkle faint veil
      transparent: true,
      opacity: 0.055,
      depthWrite: false,
      depthTest: true,
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
      color: 0x38bdf8,
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
      '#38bdf8',
      'rgba(14, 165, 233, 0.6)'
    );
    turbLabel.position.set(r20 * 0.72, r20 * 0.45, r20 * 0.52);
    atmoGroup.add(turbLabel);
    turbulenceLabelRef.current = turbLabel;

    const thinLabel = createAtmosphereLabelSprite(
      'Thin Atmosphere',
      `20–${formatAltAndUnits(100, scaleModeRef.current)}`,
      '#818cf8',
      'rgba(99, 102, 241, 0.6)'
    );
    thinLabel.position.set(-r100 * 0.45, r100 * 0.85, r100 * 0.28);
    atmoGroup.add(thinLabel);
    thinAtmoLabelRef.current = thinLabel;

    const karmanLabel = createAtmosphereLabelSprite(
      'Kármán Line — Edge of Space',
      formatAltAndUnits(100, scaleModeRef.current),
      '#34d399',
      'rgba(16, 185, 129, 0.6)'
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
    const initFpMinEl = handoverData?.min_elevation_deg ?? 10.0;
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
      '#10b981',
      'rgba(16, 185, 129, 0.7)'
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
      const startAnomaly = (index + 1) * 1.1;
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

    // 8. ACTIVE SATELLITE (Flat screen-space billboard marker - Tasks 1-5)
    // Replaced 3D shaded sphere + panels with standardized flat billboard dot
    const satGroup = new THREE.Group();
    const satSpriteMat = new THREE.SpriteMaterial({
      map: getFlatMarkerTexture(),
      color: 0x0284c7, // Standard Satellite Blue
      depthTest: true,
      depthWrite: false,
      transparent: true,
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
    // 12b. BACKUP SATELLITE (Flat screen-space billboard marker - Tasks 1-5)
    const backupGroup = new THREE.Group();
    const backupSpriteMat = new THREE.SpriteMaterial({
      map: getFlatMarkerTexture(),
      color: 0x818cf8, // Standard Backup Satellite Purple
      depthTest: true,
      depthWrite: false,
      transparent: true,
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

    // Raycast click for comfortable marker selection (Task 6)
    const onClick = (e: MouseEvent) => {
      if (dragDistance > 5) return;
      const rect = container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, perspCamera);

      const clickables: { obj: THREE.Object3D; action: () => void }[] = [];
      if (satSpriteRef.current) {
        clickables.push({
          obj: satSpriteRef.current,
          action: () => {
            setSelectedPresetId('leo-550-p1');
            setSelectedMarkerType('sat');
          },
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

    const animate = () => {
      animId = requestAnimationFrame(animate);
      frameCount++;
      const nowMs = performance.now();
      const dtRealSec = Math.min(0.1, (nowMs - lastTimeMs) / 1000.0);
      lastTimeMs = nowMs;
      const isRevolving = activeOrbitRef.current.autoRevolve;
      const dtSimSec = isRevolving ? dtRealSec * simTimeWarpRef.current : 0;
      let isBeaconInFp = false;

      // 0. Advance Earth's diurnal rotation around its polar axis (Y) synchronized with physical clock
      if (globeMeshRef.current && earthSpinRef.current.enabled) {
        const dTheta = EARTH_ROT_RAD_PER_SEC * (isRevolving ? dtSimSec : dtRealSec) * earthSpinRef.current.multiplier;
        globeMeshRef.current.rotation.y += dTheta;
      }

      // 1. Advance peer constellation satellites along their orbits according to Kepler's Third Law
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

      // 2. Advance active primary satellite along its Keplerian orbit
      const aKm = activeOrbitRef.current.semiMajorAxisKm;
      const e = activeOrbitRef.current.eccentricity;
      const meanMotionRadS = Math.sqrt(GM_EARTH_KM3_S2 / (aKm * aKm * aKm)); // n = sqrt(GM / a^3)

      if (isRevolving) {
        // Physical Keplerian motion: mean anomaly advances by mean motion n (rad/s) * dtSimSec
        const stepRate = meanMotionRadS * dtSimSec;
        activeOrbitRef.current.meanAnomaly = (activeOrbitRef.current.meanAnomaly + stepRate) % (2 * Math.PI);
      }

      // Solve Kepler's equation each step: M -> E -> nu
      const E = solveKepler(activeOrbitRef.current.meanAnomaly, e);
      const nu = eccentricToTrueAnomaly(E, e);
      activeOrbitRef.current.trueAnomaly = nu;

      // Current physical distance r from Earth center (km)
      const currentRPhysKm = e < 1e-8 ? aKm : aKm * (1 - e * Math.cos(E));
      const currentAltPhysKm = currentRPhysKm - EARTH_RADIUS_KM;
      activeOrbitRef.current.currentRadiusKm = currentRPhysKm;
      activeOrbitRef.current.altitudeKm = currentAltPhysKm;

      // Full vis-viva equation: v = sqrt(GM * (2/r - 1/a))
      // For circular orbit (e = 0), r = a, so 2/r - 1/a = 1/r, v = sqrt(GM/r)
      const currentSpeedKmS = Math.sqrt(Math.max(0, GM_EARTH_KM3_S2 * (2.0 / currentRPhysKm - 1.0 / aKm)));
      activeOrbitRef.current.currentSpeedKmS = currentSpeedKmS;

      // 3D Render radius using current scaleMode
      const activeRenderRadius = getRenderOrbitRadius(currentAltPhysKm, scaleModeRef.current);
      activeOrbitRef.current.radius = activeRenderRadius;

      // Compute current position of satellite
      const currentSatPos = computeOrbitPoint(
        activeRenderRadius,
        activeOrbitRef.current.incDeg,
        activeOrbitRef.current.raanDeg,
        nu,
        activeOrbitRef.current.argPerigeeDeg
      );

      // 2b. Advance backup satellite (same orbit, phase-offset along orbit)
      const backupPhaseRad = THREE.MathUtils.degToRad(backupPhaseOffsetDeg);
      const backupM = (activeOrbitRef.current.meanAnomaly + backupPhaseRad) % (2 * Math.PI);
      const backupE = solveKepler(backupM, e);
      const backupNu = eccentricToTrueAnomaly(backupE, e);
      const backupRPhysKm = e < 1e-8 ? aKm : aKm * (1 - e * Math.cos(backupE));
      const backupAltKm = backupRPhysKm - EARTH_RADIUS_KM;
      const backupRenderRadius = getRenderOrbitRadius(backupAltKm, scaleModeRef.current);
      const backupSatPos = computeOrbitPoint(
        backupRenderRadius,
        activeOrbitRef.current.incDeg,
        activeOrbitRef.current.raanDeg,
        backupNu,
        activeOrbitRef.current.argPerigeeDeg
      );
      if (backupSatMeshRef.current) {
        backupSatMeshRef.current.position.copy(backupSatPos);
        backupSatMeshRef.current.lookAt(tgtPosRef.current);
      }

      // 3. Advance or maintain beacon ground position (Atmospheric UAV/Drone platform: 0 - 1200 km/h)
      // omega_real = (2 * Math.PI * speed_kmh) / (40075 * 3600)  // in radians/sec
      // deltaTheta = (omega_real * SIMULATION_TIME_SCALE) * delta
      const effectiveBeaconSpeedKmh = beaconMotionRef.current.isRevolving ? beaconMotionRef.current.speedKmh : 0;
      if (effectiveBeaconSpeedKmh > 0) {
        const omega_real = (2.0 * Math.PI * effectiveBeaconSpeedKmh) / (EARTH_CIRCUMFERENCE_KM * 3600.0);
        const deltaTheta = (omega_real * simTimeWarpRef.current) * dtRealSec;
        beaconMotionRef.current.anomaly = (beaconMotionRef.current.anomaly + deltaTheta) % (2.0 * Math.PI);
      }

      // Rotate beacon ground track ring with Earth's diurnal spin (15°/hour)
      if (beaconTrackRingRef.current && globeMeshRef.current) {
        beaconTrackRingRef.current.rotation.y = globeMeshRef.current.rotation.y;
      }

      const currentBeaconGroundPos = computeOrbitPoint(
        globeRadius,
        beaconMotionRef.current.incDeg,
        beaconMotionRef.current.raanDeg,
        beaconMotionRef.current.anomaly
      );
      // Anchor beacon to the rotating Earth surface (rotates at 15°/hour around polar Y-axis)
      if (globeMeshRef.current) {
        currentBeaconGroundPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), globeMeshRef.current.rotation.y);
      }
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

      // 4. Update Active Satellite Ground Footprint (Elevation Mask Geometry - Tasks 1-3)
      if (footprintGroupRef.current && footprintGroupRef.current.visible) {
        const satDir = currentSatPos.clone().normalize();
        const beaconDir = tgtPosRef.current.clone().normalize();

        // Minimum elevation angle (reusing existing setting from handover / default 10.0°)
        const minEl = handoverRef.current?.min_elevation_deg ?? handoverData?.min_elevation_deg ?? 10.0;
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
            const statusColor = isInside ? '#10b981' : '#f43f5e';
            const strokeColor = isInside ? 'rgba(16, 185, 129, 0.7)' : 'rgba(244, 63, 94, 0.7)';
            updateSpriteText(
              footprintLabelRef.current,
              'Ground Footprint',
              statusTag,
              statusColor,
              strokeColor
            );
          }
        }

        // Update React state periodically (every 6 frames)
        if (frameCount % 6 === 0) {
          setIsBeaconInFootprint(isInside);
          setBeaconElevationDeg(elDeg);
          setFootprintThetaDeg(THREE.MathUtils.radToDeg(theta));
          setFootprintGroundRadiusKm(EARTH_RADIUS_KM * theta);
        }
      }

      // Broadcast live satellite orbital position and beacon state to FPA Camera Viewport
      satellitePovSync.update({
        satPos: currentSatPos,
        tgtPos: tgtPosRef.current,
        earthRotationY: globeMeshRef.current?.rotation.y ?? 0,
        isOccluded,
        orbitRadius: activeOrbitRef.current.radius,
        incDeg: activeOrbitRef.current.incDeg,
        raanDeg: activeOrbitRef.current.raanDeg,
        anomaly: activeOrbitRef.current.trueAnomaly,
        perigeeAltKm: activeOrbitRef.current.perigeeAltKm,
        apogeeAltKm: activeOrbitRef.current.apogeeAltKm,
        argPerigeeDeg: activeOrbitRef.current.argPerigeeDeg,
        semiMajorAxisKm: activeOrbitRef.current.semiMajorAxisKm,
        eccentricity: activeOrbitRef.current.eccentricity,
        speedKmS: activeOrbitRef.current.currentSpeedKmS,
        currentRadiusKm: activeOrbitRef.current.currentRadiusKm,
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

      // Synchronize beacon color: GREEN when locked in FOV, RED when lost from FOV (Task 3)
      if (targetCubeMeshRef.current) {
        const mat = (targetCubeMeshRef.current as any).material as THREE.SpriteMaterial;
        if (mat && mat.color) {
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
        anomaly: activeOrbitRef.current.trueAnomaly,
        perigeeAltKm: activeOrbitRef.current.perigeeAltKm,
        apogeeAltKm: activeOrbitRef.current.apogeeAltKm,
        argPerigeeDeg: activeOrbitRef.current.argPerigeeDeg,
        semiMajorAxisKm: activeOrbitRef.current.semiMajorAxisKm,
        eccentricity: activeOrbitRef.current.eccentricity,
        speedKmS: activeOrbitRef.current.currentSpeedKmS,
        currentRadiusKm: activeOrbitRef.current.currentRadiusKm,
        isLockedInFov,
        isLostFromFov,
      });

      // Update telemetry state occasionally
      if (frameCount % 6 === 0) {
        const dist = currentSatPos.distanceTo(tgtPosRef.current);
        setCurrentSlantRange(dist);
        setOrbitRadius(Number(currentSatPos.length().toFixed(1)));
        setIsOccludedByEarth(isOccluded);
        setSlewAngularError(angDeg);

        // Update live derived values (Rule 4)
        setDerivedA(activeOrbitRef.current.semiMajorAxisKm);
        setDerivedE(activeOrbitRef.current.eccentricity);
        setDerivedR(activeOrbitRef.current.currentRadiusKm);
        setDerivedSpeed(activeOrbitRef.current.currentSpeedKmS);
        setDerivedPeriodSec(computeOrbitalPeriodSec(activeOrbitRef.current.semiMajorAxisKm));
        setOrbitAnomalyDeg(THREE.MathUtils.radToDeg(activeOrbitRef.current.trueAnomaly));

        // Real physical slant range in km (Rule 1: physics stays in real km, unchanged)
        const satNorm = currentSatPos.clone().normalize();
        const tgtNorm = tgtPosRef.current.clone().normalize();
        const satPhysKm = satNorm.multiplyScalar(activeOrbitRef.current.currentRadiusKm);
        const tgtPhysKm = tgtNorm.multiplyScalar(EARTH_RADIUS_KM);
        const physDistKm = satPhysKm.distanceTo(tgtPhysKm);
        setCurrentSlantRangeKm(physDistKm);
      }

      // 14. Standardized screen-space billboard scaling for all scene markers (Tasks 1, 2, 5, 6)
      const canvasH = container.clientHeight || 480;

      // 1) Active primary satellite: 15.4px if selected, otherwise base 11.0px
      const isPrimarySatActive =
        selectedMarkerTypeRef.current === 'sat' ||
        selectedPresetIdRef.current === 'leo-550-p1' ||
        selectedPresetIdRef.current === 'custom';
      updateScreenSpaceMarkerScale(
        satSpriteRef.current,
        perspCamera,
        canvasH,
        isPrimarySatActive ? ACTIVE_MARKER_PX : BASE_MARKER_PX
      );

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

      // 3) Backup satellite: 15.4px during active handover, otherwise base 11.0px
      const isBackupActive = handoverRef.current && handoverRef.current.state !== 'IDLE';
      updateScreenSpaceMarkerScale(
        backupSpriteRef.current,
        perspCamera,
        canvasH,
        isBackupActive ? ACTIVE_MARKER_PX : BASE_MARKER_PX
      );

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
      nightShadingMeshRef.current.visible = showSunTerminator;
    }
    if (footprintGroupRef.current) {
      footprintGroupRef.current.visible = showFootprint;
    }
  }, [showAtmosphereShells, showReferenceRings, showSunTerminator, showFootprint]);

  const activePreset = LEO_PRESETS.find((p) => p.id === selectedPresetId);

  return (
    <div className="relative w-full h-full flex flex-col bg-[#05070e] border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
      {/* 3D Viewport Header */}
      <div className="flex flex-wrap items-center justify-between px-3 py-2 bg-slate-900/95 border-b border-slate-800 text-xs font-mono gap-2 z-10">
        <div className="flex items-center gap-2 text-cyan-400">
          <Box className="w-4 h-4 text-cyan-400 animate-pulse" />
          <span className="font-semibold tracking-wider">3D LEO KINEMATICS TESTBENCH</span>
        </div>

        {/* Orbit Change Controls & Render Scale Toggle */}
        <div className="flex items-center gap-2">
          {/* Render Scale Mode Toggle (Rule 4: default TRUE_SCALE) */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800 text-[11px]">
            <button
              onClick={() => handleScaleModeChange('TRUE_SCALE')}
              className={`px-2 py-0.5 rounded transition font-mono ${
                scaleMode === 'TRUE_SCALE'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-600 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
              title="True Physical Scale: Earth R=100u, LEO 550km = +8.6u, GEO = +561u"
            >
              True Scale
            </button>
            <button
              onClick={() => handleScaleModeChange('READABLE_SCALE')}
              className={`px-2 py-0.5 rounded transition font-mono ${
                scaleMode === 'READABLE_SCALE'
                  ? 'bg-amber-950 text-amber-300 border border-amber-600 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
              title="Readable Logarithmic Scale: Simultaneously view LEO and GEO"
            >
              Readable Scale
            </button>
          </div>

          {/* Quick Preset Selector Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded border border-slate-800 text-[11px]">
            <Compass className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-400 hidden sm:inline">Orbit:</span>
            <select
              value={selectedPresetId}
              onChange={(e) => handlePresetSelect(e.target.value)}
              className="bg-transparent text-cyan-300 font-semibold focus:outline-none cursor-pointer pr-1"
            >
              {ORBIT_PRESETS.map((p) => (
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

          {/* Real Orbital Speeds & Revolution Periods Reference Table Modal Toggle */}
          <button
            onClick={() => setShowSpecsTable(!showSpecsTable)}
            className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1.5 transition ${
              showSpecsTable
                ? 'bg-indigo-950 text-indigo-300 border-indigo-600 shadow-sm shadow-indigo-900/40 font-bold'
                : 'bg-slate-800 hover:bg-slate-700 text-indigo-300 border-slate-700'
            }`}
            title="View Real Satellite Speeds & Revolution Periods Table (Keplerian Reference)"
          >
            <Table className="w-3 h-3 text-indigo-400" />
            <span className="hidden sm:inline">Speeds & Periods</span>
          </button>

          {/* Quick Time Warp Badge in Header */}
          <div className="flex items-center gap-1 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 text-[10px]">
            <Clock className="w-3 h-3 text-cyan-400" />
            <select
              value={simTimeWarp}
              onChange={(e) => setSimTimeWarp(Number(e.target.value))}
              className="bg-transparent text-cyan-300 font-bold focus:outline-none cursor-pointer"
              title="Simulation Physical Time Warp (Keplerian Rate)"
            >
              <option value={1} className="bg-slate-900 text-slate-200">1× (Real-Time)</option>
              <option value={60} className="bg-slate-900 text-slate-200">60× (1s = 1m)</option>
              <option value={120} className="bg-slate-900 text-slate-200">120× (1s = 2m)</option>
              <option value={360} className="bg-slate-900 text-slate-200">360× (1s = 6m)</option>
              <option value={1440} className="bg-slate-900 text-slate-200">1440× (1m = 1d)</option>
            </select>
          </div>

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
            <span className="hidden sm:inline">Earth {earthSpinEnabled ? 'Spin (15°/hr)' : 'Static'}</span>
          </button>

          {/* Atmosphere Shells Toggle (0-20km Turbulence, 20-100km Thin Atmo, 100km Kármán Line) */}
          <button
            onClick={() => setShowAtmosphereShells(!showAtmosphereShells)}
            className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 transition ${
              showAtmosphereShells
                ? 'bg-sky-950/80 hover:bg-sky-900 text-sky-300 border-sky-700 shadow-sm shadow-sky-950 font-semibold'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-500 border-slate-800'
            }`}
            title={showAtmosphereShells ? 'Hide Atmosphere Shells & Kármán Line (0-20 km, 20-100 km, 100 km)' : 'Show Atmosphere Shells & Kármán Line'}
          >
            <Layers className={`w-3 h-3 ${showAtmosphereShells ? 'text-sky-400' : 'text-slate-600'}`} />
            <span className="hidden sm:inline">Atmosphere: {showAtmosphereShells ? 'Visible' : 'Hidden'}</span>
          </button>

          {/* Standard Reference Altitude Rings Toggle (100km, 2000km, 20200km, 35786km - Task 3: off by default) */}
          <button
            onClick={() => setShowReferenceRings(!showReferenceRings)}
            className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 transition ${
              showReferenceRings
                ? 'bg-purple-950/80 hover:bg-purple-900 text-purple-300 border-purple-700 shadow-sm shadow-purple-950 font-semibold'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-500 border-slate-800'
            }`}
            title={showReferenceRings ? 'Hide Reference Altitude Rings' : 'Show Standard Reference Altitude Rings (100 km, 2,000 km, 20,200 km, 35,786 km)'}
          >
            <Compass className={`w-3 h-3 ${showReferenceRings ? 'text-purple-400' : 'text-slate-600'}`} />
            <span className="hidden sm:inline">Ref Rings: {showReferenceRings ? 'Visible' : 'Hidden'}</span>
          </button>

          {/* Sun / Terminator Toggle (Tasks 1-4) */}
          <button
            onClick={() => setShowSunTerminator(!showSunTerminator)}
            className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 transition ${
              showSunTerminator
                ? 'bg-amber-950/80 hover:bg-amber-900 text-amber-300 border-amber-600/80 font-semibold'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-500 border-slate-800'
            }`}
            title={showSunTerminator ? 'Hide Sun Direction & Day/Night Terminator Line' : 'Show Sun Direction & Day/Night Terminator Line'}
          >
            <Sun className={`w-3 h-3 ${showSunTerminator ? 'text-amber-400' : 'text-slate-600'}`} />
            <span className="hidden sm:inline">Sun/Term: {showSunTerminator ? 'Visible' : 'Hidden'}</span>
          </button>

          {/* Ground Footprint Toggle (Tasks 1-3) */}
          <button
            onClick={() => setShowFootprint(!showFootprint)}
            className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 transition ${
              showFootprint
                ? 'bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border-emerald-600/80 font-semibold'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-500 border-slate-800'
            }`}
            title={showFootprint ? 'Hide Satellite Ground Footprint (Elevation Mask)' : 'Show Satellite Ground Footprint (Elevation Mask)'}
          >
            <Target className={`w-3 h-3 ${showFootprint ? 'text-emerald-400' : 'text-slate-600'}`} />
            <span className="hidden sm:inline">Footprint: {showFootprint ? 'Visible' : 'Hidden'}</span>
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

          {/* Lower Pole View */}
          <button
            onClick={() => {
              orbitStateRef.current = { theta: 0, phi: -1.35, radius: 340.0 };
            }}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-slate-700 flex items-center gap-1 text-[11px] transition"
            title="Tilt camera directly to Lower Pole (South Pole / Antarctica)"
          >
            <Compass className="w-3 h-3 text-cyan-400" /> <span className="hidden sm:inline">Lower Pole</span>
          </button>

          {/* Upper Pole View */}
          <button
            onClick={() => {
              orbitStateRef.current = { theta: 0, phi: 1.35, radius: 340.0 };
            }}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-slate-700 flex items-center gap-1 text-[11px] transition"
            title="Tilt camera directly to Upper Pole (North Pole / Arctic)"
          >
            <Compass className="w-3 h-3 text-cyan-400 rotate-180" /> <span className="hidden sm:inline">Upper Pole</span>
          </button>

          {/* Reset Camera View */}
          <button
            onClick={resetCameraView}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-slate-700 flex items-center gap-1 text-[11px] transition"
            title="Reset 3D Orbit Camera to Default Angle"
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

          {/* Scale Mode Selector in Tuner */}
          <div className="border-b border-slate-800/80 pb-2">
            <div className="flex justify-between items-center text-slate-400 mb-1 text-[10px]">
              <span className="uppercase tracking-wider">3D Scale Mode:</span>
              <span className={scaleMode === 'TRUE_SCALE' ? 'text-cyan-300 font-bold' : 'text-amber-300 font-bold'}>
                {scaleMode === 'TRUE_SCALE' ? '1:1 True Physical' : 'Readable Logarithmic'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => handleScaleModeChange('TRUE_SCALE')}
                className={`px-2 py-1 rounded text-center border text-[10px] transition ${
                  scaleMode === 'TRUE_SCALE'
                    ? 'bg-cyan-950 text-cyan-300 border-cyan-600 font-bold'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                True Scale (R=100u)
              </button>
              <button
                onClick={() => handleScaleModeChange('READABLE_SCALE')}
                className={`px-2 py-1 rounded text-center border text-[10px] transition ${
                  scaleMode === 'READABLE_SCALE'
                    ? 'bg-amber-950 text-amber-300 border-amber-600 font-bold'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                Readable Scale
              </button>
            </div>

            {/* Earth Render Radius Slider */}
            <div className="pt-2">
              <div className="flex justify-between items-center text-slate-400 mb-1 text-[10px]">
                <span>Earth Render Radius ($R_E$):</span>
                <span className="text-cyan-300 font-bold font-mono">{earthRenderRadius.toFixed(0)}u = 6,378 km</span>
              </div>
              <input
                type="range"
                min="50"
                max="200"
                step="5"
                value={earthRenderRadius}
                onChange={(e) => handleEarthRenderRadiusChange(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                title="Adjust Earth 3D render radius"
              />
            </div>
          </div>

          {/* Atmosphere Shells & Kármán Line Control */}
          <div className="border-b border-slate-800/80 pb-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5 text-sky-400 font-bold uppercase tracking-wider">
                <Layers className="w-3.5 h-3.5 text-sky-400" />
                <span>Atmosphere Layers:</span>
              </div>
              <button
                onClick={() => setShowAtmosphereShells(!showAtmosphereShells)}
                className={`px-2 py-0.5 rounded text-[10px] border transition ${
                  showAtmosphereShells
                    ? 'bg-sky-950 text-sky-300 border-sky-600 font-bold'
                    : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                }`}
              >
                {showAtmosphereShells ? 'Visible (ON)' : 'Hidden (OFF)'}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1 text-[9px] font-mono">
              <div className="bg-slate-900/90 border border-sky-900/60 p-1 rounded">
                <div className="text-sky-300 font-bold">0–20 km</div>
                <div className="text-slate-400 text-[8px] leading-tight">Turbulence Zone</div>
                <div className="text-slate-400 text-[8px]">{formatAltAndUnits(20, scaleMode)}</div>
              </div>
              <div className="bg-slate-900/90 border border-indigo-900/60 p-1 rounded">
                <div className="text-indigo-300 font-bold">20–100 km</div>
                <div className="text-slate-400 text-[8px] leading-tight">Thin Atmosphere</div>
                <div className="text-slate-400 text-[8px]">{formatAltAndUnits(100, scaleMode)}</div>
              </div>
              <div className="bg-slate-900/90 border border-emerald-900/60 p-1 rounded">
                <div className="text-emerald-300 font-bold">100 km</div>
                <div className="text-slate-400 text-[8px] leading-tight">Kármán Line</div>
                <div className="text-slate-400 text-[8px]">{formatAltAndUnits(100, scaleMode)}</div>
              </div>
            </div>
          </div>

          {/* Standard Reference Altitude Rings Control (Task 2 & 3: 100km, 2000km, 20200km, 35786km) */}
          <div className="border-b border-slate-800/80 pb-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5 text-purple-400 font-bold uppercase tracking-wider">
                <Compass className="w-3.5 h-3.5 text-purple-400" />
                <span>Reference Altitude Rings:</span>
              </div>
              <button
                onClick={() => setShowReferenceRings(!showReferenceRings)}
                className={`px-2 py-0.5 rounded text-[10px] border transition ${
                  showReferenceRings
                    ? 'bg-purple-950 text-purple-300 border-purple-600 font-bold'
                    : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                }`}
              >
                {showReferenceRings ? 'Visible (ON)' : 'Hidden (OFF)'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1 text-[9px] font-mono">
              {REFERENCE_ALTITUDES.map((spec) => (
                <div
                  key={spec.id}
                  className="bg-slate-900/90 border border-slate-800/80 p-1 rounded"
                >
                  <div className="font-bold flex items-center justify-between" style={{ color: spec.cssColor }}>
                    <span>{spec.name}</span>
                    <span className="text-[7.5px] uppercase text-slate-500">{spec.shortTag}</span>
                  </div>
                  <div className="text-slate-300 text-[8.5px] font-medium pt-0.5">
                    {formatAltAndUnits(spec.altKm, scaleMode)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sun Direction & Day/Night Terminator Control */}
          <div className="border-b border-slate-800/80 pb-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5 text-amber-400 font-bold uppercase tracking-wider">
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>Sun Direction & Terminator:</span>
              </div>
              <button
                onClick={() => setShowSunTerminator(!showSunTerminator)}
                className={`px-2 py-0.5 rounded text-[10px] border transition ${
                  showSunTerminator
                    ? 'bg-amber-950 text-amber-300 border-amber-600 font-bold'
                    : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                }`}
              >
                {showSunTerminator ? 'Visible (ON)' : 'Hidden (OFF)'}
              </button>
            </div>
            <div className="text-[9px] text-slate-400 leading-tight">
              Fixed ECI solar vector (v1 assumption) with perpendicular day/night terminator great circle & shaded night hemisphere.
            </div>
          </div>

          {/* Active Satellite Ground Footprint (Elevation Mask Geometry - Tasks 1-3) */}
          <div className="border-b border-slate-800/80 pb-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold uppercase tracking-wider">
                <Target className="w-3.5 h-3.5 text-emerald-400" />
                <span>Ground Footprint Mask:</span>
              </div>
              <button
                onClick={() => setShowFootprint(!showFootprint)}
                className={`px-2 py-0.5 rounded text-[10px] border transition ${
                  showFootprint
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-600 font-bold'
                    : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                }`}
              >
                {showFootprint ? 'Visible (ON)' : 'Hidden (OFF)'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1 text-[9px] font-mono">
              <div className="bg-slate-900/90 border border-slate-800 p-1 rounded">
                <div className="text-slate-400 text-[8px]">Min Elevation (ε)</div>
                <div className="text-cyan-300 font-bold">{(handoverData?.min_elevation_deg ?? 10.0).toFixed(1)}°</div>
              </div>
              <div className="bg-slate-900/90 border border-slate-800 p-1 rounded">
                <div className="text-slate-400 text-[8px]">Angular Radius (θ)</div>
                <div className="text-sky-300 font-bold">{footprintThetaDeg.toFixed(1)}° (~{Math.round(footprintGroundRadiusKm)} km)</div>
              </div>
              <div className="col-span-2 bg-slate-900/90 border border-slate-800 p-1 rounded flex justify-between items-center">
                <span className="text-slate-400 text-[8px]">Beacon Status:</span>
                <span className={isBeaconInFootprint ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  {isBeaconInFootprint ? `IN COVERAGE (El = ${beaconElevationDeg.toFixed(1)}°)` : `OUTSIDE (El = ${beaconElevationDeg.toFixed(1)}°)`}
                </span>
              </div>
            </div>
            <div className="text-[8.5px] text-slate-400 leading-tight">
              Standard elevation mask geometry: sin(η) = (R_E/r)·cos(ε), θ = 90° - ε - η. Reuses handover min-elevation setting.
            </div>
          </div>

          {/* Quick Preset Selector Buttons */}
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1.5">Quick Presets:</div>
            <div className="grid grid-cols-2 gap-1.5">
              {ORBIT_PRESETS.map((p) => (
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

          {/* Informational Re-initialization Note */}
          <div className="bg-blue-950/40 border border-blue-800/60 p-2 rounded text-[10px] text-slate-300 leading-tight">
            <span className="text-cyan-400 font-bold">Orbit Re-initialization:</span> Instant Keplerian state re-initialization (not a live transfer burn).
          </div>

          {/* Live Derived Values Panel (Rule 4) */}
          <div className="bg-slate-900/90 border border-slate-800 p-2 rounded-lg space-y-1 text-[10px]">
            <div className="text-cyan-400 font-bold uppercase tracking-wider text-[9px] border-b border-slate-800/80 pb-0.5 flex justify-between">
              <span>Live Derived Keplerian Metrics</span>
              <span className="text-emerald-400 font-mono">Vis-Viva Active</span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1 font-mono">
              <div>
                <span className="text-slate-400">Semi-major ($a$):</span>{' '}
                <span className="text-cyan-300 font-bold">
                  {formatDistAndUnits(derivedA, getRenderOrbitRadius(derivedA - EARTH_RADIUS_KM, scaleMode))}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Eccentricity ($e$):</span>{' '}
                <span className="text-cyan-300 font-bold">{derivedE.toFixed(4)}</span>
              </div>
              <div>
                <span className="text-slate-400">Current dist ($r$):</span>{' '}
                <span className="text-sky-300 font-bold">
                  {formatDistAndUnits(derivedR, getRenderOrbitRadius(derivedR - EARTH_RADIUS_KM, scaleMode))}
                </span>
              </div>
              <div className="col-span-2 pt-0.5 border-t border-slate-800/50 flex justify-between">
                <span className="text-slate-400">Real Speed ($v$):</span>{' '}
                <span className="text-emerald-400 font-bold">{formatOrbitalSpeed(derivedSpeed)}</span>
              </div>
              <div className="col-span-2 pt-0.5 border-t border-slate-800/50 flex justify-between">
                <span className="text-slate-400">Orbital Period ($T$ - 1 Rev):</span>
                <span className="text-cyan-300 font-bold">{formatOrbitalPeriod(derivedPeriodSec)}</span>
              </div>
              <div className="col-span-2 pt-0.5 border-t border-slate-800/50 flex justify-between">
                <span className="text-slate-400">Current Altitude ($h$):</span>
                <span className="text-emerald-300 font-bold">
                  {formatAltAndUnits(derivedR - EARTH_RADIUS_KM, scaleMode)}
                </span>
              </div>
            </div>
          </div>

          {/* Validation Warnings (Rule 4: perigee >= 150 km drag limit, apogee >= perigee) */}
          {orbitPerigeeKm < 150 && (
            <div className="bg-rose-950/70 border border-rose-600/80 p-1.5 rounded text-[10px] text-rose-300 font-bold">
              ⚠️ Atmospheric Drag Violation: Perigee ({orbitPerigeeKm} km) must be ≥ 150 km.
            </div>
          )}
          {orbitApogeeKm < orbitPerigeeKm && (
            <div className="bg-rose-950/70 border border-rose-600/80 p-1.5 rounded text-[10px] text-rose-300 font-bold">
              ⚠️ Invalid Geometry: Apogee ({orbitApogeeKm} km) must be ≥ Perigee ({orbitPerigeeKm} km).
            </div>
          )}

          {/* Manual Dials (UI) (Rule 4) */}
          <div className="space-y-2 border-t border-slate-800/80 pt-2 text-[11px]">
            {/* Perigee Altitude (hp) */}
            <div>
              <div className="flex justify-between items-center text-slate-400 mb-0.5 text-[10px]">
                <span>
                  Perigee Alt ($h_p$):{' '}
                  <span className="text-slate-500 font-mono text-[9px]">
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
                    className={`w-16 bg-slate-900 border rounded px-1 py-0.5 text-right font-bold font-mono text-[10px] ${
                      orbitPerigeeKm < 150 ? 'border-rose-500 text-rose-300' : 'border-slate-700 text-cyan-300'
                    }`}
                  />
                  <span className="text-slate-500">km</span>
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
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                title="Perigee altitude slider (min 150 km drag limit)"
              />
            </div>

            {/* Apogee Altitude (ha) */}
            <div>
              <div className="flex justify-between items-center text-slate-400 mb-0.5 text-[10px]">
                <span>
                  Apogee Alt ($h_a$):{' '}
                  <span className="text-slate-500 font-mono text-[9px]">
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
                    className={`w-16 bg-slate-900 border rounded px-1 py-0.5 text-right font-bold font-mono text-[10px] ${
                      orbitApogeeKm < orbitPerigeeKm ? 'border-rose-500 text-rose-300' : 'border-slate-700 text-cyan-300'
                    }`}
                  />
                  <span className="text-slate-500">km</span>
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
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                title="Apogee altitude slider (min = perigee)"
              />
            </div>

            {/* Inclination (i) */}
            <div>
              <div className="flex justify-between items-center text-slate-400 mb-0.5 text-[10px]">
                <span>Inclination ($i$):</span>
                <span className="text-cyan-300 font-bold">{orbitInc.toFixed(1)}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="180"
                step="0.5"
                value={orbitInc}
                onChange={(e) => handleCustomParamChange(orbitPerigeeKm, orbitApogeeKm, Number(e.target.value), orbitRaan, orbitArgPerigeeDeg)}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* RAAN (Omega) */}
            <div>
              <div className="flex justify-between items-center text-slate-400 mb-0.5 text-[10px]">
                <span>RAAN ($\Omega$):</span>
                <span className="text-cyan-300 font-bold">{orbitRaan.toFixed(1)}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={orbitRaan}
                onChange={(e) => handleCustomParamChange(orbitPerigeeKm, orbitApogeeKm, orbitInc, Number(e.target.value), orbitArgPerigeeDeg)}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* Argument of Perigee (omega) */}
            <div>
              <div className="flex justify-between items-center text-slate-400 mb-0.5 text-[10px]">
                <span>Arg of Perigee ($\omega$):</span>
                <span className="text-cyan-300 font-bold">{orbitArgPerigeeDeg.toFixed(1)}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={orbitArgPerigeeDeg}
                onChange={(e) => handleCustomParamChange(orbitPerigeeKm, orbitApogeeKm, orbitInc, orbitRaan, Number(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* True Anomaly / Orbit Position Scrubber */}
            <div>
              <div className="flex justify-between items-center text-slate-400 mb-0.5 text-[10px]">
                <span>Starting True Anomaly ($\nu_0$):</span>
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
                  handleCustomParamChange(orbitPerigeeKm, orbitApogeeKm, orbitInc, orbitRaan, orbitArgPerigeeDeg, deg);
                }}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>
          </div>

          {/* Physical Simulation Time Warp Controls */}
          <div className="border-t border-slate-800/80 pt-2 text-[10px] space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-bold uppercase tracking-wider">Physics Time Warp:</span>
              <span className="text-cyan-300 font-bold">
                {simTimeWarp}× {simTimeWarp === 1 ? '(Real-Time)' : `(1s = ${simTimeWarp >= 60 ? `${simTimeWarp / 60}m` : `${simTimeWarp}s`})`}
              </span>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setAutoRevolve(!autoRevolve)}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-slate-700 flex items-center gap-1 font-semibold"
              >
                {autoRevolve ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                <span>{autoRevolve ? 'Pause' : 'Revolve'}</span>
              </button>
              {[1, 60, 120, 360, 1440].map((warp) => (
                <button
                  key={warp}
                  onClick={() => setSimTimeWarp(warp)}
                  className={`px-1.5 py-1 rounded border text-[9px] font-mono transition ${
                    simTimeWarp === warp
                      ? 'bg-cyan-950 text-cyan-300 border-cyan-500 font-bold shadow-sm'
                      : 'bg-slate-900/80 hover:bg-slate-800 text-slate-400 border-slate-800'
                  }`}
                  title={warp === 1 ? '1× Real-Time physics (1s = 1s)' : `${warp}× Time Warp`}
                >
                  {warp === 1 ? '1× Real' : warp === 60 ? '60× (1s=1m)' : warp === 120 ? '120× (1s=2m)' : warp === 360 ? '360× (1s=6m)' : '1440× (1m=1d)'}
                </button>
              ))}
              <button
                onClick={() => handlePresetSelect('leo-550-p1')}
                className="ml-auto text-slate-400 hover:text-cyan-300 flex items-center gap-1 px-1.5 py-1 rounded bg-slate-900 border border-slate-800 text-[9px]"
                title="Reset to LEO-550 Default Orbit"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>Reset</span>
              </button>
            </div>
            <div className="flex items-center justify-between text-[9px] text-slate-500 pt-0.5">
              <span>Orbital 1-Rev at {simTimeWarp}×:</span>
              <span className="text-cyan-400 font-mono">
                {simTimeWarp === 1
                  ? formatOrbitalPeriod(derivedPeriodSec)
                  : `~${(derivedPeriodSec / simTimeWarp).toFixed(1)}s real elapsed`}
              </span>
            </div>
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

            {/* Beacon Speed (km/h) & Presets */}
            <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
              <div className="flex items-center justify-between text-slate-400 text-[10px]">
                <span>Beacon Velocity:</span>
                <span className="font-mono text-rose-300 font-bold">{beaconSpeedKmh} km/h</span>
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
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
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
                        ? 'bg-rose-900 text-rose-200 border-rose-500 font-bold shadow-sm'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {rate.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between text-[8.5px] text-slate-500 font-mono">
                <span>1 Rev (40,075 km):</span>
                <span className="text-rose-400 font-bold">
                  {formatBeaconRevolutionTime(beaconSpeedKmh)}
                </span>
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
                <span>Earth Diurnal Spin (15°/hr)</span>
              </div>
              <button
                onClick={() => setEarthSpinEnabled(!earthSpinEnabled)}
                className={`px-1.5 py-0.5 rounded text-[10px] border ${
                  earthSpinEnabled
                    ? 'bg-sky-950 text-sky-300 border-sky-700 font-semibold'
                    : 'bg-slate-900 text-slate-400 border-slate-800'
                }`}
              >
                {earthSpinEnabled ? 'Active (15°/hr)' : 'Paused'}
              </button>
            </div>
            <div className="flex items-center justify-between text-slate-400 text-[10px]">
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
                        ? 'bg-sky-900 text-sky-200 border-sky-600 font-bold'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
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

      {/* On-Screen Scale Indicator (Compact Corner HUD Widget) */}
      <div className="absolute top-14 left-3 z-15 pointer-events-auto select-none bg-slate-950/90 backdrop-blur-md border border-slate-800/90 rounded-lg p-2.5 font-mono text-[10px] text-slate-300 shadow-xl space-y-1.5 w-64 animate-in fade-in duration-200">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-1">
          <div className="flex items-center gap-1.5 text-slate-400 font-bold uppercase tracking-wider text-[9px]">
            <Ruler className="w-3.5 h-3.5 text-cyan-400" />
            <span>Scale Indicator</span>
          </div>
          <span
            className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold ${
              scaleMode === 'TRUE_SCALE'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/60'
                : 'bg-amber-950 text-amber-300 border border-amber-700/60'
            }`}
          >
            {scaleMode === 'TRUE_SCALE' ? 'TRUE SCALE' : 'READABLE LOG'}
          </span>
        </div>

        {/* Primary Readout */}
        <div className="flex items-baseline justify-between pt-0.5">
          <div className="text-white font-bold text-[11px]">
            {scaleMode === 'TRUE_SCALE' ? (
              <span className="text-cyan-300">
                {earthRenderRadius.toFixed(0)}u = {Math.round(EARTH_RADIUS_KM).toLocaleString()} km
              </span>
            ) : (
              <span className="text-amber-300">
                100u alt = {Math.round(getAltitudeFromRenderOffset(100, scaleMode, READABLE_K, earthRenderRadius)).toLocaleString()} km
              </span>
            )}
          </div>
          <div className="text-[8.5px] text-slate-400 font-mono">
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
            <div className="w-[1.5px] h-2.5 bg-slate-400" />
            {/* Left segment */}
            <div
              className={`flex-1 h-[2px] ${
                scaleMode === 'TRUE_SCALE'
                  ? 'bg-cyan-400'
                  : 'bg-gradient-to-r from-amber-400 to-amber-300'
              }`}
            />
            {/* Center tick */}
            <div className="w-[1.5px] h-2 bg-slate-400" />
            {/* Right segment */}
            <div
              className={`flex-1 h-[2px] ${
                scaleMode === 'TRUE_SCALE'
                  ? 'bg-cyan-400'
                  : 'bg-gradient-to-r from-amber-300 to-amber-500'
              }`}
            />
            {/* Right tick */}
            <div className="w-[1.5px] h-2.5 bg-slate-400" />
          </div>

          {/* Under-bar tick labels */}
          <div className="flex justify-between text-[8px] font-mono text-slate-400 pt-0.5">
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

        {/* Dynamic active orbit readout and not-to-scale warning in READABLE_SCALE */}
        {scaleMode === 'READABLE_SCALE' && (
          <div className="text-[8.5px] pt-1 border-t border-amber-900/40 text-amber-300/90 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>Active Orbit:</span>
            </span>
            <span className="font-bold font-mono">
              {getRenderAltitudeOffset(orbitAltitudeKm, scaleMode, READABLE_K, earthRenderRadius).toFixed(1)}u = {Math.round(orbitAltitudeKm).toLocaleString()} km
            </span>
          </div>
        )}
      </div>

      {/* Overlay HUD Telemetry in 3D */}
      <div className="absolute bottom-3 left-3 bg-slate-950/85 backdrop-blur border border-slate-800 p-2.5 rounded font-mono text-[10px] space-y-1 text-slate-300 pointer-events-none z-10">
        <div className="text-cyan-400 font-bold border-b border-slate-800 pb-1 flex justify-between items-center">
          <span>ORBITAL CONSTELLATION TRACKER</span>
          <span className={scaleMode === 'TRUE_SCALE' ? 'text-cyan-300 text-[9px] font-bold' : 'text-amber-300 text-[9px] font-bold'}>
            [{scaleMode}]
          </span>
        </div>
        <div>Central Body: <span className="text-white">Earth ({formatDistAndUnits(EARTH_RADIUS_KM, globeRadius)})</span></div>
        <div>
          Active Satellite: <span className="text-cyan-300 font-bold">{activePreset ? activePreset.shortName : 'Custom Orbit'}</span>
        </div>
        <div>
          Orbit Shape:{' '}
          <span className="text-sky-300 font-bold">
            {formatAltAndUnits(orbitPerigeeKm, scaleMode)} × {formatAltAndUnits(orbitApogeeKm, scaleMode)} (e={derivedE.toFixed(4)}) | Inc: {orbitInc.toFixed(1)}°
          </span>
        </div>
        <div>
          Orbital Speed & Period (1 Rev):{' '}
          <span className="text-emerald-400 font-bold">
            {formatOrbitalSpeed(derivedSpeed)}
          </span>{' '}
          |{' '}
          <span className="text-cyan-300 font-bold">
            1 Rev: {formatOrbitalPeriod(derivedPeriodSec)}
          </span>
        </div>
        <div className="text-[9px] text-slate-400">
          Kepler Orbit: a = {formatDistAndUnits(derivedA, getRenderOrbitRadius(derivedA - EARTH_RADIUS_KM, scaleMode))} | r = {formatDistAndUnits(derivedR, getRenderOrbitRadius(derivedR - EARTH_RADIUS_KM, scaleMode))}
        </div>
        <div>Target Entity: <span className="text-emerald-400 font-bold">Ground Station ({formatAltAndUnits(0, scaleMode)})</span></div>
        <div>
          Beacon Platform:{' '}
          <span className={beaconSpeedKmh > 0 ? 'text-rose-300 font-bold' : 'text-amber-400 font-bold'}>
            {beaconSpeedKmh > 0
              ? `ATMOSPHERIC UAV (${beaconSpeedKmh} km/h [1 Rev = ${formatBeaconRevolutionTime(beaconSpeedKmh)}])`
              : 'STATIC GROUND STATION (HOVER / LOCKED)'}
          </span>
        </div>
        <div>
          Earth Spin & Clock:{' '}
          <span className={earthSpinEnabled ? 'text-sky-300 font-bold' : 'text-slate-500 font-bold'}>
            {earthSpinEnabled
              ? `SIDEREAL SPIN (${simTimeWarp}× Time Warp [${simTimeWarp === 1 ? '1s=1s Real-Time' : `1s = ${simTimeWarp >= 60 ? `${simTimeWarp / 60}m` : `${simTimeWarp}s`}`}])`
              : 'INERTIAL LOCKED (PAUSED)'}
          </span>
        </div>
        <div>
          Slant Range:{' '}
          <span className="text-cyan-300 font-bold">{formatDistAndUnits(currentSlantRangeKm, currentSlantRange)}</span>
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
        {showAtmosphereShells && (
          <div className="pt-1 border-t border-slate-800/80 text-[10px]">
            Atmospheric Shells:{' '}
            <span className="text-sky-300 font-bold">
              Turbulence ({formatAltAndUnits(20, scaleMode)})
            </span>{' '}
            |{' '}
            <span className="text-indigo-300 font-bold">
              Thin ({formatAltAndUnits(100, scaleMode)})
            </span>{' '}
            |{' '}
            <span className="text-emerald-300 font-bold">
              Kármán Line ({formatAltAndUnits(100, scaleMode)})
            </span>
          </div>
        )}
        {showReferenceRings && (
          <div className="pt-1 border-t border-slate-800/80 text-[10px]">
            Reference Rings:{' '}
            {REFERENCE_ALTITUDES.map((spec, i) => (
              <span key={spec.id} style={{ color: spec.cssColor }}>
                {spec.name} ({formatAltAndUnits(spec.altKm, scaleMode)}){i < REFERENCE_ALTITUDES.length - 1 ? ' | ' : ''}
              </span>
            ))}
          </div>
        )}
        {showSunTerminator && (
          <div className="pt-1 border-t border-slate-800/80 text-[10px]">
            Solar Illumination:{' '}
            <span className="text-amber-300 font-bold">
              Sun Vector [{FIXED_SUN_DIR.x.toFixed(2)}, {FIXED_SUN_DIR.y.toFixed(2)}, {FIXED_SUN_DIR.z.toFixed(2)}]
            </span>{' '}
            |{' '}
            <span className="text-yellow-300 font-bold">
              Terminator Great Circle
            </span>{' '}
            |{' '}
            <span className="text-slate-400 font-bold">
              Night Shading
            </span>
          </div>
        )}
        {showFootprint && (
          <div className="pt-1 border-t border-slate-800/80 text-[10px]">
            Ground Footprint ({`El ≥ ${(handoverData?.min_elevation_deg ?? 10.0).toFixed(0)}°`}):{' '}
            <span className={isBeaconInFootprint ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
              {isBeaconInFootprint
                ? `BEACON IN COVERAGE (El = ${beaconElevationDeg.toFixed(1)}°)`
                : `BEACON OUTSIDE (El = ${beaconElevationDeg.toFixed(1)}°)`}
            </span>{' '}
            |{' '}
            <span className="text-slate-400">
              Radius θ = {footprintThetaDeg.toFixed(1)}° ({Math.round(footprintGroundRadiusKm).toLocaleString()} km)
            </span>
          </div>
        )}
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
          <span>Selected Satellite Orbit ({formatAltAndUnits(orbitAltitudeKm, scaleMode)})</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-blue-500 inline-block border-dashed"></span>
          <span>Walker Constellation Shells ({formatAltAndUnits(550, scaleMode)})</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-indigo-400 inline-block border-dashed"></span>
          <span>Polar Sun-Synchronous SSO ({formatAltAndUnits(700, scaleMode)}, 97.8°)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-rose-500 inline-block border-dashed"></span>
          <span className="text-rose-300">Beacon Ground Track ({formatAltAndUnits(0, scaleMode)})</span>
        </div>

        {/* Scene Markers (Fixed Screen-Space Billboards - Tasks 1-6) */}
        <div className="text-[10px] font-bold text-slate-300 pt-1 border-t border-slate-800">SCENE MARKERS (SCREEN-SPACE)</div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block"></span>
          <span>Satellite Marker ({BASE_MARKER_PX}px / {ACTIVE_MARKER_PX}px active)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
          <span>Beacon Target Marker ({BASE_MARKER_PX}px / {ACTIVE_MARKER_PX}px active)</span>
        </div>

        {/* Atmospheric Shells in Legend */}
        {showAtmosphereShells && (
          <>
            <div className="text-[10px] font-bold text-slate-300 pt-1 border-t border-slate-800">ATMOSPHERIC LAYERS</div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-2 bg-sky-600/50 border border-sky-400/80 rounded-[2px] inline-block"></span>
              <span className="text-sky-300">Turbulence Zone (0–20 km, {formatAltAndUnits(20, scaleMode)})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-2 bg-indigo-500/30 border border-indigo-400/50 rounded-[2px] inline-block"></span>
              <span className="text-indigo-200">Thin Atmosphere (20–100 km, {formatAltAndUnits(100, scaleMode)})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-0.5 bg-emerald-400 border-dashed inline-block"></span>
              <span className="text-emerald-300">Kármán Line — Edge of Space ({formatAltAndUnits(100, scaleMode)})</span>
            </div>
          </>
        )}

        {/* Ground Footprint in Legend (Tasks 1-3) */}
        {showFootprint && (
          <>
            <div className="text-[10px] font-bold text-slate-300 pt-1 border-t border-slate-800">GROUND FOOTPRINT</div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-0.5 bg-emerald-400 inline-block"></span>
              <span className="text-emerald-300 font-medium">In Coverage (El ≥ {(handoverData?.min_elevation_deg ?? 10.0).toFixed(0)}°)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-0.5 bg-rose-500 inline-block"></span>
              <span className="text-rose-400 font-medium">Outside Mask (El &lt; {(handoverData?.min_elevation_deg ?? 10.0).toFixed(0)}°)</span>
            </div>
          </>
        )}

        {/* Solar Direction & Day/Night Terminator in Legend (Tasks 1-4) */}
        {showSunTerminator && (
          <>
            <div className="text-[10px] font-bold text-slate-300 pt-1 border-t border-slate-800">SOLAR ILLUMINATION</div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-0.5 bg-amber-400 border-dashed inline-block"></span>
              <span className="text-amber-300 font-medium">Day/Night Terminator (Dawn/Dusk)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-0.5 bg-yellow-300 inline-block"></span>
              <span className="text-yellow-300">Sun Direction Vector (ECI Fixed)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-2 bg-slate-900 border border-slate-700/80 rounded-[2px] inline-block"></span>
              <span className="text-slate-400">Night-Side Shaded Hemisphere</span>
            </div>
          </>
        )}

        {/* Standard Reference Altitude Rings in Legend (Task 2 & 3) */}
        {showReferenceRings && (
          <>
            <div className="text-[10px] font-bold text-slate-300 pt-1 border-t border-slate-800">REFERENCE ALTITUDES</div>
            {REFERENCE_ALTITUDES.map((spec) => (
              <div key={spec.id} className="flex items-center gap-2">
                <span
                  className="w-3 h-0.5 border-dashed inline-block"
                  style={{ backgroundColor: spec.cssColor }}
                ></span>
                <span style={{ color: spec.cssColor }}>
                  {spec.name} ({formatAltAndUnits(spec.altKm, scaleMode)})
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Real Satellite Speeds & Revolution Periods Reference Modal (Images 1 & 2) */}
      {showSpecsTable && (
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-800/80 rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto flex flex-col font-mono text-xs animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/70">
              <div className="flex items-center gap-2">
                <Table className="w-4 h-4 text-cyan-400" />
                <span className="font-bold text-slate-100 text-sm tracking-wide">
                  REAL SATELLITE SPEEDS & REVOLUTION PERIODS
                </span>
                <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-700/60 text-cyan-300 text-[10px] font-bold">
                  Keplerian Physics
                </span>
              </div>
              <button
                onClick={() => setShowSpecsTable(false)}
                className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Explanation / Verification Notice */}
            <div className="px-4 py-2 bg-slate-950/40 border-b border-slate-800/60 text-[11px] text-slate-300 space-y-1">
              <p>
                In the simulation, every satellite revolves at its exact physical speed derived from{' '}
                <span className="text-cyan-300 font-bold">Kepler's Third Law</span> (T = 2π√(a³/μ)) and{' '}
                <span className="text-emerald-300 font-bold">Vis-Viva equation</span> (v = √(μ/r)).
              </p>
              <p className="text-slate-400 text-[10px]">
                Earth Gravitational Parameter μ = 398,600.44 km³/s², Earth Radius R_E = 6,378.14 km.
              </p>
            </div>

            {/* Reference Table */}
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400 text-[10px] uppercase tracking-wider">
                    <th className="py-2 px-2.5">Orbit Profile</th>
                    <th className="py-2 px-2.5">Altitude</th>
                    <th className="py-2 px-2.5">Speed (km/h)</th>
                    <th className="py-2 px-2.5">Orbital Period (1 Revolution)</th>
                    <th className="py-2 px-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-[11px]">
                  {[
                    {
                      id: 'leo-vleo',
                      profile: 'Very Low Earth Orbit VLEO',
                      alt: '200 km',
                      speed: '~28,037 km/h',
                      speedKms: '7.79 km/s',
                      period: '~88.3 minutes (1 hr 28 min)',
                      color: 'text-emerald-400',
                    },
                    {
                      id: 'leo-equatorial',
                      profile: 'Equatorial Fast Relay',
                      alt: '350 km',
                      speed: '~27,724 km/h',
                      speedKms: '7.70 km/s',
                      period: '~91.4 minutes (1 hr 31 min)',
                      color: 'text-cyan-400',
                    },
                    {
                      id: 'leo-550-p1',
                      profile: 'LEO Walker Planes 1, 2, & 3',
                      alt: '550 km',
                      speed: '~27,320 km/h',
                      speedKms: '7.59 km/s',
                      period: '~95.5 minutes (1 hr 35 min)',
                      color: 'text-sky-400',
                    },
                    {
                      id: 'leo-polar-sso',
                      profile: 'Polar Sun-Synchronous SSO',
                      alt: '700 km',
                      speed: '~27,029 km/h',
                      speedKms: '7.51 km/s',
                      period: '~98.6 minutes (1 hr 38 min)',
                      color: 'text-indigo-400',
                    },
                    {
                      id: 'leo-high',
                      profile: 'High-LEO Broadband Shell',
                      alt: '1,150 km',
                      speed: '~26,208 km/h',
                      speedKms: '7.28 km/s',
                      period: '~108.1 minutes (1 hr 48 min)',
                      color: 'text-purple-400',
                    },
                    {
                      id: 'geo-equatorial',
                      profile: 'Geostationary Orbit GEO',
                      alt: '35,786 km',
                      speed: '~11,070 km/h',
                      speedKms: '3.08 km/s',
                      period: '~23 hours 56 minutes (1 Sidereal Day)',
                      color: 'text-amber-400',
                    },
                  ].map((row) => {
                    const isActive = selectedPresetId === row.id;
                    return (
                      <tr
                        key={row.id}
                        className={`transition hover:bg-slate-800/40 ${
                          isActive ? 'bg-cyan-950/30 font-semibold' : ''
                        }`}
                      >
                        <td className="py-2.5 px-2.5">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-cyan-400 animate-pulse' : 'bg-slate-600'}`} />
                            <span className={isActive ? 'text-white font-bold' : 'text-slate-200'}>
                              {row.profile}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 text-slate-300 font-mono">
                          {row.alt}
                        </td>
                        <td className="py-2.5 px-2.5 font-mono">
                          <span className={`font-bold ${row.color}`}>{row.speed}</span>
                          <span className="text-slate-500 text-[10px] ml-1.5 font-normal">({row.speedKms})</span>
                        </td>
                        <td className="py-2.5 px-2.5 text-slate-300 font-mono">
                          {row.period}
                        </td>
                        <td className="py-2.5 px-2.5 text-right">
                          {isActive ? (
                            <span className="px-2 py-0.5 rounded text-[9.5px] font-bold bg-cyan-950 border border-cyan-500 text-cyan-300 shadow-sm">
                              Active Orbit
                            </span>
                          ) : (
                            <button
                              onClick={() => {
                                handlePresetSelect(row.id);
                                setShowSpecsTable(false);
                              }}
                              className="px-2.5 py-1 rounded text-[10px] bg-slate-800 hover:bg-cyan-900/60 hover:text-cyan-200 text-slate-300 border border-slate-700 transition"
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
            <div className="p-4 border-t border-slate-800 bg-slate-950/60 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-slate-300 font-bold text-[11px] flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Physical Simulation Time Warp:</span>
                    <span className="text-cyan-300 font-bold">{simTimeWarp}×</span>
                  </div>
                  <div className="text-[10px] text-slate-400">
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
                          ? 'bg-cyan-950 text-cyan-300 border-cyan-500 font-bold shadow'
                          : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-700'
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


