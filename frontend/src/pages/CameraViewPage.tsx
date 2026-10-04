import React, { useState, useEffect } from 'react';
import { SimulationTelemetry, SystemConfig } from '../types';
import { FPACameraViewport } from '../simulation/FPACameraViewport';
import { satellitePovSync, SatellitePovState } from '../simulation/satellitePovSync';
import { Video, Sliders, Info, Compass, Radio } from 'lucide-react';

interface Props {
  telemetry: SimulationTelemetry | null;
  config: SystemConfig | null;
  onGimbalNudge: (pan_rate: number, tilt_rate: number) => void;
  onGimbalAngles: (target_pan: number, target_tilt: number) => void;
  onSelectShape: (shape: 'Square' | 'Circle' | 'Gaussian') => void;
}

export const CameraViewPage: React.FC<Props> = ({
  telemetry,
  config,
  onGimbalNudge,
  onGimbalAngles,
  onSelectShape,
}) => {
  const target = telemetry?.target ?? null;

  // Single Source of Truth for Satellite POV (synchronized with Mission Control & 3D environment)
  const [povState, setPovState] = useState<SatellitePovState>(() => satellitePovSync.getData());

  useEffect(() => {
    const unsub = satellitePovSync.subscribe((data) => {
      setPovState({ ...data });
    });
    return unsub;
  }, []);

  const isOccluded = Boolean(povState.isOccluded);
  const isLocked = Boolean(povState.isLockedInFov && !isOccluded);
  const inFov = Boolean(povState.beaconInFov && !isOccluded);
  const hasSpot = !isOccluded && povState.beaconPixelU !== null && povState.beaconPixelV !== null;

  // Slant range in km
  const slantRangeKm =
    povState.slantRangeKm ??
    (povState.satPos && povState.tgtPos
      ? (povState.satPos.distanceTo(povState.tgtPos) / 100.0) * 6378.137
      : 550.0);

  return (
    <div className="flex flex-col gap-4 font-mono text-xs text-[#F0FFEA]">
      {/* Page Header */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-4 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#262824] border border-[#33362F] flex items-center justify-center text-[#FF5F40]">
            <Video className="w-4 h-4 text-[#FF5F40]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#F0FFEA]">
                FSOC PAT Satellite Camera POV (FPA Viewport)
              </h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-[#262824] border border-[#33362F] text-[#10b981]">
                <Radio className="w-3 h-3 animate-pulse text-[#10b981]" />
                SYNCED WITH MISSION CONTROL
              </span>
            </div>
            <p className="text-[#9CA195] text-xs mt-0.5">
              640 × 480 Resolution • 4.0° × 3.0° Field of View • Real-time Keplerian Orbital Alignment
            </p>
          </div>
        </div>

        {/* Spot Shape Selector */}
        <div className="flex items-center gap-2">
          <span className="text-[#9CA195] text-xs font-medium">Beacon Profile:</span>
          {(['Square', 'Circle', 'Gaussian'] as const).map((s) => (
            <button
              key={s}
              onClick={() => onSelectShape(s)}
              className={`px-3 py-1 rounded text-xs font-mono transition border ${
                config?.target.shape === s
                  ? 'bg-[#FF5F40] text-[#0A0A0A] font-bold border-[#FF5F40]'
                  : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA] hover:border-[#FF5F40]/50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Main Viewport & Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-lg overflow-hidden border border-[#33362F] bg-[#000000]">
          <FPACameraViewport
            target={target}
            camera={telemetry?.camera ?? null}
            tracking={telemetry?.tracking ?? null}
            detection={telemetry?.detection ?? null}
            disturbance={telemetry?.disturbance ?? null}
            onGimbalNudge={onGimbalNudge}
            onGimbalAngles={onGimbalAngles}
            showGimbalControls={true}
          />
        </div>

        <div className="flex flex-col gap-3">
          {/* Projection Telemetry */}
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F0FFEA] border-b border-[#33362F] pb-2 flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-[#FF5F40]" />
              Camera Projection Telemetry
            </h3>
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#9CA195]">Sensor Status:</span>
              <div className="flex items-center gap-1.5 font-medium">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isOccluded
                      ? 'bg-[#f43f5e] animate-pulse'
                      : isLocked
                      ? 'bg-[#10b981]'
                      : inFov
                      ? 'bg-[#FF5F40]'
                      : 'bg-[#5E625A]'
                  }`}
                />
                <span
                  className={
                    isOccluded
                      ? 'text-[#f43f5e] font-bold'
                      : isLocked
                      ? 'text-[#10b981] font-bold'
                      : inFov
                      ? 'text-[#FF5F40] font-bold'
                      : 'text-[#9CA195]'
                  }
                >
                  {isOccluded
                    ? '✕ Occluded (Earth Limb)'
                    : isLocked
                    ? '✓ Locked in FOV'
                    : inFov
                    ? '✓ Inside FOV (Acquiring)'
                    : '✕ Clipped (Outside FOV)'}
                </span>
              </div>
            </div>
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#9CA195]">Pixel Coordinates (u, v):</span>
              <span className="text-[#F0FFEA] font-medium">
                {hasSpot && povState.beaconPixelU !== null && povState.beaconPixelV !== null
                  ? `(${povState.beaconPixelU.toFixed(1)}, ${povState.beaconPixelV.toFixed(1)})`
                  : isOccluded
                  ? 'Link Blocked'
                  : 'Clipped'}
              </span>
            </div>
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#9CA195]">Bearing in Lens (Az, El):</span>
              <span className="text-[#F0FFEA] font-medium">
                {hasSpot && povState.beaconPixelU !== null && povState.beaconPixelV !== null
                  ? `Az: ${(povState.beaconPixelU - 320.0) / 160.0 >= 0 ? '+' : ''}${((povState.beaconPixelU - 320.0) / 160.0).toFixed(2)}° • El: ${(240.0 - povState.beaconPixelV) / 160.0 >= 0 ? '+' : ''}${((240.0 - povState.beaconPixelV) / 160.0).toFixed(2)}°`
                  : '--'}
              </span>
            </div>
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#9CA195]">Slant Range Distance:</span>
              <span className="text-[#F0FFEA] font-medium">
                {slantRangeKm.toFixed(1)} km
              </span>
            </div>
            <div className="flex justify-between border-t border-[#33362F] pt-2 font-mono text-xs">
              <span className="text-[#9CA195]">Pointing Error:</span>
              <span
                className={`font-semibold ${
                  isOccluded
                    ? 'text-[#f43f5e]'
                    : isLocked
                    ? 'text-[#10b981]'
                    : inFov
                    ? 'text-[#FF5F40]'
                    : 'text-[#F0FFEA]'
                }`}
              >
                {isOccluded
                  ? 'Occluded by Earth'
                  : hasSpot && povState.beaconPixelU !== null && povState.beaconPixelV !== null
                  ? `${Math.hypot(povState.beaconPixelU - 320, povState.beaconPixelV - 240).toFixed(1)} px (${(povState.beaconAngularErrorDeg ?? 0).toFixed(2)}°)`
                  : `${(povState.beaconAngularErrorDeg ?? 180.0).toFixed(2)}°`}
              </span>
            </div>
          </div>

          {/* Gimbal Kinematics & Limits */}
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F0FFEA] border-b border-[#33362F] pb-2 flex items-center gap-2">
              <Compass className="w-3.5 h-3.5 text-[#FF5F40]" />
              Gimbal Kinematics & Actuator Limits
            </h3>
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#9CA195]">Current Pan Angle:</span>
              <span className="text-[#F0FFEA] font-medium">
                {((povState.gimbalPanDeg ?? 0) >= 0 ? '+' : '') + (povState.gimbalPanDeg ?? 0).toFixed(2)}°
              </span>
            </div>
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#9CA195]">Current Tilt Angle:</span>
              <span className="text-[#F0FFEA] font-medium">
                {((povState.gimbalTiltDeg ?? 0) >= 0 ? '+' : '') + (povState.gimbalTiltDeg ?? 0).toFixed(2)}°
              </span>
            </div>
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#9CA195]">Tracking Mode:</span>
              <span
                className={`font-medium ${
                  povState.autoLOS
                    ? isLocked
                      ? 'text-[#10b981]'
                      : 'text-[#FF5F40]'
                    : 'text-[#9CA195]'
                }`}
              >
                {povState.autoLOS
                  ? isLocked
                    ? 'AUTO LOS (LOCKED)'
                    : 'AUTO LOS (SLEWING)'
                  : 'STANDBY (NADIR HOLD)'}
              </span>
            </div>
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#9CA195]">Gimbal Slew Speed:</span>
              <span className="text-[#FF5F40] font-medium">
                {povState.autoLOS && !isLocked ? '2.5°/s (Active Slew)' : '0.0°/s (Tracking Hold)'}
              </span>
            </div>
            <div className="flex justify-between font-mono text-xs border-t border-[#33362F] pt-2">
              <span className="text-[#9CA195]">Satellite Velocity:</span>
              <span className="text-[#F0FFEA] font-medium">
                ~{povState.speedKmS ? (povState.speedKmS * 3600).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '27,320'} km/h ({(povState.speedKmS ?? 7.59).toFixed(2)} km/s)
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#9CA195]">Actuator Limits:</span>
              <span className="text-[#F0FFEA] font-mono">Pan ±180° • Tilt ±85°</span>
            </div>
          </div>

          {/* FOV Clipping Rule Info */}
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-3.5 space-y-1.5 text-xs text-[#9CA195]">
            <div className="text-[#F0FFEA] font-medium flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-[#FF5F40]" /> Field of View & LOS Alignment
            </div>
            <p className="leading-relaxed text-[11px] text-[#9CA195]">
              When the beacon moves beyond the satellite's 4° × 3° sensor cone or is occluded by Earth limb horizon, the optical spot is clipped and the alarm triggers. Engaging Auto LOS automatically slews the optical boresight to acquire and lock the beacon.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
