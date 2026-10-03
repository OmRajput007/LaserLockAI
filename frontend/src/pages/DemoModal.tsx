import React, { useState, useEffect } from 'react';
import {
  Play,
  Film,
  Square,
  CheckCircle2,
  Clock,
  Zap,
  FileText,
  X,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../services/api';
import { DemoStatusResponse } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToReports: () => void;
}

export const DemoModal: React.FC<Props> = ({ isOpen, onClose, onNavigateToReports }) => {
  const [demoStatus, setDemoStatus] = useState<DemoStatusResponse | null>(null);
  const [stepDuration, setStepDuration] = useState<number>(12.0);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Poll status while open
  useEffect(() => {
    if (!isOpen) return;

    const fetchStatus = async () => {
      try {
        const s = await api.getDemoStatus();
        setDemoStatus(s);
      } catch (e: any) {
        // ignore polling errors
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 500);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleStartSimDemo = async () => {
    try {
      setIsStarting(true);
      setErrorMsg(null);
      await api.startSimulationDemo(stepDuration);
      const s = await api.getDemoStatus();
      setDemoStatus(s);
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to start simulation demonstration');
    } finally {
      setIsStarting(false);
    }
  };

  const handleStartVideoDemo = async () => {
    try {
      setIsStarting(true);
      setErrorMsg(null);
      await api.startVideoDemo(Math.min(stepDuration, 4.0));
      const s = await api.getDemoStatus();
      setDemoStatus(s);
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to start video benchmark demonstration');
    } finally {
      setIsStarting(false);
    }
  };

  const handleStopDemo = async () => {
    try {
      await api.stopDemo();
      const s = await api.getDemoStatus();
      setDemoStatus(s);
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to stop demonstration');
    }
  };

  const isRunning = demoStatus?.is_running ?? false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#000000]/80 backdrop-blur-sm p-4 font-mono text-xs text-[#F0FFEA]">
      <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 bg-[#000000] border-b border-[#33362F] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#262824] border border-[#33362F] flex items-center justify-center text-[#FF5F40]">
              <Zap className="w-4 h-4 text-[#FF5F40]" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[#F0FFEA]">
                  Automated Demonstration Mode
                </h3>
                {isRunning && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#FF5F40]/15 text-[#FF5F40] border border-[#FF5F40]/40 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#FF5F40] animate-pulse" />
                    Running {demoStatus?.demo_type}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#9CA195] mt-0.5">
                Autonomous Closed-Loop PAT Alignment & Video Benchmark Evaluation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#9CA195] hover:text-[#F0FFEA] hover:bg-[#262824] rounded transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="bg-[#262824] border-b border-[#FF5F40] p-3 text-[#FF5F40] flex items-center gap-2 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 text-[#FF5F40]" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Quick Trigger Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Start Simulation Demo */}
            <button
              onClick={handleStartSimDemo}
              disabled={isRunning || isStarting}
              className={`p-4 rounded-lg border text-left flex flex-col justify-between transition ${
                isRunning
                  ? 'bg-[#262824]/40 border-[#33362F] opacity-50'
                  : 'bg-[#262824] border-[#33362F] hover:border-[#FF5F40]/50 hover:bg-[#262824]/80 text-[#F0FFEA]'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="px-2 py-0.5 bg-[#1B1D1A] text-[#FF5F40] rounded text-[10px] font-bold border border-[#33362F]">
                  Simulation Sequence
                </span>
                <Play className="w-4 h-4 text-[#FF5F40]" />
              </div>
              <div className="mt-3">
                <div className="font-semibold text-sm text-[#F0FFEA] uppercase tracking-wide">Autonomous Simulation</div>
                <div className="text-xs text-[#9CA195] mt-1 leading-relaxed">
                  Search • Detect • Acquire • Lock • Disturbance • Loss • Reacquire • Report
                </div>
              </div>
            </button>

            {/* Start Video Benchmark Demo */}
            <button
              onClick={handleStartVideoDemo}
              disabled={isRunning || isStarting}
              className={`p-4 rounded-lg border text-left flex flex-col justify-between transition ${
                isRunning
                  ? 'bg-[#262824]/40 border-[#33362F] opacity-50'
                  : 'bg-[#262824] border-[#33362F] hover:border-[#FF5F40]/50 hover:bg-[#262824]/80 text-[#F0FFEA]'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="px-2 py-0.5 bg-[#1B1D1A] text-[#FF5F40] rounded text-[10px] font-bold border border-[#33362F]">
                  Video Benchmark
                </span>
                <Film className="w-4 h-4 text-[#FF5F40]" />
              </div>
              <div className="mt-3">
                <div className="font-semibold text-sm text-[#F0FFEA] uppercase tracking-wide">Video Dataset Demo</div>
                <div className="text-xs text-[#9CA195] mt-1 leading-relaxed">
                  Ingest MP4 • Detect • Track • PTZ Bypass • Benchmark Metrics • Report
                </div>
              </div>
            </button>

            {/* Execution Controls & Settings */}
            <div className="bg-[#262824] border border-[#33362F] p-4 rounded-lg flex flex-col justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-[#F0FFEA] mb-1.5">
                  Phase Duration Preset
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { label: '12s (Standard)', val: 12.0 },
                    { label: '3s (Fast)', val: 3.0 },
                    { label: '0.5s (Rapid)', val: 0.5 },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      onClick={() => setStepDuration(preset.val)}
                      disabled={isRunning}
                      className={`px-2 py-1.5 rounded text-xs font-mono transition border ${
                        stepDuration === preset.val
                          ? 'bg-[#FF5F40] text-[#0A0A0A] font-bold border-[#FF5F40]'
                          : 'bg-[#1B1D1A] text-[#9CA195] border-[#33362F] hover:text-[#F0FFEA]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {isRunning ? (
                <button
                  onClick={handleStopDemo}
                  className="mt-3 w-full py-2 bg-[#262824] border border-[#FF5F40] text-[#FF5F40] hover:bg-[#FF5F40]/15 rounded font-bold text-xs flex items-center justify-center gap-1.5 transition uppercase tracking-wider"
                >
                  <Square className="w-3.5 h-3.5 text-[#FF5F40]" />
                  Halt Demonstration
                </button>
              ) : (
                <div className="mt-3 text-[11px] text-[#9CA195] text-center">
                  Recommended: 12s per phase for complete demonstration.
                </div>
              )}
            </div>
          </div>

          {/* Active Phase Banner & Progress Bar */}
          {demoStatus && demoStatus.total_steps > 0 && (
            <div className="bg-[#262824] border border-[#33362F] rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[#F0FFEA]">Progress:</span>
                  <span className="text-[#FF5F40] font-bold font-mono">
                    Step {demoStatus.current_step} of {demoStatus.total_steps}
                  </span>
                  <span className="text-[#33362F]">•</span>
                  <span className="text-[#F0FFEA] font-medium">{demoStatus.current_step_name}</span>
                </div>
                <div className="text-[#9CA195] font-mono flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-[#9CA195]" />
                  <span>Elapsed: {demoStatus.elapsed_time_s.toFixed(1)}s</span>
                  <span className="text-[#F0FFEA] font-bold">({demoStatus.progress_percent}%)</span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="h-2 bg-[#000000] rounded-full overflow-hidden border border-[#33362F]">
                <div
                  className="h-full bg-[#FF5F40] transition-all duration-300"
                  style={{ width: `${demoStatus.progress_percent}%` }}
                />
              </div>

              <div className="text-xs text-[#9CA195]">
                {demoStatus.current_step_desc || 'Ready to start demonstration.'}
              </div>

              {demoStatus.latest_report_id && (
                <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[#FF5F40] font-bold text-xs">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-[#FF5F40]" />
                    <span>✓ Report Generated: {demoStatus.latest_report_id}</span>
                  </div>
                  <button
                    onClick={() => {
                      onClose();
                      onNavigateToReports();
                    }}
                    className="px-3 py-1.5 bg-[#FF5F40] hover:bg-[#FF7459] text-[#0A0A0A] rounded font-bold flex items-center gap-1.5 transition text-xs uppercase tracking-wider"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    View Performance Report
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Phase-by-Phase Sequence Progression */}
          {demoStatus && demoStatus.steps && demoStatus.steps.length > 0 && (
            <div className="bg-[#262824] border border-[#33362F] rounded-lg p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#F0FFEA] mb-3">
                Demonstration Sequence Progression ({demoStatus.steps.length} Steps)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {demoStatus.steps.map((st) => (
                  <div
                    key={st.step_number}
                    className={`p-2.5 rounded border flex items-start gap-2.5 transition ${
                      st.active
                        ? 'bg-[#FF5F40]/15 border-[#FF5F40]/40 text-[#F0FFEA]'
                        : st.completed
                        ? 'bg-[#1B1D1A] border-[#33362F] text-[#F0FFEA]'
                        : 'bg-[#000000]/40 border-[#33362F] text-[#9CA195]'
                    }`}
                  >
                    <div className="shrink-0 mt-0.5">
                      {st.completed ? (
                        <CheckCircle2 className="w-4 h-4 text-[#FF5F40]" />
                      ) : st.active ? (
                        <span className="w-4 h-4 rounded-full border-2 border-[#FF5F40] border-t-transparent animate-spin inline-block" />
                      ) : (
                        <span className="w-4 h-4 rounded-full border border-[#33362F] flex items-center justify-center text-[10px] font-mono text-[#9CA195]">
                          {st.step_number}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-xs text-[#F0FFEA]">
                        {st.name}
                      </div>
                      <div className="text-[11px] text-[#9CA195] mt-0.5 leading-snug">{st.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-[#000000] border-t border-[#33362F] flex items-center justify-between text-xs text-[#9CA195]">
          <span>Problem Statement 4 Demonstration Protocol</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#262824] hover:bg-[#FF5F40]/20 text-[#F0FFEA] rounded font-medium transition border border-[#33362F]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
