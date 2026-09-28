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
}

export const computeOrbitPoint = (
  radius: number,
  incDeg: number,
  raanDeg: number,
  anomaly: number
): THREE.Vector3 => {
  const inc = THREE.MathUtils.degToRad(incDeg);
  const raan = THREE.MathUtils.degToRad(raanDeg);
  const xOrb = radius * Math.cos(anomaly);
  const zOrb = radius * Math.sin(anomaly);
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

class SatellitePovSync {
  private currentData: SatellitePovState = {
    satPos: computeOrbitPoint(150, 53.0, 35.0, 0.85),
    tgtPos: computeOrbitPoint(100, 35.0, 25.0, 0.4),
    earthRotationY: 0,
    isOccluded: false,
    orbitRadius: 150,
    incDeg: 53.0,
    raanDeg: 35.0,
    anomaly: 0.85,
    timestamp: Date.now(),
    autoLOS: false,
    isLockedInFov: false,
    isLostFromFov: true,
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
    this.currentData.timestamp = Date.now();

    for (let i = 0; i < this.listeners.length; i++) {
      this.listeners[i](this.currentData);
    }
  }

  getData(): SatellitePovState {
    const now = Date.now();
    // If no external updates received in >300ms, auto-propagate kinematics
    if (now - this.currentData.timestamp > 300) {
      this.currentData.anomaly += 0.003;
      this.currentData.earthRotationY += 0.0006;
      const updatedSat = computeOrbitPoint(
        this.currentData.orbitRadius,
        this.currentData.incDeg,
        this.currentData.raanDeg,
        this.currentData.anomaly
      );
      this.currentData.satPos.copy(updatedSat);
      const occ = checkEarthOcclusion(this.currentData.satPos, this.currentData.tgtPos, 100);
      this.currentData.isOccluded = occ.isOccluded;
      if (occ.isOccluded) {
        this.currentData.isLockedInFov = false;
        this.currentData.isLostFromFov = true;
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
