import * as THREE from 'three';

export interface SatellitePovState {
  satPos: THREE.Vector3;
  tgtPos: THREE.Vector3;
  earthRotationY: number;
  isOccluded: boolean;
  orbitRadius: number;
  incDeg: number;
  raanDeg: number;
  anomaly: number;
  timestamp: number;
  autoLOS: boolean;
  isLockedInFov: boolean; // True when rectangular FOV frustum is GREEN
  isLostFromFov: boolean;   // True when rectangular FOV frustum is RED
  perigeeAltKm?: number;
  apogeeAltKm?: number;
  argPerigeeDeg?: number;
  semiMajorAxisKm?: number;
  eccentricity?: number;
  speedKmS?: number;
  currentRadiusKm?: number;
  beaconSpeedKmh?: number;
  boresightDir?: THREE.Vector3;
}

// Earth equatorial circumference for atmospheric beacon kinematics
export const EARTH_CIRCUMFERENCE_KM = 40075.0;

/**
 * Computes physical real-world angular velocity for an atmospheric beacon (UAV/Drone):
 * omega_real = (2 * Math.PI * speed_kmh) / (40075 * 3600)  // in radians/sec
 * At 1,200 km/h: 1 revolution takes 33 hours 24 minutes (120,225 seconds).
 */
export const computeBeaconOmegaReal = (speedKmh: number): number => {
  if (speedKmh <= 0) return 0;
  return (2.0 * Math.PI * speedKmh) / (EARTH_CIRCUMFERENCE_KM * 3600.0);
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
    const t1 = (-b - Math.sqrt(disc)) / 2;
    const t2 = (-b + Math.sqrt(disc)) / 2;
    const minT = Math.min(t1, t2);
    if (minT > 0.1 && minT < dLen * 0.999) {
      return {
        isOccluded: true,
        hitPoint: satPos.clone().addScaledVector(dNorm, minT),
      };
    }
  }
  return { isOccluded: false };
};

export const EARTH_ROT_DEG_PER_HOUR = 15.0;
export const EARTH_ROT_RAD_PER_SEC = (15.0 * Math.PI) / (180.0 * 3600.0); // ~7.2722052e-5 rad/s (15 deg/hour)

class SatellitePovSync {
  private currentData: SatellitePovState = {
    satPos: computeOrbitPoint(108.62, 53.0, 35.0, 0.85),
    tgtPos: computeOrbitPoint(100, 35.0, 25.0, 0.4),
    earthRotationY: 0,
    isOccluded: false,
    orbitRadius: 108.62,
    incDeg: 53.0,
    raanDeg: 35.0,
    anomaly: 0.85,
    timestamp: Date.now(),
    autoLOS: false,
    isLockedInFov: false,
    isLostFromFov: true,
    boresightDir: new THREE.Vector3(0, 0, -1),
  };

  private listeners: ((data: SatellitePovState) => void)[] = [];

  update(data: Partial<SatellitePovState>) {
    if (data.satPos) this.currentData.satPos.copy(data.satPos);
    if (data.tgtPos) this.currentData.tgtPos.copy(data.tgtPos);
    if (data.earthRotationY !== undefined) this.currentData.earthRotationY = data.earthRotationY;
    if (data.isOccluded !== undefined) this.currentData.isOccluded = data.isOccluded;
    if (data.orbitRadius !== undefined) this.currentData.orbitRadius = data.orbitRadius;
    if (data.incDeg !== undefined) this.currentData.incDeg = data.incDeg;
    if (data.raanDeg !== undefined) this.currentData.raanDeg = data.raanDeg;
    if (data.anomaly !== undefined) this.currentData.anomaly = data.anomaly;
    if (data.autoLOS !== undefined) this.currentData.autoLOS = data.autoLOS;
    if (data.isLockedInFov !== undefined) this.currentData.isLockedInFov = data.isLockedInFov;
    if (data.isLostFromFov !== undefined) this.currentData.isLostFromFov = data.isLostFromFov;
    if (data.perigeeAltKm !== undefined) this.currentData.perigeeAltKm = data.perigeeAltKm;
    if (data.apogeeAltKm !== undefined) this.currentData.apogeeAltKm = data.apogeeAltKm;
    if (data.argPerigeeDeg !== undefined) this.currentData.argPerigeeDeg = data.argPerigeeDeg;
    if (data.semiMajorAxisKm !== undefined) this.currentData.semiMajorAxisKm = data.semiMajorAxisKm;
    if (data.eccentricity !== undefined) this.currentData.eccentricity = data.eccentricity;
    if (data.speedKmS !== undefined) this.currentData.speedKmS = data.speedKmS;
    if (data.currentRadiusKm !== undefined) this.currentData.currentRadiusKm = data.currentRadiusKm;
    if (data.beaconSpeedKmh !== undefined) this.currentData.beaconSpeedKmh = data.beaconSpeedKmh;
    if (data.boresightDir) {
      if (!this.currentData.boresightDir) {
        this.currentData.boresightDir = data.boresightDir.clone();
      } else {
        this.currentData.boresightDir.copy(data.boresightDir);
      }
    }
    this.currentData.timestamp = Date.now();

    for (let i = 0; i < this.listeners.length; i++) {
      this.listeners[i](this.currentData);
    }
  }

  getData(): SatellitePovState {
    const now = Date.now();
    // If no external updates received in >300ms, auto-propagate kinematics
    if (now - this.currentData.timestamp > 300) {
      const dtSec = Math.min(2.0, (now - this.currentData.timestamp) / 1000);
      this.currentData.anomaly += 0.003;
      this.currentData.earthRotationY += EARTH_ROT_RAD_PER_SEC * dtSec;
      const updatedSat = computeOrbitPoint(
        this.currentData.orbitRadius,
        this.currentData.incDeg,
        this.currentData.raanDeg,
        this.currentData.anomaly,
        this.currentData.argPerigeeDeg ?? 0
      );
      this.currentData.satPos.copy(updatedSat);
      const baseTgt = computeOrbitPoint(100, 35.0, 25.0, 0.4);
      baseTgt.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.currentData.earthRotationY);
      this.currentData.tgtPos.copy(baseTgt);
      const occ = checkEarthOcclusion(this.currentData.satPos, this.currentData.tgtPos, 100);
      this.currentData.isOccluded = occ.isOccluded;
      if (occ.isOccluded) {
        this.currentData.isLockedInFov = false;
        this.currentData.isLostFromFov = true;
      }
      if (!this.currentData.boresightDir) {
        this.currentData.boresightDir = new THREE.Vector3();
      }
      if (this.currentData.autoLOS && !this.currentData.isOccluded) {
        this.currentData.boresightDir.subVectors(this.currentData.tgtPos, this.currentData.satPos).normalize();
      } else {
        this.currentData.boresightDir.copy(this.currentData.satPos).negate().normalize();
      }
      this.currentData.timestamp = now;
    }
    return this.currentData;
  }

  getCurrent(): SatellitePovState {
    return this.getData();
  }

  subscribe(listener: (data: SatellitePovState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}

export const satellitePovSync = new SatellitePovSync();
