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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 font-sans text-xs text-slate-200">
      <div className="bg-[#111417] border border-[#252A2E] rounded-xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 bg-[#0D1012] border-b border-[#252A2E] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-[#1E2124] border border-[#3A4048] flex items-center justify-center text-[#D6D9DC]">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-sm font-semibold text-slate-100">
                  Automated Demonstration Mode
                </h3>
                {isRunning && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    Running {demoStatus?.demo_type}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Autonomous Closed-Loop PAT Alignment & Video Benchmark Evaluation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-[#1a2336] rounded-md transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="bg-rose-950/40 border-b border-rose-800/60 p-3 text-rose-300 flex items-center gap-2 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
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
                  ? 'bg-[#121518]/40 border-[#252A2E] opacity-50'
                  : 'bg-[#121518] border-[#252A2E] hover:border-[#4A5058] hover:bg-[#1A1D20] text-slate-100'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="px-2 py-0.5 bg-[#1E2124] text-[#E8EAED] rounded text-[11px] font-medium border border-[#3A4048]">
                  Simulation Sequence
                </span>
                <Play className="w-4 h-4 text-[#D6D9DC]" />
              </div>
              <div className="mt-3">
                <div className="font-semibold text-sm text-slate-100">Autonomous Simulation</div>
                <div className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Search &bull; Detect &bull; Acquire &bull; Lock &bull; Disturbance &bull; Loss &bull; Reacquire &bull; Report
                </div>
              </div>
            </button>

            {/* Start Video Benchmark Demo */}
            <button
              onClick={handleStartVideoDemo}
              disabled={isRunning || isStarting}
              className={`p-4 rounded-lg border text-left flex flex-col justify-between transition ${
                isRunning
                  ? 'bg-[#121518]/40 border-[#252A2E] opacity-50'
                  : 'bg-[#121518] border-[#252A2E] hover:border-indigo-500/50 hover:bg-[#1A1D20] text-slate-100'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="px-2 py-0.5 bg-indigo-600/20 text-indigo-300 rounded text-[11px] font-medium border border-indigo-500/30">
                  Video Benchmark
                </span>
                <Film className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="mt-3">
                <div className="font-semibold text-sm text-slate-100">Video Dataset Demo</div>
                <div className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Ingest MP4 &bull; Detect &bull; Track &bull; PTZ Bypass &bull; Benchmark Metrics &bull; Report
                </div>
              </div>
            </button>

            {/* Execution Controls & Settings */}
            <div className="bg-[#121518] border border-[#252A2E] p-4 rounded-lg flex flex-col justify-between">
              <div>
                <div className="text-xs font-medium text-slate-300 mb-1.5">
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
                      className={`px-2 py-1.5 rounded-md text-xs font-medium border transition ${
                        stepDuration === preset.val
                          ? 'bg-[#252A2E] text-white border-[#3A4048]'
                          : 'bg-[#0D1012] text-slate-400 border-[#252A2E] hover:text-white'
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
                  className="mt-3 w-full py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-md font-medium text-xs flex items-center justify-center gap-1.5 transition"
                >
                  <Square className="w-3.5 h-3.5" />
                  Halt Demonstration
                </button>
              ) : (
                <div className="mt-3 text-[11px] text-slate-500 text-center">
                  Recommended: 12s per phase for complete demonstration.
                </div>
              )}
            </div>
          </div>

          {/* Active Phase Banner & Progress Bar */}
          {demoStatus && demoStatus.total_steps > 0 && (
            <div className="bg-[#121518] border border-[#252A2E] rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-200">Progress:</span>
                  <span className="text-[#D6D9DC] font-medium num-mono">
                    Step {demoStatus.current_step} of {demoStatus.total_steps}
                  </span>
                  <span className="text-slate-600">&bull;</span>
                  <span className="text-slate-100 font-medium">{demoStatus.current_step_name}</span>
                </div>
                <div className="text-slate-400 num-mono flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  <span>Elapsed: {demoStatus.elapsed_time_s.toFixed(1)}s</span>
                  <span className="text-slate-200 font-medium">({demoStatus.progress_percent}%)</span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="h-2 bg-[#0D1012] rounded-full overflow-hidden border border-[#252A2E]">
                <div
                  className="h-full bg-[#252A2E] transition-all duration-300"
                  style={{ width: `${demoStatus.progress_percent}%` }}
                />
              </div>

              <div className="text-xs text-slate-400">
                {demoStatus.current_step_desc || 'Ready to start demonstration.'}
              </div>

              {demoStatus.latest_report_id && (
                <div className="bg-emerald-950/30 border border-emerald-700/50 p-3 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-400 font-medium text-xs">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Report Generated: {demoStatus.latest_report_id}</span>
                  </div>
                  <button
                    onClick={() => {
                      onClose();
                      onNavigateToReports();
                    }}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md font-medium flex items-center gap-1.5 transition text-xs"
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
            <div className="bg-[#121518] border border-[#252A2E] rounded-lg p-4">
              <div className="text-xs font-semibold text-slate-300 mb-3">
                Demonstration Sequence Progression ({demoStatus.steps.length} Steps)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {demoStatus.steps.map((st) => (
                  <div
                    key={st.step_number}
                    className={`p-2.5 rounded-lg border flex items-start gap-2.5 transition ${
                      st.active
                        ? 'bg-[#1A1D20] border-[#3A4048] text-white'
                        : st.completed
                        ? 'bg-[#111417] border-emerald-800/40 text-slate-300'
                        : 'bg-[#0D1012] border-[#252A2E] text-slate-500'
                    }`}
                  >
                    <div className="shrink-0 mt-0.5">
                      {st.completed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : st.active ? (
                        <span className="w-4 h-4 rounded-full border-2 border-[#3A4048] border-t-transparent animate-spin inline-block" />
                      ) : (
                        <span className="w-4 h-4 rounded-full border border-slate-700 flex items-center justify-center text-[10px] num-mono">
                          {st.step_number}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-xs">
                        {st.name}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">{st.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-[#0D1012] border-t border-[#252A2E] flex items-center justify-between text-xs text-slate-400">
          <span>Problem Statement 4 Demonstration Protocol</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#1A1D20] hover:bg-[#202c42] text-slate-200 hover:text-white rounded-md font-medium transition border border-[#2D3237]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
