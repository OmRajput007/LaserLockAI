import * as THREE from 'three';
import { loadSceneSettings, saveSceneSettings } from '../stores/sceneSettingsStore';
import { DisturbanceTelemetry } from '../types';

export type RenderScaleMode = 'TRUE_SCALE' | 'READABLE_SCALE';

export const EARTH_RENDER_R = 100.0;
export const EARTH_RADIUS_KM = 6378.0;
export const READABLE_K = 2.0;
export const SIDEREAL_DAY_SEC = 86164.0905;
export const EARTH_ROT_RAD_PER_SEC = (2.0 * Math.PI) / SIDEREAL_DAY_SEC; // ~7.2921159e-5 rad/s
export const EARTH_ROT_DEG_PER_HOUR = (360.0 / SIDEREAL_DAY_SEC) * 3600.0; // ~15.041°/hour
export const GM_EARTH_KM3_S2 = 398600.4418;
export const EARTH_CIRCUMFERENCE_KM = 40075.0;

export interface BeaconPathWaypoint {
  id: number;
  label: string;
  localPos: THREE.Vector3;
  latDeg: number;
  lonDeg: number;
}

export const PRESET_4POINT_WAYPOINTS: { lat: number; lon: number; label: string }[] = [
  { lat: 15.0, lon: -45.0, label: '1 (START)' },
  { lat: 48.0, lon: -10.0, label: '2' },
  { lat: 36.0, lon: 20.0, label: '3' },
  { lat: 18.0, lon: 52.0, label: '4 (END)' },
];

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

export const getRenderOrbitRadius = (
  altitudeKm: number,
  mode: RenderScaleMode = 'TRUE_SCALE',
  k: number = READABLE_K,
  earthRenderR: number = EARTH_RENDER_R
): number => {
  return earthRenderR + getRenderAltitudeOffset(altitudeKm, mode, k, earthRenderR);
};

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

export const eccentricToTrueAnomaly = (E: number, e: number): number => {
  if (e < 1e-8) return E;
  const halfNu = Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  let nu = 2 * halfNu;
  if (nu < 0) nu += 2 * Math.PI;
  return nu;
};

export const trueToEccentricAnomaly = (nu: number, e: number): number => {
  if (e < 1e-8) return nu;
  const halfE = Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  let E = 2 * halfE;
  if (E < 0) E += 2 * Math.PI;
  return E;
};

export const computeMeanMotionRadS = (semiMajorAxisKm: number): number => {
  if (semiMajorAxisKm <= 0) return 0;
  return Math.sqrt(GM_EARTH_KM3_S2 / Math.pow(semiMajorAxisKm, 3));
};

export const computeOrbitalPeriodSec = (semiMajorAxisKm: number): number => {
  if (semiMajorAxisKm <= 0) return 0;
  return 2.0 * Math.PI * Math.sqrt(Math.pow(semiMajorAxisKm, 3) / GM_EARTH_KM3_S2);
};

/**
 * EXACT single-source-of-truth 3D position calculation from Keplerian orbital elements
 * Consistent across Scene3DViewport, FPACameraViewport, and satellitePovSync.
 */
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
 * Check if the line segment between satellite and target intersects Earth sphere.
 */
export const checkEarthOcclusion = (
  satPos: THREE.Vector3,
  tgtPos: THREE.Vector3,
  radius: number = 100
): { isOccluded: boolean; hitPoint: THREE.Vector3 | null; hitDistance: number | null } => {
  const seg = new THREE.Vector3().subVectors(tgtPos, satPos);
  const segLen = seg.length();
  if (segLen < 0.001) return { isOccluded: false, hitPoint: null, hitDistance: null };
  const dir = seg.clone().normalize();

  const b = 2 * satPos.dot(dir);
  const c = satPos.lengthSq() - radius * radius;
  const discriminant = b * b - 4 * c;

  if (discriminant >= 0) {
    const sqrtDisc = Math.sqrt(discriminant);
    const t1 = (-b - sqrtDisc) / 2;
    const t2 = (-b + sqrtDisc) / 2;

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

export interface OrbitalEngineState {
  satPos: THREE.Vector3;
  tgtPos: THREE.Vector3;
  trueBeaconGroundPos: THREE.Vector3;
  backupSatPos: THREE.Vector3;
  earthRotationY: number;
  isOccluded: boolean;
  hitPoint: THREE.Vector3 | null;
  hitDistance: number | null;
  backupIsOccluded: boolean;
  orbitRadius: number;
  incDeg: number;
  raanDeg: number;
  anomaly: number;
  meanAnomaly: number;
  perigeeAltKm: number;
  apogeeAltKm: number;
  argPerigeeDeg: number;
  semiMajorAxisKm: number;
  eccentricity: number;
  speedKmS: number;
  currentRadiusKm: number;
  altitudeKm: number;
  autoLOS: boolean;
  slewProgress: number;
  isLockedInFov: boolean;
  isLostFromFov: boolean;
  beaconPixelU: number | null;
  beaconPixelV: number | null;
  beaconAngularErrorDeg: number;
  beaconInFov: boolean;
  beaconAnomaly: number;
  beaconSpeedKmh: number;
  beaconInc: number;
  beaconRaan: number;
  boresightDir: THREE.Vector3;
  isDrawingPath: boolean;
  pathMotionActive: boolean;
  pathFollowMode: boolean;
  pathLegIndex: number;
  pathLegProgress: number;
  pathOverallProgressPct: number;
  pathStatusText: string;
  pathCurrentLegDisplay: string;
  pathCurrentLocalPos: THREE.Vector3;
  slantRangeKm: number;
  gimbalPanDeg: number;
  gimbalTiltDeg: number;
  simTimeWarp: number;
  autoRevolve: boolean;
  earthSpinEnabled: boolean;
  earthSpinMultiplier: number;
  scaleMode: RenderScaleMode;
  timestamp: number;
  peerAnomalies: Record<string, number>;
}

export class OrbitalEngine {
  private state: OrbitalEngineState;
  private disturbance: DisturbanceTelemetry | null = null;
  private manualPanDeg: number = 0;
  private manualTiltDeg: number = 0;
  private readonly backupPhaseOffsetDeg: number = 20.0;
  private pathWaypoints: BeaconPathWaypoint[];

  constructor() {
    const s = typeof window !== 'undefined' ? loadSceneSettings() : ({} as any);

    const initialInc = 53.0;
    const initialRaan = 35.0;
    const initialMeanAnomaly = THREE.MathUtils.degToRad(48.7);
    const initialPerigeeAltKm = 550.0;
    const initialApogeeAltKm = 550.0;
    const rp = EARTH_RADIUS_KM + initialPerigeeAltKm;
    const ra = EARTH_RADIUS_KM + initialApogeeAltKm;
    const a = (rp + ra) / 2.0;
    const e = (ra - rp) / (ra + rp);

    const E = solveKepler(initialMeanAnomaly, e);
    const nu = eccentricToTrueAnomaly(E, e);
    const scaleMode: RenderScaleMode = s.scaleMode || 'TRUE_SCALE';
    const orbitRadius = getRenderOrbitRadius(initialPerigeeAltKm, scaleMode);

    const initialSatPos = computeOrbitPoint(orbitRadius, initialInc, initialRaan, nu, 0);

    const initialBeaconInc = s.beaconInc ?? 28.5;
    const initialBeaconRaan = s.beaconRaan ?? 65.0;
    const initialBeaconAnomaly = THREE.MathUtils.degToRad(120.0);
    const initialBeaconGroundPos = computeOrbitPoint(
      EARTH_RENDER_R,
      initialBeaconInc,
      initialBeaconRaan,
      initialBeaconAnomaly
    );

    // Initial boresight pointing directly along LOS to ground beacon
    const initLos = new THREE.Vector3().subVectors(initialBeaconGroundPos, initialSatPos).normalize();

    this.pathWaypoints = PRESET_4POINT_WAYPOINTS.map((wp, idx) => ({
      id: idx + 1,
      label: wp.label,
      localPos: latLonToVector3(wp.lat, wp.lon, EARTH_RENDER_R),
      latDeg: wp.lat,
      lonDeg: wp.lon,
    }));

    this.state = {
      satPos: initialSatPos,
      tgtPos: initialBeaconGroundPos.clone(),
      trueBeaconGroundPos: initialBeaconGroundPos.clone(),
      backupSatPos: initialSatPos.clone(),
      earthRotationY: 0,
      isOccluded: false,
      hitPoint: null,
      hitDistance: null,
      backupIsOccluded: false,
      orbitRadius,
      incDeg: initialInc,
      raanDeg: initialRaan,
      anomaly: nu,
      meanAnomaly: initialMeanAnomaly,
      perigeeAltKm: initialPerigeeAltKm,
      apogeeAltKm: initialApogeeAltKm,
      argPerigeeDeg: 0.0,
      semiMajorAxisKm: a,
      eccentricity: e,
      speedKmS: Math.sqrt(GM_EARTH_KM3_S2 / a),
      currentRadiusKm: a,
      altitudeKm: initialPerigeeAltKm,
      autoLOS: s.autoLOS ?? true,
      slewProgress: (s.autoLOS ?? true) ? 1.0 : 0.0,
      isLockedInFov: true,
      isLostFromFov: false,
      beaconPixelU: 320.0,
      beaconPixelV: 240.0,
      beaconAngularErrorDeg: 0.0,
      beaconInFov: true,
      beaconAnomaly: initialBeaconAnomaly,
      beaconSpeedKmh: s.beaconSpeedKmh ?? 150,
      beaconInc: initialBeaconInc,
      beaconRaan: initialBeaconRaan,
      boresightDir: initLos.clone(),
      isDrawingPath: false,
      pathMotionActive: false,
      pathFollowMode: s.pathFollowMode ?? false,
      pathLegIndex: 0,
      pathLegProgress: 0.0,
      pathOverallProgressPct: 0,
      pathStatusText: 'Ready at Pt 1 (Starting Point)',
      pathCurrentLegDisplay: 'Leg 1→2',
      pathCurrentLocalPos: this.pathWaypoints[0]?.localPos.clone() ?? initialBeaconGroundPos.clone(),
      slantRangeKm: (initialSatPos.distanceTo(initialBeaconGroundPos) / EARTH_RENDER_R) * EARTH_RADIUS_KM,
      gimbalPanDeg: 0.0,
      gimbalTiltDeg: 0.0,
      simTimeWarp: s.simTimeWarp ?? 60,
      autoRevolve: s.autoRevolve ?? true,
      earthSpinEnabled: s.earthSpinEnabled ?? true,
      earthSpinMultiplier: s.earthSpinMultiplier ?? 1,
      scaleMode,
      timestamp: Date.now(),
      peerAnomalies: {},
    };

    this.recomputeFpaProjection();
  }

  getState(): OrbitalEngineState {
    return this.state;
  }

  step(dtRealSec: number) {
    const s = this.state;
    const isRevolving = s.autoRevolve;
    const dtSimSec = isRevolving ? dtRealSec * (s.simTimeWarp || 60) : 0;

    // 1. Advance Earth's diurnal rotation
    if (s.earthSpinEnabled) {
      const dTheta = EARTH_ROT_RAD_PER_SEC * (isRevolving ? dtSimSec : dtRealSec) * (s.earthSpinMultiplier || 1);
      s.earthRotationY = (s.earthRotationY + dTheta) % (2 * Math.PI);
    }

    // 2. Advance primary satellite along Keplerian orbit
    const aKm = s.semiMajorAxisKm || 6928.0;
    const e = s.eccentricity || 0.0;
    const meanMotionRadS = Math.sqrt(GM_EARTH_KM3_S2 / (aKm * aKm * aKm));

    if (isRevolving) {
      const stepRate = meanMotionRadS * dtSimSec;
      s.meanAnomaly = (s.meanAnomaly + stepRate) % (2 * Math.PI);
    }

    const E = solveKepler(s.meanAnomaly, e);
    const nu = eccentricToTrueAnomaly(E, e);
    s.anomaly = nu;

    const currentRPhysKm = e < 1e-8 ? aKm : aKm * (1 - e * Math.cos(E));
    const currentAltPhysKm = currentRPhysKm - EARTH_RADIUS_KM;
    s.currentRadiusKm = currentRPhysKm;
    s.altitudeKm = currentAltPhysKm;
    s.speedKmS = Math.sqrt(Math.max(0, GM_EARTH_KM3_S2 * (2.0 / currentRPhysKm - 1.0 / aKm)));

    s.orbitRadius = getRenderOrbitRadius(currentAltPhysKm, s.scaleMode);

    // Primary Satellite Position in 3D ECI
    s.satPos = computeOrbitPoint(
      s.orbitRadius,
      s.incDeg,
      s.raanDeg,
      nu,
      s.argPerigeeDeg
    );

    // 3. Advance backup satellite along same orbit (offset by 20°)
    const backupPhaseRad = THREE.MathUtils.degToRad(this.backupPhaseOffsetDeg);
    const backupM = (s.meanAnomaly + backupPhaseRad) % (2 * Math.PI);
    const backupE = solveKepler(backupM, e);
    const backupNu = eccentricToTrueAnomaly(backupE, e);
    const backupRPhysKm = e < 1e-8 ? aKm : aKm * (1 - e * Math.cos(backupE));
    const backupAltKm = backupRPhysKm - EARTH_RADIUS_KM;
    const backupRenderRadius = getRenderOrbitRadius(backupAltKm, s.scaleMode);

    s.backupSatPos = computeOrbitPoint(
      backupRenderRadius,
      s.incDeg,
      s.raanDeg,
      backupNu,
      s.argPerigeeDeg
    );

    // 4. Advance beacon ground position
    let currentBeaconGroundPos: THREE.Vector3;
    const isPathActive = s.pathFollowMode && this.pathWaypoints.length >= 2;
    const effectiveBeaconSpeedKmh = isPathActive
      ? (s.pathMotionActive ? (s.beaconSpeedKmh || 450) : 0)
      : (s.beaconSpeedKmh > 0 ? s.beaconSpeedKmh : 0);

    if (isPathActive) {
      const waypoints = this.pathWaypoints;
      if (s.pathMotionActive) {
        const legIdx = Math.min(s.pathLegIndex, waypoints.length - 2);
        const pA = waypoints[legIdx].localPos;
        const pB = waypoints[legIdx + 1].localPos;

        const uA = pA.clone().normalize();
        const uB = pB.clone().normalize();
        const cosTheta = THREE.MathUtils.clamp(uA.dot(uB), -1.0, 1.0);
        const theta = Math.acos(cosTheta);
        const legDistKm = EARTH_RADIUS_KM * theta;

        const speedKmh = s.beaconSpeedKmh || 450;
        const warp = s.simTimeWarp || 60;
        const dtSim = isRevolving ? dtRealSec * warp : dtRealSec * 15;
        const deltaS = legDistKm > 0.01 ? (dtSim * (speedKmh / 3600.0)) / legDistKm : 1.0;

        s.pathLegProgress += deltaS;
        if (s.pathLegProgress >= 1.0) {
          if (legIdx < waypoints.length - 2) {
            s.pathLegIndex += 1;
            s.pathLegProgress = 0.0;
          } else {
            s.pathLegProgress = 1.0;
            s.pathMotionActive = false;
            s.pathStatusText = `Completed: Stopped at Pt ${waypoints.length} (Ending Point)`;
          }
        }

        s.pathCurrentLocalPos = slerpOnSphere(pA, pB, Math.min(1.0, s.pathLegProgress), EARTH_RENDER_R);
        s.pathOverallProgressPct = Math.round(
          ((s.pathLegIndex + Math.min(1.0, s.pathLegProgress)) / (waypoints.length - 1)) * 100
        );
        s.pathCurrentLegDisplay = `Leg ${s.pathLegIndex + 1}→${s.pathLegIndex + 2}`;
      }

      currentBeaconGroundPos = s.pathCurrentLocalPos.clone();
      currentBeaconGroundPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), s.earthRotationY);
    } else {
      if (effectiveBeaconSpeedKmh > 0) {
        const omega_real = (2.0 * Math.PI * effectiveBeaconSpeedKmh) / (EARTH_CIRCUMFERENCE_KM * 3600.0);
        const deltaTheta = (omega_real * (s.simTimeWarp || 60)) * dtRealSec;
        s.beaconAnomaly = (s.beaconAnomaly + deltaTheta) % (2.0 * Math.PI);
      }

      currentBeaconGroundPos = computeOrbitPoint(
        EARTH_RENDER_R,
        s.beaconInc,
        s.beaconRaan,
        s.beaconAnomaly
      );
      currentBeaconGroundPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), s.earthRotationY);
    }

    s.trueBeaconGroundPos.copy(currentBeaconGroundPos);

    // Apply platform / jitter disturbance cleanly to visual target without corrupting ground anchor
    let surfacePos = currentBeaconGroundPos.clone();
    if (this.disturbance) {
      const beaconNormal = currentBeaconGroundPos.clone().normalize();
      let up = new THREE.Vector3(0, 1, 0);
      if (Math.abs(beaconNormal.dot(up)) > 0.9) up = new THREE.Vector3(1, 0, 0);
      const tangentX = new THREE.Vector3().crossVectors(beaconNormal, up).normalize();
      const tangentY = new THREE.Vector3().crossVectors(tangentX, beaconNormal).normalize();

      const jx = this.disturbance.jitter_offset_x_px ?? 0;
      const jy = this.disturbance.jitter_offset_y_px ?? 0;
      const px = this.disturbance.platform_offset_x_px ?? 0;
      const py = this.disturbance.platform_offset_y_px ?? 0;

      const dispScale = 0.08;
      surfacePos = beaconNormal.clone().multiplyScalar(EARTH_RENDER_R + 0.05)
        .addScaledVector(tangentX, (jx + px) * dispScale)
        .addScaledVector(tangentY, (jy + py) * dispScale);
    }
    s.tgtPos.copy(surfacePos);

    // 5. Line of sight (LOS) and nominal Nadir directions
    const { isOccluded, hitPoint, hitDistance } = checkEarthOcclusion(
      s.satPos,
      s.tgtPos,
      EARTH_RENDER_R
    );
    s.isOccluded = isOccluded;
    s.hitPoint = hitPoint;
    s.hitDistance = hitDistance;

    const { isOccluded: bkOccluded } = checkEarthOcclusion(
      s.backupSatPos,
      s.tgtPos,
      EARTH_RENDER_R
    );
    s.backupIsOccluded = bkOccluded;

    // Nominal Nadir pointing direction (Earth center 0,0,0), modified by manual pan/tilt
    let nadirDir = s.satPos.clone().negate().normalize();
    const panRad = THREE.MathUtils.degToRad(this.manualPanDeg);
    const tiltRad = THREE.MathUtils.degToRad(this.manualTiltDeg);

    if (Math.abs(panRad) > 0.0001 || Math.abs(tiltRad) > 0.0001) {
      let up = new THREE.Vector3(0, 1, 0);
      if (Math.abs(nadirDir.dot(up)) > 0.92) up = new THREE.Vector3(1, 0, 0);
      let right = new THREE.Vector3().crossVectors(nadirDir, up).normalize();
      let realUp = new THREE.Vector3().crossVectors(right, nadirDir).normalize();
      nadirDir.applyAxisAngle(realUp, -panRad);
      right.crossVectors(nadirDir, realUp).normalize();
      nadirDir.applyAxisAngle(right, tiltRad);
    }

    const losDir = new THREE.Vector3().subVectors(s.tgtPos, s.satPos).normalize();

    // 6. Smooth slew between Nadir and LOS (0.025 per frame -> ~0.67s smooth transition)
    if (s.autoLOS) {
      s.slewProgress = Math.min(1.0, s.slewProgress + 0.025);
    } else {
      s.slewProgress = Math.max(0.0, s.slewProgress - 0.025);
    }

    const p = s.slewProgress;
    const t = p * p * (3 - 2 * p); // Smoothstep easing
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
    s.boresightDir.copy(currBoresight);

    // 7. Angular error between optical boresight and LOS ray
    const dotToLos = THREE.MathUtils.clamp(currBoresight.dot(losDir), -1, 1);
    const angDeg = THREE.MathUtils.radToDeg(Math.acos(dotToLos));
    s.beaconAngularErrorDeg = angDeg;
    s.isLockedInFov = Boolean(!s.isOccluded && angDeg <= 2.0);
    s.isLostFromFov = Boolean(s.isOccluded || angDeg > 2.0);

    // 8. Physical slant range distance (km)
    const distUnits = s.satPos.distanceTo(s.tgtPos);
    s.slantRangeKm = (distUnits / EARTH_RENDER_R) * EARTH_RADIUS_KM;

    // 9. Gimbal pan/tilt relative to Nadir reference frame
    let upRef = new THREE.Vector3(0, 1, 0);
    const trueNadir = s.satPos.clone().negate().normalize();
    if (Math.abs(trueNadir.dot(upRef)) > 0.9) upRef = new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(trueNadir, upRef).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, trueNadir).normalize();
    s.gimbalPanDeg = THREE.MathUtils.radToDeg(
      Math.asin(THREE.MathUtils.clamp(currBoresight.dot(right), -1, 1))
    );
    s.gimbalTiltDeg = THREE.MathUtils.radToDeg(
      Math.asin(THREE.MathUtils.clamp(currBoresight.dot(realUp), -1, 1))
    );

    // 10. Recompute FPA sensor projection
    this.recomputeFpaProjection();
    s.timestamp = Date.now();
  }

  private recomputeFpaProjection() {
    const s = this.state;
    const losDir = new THREE.Vector3().subVectors(s.tgtPos, s.satPos).normalize();
    const boresight = s.boresightDir && s.boresightDir.lengthSq() > 1e-9
      ? s.boresightDir.clone().normalize()
      : (s.autoLOS ? losDir.clone() : s.satPos.clone().negate().normalize());

    const dot = THREE.MathUtils.clamp(boresight.dot(losDir), -1, 1);
    const angDeg = THREE.MathUtils.radToDeg(Math.acos(dot));
    s.beaconAngularErrorDeg = angDeg;

    if (s.isOccluded || dot <= 0) {
      s.beaconPixelU = null;
      s.beaconPixelV = null;
      s.beaconInFov = false;
      return;
    }

    let upRef = new THREE.Vector3(0, 1, 0);
    if (Math.abs(boresight.dot(upRef)) > 0.9) upRef = new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(boresight, upRef).normalize();
    const up = new THREE.Vector3().crossVectors(right, boresight).normalize();

    const deltaAzDeg = THREE.MathUtils.radToDeg(
      Math.asin(THREE.MathUtils.clamp(losDir.dot(right), -1, 1))
    );
    const deltaElDeg = THREE.MathUtils.radToDeg(
      Math.asin(THREE.MathUtils.clamp(losDir.dot(up), -1, 1))
    );

    // Linear FPA mapping: 160 px/deg (640 / 4.0°, 480 / 3.0°)
    const u = 320.0 + deltaAzDeg * 160.0;
    const v = 240.0 - deltaElDeg * 160.0;

    const inSensor = u >= 0.0 && u <= 640.0 && v >= 0.0 && v <= 480.0;
    const inAngularFov = Math.abs(deltaAzDeg) <= 2.0 && Math.abs(deltaElDeg) <= 1.5;

    s.beaconPixelU = inSensor ? u : null;
    s.beaconPixelV = inSensor ? v : null;
    s.beaconInFov = inSensor && inAngularFov && !s.isOccluded;
  }

  // --- Command Methods ---
  setAutoLOS(enabled: boolean) {
    this.state.autoLOS = enabled;
    saveSceneSettings({ autoLOS: enabled });
  }

  setBeaconSpeedKmh(speed: number) {
    this.state.beaconSpeedKmh = speed;
    saveSceneSettings({ beaconSpeedKmh: speed });
  }

  setBeaconMotion(params: { anomaly?: number; incDeg?: number; raanDeg?: number; speedKmh?: number }) {
    if (params.anomaly !== undefined) this.state.beaconAnomaly = params.anomaly;
    if (params.incDeg !== undefined) this.state.beaconInc = params.incDeg;
    if (params.raanDeg !== undefined) this.state.beaconRaan = params.raanDeg;
    if (params.speedKmh !== undefined) this.setBeaconSpeedKmh(params.speedKmh);
  }

  setOrbit(params: {
    perigeeAltKm: number;
    apogeeAltKm: number;
    incDeg: number;
    raanDeg: number;
    argPerigeeDeg?: number;
    trueAnomaly?: number;
    meanAnomaly?: number;
    scaleMode?: RenderScaleMode;
  }) {
    const validPerigee = Math.max(0, params.perigeeAltKm);
    const validApogee = Math.max(validPerigee, params.apogeeAltKm);
    const rp = EARTH_RADIUS_KM + validPerigee;
    const ra = EARTH_RADIUS_KM + validApogee;
    const a = (rp + ra) / 2.0;
    const e = (ra - rp) / (ra + rp);

    this.state.perigeeAltKm = validPerigee;
    this.state.apogeeAltKm = validApogee;
    this.state.semiMajorAxisKm = a;
    this.state.eccentricity = e;
    this.state.incDeg = params.incDeg;
    this.state.raanDeg = params.raanDeg;
    if (params.argPerigeeDeg !== undefined) this.state.argPerigeeDeg = params.argPerigeeDeg;
    if (params.scaleMode) this.state.scaleMode = params.scaleMode;

    if (params.meanAnomaly !== undefined) {
      this.state.meanAnomaly = params.meanAnomaly;
      const E = solveKepler(params.meanAnomaly, e);
      this.state.anomaly = eccentricToTrueAnomaly(E, e);
    } else if (params.trueAnomaly !== undefined) {
      this.state.anomaly = params.trueAnomaly;
      const E = trueToEccentricAnomaly(params.trueAnomaly, e);
      let M = E - e * Math.sin(E);
      if (M < 0) M += 2 * Math.PI;
      this.state.meanAnomaly = M;
    }
  }

  setScaleMode(mode: RenderScaleMode) {
    this.state.scaleMode = mode;
  }

  setTimeWarp(warp: number) {
    this.state.simTimeWarp = warp;
    saveSceneSettings({ simTimeWarp: warp });
  }

  setAutoRevolve(autoRevolve: boolean) {
    this.state.autoRevolve = autoRevolve;
    saveSceneSettings({ autoRevolve });
  }

  setEarthSpin(enabled: boolean, multiplier?: number) {
    this.state.earthSpinEnabled = enabled;
    if (multiplier !== undefined) this.state.earthSpinMultiplier = multiplier;
    saveSceneSettings({
      earthSpinEnabled: enabled,
      ...(multiplier !== undefined ? { earthSpinMultiplier: multiplier } : {}),
    });
  }

  setManualGimbal(panDeg: number, tiltDeg: number) {
    this.manualPanDeg = panDeg;
    this.manualTiltDeg = tiltDeg;
  }

  setDisturbance(dist: DisturbanceTelemetry | null) {
    this.disturbance = dist;
  }

  setPathFollowMode(active: boolean) {
    this.state.pathFollowMode = active;
    saveSceneSettings({ pathFollowMode: active });
  }

  setPathMotionActive(active: boolean) {
    this.state.pathMotionActive = active;
  }

  setIsDrawingPath(drawing: boolean) {
    this.state.isDrawingPath = drawing;
  }

  setPathWaypoints(waypoints: BeaconPathWaypoint[]) {
    this.pathWaypoints = waypoints;
    this.state.pathLegIndex = 0;
    this.state.pathLegProgress = 0.0;
    this.state.pathOverallProgressPct = 0;
    if (waypoints.length > 0) {
      this.state.pathCurrentLocalPos = waypoints[0].localPos.clone();
    }
  }
}

export const orbitalEngine = new OrbitalEngine();
