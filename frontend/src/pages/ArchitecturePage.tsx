import React from 'react';
import { Network, Layers, GitBranch, ArrowRight } from 'lucide-react';

export const ArchitecturePage: React.FC = () => {
  const parts = [
    { num: 'Part 1', title: 'Foundation & Virtual Environment', desc: 'Shell, Backend, Frontend, Config, 2000x2000 Scene, FPA 640x480 View', done: true },
    { num: 'Part 2', title: 'Target Generation, Camera Model & 3D FOV', desc: '3D Kinematics, 8 Trajectories, Shapes, Pin-Hole Projection, Three.js 3D Scene', done: true },
    { num: 'Part 3', title: 'Optical Beacon Modeling', desc: 'Physical intensity, square spot geometry, radiant divergence', done: false },
    { num: 'Part 4', title: 'Gimbal Actuator Dynamics', desc: 'Pan/Tilt mechanics, slew constraints (5°/s), motor friction', done: false },
    { num: 'Part 5', title: 'Computer Vision & AI Detection', desc: 'Centroid estimation, OpenCV contours, Light-CNN spot detector', done: false },
    { num: 'Part 6', title: 'Tracking & Closed-Loop Control', desc: 'Discrete Kalman Filter, 2-axis PID coarse pointing controller', done: false },
    { num: 'Part 7', title: 'Atmospheric & Noise Disturbances', desc: 'Salt & Pepper, Gaussian, Poisson, platform vibrations, fog/rain', done: false },
    { num: 'Part 8', title: 'Video Benchmark Suite', desc: 'MP4 flight sequence ingestion and synthetic dataset validation', done: false },
    { num: 'Part 9', title: 'Experimentation Testbench', desc: 'Automated test suite, Monte Carlo sweeps, repeatability checks', done: false },
    { num: 'Part 10', title: 'Performance Analytics & Reports', desc: 'Automated PDF/HTML/JSON report generation and PS4 compliance signoff', done: false },
  ];

  return (
    <div className="flex flex-col gap-4 font-mono text-xs">
      <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Network className="w-5 h-5 text-cyan-400" />
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              10-Part Modular System Architecture
            </h2>
            <p className="text-slate-400 text-[11px]">
              End-to-End Coarse Pointing, Acquisition and Tracking (PAT) Testbench Pipeline
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {parts.map((p) => (
          <div
            key={p.num}
            className={`p-4 rounded-lg border transition ${
              p.done
                ? 'bg-slate-900/90 border-cyan-500/60 shadow-lg'
                : 'bg-slate-900/40 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`font-bold text-sm ${p.done ? 'text-cyan-400' : 'text-slate-400'}`}>
                {p.num}: {p.title}
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  p.done
                    ? 'bg-emerald-950 border border-emerald-700 text-emerald-300'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {p.done ? 'COMPLETED (PART 1)' : 'UPCOMING'}
              </span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">{p.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
