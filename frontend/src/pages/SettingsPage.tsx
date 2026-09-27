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
      setSaveStatus('Configuration successfully saved to backend JSON.');
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
        setSaveStatus('Reset to official Problem Statement 4 defaults.');
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
    a.setAttribute('download', `fsoc_config_${Date.now()}.json`);
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
        setSaveStatus('Imported and applied JSON configuration.');
        setTimeout(() => setSaveStatus(null), 3500);
      } catch (err: any) {
        alert(`Invalid configuration file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col gap-4 font-mono text-xs">
      {/* Header with Save, Load, Reset */}
      <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-cyan-400" />
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Central Configuration Management
            </h2>
            <p className="text-slate-400 text-[11px]">
              JSON-Backed Persistent Parameter Store (Problem Statement 4 Compliant)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-bold flex items-center gap-1.5 transition"
          >
            <Save className="w-4 h-4" /> Save Configuration
          </button>
          <label className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded font-bold flex items-center gap-1.5 cursor-pointer transition">
            <Upload className="w-4 h-4" /> Load JSON
            <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
          </label>
          <button
            onClick={handleExportJSON}
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded font-bold flex items-center gap-1.5 transition"
          >
            <Download className="w-4 h-4" /> Export JSON
          </button>
          <button
            onClick={handleReset}
            className="px-3.5 py-1.5 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded font-bold flex items-center gap-1.5 transition ml-2"
          >
            <RotateCcw className="w-4 h-4" /> Reset Defaults
          </button>
        </div>
      </div>

      {saveStatus && (
        <div className="p-3 bg-emerald-950/80 border border-emerald-700 text-emerald-300 rounded flex items-center gap-2 font-bold animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{saveStatus}</span>
        </div>
      )}

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-1 bg-slate-900/60 p-1.5 rounded-lg border border-slate-800">
        {(['Camera', 'Target', 'Motion', 'Detection', 'Tracking', 'Control', 'Disturbance', 'Performance'] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded font-bold transition text-xs ${
              activeCategory === cat
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-700 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Category Form Content */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5">
        {activeCategory === 'Camera' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-slate-400 block mb-1">Sensor Type</label>
              <input
                type="text"
                value={config.camera.sensor_type}
                onChange={(e) =>
                  onConfigChange({ ...config, camera: { ...config.camera, sensor_type: e.target.value } })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Resolution (Width × Height)</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  value={config.camera.resolution_width}
                  readOnly
                  className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-400"
                />
                <input
                  type="number"
                  value={config.camera.resolution_height}
                  readOnly
                  className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-400"
                />
              </div>
            </div>
            <div>
              <label className="text-slate-400 block mb-1">FOV (Horizontal × Vertical in Degrees)</label>
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
                  className="bg-slate-950 border border-slate-800 rounded p-2 text-white"
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
                  className="bg-slate-950 border border-slate-800 rounded p-2 text-white"
                />
              </div>
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Update Rate (Hz, Min 30)</label>
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
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Max Pan Slew Speed (°/s, Max 5.0)</label>
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
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Max Tilt Slew Speed (°/s, Max 5.0)</label>
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
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              />
            </div>
          </div>
        )}

        {activeCategory === 'Target' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-slate-400 block mb-1">Target Type</label>
              <input
                type="text"
                value={config.target.target_type}
                readOnly
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-400"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Target Shape (Square Mandatory)</label>
              <select
                value={config.target.shape}
                onChange={(e) =>
                  onConfigChange({ ...config, target: { ...config.target, shape: e.target.value as any } })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              >
                <option value="Square">Square</option>
                <option value="Circle">Circle</option>
              </select>
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Target Dimension (10x10 Pixels)</label>
              <input
                type="number"
                value={config.target.size_pixels}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    target: { ...config.target, size_pixels: parseInt(e.target.value) },
                  })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Initial Location Placement</label>
              <select
                value={config.target.initial_location_mode}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    target: { ...config.target, initial_location_mode: e.target.value as any },
                  })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
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
              <label className="text-slate-400 block mb-1">Mandatory Trajectory Type</label>
              <select
                value={config.motion.trajectory_type}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    motion: { ...config.motion, trajectory_type: e.target.value as any },
                  })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              >
                <option value="Straight Line">Straight Line</option>
                <option value="Circular">Circular</option>
                <option value="Figure of 8">Figure of 8</option>
                <option value="Random">Random</option>
              </select>
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Target Speed (Pixels / Second)</label>
              <input
                type="number"
                value={config.motion.speed_pixels_per_s}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    motion: { ...config.motion, speed_pixels_per_s: parseFloat(e.target.value) },
                  })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Screen World Width (Min 2000)</label>
              <input
                type="number"
                min="2000"
                value={config.motion.screen_width}
                readOnly
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-400"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Screen World Height (Min 2000)</label>
              <input
                type="number"
                min="2000"
                value={config.motion.screen_height}
                readOnly
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-400"
              />
            </div>
          </div>
        )}

        {activeCategory === 'Detection' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-slate-400 block mb-1">Detection Algorithm</label>
              <select
                value={config.detection.algorithm}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    detection: { ...config.detection, algorithm: e.target.value as any },
                  })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              >
                <option value="Threshold Centroid">Threshold Centroid</option>
                <option value="Blob Detector">Blob Detector</option>
                <option value="AI-CNN">AI-CNN</option>
                <option value="Bypass">Bypass (Ground Truth)</option>
              </select>
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Intensity Threshold (0-255)</label>
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
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              />
            </div>
          </div>
        )}

        {activeCategory === 'Tracking' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-slate-400 block mb-1">Filter Algorithm (Part 6)</label>
              <select
                value={config.tracking.algorithm}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    tracking: { ...config.tracking, algorithm: e.target.value as any },
                  })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              >
                <option value="None">None (Bypass)</option>
                <option value="Kalman Filter">Kalman Filter</option>
                <option value="Alpha-Beta">Alpha-Beta</option>
                <option value="Particle Filter">Particle Filter</option>
              </select>
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Update Interval (Hz, Min 20)</label>
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
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              />
            </div>
          </div>
        )}

        {activeCategory === 'Control' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-slate-400 block mb-1">Gimbal Loop Mode</label>
              <select
                value={config.control.mode}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    control: { ...config.control, mode: e.target.value as any },
                  })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              >
                <option value="Open Loop">Open Loop (Part 1)</option>
                <option value="PID Coarse Pointing">PID Coarse Pointing (Part 6)</option>
                <option value="State Feedback">State Feedback</option>
              </select>
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Pan PID Gains (Kp, Ki, Kd)</label>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  step="0.05"
                  value={config.control.kp_pan}
                  onChange={(e) =>
                    onConfigChange({ ...config, control: { ...config.control, kp_pan: parseFloat(e.target.value) } })
                  }
                  className="bg-slate-950 border border-slate-800 rounded p-2 text-white"
                />
                <input
                  type="number"
                  step="0.01"
                  value={config.control.ki_pan}
                  onChange={(e) =>
                    onConfigChange({ ...config, control: { ...config.control, ki_pan: parseFloat(e.target.value) } })
                  }
                  className="bg-slate-950 border border-slate-800 rounded p-2 text-white"
                />
                <input
                  type="number"
                  step="0.05"
                  value={config.control.kd_pan}
                  onChange={(e) =>
                    onConfigChange({ ...config, control: { ...config.control, kd_pan: parseFloat(e.target.value) } })
                  }
                  className="bg-slate-950 border border-slate-800 rounded p-2 text-white"
                />
              </div>
            </div>
          </div>
        )}

        {activeCategory === 'Disturbance' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-slate-400 block mb-1">Noise Generator</label>
              <select
                value={config.disturbance.noise_type}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    disturbance: { ...config.disturbance, noise_type: e.target.value as any },
                  })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              >
                <option value="None">None</option>
                <option value="Salt & Pepper">Salt & Pepper</option>
                <option value="Gaussian">Gaussian</option>
                <option value="Poisson">Poisson</option>
              </select>
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Max Noise Std Dev (Max 20 px)</label>
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
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Atmospheric Condition</label>
              <select
                value={config.disturbance.atmospheric_condition}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    disturbance: { ...config.disturbance, atmospheric_condition: e.target.value as any },
                  })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              >
                <option value="Clear">Clear</option>
                <option value="Haze">Haze</option>
                <option value="Fog">Fog</option>
                <option value="Rain">Rain</option>
                <option value="Low Light">Low Light</option>
              </select>
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Platform Motion (Linear Mandatory, Max ±20 px)</label>
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
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              />
            </div>
          </div>
        )}

        {activeCategory === 'Performance' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-slate-400 block mb-1">Max Acquisition Time (≤ 2.0s)</label>
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
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Max Tracking Error (≤ 10.0 px)</label>
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
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Max Target Loss (&lt; 5.0 %)</label>
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
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Min Processing Speed (≥ 20.0 FPS)</label>
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
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
