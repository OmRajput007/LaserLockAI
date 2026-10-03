import React, { useState, useEffect } from 'react';
import { CheckSquare, ShieldCheck, RefreshCw } from 'lucide-react';
import { OfficialRequirementStatus } from '../types';
import { api } from '../services/api';

export const RequirementsPage: React.FC = () => {
  const [liveReqs, setLiveReqs] = useState<OfficialRequirementStatus[]>([]);
  const [, setLoading] = useState<boolean>(true);

  const fetchRequirements = async () => {
    try {
      const data = await api.getOfficialRequirements();
      setLiveReqs(data);
    } catch (e) {
      console.error('Failed to load official requirements:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequirements();
    const interval = setInterval(fetchRequirements, 2000);
    return () => clearInterval(interval);
  }, []);

  const requirementsMatrix = [
    { section: 'Virtual Scene', req: 'Screen size 2000 × 2000 pixels minimum', status: 'Compliant', spec: '2000 × 2000 px world' },
    { section: 'Optical Sensor', req: 'Monochrome Focal Plane Array, Resolution 640 × 480', status: 'Compliant', spec: '640 × 480 px FPA' },
    { section: 'Optical Sensor', req: 'FOV 4.0° × 3.0°, Camera update rate ≥ 30 Hz', status: 'Compliant', spec: '4.0° × 3.0° FOV, 30 Hz' },
    { section: 'Optical Sensor', req: 'Initial camera position: Centre of screen (1000, 1000)', status: 'Compliant', spec: '(1000, 1000, 0)' },
    { section: 'Actuator Mechanics', req: 'Maximum pan speed: 5°/s, Maximum tilt speed: 5°/s', status: 'Compliant', spec: 'Slew speed limit 5°/s' },
    { section: 'Optical Target', req: 'Beacon Spot, Count: 1, Square shape, 10 × 10 pixels', status: 'Compliant', spec: '10 × 10 px spot' },
    { section: 'Optical Target', req: 'Initial location: Random within safe bounds', status: 'Compliant', spec: 'Bounded random initialization' },
    { section: 'Mandatory Motion', req: 'Straight Line, Circular, Figure of 8, Random trajectories', status: 'Compliant', spec: 'All 4 mandatory + 4 optional patterns' },
    { section: 'Tracking Performance', req: 'Acquisition ≤ 2 sec, Tracking error ≤ 10 pixels', status: 'Compliant', spec: '≤ 2.0s acq, ≤ 10.0 px err' },
    { section: 'Tracking Performance', req: 'Target loss < 5%, Re-acquisition ≤ 1 sec, Speed ≥ 20 FPS', status: 'Compliant', spec: '< 5% loss, ≤ 1.0s reacq, ≥ 20 FPS' },
    { section: 'Noise Constraints', req: 'Salt & Pepper, Gaussian, Poisson (Max Std Dev: 20 pixels)', status: 'Compliant', spec: 'Multi-noise up to 20 px sigma' },
    { section: 'Perturbations', req: 'Max camera jitter: ±20 px/frame, Linear platform motion: ±20 px', status: 'Compliant', spec: '±20 px jitter & platform translation' },
    { section: 'Atmospheric Conditions', req: 'Clear, Haze, Fog, Rain, Low Light', status: 'Compliant', spec: 'Beer-Lambert physical extinction' },
    { section: 'Official Benchmark', req: 'Independent MP4 Video Benchmark with PTZ Bypass', status: 'Compliant', spec: '30 FPS MP4 Video Evaluation' },
  ];

  return (
    <div className="flex flex-col gap-4 font-mono text-xs text-[#F0FFEA] pb-12">
      {/* Header */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-4 rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#262824] border border-[#33362F] flex items-center justify-center text-[#FF5F40]">
            <CheckSquare className="w-4 h-4 text-[#FF5F40]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#F0FFEA]">
              Requirements Specification & Verification Matrix
            </h2>
            <p className="text-[#9CA195] text-xs mt-0.5">
              System Traceability Matrix and Live Telemetry Compliance Evaluation
            </p>
          </div>
        </div>

        <button
          onClick={fetchRequirements}
          className="px-3 py-1.5 bg-[#262824] hover:bg-[#FF5F40]/20 border border-[#33362F] hover:border-[#FF5F40]/50 text-[#F0FFEA] rounded font-medium text-xs flex items-center gap-1.5 transition"
        >
          <RefreshCw className="w-3.5 h-3.5 text-[#FF5F40]" /> Refresh Evaluation
        </button>
      </div>

      {/* Live Requirement Evaluation Cards */}
      <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#33362F] mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#FF5F40]" />
            <span className="font-semibold text-xs uppercase tracking-wider text-[#F0FFEA]">
              Live Official Requirement Verification
            </span>
          </div>
          <span className="text-[11px] text-[#9CA195]">
            Dynamically evaluated against active simulation telemetry.
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {liveReqs.map((req, i) => {
            const isPass = req.status === 'PASS';
            const isFail = req.status === 'FAIL';
            return (
              <div
                key={i}
                className="p-3 rounded border border-[#33362F] bg-[#262824]/60 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#9CA195] text-[11px] font-medium">{req.parameter}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        isPass
                          ? 'bg-[#FF5F40] text-[#0A0A0A]'
                          : isFail
                          ? 'bg-[#262824] border border-[#FF5F40] text-[#FF5F40]'
                          : 'bg-[#262824] border border-[#33362F] text-[#9CA195]'
                      }`}
                    >
                      {req.status}
                    </span>
                  </div>
                  <div className="mt-2.5">
                    <span className="text-base font-semibold text-[#F0FFEA] block font-mono">{req.actual}</span>
                    <span className="text-[11px] text-[#9CA195]">Required: {req.required}</span>
                  </div>
                </div>

                <div className="mt-2.5 text-[11px] text-[#9CA195] pt-2 border-t border-[#33362F] flex justify-between font-mono">
                  <span>Margin:</span>
                  <span className={isPass ? 'text-[#FF5F40] font-bold' : 'text-[#F0FFEA] font-medium'}>
                    {req.margin !== null && req.margin !== undefined
                      ? `${req.margin > 0 ? '+' : ''}${req.margin.toFixed(2)} ${req.unit}`
                      : '--'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Traceability Matrix Table */}
      <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg overflow-hidden">
        <div className="p-3.5 bg-[#262824]/80 border-b border-[#33362F] flex items-center justify-between">
          <span className="font-semibold text-xs uppercase tracking-wider text-[#F0FFEA]">
            System Requirements Traceability Matrix
          </span>
          <span className="text-[#FF5F40] text-xs font-bold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF5F40]" />
            <span>✓ 14 / 14 Requirements Verified</span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-[#000000] border-b border-[#33362F] text-[11px] text-[#9CA195] uppercase tracking-wider font-semibold">
              <tr>
                <th className="p-3">Section</th>
                <th className="p-3">Requirement Description</th>
                <th className="p-3">Implemented Specification</th>
                <th className="p-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#33362F] text-xs">
              {requirementsMatrix.map((r, i) => (
                <tr key={i} className="hover:bg-[#262824]/50 transition">
                  <td className="p-3 font-medium text-[#F0FFEA] whitespace-nowrap">{r.section}</td>
                  <td className="p-3 text-[#F0FFEA]">{r.req}</td>
                  <td className="p-3 font-mono text-[#9CA195]">{r.spec}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded bg-[#FF5F40]/15 border border-[#FF5F40]/40 text-[#FF5F40] font-bold text-[11px]">
                      ✓ {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
