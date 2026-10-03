import React, { useState, useEffect } from 'react';
import {
  FlaskConical,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Trash2,
  Plus,
  Layers,
  BarChart,
  FileSpreadsheet,
  FileCode,
  Sparkles,
  Globe,
  Eye,
  Info,
} from 'lucide-react';
import {
  ExperimentRecord,
  AlgorithmComparisonResponse,
  AlgorithmComparisonResult,
  ValidationSuiteReport,
  ValidationRunResult,
} from '../types';
import { api } from '../services/api';

export const ExperimentsPage: React.FC = () => {
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [comparison, setComparison] = useState<AlgorithmComparisonResponse | null>(null);
  const [orbitalReport, setOrbitalReport] = useState<ValidationSuiteReport | null>(null);
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [isValidatingOrbital, setIsValidatingOrbital] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [selectedExp, setSelectedExp] = useState<ExperimentRecord | null>(null);
  const [selectedValidationRun, setSelectedValidationRun] = useState<ValidationRunResult | null>(null);

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

  const loadOrbitalReport = async () => {
    try {
      const rep = await api.getOrbitalValidationReport();
      if (rep && rep.runs && rep.runs.length > 0) {
        setOrbitalReport(rep);
      }
    } catch {
      // Not yet generated
    }
  };

  useEffect(() => {
    loadExperiments();
    loadOrbitalReport();
  }, []);

  const handleRunOrbitalValidation = async (durationS: number = 120.0) => {
    setIsValidatingOrbital(true);
    try {
      const rep = await api.runOrbitalValidation(durationS);
      setOrbitalReport(rep);
    } catch (e) {
      console.error('Failed to run orbital validation suite:', e);
    } finally {
      setIsValidatingOrbital(false);
    }
  };

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
    <div className="flex flex-col gap-6 text-[#F0FFEA] font-mono text-xs pb-12">
      {/* Top Banner */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-5 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-[#FF5F40]/10 border border-[#FF5F40]/25 flex items-center justify-center shrink-0">
            <FlaskConical className="w-5 h-5 text-[#FF5F40]" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-sm font-semibold text-[#F0FFEA] tracking-wide uppercase">
                Experimental Testbench & Algorithm Comparison Suite
              </h2>
              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-[#262824] text-[#FF5F40] border border-[#33362F]">
                BENCHMARK SUITE
              </span>
            </div>
            <p className="text-[#9CA195] text-xs mt-0.5">
              Parameter Sweeps, Monte Carlo Archival & Deterministic Multi-Algorithm Comparative Analysis
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => handleRunOrbitalValidation(120.0)}
            disabled={isValidatingOrbital}
            className="px-3.5 py-2 bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40]/50 font-medium rounded-lg text-xs flex items-center gap-2 transition disabled:opacity-50 cursor-pointer"
          >
            {isValidatingOrbital ? (
              <RotateCcw className="w-3.5 h-3.5 animate-spin text-[#FF5F40]" />
            ) : (
              <Globe className="w-3.5 h-3.5 text-[#FF5F40]" />
            )}
            {isValidatingOrbital ? 'Running 120s Validation...' : 'Run Orbital Validation (A-F)'}
          </button>

          <button
            onClick={() => handleRunComparison()}
            disabled={isComparing}
            className="px-3.5 py-2 bg-[#FF5F40] hover:bg-[#FF7459] text-[#0A0A0A] font-bold rounded-lg text-xs flex items-center gap-2 transition disabled:opacity-50 cursor-pointer"
          >
            {isComparing ? (
              <RotateCcw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {isComparing ? 'Executing Benchmark...' : 'Run Algorithm Comparison'}
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            className="px-3.5 py-2 bg-[#262824] hover:bg-[#33362F] border border-[#33362F] hover:border-[#FF5F40]/50 text-[#F0FFEA] font-medium rounded-lg text-xs flex items-center gap-1.5 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-[#FF5F40]" /> New Experiment
          </button>
        </div>
      </div>

      {/* Candidate Algorithm Comparison Section */}
      <div className="bg-[#1B1D1A] border border-[#33362F] rounded-xl p-5">
        <div className="flex items-center justify-between pb-3.5 border-b border-[#33362F] mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <BarChart className="w-4 h-4 text-[#FF5F40]" />
            <h3 className="font-semibold text-[#F0FFEA] text-xs uppercase tracking-wider">
              Candidate Algorithm Objective Benchmark Comparison
            </h3>
          </div>
          <span className="text-xs text-[#9CA195]">
            {comparison
              ? `Scenario: ${comparison.scenario_name} (${comparison.duration_s}s, ${comparison.total_frames_per_run} frames)`
              : 'Click "Run Algorithm Comparison" to benchmark identical scenarios'}
          </span>
        </div>

        {/* Notice on Objective Measurement */}
        <div className="bg-[#262824] border border-[#33362F] p-3 rounded-lg text-xs text-[#9CA195] flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#FF5F40] shrink-0"></span>
            <span>
              <strong className="text-[#F0FFEA] font-medium">Scientific Protocol:</strong> All candidate algorithms execute on identical initial coordinates, target kinematics, optical clutter, and camera state.
            </span>
          </div>
          <span className="text-[#FF5F40] font-medium uppercase text-[10px] tracking-wider">[✓] Objective Evaluation</span>
        </div>

        {isComparing ? (
          <div className="p-12 text-center flex flex-col items-center justify-center gap-3">
            <RotateCcw className="w-7 h-7 text-[#FF5F40] animate-spin" />
            <p className="text-sm font-medium text-[#F0FFEA]">Running Standardized Candidate Architectures...</p>
            <p className="text-xs text-[#9CA195] max-w-md">
              Evaluating Basic CV, CV+Kalman, CV+PID, AI, and AI+Kalman+PID sequentially under identical conditions.
            </p>
          </div>
        ) : comparison ? (
          <div className="overflow-x-auto rounded-lg border border-[#33362F]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#000000] border-b border-[#33362F] text-[11px] font-semibold text-[#9CA195] uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-3.5">Candidate Algorithm</th>
                  <th className="py-3 px-3 text-right">Mean Error</th>
                  <th className="py-3 px-3 text-right">Max Error</th>
                  <th className="py-3 px-3 text-right">RMSE</th>
                  <th className="py-3 px-3 text-right">Lock Retention</th>
                  <th className="py-3 px-3 text-right">Target Loss</th>
                  <th className="py-3 px-3 text-right">Acquisition</th>
                  <th className="py-3 px-3 text-right">Latency</th>
                  <th className="py-3 px-3 text-right">FPS</th>
                  <th className="py-3 px-3.5 text-right">Compliance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#33362F] text-[#F0FFEA]">
                {comparison.compared_algorithms.map((res: AlgorithmComparisonResult, idx: number) => {
                  const isTopCandidate = res.algorithm_name === 'AI + Kalman + PID';
                  return (
                    <tr
                      key={idx}
                      className={`hover:bg-[#262824]/60 transition ${
                        isTopCandidate ? 'bg-[#FF5F40]/10' : ''
                      }`}
                    >
                      <td className="py-3 px-3.5 font-medium text-[#F0FFEA] flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            isTopCandidate ? 'bg-[#FF5F40]' : 'bg-[#5E625A]'
                          }`}
                        ></span>
                        <span>{res.algorithm_name}</span>
                        {isTopCandidate && (
                          <span className="text-[10px] text-[#FF5F40] bg-[#1B1D1A] border border-[#FF5F40]/40 px-1.5 py-0.2 rounded font-medium">
                            PRIMARY
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right text-[#F0FFEA] font-medium">
                        {res.mean_tracking_error_px.toFixed(2)} px
                      </td>
                      <td className="py-3 px-3 text-right text-[#9CA195]">
                        {res.max_tracking_error_px.toFixed(2)} px
                      </td>
                      <td className="py-3 px-3 text-right text-[#F0FFEA]">
                        {res.rmse_px.toFixed(2)} px
                      </td>
                      <td className="py-3 px-3 text-right text-[#FF5F40] font-medium">
                        {res.lock_retention_percent.toFixed(1)}%
                      </td>
                      <td className="py-3 px-3 text-right text-[#9CA195] font-medium">
                        {res.target_loss_percent.toFixed(1)}%
                      </td>
                      <td className="py-3 px-3 text-right text-[#9CA195]">
                        {res.acquisition_time_s !== null ? `${res.acquisition_time_s.toFixed(2)}s` : '--'}
                      </td>
                      <td className="py-3 px-3 text-right text-[#F0FFEA]">
                        {res.average_latency_ms.toFixed(2)} ms
                      </td>
                      <td className="py-3 px-3 text-right text-[#FF5F40] font-medium">
                        {res.average_fps.toFixed(1)}
                      </td>
                      <td className="py-3 px-3.5 text-right">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
                            res.overall_pass
                              ? 'bg-[#FF5F40]/15 border-[#FF5F40]/40 text-[#FF5F40]'
                              : 'bg-[#262824] border-[#33362F] text-[#9CA195]'
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
          <div className="p-8 text-center text-[#9CA195] text-xs border border-dashed border-[#33362F] rounded-lg">
            Click &quot;Run Algorithm Comparison&quot; above to evaluate Basic CV, CV+Kalman, CV+PID, AI, and AI+Kalman+PID on an identical standardized scenario.
          </div>
        )}
      </div>

      {/* Orbital Scenario Validation Suite Section */}
      <div className="bg-[#1B1D1A] border border-[#33362F] rounded-xl p-5">
        <div className="flex items-center justify-between pb-3.5 border-b border-[#33362F] mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <Globe className="w-4 h-4 text-[#FF5F40]" />
            <h3 className="font-semibold text-[#F0FFEA] text-xs uppercase tracking-wider">
              Orbital Tracking Validation Suite (Runs A – F)
            </h3>
            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-[#262824] text-[#FF5F40] border border-[#33362F]">
              ORBITAL VALIDATION: 120s @ 1X
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleRunOrbitalValidation(120.0)}
              disabled={isValidatingOrbital}
              className="px-3.5 py-1.5 bg-[#FF5F40] hover:bg-[#FF7459] text-[#0A0A0A] rounded-lg text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50 shadow-sm cursor-pointer"
            >
              {isValidatingOrbital ? (
                <RotateCcw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              {isValidatingOrbital ? 'Simulating 120s Suite...' : 'Run Full Suite'}
            </button>
          </div>
        </div>

        {/* Lock Retention Policy Notice */}
        <div className="bg-[#262824] border border-[#33362F] p-3 rounded-lg text-xs text-[#9CA195] flex items-start gap-2.5 mb-4">
          <Info className="w-4 h-4 text-[#FF5F40] shrink-0 mt-0.5" />
          <div className="flex-1 leading-relaxed">
            <span className="font-medium text-[#F0FFEA]">Lock Retention Protocol: </span>
            <span>
              {orbitalReport?.lock_retention_note ||
                'Lock retention rate denominator strictly excludes LINK_BLOCKED duration. When line of sight is obstructed by Earth or dense atmosphere, the camera holds position and zero tracker failures are charged.'}
            </span>
          </div>
        </div>

        {isValidatingOrbital ? (
          <div className="p-12 text-center flex flex-col items-center justify-center gap-3">
            <RotateCcw className="w-7 h-7 text-[#FF5F40] animate-spin" />
            <p className="text-sm font-medium text-[#F0FFEA]">Running Standardized Closed-Loop Orbital Simulations...</p>
            <p className="text-xs text-[#9CA195] max-w-md">
              Executing Runs A through F (120s each @ 30 Hz = 3,600 frames/run, 21,600 frames total closed-loop CV + Kalman + PID).
            </p>
          </div>
        ) : orbitalReport ? (
          <div className="overflow-x-auto rounded-lg border border-[#33362F]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#000000] border-b border-[#33362F] text-[11px] font-semibold text-[#9CA195] uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-3">Run & Scenario</th>
                  <th className="py-3 px-3">Platforms</th>
                  <th className="py-3 px-3 text-right">Max Rate</th>
                  <th className="py-3 px-3 text-right">Range (km)</th>
                  <th className="py-3 px-3 text-right">Acquisition</th>
                  <th className="py-3 px-3 text-right">Mean / Max Err</th>
                  <th className="py-3 px-3 text-right">Angular Err</th>
                  <th className="py-3 px-3 text-right">Lock Retention</th>
                  <th className="py-3 px-3">Actuator Limits</th>
                  <th className="py-3 px-3">Channel / LOS</th>
                  <th className="py-3 px-3 text-center">Verdict</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#33362F] text-[#F0FFEA]">
                {orbitalReport.runs.map((r: ValidationRunResult, idx: number) => {
                  const isPass = r.verdict === 'PASS';
                  return (
                    <tr
                      key={idx}
                      className="hover:bg-[#262824]/60 cursor-pointer transition"
                      onClick={() => setSelectedValidationRun(r)}
                    >
                      <td className="py-3 px-3 font-medium text-[#F0FFEA] flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            isPass ? 'bg-[#FF5F40]' : 'bg-[#5E625A]'
                          }`}
                        ></span>
                        <div>
                          <div className="font-semibold text-[#F0FFEA]">{r.run_id}</div>
                          <div className="text-[11px] text-[#9CA195] font-normal">{r.name}</div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-[11px] text-[#9CA195]">
                        <div><span className="text-[#5E625A]">Cam:</span> {r.camera_platform}</div>
                        <div><span className="text-[#5E625A]">Bcn:</span> {r.beacon_platform}</div>
                      </td>
                      <td className="py-3 px-3 text-right text-[#F0FFEA] font-medium">
                        {r.max_angular_rate_deg_s.toFixed(2)}°/s
                      </td>
                      <td className="py-3 px-3 text-right text-[#9CA195] text-[11px]">
                        {r.min_range_km.toFixed(0)} - {r.max_range_km.toFixed(0)} km
                      </td>
                      <td className="py-3 px-3 text-right text-[#F0FFEA]">
                        {r.acquisition_time_s !== null ? `${r.acquisition_time_s.toFixed(2)}s` : '--'}
                      </td>
                      <td className="py-3 px-3 text-right text-[#FF5F40] font-medium">
                        {r.mean_tracking_error_px.toFixed(2)} / {r.max_tracking_error_px.toFixed(2)} px
                      </td>
                      <td className="py-3 px-3 text-right text-[#9CA195]">
                        {r.mean_tracking_error_deg.toFixed(3)}°
                      </td>
                      <td className="py-3 px-3 text-right font-medium">
                        <span
                          className={
                            r.lock_retention_percent >= 90
                              ? 'text-[#FF5F40]'
                              : 'text-[#9CA195]'
                          }
                        >
                          {r.lock_retention_percent.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 px-3 text-[11px]">
                        <span className={r.count_slew_saturated > 0 ? 'text-[#FF5F40] font-medium' : 'text-[#5E625A]'}>
                          Sat: {r.count_slew_saturated}
                        </span>
                        <span className="text-[#33362F] mx-1">|</span>
                        <span className={r.count_gimbal_limit > 0 ? 'text-[#FF5F40] font-medium' : 'text-[#5E625A]'}>
                          Lim: {r.count_gimbal_limit}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-[11px]">
                        <div className={r.count_link_blocked > 0 ? 'text-[#FF5F40] font-medium' : 'text-[#9CA195]'}>
                          Blk: {r.count_link_blocked} ({r.duration_link_blocked_s.toFixed(1)}s)
                        </div>
                        <div className="text-[#5E625A] text-[10px]">
                          Atmo: {(r.mean_atmosphere_path_frac * 100).toFixed(1)}%
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${
                            isPass
                              ? 'bg-[#FF5F40]/15 border-[#FF5F40]/40 text-[#FF5F40]'
                              : 'bg-[#262824] border-[#33362F] text-[#9CA195]'
                          }`}
                        >
                          {r.verdict}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedValidationRun(r);
                          }}
                          className="px-2.5 py-1 bg-[#262824] hover:bg-[#33362F] border border-[#33362F] hover:border-[#FF5F40]/50 text-[#F0FFEA] rounded-md text-[11px] font-medium inline-flex items-center gap-1 transition cursor-pointer"
                        >
                          <Eye className="w-3 h-3 text-[#FF5F40]" /> Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-[#9CA195] text-xs border border-dashed border-[#33362F] rounded-lg">
            Click &quot;Run Full Suite&quot; above to execute automated closed-loop validation across Runs A through F.
          </div>
        )}
      </div>

      {/* Archived Experiments Section */}
      <div className="bg-[#1B1D1A] border border-[#33362F] rounded-xl p-5">
        <div className="flex items-center justify-between pb-3.5 border-b border-[#33362F] mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <Layers className="w-4 h-4 text-[#FF5F40]" />
            <h3 className="font-semibold text-[#F0FFEA] text-xs uppercase tracking-wider">
              Archived Experimental Testbench Trials ({experiments.length})
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/api/experiments/export/csv"
              download
              className="px-3 py-1.5 bg-[#262824] hover:bg-[#33362F] border border-[#33362F] hover:border-[#FF5F40]/50 text-[#F0FFEA] rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#FF5F40]" /> Export CSV
            </a>
            <a
              href="/api/experiments/export/json"
              download
              className="px-3 py-1.5 bg-[#262824] hover:bg-[#33362F] border border-[#33362F] hover:border-[#FF5F40]/50 text-[#F0FFEA] rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
            >
              <FileCode className="w-3.5 h-3.5 text-[#FF5F40]" /> Export JSON
            </a>
          </div>
        </div>

        {experiments.length === 0 ? (
          <div className="p-8 text-center text-[#9CA195] text-xs border border-dashed border-[#33362F] rounded-lg">
            No archived experiments yet. Click &quot;New Experiment&quot; above to execute and store a customized trial.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[#33362F]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#000000] border-b border-[#33362F] text-[11px] font-semibold text-[#9CA195] uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-3.5">Experiment ID</th>
                  <th className="py-3 px-3">Time</th>
                  <th className="py-3 px-3">Trial Name</th>
                  <th className="py-3 px-3">Algorithm</th>
                  <th className="py-3 px-3">Trajectory</th>
                  <th className="py-3 px-3">Disturbance</th>
                  <th className="py-3 px-3 text-right">Mean Error</th>
                  <th className="py-3 px-3 text-right">Throughput</th>
                  <th className="py-3 px-3 text-center">Status</th>
                  <th className="py-3 px-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#33362F] text-[#F0FFEA]">
                {experiments.map((exp) => (
                  <tr
                    key={exp.experiment_id}
                    onClick={() => setSelectedExp(exp)}
                    className="hover:bg-[#262824]/60 cursor-pointer transition"
                  >
                    <td className="py-3 px-3.5 text-[#FF5F40] font-semibold">{exp.experiment_id}</td>
                    <td className="py-3 px-3 text-[#9CA195] text-[11px]">
                      {new Date(exp.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3 px-3 text-[#F0FFEA] font-medium">{exp.name}</td>
                    <td className="py-3 px-3 text-[#9CA195]">{exp.algorithm}</td>
                    <td className="py-3 px-3 text-[#9CA195]">{exp.target_motion}</td>
                    <td className="py-3 px-3 text-[#9CA195]">
                      {exp.noise_type !== 'None' ? `${exp.noise_type} (${exp.noise_level_sigma}px)` : 'None'}
                    </td>
                    <td className="py-3 px-3 text-right text-[#F0FFEA] font-medium">
                      {exp.metrics.average_tracking_error_px?.toFixed(2) ?? '--'} px
                    </td>
                    <td className="py-3 px-3 text-right text-[#FF5F40] font-medium">
                      {exp.metrics.average_fps.toFixed(1)} FPS
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          exp.overall_status === 'PASS'
                            ? 'bg-[#FF5F40]/15 border-[#FF5F40]/40 text-[#FF5F40]'
                            : 'bg-[#262824] border-[#5E625A] text-[#9CA195]'
                        }`}
                      >
                        {exp.overall_status === 'PASS' ? (
                          <CheckCircle2 className="w-3 h-3 text-[#FF5F40]" />
                        ) : (
                          <XCircle className="w-3 h-3 text-[#5E625A]" />
                        )}
                        {exp.overall_status}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleDelete(exp.experiment_id)}
                        className="p-1 hover:bg-[#FF5F40]/15 text-[#9CA195] hover:text-[#FF5F40] rounded transition cursor-pointer"
                        title="Delete trial"
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
        <div className="bg-[#1B1D1A] border border-[#33362F] rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between pb-3.5 border-b border-[#33362F] mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#FF5F40]" />
              <h3 className="font-semibold text-[#F0FFEA] text-xs uppercase tracking-wider">
                Trial Detail: {selectedExp.name} ({selectedExp.experiment_id})
              </h3>
            </div>
            <button
              onClick={() => setSelectedExp(null)}
              className="text-[#9CA195] hover:text-[#F0FFEA] text-xs font-medium px-2.5 py-1 rounded-md bg-[#262824] hover:bg-[#33362F] border border-[#33362F] transition cursor-pointer"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            <div className="bg-[#262824] p-3 rounded-lg border border-[#33362F]">
              <span className="text-[10px] text-[#9CA195] uppercase tracking-wider block">Algorithm</span>
              <span className="text-[#FF5F40] font-semibold mt-1 block">{selectedExp.algorithm}</span>
            </div>
            <div className="bg-[#262824] p-3 rounded-lg border border-[#33362F]">
              <span className="text-[10px] text-[#9CA195] uppercase tracking-wider block">Mean Tracking Error</span>
              <span className="text-[#F0FFEA] font-semibold mt-1 block">
                {selectedExp.metrics.average_tracking_error_px?.toFixed(2) ?? '--'} px
              </span>
            </div>
            <div className="bg-[#262824] p-3 rounded-lg border border-[#33362F]">
              <span className="text-[10px] text-[#9CA195] uppercase tracking-wider block">RMSE Error</span>
              <span className="text-[#F0FFEA] font-semibold mt-1 block">
                {selectedExp.metrics.rmse_px?.toFixed(2) ?? '--'} px
              </span>
            </div>
            <div className="bg-[#262824] p-3 rounded-lg border border-[#33362F]">
              <span className="text-[10px] text-[#9CA195] uppercase tracking-wider block">Lock Retention</span>
              <span className="text-[#FF5F40] font-semibold mt-1 block">
                {selectedExp.metrics.lock_retention_percent.toFixed(1)}%
              </span>
            </div>
            <div className="bg-[#262824] p-3 rounded-lg border border-[#33362F]">
              <span className="text-[10px] text-[#9CA195] uppercase tracking-wider block">Throughput Rate</span>
              <span className="text-[#FF5F40] font-semibold mt-1 block">
                {selectedExp.metrics.average_fps.toFixed(1)} FPS
              </span>
            </div>
            <div className="bg-[#262824] p-3 rounded-lg border border-[#33362F]">
              <span className="text-[10px] text-[#9CA195] uppercase tracking-wider block">Execution Latency</span>
              <span className="text-[#F0FFEA] font-semibold mt-1 block">
                {selectedExp.metrics.average_processing_time_ms.toFixed(2)} ms
              </span>
            </div>
          </div>

          {/* Requirements Compliance Breakdown */}
          <div className="bg-[#262824] rounded-lg border border-[#33362F] overflow-hidden">
            <div className="p-3 bg-[#1B1D1A] border-b border-[#33362F] text-[11px] font-semibold text-[#F0FFEA] uppercase tracking-wider">
              Official Requirement Verification Results
            </div>
            <div className="divide-y divide-[#33362F] text-xs">
              {selectedExp.requirements.map((r, i) => (
                <div key={i} className="p-3 flex items-center justify-between flex-wrap gap-2">
                  <span className="font-medium text-[#F0FFEA]">{r.parameter}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-[#9CA195] text-[11px]">Required: {r.required}</span>
                    <span className="text-[#F0FFEA] font-semibold">{r.actual}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                        r.status === 'PASS'
                          ? 'bg-[#FF5F40]/15 border-[#FF5F40]/40 text-[#FF5F40]'
                          : 'bg-[#262824] border-[#5E625A] text-[#9CA195]'
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
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-xl max-w-xl w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3.5 border-b border-[#33362F] mb-4">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-[#FF5F40]" />
                <h3 className="text-sm font-semibold text-[#F0FFEA] tracking-wide uppercase">
                  Create & Run Custom Experiment
                </h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-[#9CA195] hover:text-[#F0FFEA] font-medium text-sm p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateExperiment} className="space-y-4">
              <div>
                <label className="block text-xs text-[#9CA195] mb-1.5 font-medium">Experiment / Scenario Title</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded-lg px-3 py-2 text-xs text-[#F0FFEA] outline-none transition"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#9CA195] mb-1.5 font-medium">Algorithm Candidate</label>
                  <select
                    value={formAlgorithm}
                    onChange={(e: any) => setFormAlgorithm(e.target.value)}
                    className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded-lg px-3 py-2 text-xs text-[#F0FFEA] outline-none transition cursor-pointer"
                  >
                    <option value="Basic CV">Basic CV</option>
                    <option value="CV + Kalman">CV + Kalman</option>
                    <option value="CV + PID">CV + PID</option>
                    <option value="AI">AI</option>
                    <option value="AI + Kalman + PID">AI + Kalman + PID</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-[#9CA195] mb-1.5 font-medium">Target Trajectory</label>
                  <select
                    value={formMotion}
                    onChange={(e: any) => setFormMotion(e.target.value)}
                    className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded-lg px-3 py-2 text-xs text-[#F0FFEA] outline-none transition cursor-pointer"
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
                  <label className="block text-xs text-[#9CA195] mb-1.5 font-medium">Noise Engine Model</label>
                  <select
                    value={formNoise}
                    onChange={(e: any) => setFormNoise(e.target.value)}
                    className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded-lg px-3 py-2 text-xs text-[#F0FFEA] outline-none transition cursor-pointer"
                  >
                    <option value="None">None</option>
                    <option value="Gaussian">Gaussian</option>
                    <option value="Salt & Pepper">Salt & Pepper</option>
                    <option value="Poisson">Poisson</option>
                    <option value="Multi-Noise">Multi-Noise</option>
                  </select>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs text-[#9CA195] font-medium">Noise Sigma</label>
                    <span className="text-xs text-[#FF5F40]">{formNoiseSigma} px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    step="0.5"
                    value={formNoiseSigma}
                    onChange={(e) => setFormNoiseSigma(parseFloat(e.target.value))}
                    className="w-full accent-[#FF5F40] cursor-pointer"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5 text-[#F0FFEA]">
                <div>
                  <label className="block text-[11px] text-[#9CA195] mb-1 font-medium">PID Kp</label>
                  <input
                    type="number"
                    step="0.05"
                    value={formPidKp}
                    onChange={(e) => setFormPidKp(parseFloat(e.target.value))}
                    className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded-lg px-2.5 py-1.5 text-xs text-[#F0FFEA]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#9CA195] mb-1 font-medium">PID Ki</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formPidKi}
                    onChange={(e) => setFormPidKi(parseFloat(e.target.value))}
                    className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded-lg px-2.5 py-1.5 text-xs text-[#F0FFEA]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#9CA195] mb-1 font-medium">PID Kd</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formPidKd}
                    onChange={(e) => setFormPidKd(parseFloat(e.target.value))}
                    className="w-full bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] rounded-lg px-2.5 py-1.5 text-xs text-[#F0FFEA]"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs text-[#9CA195] font-medium">Trial Duration</label>
                  <span className="text-xs text-[#FF5F40]">{formDuration}s</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="0.5"
                  value={formDuration}
                  onChange={(e) => setFormDuration(parseFloat(e.target.value))}
                  className="w-full accent-[#FF5F40] cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3.5 border-t border-[#33362F]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3.5 py-2 bg-[#262824] hover:bg-[#33362F] border border-[#33362F] text-[#F0FFEA] rounded-lg font-medium text-xs transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-2 bg-[#FF5F40] hover:bg-[#FF7459] text-[#0A0A0A] font-bold rounded-lg text-xs flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                >
                  {isCreating ? <RotateCcw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  {isCreating ? 'Simulating...' : 'Run & Store Trial'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Validation Run Inspection Modal */}
      {selectedValidationRun && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-xl max-w-2xl w-full p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between pb-4 border-b border-[#33362F]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#FF5F40]/10 border border-[#FF5F40]/30 flex items-center justify-center">
                  <Globe className="w-4 h-4 text-[#FF5F40]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#F0FFEA] tracking-wide uppercase flex items-center gap-2">
                    {selectedValidationRun.run_id}: {selectedValidationRun.name}
                  </h3>
                  <p className="text-[#9CA195] text-xs">
                    Scenario Type: {selectedValidationRun.scenario_type} | Duration: {selectedValidationRun.duration_s}s ({selectedValidationRun.total_frames} frames)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedValidationRun(null)}
                className="text-[#9CA195] hover:text-[#F0FFEA] text-base font-medium p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-4">
              {/* Expected vs Actual */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-[#262824] border border-[#33362F] p-3.5 rounded-lg">
                  <span className="text-[11px] uppercase font-semibold text-[#FF5F40] block mb-1">Expected Behavior</span>
                  <p className="text-[#9CA195] text-xs leading-relaxed">{selectedValidationRun.expected_behavior}</p>
                </div>
                <div className="bg-[#262824] border border-[#33362F] p-3.5 rounded-lg">
                  <span className="text-[11px] uppercase font-semibold text-[#FF5F40] block mb-1">Actual Simulation Outcome</span>
                  <p className="text-[#F0FFEA] text-xs leading-relaxed">{selectedValidationRun.actual_outcome}</p>
                </div>
              </div>

              {/* Kinematic & Metric Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-center">
                <div className="bg-[#262824] border border-[#33362F] p-3 rounded-lg">
                  <div className="text-[10px] text-[#9CA195] uppercase tracking-wider font-semibold">Lock Retention</div>
                  <div className="text-base font-bold text-[#FF5F40] mt-1">{selectedValidationRun.lock_retention_percent.toFixed(1)}%</div>
                  <div className="text-[10px] text-[#9CA195] mt-0.5">Excl. Blocked frames</div>
                </div>
                <div className="bg-[#262824] border border-[#33362F] p-3 rounded-lg">
                  <div className="text-[10px] text-[#9CA195] uppercase tracking-wider font-semibold">Acquisition Time</div>
                  <div className="text-base font-bold text-[#F0FFEA] mt-1">
                    {selectedValidationRun.acquisition_time_s !== null ? `${selectedValidationRun.acquisition_time_s.toFixed(2)}s` : 'N/A'}
                  </div>
                  <div className="text-[10px] text-[#9CA195] mt-0.5">Time to boresight lock</div>
                </div>
                <div className="bg-[#262824] border border-[#33362F] p-3 rounded-lg">
                  <div className="text-[10px] text-[#9CA195] uppercase tracking-wider font-semibold">Mean Tracking Error</div>
                  <div className="text-base font-bold text-[#FF5F40] mt-1">{selectedValidationRun.mean_tracking_error_px.toFixed(2)} px</div>
                  <div className="text-[10px] text-[#9CA195] mt-0.5">{selectedValidationRun.mean_tracking_error_deg.toFixed(3)}°</div>
                </div>
                <div className="bg-[#262824] border border-[#33362F] p-3 rounded-lg">
                  <div className="text-[10px] text-[#9CA195] uppercase tracking-wider font-semibold">Max Tracking Error</div>
                  <div className="text-base font-bold text-[#F0FFEA] mt-1">{selectedValidationRun.max_tracking_error_px.toFixed(2)} px</div>
                  <div className="text-[10px] text-[#9CA195] mt-0.5">{selectedValidationRun.max_tracking_error_deg.toFixed(3)}°</div>
                </div>
              </div>

              {/* Hardware & Link Geometry */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-center">
                <div className="bg-[#262824] border border-[#33362F] p-3 rounded-lg">
                  <div className="text-[10px] text-[#9CA195] uppercase tracking-wider font-semibold">Max Angular Rate</div>
                  <div className="text-sm font-bold text-[#F0FFEA] mt-1">{selectedValidationRun.max_angular_rate_deg_s.toFixed(2)}°/s</div>
                  <div className="text-[10px] text-[#9CA195] mt-0.5">Mean: {selectedValidationRun.mean_angular_rate_deg_s.toFixed(2)}°/s</div>
                </div>
                <div className="bg-[#262824] border border-[#33362F] p-3 rounded-lg">
                  <div className="text-[10px] text-[#9CA195] uppercase tracking-wider font-semibold">Slew Saturation</div>
                  <div className="text-sm font-bold text-[#FF5F40] mt-1">{selectedValidationRun.count_slew_saturated} frames</div>
                  <div className="text-[10px] text-[#9CA195] mt-0.5">Clamped at max speed</div>
                </div>
                <div className="bg-[#262824] border border-[#33362F] p-3 rounded-lg">
                  <div className="text-[10px] text-[#9CA195] uppercase tracking-wider font-semibold">Gimbal Limit</div>
                  <div className="text-sm font-bold text-[#F0FFEA] mt-1">{selectedValidationRun.count_gimbal_limit} frames</div>
                  <div className="text-[10px] text-[#9CA195] mt-0.5">Pan ±180° / Tilt limit</div>
                </div>
                <div className="bg-[#262824] border border-[#33362F] p-3 rounded-lg">
                  <div className="text-[10px] text-[#9CA195] uppercase tracking-wider font-semibold">LOS Blocked</div>
                  <div className="text-sm font-bold text-[#FF5F40] mt-1">
                    {selectedValidationRun.count_link_blocked} frames
                  </div>
                  <div className="text-[10px] text-[#9CA195] mt-0.5">Duration: {selectedValidationRun.duration_link_blocked_s.toFixed(1)}s</div>
                </div>
              </div>

              {/* Range & Notes */}
              <div className="bg-[#262824] border border-[#33362F] p-3.5 rounded-lg text-xs space-y-1.5">
                <div className="flex justify-between text-[#9CA195] text-xs flex-wrap gap-2">
                  <span>Range Extents:</span>
                  <span className="text-[#F0FFEA]">
                    Min {selectedValidationRun.min_range_km.toFixed(1)} km &bull; Mean {selectedValidationRun.mean_range_km.toFixed(1)} km &bull; Max {selectedValidationRun.max_range_km.toFixed(1)} km
                  </span>
                </div>
                {selectedValidationRun.notes && (
                  <div className="pt-2 border-t border-[#33362F] text-[#9CA195] text-xs leading-relaxed">
                    <strong className="text-[#F0FFEA] font-medium">Technical Analysis: </strong>{selectedValidationRun.notes}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end pt-3.5 border-t border-[#33362F]">
              <button
                onClick={() => setSelectedValidationRun(null)}
                className="px-4 py-2 bg-[#262824] hover:bg-[#33362F] border border-[#33362F] text-[#F0FFEA] rounded-lg font-medium text-xs transition cursor-pointer"
              >
                Close Inspection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
