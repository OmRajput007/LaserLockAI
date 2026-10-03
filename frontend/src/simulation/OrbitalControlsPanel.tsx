import React, { useState, useEffect } from 'react';
import { OrbitalScenarioConfig } from '../types';
import {
  Satellite,
  Plane,
  AlertTriangle,
  Info,
  Clock,
  Layers,
  Settings,
  Compass,
  Sliders,
  CheckCircle2,
} from 'lucide-react';

interface Props {
  config: OrbitalScenarioConfig;
  isRunning: boolean;
  timeWarp: number;
  onApplyConfig: (newConfig: OrbitalScenarioConfig) => void;
  onTimeWarpChange: (warp: number) => void;
  onReset: () => void;
}

export const OrbitalControlsPanel: React.FC<Props> = ({
  config,
  isRunning,
  timeWarp,
  onApplyConfig,
  onTimeWarpChange,
  onReset,
}) => {
  // Preset selector
  const [activePreset, setActivePreset] = useState<string>('UAV below satellite');

  // Form state
  const [cameraType, setCameraType] = useState<'UAV' | 'SATELLITE'>(config.camera_type);
  const [beaconType, setBeaconType] = useState<'UAV' | 'SATELLITE'>(config.beacon_type);

  // Satellite parameters
  const [camSatPreset, setCamSatPreset] = useState<string>(config.camera_sat?.preset || 'LEO-550');
  const [camSatAlt, setCamSatAlt] = useState<number>(config.camera_sat?.altitude_km ?? 550.0);
  const [camSatInc, setCamSatInc] = useState<number>(config.camera_sat?.inclination_deg ?? 53.0);
  const [camSatPhase, setCamSatPhase] = useState<number>(config.camera_sat?.phase_deg ?? 0.0);

  const [beaconSatPreset, setBeaconSatPreset] = useState<string>(config.beacon_sat?.preset || 'LEO-550');
  const [beaconSatAlt, setBeaconSatAlt] = useState<number>(config.beacon_sat?.altitude_km ?? 550.0);
  const [beaconSatInc, setBeaconSatInc] = useState<number>(config.beacon_sat?.inclination_deg ?? 53.0);
  const [beaconSatPhase, setBeaconSatPhase] = useState<number>(config.beacon_sat?.phase_deg ?? 180.0);

  // UAV parameters
  const [camUavLat, setCamUavLat] = useState<number>(config.camera_uav?.lat_deg ?? 28.6);
  const [camUavLon, setCamUavLon] = useState<number>(config.camera_uav?.lon_deg ?? 77.2);
  const [camUavAlt, setCamUavAlt] = useState<number>(config.camera_uav?.altitude_km ?? 10.0);
  const [camUavPattern, setCamUavPattern] = useState<string>(config.camera_uav?.pattern || 'Circular');
  const [camUavRadius, setCamUavRadius] = useState<number>(config.camera_uav?.radius_km ?? 50.0);

  const [beaconUavLat, setBeaconUavLat] = useState<number>(config.beacon_uav?.lat_deg ?? 28.6);
  const [beaconUavLon, setBeaconUavLon] = useState<number>(config.beacon_uav?.lon_deg ?? 77.2);
  const [beaconUavAlt, setBeaconUavAlt] = useState<number>(config.beacon_uav?.altitude_km ?? 10.0);
  const [beaconUavPattern, setBeaconUavPattern] = useState<string>(config.beacon_uav?.pattern || 'Circular');
  const [beaconUavRadius, setBeaconUavRadius] = useState<number>(config.beacon_uav?.radius_km ?? 50.0);

  // Link & Gimbal settings
  const [atmosphereMargin, setAtmosphereMargin] = useState<number>(config.atmosphere_margin_km ?? 100.0);
  const [tiltPreset, setTiltPreset] = useState<'optical' | 'general' | 'custom'>('optical');
  const [tiltLimit, setTiltLimit] = useState<number>(30.0);

  // Maneuver notice banner
  const [showManeuverNotice, setShowManeuverNotice] = useState<boolean>(true);

  // Altitude Gap Error States (20 km < alt < 150 km) - Drag limit is 150 km
  const isCamSatGapError = cameraType === 'SATELLITE' && camSatAlt > 20.0 && camSatAlt < 150.0;
  const isBeaconSatGapError = beaconType === 'SATELLITE' && beaconSatAlt > 20.0 && beaconSatAlt < 150.0;
  const isCamUavAltError = cameraType === 'UAV' && (camUavAlt < 0 || camUavAlt > 20.0);
  const isBeaconUavAltError = beaconType === 'UAV' && (beaconUavAlt < 0 || beaconUavAlt > 20.0);
  const hasValidationError = isCamSatGapError || isBeaconSatGapError || isCamUavAltError || isBeaconUavAltError;

  // Orbit preset options dictionary
  const altitudePresets: Record<string, number> = {
    'LEO-300': 300.0,
    'LEO-550': 550.0,
    'LEO-2000': 2000.0,
    'MEO': 20200.0,
    'GEO': 35786.0,
    'GTO': 17993.0,
  };

  // Handle Preset Switching
  const handleSelectScenarioPreset = (presetName: string) => {
    setActivePreset(presetName);
    setShowManeuverNotice(true);

    if (presetName === 'UAV below satellite') {
      setCameraType('SATELLITE');
      setCamSatPreset('LEO-550');
      setCamSatAlt(550.0);
      setCamSatInc(53.0);
      setCamSatPhase(0.0);

      setBeaconType('UAV');
      setBeaconUavLat(28.6);
      setBeaconUavLon(77.2);
      setBeaconUavAlt(10.0);
      setBeaconUavPattern('Circular');
      setBeaconUavRadius(50.0);

      triggerApply({
        camera_type: 'SATELLITE',
        beacon_type: 'UAV',
        camera_sat: { preset: 'LEO-550', altitude_km: 550.0, inclination_deg: 53.0, phase_deg: 0.0, raan_deg: 0.0 },
        camera_uav: { lat_deg: 28.6, lon_deg: 77.2, altitude_km: 10.0, pattern: 'Circular', radius_km: 50.0, speed_km_s: 0.25, phase_deg: 0.0 },
        beacon_sat: { preset: 'LEO-550', altitude_km: 550.0, inclination_deg: 53.0, phase_deg: 180.0, raan_deg: 0.0 },
        beacon_uav: { lat_deg: 28.6, lon_deg: 77.2, altitude_km: 10.0, pattern: 'Circular', radius_km: 50.0, speed_km_s: 0.25, phase_deg: 0.0 },
        atmosphere_margin_km: atmosphereMargin,
        tilt_limit_deg: tiltLimit,
      });
    } else if (presetName === 'LEO to LEO crossing') {
      setCameraType('SATELLITE');
      setCamSatPreset('LEO-550');
      setCamSatAlt(550.0);
      setCamSatInc(53.0);
      setCamSatPhase(0.0);

      setBeaconType('SATELLITE');
      setBeaconSatPreset('LEO-550');
      setBeaconSatAlt(550.0);
      setBeaconSatInc(97.0);
      setBeaconSatPhase(5.0);

      triggerApply({
        camera_type: 'SATELLITE',
        beacon_type: 'SATELLITE',
        camera_sat: { preset: 'LEO-550', altitude_km: 550.0, inclination_deg: 53.0, phase_deg: 0.0, raan_deg: 0.0 },
        camera_uav: { lat_deg: 28.6, lon_deg: 77.2, altitude_km: 10.0, pattern: 'Circular', radius_km: 50.0, speed_km_s: 0.25, phase_deg: 0.0 },
        beacon_sat: { preset: 'LEO-550', altitude_km: 550.0, inclination_deg: 97.0, phase_deg: 5.0, raan_deg: 90.0 },
        beacon_uav: { lat_deg: 28.6, lon_deg: 77.2, altitude_km: 10.0, pattern: 'Circular', radius_km: 50.0, speed_km_s: 0.25, phase_deg: 0.0 },
        atmosphere_margin_km: atmosphereMargin,
        tilt_limit_deg: tiltLimit,
      });
    } else if (presetName === 'LEO to GEO') {
      setCameraType('SATELLITE');
      setCamSatPreset('LEO-550');
      setCamSatAlt(550.0);
      setCamSatInc(53.0);
      setCamSatPhase(0.0);

      setBeaconType('SATELLITE');
      setBeaconSatPreset('GEO');
      setBeaconSatAlt(35786.0);
      setBeaconSatInc(0.0);
      setBeaconSatPhase(0.0);

      triggerApply({
        camera_type: 'SATELLITE',
        beacon_type: 'SATELLITE',
        camera_sat: { preset: 'LEO-550', altitude_km: 550.0, inclination_deg: 53.0, phase_deg: 0.0, raan_deg: 0.0 },
        camera_uav: { lat_deg: 28.6, lon_deg: 77.2, altitude_km: 10.0, pattern: 'Circular', radius_km: 50.0, speed_km_s: 0.25, phase_deg: 0.0 },
        beacon_sat: { preset: 'GEO', altitude_km: 35786.0, inclination_deg: 0.0, phase_deg: 0.0, raan_deg: 0.0 },
        beacon_uav: { lat_deg: 28.6, lon_deg: 77.2, altitude_km: 10.0, pattern: 'Circular', radius_km: 50.0, speed_km_s: 0.25, phase_deg: 0.0 },
        atmosphere_margin_km: atmosphereMargin,
        tilt_limit_deg: tiltLimit,
      });
    } else if (presetName === 'GEO to LEO') {
      setCameraType('SATELLITE');
      setCamSatPreset('GEO');
      setCamSatAlt(35786.0);
      setCamSatInc(0.0);
      setCamSatPhase(0.0);

      setBeaconType('SATELLITE');
      setBeaconSatPreset('LEO-550');
      setBeaconSatAlt(550.0);
      setBeaconSatInc(53.0);
      setBeaconSatPhase(0.0);

      triggerApply({
        camera_type: 'SATELLITE',
        beacon_type: 'SATELLITE',
        camera_sat: { preset: 'GEO', altitude_km: 35786.0, inclination_deg: 0.0, phase_deg: 0.0, raan_deg: 0.0 },
        camera_uav: { lat_deg: 28.6, lon_deg: 77.2, altitude_km: 10.0, pattern: 'Circular', radius_km: 50.0, speed_km_s: 0.25, phase_deg: 0.0 },
        beacon_sat: { preset: 'LEO-550', altitude_km: 550.0, inclination_deg: 53.0, phase_deg: 0.0, raan_deg: 0.0 },
        beacon_uav: { lat_deg: 28.6, lon_deg: 77.2, altitude_km: 10.0, pattern: 'Circular', radius_km: 50.0, speed_km_s: 0.25, phase_deg: 0.0 },
        atmosphere_margin_km: atmosphereMargin,
        tilt_limit_deg: tiltLimit,
      });
    }
  };

  const triggerApply = (cfg: OrbitalScenarioConfig) => {
    onApplyConfig(cfg);
  };

  const handleManualApply = () => {
    if (hasValidationError) return;
    setShowManeuverNotice(true);
    triggerApply({
      camera_type: cameraType,
      beacon_type: beaconType,
      camera_sat: {
        preset: camSatPreset,
        altitude_km: camSatAlt,
        inclination_deg: camSatInc,
        phase_deg: camSatPhase,
        raan_deg: 0.0,
      },
      camera_uav: {
        lat_deg: camUavLat,
        lon_deg: camUavLon,
        altitude_km: camUavAlt,
        pattern: camUavPattern,
        radius_km: camUavRadius,
        speed_km_s: 0.25,
        phase_deg: 0.0,
      },
      beacon_sat: {
        preset: beaconSatPreset,
        altitude_km: beaconSatAlt,
        inclination_deg: beaconSatInc,
        phase_deg: beaconSatPhase,
        raan_deg: 0.0,
      },
      beacon_uav: {
        lat_deg: beaconUavLat,
        lon_deg: beaconUavLon,
        altitude_km: beaconUavAlt,
        pattern: beaconUavPattern,
        radius_km: beaconUavRadius,
        speed_km_s: 0.25,
        phase_deg: 0.0,
      },
      atmosphere_margin_km: atmosphereMargin,
      tilt_limit_deg: tiltLimit,
    });
  };

  const handleCamSatPresetChange = (preset: string) => {
    setCamSatPreset(preset);
    if (altitudePresets[preset]) {
      setCamSatAlt(altitudePresets[preset]);
    }
  };

  const handleBeaconSatPresetChange = (preset: string) => {
    setBeaconSatPreset(preset);
    if (altitudePresets[preset]) {
      setBeaconSatAlt(altitudePresets[preset]);
    }
  };

  const handleTiltPresetChange = (preset: 'optical' | 'general' | 'custom') => {
    setTiltPreset(preset);
    if (preset === 'optical') {
      setTiltLimit(30.0);
    } else if (preset === 'general') {
      setTiltLimit(85.0);
    }
  };

  return (
    <div className="flex flex-col gap-3 font-mono text-xs select-none text-[#F0FFEA]">
      {/* 1. Predefined Scenarios Strip */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#FF5F40]" />
          <span className="text-[#9CA195] font-bold uppercase tracking-wider text-[11px]">
            Orbital Scenarios:
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {['UAV below satellite', 'LEO to LEO crossing', 'LEO to GEO', 'GEO to LEO'].map((p) => (
            <button
              key={p}
              onClick={() => handleSelectScenarioPreset(p)}
              className={`px-3 py-1.5 rounded text-[11px] font-mono border transition ${
                activePreset === p
                  ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] font-semibold'
                  : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA] hover:border-[#FF5F40]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Time Control Bar */}
        <div className="flex items-center gap-2 bg-[#262824] border border-[#33362F] px-2.5 py-1 rounded">
          <div className="flex items-center gap-1.5 text-[#9CA195] text-[11px]">
            <Clock className="w-3.5 h-3.5 text-[#FF5F40]" />
            <span>Time-Warp:</span>
          </div>

          <div className="flex items-center gap-1">
            {[1, 10, 60].map((w) => {
              const isDisabled = isRunning;
              return (
                <button
                  key={w}
                  disabled={isDisabled}
                  onClick={() => onTimeWarpChange(w)}
                  title={
                    isDisabled
                      ? 'Time-warp locked to 1x during active tracking: at 60x a 0.82 deg/s beacon appears at ~49 deg/s, beyond any realistic gimbal.'
                      : `Set time-warp to ${w}x for preview`
                  }
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition ${
                    timeWarp === w
                      ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40]'
                      : isDisabled
                      ? 'bg-[#1B1D1A] text-[#5E625A] border-[#33362F] cursor-not-allowed'
                      : 'bg-[#1B1D1A] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
                  }`}
                >
                  {w}x
                </button>
              );
            })}
          </div>

          {isRunning && (
            <span
              className="text-[10px] text-[#FF5F40] underline decoration-dotted cursor-help ml-1 font-mono"
              title="Time-warp locked to 1x during active tracking: at 60x a 0.82 deg/s beacon appears at ~49 deg/s, beyond any realistic gimbal."
            >
              Locked (1x)
            </span>
          )}
        </div>
      </div>

      {/* Maneuver Note Banner */}
      {showManeuverNotice && (
        <div className="bg-[#1B1D1A] border border-[#33362F] p-2.5 rounded-lg flex items-start justify-between gap-3 text-[11px]">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-[#FF5F40] flex-shrink-0 mt-0.5" />
            <p className="text-[#9CA195] leading-snug">
              <strong className="text-[#F0FFEA]">Physics Maneuver Note:</strong> Orbit switching re-initializes the scenario parameters; it is not a live maneuver. A real LEO-550 → GEO transfer requires ~3.8 km/s Δv and ~5.3 h. This simulation re-initializes directly to the selected orbit.
            </p>
          </div>
          <button
            onClick={() => setShowManeuverNotice(false)}
            className="text-[#9CA195] hover:text-[#F0FFEA] text-xs px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Validation Warning Alert (20-150 km Altitude Gap) */}
      {(isCamSatGapError || isBeaconSatGapError) && (
        <div className="bg-[#1B1D1A] border border-[#FF5F40] p-3 rounded-lg flex items-start gap-2.5 text-[#FF5F40] text-[11px] shadow-lg animate-pulse">
          <AlertTriangle className="w-4 h-4 text-[#FF5F40] flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-[#FF5F40] block mb-0.5">! UNSTABLE ALTITUDE GAP DETECTED (20 - 150 KM):</span>
            Altitudes between 20 km and 150 km are physically unstable: too high for aerodynamic UAV flight (max 20 km ceiling) and too low for satellite orbits without immediate atmospheric drag decay (min stable orbit is 150 km). Entry is rejected.
          </div>
        </div>
      )}

      {/* 2. Platform Parameter Grids */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Camera Platform Card */}
        <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between border-b border-[#33362F] pb-2">
            <div className="flex items-center gap-2 text-[#FF5F40] font-bold uppercase tracking-wider">
              {cameraType === 'SATELLITE' ? <Satellite className="w-4 h-4" /> : <Plane className="w-4 h-4" />}
              <span>Camera Platform</span>
            </div>

            {/* Platform Type Selector */}
            <div className="flex items-center gap-1 bg-[#262824] p-0.5 rounded border border-[#33362F]">
              <button
                onClick={() => setCameraType('SATELLITE')}
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition ${
                  cameraType === 'SATELLITE' ? 'bg-[#FF5F40] text-[#0A0A0A]' : 'text-[#9CA195] hover:text-[#F0FFEA]'
                }`}
              >
                Satellite
              </button>
              <button
                onClick={() => setCameraType('UAV')}
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition ${
                  cameraType === 'UAV' ? 'bg-[#FF5F40] text-[#0A0A0A]' : 'text-[#9CA195] hover:text-[#F0FFEA]'
                }`}
              >
                UAV
              </button>
            </div>
          </div>

          {cameraType === 'SATELLITE' ? (
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Orbit Preset:</label>
                <select
                  value={camSatPreset}
                  onChange={(e) => handleCamSatPresetChange(e.target.value)}
                  className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                >
                  <option value="LEO-300">LEO 300 km</option>
                  <option value="LEO-550">LEO 550 km (Nominal)</option>
                  <option value="LEO-2000">LEO 2000 km</option>
                  <option value="MEO">MEO 20200 km (GPS)</option>
                  <option value="GEO">GEO 35786 km</option>
                  <option value="GTO">GTO (200 × 35,786 km Demo)</option>
                  <option value="Custom">Custom Altitude</option>
                </select>
              </div>

              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Altitude (km):</label>
                <input
                  type="number"
                  value={camSatAlt}
                  onChange={(e) => {
                    setCamSatAlt(parseFloat(e.target.value) || 0);
                    setCamSatPreset('Custom');
                  }}
                  className={`w-full bg-[#262824] border rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none ${
                    isCamSatGapError ? 'border-[#FF5F40] bg-[#FF5F40]/10 text-[#FF5F40]' : 'border-[#33362F] focus:border-[#FF5F40]'
                  }`}
                />
              </div>

              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Inclination (°):</label>
                <input
                  type="number"
                  value={camSatInc}
                  onChange={(e) => setCamSatInc(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                />
              </div>

              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Phase Angle (°):</label>
                <input
                  type="number"
                  value={camSatPhase}
                  onChange={(e) => setCamSatPhase(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Ground Lat (°):</label>
                <input
                  type="number"
                  value={camUavLat}
                  onChange={(e) => setCamUavLat(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                />
              </div>

              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Ground Lon (°):</label>
                <input
                  type="number"
                  value={camUavLon}
                  onChange={(e) => setCamUavLon(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                />
              </div>

              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Altitude (0-20 km):</label>
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={camUavAlt}
                  onChange={(e) => setCamUavAlt(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                />
              </div>

              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Pattern:</label>
                <select
                  value={camUavPattern}
                  onChange={(e) => setCamUavPattern(e.target.value)}
                  className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                >
                  <option value="Circular">Circular</option>
                  <option value="Straight Line">Straight Line</option>
                  <option value="Stationary">Stationary</option>
                </select>
              </div>

              {camUavPattern === 'Circular' && (
                <div className="col-span-2">
                  <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Circular Radius (km):</label>
                  <input
                    type="number"
                    value={camUavRadius}
                    onChange={(e) => setCamUavRadius(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Beacon Platform Card */}
        <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between border-b border-[#33362F] pb-2">
            <div className="flex items-center gap-2 text-[#F0FFEA] font-bold uppercase tracking-wider">
              {beaconType === 'SATELLITE' ? <Satellite className="w-4 h-4 text-[#FF5F40]" /> : <Plane className="w-4 h-4 text-[#FF5F40]" />}
              <span>Beacon Platform</span>
            </div>

            {/* Platform Type Selector */}
            <div className="flex items-center gap-1 bg-[#262824] p-0.5 rounded border border-[#33362F]">
              <button
                onClick={() => setBeaconType('SATELLITE')}
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition ${
                  beaconType === 'SATELLITE' ? 'bg-[#FF5F40] text-[#0A0A0A]' : 'text-[#9CA195] hover:text-[#F0FFEA]'
                }`}
              >
                Satellite
              </button>
              <button
                onClick={() => setBeaconType('UAV')}
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition ${
                  beaconType === 'UAV' ? 'bg-[#FF5F40] text-[#0A0A0A]' : 'text-[#9CA195] hover:text-[#F0FFEA]'
                }`}
              >
                UAV
              </button>
            </div>
          </div>

          {beaconType === 'SATELLITE' ? (
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Orbit Preset:</label>
                <select
                  value={beaconSatPreset}
                  onChange={(e) => handleBeaconSatPresetChange(e.target.value)}
                  className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                >
                  <option value="LEO-300">LEO 300 km</option>
                  <option value="LEO-550">LEO 550 km (Nominal)</option>
                  <option value="LEO-2000">LEO 2000 km</option>
                  <option value="MEO">MEO 20200 km (GPS)</option>
                  <option value="GEO">GEO 35786 km</option>
                  <option value="GTO">GTO (200 × 35,786 km Demo)</option>
                  <option value="Custom">Custom Altitude</option>
                </select>
              </div>

              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Altitude (km):</label>
                <input
                  type="number"
                  value={beaconSatAlt}
                  onChange={(e) => {
                    setBeaconSatAlt(parseFloat(e.target.value) || 0);
                    setBeaconSatPreset('Custom');
                  }}
                  className={`w-full bg-[#262824] border rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none ${
                    isBeaconSatGapError ? 'border-[#FF5F40] bg-[#FF5F40]/10 text-[#FF5F40]' : 'border-[#33362F] focus:border-[#FF5F40]'
                  }`}
                />
              </div>

              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Inclination (°):</label>
                <input
                  type="number"
                  value={beaconSatInc}
                  onChange={(e) => setBeaconSatInc(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                />
              </div>

              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Phase Angle (°):</label>
                <input
                  type="number"
                  value={beaconSatPhase}
                  onChange={(e) => setBeaconSatPhase(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Ground Lat (°):</label>
                <input
                  type="number"
                  value={beaconUavLat}
                  onChange={(e) => setBeaconUavLat(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                />
              </div>

              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Ground Lon (°):</label>
                <input
                  type="number"
                  value={beaconUavLon}
                  onChange={(e) => setBeaconUavLon(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                />
              </div>

              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Altitude (0-20 km):</label>
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={beaconUavAlt}
                  onChange={(e) => setBeaconUavAlt(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                />
              </div>

              <div>
                <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Pattern:</label>
                <select
                  value={beaconUavPattern}
                  onChange={(e) => setBeaconUavPattern(e.target.value)}
                  className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                >
                  <option value="Circular">Circular</option>
                  <option value="Straight Line">Straight Line</option>
                  <option value="Stationary">Stationary</option>
                </select>
              </div>

              {beaconUavPattern === 'Circular' && (
                <div className="col-span-2">
                  <label className="text-[#9CA195] text-[10px] block mb-1 uppercase tracking-wider">Circular Radius (km):</label>
                  <input
                    type="number"
                    value={beaconUavRadius}
                    onChange={(e) => setBeaconUavRadius(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3. Optical Terminal & Gimbal Limits Strip */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Atmosphere Margin */}
          <div className="flex items-center gap-2">
            <span className="text-[#9CA195] text-[11px] font-bold uppercase tracking-wider">Atmosphere Margin:</span>
            <input
              type="number"
              min="0"
              max="500"
              value={atmosphereMargin}
              onChange={(e) => setAtmosphereMargin(parseFloat(e.target.value) || 100.0)}
              className="w-20 bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded px-2 py-1 text-[#F0FFEA] text-xs font-mono outline-none"
            />
            <span className="text-[#5E625A] text-[10px]">km (default 100 km)</span>
          </div>

          {/* Gimbal Pan Limit */}
          <div className="flex items-center gap-2">
            <span className="text-[#9CA195] text-[11px] font-bold uppercase tracking-wider">Pan Limits:</span>
            <span className="text-[#FF5F40] font-bold font-mono">±180°</span>
          </div>

          {/* Gimbal Tilt Limit Presets */}
          <div className="flex items-center gap-2">
            <span className="text-[#9CA195] text-[11px] font-bold uppercase tracking-wider">Tilt Limits:</span>
            <button
              onClick={() => handleTiltPresetChange('optical')}
              className={`px-2 py-1 rounded text-[10px] font-mono border transition ${
                tiltPreset === 'optical'
                  ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] font-semibold'
                  : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA] hover:border-[#FF5F40]'
              }`}
            >
              Optical Terminal (±30°)
            </button>
            <button
              onClick={() => handleTiltPresetChange('general')}
              className={`px-2 py-1 rounded text-[10px] font-mono border transition ${
                tiltPreset === 'general'
                  ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] font-semibold'
                  : 'bg-[#262824] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA] hover:border-[#FF5F40]'
              }`}
            >
              General Camera (±85°)
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            className="px-3 py-1.5 rounded bg-[#262824] hover:bg-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40] transition font-mono font-bold text-xs"
          >
            RESET ORBIT
          </button>
          <button
            disabled={hasValidationError}
            onClick={handleManualApply}
            className={`px-4 py-1.5 rounded font-mono font-bold transition text-xs flex items-center gap-1.5 ${
              hasValidationError
                ? 'bg-[#262824] text-[#5E625A] border border-[#33362F] cursor-not-allowed'
                : 'bg-[#FF5F40] hover:bg-[#FF7459] active:bg-[#E5492B] text-[#0A0A0A] shadow-md cursor-pointer'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            APPLY SCENARIO
          </button>
        </div>
      </div>
    </div>
  );
};
