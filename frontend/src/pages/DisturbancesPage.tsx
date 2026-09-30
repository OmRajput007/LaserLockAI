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

  const handleInjectTurbulence = () => {
    const atmoFrac = telemetry?.tracking?.atmosphere_path_frac ?? telemetry?.orbital?.link?.atmosphere_path_frac ?? (telemetry?.scenario_mode === 'Orbital' ? 0.0 : 1.0);
    if (atmoFrac <= 1e-4) {
      showFeedback('Note: No atmosphere is on the path (vacuum link, fraction = 0.00). Turbulence and blur do not apply.');
      return;
    }
    const turbAmp = Math.min(14.0, Math.max(5.0, atmoFrac * 10.0));
    handleUpdateDisturbance({
      atmospheric_condition: 'Haze',
      camera_jitter_enabled: true,
      camera_jitter_max_px: turbAmp,
      camera_jitter_frequency_hz: 18.0,
    });
    showFeedback(`Injected atmospheric turbulence (±${turbAmp.toFixed(1)}px jitter, scaled by path fraction ${(atmoFrac * 100).toFixed(1)}%)!`);
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
    <div className="flex flex-col gap-4 font-sans text-xs">
      {/* Top Banner: Disturbance and Noise Engine */}
      <div className="bg-[#121518] border border-[#252A2E] p-4 rounded-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-100 uppercase tracking-wider">
                Disturbance & Noise Engine
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-rose-500/10 border border-rose-500/30 text-rose-300">
                Environmental Perturbations
              </span>
            </div>
            <p className="text-slate-400 text-[11px] mt-0.5">
              Multi-Noise (Gaussian, S&P, Poisson), Jitter (±20 px), Atmosphere, Platform Motion (±20 px), Blur & Occlusion
            </p>
          </div>
        </div>

        {/* Live Atmosphere & Occlusion Badges */}
        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-lg bg-[#121518] border border-[#252A2E] flex items-center gap-2">
            <AtmoIcon className={`w-4 h-4 ${currentAtmo.color}`} />
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Atmosphere</div>
              <div className="font-semibold text-slate-200 text-xs">{distCfg?.atmospheric_condition || 'Clear'}</div>
            </div>
          </div>

          <div
            className={`px-3 py-1.5 rounded-lg border flex items-center gap-2 ${
              distTelem?.is_occluded
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-[#121518] border-[#252A2E] text-slate-300'
            }`}
          >
            {distTelem?.is_occluded ? <EyeOff className="w-4 h-4 text-rose-400" /> : <Eye className="w-4 h-4 text-emerald-400" />}
            <div>
              <div className="text-[10px] text-slate-500 uppercase">LOS Beam Path</div>
              <div className="font-semibold text-xs">
                {distTelem?.is_occluded ? `Occluded (${distTelem.occlusion_remaining_s.toFixed(1)}s)` : 'Clear Transmission'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {feedback && (
        <div className="p-2.5 rounded-lg bg-blue-500/10 border border-[#3A4048] text-blue-200 text-xs font-medium flex items-center justify-between">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Benchmark Test Scenarios (One-Click Presets) */}
      <div className="bg-[#121518] border border-[#252A2E] p-4 rounded-xl space-y-3">
        <div className="flex items-center justify-between border-b border-[#252A2E] pb-2.5">
          <div className="flex items-center gap-2 text-slate-200 font-semibold text-xs uppercase tracking-wider">
            <Sparkles className="w-4 h-4 text-[#D6D9DC]" />
            <span>Benchmark Evaluation Scenarios</span>
          </div>
          <span className="text-xs text-slate-400">
            Active: <strong className="text-slate-100 font-medium">{distCfg?.preset_scenario || 'Normal'}</strong>
          </span>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
          {[
            { id: 'Normal', label: 'Normal', icon: Sun, color: 'text-emerald-400' },
            { id: 'High Noise', label: 'High Noise', icon: AlertTriangle, color: 'text-amber-400' },
            { id: 'High Jitter', label: 'High Jitter', icon: Activity, color: 'text-purple-400' },
            { id: 'Haze', label: 'Haze', icon: Wind, color: 'text-amber-300' },
            { id: 'Fog', label: 'Fog', icon: CloudFog, color: 'text-slate-300' },
            { id: 'Rain', label: 'Rain', icon: Umbrella, color: 'text-[#D6D9DC]' },
            { id: 'Low Light', label: 'Low Light', icon: Moon, color: 'text-indigo-400' },
            { id: 'Fast Motion', label: 'Fast Motion', icon: Zap, color: 'text-amber-400' },
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
                    ? 'bg-[#1E2124] border-[#3A4048] text-slate-100 font-medium'
                    : 'bg-[#121518] border-[#252A2E] text-slate-400 hover:text-slate-200 hover:border-[#2D3237]'
                }`}
              >
                <SIcon className={`w-4 h-4 ${active ? sc.color : 'text-slate-500'}`} />
                <span className="text-[11px] truncate">{sc.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ========================================================================= */}
        {/* COLUMN 1: MULTI-NOISE ENGINE & SENSOR READOUT                             */}
        {/* ========================================================================= */}
        <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-[#252A2E] pb-2.5">
            <h3 className="text-slate-200 font-semibold uppercase tracking-wider flex items-center gap-2 text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Noise Injection Models
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#1A1D20] text-slate-300 border border-[#22324e]">
              Max σ ≤ 20 px
            </span>
          </div>

          {/* Simultaneous Noise Checkboxes */}
          <div className="space-y-2">
            <span className="text-slate-400 text-xs">Active Noise Models (Simultaneous):</span>
            <div className="space-y-1.5">
              <label className="flex items-center justify-between p-2.5 rounded-lg bg-[#121518] border border-[#252A2E] cursor-pointer hover:border-[#2D3237] transition">
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={distCfg?.gaussian_noise_enabled ?? false}
                    onChange={(e) => {
                      const nextG = e.target.checked;
                      const nextSP = distCfg?.salt_pepper_enabled ?? false;
                      const nextP = distCfg?.poisson_noise_enabled ?? false;
                      const cnt = (nextG ? 1 : 0) + (nextSP ? 1 : 0) + (nextP ? 1 : 0);
                      const nt = cnt > 1 ? 'Multi-Noise' : nextG ? 'Gaussian' : nextSP ? 'Salt & Pepper' : nextP ? 'Poisson' : 'None';
                      handleUpdateDisturbance({ gaussian_noise_enabled: nextG, noise_type: nt });
                    }}
                    className="accent-slate-500 rounded"
                  />
                  <span className="font-medium text-slate-200 text-xs">Gaussian Readout Noise</span>
                </div>
                <span className="text-[11px] text-slate-400">Normal (N ~ 0, σ²)</span>
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-[#121518] border border-[#252A2E] cursor-pointer hover:border-[#2D3237] transition">
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={distCfg?.salt_pepper_enabled ?? false}
                    onChange={(e) => {
                      const nextG = distCfg?.gaussian_noise_enabled ?? false;
                      const nextSP = e.target.checked;
                      const nextP = distCfg?.poisson_noise_enabled ?? false;
                      const cnt = (nextG ? 1 : 0) + (nextSP ? 1 : 0) + (nextP ? 1 : 0);
                      const nt = cnt > 1 ? 'Multi-Noise' : nextG ? 'Gaussian' : nextSP ? 'Salt & Pepper' : nextP ? 'Poisson' : 'None';
                      handleUpdateDisturbance({ salt_pepper_enabled: nextSP, noise_type: nt });
                    }}
                    className="accent-slate-500 rounded"
                  />
                  <span className="font-medium text-slate-200 text-xs">Salt & Pepper Noise</span>
                </div>
                <span className="text-[11px] text-slate-400">Impulsive Corruption</span>
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-[#121518] border border-[#252A2E] cursor-pointer hover:border-[#2D3237] transition">
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={distCfg?.poisson_noise_enabled ?? false}
                    onChange={(e) => {
                      const nextG = distCfg?.gaussian_noise_enabled ?? false;
                      const nextSP = distCfg?.salt_pepper_enabled ?? false;
                      const nextP = e.target.checked;
                      const cnt = (nextG ? 1 : 0) + (nextSP ? 1 : 0) + (nextP ? 1 : 0);
                      const nt = cnt > 1 ? 'Multi-Noise' : nextG ? 'Gaussian' : nextSP ? 'Salt & Pepper' : nextP ? 'Poisson' : 'None';
                      handleUpdateDisturbance({ poisson_noise_enabled: nextP, noise_type: nt });
                    }}
                    className="accent-slate-500 rounded"
                  />
                  <span className="font-medium text-slate-200 text-xs">Poisson Photon Shot Noise</span>
                </div>
                <span className="text-[11px] text-slate-400">Quantum Statistics</span>
              </label>
            </div>
          </div>

          {/* Noise Standard Deviation Slider (Max 20 px) */}
          <div className="p-3 bg-[#121518] rounded-lg border border-[#252A2E] space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-300">Gaussian Noise Std Dev (σ):</span>
              <span className="text-[#E8EAED] font-medium num-mono">{distCfg?.noise_std_dev ?? 5.0} px (Limit ≤ 20)</span>
            </div>
            <input
              type="range"
              min="0"
              max="20"
              step="0.5"
              value={distCfg?.noise_std_dev ?? 5.0}
              onChange={(e) => handleUpdateDisturbance({ noise_std_dev: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-[#1a2336] rounded-lg appearance-none cursor-pointer accent-slate-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>0.0 px (Clean)</span>
              <span>10.0 px</span>
              <span className="text-rose-400">20.0 px (Severe)</span>
            </div>
          </div>

          {/* Salt & Pepper Ratio Slider */}
          <div className="p-3 bg-[#121518] rounded-lg border border-[#252A2E] space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-300">Salt & Pepper Density:</span>
              <span className="text-[#E8EAED] font-medium num-mono">{((distCfg?.salt_pepper_ratio ?? 0.02) * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0.00"
              max="0.15"
              step="0.005"
              value={distCfg?.salt_pepper_ratio ?? 0.02}
              onChange={(e) => handleUpdateDisturbance({ salt_pepper_ratio: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-[#1a2336] rounded-lg appearance-none cursor-pointer accent-slate-500"
            />
          </div>

          {/* Forced SNR Reduction */}
          <div className="p-3 bg-[#121518] rounded-lg border border-[#252A2E] space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-300">Forced SNR Attenuation:</span>
              <span className="text-amber-400 font-medium num-mono">{distCfg?.snr_reduction_db ?? 0.0} dB</span>
            </div>
            <input
              type="range"
              min="0"
              max="25"
              step="1"
              value={distCfg?.snr_reduction_db ?? 0.0}
              onChange={(e) => handleUpdateDisturbance({ snr_reduction_db: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-[#1a2336] rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
          </div>
        </div>

        {/* ========================================================================= */}
        {/* COLUMN 2: CAMERA JITTER & PLATFORM MOTION                                 */}
        {/* ========================================================================= */}
        <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-[#252A2E] pb-2.5">
            <h3 className="text-slate-200 font-semibold uppercase tracking-wider flex items-center gap-2 text-xs">
              <Activity className="w-4 h-4 text-purple-400" />
              Camera Jitter & Platform Motion
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              Max ±20 px/frame
            </span>
          </div>

          {/* Camera Jitter (High-Frequency Mechanical Vibration) */}
          <div className="p-3 bg-[#121518] rounded-lg border border-[#252A2E] space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(distCfg?.camera_jitter_enabled || (distCfg?.camera_jitter_max_px ?? 0) > 0) ?? false}
                  onChange={(e) => {
                    const isChecked = e.target.checked;
                    const amp = isChecked ? ((distCfg?.camera_jitter_max_px && distCfg.camera_jitter_max_px > 0) ? distCfg.camera_jitter_max_px : 10.0) : 0.0;
                    handleUpdateDisturbance({
                      camera_jitter_enabled: isChecked,
                      camera_jitter_max_px: amp,
                    });
                  }}
                  className="accent-slate-500 rounded"
                />
                <span className="text-slate-200 font-medium uppercase text-xs">Camera Jitter</span>
              </label>
              <span className="text-[11px] text-slate-400 num-mono">
                Offset: ({distTelem?.jitter_offset_x_px?.toFixed(1) ?? '0.0'}, {distTelem?.jitter_offset_y_px?.toFixed(1) ?? '0.0'}) px
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Jitter Amplitude:</span>
                <span className="text-slate-200 font-medium num-mono">±{distCfg?.camera_jitter_max_px ?? 0} px/frame (Max ±20)</span>
              </div>
              <input
                type="range"
                min="0"
                max="20"
                step="1"
                value={distCfg?.camera_jitter_max_px ?? 0}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  handleUpdateDisturbance({
                    camera_jitter_max_px: val,
                    camera_jitter_enabled: val > 0,
                  });
                }}
                className="w-full h-1.5 bg-[#1a2336] rounded-lg appearance-none cursor-pointer accent-slate-500"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Vibration Frequency:</span>
                <span className="text-[#E8EAED] font-medium num-mono">{distCfg?.camera_jitter_frequency_hz ?? 15.0} Hz</span>
              </div>
              <input
                type="range"
                min="1"
                max="60"
                step="1"
                value={distCfg?.camera_jitter_frequency_hz ?? 15.0}
                onChange={(e) => handleUpdateDisturbance({ camera_jitter_frequency_hz: parseFloat(e.target.value) })}
                className="w-full h-1.5 bg-[#1a2336] rounded-lg appearance-none cursor-pointer accent-slate-500"
              />
            </div>
          </div>

          {/* Platform Motion (Mobile Terminal Base Kinematics) */}
          <div className="p-3 bg-[#121518] rounded-lg border border-[#252A2E] space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(distCfg?.platform_motion_enabled || (distCfg?.platform_motion_max_px ?? 0) > 0) ?? false}
                  onChange={(e) => {
                    const isChecked = e.target.checked;
                    const amp = isChecked ? ((distCfg?.platform_motion_max_px && distCfg.platform_motion_max_px > 0) ? distCfg.platform_motion_max_px : 12.0) : 0.0;
                    handleUpdateDisturbance({
                      platform_motion_enabled: isChecked,
                      platform_motion_max_px: amp,
                    });
                  }}
                  className="accent-slate-500 rounded"
                />
                <span className="text-slate-200 font-medium uppercase text-xs">Mobile Platform Motion</span>
              </label>
              <span className="text-[11px] text-slate-400 num-mono">
                Offset: ({distTelem?.platform_offset_x_px?.toFixed(1) ?? '0.0'}, {distTelem?.platform_offset_y_px?.toFixed(1) ?? '0.0'}) px
              </span>
            </div>

            <div>
              <span className="text-slate-400 text-[11px]">Trajectory Pattern:</span>
              <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                {(['Linear', 'Sinusoidal', 'Circular', 'Figure of 8', 'Spiral', 'Random'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() =>
                      handleUpdateDisturbance({
                        platform_motion_type: m,
                        platform_motion_enabled: true,
                        ...((!distCfg?.platform_motion_max_px || distCfg.platform_motion_max_px === 0)
                          ? { platform_motion_max_px: 12.0 }
                          : {}),
                      })
                    }
                    className={`py-1 px-1.5 rounded-lg text-[11px] font-medium border transition ${
                      distCfg?.platform_motion_type === m
                        ? 'bg-purple-500/15 text-purple-300 border-purple-500/40'
                        : 'bg-[#1A1D20] text-slate-400 border-[#22324e] hover:text-slate-200'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Motion Amplitude:</span>
                <span className="text-slate-200 font-medium num-mono">±{distCfg?.platform_motion_max_px ?? 0} px/frame (Max ±20)</span>
              </div>
              <input
                type="range"
                min="0"
                max="20"
                step="1"
                value={distCfg?.platform_motion_max_px ?? 0}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  handleUpdateDisturbance({
                    platform_motion_max_px: val,
                    platform_motion_enabled: val > 0,
                  });
                }}
                className="w-full h-1.5 bg-[#1a2336] rounded-lg appearance-none cursor-pointer accent-slate-500"
              />
            </div>
          </div>

          {/* Sudden Camera Shock / Wind Gust */}
          <div className="p-3 bg-[#121518] rounded-lg border border-[#252A2E] space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={distCfg?.sudden_camera_movement_enabled ?? false}
                  onChange={(e) => handleUpdateDisturbance({ sudden_camera_movement_enabled: e.target.checked })}
                  className="accent-slate-500 rounded"
                />
                <span className="text-slate-300 font-medium">Sudden Wind Shock / Impulses</span>
              </label>
              <span className="text-rose-400 num-mono font-medium">±{distCfg?.sudden_movement_max_px ?? 12} px</span>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* COLUMN 3: ATMOSPHERE, BLUR, OCCLUSION & TRACKING HEALTH                   */}
        {/* ========================================================================= */}
        <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-[#252A2E] pb-2.5">
            <h3 className="text-slate-200 font-semibold uppercase tracking-wider flex items-center gap-2 text-xs">
              <CloudRain className="w-4 h-4 text-[#D6D9DC]" />
              Atmospheric & Channel Effects
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#1A1D20] text-[#E8EAED] border border-[#22324e] num-mono">
              T={((distTelem?.atmospheric_transmittance ?? 1.0) * 100).toFixed(0)}%
            </span>
          </div>

          {/* Atmospheric Selection */}
          <div className="space-y-1.5">
            <span className="text-slate-400 text-xs">Transmission Condition:</span>
            <div className="grid grid-cols-2 gap-1.5">
              {(['Clear', 'Haze', 'Fog', 'Rain', 'Low Light'] as const).map((cond) => {
                const active = distCfg?.atmospheric_condition === cond;
                const meta = atmoMeta[cond];
                const Icon = meta.icon;
                return (
                  <button
                    key={cond}
                    onClick={() => handleUpdateDisturbance({ atmospheric_condition: cond })}
                    className={`p-2 rounded-lg border flex items-center gap-2 text-left transition ${
                      active
                        ? 'bg-[#1E2124] text-[#E8EAED] border-[#3A4048] font-medium'
                        : 'bg-[#121518] text-slate-400 border-[#252A2E] hover:text-slate-200'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${active ? meta.color : 'text-slate-500'}`} />
                    <span className="text-xs">{cond}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Atmospheric Path Fraction & Turbulence Injection */}
          <div className="p-3 bg-[#121518] rounded-lg border border-[#252A2E] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium flex items-center gap-1.5">
                <Wind className="w-3.5 h-3.5 text-[#D6D9DC]" /> Path Fraction
              </span>
              <span className="num-mono text-[#D6D9DC] font-medium">
                {(((telemetry?.tracking?.atmosphere_path_frac ?? telemetry?.orbital?.link?.atmosphere_path_frac ?? (telemetry?.scenario_mode === 'Orbital' ? 0.0 : 1.0))) * 100).toFixed(1)}%
              </span>
            </div>

            {((telemetry?.tracking?.atmosphere_path_frac ?? telemetry?.orbital?.link?.atmosphere_path_frac ?? (telemetry?.scenario_mode === 'Orbital' ? 0.0 : 1.0)) <= 1e-4) ? (
              <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>Vacuum link: turbulence and blur do not apply.</span>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400">
                Atmospheric turbulence applies in proportion to path fraction ({(((telemetry?.tracking?.atmosphere_path_frac ?? 1.0)) * 100).toFixed(1)}%).
              </div>
            )}

            <button
              onClick={handleInjectTurbulence}
              className="w-full py-1.5 px-3 rounded-lg bg-[#1E2124] hover:bg-[#252A2E]/25 text-[#E8EAED] border border-[#3A4048] font-medium text-xs transition flex items-center justify-center gap-1.5"
            >
              <Wind className="w-3.5 h-3.5" /> Inject Turbulence
            </button>
          </div>

          {/* Temporary Occlusion Obstacle (Tests Kalman Coasting) */}
          <div className="p-3 bg-[#121518] rounded-lg border border-[#252A2E] space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium flex items-center gap-1.5">
                <EyeOff className="w-3.5 h-3.5 text-rose-400" /> Temporary Occlusion
              </span>
              <span className={distTelem?.is_occluded ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-medium'}>
                {distTelem?.is_occluded ? 'Blocked' : 'Unobstructed'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleTriggerOcclusion}
                className="flex-1 py-1.5 px-3 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 font-medium text-xs transition"
              >
                Trigger Occlusion Event
              </button>
              <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={distCfg?.temporary_occlusion_enabled ?? false}
                  onChange={(e) => handleUpdateDisturbance({ temporary_occlusion_enabled: e.target.checked })}
                  className="accent-rose-500 rounded"
                />
                <span>Periodic</span>
              </label>
            </div>

            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Duration: {distCfg?.occlusion_duration_s ?? 1.0}s</span>
              <span>Interval: Every {distCfg?.occlusion_period_s ?? 6.0}s</span>
            </div>
          </div>

          {/* Motion Blur & Beacon Flicker */}
          <div className="p-3 bg-[#121518] rounded-lg border border-[#252A2E] space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={distCfg?.motion_blur_enabled ?? false}
                  onChange={(e) => handleUpdateDisturbance({ motion_blur_enabled: e.target.checked })}
                  className="accent-slate-500 rounded"
                />
                <span className="text-slate-300 font-medium">Dynamic Motion Blur</span>
              </label>
              <span className="text-slate-400 font-mono text-[11px]">Kernel {distCfg?.motion_blur_kernel_size ?? 5}×{distCfg?.motion_blur_kernel_size ?? 5}</span>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={distCfg?.beacon_flicker_enabled ?? false}
                  onChange={(e) => handleUpdateDisturbance({ beacon_flicker_enabled: e.target.checked })}
                  className="accent-slate-500 rounded"
                />
                <span className="text-slate-300 font-medium">Beacon Flicker Modulation</span>
              </label>
              <span className="text-slate-400 num-mono text-[11px]">{distCfg?.beacon_flicker_frequency_hz ?? 10} Hz</span>
            </div>
          </div>

          {/* Robust Tracking Verification Health Telemetry */}
          <div className="p-3 bg-[#121518] rounded-lg border border-[#252A2E] space-y-1.5 text-xs">
            <div className="text-slate-300 font-medium uppercase tracking-wider border-b border-[#252A2E] pb-1.5">
              Tracking Verification Health
            </div>

            <div className="flex justify-between">
              <span className="text-slate-400">Effective Beacon SNR:</span>
              <span className="text-[#D6D9DC] font-medium num-mono">
                {distTelem?.effective_snr_db !== null && distTelem?.effective_snr_db !== undefined
                  ? `${distTelem.effective_snr_db.toFixed(1)} dB`
                  : '--'}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-slate-400">Beacon Detection:</span>
              <span className={detTelem?.beacon_detected ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                {detTelem?.beacon_detected ? 'Detected' : 'Coasting'}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-slate-400">PAT Tracking State:</span>
              <span className="text-amber-400 font-medium num-mono">{trackTelem?.state || 'SEARCHING'}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-slate-400">Centroid Error:</span>
              <span className="text-slate-200 num-mono">{trackTelem?.total_error_px?.toFixed(1) ?? '--'} px</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
