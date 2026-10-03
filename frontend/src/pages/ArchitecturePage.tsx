import React from 'react';
import { Network, CheckCircle2 } from 'lucide-react';

export const ArchitecturePage: React.FC = () => {
  const modules = [
    { title: 'Foundation & Virtual Environment', desc: 'FastAPI Backend, React/Vite SPA, Config Manager, 2000x2000 m Simulation Scene, 640x480 FPA Sensor Model' },
    { title: 'Target Generation, Camera Model & 3D Optics', desc: '3D Kinematics, 8 Trajectory Generators, Beacon Geometries, Pin-Hole Projection, WebGL/Three.js Digital Twin' },
    { title: 'Optical Beacon Modeling', desc: 'Calibrated radiant intensity, square/circular spot profiles, Gaussian divergence, and range depth scaling' },
    { title: 'Gimbal Actuator Dynamics', desc: 'Two-axis pan/tilt mechanics, actuator slew rate limit (5.0°/s), position stops, and velocity control' },
    { title: 'Computer Vision & AI Detection', desc: 'Centroid estimation, OpenCV adaptive thresholding, morphological filtering, and AI neural detector' },
    { title: 'Tracking & Closed-Loop Control', desc: 'Discrete Kalman Filter state prediction, 2-axis PID coarse pointing controller, and lock-gate logic' },
    { title: 'Atmospheric & Noise Disturbances', desc: 'Salt & Pepper, Gaussian sensor noise, platform angular jitter, and atmospheric optical transmission' },
    { title: 'Video Benchmark Suite', desc: 'Decoupled MP4 flight video ingestion, ground truth overlay, and PTZ-bypass detection benchmark' },
    { title: 'Experimentation Testbench', desc: 'Automated Monte Carlo sweeps, parameter sensitivity testing, and repeatability verification' },
    { title: 'Performance Analytics & Reports', desc: 'PDF, JSON, and HTML automated compliance reports, lock-on metrics, and PSD disturbance analysis' },
  ];

  return (
    <div className="flex flex-col gap-4 font-mono text-xs text-[#F0FFEA]">
      {/* Header */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-4 rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#262824] border border-[#33362F] flex items-center justify-center text-[#FF5F40]">
            <Network className="w-4 h-4 text-[#FF5F40]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#F0FFEA]">
              System Architecture & Subsystem Modules
            </h2>
            <p className="text-[#9CA195] text-xs mt-0.5">
              Modular Coarse Pointing, Acquisition and Tracking (PAT) Platform Architecture
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#FF5F40]/15 border border-[#FF5F40]/40 text-[#FF5F40] text-xs font-bold">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#FF5F40]" />
          <span>✓ All Subsystems Operational</span>
        </div>
      </div>

      {/* Modules Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {modules.map((m) => (
          <div
            key={m.title}
            className="p-4 rounded-lg border border-[#33362F] bg-[#1B1D1A] hover:border-[#FF5F40]/50 transition flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-xs text-[#F0FFEA] uppercase tracking-wide">
                  {m.title}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#262824] border border-[#33362F] text-[#FF5F40]">
                  ✓ Integrated
                </span>
              </div>
              <p className="text-[#9CA195] text-xs leading-relaxed">{m.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
