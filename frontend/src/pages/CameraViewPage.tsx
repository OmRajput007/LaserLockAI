import React from 'react';
import { SimulationTelemetry, SystemConfig } from '../types';
import { FPACameraViewport } from '../simulation/FPACameraViewport';
import { Video, Sliders, Info, Compass } from 'lucide-react';

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
    <div className="flex flex-col gap-4 font-sans text-xs text-slate-200">
      {/* Page Header */}
      <div className="bg-[#121518] border border-[#252A2E] p-4 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-[#1E2124] border border-[#3A4048] flex items-center justify-center text-[#D6D9DC]">
            <Video className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Monochrome Focal Plane Array (FPA) Camera View
            </h2>
            <p className="text-slate-400 text-xs mt-0.5">
              640 × 480 Resolution • 4.0° × 3.0° Field of View • Calibrated Pin-Hole Projection
            </p>
          </div>
        </div>

        {/* Spot Shape Selector */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-xs font-medium">Beacon Profile:</span>
          {(['Square', 'Circle', 'Gaussian'] as const).map((s) => (
            <button
              key={s}
              onClick={() => onSelectShape(s)}
              className={`px-3 py-1 rounded text-xs font-medium border transition ${
                config?.target.shape === s
                  ? 'bg-[#1E2124] text-[#E8EAED] border-[#3A4048]'
                  : 'bg-[#1A1D20] text-slate-400 border-[#2D3237] hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Main Viewport & Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-lg overflow-hidden border border-[#252A2E] bg-[#0D1012]">
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
          {/* Projection Telemetry */}
          <div className="bg-[#121518] border border-[#252A2E] rounded-lg p-4 space-y-2.5">
            <h3 className="text-xs font-semibold text-slate-200 border-b border-[#252A2E] pb-2 flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-slate-400" />
              Camera Projection Telemetry
            </h3>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Sensor Status:</span>
              <div className="flex items-center gap-1.5 font-medium">
                <span className={`w-2 h-2 rounded-full ${inFov ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                <span className={inFov ? 'text-emerald-400' : 'text-rose-400'}>
                  {inFov ? 'Inside FOV' : 'Clipped (Outside FOV)'}
                </span>
              </div>
            </div>
            <div className="flex justify-between num-mono text-xs">
              <span className="text-slate-400 font-sans">Pixel Coordinates (u, v):</span>
              <span className="text-slate-100 font-medium">
                {target?.pixel_x !== null ? `(${target?.pixel_x.toFixed(1)}, ${target?.pixel_y?.toFixed(1)})` : '--'}
              </span>
            </div>
            <div className="flex justify-between num-mono text-xs">
              <span className="text-slate-400 font-sans">Bearing in Lens (Az, El):</span>
              <span className="text-[#E8EAED] font-medium">
                {target?.azimuth_cam_deg !== null ? `Az: ${target?.azimuth_cam_deg.toFixed(2)}° • El: ${target?.elevation_cam_deg?.toFixed(2)}°` : '--'}
              </span>
            </div>
            <div className="flex justify-between num-mono text-xs">
              <span className="text-slate-400 font-sans">Target Range Depth:</span>
              <span className="text-slate-100 font-medium">{target?.world_z.toFixed(1)} m</span>
            </div>
            <div className="flex justify-between border-t border-[#252A2E] pt-2 num-mono text-xs">
              <span className="text-slate-400 font-sans">Pointing Error:</span>
              <span className={`font-semibold ${telemetry?.tracking.is_locked ? 'text-emerald-400' : 'text-amber-400'}`}>
                {telemetry?.tracking.total_error_px !== null ? `${telemetry?.tracking.total_error_px.toFixed(2)} px` : '--'}
              </span>
            </div>
          </div>

          {/* Gimbal Kinematics & Limits */}
          <div className="bg-[#121518] border border-[#252A2E] rounded-lg p-4 space-y-2.5">
            <h3 className="text-xs font-semibold text-slate-200 border-b border-[#252A2E] pb-2 flex items-center gap-2">
              <Compass className="w-3.5 h-3.5 text-slate-400" />
              Gimbal Kinematics & Actuator Limits
            </h3>
            <div className="flex justify-between num-mono text-xs">
              <span className="text-slate-400 font-sans">Current Pan Angle:</span>
              <span className="text-slate-100 font-medium">{telemetry?.camera.pan_deg.toFixed(2)}°</span>
            </div>
            <div className="flex justify-between num-mono text-xs">
              <span className="text-slate-400 font-sans">Current Tilt Angle:</span>
              <span className="text-slate-100 font-medium">{telemetry?.camera.tilt_deg.toFixed(2)}°</span>
            </div>
            <div className="flex justify-between num-mono text-xs">
              <span className="text-slate-400 font-sans">Pan Slew Speed:</span>
              <span className="text-emerald-400 font-medium">{telemetry?.camera.pan_rate_deg_s.toFixed(1)}°/s (Max 5.0°/s)</span>
            </div>
            <div className="flex justify-between num-mono text-xs">
              <span className="text-slate-400 font-sans">Tilt Slew Speed:</span>
              <span className="text-emerald-400 font-medium">{telemetry?.camera.tilt_rate_deg_s.toFixed(1)}°/s (Max 5.0°/s)</span>
            </div>
            <div className="flex justify-between border-t border-[#252A2E] pt-2 text-xs">
              <span className="text-slate-400">Actuator Limits:</span>
              <span className="text-slate-300 num-mono">Pan ±180° • Tilt ±85°</span>
            </div>
          </div>

          {/* FOV Clipping Rule Info */}
          <div className="bg-[#121518] border border-[#252A2E] rounded-lg p-3.5 space-y-1.5 text-xs text-slate-400">
            <div className="text-slate-300 font-medium flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-[#D6D9DC]" /> Field of View Clipping
            </div>
            <p className="leading-relaxed text-[11px] text-slate-400">
              When the beacon trajectory moves beyond the 4° × 3° frustum cone or behind the camera ($Z_c \le 0$), the optical spot is clipped and will not register on the focal plane array.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
