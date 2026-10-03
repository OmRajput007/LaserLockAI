import React, { useState } from 'react';
import { Settings, Save, RotateCcw, Upload, Download, CheckCircle2 } from 'lucide-react';
import { SystemConfig } from '../types';
import { api } from '../services/api';

interface Props {
  config: SystemConfig | null;
  onConfigChange: (updated: SystemConfig) => void;
}

export const SettingsPage: React.FC<Props> = ({ config, onConfigChange }) => {
  const [activeCategory, setActiveCategory] = useState<
    'Camera' | 'Target' | 'Motion' | 'Detection' | 'Tracking' | 'Control' | 'Disturbance' | 'Performance'
  >('Camera');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  if (!config) return null;

  const handleSave = async () => {
    try {
      const saved = await api.updateConfig(config);
      onConfigChange(saved);
      setSaveStatus('✓ Configuration successfully saved to backend JSON.');
      setTimeout(() => setSaveStatus(null), 3500);
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    }
  };

  const handleReset = async () => {
    if (confirm('Reset all parameters to official Problem Statement 4 defaults?')) {
      try {
        const reset = await api.resetConfig();
        onConfigChange(reset);
        setSaveStatus('✓ Reset to official Problem Statement 4 defaults.');
        setTimeout(() => setSaveStatus(null), 3500);
      } catch (e: any) {
        alert(`Reset failed: ${e.message}`);
      }
    }
  };

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(config, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', `laserlockAI_config_${Date.now()}.json`);
    a.click();
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        const updated = await api.updateConfig(parsed);
        onConfigChange(updated);
        setSaveStatus('✓ Imported and applied JSON configuration.');
        setTimeout(() => setSaveStatus(null), 3500);
      } catch (err: any) {
        alert(`Invalid configuration file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const inputClass = "w-full bg-[#262824] border border-[#33362F] rounded p-2 text-[#F0FFEA] focus:border-[#FF5F40] focus:outline-none font-mono text-xs";
  const readOnlyClass = "w-full bg-[#1B1D1A] border border-[#33362F] rounded p-2 text-[#9CA195] font-mono text-xs cursor-not-allowed";

  return (
    <div className="flex flex-col gap-4 font-mono text-xs text-[#F0FFEA]">
      {/* Header with Save, Load, Reset */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-4 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#262824] border border-[#33362F] flex items-center justify-center text-[#FF5F40]">
            <Settings className="w-4 h-4 text-[#FF5F40]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#F0FFEA]">
              System Configuration & Parameter Store
            </h2>
            <p className="text-[#9CA195] text-xs mt-0.5">
              JSON-Backed Persistent Parameter Store (Problem Statement 4 Compliant)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="px-3.5 py-1.5 bg-[#FF5F40] hover:bg-[#FF7459] text-[#0A0A0A] rounded font-bold text-xs flex items-center gap-1.5 transition uppercase tracking-wider shadow"
          >
            <Save className="w-4 h-4" /> Save Changes
          </button>
          <label className="px-3.5 py-1.5 bg-[#262824] hover:bg-[#FF5F40]/20 text-[#F0FFEA] border border-[#33362F] rounded font-medium text-xs flex items-center gap-1.5 cursor-pointer transition">
            <Upload className="w-4 h-4 text-[#FF5F40]" /> Load JSON
            <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
          </label>
          <button
            onClick={handleExportJSON}
            className="px-3.5 py-1.5 bg-[#262824] hover:bg-[#FF5F40]/20 text-[#F0FFEA] border border-[#33362F] rounded font-medium text-xs flex items-center gap-1.5 transition"
          >
            <Download className="w-4 h-4 text-[#FF5F40]" /> Export JSON
          </button>
          <button
            onClick={handleReset}
            className="px-3.5 py-1.5 bg-[#262824] hover:bg-[#FF5F40]/15 text-[#FF5F40] border border-[#33362F] rounded font-medium text-xs flex items-center gap-1.5 transition ml-1"
          >
            <RotateCcw className="w-4 h-4 text-[#FF5F40]" /> Reset Defaults
          </button>
        </div>
      </div>

      {saveStatus && (
        <div className="p-3 bg-[#1B1D1A] border border-[#FF5F40] text-[#FF5F40] rounded flex items-center gap-2 font-bold text-xs">
          <CheckCircle2 className="w-4 h-4 text-[#FF5F40]" />
          <span>{saveStatus}</span>
        </div>
      )}

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-1 bg-[#000000] p-1 rounded border border-[#33362F]">
        {(['Camera', 'Target', 'Motion', 'Detection', 'Tracking', 'Control', 'Disturbance', 'Performance'] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded font-mono transition text-xs ${
              activeCategory === cat
                ? 'bg-[#FF5F40] text-[#0A0A0A] font-bold shadow-sm'
                : 'text-[#9CA195] hover:text-[#F0FFEA]'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Category Form Content */}
      <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-5">
        {activeCategory === 'Camera' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[#9CA195] block mb-1">Sensor Type</label>
              <input
                type="text"
                value={config.camera.sensor_type}
                onChange={(e) =>
                  onConfigChange({ ...config, camera: { ...config.camera, sensor_type: e.target.value } })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Resolution (Width × Height)</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  value={config.camera.resolution_width}
                  readOnly
                  className={readOnlyClass}
                />
                <input
                  type="number"
                  value={config.camera.resolution_height}
                  readOnly
                  className={readOnlyClass}
                />
              </div>
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">FOV (Horizontal × Vertical in Degrees)</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="0.1"
                  value={config.camera.fov_horizontal_deg}
                  onChange={(e) =>
                    onConfigChange({
                      ...config,
                      camera: { ...config.camera, fov_horizontal_deg: parseFloat(e.target.value) },
                    })
                  }
                  className={inputClass}
                />
                <input
                  type="number"
                  step="0.1"
                  value={config.camera.fov_vertical_deg}
                  onChange={(e) =>
                    onConfigChange({
                      ...config,
                      camera: { ...config.camera, fov_vertical_deg: parseFloat(e.target.value) },
                    })
                  }
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Update Rate (Hz, Min 30)</label>
              <input
                type="number"
                min="30"
                value={config.camera.update_rate_hz}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    camera: { ...config.camera, update_rate_hz: parseFloat(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Max Pan Slew Speed (°/s, Max 5.0)</label>
              <input
                type="number"
                max="5.0"
                value={config.camera.max_pan_speed_deg_s}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    camera: { ...config.camera, max_pan_speed_deg_s: parseFloat(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Max Tilt Slew Speed (°/s, Max 5.0)</label>
              <input
                type="number"
                max="5.0"
                value={config.camera.max_tilt_speed_deg_s}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    camera: { ...config.camera, max_tilt_speed_deg_s: parseFloat(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </div>
          </div>
        )}

        {activeCategory === 'Target' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[#9CA195] block mb-1">Target Type</label>
              <input
                type="text"
                value={config.target.target_type}
                readOnly
                className={readOnlyClass}
              />
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Target Shape (Square Mandatory)</label>
              <select
                value={config.target.shape}
                onChange={(e) =>
                  onConfigChange({ ...config, target: { ...config.target, shape: e.target.value as any } })
                }
                className={inputClass}
              >
                <option value="Square">Square</option>
                <option value="Circle">Circle</option>
              </select>
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Target Dimension (10x10 Pixels)</label>
              <input
                type="number"
                value={config.target.size_pixels}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    target: { ...config.target, size_pixels: parseInt(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Initial Location Placement</label>
              <select
                value={config.target.initial_location_mode}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    target: { ...config.target, initial_location_mode: e.target.value as any },
                  })
                }
                className={inputClass}
              >
                <option value="Random">Random</option>
                <option value="Center">Center</option>
                <option value="Manual">Manual</option>
              </select>
            </div>
          </div>
        )}

        {activeCategory === 'Motion' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[#9CA195] block mb-1">Mandatory Trajectory Type</label>
              <select
                value={config.motion.trajectory_type}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    motion: { ...config.motion, trajectory_type: e.target.value as any },
                  })
                }
                className={inputClass}
              >
                <option value="Straight Line">Straight Line</option>
                <option value="Circular">Circular</option>
                <option value="Figure of 8">Figure of 8</option>
                <option value="Random">Random</option>
              </select>
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Target Speed (Pixels / Second)</label>
              <input
                type="number"
                value={config.motion.speed_pixels_per_s}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    motion: { ...config.motion, speed_pixels_per_s: parseFloat(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Screen World Width (Min 2000)</label>
              <input
                type="number"
                min="2000"
                value={config.motion.screen_width}
                readOnly
                className={readOnlyClass}
              />
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Screen World Height (Min 2000)</label>
              <input
                type="number"
                min="2000"
                value={config.motion.screen_height}
                readOnly
                className={readOnlyClass}
              />
            </div>
          </div>
        )}

        {activeCategory === 'Detection' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[#9CA195] block mb-1">Detection Algorithm</label>
              <select
                value={config.detection.algorithm}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    detection: { ...config.detection, algorithm: e.target.value as any },
                  })
                }
                className={inputClass}
              >
                <option value="Threshold Centroid">Threshold Centroid</option>
                <option value="Blob Detector">Blob Detector</option>
                <option value="AI-CNN">AI-CNN</option>
                <option value="Bypass">Bypass (Ground Truth)</option>
              </select>
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Intensity Threshold (0-255)</label>
              <input
                type="number"
                min="0"
                max="255"
                value={config.detection.intensity_threshold}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    detection: { ...config.detection, intensity_threshold: parseInt(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </div>
          </div>
        )}

        {activeCategory === 'Tracking' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[#9CA195] block mb-1">Filter Algorithm (Part 6)</label>
              <select
                value={config.tracking.algorithm}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    tracking: { ...config.tracking, algorithm: e.target.value as any },
                  })
                }
                className={inputClass}
              >
                <option value="None">None (Bypass)</option>
                <option value="Kalman Filter">Kalman Filter</option>
                <option value="Alpha-Beta">Alpha-Beta</option>
                <option value="Particle Filter">Particle Filter</option>
              </select>
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Update Interval (Hz, Min 20)</label>
              <input
                type="number"
                min="20"
                value={config.tracking.update_interval_hz}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    tracking: { ...config.tracking, update_interval_hz: parseFloat(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </div>
          </div>
        )}

        {activeCategory === 'Control' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[#9CA195] block mb-1">Gimbal Loop Mode</label>
              <select
                value={config.control.mode}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    control: { ...config.control, mode: e.target.value as any },
                  })
                }
                className={inputClass}
              >
                <option value="Open Loop">Open Loop (Part 1)</option>
                <option value="PID Coarse Pointing">PID Coarse Pointing (Part 6)</option>
                <option value="State Feedback">State Feedback</option>
              </select>
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Pan PID Gains (Kp, Ki, Kd)</label>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  step="0.05"
                  value={config.control.kp_pan}
                  onChange={(e) =>
                    onConfigChange({ ...config, control: { ...config.control, kp_pan: parseFloat(e.target.value) } })
                  }
                  className={inputClass}
                />
                <input
                  type="number"
                  step="0.01"
                  value={config.control.ki_pan}
                  onChange={(e) =>
                    onConfigChange({ ...config, control: { ...config.control, ki_pan: parseFloat(e.target.value) } })
                  }
                  className={inputClass}
                />
                <input
                  type="number"
                  step="0.05"
                  value={config.control.kd_pan}
                  onChange={(e) =>
                    onConfigChange({ ...config, control: { ...config.control, kd_pan: parseFloat(e.target.value) } })
                  }
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        )}

        {activeCategory === 'Disturbance' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[#9CA195] block mb-1">Noise Generator</label>
              <select
                value={config.disturbance.noise_type}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    disturbance: { ...config.disturbance, noise_type: e.target.value as any },
                  })
                }
                className={inputClass}
              >
                <option value="None">None</option>
                <option value="Salt & Pepper">Salt & Pepper</option>
                <option value="Gaussian">Gaussian</option>
                <option value="Poisson">Poisson</option>
              </select>
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Max Noise Std Dev (Max 20 px)</label>
              <input
                type="number"
                max="20"
                value={config.disturbance.noise_std_dev}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    disturbance: { ...config.disturbance, noise_std_dev: parseFloat(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Atmospheric Condition</label>
              <select
                value={config.disturbance.atmospheric_condition}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    disturbance: { ...config.disturbance, atmospheric_condition: e.target.value as any },
                  })
                }
                className={inputClass}
              >
                <option value="Clear">Clear</option>
                <option value="Haze">Haze</option>
                <option value="Fog">Fog</option>
                <option value="Rain">Rain</option>
                <option value="Low Light">Low Light</option>
              </select>
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Platform Motion (Linear Mandatory, Max ±20 px)</label>
              <input
                type="number"
                max="20"
                value={config.disturbance.platform_motion_max_px}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    disturbance: { ...config.disturbance, platform_motion_max_px: parseFloat(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </div>
          </div>
        )}

        {activeCategory === 'Performance' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[#9CA195] block mb-1">Max Acquisition Time (≤ 2.0s)</label>
              <input
                type="number"
                step="0.1"
                value={config.performance.max_acquisition_time_s}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    performance: { ...config.performance, max_acquisition_time_s: parseFloat(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Max Tracking Error (≤ 10.0 px)</label>
              <input
                type="number"
                step="0.5"
                value={config.performance.max_tracking_error_pixels}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    performance: { ...config.performance, max_tracking_error_pixels: parseFloat(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Max Target Loss (&lt; 5.0 %)</label>
              <input
                type="number"
                step="0.5"
                value={config.performance.max_target_loss_percent}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    performance: { ...config.performance, max_target_loss_percent: parseFloat(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-[#9CA195] block mb-1">Min Processing Speed (≥ 20.0 FPS)</label>
              <input
                type="number"
                min="20"
                value={config.performance.min_processing_speed_fps}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    performance: { ...config.performance, min_processing_speed_fps: parseFloat(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
