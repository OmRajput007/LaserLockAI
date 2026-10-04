import * as THREE from 'three';
import {
  orbitalEngine,
  OrbitalEngineState,
  EARTH_RENDER_R,
  EARTH_RADIUS_KM,
  READABLE_K,
  SIDEREAL_DAY_SEC,
  EARTH_ROT_RAD_PER_SEC,
  EARTH_ROT_DEG_PER_HOUR,
  GM_EARTH_KM3_S2,
  EARTH_CIRCUMFERENCE_KM,
  solveKepler,
  eccentricToTrueAnomaly,
  trueToEccentricAnomaly,
  computeMeanMotionRadS,
  computeOrbitalPeriodSec,
  computeOrbitPoint,
  checkEarthOcclusion,
  getRenderAltitudeOffset,
  getRenderOrbitRadius,
  slerpOnSphere,
  latLonToVector3,
  BeaconPathWaypoint,
  PRESET_4POINT_WAYPOINTS,
  RenderScaleMode,
} from './orbitalEngine';

export {
  EARTH_RENDER_R,
  EARTH_RADIUS_KM,
  READABLE_K,
  SIDEREAL_DAY_SEC,
  EARTH_ROT_RAD_PER_SEC,
  EARTH_ROT_DEG_PER_HOUR,
  GM_EARTH_KM3_S2,
  EARTH_CIRCUMFERENCE_KM,
  solveKepler,
  eccentricToTrueAnomaly,
  trueToEccentricAnomaly,
  computeMeanMotionRadS,
  computeOrbitalPeriodSec,
  computeOrbitPoint,
  checkEarthOcclusion,
  getRenderAltitudeOffset,
  getRenderOrbitRadius,
  slerpOnSphere,
  latLonToVector3,
  PRESET_4POINT_WAYPOINTS,
};
export type { BeaconPathWaypoint, RenderScaleMode };

export interface SatellitePovState {
  satPos: THREE.Vector3;
  tgtPos: THREE.Vector3;
  trueBeaconGroundPos?: THREE.Vector3;
  backupSatPos?: THREE.Vector3;
  earthRotationY: number;
  isOccluded: boolean;
  hitPoint?: THREE.Vector3 | null;
  hitDistance?: number | null;
  backupIsOccluded?: boolean;
  orbitRadius: number;
  incDeg: number;
  raanDeg: number;
  anomaly: number; // true anomaly nu (radians)
  meanAnomaly?: number; // mean anomaly M (radians)
  timestamp: number;
  autoLOS: boolean;
  isLockedInFov: boolean; // True when rectangular FOV frustum is GREEN
  isLostFromFov: boolean; // True when rectangular FOV frustum is RED
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
  disturbance?: import('../types').DisturbanceTelemetry | null;
}

export const computeBeaconOmegaReal = (speedKmh: number): number => {
  if (speedKmh <= 0) return 0;
  return (2.0 * Math.PI * speedKmh) / (EARTH_CIRCUMFERENCE_KM * 3600.0);
};

class SatellitePovSync {
  private listeners: ((data: SatellitePovState) => void)[] = [];
  private lastTickTime: number = typeof performance !== 'undefined' ? performance.now() : Date.now();
  private cachedState: SatellitePovState;

  constructor() {
    this.cachedState = this.mapEngineToPov(orbitalEngine.getState());

    if (typeof window !== 'undefined') {
      // 60 FPS autonomous physical simulation loop
      const tick = () => {
        const now = performance.now();
        const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTickTime) / 1000));
        this.lastTickTime = now;

        orbitalEngine.step(dt);
        this.cachedState = this.mapEngineToPov(orbitalEngine.getState());
        this.notifyListeners();

        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      // Background safety interval (ensures simulation continues even when tab is backgrounded)
      setInterval(() => {
        const now = performance.now();
        if (now - this.lastTickTime > 80) {
          const dt = Math.min(0.05, (now - this.lastTickTime) / 1000);
          this.lastTickTime = now;
          orbitalEngine.step(dt);
          this.cachedState = this.mapEngineToPov(orbitalEngine.getState());
          this.notifyListeners();
        }
      }, 50);
    }
  }

  private mapEngineToPov(s: OrbitalEngineState): SatellitePovState {
    return {
      satPos: s.satPos.clone(),
      tgtPos: s.tgtPos.clone(),
      trueBeaconGroundPos: s.trueBeaconGroundPos.clone(),
      backupSatPos: s.backupSatPos.clone(),
      earthRotationY: s.earthRotationY,
      isOccluded: s.isOccluded,
      hitPoint: s.hitPoint ? s.hitPoint.clone() : null,
      hitDistance: s.hitDistance,
      backupIsOccluded: s.backupIsOccluded,
      orbitRadius: s.orbitRadius,
      incDeg: s.incDeg,
      raanDeg: s.raanDeg,
      anomaly: s.anomaly,
      meanAnomaly: s.meanAnomaly,
      timestamp: s.timestamp,
      autoLOS: s.autoLOS,
      isLockedInFov: s.isLockedInFov,
      isLostFromFov: s.isLostFromFov,
      beaconPixelU: s.beaconPixelU,
      beaconPixelV: s.beaconPixelV,
      beaconAngularErrorDeg: s.beaconAngularErrorDeg,
      beaconInFov: s.beaconInFov,
      perigeeAltKm: s.perigeeAltKm,
      apogeeAltKm: s.apogeeAltKm,
      argPerigeeDeg: s.argPerigeeDeg,
      semiMajorAxisKm: s.semiMajorAxisKm,
      eccentricity: s.eccentricity,
      speedKmS: s.speedKmS,
      currentRadiusKm: s.currentRadiusKm,
      altitudeKm: s.altitudeKm,
      beaconAnomaly: s.beaconAnomaly,
      beaconSpeedKmh: s.beaconSpeedKmh,
      beaconInc: s.beaconInc,
      beaconRaan: s.beaconRaan,
      boresightDir: s.boresightDir.clone(),
      isDrawingPath: s.isDrawingPath,
      pathMotionActive: s.pathMotionActive,
      pathFollowMode: s.pathFollowMode,
      slewProgress: s.slewProgress,
      slantRangeKm: s.slantRangeKm,
      gimbalPanDeg: s.gimbalPanDeg,
      gimbalTiltDeg: s.gimbalTiltDeg,
    };
  }

  private notifyListeners() {
    for (let i = 0; i < this.listeners.length; i++) {
      try {
        this.listeners[i](this.cachedState);
      } catch (err) {
        console.error('Error in satellitePovSync listener:', err);
      }
    }
  }

  /**
   * Route external UI commands to the central orbitalEngine.
   */
  update(data: Partial<SatellitePovState>) {
    if (data.autoLOS !== undefined) {
      orbitalEngine.setAutoLOS(data.autoLOS);
    }
    if (data.beaconSpeedKmh !== undefined) {
      orbitalEngine.setBeaconSpeedKmh(data.beaconSpeedKmh);
    }
    if (data.isDrawingPath !== undefined) {
      orbitalEngine.setIsDrawingPath(data.isDrawingPath);
    }
    if (data.pathFollowMode !== undefined) {
      orbitalEngine.setPathFollowMode(data.pathFollowMode);
    }
    if (data.pathMotionActive !== undefined) {
      orbitalEngine.setPathMotionActive(data.pathMotionActive);
    }
    if (
      data.perigeeAltKm !== undefined ||
      data.apogeeAltKm !== undefined ||
      data.incDeg !== undefined ||
      data.raanDeg !== undefined ||
      data.anomaly !== undefined ||
      data.meanAnomaly !== undefined
    ) {
      const cur = orbitalEngine.getState();
      orbitalEngine.setOrbit({
        perigeeAltKm: data.perigeeAltKm ?? cur.perigeeAltKm,
        apogeeAltKm: data.apogeeAltKm ?? cur.apogeeAltKm,
        incDeg: data.incDeg ?? cur.incDeg,
        raanDeg: data.raanDeg ?? cur.raanDeg,
        argPerigeeDeg: data.argPerigeeDeg ?? cur.argPerigeeDeg,
        trueAnomaly: data.anomaly,
        meanAnomaly: data.meanAnomaly,
      });
    }
    if (
      data.beaconAnomaly !== undefined ||
      data.beaconInc !== undefined ||
      data.beaconRaan !== undefined
    ) {
      orbitalEngine.setBeaconMotion({
        anomaly: data.beaconAnomaly,
        incDeg: data.beaconInc,
        raanDeg: data.beaconRaan,
        speedKmh: data.beaconSpeedKmh,
      });
    }
    if (data.gimbalPanDeg !== undefined || data.gimbalTiltDeg !== undefined) {
      const cur = orbitalEngine.getState();
      orbitalEngine.setManualGimbal(
        data.gimbalPanDeg ?? cur.gimbalPanDeg,
        data.gimbalTiltDeg ?? cur.gimbalTiltDeg
      );
    }
    if (data.disturbance !== undefined) {
      orbitalEngine.setDisturbance(data.disturbance ?? null);
    }

    this.cachedState = this.mapEngineToPov(orbitalEngine.getState());
    this.notifyListeners();
  }

  getData(): SatellitePovState {
    return this.cachedState;
  }

  getCurrent(): SatellitePovState {
    return this.cachedState;
  }

  subscribe(listener: (data: SatellitePovState) => void): () => void {
    this.listeners.push(listener);
    try {
      listener(this.cachedState);
    } catch (e) {
      console.error('Error in initial satellitePovSync listener call:', e);
    }
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}

export const satellitePovSync = new SatellitePovSync();
