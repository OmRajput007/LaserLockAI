import React, { useState } from 'react';
import {
  CloudRain,
  Wind,
  AlertTriangle,
  Sliders,
  Activity,
  Zap,
  EyeOff,
  Eye,
  Sun,
  Moon,
  CloudFog,
  Umbrella,
  ShieldAlert,
  Compass,
  Layers,
  Sparkles,
  TrendingDown,
  RefreshCw,
  Play,
  RotateCcw,
} from 'lucide-react';
import { SystemConfig, SimulationTelemetry, DisturbanceConfig } from '../types';
import { api } from '../services/api';

interface Props {
  config: SystemConfig | null;
  telemetry?: SimulationTelemetry | null;
  onUpdateConfig: (updater: (prev: SystemConfig) => SystemConfig) => void;
}

export const DisturbancesPage: React.FC<Props> = ({ config, telemetry, onUpdateConfig }) => {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const distCfg = config?.disturbance;
  const distTelem = telemetry?.disturbance;
  const detTelem = telemetry?.detection;
  const trackTelem = telemetry?.tracking;

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleApplyPreset = async (
    preset:
      | 'Normal'
      | 'High Noise'
      | 'High Jitter'
      | 'Haze'
      | 'Fog'
      | 'Rain'
      | 'Low Light'
      | 'Fast Motion'
      | 'Combined Disturbance'
  ) => {
    try {
      setIsApplying(true);
      const res = await api.applyDisturbancePreset(preset);
      if (res && res.config) {
        onUpdateConfig((prev) => ({
          ...prev,
          disturbance: { ...prev.disturbance, ...res.config },
        }));
      }
      showFeedback(`Benchmark Scenario [${preset.toUpperCase()}] applied successfully!`);
    } catch (e: any) {
      showFeedback(`Failed to apply preset: ${e.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleUpdateDisturbance = async (updates: Partial<DisturbanceConfig>) => {
    try {
      await api.updateDisturbanceConfig(updates);
      onUpdateConfig((prev) => ({
        ...prev,
        disturbance: { ...prev.disturbance, ...updates },
      }));
    } catch (e: any) {
      console.error('Failed to update disturbance:', e);
    }
  };

  const handleTriggerOcclusion = async () => {
    try {
      const res = await api.triggerOcclusion(distCfg?.occlusion_duration_s ?? 1.5);
      showFeedback(`Optical Line-of-Sight Occlusion triggered for ${res.duration_s}s!`);
    } catch (e: any) {
      showFeedback(`Failed to trigger occlusion: ${e.message}`);
    }
  };

  // Atmospheric conditions styling
  const atmoMeta: Record<string, { icon: any; color: string; desc: string; trans: string }> = {
    Clear: {
      icon: Sun,
      color: 'text-amber-400',
      desc: 'Nominal baseline optical visibility (beta ~ 0.05 /km)',
      trans: '95% Transmission',
    },
    Haze: {
      icon: Wind,
      color: 'text-yellow-400',
      desc: 'Moderate aerosol scattering & contrast attenuation (beta ~ 0.45 /km)',
      trans: '64% Transmission',
    },
    Fog: {
      icon: CloudFog,
      color: 'text-slate-300',
      desc: 'Heavy Mie particulate scattering & diffuse path radiance wash (beta ~ 1.85 /km)',
      trans: '16% Transmission',
    },
    Rain: {
      icon: Umbrella,
      color: 'text-cyan-400',
      desc: 'Falling precipitation streaks & dynamic optical scattering (Marshall-Palmer)',
      trans: '42% Transmission',
    },
    'Low Light': {
      icon: Moon,
      color: 'text-indigo-400',
      desc: 'Low ambient illumination, photon shot noise dominance, reduced SNR',
      trans: '90% Transmission (Dimmed)',
    },
  };

  const currentAtmo = atmoMeta[distCfg?.atmospheric_condition || 'Clear'] || atmoMeta.Clear;
  const AtmoIcon = currentAtmo.icon;

  return (
    <div className="flex flex-col gap-5 font-mono text-xs">
      {/* Top Banner: Disturbance and Noise Engine */}
      <div className="bg-[#0b0f19] border border-slate-800 p-4 rounded-lg flex flex-wrap items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-700/60">
            <ShieldAlert className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Part 6: Disturbance and Noise Engine
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-rose-900/60 border border-rose-700 text-rose-300">
                ACTIVE PHYSICAL PERTURBATIONS
              </span>
            </div>
            <p className="text-slate-400 text-[11px] mt-0.5">
              Multi-Noise (Salt&Pepper, Gaussian, Poisson), Jitter (±20 px), Atmosphere, Platform Motion (±20 px), Blur & Occlusion
            </p>
          </div>
        </div>

        {/* Live Atmosphere & Occlusion Badges */}
        <div className="flex items-center gap-3">
          <div className="px-3.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center gap-2">
            <AtmoIcon className={`w-4 h-4 ${currentAtmo.color}`} />
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Atmosphere</div>
              <div className="font-bold text-white">{distCfg?.atmospheric_condition || 'Clear'}</div>
            </div>
          </div>

          <div
            className={`px-3.5 py-1.5 rounded-lg border flex items-center gap-2 ${
              distTelem?.is_occluded
                ? 'bg-rose-950/90 border-rose-600 text-rose-300'
                : 'bg-slate-950 border-slate-800 text-slate-300'
            }`}
          >
            {distTelem?.is_occluded ? <EyeOff className="w-4 h-4 text-rose-400 animate-pulse" /> : <Eye className="w-4 h-4 text-emerald-400" />}
            <div>
              <div className="text-[10px] text-slate-500 uppercase">LOS Beam Path</div>
              <div className="font-bold">
                {distTelem?.is_occluded ? `OCCLUDED (${distTelem.occlusion_remaining_s.toFixed(1)}s)` : 'CLEAR TRANSMISSION'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {feedback && (
        <div className="p-2.5 rounded bg-cyan-950/90 border border-cyan-600 text-cyan-200 text-xs font-semibold flex items-center justify-between">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Benchmark Test Scenarios (One-Click Presets) */}
      <div className="bg-[#0b0f19] border border-slate-800 p-4 rounded-lg shadow-lg space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-[11px]">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>Benchmark Evaluation Test Scenarios (One-Click Testing)</span>
          </div>
          <span className="text-[10px] text-slate-400 font-normal">
            Active: <strong className="text-white">{distCfg?.preset_scenario || 'Normal'}</strong>
          </span>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
          {[
            { id: 'Normal', label: 'Normal', icon: Sun, color: 'text-emerald-400' },
            { id: 'High Noise', label: 'High Noise', icon: AlertTriangle, color: 'text-yellow-400' },
            { id: 'High Jitter', label: 'High Jitter', icon: Activity, color: 'text-pink-400' },
            { id: 'Haze', label: 'Haze', icon: Wind, color: 'text-amber-400' },
            { id: 'Fog', label: 'Fog', icon: CloudFog, color: 'text-slate-300' },
            { id: 'Rain', label: 'Rain', icon: Umbrella, color: 'text-cyan-400' },
            { id: 'Low Light', label: 'Low Light', icon: Moon, color: 'text-indigo-400' },
            { id: 'Fast Motion', label: 'Fast Motion', icon: Zap, color: 'text-purple-400' },
            { id: 'Combined Disturbance', label: 'Combined', icon: ShieldAlert, color: 'text-rose-400' },
          ].map((sc) => {
            const SIcon = sc.icon;
            const active = distCfg?.preset_scenario === sc.id;
            return (
              <button
                key={sc.id}
                onClick={() => handleApplyPreset(sc.id as any)}
                disabled={isApplying}
                className={`p-2.5 rounded-lg border flex flex-col items-center justify-center gap-1.5 transition text-center ${
                  active
                    ? 'bg-cyan-950 border-cyan-500 text-white font-bold shadow-md'
                    : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <SIcon className={`w-4 h-4 ${active ? sc.color : 'text-slate-500'}`} />
                <span className="text-[10px] truncate">{sc.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ========================================================================= */}
        {/* COLUMN 1: MULTI-NOISE ENGINE & SENSOR READOUT                             */}
        {/* ========================================================================= */}
        <div className="bg-[#0b0f19] border border-slate-800 rounded-lg p-5 flex flex-col gap-4 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h3 className="text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-cyan-400" />
              Multi-Noise Engine
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
              Max σ ≤ 20 px
            </span>
          </div>

          {/* Simultaneous Noise Checkboxes */}
          <div className="space-y-2">
            <span className="text-slate-400 text-[11px] font-semibold">Active Noise Models (Simultaneous):</span>
            <div className="space-y-1.5">
              <label className="flex items-center justify-between p-2.5 rounded bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition">
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={distCfg?.gaussian_noise_enabled ?? false}
                    onChange={(e) => handleUpdateDisturbance({ gaussian_noise_enabled: e.target.checked })}
                    className="accent-cyan-500"
                  />
                  <span className="font-bold text-white">Gaussian Readout Noise</span>
                </div>
                <span className="text-[10px] text-slate-400">Normal Dist (N ~ 0, σ²)</span>
              </label>

              <label className="flex items-center justify-between p-2.5 rounded bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition">
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={distCfg?.salt_pepper_enabled ?? false}
                    onChange={(e) => handleUpdateDisturbance({ salt_pepper_enabled: e.target.checked })}
                    className="accent-cyan-500"
                  />
                  <span className="font-bold text-white">Salt & Pepper Noise</span>
                </div>
                <span className="text-[10px] text-slate-400">Impulsive Bit Corruption</span>
              </label>

              <label className="flex items-center justify-between p-2.5 rounded bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition">
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={distCfg?.poisson_noise_enabled ?? false}
                    onChange={(e) => handleUpdateDisturbance({ poisson_noise_enabled: e.target.checked })}
                    className="accent-cyan-500"
                  />
                  <span className="font-bold text-white">Poisson Photon Shot Noise</span>
                </div>
                <span className="text-[10px] text-slate-400">Quantum Shot Statistics</span>
              </label>
            </div>
          </div>

          {/* Noise Standard Deviation Slider (Max 20 px) */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-slate-300">Gaussian Noise Std Dev (σ):</span>
              <span className="text-cyan-300 font-bold">{distCfg?.noise_std_dev ?? 5.0} px (Limit ≤ 20)</span>
            </div>
            <input
              type="range"
              min="0"
              max="20"
              step="0.5"
              value={distCfg?.noise_std_dev ?? 5.0}
              onChange={(e) => handleUpdateDisturbance({ noise_std_dev: parseFloat(e.target.value) })}
              className="w-full accent-cyan-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>0.0 px (Clean)</span>
              <span>10.0 px</span>
              <span className="text-rose-400 font-bold">20.0 px (Severe)</span>
            </div>
          </div>

          {/* Salt & Pepper Ratio Slider */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-slate-300">Salt & Pepper Density:</span>
              <span className="text-cyan-300 font-bold">{((distCfg?.salt_pepper_ratio ?? 0.02) * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0.00"
              max="0.15"
              step="0.005"
              value={distCfg?.salt_pepper_ratio ?? 0.02}
              onChange={(e) => handleUpdateDisturbance({ salt_pepper_ratio: parseFloat(e.target.value) })}
              className="w-full accent-cyan-500 cursor-pointer"
            />
          </div>

          {/* Forced SNR Reduction */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-slate-300">Forced SNR Attenuation:</span>
              <span className="text-amber-400 font-bold">{distCfg?.snr_reduction_db ?? 0.0} dB</span>
            </div>
            <input
              type="range"
              min="0"
              max="25"
              step="1"
              value={distCfg?.snr_reduction_db ?? 0.0}
              onChange={(e) => handleUpdateDisturbance({ snr_reduction_db: parseFloat(e.target.value) })}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>
        </div>

        {/* ========================================================================= */}
        {/* COLUMN 2: CAMERA JITTER & PLATFORM MOTION                                 */}
        {/* ========================================================================= */}
        <div className="bg-[#0b0f19] border border-slate-800 rounded-lg p-5 flex flex-col gap-4 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h3 className="text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              Camera Jitter & Platform Motion
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
              Max ±20 px/frame
            </span>
          </div>

          {/* Camera Jitter (High-Frequency Mechanical Vibration) */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={distCfg?.camera_jitter_enabled ?? false}
                  onChange={(e) => handleUpdateDisturbance({ camera_jitter_enabled: e.target.checked })}
                  className="accent-cyan-500"
                />
                <span className="text-cyan-300 font-bold uppercase text-[11px]">High-Frequency Camera Jitter</span>
              </label>
              <span className="text-[10px] text-slate-400 font-mono">
                Offset: ({distTelem?.jitter_offset_x_px?.toFixed(1) ?? '0.0'}, {distTelem?.jitter_offset_y_px?.toFixed(1) ?? '0.0'}) px
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Jitter Amplitude:</span>
                <span className="text-white font-bold font-mono">±{distCfg?.camera_jitter_max_px ?? 0} px/frame (Max ±20)</span>
              </div>
              <input
                type="range"
                min="0"
                max="20"
                step="1"
                value={distCfg?.camera_jitter_max_px ?? 0}
                onChange={(e) => handleUpdateDisturbance({ camera_jitter_max_px: parseFloat(e.target.value) })}
                className="w-full accent-cyan-500 cursor-pointer"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Vibration Frequency:</span>
                <span className="text-cyan-300 font-bold font-mono">{distCfg?.camera_jitter_frequency_hz ?? 15.0} Hz</span>
              </div>
              <input
                type="range"
                min="1"
                max="60"
                step="1"
                value={distCfg?.camera_jitter_frequency_hz ?? 15.0}
                onChange={(e) => handleUpdateDisturbance({ camera_jitter_frequency_hz: parseFloat(e.target.value) })}
                className="w-full accent-cyan-500 cursor-pointer"
              />
            </div>
          </div>

          {/* Platform Motion (Mobile Terminal Base Kinematics) */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={distCfg?.platform_motion_enabled ?? false}
                  onChange={(e) => handleUpdateDisturbance({ platform_motion_enabled: e.target.checked })}
                  className="accent-cyan-500"
                />
                <span className="text-cyan-300 font-bold uppercase text-[11px]">Mobile Platform Motion</span>
              </label>
              <span className="text-[10px] text-slate-400 font-mono">
                Offset: ({distTelem?.platform_offset_x_px?.toFixed(1) ?? '0.0'}, {distTelem?.platform_offset_y_px?.toFixed(1) ?? '0.0'}) px
              </span>
            </div>

            <div>
              <span className="text-slate-400 text-[10px]">Trajectory Pattern:</span>
              <div className="grid grid-cols-3 gap-1.5 mt-1">
                {(['Linear', 'Sinusoidal', 'Circular', 'Figure of 8', 'Spiral', 'Random'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => handleUpdateDisturbance({ platform_motion_type: m })}
                    className={`p-1.5 rounded text-[10px] font-bold border transition ${
                      distCfg?.platform_motion_type === m
                        ? 'bg-purple-950 text-purple-300 border-purple-500'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Motion Amplitude:</span>
                <span className="text-white font-bold font-mono">±{distCfg?.platform_motion_max_px ?? 0} px/frame (Max ±20)</span>
              </div>
              <input
                type="range"
                min="0"
                max="20"
                step="1"
                value={distCfg?.platform_motion_max_px ?? 0}
                onChange={(e) => handleUpdateDisturbance({ platform_motion_max_px: parseFloat(e.target.value) })}
                className="w-full accent-cyan-500 cursor-pointer"
              />
            </div>
          </div>

          {/* Sudden Camera Shock / Wind Gust */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2 text-[11px]">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={distCfg?.sudden_camera_movement_enabled ?? false}
                  onChange={(e) => handleUpdateDisturbance({ sudden_camera_movement_enabled: e.target.checked })}
                  className="accent-cyan-500"
                />
                <span className="text-slate-300 font-bold">Sudden Wind Shock / Impulses</span>
              </label>
              <span className="text-rose-400 font-mono">±{distCfg?.sudden_movement_max_px ?? 12} px</span>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* COLUMN 3: ATMOSPHERE, BLUR, OCCLUSION & TRACKING HEALTH                   */}
        {/* ========================================================================= */}
        <div className="bg-[#0b0f19] border border-slate-800 rounded-lg p-5 flex flex-col gap-4 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h3 className="text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-2">
              <CloudRain className="w-4 h-4 text-cyan-400" />
              Atmospheric & Channel Effects
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono">
              T={((distTelem?.atmospheric_transmittance ?? 1.0) * 100).toFixed(0)}%
            </span>
          </div>

          {/* Atmospheric Selection */}
          <div className="space-y-1.5">
            <span className="text-slate-400 text-[11px] font-semibold">Transmission Condition:</span>
            <div className="grid grid-cols-2 gap-1.5">
              {(['Clear', 'Haze', 'Fog', 'Rain', 'Low Light'] as const).map((cond) => {
                const active = distCfg?.atmospheric_condition === cond;
                const meta = atmoMeta[cond];
                const Icon = meta.icon;
                return (
                  <button
                    key={cond}
                    onClick={() => handleUpdateDisturbance({ atmospheric_condition: cond })}
                    className={`p-2 rounded border flex items-center gap-2 text-left transition ${
                      active
                        ? 'bg-cyan-950 text-cyan-300 border-cyan-500 font-bold'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${active ? meta.color : 'text-slate-500'}`} />
                    <span className="text-[11px]">{cond}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Temporary Occlusion Obstacle (Tests Kalman Coasting) */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300 font-bold uppercase flex items-center gap-1.5">
                <EyeOff className="w-3.5 h-3.5 text-rose-400" /> Temporary Occlusion
              </span>
              <span className={distTelem?.is_occluded ? 'text-rose-400 font-bold' : 'text-emerald-400 font-semibold'}>
                {distTelem?.is_occluded ? 'BLOCKED' : 'UNOBSTRUCTED'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleTriggerOcclusion}
                className="flex-1 py-1.5 px-3 rounded bg-rose-900/80 hover:bg-rose-800 text-white font-bold text-[11px] transition shadow"
              >
                Trigger Occlusion Event
              </button>
              <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={distCfg?.temporary_occlusion_enabled ?? false}
                  onChange={(e) => handleUpdateDisturbance({ temporary_occlusion_enabled: e.target.checked })}
                  className="accent-rose-500"
                />
                <span>Periodic</span>
              </label>
            </div>

            <div className="flex justify-between text-[10px] text-slate-400">
              <span>Duration: {distCfg?.occlusion_duration_s ?? 1.0}s</span>
              <span>Periodic Interval: Every {distCfg?.occlusion_period_s ?? 6.0}s</span>
            </div>
          </div>

          {/* Motion Blur & Beacon Flicker */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2.5 text-[11px]">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={distCfg?.motion_blur_enabled ?? false}
                  onChange={(e) => handleUpdateDisturbance({ motion_blur_enabled: e.target.checked })}
                  className="accent-cyan-500"
                />
                <span className="text-slate-300 font-bold">Dynamic Motion Blur</span>
              </label>
              <span className="text-slate-400 font-mono">Kernel {distCfg?.motion_blur_kernel_size ?? 5}x{distCfg?.motion_blur_kernel_size ?? 5}</span>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={distCfg?.beacon_flicker_enabled ?? false}
                  onChange={(e) => handleUpdateDisturbance({ beacon_flicker_enabled: e.target.checked })}
                  className="accent-cyan-500"
                />
                <span className="text-slate-300 font-bold">Beacon Flicker Modulation</span>
              </label>
              <span className="text-slate-400 font-mono">{distCfg?.beacon_flicker_frequency_hz ?? 10} Hz</span>
            </div>
          </div>

          {/* Robust Tracking Verification Health Telemetry */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-1.5 text-[11px]">
            <div className="text-slate-300 font-bold uppercase tracking-wider border-b border-slate-800 pb-1">
              Robust Tracking Verification
            </div>

            <div className="flex justify-between">
              <span className="text-slate-400">Effective Beacon SNR:</span>
              <span className="text-cyan-300 font-bold font-mono">
                {distTelem?.effective_snr_db !== null && distTelem?.effective_snr_db !== undefined
                  ? `${distTelem.effective_snr_db.toFixed(1)} dB`
                  : '--'}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-slate-400">CV Beacon Detection:</span>
              <span className={detTelem?.beacon_detected ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                {detTelem?.beacon_detected ? 'DETECTED' : 'NOT DETECTED (COASTING)'}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-slate-400">PAT Tracking State:</span>
              <span className="text-amber-300 font-bold font-mono">{trackTelem?.state || 'SEARCHING'}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-slate-400">Centroid Error:</span>
              <span className="text-white font-mono">{trackTelem?.total_error_px?.toFixed(1) ?? '--'} px</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
