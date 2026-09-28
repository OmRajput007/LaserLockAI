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
    if (!link) return { text: 'INITIALIZING', color: 'text-slate-400', bg: 'bg-slate-800' };
    if (isBlocked) {
      return { text: 'BLOCKED (EARTH OCCULTATION)', color: 'text-rose-400', bg: 'bg-rose-950/80 border-rose-700' };
    }
    if (isOutOfFov) {
      return { text: 'OUT OF FOV (FOV: 4°×3°)', color: 'text-amber-400', bg: 'bg-amber-950/80 border-amber-700' };
    }
    return { text: 'LINK OK (ACQUIRED)', color: 'text-emerald-400', bg: 'bg-emerald-950/80 border-emerald-700' };
  };

  const status = getLinkStatusDisplay();

  return (
    <div className="flex flex-col gap-3 font-mono text-xs select-none">
      {/* 1. Core Orbital Link State Card */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3.5 space-y-2.5 shadow-md">
        <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
          <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider">
            <Radio className="w-4 h-4 text-cyan-400" />
            <span>Line of Sight (LOS) Link Telemetry</span>
          </div>
          <span className="text-[10px] text-slate-500">Double-Precision ECI</span>
        </div>

        {/* Link Status Banner */}
        <div className={`p-2 rounded border flex items-center justify-between ${status.bg}`}>
          <span className="text-[11px] text-slate-300 font-semibold">Optical Channel State:</span>
          <span className={`font-bold text-[11px] ${status.color}`}>{status.text}</span>
        </div>

        {/* Primary Link Metrics */}
        <div className="space-y-1.5 pt-1">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Slant Range:</span>
            <span className="text-white font-bold text-sm">
              {link?.range_km != null ? `${link.range_km.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km` : '--'}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-slate-400">Relative Velocity:</span>
            <span className="text-cyan-300 font-bold">
              {link?.relative_speed_km_s != null ? `${link.relative_speed_km_s.toFixed(3)} km/s` : '--'}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-slate-400">Beacon Angular Rate:</span>
            <span className="text-amber-300 font-bold">
              {link?.angular_rate_deg_s != null ? `${link.angular_rate_deg_s.toFixed(4)} °/s` : '--'}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-slate-400">Atmosphere Path Fraction:</span>
            <span className="text-emerald-400 font-bold">
              {link?.atmosphere_path_frac != null ? `${(link.atmosphere_path_frac * 100).toFixed(1)}% (< 20 km)` : '--'}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-slate-400">Min LOS Earth Clearance:</span>
            <span className={link && link.min_los_clearance_km < 0 ? 'text-rose-400 font-bold' : 'text-slate-200'}>
              {link?.min_los_clearance_km != null ? `${link.min_los_clearance_km.toFixed(1)} km` : '--'}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Camera Body-Frame Angular Angles Card */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3.5 space-y-2 shadow-md">
        <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
          <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider">
            <Compass className="w-4 h-4 text-cyan-400" />
            <span>Camera Body-Frame Angles</span>
          </div>
          <span className="text-[10px] text-slate-500">LVLH / ENU</span>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="bg-slate-950/80 border border-slate-800/80 p-2 rounded text-center">
            <span className="text-slate-400 text-[10px] block mb-0.5">Azimuth (Body X→Y):</span>
            <span className="text-cyan-300 font-bold text-sm">
              {link?.az_body_deg != null ? `${link.az_body_deg.toFixed(3)}°` : '--'}
            </span>
            <span className="text-[9px] text-slate-500 block mt-0.5">HFOV: ±2.0°</span>
          </div>

          <div className="bg-slate-950/80 border border-slate-800/80 p-2 rounded text-center">
            <span className="text-slate-400 text-[10px] block mb-0.5">Elevation (Body Z):</span>
            <span className="text-cyan-300 font-bold text-sm">
              {link?.el_body_deg != null ? `${link.el_body_deg.toFixed(3)}°` : '--'}
            </span>
            <span className="text-[9px] text-slate-500 block mt-0.5">VFOV: ±1.5°</span>
          </div>
        </div>

        <div className="flex justify-between items-center text-[11px] pt-1 border-t border-slate-800/60">
          <span className="text-slate-400">Optical Intensity Scale:</span>
          <span className="text-white font-bold">
            {link?.intensity_fraction != null ? `${(link.intensity_fraction * 100).toFixed(1)}%` : '--'}
          </span>
        </div>
      </div>

      {/* 3. Platform Orbital Dynamics Card */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3.5 space-y-2 shadow-md">
        <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
          <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider">
            <Gauge className="w-4 h-4 text-cyan-400" />
            <span>Platform Orbital Dynamics</span>
          </div>
          <span className="text-[10px] text-slate-500">Keplerian / Kinematic</span>
        </div>

        {/* Camera Platform Metrics */}
        <div className="space-y-1 pt-1">
          <div className="text-[11px] text-cyan-300 font-bold flex items-center justify-between">
            <span>Camera Platform:</span>
            <span>{camera?.altitude_km != null ? `${camera.altitude_km.toFixed(1)} km Alt` : '--'}</span>
          </div>
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Orbital Speed:</span>
            <span className="text-slate-200">{camera?.speed_km_s != null ? `${camera.speed_km_s.toFixed(2)} km/s` : '--'}</span>
          </div>
          {camOrbit && (
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Orbit Period:</span>
              <span className="text-slate-200">{camOrbit.period_s.toFixed(0)} s ({(camOrbit.period_s / 60).toFixed(1)} min)</span>
            </div>
          )}
        </div>

        <div className="border-t border-slate-800/80 pt-2 space-y-1">
          <div className="text-[11px] text-emerald-300 font-bold flex items-center justify-between">
            <span>Beacon Platform:</span>
            <span>{beacon?.altitude_km != null ? `${beacon.altitude_km.toFixed(1)} km Alt` : '--'}</span>
          </div>
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Orbital Speed:</span>
            <span className="text-slate-200">{beacon?.speed_km_s != null ? `${beacon.speed_km_s.toFixed(2)} km/s` : '--'}</span>
          </div>
          {beaconOrbit && (
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Orbit Period:</span>
              <span className="text-slate-200">{beaconOrbit.period_s.toFixed(0)} s ({(beaconOrbit.period_s / 60).toFixed(1)} min)</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
