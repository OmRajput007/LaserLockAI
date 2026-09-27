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
  ChevronRight,
  ShieldCheck,
  Activity,
  Layers,
} from 'lucide-react';
import { api } from '../services/api';
import { DemoStatusResponse, NavTabId } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToReports: () => void;
}

export const DemoModal: React.FC<Props> = ({ isOpen, onClose, onNavigateToReports }) => {
  const [demoStatus, setDemoStatus] = useState<DemoStatusResponse | null>(null);
  const [stepDuration, setStepDuration] = useState<number>(12.0); // Default 12s = 168s (2.8m, suitable for 3-5m video)
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono text-xs">
      <div className="bg-[#0b0f19] border border-cyan-500/40 rounded-xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
              <Zap className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Automated Demonstration Mode (Problem Statement 4)
                </h3>
                {isRunning && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    RUNNING {demoStatus?.demo_type}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Full 14-Phase Autonomous PAT Alignment Sequence &bull; MP4 Benchmark Evaluation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="bg-rose-950/60 border-b border-rose-800 p-3 text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Quick Trigger Buttons & Options */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Start Simulation Demo Button */}
            <button
              onClick={handleStartSimDemo}
              disabled={isRunning || isStarting}
              className={`p-4 rounded-lg border text-left flex flex-col justify-between transition ${
                isRunning
                  ? 'bg-slate-900/40 border-slate-800 opacity-60'
                  : 'bg-cyan-950/30 border-cyan-500/50 hover:bg-cyan-900/40 hover:border-cyan-400 text-white shadow-lg shadow-cyan-950/30'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 rounded text-[10px] font-bold border border-cyan-500/30">
                  14 PHASES
                </span>
                <Play className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="mt-2.5">
                <div className="font-bold text-sm text-cyan-300">START DEMO</div>
                <div className="text-[11px] text-slate-400 mt-1 leading-snug">
                  Config &rarr; Search &rarr; Detect &rarr; Acquire &rarr; Lock &rarr; Disturbance &rarr; Target Loss &rarr; Reacquire &rarr; Report
                </div>
              </div>
            </button>

            {/* Start Video Benchmark Demo */}
            <button
              onClick={handleStartVideoDemo}
              disabled={isRunning || isStarting}
              className={`p-4 rounded-lg border text-left flex flex-col justify-between transition ${
                isRunning
                  ? 'bg-slate-900/40 border-slate-800 opacity-60'
                  : 'bg-purple-950/30 border-purple-500/50 hover:bg-purple-900/40 hover:border-purple-400 text-white shadow-lg shadow-purple-950/30'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded text-[10px] font-bold border border-purple-500/30">
                  7 PHASES
                </span>
                <Film className="w-4 h-4 text-purple-400" />
              </div>
              <div className="mt-2.5">
                <div className="font-bold text-sm text-purple-300">START VIDEO DEMO</div>
                <div className="text-[11px] text-slate-400 mt-1 leading-snug">
                  Sample MP4 &rarr; Decode &rarr; Detect &rarr; Centroid &rarr; Tracking &rarr; Metrics &rarr; Report
                </div>
              </div>
            </button>

            {/* Execution Controls & Settings */}
            <div className="bg-slate-900/70 border border-slate-800 p-4 rounded-lg flex flex-col justify-between">
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  Phase Duration Preset
                </div>
                <div className="grid grid-cols-3 gap-1.5 mt-2">
                  {[
                    { label: '12s (3 min)', val: 12.0 },
                    { label: '3s (Fast)', val: 3.0 },
                    { label: '0.5s (Rapid)', val: 0.5 },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      onClick={() => setStepDuration(preset.val)}
                      disabled={isRunning}
                      className={`px-2 py-1.5 rounded text-[10px] font-bold border transition ${
                        stepDuration === preset.val
                          ? 'bg-cyan-600 text-white border-cyan-400'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
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
                  className="mt-3 w-full py-2 bg-rose-600 hover:bg-rose-500 text-white rounded font-bold flex items-center justify-center gap-1.5 transition"
                >
                  <Square className="w-3.5 h-3.5" />
                  HALT DEMONSTRATION
                </button>
              ) : (
                <div className="mt-3 text-[10px] text-slate-500 text-center">
                  Suitable for 3&ndash;5 minute demonstration video presentation.
                </div>
              )}
            </div>
          </div>

          {/* Active Phase Banner & Progress Bar */}
          {demoStatus && demoStatus.total_steps > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white uppercase">Progress:</span>
                  <span className="text-cyan-400 font-bold">
                    Step {demoStatus.current_step} of {demoStatus.total_steps}
                  </span>
                  <span className="text-slate-500">&bull;</span>
                  <span className="text-slate-300 font-semibold">{demoStatus.current_step_name}</span>
                </div>
                <div className="text-slate-400 font-mono flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  <span>Elapsed: {demoStatus.elapsed_time_s.toFixed(1)}s</span>
                  <span className="text-cyan-300 font-bold">({demoStatus.progress_percent}%)</span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-300"
                  style={{ width: `${demoStatus.progress_percent}%` }}
                />
              </div>

              <div className="text-[11px] text-slate-400 italic">
                {demoStatus.current_step_desc || 'Ready to start demonstration.'}
              </div>

              {demoStatus.latest_report_id && (
                <div className="bg-emerald-950/40 border border-emerald-500/40 p-3 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Report Generated: {demoStatus.latest_report_id}</span>
                  </div>
                  <button
                    onClick={() => {
                      onClose();
                      onNavigateToReports();
                    }}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold flex items-center gap-1.5 transition text-xs"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    View Performance Report
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Phase-by-Phase Checklist */}
          {demoStatus && demoStatus.steps && demoStatus.steps.length > 0 && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-3">
                Demonstration Sequence Progression ({demoStatus.steps.length} Steps)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {demoStatus.steps.map((st) => (
                  <div
                    key={st.step_number}
                    className={`p-2.5 rounded-lg border flex items-start gap-2.5 transition ${
                      st.active
                        ? 'bg-cyan-500/15 border-cyan-500 text-white shadow'
                        : st.completed
                        ? 'bg-slate-950/80 border-emerald-500/30 text-slate-300'
                        : 'bg-slate-950/40 border-slate-800/80 text-slate-500'
                    }`}
                  >
                    <div className="shrink-0 mt-0.5">
                      {st.completed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : st.active ? (
                        <span className="w-4 h-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin inline-block" />
                      ) : (
                        <span className="w-4 h-4 rounded-full border border-slate-700 flex items-center justify-center text-[9px] font-bold">
                          {st.step_number}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-xs flex items-center gap-1.5">
                        <span>
                          {st.step_number}. {st.name}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">{st.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
          <span>Official Evaluation Protocol &bull; Problem Statement 4</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded font-bold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
