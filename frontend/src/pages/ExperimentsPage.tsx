import React, { useState, useEffect } from 'react';
import {
  FlaskConical,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Download,
  Trash2,
  Plus,
  Sliders,
  Layers,
  BarChart,
  Activity,
  Zap,
  Target,
  FileSpreadsheet,
  FileCode,
  Sparkles,
} from 'lucide-react';
import {
  ExperimentRecord,
  AlgorithmComparisonResponse,
  AlgorithmComparisonResult,
} from '../types';
import { api } from '../services/api';

export const ExperimentsPage: React.FC = () => {
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [comparison, setComparison] = useState<AlgorithmComparisonResponse | null>(null);
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [selectedExp, setSelectedExp] = useState<ExperimentRecord | null>(null);

  // Form state for creating custom experiment
  const [formName, setFormName] = useState<string>('Optical Ground Station Cross-Track Trial');
  const [formAlgorithm, setFormAlgorithm] = useState<
    'Basic CV' | 'CV + Kalman' | 'CV + PID' | 'AI' | 'AI + Kalman + PID'
  >('AI + Kalman + PID');
  const [formMotion, setFormMotion] = useState<
    'Straight Line' | 'Circular' | 'Figure of 8' | 'Random' | 'Spiral' | 'Sinusoidal'
  >('Straight Line');
  const [formNoise, setFormNoise] = useState<'None' | 'Gaussian' | 'Salt & Pepper' | 'Poisson' | 'Multi-Noise'>('None');
  const [formNoiseSigma, setFormNoiseSigma] = useState<number>(5.0);
  const [formAtmosphere, setFormAtmosphere] = useState<'Clear' | 'Haze' | 'Fog' | 'Rain' | 'Low Light'>('Clear');
  const [formPidKp, setFormPidKp] = useState<number>(1.4);
  const [formPidKi, setFormPidKi] = useState<number>(0.05);
  const [formPidKd, setFormPidKd] = useState<number>(0.18);
  const [formKalman, setFormKalman] = useState<boolean>(true);
  const [formDuration, setFormDuration] = useState<number>(3.0);

  const loadExperiments = async () => {
    try {
      const list = await api.listExperiments();
      setExperiments(list);
    } catch (e) {
      console.error('Failed to load experiments:', e);
    }
  };

  useEffect(() => {
    loadExperiments();
  }, []);

  const handleRunComparison = async (scenario: string = 'Standard Cross-Track Evaluation') => {
    setIsComparing(true);
    try {
      const cmp = await api.compareAlgorithms(scenario, 3.0);
      setComparison(cmp);
    } catch (e) {
      console.error('Comparison benchmark failed:', e);
    } finally {
      setIsComparing(false);
    }
  };

  const handleCreateExperiment = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const newRec = await api.runCustomExperiment({
        name: formName,
        algorithm: formAlgorithm,
        target_motion: formMotion,
        noise_type: formNoise,
        noise_level_sigma: formNoiseSigma,
        atmosphere: formAtmosphere,
        pid_kp: formPidKp,
        pid_ki: formPidKi,
        pid_kd: formPidKd,
        kalman_enabled: formKalman,
        duration_s: formDuration,
      });
      setShowCreateModal(false);
      loadExperiments();
      setSelectedExp(newRec);
    } catch (err) {
      console.error('Failed to create experiment:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (expId: string) => {
    if (!window.confirm(`Delete experiment ${expId}?`)) return;
    try {
      await api.deleteExperiment(expId);
      if (selectedExp?.experiment_id === expId) setSelectedExp(null);
      loadExperiments();
    } catch (e) {
      console.error('Failed to delete experiment:', e);
    }
  };

  return (
    <div className="flex flex-col gap-4 font-mono text-xs pb-12">
      {/* Top Banner */}
      <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center shadow-lg shadow-purple-950">
            <FlaskConical className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              Experimental Testbench & Algorithm Comparison Suite
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800">
                OFFICIAL BENCHMARK 1
              </span>
            </h2>
            <p className="text-slate-400 text-[11px]">
              Parameter Sweeps, Monte Carlo Archival & Deterministic 5-Algorithm Comparative Analysis
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => handleRunComparison()}
            disabled={isComparing}
            className="px-3.5 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded text-[11px] flex items-center gap-2 transition shadow-md disabled:opacity-50"
          >
            {isComparing ? (
              <RotateCcw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {isComparing ? 'EXECUTING BENCHMARK...' : 'RUN 5-ALGORITHM COMPARISON'}
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold rounded text-[11px] flex items-center gap-1.5 transition"
          >
            <Plus className="w-3.5 h-3.5 text-cyan-400" /> NEW EXPERIMENT
          </button>
        </div>
      </div>

      {/* 5-Algorithm Comparison Section */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 shadow">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
          <div className="flex items-center gap-2.5">
            <BarChart className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-white text-xs uppercase tracking-wider">
              5-Algorithm Objective Benchmark Comparison
            </span>
          </div>
          <span className="text-[10px] text-slate-400">
            {comparison
              ? `Scenario: ${comparison.scenario_name} (${comparison.duration_s}s, ${comparison.total_frames_per_run} frames)`
              : 'Click "Run 5-Algorithm Comparison" to benchmark identical scenarios'}
          </span>
        </div>

        {/* Notice on Objective Measurement */}
        <div className="bg-slate-950/70 border border-blue-900/40 p-2.5 rounded text-[10px] text-slate-300 flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
            <span>
              <strong>Scientific Protocol:</strong> All 5 algorithms execute on identical initial coordinates, target kinematics, optical clutter, and camera state.
            </span>
          </div>
          <span className="text-cyan-400 font-bold uppercase text-[9px]">Zero Subjective Bias</span>
        </div>

        {isComparing ? (
          <div className="p-12 text-center flex flex-col items-center justify-center gap-3">
            <RotateCcw className="w-8 h-8 text-cyan-400 animate-spin" />
            <p className="text-sm font-bold text-white">Running 5 Standardized Candidate Architectures...</p>
            <p className="text-xs text-slate-400">
              Evaluating Basic CV, CV+Kalman, CV+PID, AI, and AI+Kalman+PID sequentially under identical conditions.
            </p>
          </div>
        ) : comparison ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-950/80 border-b border-slate-800 text-[10px] font-mono text-cyan-400 uppercase tracking-wider">
                <tr>
                  <th className="p-2.5">Candidate Algorithm</th>
                  <th className="p-2.5">Mean Error (px)</th>
                  <th className="p-2.5">Max Error (px)</th>
                  <th className="p-2.5">RMSE (px)</th>
                  <th className="p-2.5">Lock Retention</th>
                  <th className="p-2.5">Target Loss</th>
                  <th className="p-2.5">Acquisition (s)</th>
                  <th className="p-2.5">Latency (ms)</th>
                  <th className="p-2.5">FPS</th>
                  <th className="p-2.5 text-right">KPI Compliance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-slate-300 text-xs">
                {comparison.compared_algorithms.map((res: AlgorithmComparisonResult, idx: number) => {
                  const isTopCandidate = res.algorithm_name === 'AI + Kalman + PID';
                  return (
                    <tr
                      key={idx}
                      className={`hover:bg-slate-800/40 transition ${
                        isTopCandidate ? 'bg-cyan-950/20' : ''
                      }`}
                    >
                      <td className="p-2.5 font-bold text-white flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            isTopCandidate ? 'bg-cyan-400 shadow-sm shadow-cyan-400' : 'bg-slate-500'
                          }`}
                        ></span>
                        {res.algorithm_name}
                      </td>
                      <td className="p-2.5 font-mono text-cyan-300 font-bold">
                        {res.mean_tracking_error_px.toFixed(2)}
                      </td>
                      <td className="p-2.5 font-mono text-slate-300">{res.max_tracking_error_px.toFixed(2)}</td>
                      <td className="p-2.5 font-mono text-slate-200">{res.rmse_px.toFixed(2)}</td>
                      <td className="p-2.5 font-mono text-emerald-400 font-semibold">
                        {res.lock_retention_percent.toFixed(1)}%
                      </td>
                      <td className="p-2.5 font-mono text-amber-400 font-semibold">
                        {res.target_loss_percent.toFixed(1)}%
                      </td>
                      <td className="p-2.5 font-mono text-slate-300">
                        {res.acquisition_time_s !== null ? `${res.acquisition_time_s.toFixed(2)}s` : '--'}
                      </td>
                      <td className="p-2.5 font-mono text-purple-300 font-semibold">
                        {res.average_latency_ms.toFixed(2)}
                      </td>
                      <td className="p-2.5 font-mono text-green-400 font-bold">{res.average_fps.toFixed(1)}</td>
                      <td className="p-2.5 text-right font-mono">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${
                            res.overall_pass
                              ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                              : 'bg-amber-950 border-amber-700 text-amber-300'
                          }`}
                        >
                          {res.passed_requirements_count} / {res.total_requirements_count} Passed
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded">
            Click &quot;RUN 5-ALGORITHM COMPARISON&quot; above to evaluate Basic CV, CV+Kalman, CV+PID, AI, and AI+Kalman+PID
            on an identical standardized scenario.
          </div>
        )}
      </div>

      {/* Archived Experiments Section */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 shadow">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
          <div className="flex items-center gap-2.5">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-white text-xs uppercase tracking-wider">
              Archived Experimental Testbench Trials ({experiments.length})
            </span>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/api/experiments/export/csv"
              download
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded text-[10px] font-bold flex items-center gap-1.5 transition"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" /> Export CSV
            </a>
            <a
              href="/api/experiments/export/json"
              download
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded text-[10px] font-bold flex items-center gap-1.5 transition"
            >
              <FileCode className="w-3.5 h-3.5 text-cyan-400" /> Export JSON
            </a>
          </div>
        </div>

        {experiments.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded">
            No archived experiments yet. Click &quot;NEW EXPERIMENT&quot; above to execute and store a customized trial.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-950/80 border-b border-slate-800 text-[10px] font-mono text-cyan-400 uppercase tracking-wider">
                <tr>
                  <th className="p-2.5">Experiment ID</th>
                  <th className="p-2.5">Date</th>
                  <th className="p-2.5">Trial Name</th>
                  <th className="p-2.5">Algorithm</th>
                  <th className="p-2.5">Trajectory</th>
                  <th className="p-2.5">Noise / Disturbance</th>
                  <th className="p-2.5">Mean Err (px)</th>
                  <th className="p-2.5">Throughput</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-slate-300 text-xs">
                {experiments.map((exp) => (
                  <tr
                    key={exp.experiment_id}
                    onClick={() => setSelectedExp(exp)}
                    className="hover:bg-slate-800/40 cursor-pointer transition"
                  >
                    <td className="p-2.5 font-bold text-cyan-300">{exp.experiment_id}</td>
                    <td className="p-2.5 text-slate-400 text-[11px]">
                      {new Date(exp.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="p-2.5 text-white font-semibold">{exp.name}</td>
                    <td className="p-2.5 text-cyan-400">{exp.algorithm}</td>
                    <td className="p-2.5 text-slate-400">{exp.target_motion}</td>
                    <td className="p-2.5 text-slate-400">
                      {exp.noise_type !== 'None' ? `${exp.noise_type} (${exp.noise_level_sigma}px)` : 'None'}
                    </td>
                    <td className="p-2.5 font-mono text-white font-bold">
                      {exp.metrics.average_tracking_error_px?.toFixed(2) ?? '--'}
                    </td>
                    <td className="p-2.5 font-mono text-green-400 font-bold">
                      {exp.metrics.average_fps.toFixed(1)} FPS
                    </td>
                    <td className="p-2.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${
                          exp.overall_status === 'PASS'
                            ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                            : 'bg-rose-950 border-rose-700 text-rose-300'
                        }`}
                      >
                        {exp.overall_status === 'PASS' ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <XCircle className="w-3 h-3 text-rose-400" />
                        )}
                        {exp.overall_status}
                      </span>
                    </td>
                    <td className="p-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleDelete(exp.experiment_id)}
                        className="p-1 hover:bg-rose-950/70 text-slate-400 hover:text-rose-400 rounded transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Selected Experiment Detail Card */}
      {selectedExp && (
        <div className="bg-slate-900/90 border border-cyan-800/60 rounded-lg p-4 shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span className="font-bold text-white text-xs uppercase tracking-wider">
                Trial Detail: {selectedExp.name} ({selectedExp.experiment_id})
              </span>
            </div>
            <button
              onClick={() => setSelectedExp(null)}
              className="text-slate-400 hover:text-white text-xs font-bold px-2 py-0.5 rounded bg-slate-800"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
            <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">ALGORITHM</span>
              <span className="text-cyan-400 font-bold">{selectedExp.algorithm}</span>
            </div>
            <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">MEAN TRACKING ERROR</span>
              <span className="text-white font-bold">
                {selectedExp.metrics.average_tracking_error_px?.toFixed(2) ?? '--'} px
              </span>
            </div>
            <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">RMSE ERROR</span>
              <span className="text-white font-bold">{selectedExp.metrics.rmse_px?.toFixed(2) ?? '--'} px</span>
            </div>
            <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">LOCK RETENTION</span>
              <span className="text-emerald-400 font-bold">
                {selectedExp.metrics.lock_retention_percent.toFixed(1)}%
              </span>
            </div>
            <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">THROUGHPUT RATE</span>
              <span className="text-green-400 font-bold">{selectedExp.metrics.average_fps.toFixed(1)} FPS</span>
            </div>
            <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">EXECUTION LATENCY</span>
              <span className="text-purple-300 font-bold">
                {selectedExp.metrics.average_processing_time_ms.toFixed(2)} ms
              </span>
            </div>
          </div>

          {/* Requirements Compliance Breakdown */}
          <div className="bg-slate-950/80 rounded border border-slate-800 overflow-hidden">
            <div className="p-2.5 bg-slate-900/60 border-b border-slate-800 text-[10px] font-bold text-slate-300 uppercase">
              Official Requirement Verification Results
            </div>
            <div className="divide-y divide-slate-800/80 text-xs">
              {selectedExp.requirements.map((r, i) => (
                <div key={i} className="p-2.5 flex items-center justify-between">
                  <span className="font-semibold text-white">{r.parameter}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-slate-400 font-mono text-[11px]">Required: {r.required}</span>
                    <span className="text-slate-200 font-mono font-bold">{r.actual}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        r.status === 'PASS'
                          ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                          : 'bg-rose-950 border-rose-700 text-rose-300'
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* New Experiment Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-xl w-full p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Create & Run Custom Experiment
                </h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateExperiment} className="space-y-3.5">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Experiment / Scenario Title</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:border-cyan-500 outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Algorithm Candidate</label>
                  <select
                    value={formAlgorithm}
                    onChange={(e: any) => setFormAlgorithm(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 outline-none"
                  >
                    <option value="Basic CV">Basic CV</option>
                    <option value="CV + Kalman">CV + Kalman</option>
                    <option value="CV + PID">CV + PID</option>
                    <option value="AI">AI</option>
                    <option value="AI + Kalman + PID">AI + Kalman + PID</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Target Trajectory</label>
                  <select
                    value={formMotion}
                    onChange={(e: any) => setFormMotion(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 outline-none"
                  >
                    <option value="Straight Line">Straight Line</option>
                    <option value="Circular">Circular</option>
                    <option value="Figure of 8">Figure of 8</option>
                    <option value="Random">Random</option>
                    <option value="Spiral">Spiral</option>
                    <option value="Sinusoidal">Sinusoidal</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Noise Engine Model</label>
                  <select
                    value={formNoise}
                    onChange={(e: any) => setFormNoise(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 outline-none"
                  >
                    <option value="None">None</option>
                    <option value="Gaussian">Gaussian</option>
                    <option value="Salt & Pepper">Salt & Pepper</option>
                    <option value="Poisson">Poisson</option>
                    <option value="Multi-Noise">Multi-Noise</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">
                    Noise Sigma: {formNoiseSigma} px
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    step="0.5"
                    value={formNoiseSigma}
                    onChange={(e) => setFormNoiseSigma(parseFloat(e.target.value))}
                    className="w-full accent-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-slate-300">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">PID Kp</label>
                  <input
                    type="number"
                    step="0.05"
                    value={formPidKp}
                    onChange={(e) => setFormPidKp(parseFloat(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">PID Ki</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formPidKi}
                    onChange={(e) => setFormPidKi(parseFloat(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">PID Kd</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formPidKd}
                    onChange={(e) => setFormPidKd(parseFloat(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Trial Duration: {formDuration}s</label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="0.5"
                  value={formDuration}
                  onChange={(e) => setFormDuration(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-bold text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-bold text-xs flex items-center gap-1.5 transition disabled:opacity-50"
                >
                  {isCreating ? <RotateCcw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {isCreating ? 'Simulating...' : 'Run & Store Trial'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
