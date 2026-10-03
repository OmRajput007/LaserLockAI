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
    <div className="flex flex-col gap-4 font-mono text-xs text-[#F0FFEA]">
      {/* Page Header */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-4 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#262824] border border-[#33362F] flex items-center justify-center text-[#FF5F40]">
            <Video className="w-4 h-4 text-[#FF5F40]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#F0FFEA]">
              Monochrome Focal Plane Array (FPA) Camera View
            </h2>
            <p className="text-[#9CA195] text-xs mt-0.5">
              640 × 480 Resolution • 4.0° × 3.0° Field of View • Calibrated Pin-Hole Projection
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
                <span className={`w-2 h-2 rounded-full ${inFov ? 'bg-[#FF5F40]' : 'bg-[#5E625A]'}`} />
                <span className={inFov ? 'text-[#FF5F40] font-bold' : 'text-[#9CA195]'}>
                  {inFov ? '✓ Inside FOV' : '✕ Clipped (Outside FOV)'}
                </span>
              </div>
            </div>
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#9CA195]">Pixel Coordinates (u, v):</span>
              <span className="text-[#F0FFEA] font-medium">
                {target?.pixel_x !== null ? `(${target?.pixel_x.toFixed(1)}, ${target?.pixel_y?.toFixed(1)})` : '--'}
              </span>
            </div>
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#9CA195]">Bearing in Lens (Az, El):</span>
              <span className="text-[#F0FFEA] font-medium">
                {target?.azimuth_cam_deg !== null ? `Az: ${target?.azimuth_cam_deg.toFixed(2)}° • El: ${target?.elevation_cam_deg?.toFixed(2)}°` : '--'}
              </span>
            </div>
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#9CA195]">Target Range Depth:</span>
              <span className="text-[#F0FFEA] font-medium">{target?.world_z.toFixed(1)} m</span>
            </div>
            <div className="flex justify-between border-t border-[#33362F] pt-2 font-mono text-xs">
              <span className="text-[#9CA195]">Pointing Error:</span>
              <span className={`font-semibold ${telemetry?.tracking.is_locked ? 'text-[#FF5F40]' : 'text-[#F0FFEA]'}`}>
                {telemetry?.tracking.total_error_px !== null ? `${telemetry?.tracking.total_error_px.toFixed(2)} px` : '--'}
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
              <span className="text-[#F0FFEA] font-medium">{telemetry?.camera.pan_deg.toFixed(2)}°</span>
            </div>
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#9CA195]">Current Tilt Angle:</span>
              <span className="text-[#F0FFEA] font-medium">{telemetry?.camera.tilt_deg.toFixed(2)}°</span>
            </div>
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#9CA195]">Pan Slew Speed:</span>
              <span className="text-[#FF5F40] font-medium">{telemetry?.camera.pan_rate_deg_s.toFixed(1)}°/s (Max 5.0°/s)</span>
            </div>
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#9CA195]">Tilt Slew Speed:</span>
              <span className="text-[#FF5F40] font-medium">{telemetry?.camera.tilt_rate_deg_s.toFixed(1)}°/s (Max 5.0°/s)</span>
            </div>
            <div className="flex justify-between border-t border-[#33362F] pt-2 text-xs">
              <span className="text-[#9CA195]">Actuator Limits:</span>
              <span className="text-[#F0FFEA] font-mono">Pan ±180° • Tilt ±85°</span>
            </div>
          </div>

          {/* FOV Clipping Rule Info */}
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-3.5 space-y-1.5 text-xs text-[#9CA195]">
            <div className="text-[#F0FFEA] font-medium flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-[#FF5F40]" /> Field of View Clipping
            </div>
            <p className="leading-relaxed text-[11px] text-[#9CA195]">
              When the beacon trajectory moves beyond the 4° × 3° frustum cone or behind the camera (Z_c ≤ 0), the optical spot is clipped and will not register on the focal plane array.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
