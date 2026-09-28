import React from 'react';
import { SimulationTelemetry, SystemConfig } from '../types';
import { FPACameraViewport } from '../simulation/FPACameraViewport';
import { Video, Sliders, Info, Zap, Eye, EyeOff } from 'lucide-react';

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
  const inFov = target?.is_in_fov ?? false;

  return (
    <div className="flex flex-col gap-4 font-mono text-xs">
      {/* Banner */}
      <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Video className="w-5 h-5 text-cyan-400" />
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Monochrome Focal Plane Array (FPA) Camera View
            </h2>
            <p className="text-slate-400 text-[11px]">
              640 × 480 Resolution | 4.0° × 3.0° Field of View | True 3D Pin-Hole Projection
            </p>
          </div>
        </div>

        {/* Spot Shape Selector */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Spot Shape:</span>
          {(['Square', 'Circle', 'Gaussian'] as const).map((s) => (
            <button
              key={s}
              onClick={() => onSelectShape(s)}
              className={`px-2.5 py-1 rounded text-[11px] font-bold border transition ${
                config?.target.shape === s
                  ? 'bg-cyan-950 text-cyan-300 border-cyan-500 shadow-sm'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Main Viewport & Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <FPACameraViewport
            target={target}
            camera={telemetry?.camera ?? null}
            tracking={telemetry?.tracking ?? null}
            detection={telemetry?.detection ?? null}
            disturbance={telemetry?.disturbance ?? null}
            onGimbalNudge={onGimbalNudge}
            onGimbalAngles={onGimbalAngles}
          />
        </div>

        <div className="flex flex-col gap-3">
          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 space-y-2.5">
            <h3 className="text-cyan-400 font-bold border-b border-slate-800 pb-1.5 uppercase tracking-wider flex items-center gap-2">
              <Sliders className="w-4 h-4 text-cyan-400" />
              Camera Projection Telemetry
            </h3>
            <div className="flex justify-between">
              <span className="text-slate-400">Sensor Status:</span>
              <span className={inFov ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                {inFov ? 'TARGET IN FOV' : 'TARGET CLIPPED (OUT OF FOV)'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Pixel Coordinates (u, v):</span>
              <span className="text-white font-bold">
                {target?.pixel_x !== null ? `(${target?.pixel_x.toFixed(1)}, ${target?.pixel_y?.toFixed(1)})` : '--'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Bearing in Lens (Az, El):</span>
              <span className="text-cyan-300 font-bold">
                {target?.azimuth_cam_deg !== null ? `Az: ${target?.azimuth_cam_deg.toFixed(2)}° | El: ${target?.elevation_cam_deg?.toFixed(2)}°` : '--'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Target Range Depth:</span>
              <span className="text-white font-bold">{target?.world_z.toFixed(1)} m</span>
            </div>
            <div className="flex justify-between border-t border-slate-800/60 pt-1.5">
              <span className="text-slate-400">Pointing Error:</span>
              <span className={`font-bold ${telemetry?.tracking.is_locked ? 'text-emerald-400' : 'text-amber-400'}`}>
                {telemetry?.tracking.total_error_px !== null ? `${telemetry?.tracking.total_error_px.toFixed(2)} px` : '--'}
              </span>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 space-y-2.5">
            <h3 className="text-cyan-400 font-bold border-b border-slate-800 pb-1.5 uppercase tracking-wider flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-400" />
              Gimbal Kinematics & Limits
            </h3>
            <div className="flex justify-between">
              <span className="text-slate-400">Current Pan Angle:</span>
              <span className="text-white font-bold">{telemetry?.camera.pan_deg.toFixed(2)}°</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Current Tilt Angle:</span>
              <span className="text-white font-bold">{telemetry?.camera.tilt_deg.toFixed(2)}°</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Pan Slew Speed:</span>
              <span className="text-emerald-400 font-bold">{telemetry?.camera.pan_rate_deg_s.toFixed(1)}°/s (Max 5.0°/s)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Tilt Slew Speed:</span>
              <span className="text-emerald-400 font-bold">{telemetry?.camera.tilt_rate_deg_s.toFixed(1)}°/s (Max 5.0°/s)</span>
            </div>
            <div className="flex justify-between border-t border-slate-800/60 pt-1.5">
              <span className="text-slate-400">Gimbal Stop Limits:</span>
              <span className="text-slate-300">Pan ±180° | Tilt ±85°</span>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 space-y-1.5 text-[11px] text-slate-400">
            <div className="text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> FOV Clipping Rule
            </div>
            <p className="leading-relaxed">
              When the beacon trajectory takes it beyond the 4° × 3° frustum cone or behind the camera ($Z_c \le 0$), the target is strictly clipped and does not render on the sensor.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
