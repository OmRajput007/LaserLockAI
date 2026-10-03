import React from 'react';
import { OrbitalTelemetry } from '../types';
import {
  Activity,
  Radio,
  Gauge,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Compass,
  ArrowRight,
  Globe,
} from 'lucide-react';

interface Props {
  telemetry: OrbitalTelemetry | null;
}

export const OrbitalTelemetryPanel: React.FC<Props> = ({ telemetry }) => {
  const link = telemetry?.link;
  const camera = telemetry?.camera;
  const beacon = telemetry?.beacon;
  const camOrbit = telemetry?.camera_orbit;
  const beaconOrbit = telemetry?.beacon_orbit;

  const isBlocked = link?.link_state === 'LINK_BLOCKED';
  const isOutOfFov = link?.is_out_of_fov || (link && (Math.abs(link.az_body_deg) > 2.0 || Math.abs(link.el_body_deg) > 1.5));

  const getLinkStatusDisplay = () => {
    if (!link) return { text: 'INITIALIZING', color: 'text-[#9CA195]', bg: 'bg-[#262824] border-[#33362F]' };
    if (isBlocked) {
      return { text: '✕ BLOCKED (EARTH OCCULTATION)', color: 'text-[#FF5F40]', bg: 'bg-[#FF5F40]/15 border-[#FF5F40]' };
    }
    if (isOutOfFov) {
      return { text: '! OUT OF FOV (FOV: 4°×3°)', color: 'text-[#F0FFEA]', bg: 'bg-[#262824] border-[#33362F]' };
    }
    return { text: '✓ LINK OK (ACQUIRED)', color: 'text-[#FF5F40]', bg: 'bg-[#FF5F40]/15 border-[#FF5F40]' };
  };

  const status = getLinkStatusDisplay();

  return (
    <div className="flex flex-col gap-3 font-mono text-xs select-none text-[#F0FFEA]">
      {/* 1. Core Orbital Link State Card */}
      <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-3.5 space-y-2.5">
        <div className="flex items-center justify-between border-b border-[#33362F] pb-1.5">
          <div className="flex items-center gap-2 text-[#FF5F40] font-bold uppercase tracking-wider">
            <Radio className="w-4 h-4 text-[#FF5F40]" />
            <span>LOS Link Telemetry</span>
          </div>
          <span className="text-[10px] text-[#9CA195]">Double-Precision ECI</span>
        </div>

        {/* Link Status Banner */}
        <div className={`p-2 rounded border flex items-center justify-between ${status.bg}`}>
          <span className="text-[11px] text-[#9CA195] font-semibold uppercase tracking-wider">Optical Channel:</span>
          <span className={`font-bold text-[11px] font-mono ${status.color}`}>{status.text}</span>
        </div>

        {/* Primary Link Metrics */}
        <div className="space-y-1.5 pt-1 font-mono">
          <div className="flex justify-between items-center">
            <span className="text-[#9CA195]">Slant Range:</span>
            <span className="text-[#F0FFEA] font-bold text-sm">
              {link?.range_km != null ? `${link.range_km.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km` : '--'}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-[#9CA195]">Relative Velocity:</span>
            <span className="text-[#FF5F40] font-bold">
              {link?.relative_speed_km_s != null ? `${link.relative_speed_km_s.toFixed(3)} km/s` : '--'}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-[#9CA195]">Beacon Angular Rate:</span>
            <span className="text-[#FF5F40] font-bold">
              {link?.angular_rate_deg_s != null ? `${link.angular_rate_deg_s.toFixed(4)} °/s` : '--'}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-[#9CA195]">Atmosphere Path Fraction:</span>
            <span className="text-[#F0FFEA] font-bold">
              {link?.atmosphere_path_frac != null ? `${(link.atmosphere_path_frac * 100).toFixed(1)}% (< 20 km)` : '--'}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-[#9CA195]">Min LOS Earth Clearance:</span>
            <span className={link && link.min_los_clearance_km < 0 ? 'text-[#FF5F40] font-bold' : 'text-[#F0FFEA]'}>
              {link?.min_los_clearance_km != null ? `${link.min_los_clearance_km.toFixed(1)} km` : '--'}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Camera Body-Frame Angular Angles Card */}
      <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-3.5 space-y-2">
        <div className="flex items-center justify-between border-b border-[#33362F] pb-1.5">
          <div className="flex items-center gap-2 text-[#FF5F40] font-bold uppercase tracking-wider">
            <Compass className="w-4 h-4 text-[#FF5F40]" />
            <span>Camera Body-Frame Angles</span>
          </div>
          <span className="text-[10px] text-[#9CA195]">LVLH / ENU</span>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1 font-mono">
          <div className="bg-[#262824] border border-[#33362F] p-2 rounded text-center">
            <span className="text-[#9CA195] text-[10px] block mb-0.5 uppercase tracking-wider">Azimuth (Body X→Y):</span>
            <span className="text-[#FF5F40] font-bold text-sm">
              {link?.az_body_deg != null ? `${link.az_body_deg.toFixed(3)}°` : '--'}
            </span>
            <span className="text-[9px] text-[#5E625A] block mt-0.5">HFOV: ±2.0°</span>
          </div>

          <div className="bg-[#262824] border border-[#33362F] p-2 rounded text-center">
            <span className="text-[#9CA195] text-[10px] block mb-0.5 uppercase tracking-wider">Elevation (Body Z):</span>
            <span className="text-[#FF5F40] font-bold text-sm">
              {link?.el_body_deg != null ? `${link.el_body_deg.toFixed(3)}°` : '--'}
            </span>
            <span className="text-[9px] text-[#5E625A] block mt-0.5">VFOV: ±1.5°</span>
          </div>
        </div>

        <div className="flex justify-between items-center text-[11px] pt-1 border-t border-[#33362F]">
          <span className="text-[#9CA195]">Optical Intensity Scale:</span>
          <span className="text-[#F0FFEA] font-bold font-mono">
            {link?.intensity_fraction != null ? `${(link.intensity_fraction * 100).toFixed(1)}%` : '--'}
          </span>
        </div>
      </div>

      {/* 3. Platform Orbital Dynamics Card */}
      <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-3.5 space-y-2">
        <div className="flex items-center justify-between border-b border-[#33362F] pb-1.5">
          <div className="flex items-center gap-2 text-[#FF5F40] font-bold uppercase tracking-wider">
            <Gauge className="w-4 h-4 text-[#FF5F40]" />
            <span>Platform Orbital Dynamics</span>
          </div>
          <span className="text-[10px] text-[#9CA195]">Keplerian / Kinematic</span>
        </div>

        {/* Camera Platform Metrics */}
        <div className="space-y-1 pt-1 font-mono">
          <div className="text-[11px] text-[#FF5F40] font-bold flex items-center justify-between uppercase">
            <span>Camera Platform:</span>
            <span>{camera?.altitude_km != null ? `${camera.altitude_km.toFixed(1)} km Alt` : '--'}</span>
          </div>
          <div className="flex justify-between text-[11px] text-[#9CA195]">
            <span>Orbital Speed:</span>
            <span className="text-[#F0FFEA]">{camera?.speed_km_s != null ? `${camera.speed_km_s.toFixed(2)} km/s` : '--'}</span>
          </div>
          {camOrbit && (
            <div className="flex justify-between text-[11px] text-[#9CA195]">
              <span>Orbit Period:</span>
              <span className="text-[#F0FFEA]">{camOrbit.period_s.toFixed(0)} s ({(camOrbit.period_s / 60).toFixed(1)} min)</span>
            </div>
          )}
        </div>

        <div className="border-t border-[#33362F] pt-2 space-y-1 font-mono">
          <div className="text-[11px] text-[#F0FFEA] font-bold flex items-center justify-between uppercase">
            <span>Beacon Platform:</span>
            <span>{beacon?.altitude_km != null ? `${beacon.altitude_km.toFixed(1)} km Alt` : '--'}</span>
          </div>
          <div className="flex justify-between text-[11px] text-[#9CA195]">
            <span>Orbital Speed:</span>
            <span className="text-[#F0FFEA]">{beacon?.speed_km_s != null ? `${beacon.speed_km_s.toFixed(2)} km/s` : '--'}</span>
          </div>
          {beaconOrbit && (
            <div className="flex justify-between text-[11px] text-[#9CA195]">
              <span>Orbit Period:</span>
              <span className="text-[#F0FFEA]">{beaconOrbit.period_s.toFixed(0)} s ({(beaconOrbit.period_s / 60).toFixed(1)} min)</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
