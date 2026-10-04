import * as THREE from 'three';
import { loadSceneSettings, saveSceneSettings } from '../stores/sceneSettingsStore';

export interface SatellitePovState {
  satPos: THREE.Vector3;
  tgtPos: THREE.Vector3;
  earthRotationY: number;
  isOccluded: boolean;
  orbitRadius: number;
  incDeg: number;
  raanDeg: number;
  anomaly: number; // true anomaly nu (radians)
  meanAnomaly?: number; // mean anomaly M (radians)
  timestamp: number;
  autoLOS: boolean;
  isLockedInFov: boolean; // True when rectangular FOV frustum is GREEN
  isLostFromFov: boolean; // True when rectangular FOV frustum is RED
  // Pixel projection of the orbital beacon onto the 640x480 FPA (satellite POV).
  // Null when the beacon is outside the sensor or the link is occluded.
  beaconPixelU: number | null;
  beaconPixelV: number | null;
  beaconAngularErrorDeg: number; // boresight-to-LOS angle
  beaconInFov: boolean; // within 4.0 x 3.0 deg AND inside sensor bounds
  perigeeAltKm?: number;
  apogeeAltKm?: number;
  argPerigeeDeg?: number;
  semiMajorAxisKm?: number;
  eccentricity?: number;
  speedKmS?: number;
  currentRadiusKm?: number;
  altitudeKm?: number;
  beaconAnomaly?: number;
  beaconSpeedKmh?: number;
  beaconInc?: number;
  beaconRaan?: number;
  boresightDir?: THREE.Vector3;
  isDrawingPath?: boolean;
  pathMotionActive?: boolean;
  pathFollowMode?: boolean;
  slewProgress?: number;
  slantRangeKm?: number;
  gimbalPanDeg?: number;
  gimbalTiltDeg?: number;
}

// Physical constants for orbital mechanics and Earth rotation
export const EARTH_RADIUS_KM = 6378.137;
export const GM_EARTH_KM3_S2 = 398600.4418;
export const EARTH_CIRCUMFERENCE_KM = 40075.0;
export const SIDEREAL_DAY_SEC = 86164.0905;
export const EARTH_ROT_RAD_PER_SEC = (2.0 * Math.PI) / SIDEREAL_DAY_SEC; // ~7.2921159e-5 rad/s
export const EARTH_ROT_DEG_PER_HOUR = (360.0 / SIDEREAL_DAY_SEC) * 3600.0; // ~15.041°/hour

/**
 * Computes physical real-world angular velocity for an atmospheric beacon (UAV/Drone):
 * omega_real = (2 * Math.PI * speed_kmh) / (40075 * 3600)  // in radians/sec
 * At 1,200 km/h: 1 revolution takes 33 hours 24 minutes (120,225 seconds).
 */
export const computeBeaconOmegaReal = (speedKmh: number): number => {
  if (speedKmh <= 0) return 0;
  return (2.0 * Math.PI * speedKmh) / (EARTH_CIRCUMFERENCE_KM * 3600.0);
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
 * Computes Keplerian mean motion in radians per second: n = sqrt(mu / a^3)
 */
export const computeMeanMotionRadS = (semiMajorAxisKm: number): number => {
  if (semiMajorAxisKm <= 0) return 0;
  return Math.sqrt(GM_EARTH_KM3_S2 / Math.pow(semiMajorAxisKm, 3));
};

export const computeOrbitPoint = (
  radius: number,
  incDeg: number,
  raanDeg: number,
  anomaly: number,
  argPerigeeDeg: number = 0
): THREE.Vector3 => {
  const u = anomaly + THREE.MathUtils.degToRad(argPerigeeDeg);
  const inc = THREE.MathUtils.degToRad(incDeg);
  const raan = THREE.MathUtils.degToRad(raanDeg);
  const xOrb = radius * Math.cos(u);
  const zOrb = radius * Math.sin(u);
  const x = xOrb * Math.cos(raan) - zOrb * Math.cos(inc) * Math.sin(raan);
  const y = zOrb * Math.sin(inc);
  const z = xOrb * Math.sin(raan) + zOrb * Math.cos(inc) * Math.cos(raan);
  return new THREE.Vector3(x, y, z);
};

export const checkEarthOcclusion = (
  satPos: THREE.Vector3,
  tgtPos: THREE.Vector3,
  globeRadius: number = 100
): { isOccluded: boolean; hitPoint?: THREE.Vector3 } => {
  const d = new THREE.Vector3().subVectors(tgtPos, satPos);
  const dLen = d.length();
  if (dLen < 0.001) return { isOccluded: false };
  const dNorm = d.clone().normalize();
  const b = 2 * satPos.dot(dNorm);
  const c = satPos.lengthSq() - globeRadius * globeRadius;
  const disc = b * b - 4 * c;

  if (disc >= 0) {
    const sqrtDisc = Math.sqrt(disc);
    const t1 = (-b - sqrtDisc) / 2;
    const t2 = (-b + sqrtDisc) / 2;
    const epsilon = 1.5;
    if ((t1 > 0.1 && t1 < dLen - epsilon) || (t2 > 0.1 && t2 < dLen - epsilon)) {
      return {
        isOccluded: true,
        hitPoint: satPos.clone().addScaledVector(dNorm, Math.min(t1, t2)),
      };
    }
  }
  return { isOccluded: false };
};

class SatellitePovSync {
  private meanAnomaly: number = THREE.MathUtils.degToRad(48.7);
  private beaconAnomaly: number = THREE.MathUtils.degToRad(120.0);
  private beaconInc: number = 28.5;
  private beaconRaan: number = 65.0;
  private slewProgress: number = 1.0;
  private lastExternalUpdateTime: number = 0;
  private lastTickTime: number = typeof performance !== 'undefined' ? performance.now() : Date.now();
  // Anchor ground station in local Earth coordinates (sub-satellite nadir ground station at 100u)
  private localTgtPos: THREE.Vector3 = computeOrbitPoint(
    108.62,
    53.0,
    35.0,
    THREE.MathUtils.degToRad(48.7)
  ).normalize().multiplyScalar(100.0);

  private currentData: SatellitePovState = {
    satPos: computeOrbitPoint(108.62, 53.0, 35.0, THREE.MathUtils.degToRad(48.7)),
    tgtPos: computeOrbitPoint(108.62, 53.0, 35.0, THREE.MathUtils.degToRad(48.7)).normalize().multiplyScalar(100.0),
    earthRotationY: 0,
    isOccluded: false,
    orbitRadius: 108.62,
    incDeg: 53.0,
    raanDeg: 35.0,
    anomaly: THREE.MathUtils.degToRad(48.7),
    meanAnomaly: THREE.MathUtils.degToRad(48.7),
    timestamp: Date.now(),
    autoLOS: typeof window !== 'undefined' ? (loadSceneSettings().autoLOS ?? true) : true,
    isLockedInFov: true,
    isLostFromFov: false,
    beaconPixelU: 320.0,
    beaconPixelV: 240.0,
    beaconAngularErrorDeg: 0.0,
    beaconInFov: true,
    perigeeAltKm: 550.0,
    apogeeAltKm: 550.0,
    argPerigeeDeg: 0.0,
    semiMajorAxisKm: 6928.0,
    eccentricity: 0.0,
    speedKmS: 7.585,
    currentRadiusKm: 6928.0,
    altitudeKm: 550.0,
    beaconSpeedKmh: typeof window !== 'undefined' ? (loadSceneSettings().beaconSpeedKmh ?? 150) : 150,
    beaconAnomaly: THREE.MathUtils.degToRad(120.0),
    beaconInc: 28.5,
    beaconRaan: 65.0,
    slewProgress: 1.0,
    slantRangeKm: 550.0,
    gimbalPanDeg: 0.0,
    gimbalTiltDeg: 0.0,
    boresightDir: new THREE.Vector3(0, 0, -1),
  };

  private listeners: ((data: SatellitePovState) => void)[] = [];

  constructor() {
    // Initialize boresight aligned with LOS to ground beacon
    const initLos = new THREE.Vector3().subVectors(this.currentData.tgtPos, this.currentData.satPos).normalize();
    this.currentData.boresightDir = initLos.clone();
    this.recomputeFpaProjection();

    if (typeof window !== 'undefined') {
      const initSettings = loadSceneSettings();
      if (initSettings.autoLOS !== undefined) {
        this.currentData.autoLOS = initSettings.autoLOS;
        this.slewProgress = initSettings.autoLOS ? 1.0 : 0.0;
        this.currentData.slewProgress = this.slewProgress;
      }
      if (initSettings.beaconSpeedKmh !== undefined) {
        this.currentData.beaconSpeedKmh = initSettings.beaconSpeedKmh;
      }
      if (initSettings.beaconInc !== undefined) {
        this.beaconInc = initSettings.beaconInc;
        this.currentData.beaconInc = this.beaconInc;
      }
      if (initSettings.beaconRaan !== undefined) {
        this.beaconRaan = initSettings.beaconRaan;
        this.currentData.beaconRaan = this.beaconRaan;
      }

      // 60 FPS autonomous physics and orbital propagation loop.
      // Automatically takes over when Scene3DViewport is not mounted (e.g. Camera View page).
      const tick = () => {
        const now = performance.now();
        const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTickTime) / 1000));
        this.lastTickTime = now;

        // If no external updates received in >100ms, run autonomous continuous simulation
        if (now - this.lastExternalUpdateTime > 100) {
          this.stepKinematics(dt);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      // Background safety interval (runs even if requestAnimationFrame throttles in background tabs)
      setInterval(() => {
        const now = performance.now();
        if (now - this.lastExternalUpdateTime > 150 && now - this.lastTickTime > 80) {
          const dt = Math.min(0.05, (now - this.lastTickTime) / 1000);
          this.lastTickTime = now;
          this.stepKinematics(dt);
        }
      }, 50);
    }
  }

  /**
   * Autonomous Keplerian orbital, Earth diurnal spin, and optical boresight propagation step.
   * Runs continuously when Scene3DViewport is unmounted so that the Camera View page
   * remains 100% aligned and continuous with Mission Control.
   */
  private stepKinematics(dt: number) {
    const settings = loadSceneSettings();
    const timeWarp = settings.simTimeWarp || 60;

    // 1. Advance Earth rotation (15°/hr * timeWarp)
    if (settings.earthSpinEnabled !== false) {
      const spinMultiplier = settings.earthSpinMultiplier || 1;
      const dEarth = EARTH_ROT_RAD_PER_SEC * spinMultiplier * timeWarp * dt;
      this.currentData.earthRotationY = (this.currentData.earthRotationY + dEarth) % (2 * Math.PI);
    }

    // 2. Advance primary satellite along Keplerian orbit
    const aKm = this.currentData.semiMajorAxisKm || 6928.0;
    const e = this.currentData.eccentricity ?? 0.0;
    const meanMotion = computeMeanMotionRadS(aKm);

    if (settings.autoRevolve !== false) {
      this.meanAnomaly = (this.meanAnomaly + meanMotion * timeWarp * dt) % (2 * Math.PI);
    }
    const E = solveKepler(this.meanAnomaly, e);
    const nu = eccentricToTrueAnomaly(E, e);
    this.currentData.anomaly = nu;
    this.currentData.meanAnomaly = this.meanAnomaly;

    const rPhys = e < 1e-8 ? aKm : aKm * (1 - e * Math.cos(E));
    this.currentData.currentRadiusKm = rPhys;
    this.currentData.altitudeKm = rPhys - EARTH_RADIUS_KM;
    this.currentData.speedKmS = Math.sqrt(Math.max(0, GM_EARTH_KM3_S2 * (2.0 / rPhys - 1.0 / aKm)));

    const rRender = this.currentData.orbitRadius || 108.62;
    const satPos = computeOrbitPoint(
      rRender,
      this.currentData.incDeg ?? 53.0,
      this.currentData.raanDeg ?? 35.0,
      nu,
      this.currentData.argPerigeeDeg ?? 0
    );
    this.currentData.satPos.copy(satPos);

    // 3. Advance beacon position on rotating Earth
    // Rotate the ground beacon's Earth-fixed local position synchronously with Earth diurnal spin
    const currentBeaconGroundPos = this.localTgtPos.clone().applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.currentData.earthRotationY
    );
    this.currentData.tgtPos.copy(currentBeaconGroundPos);

    // 4. Check Earth occlusion
    const occ = checkEarthOcclusion(this.currentData.satPos, this.currentData.tgtPos, 100.0);
    this.currentData.isOccluded = occ.isOccluded;

    // 5. Line of sight (LOS) and nominal Nadir directions
    const nadirDir = this.currentData.satPos.clone().negate().normalize();
    const losDir = new THREE.Vector3().subVectors(this.currentData.tgtPos, this.currentData.satPos).normalize();

    // 6. Smooth slew between Nadir and LOS (0.025 per frame -> ~0.67s smooth transition)
    if (this.currentData.autoLOS) {
      this.slewProgress = Math.min(1.0, this.slewProgress + 0.025);
    } else {
      this.slewProgress = Math.max(0.0, this.slewProgress - 0.025);
    }
    this.currentData.slewProgress = this.slewProgress;
    const p = this.slewProgress;
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

    if (!this.currentData.boresightDir) {
      this.currentData.boresightDir = currBoresight.clone();
    } else {
      this.currentData.boresightDir.copy(currBoresight);
    }

    // 7. Angular error between optical boresight and LOS ray
    const dotToLos = THREE.MathUtils.clamp(currBoresight.dot(losDir), -1, 1);
    const angDeg = THREE.MathUtils.radToDeg(Math.acos(dotToLos));
    this.currentData.beaconAngularErrorDeg = angDeg;
    this.currentData.isLockedInFov = Boolean(!occ.isOccluded && angDeg <= 2.0);
    this.currentData.isLostFromFov = Boolean(occ.isOccluded || angDeg > 2.0);

    // 8. Physical slant range distance
    const distUnits = this.currentData.satPos.distanceTo(this.currentData.tgtPos);
    this.currentData.slantRangeKm = (distUnits / 100.0) * EARTH_RADIUS_KM;

    // 9. Gimbal pan/tilt relative to Nadir reference frame
    let upRef = new THREE.Vector3(0, 1, 0);
    if (Math.abs(nadirDir.dot(upRef)) > 0.9) upRef = new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(nadirDir, upRef).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, nadirDir).normalize();
    this.currentData.gimbalPanDeg = THREE.MathUtils.radToDeg(
      Math.asin(THREE.MathUtils.clamp(currBoresight.dot(right), -1, 1))
    );
    this.currentData.gimbalTiltDeg = THREE.MathUtils.radToDeg(
      Math.asin(THREE.MathUtils.clamp(currBoresight.dot(realUp), -1, 1))
    );

    // 10. Recompute FPA sensor projection
    this.recomputeFpaProjection();
    this.currentData.timestamp = Date.now();

    // 11. Notify all subscribers (FPACameraViewport, CameraViewPage, App alarm audio, etc.)
    for (let i = 0; i < this.listeners.length; i++) {
      this.listeners[i](this.currentData);
    }
  }

  update(data: Partial<SatellitePovState>) {
    this.lastExternalUpdateTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (data.satPos) this.currentData.satPos.copy(data.satPos);
    if (data.tgtPos) {
      this.currentData.tgtPos.copy(data.tgtPos);
      const rotY = data.earthRotationY ?? this.currentData.earthRotationY ?? 0;
      this.localTgtPos = data.tgtPos.clone().applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        -rotY
      );
    }
    if (data.earthRotationY !== undefined) this.currentData.earthRotationY = data.earthRotationY;
    if (data.isOccluded !== undefined) this.currentData.isOccluded = data.isOccluded;
    if (data.orbitRadius !== undefined) this.currentData.orbitRadius = data.orbitRadius;
    if (data.incDeg !== undefined) this.currentData.incDeg = data.incDeg;
    if (data.raanDeg !== undefined) this.currentData.raanDeg = data.raanDeg;
    if (data.anomaly !== undefined) this.currentData.anomaly = data.anomaly;
    if (data.meanAnomaly !== undefined) {
      this.meanAnomaly = data.meanAnomaly;
      this.currentData.meanAnomaly = data.meanAnomaly;
    }
    if (data.beaconAnomaly !== undefined) {
      this.beaconAnomaly = data.beaconAnomaly;
      this.currentData.beaconAnomaly = data.beaconAnomaly;
    }
    if (data.beaconInc !== undefined) {
      this.beaconInc = data.beaconInc;
      this.currentData.beaconInc = data.beaconInc;
    }
    if (data.beaconRaan !== undefined) {
      this.beaconRaan = data.beaconRaan;
      this.currentData.beaconRaan = data.beaconRaan;
    }
    if (data.slewProgress !== undefined) {
      this.slewProgress = data.slewProgress;
      this.currentData.slewProgress = data.slewProgress;
    }
    if (data.autoLOS !== undefined) {
      this.currentData.autoLOS = data.autoLOS;
      saveSceneSettings({ autoLOS: data.autoLOS });
    }
    if (data.isLockedInFov !== undefined) this.currentData.isLockedInFov = data.isLockedInFov;
    if (data.isLostFromFov !== undefined) this.currentData.isLostFromFov = data.isLostFromFov;
    if (data.beaconPixelU !== undefined) this.currentData.beaconPixelU = data.beaconPixelU;
    if (data.beaconPixelV !== undefined) this.currentData.beaconPixelV = data.beaconPixelV;
    if (data.beaconAngularErrorDeg !== undefined) this.currentData.beaconAngularErrorDeg = data.beaconAngularErrorDeg;
    if (data.beaconInFov !== undefined) this.currentData.beaconInFov = data.beaconInFov;
    if (data.perigeeAltKm !== undefined) this.currentData.perigeeAltKm = data.perigeeAltKm;
    if (data.apogeeAltKm !== undefined) this.currentData.apogeeAltKm = data.apogeeAltKm;
    if (data.argPerigeeDeg !== undefined) this.currentData.argPerigeeDeg = data.argPerigeeDeg;
    if (data.semiMajorAxisKm !== undefined) this.currentData.semiMajorAxisKm = data.semiMajorAxisKm;
    if (data.eccentricity !== undefined) this.currentData.eccentricity = data.eccentricity;
    if (data.speedKmS !== undefined) this.currentData.speedKmS = data.speedKmS;
    if (data.currentRadiusKm !== undefined) this.currentData.currentRadiusKm = data.currentRadiusKm;
    if (data.altitudeKm !== undefined) this.currentData.altitudeKm = data.altitudeKm;
    if (data.beaconSpeedKmh !== undefined) this.currentData.beaconSpeedKmh = data.beaconSpeedKmh;
    if (data.isDrawingPath !== undefined) this.currentData.isDrawingPath = data.isDrawingPath;
    if (data.pathMotionActive !== undefined) this.currentData.pathMotionActive = data.pathMotionActive;
    if (data.pathFollowMode !== undefined) this.currentData.pathFollowMode = data.pathFollowMode;
    if (data.boresightDir) {
      if (!this.currentData.boresightDir) {
        this.currentData.boresightDir = data.boresightDir.clone();
      } else {
        this.currentData.boresightDir.copy(data.boresightDir);
      }
    }

    // Slant range
    const distUnits = this.currentData.satPos.distanceTo(this.currentData.tgtPos);
    this.currentData.slantRangeKm = (distUnits / 100.0) * EARTH_RADIUS_KM;

    // Gimbal Pan/Tilt relative to Nadir frame
    if (this.currentData.boresightDir) {
      const nadirDir = this.currentData.satPos.clone().negate().normalize();
      let upRef = new THREE.Vector3(0, 1, 0);
      if (Math.abs(nadirDir.dot(upRef)) > 0.9) upRef = new THREE.Vector3(1, 0, 0);
      const right = new THREE.Vector3().crossVectors(nadirDir, upRef).normalize();
      const realUp = new THREE.Vector3().crossVectors(right, nadirDir).normalize();
      this.currentData.gimbalPanDeg = THREE.MathUtils.radToDeg(
        Math.asin(THREE.MathUtils.clamp(this.currentData.boresightDir.dot(right), -1, 1))
      );
      this.currentData.gimbalTiltDeg = THREE.MathUtils.radToDeg(
        Math.asin(THREE.MathUtils.clamp(this.currentData.boresightDir.dot(realUp), -1, 1))
      );
    }

    this.currentData.timestamp = Date.now();
    this.recomputeFpaProjection();

    for (let i = 0; i < this.listeners.length; i++) {
      this.listeners[i](this.currentData);
    }
  }

  /**
   * Projects the orbital beacon onto the satellite's 640x480 FPA using the same
   * linear 160 px/deg mapping the backend uses (640 px / 4.0 deg, 480 px / 3.0 deg).
   * This is the single source of truth for the white-pixel beacon in the FPA viewport.
   */
  private recomputeFpaProjection() {
    const d = this.currentData;
    const losDir = new THREE.Vector3().subVectors(d.tgtPos, d.satPos).normalize();
    const boresight =
      d.boresightDir && d.boresightDir.lengthSq() > 1e-9
        ? d.boresightDir.clone().normalize()
        : (d.autoLOS ? losDir.clone() : d.satPos.clone().negate().normalize());

    const dot = THREE.MathUtils.clamp(boresight.dot(losDir), -1, 1);
    const angDeg = THREE.MathUtils.radToDeg(Math.acos(dot));
    d.beaconAngularErrorDeg = angDeg;

    if (d.isOccluded || dot <= 0) {
      d.beaconPixelU = null;
      d.beaconPixelV = null;
      d.beaconInFov = false;
      return;
    }

    // Orthogonal basis around the boresight for signed azimuth/elevation offsets.
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

    // Linear FPA mapping: u = 320 + az * 160, v = 240 - el * 160
    const u = 320.0 + deltaAzDeg * 160.0;
    const v = 240.0 - deltaElDeg * 160.0;

    const inSensor = u >= 0.0 && u <= 640.0 && v >= 0.0 && v <= 480.0;
    const inAngularFov = Math.abs(deltaAzDeg) <= 2.0 && Math.abs(deltaElDeg) <= 1.5;

    d.beaconPixelU = inSensor ? u : null;
    d.beaconPixelV = inSensor ? v : null;
    d.beaconInFov = inSensor && inAngularFov && !d.isOccluded;
  }

  getData(): SatellitePovState {
    return this.currentData;
  }

  getCurrent(): SatellitePovState {
    return this.currentData;
  }

  subscribe(listener: (data: SatellitePovState) => void): () => void {
    this.listeners.push(listener);
    try {
      listener(this.currentData);
    } catch (e) {
      console.error('Error in initial satellitePovSync listener call:', e);
    }
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}

export const satellitePovSync = new SatellitePovSync();
