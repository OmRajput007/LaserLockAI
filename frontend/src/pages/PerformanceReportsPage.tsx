import React, { useState, useEffect } from 'react';
import {
  FileText,
  Download,
  Printer,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Sliders,
  Camera,
  Activity,
  Zap,
  Target,
  Clock,
  Layers,
  ShieldCheck,
  ChevronDown,
} from 'lucide-react';
import { api } from '../services/api';
import { PerformanceReport, PerformanceReportSummary, SystemConfig } from '../types';

interface Props {
  config: SystemConfig | null;
}

export const PerformanceReportsPage: React.FC<Props> = ({ config }) => {
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [reportList, setReportList] = useState<PerformanceReportSummary[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [generating, setGenerating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'kpis' | 'requirements' | 'raw_log' | 'config' | 'graphs'>('kpis');
  const [rawLogSearch, setRawLogSearch] = useState<string>('');
  const [rawLogPage, setRawLogPage] = useState<number>(1);
  const rowsPerPage = 20;

  const loadReports = async (targetId?: string) => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const list = await api.listPerformanceReports();
      setReportList(list);

      let currentReport: PerformanceReport;
      if (targetId) {
        currentReport = await api.getPerformanceReportById(targetId);
      } else {
        currentReport = await api.getLatestPerformanceReport();
      }

      setReport(currentReport);
      setSelectedReportId(currentReport.report_id);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load performance report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  const handleGenerateNow = async () => {
    try {
      setGenerating(true);
      setErrorMsg(null);
      const newReport = await api.generateReportNow();
      setReport(newReport);
      setSelectedReportId(newReport.report_id);
      const list = await api.listPerformanceReports();
      setReportList(list);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  const handleSelectReport = async (reportId: string) => {
    setSelectedReportId(reportId);
    await loadReports(reportId);
  };

  const handlePrintPdf = () => {
    if (!report) return;
    const url = api.getExportHtmlUrl(report.report_id);
    const win = window.open(url, '_blank');
    if (win) {
      win.focus();
      // Browser @media print triggers when user prints
    }
  };

  const m = report?.metrics;

  const filteredRawLogs = (report?.raw_log_sample || []).filter((row) => {
    if (!rawLogSearch) return true;
    const q = rawLogSearch.toLowerCase();
    return (
      row.frame_number.toString().includes(q) ||
      row.tracking_state.toLowerCase().includes(q) ||
      row.detection_status.toLowerCase().includes(q)
    );
  });

  const paginatedLogs = filteredRawLogs.slice((rawLogPage - 1) * rowsPerPage, rawLogPage * rowsPerPage);
  const totalPages = Math.ceil(filteredRawLogs.length / rowsPerPage) || 1;

  return (
    <div className="flex flex-col gap-4 font-mono text-xs pb-10">
      {/* Top Header Bar */}
      <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-lg flex flex-wrap items-center justify-between gap-4 shadow-lg backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
            <FileText className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white uppercase tracking-wider">
                Automated Performance Report & Official Certification
              </h2>
              {report && (
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                    report.status === 'PASS'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      : 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                  }`}
                >
                  {report.status}
                </span>
              )}
            </div>
            <p className="text-slate-400 text-[11px] mt-0.5">
              Problem Statement 4 Official Evaluation Protocol &bull; Auto-Generated Telemetry Certification
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Report Selector Dropdown */}
          {reportList.length > 0 && (
            <div className="relative">
              <select
                value={selectedReportId}
                onChange={(e) => handleSelectReport(e.target.value)}
                className="bg-slate-950 border border-slate-700 hover:border-slate-600 text-slate-200 text-xs px-3 py-2 rounded-lg font-mono appearance-none pr-8 cursor-pointer focus:outline-none focus:border-cyan-500 transition"
              >
                {reportList.map((r) => (
                  <option key={r.report_id} value={r.report_id}>
                    {r.report_id} &bull; {r.mode} ({r.status})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-3 pointer-events-none" />
            </div>
          )}

          <button
            onClick={() => loadReports(selectedReportId)}
            disabled={loading}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-bold flex items-center gap-1.5 transition border border-slate-700"
            title="Refresh active report"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <button
            onClick={handleGenerateNow}
            disabled={generating}
            className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold flex items-center gap-1.5 transition shadow-sm"
          >
            <Zap className={`w-3.5 h-3.5 ${generating ? 'animate-pulse' : ''}`} />
            {generating ? 'Compiling Report...' : 'Generate New Report'}
          </button>

          <div className="h-5 w-[1px] bg-slate-800 mx-1 hidden sm:block" />

          {/* Export Buttons */}
          <button
            onClick={handlePrintPdf}
            disabled={!report}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-cyan-500/30 rounded-lg font-bold flex items-center gap-1.5 transition"
            title="Export printable HTML document for Save-As-PDF"
          >
            <Printer className="w-3.5 h-3.5" />
            Print / PDF
          </button>

          <a
            href={report ? api.getExportCsvUrl(report.report_id) : '#'}
            download
            className={`px-3 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 rounded-lg font-bold flex items-center gap-1.5 transition ${
              !report ? 'pointer-events-none opacity-50' : ''
            }`}
            title="Export raw frame performance log CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            CSV Log
          </a>

          <a
            href={report ? api.getExportJsonUrl(report.report_id) : '#'}
            download
            className={`px-3 py-2 bg-slate-800 hover:bg-slate-700 text-purple-400 border border-purple-500/30 rounded-lg font-bold flex items-center gap-1.5 transition ${
              !report ? 'pointer-events-none opacity-50' : ''
            }`}
            title="Export full structured report JSON"
          >
            <Download className="w-3.5 h-3.5" />
            JSON
          </a>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-rose-950/60 border border-rose-800/80 text-rose-300 p-3.5 rounded-lg flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {report && (
        <>
          {/* Metadata Banner */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Report Identifier</div>
              <div className="font-bold text-white mt-0.5 text-xs truncate">{report.report_id}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Experiment ID</div>
              <div className="font-bold text-cyan-400 mt-0.5 text-xs truncate">{report.experiment_id}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Generated Date & Time</div>
              <div className="font-bold text-slate-200 mt-0.5 text-xs truncate">
                {new Date(report.timestamp).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Operational Mode</div>
              <div className="font-bold text-indigo-400 mt-0.5 text-xs truncate">{report.mode}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Total Raw Frames</div>
              <div className="font-bold text-amber-400 mt-0.5 text-xs">{report.total_log_entries} frames</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Verification Result</div>
              <div
                className={`font-bold mt-0.5 text-xs flex items-center gap-1 ${
                  report.status === 'PASS' ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {report.status === 'PASS' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {report.status}
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-800 gap-1 bg-slate-900/40 p-1 rounded-lg">
            {[
              { id: 'kpis', label: '1. Executive KPIs', icon: Activity },
              { id: 'requirements', label: '2. Official Requirements Verification', icon: ShieldCheck },
              { id: 'graphs', label: '3. Performance Telemetry Curves', icon: Zap },
              { id: 'config', label: '4. Subsystem Configuration', icon: Sliders },
              { id: 'raw_log', label: '5. Raw Performance Log', icon: Layers },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-md font-bold transition text-xs ${
                    activeTab === tab.id
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab 1: Executive KPIs */}
          {activeTab === 'kpis' && m && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {/* Tracking Accuracy */}
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-lg relative overflow-hidden">
                  <div className="flex justify-between items-start">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                      Average Tracking Error
                    </span>
                    <Target className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="text-2xl font-bold text-cyan-400 mt-2">
                    {m.average_tracking_error_px != null ? `${m.average_tracking_error_px.toFixed(2)} px` : '--'}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-2 flex justify-between border-t border-slate-800/80 pt-2">
                    <span>Max: {m.max_tracking_error_px != null ? `${m.max_tracking_error_px.toFixed(2)} px` : '--'}</span>
                    <span className="text-cyan-300 font-bold">RMSE: {m.rmse_px != null ? `${m.rmse_px.toFixed(2)} px` : '--'}</span>
                  </div>
                  <div className="text-[9px] text-slate-500 mt-1">Official Threshold: &le; 10.0 pixels</div>
                </div>

                {/* Lock Retention */}
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-lg relative overflow-hidden">
                  <div className="flex justify-between items-start">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                      Lock Retention Rate
                    </span>
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-2xl font-bold text-emerald-400 mt-2">
                    {m.lock_retention_percent.toFixed(1)} %
                  </div>
                  <div className="text-[10px] text-slate-400 mt-2 flex justify-between border-t border-slate-800/80 pt-2">
                    <span>Target Loss: {m.target_loss_percent.toFixed(1)}%</span>
                    <span className="text-emerald-300">Continuous PAT</span>
                  </div>
                  <div className="text-[9px] text-slate-500 mt-1">Target Loss Spec: &lt; 5.0 %</div>
                </div>

                {/* Acquisition Timing */}
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-lg relative overflow-hidden">
                  <div className="flex justify-between items-start">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                      Acquisition Time
                    </span>
                    <Clock className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="text-2xl font-bold text-amber-400 mt-2">
                    {m.acquisition_time_s != null ? `${m.acquisition_time_s.toFixed(2)} s` : 'Searching'}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-2 flex justify-between border-t border-slate-800/80 pt-2">
                    <span>Re-acq: {m.reacquisition_time_s != null ? `${m.reacquisition_time_s.toFixed(2)} s` : '0.00 s'}</span>
                    <span className="text-amber-300 font-bold">Req: &le; 2.0s</span>
                  </div>
                  <div className="text-[9px] text-slate-500 mt-1">Re-acquisition Spec: &le; 1.0 s</div>
                </div>

                {/* Processing Speed */}
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-lg relative overflow-hidden">
                  <div className="flex justify-between items-start">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                      Processing Throughput
                    </span>
                    <Zap className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="text-2xl font-bold text-purple-400 mt-2">
                    {m.average_fps.toFixed(1)} FPS
                  </div>
                  <div className="text-[10px] text-slate-400 mt-2 flex justify-between border-t border-slate-800/80 pt-2">
                    <span>Min/Max: {m.min_fps.toFixed(0)} / {m.max_fps.toFixed(0)}</span>
                    <span className="text-purple-300">Latency: {m.average_processing_time_ms.toFixed(1)}ms</span>
                  </div>
                  <div className="text-[9px] text-slate-500 mt-1">Official Threshold: &ge; 20.0 FPS</div>
                </div>
              </div>

              {/* Extended Metrics Table */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4">
                <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  Comprehensive Experimental Telemetry Summary
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                  <div className="p-3 bg-slate-950 rounded border border-slate-800">
                    <div className="text-slate-400 text-[10px]">SIMULATION DURATION</div>
                    <div className="text-base font-bold text-slate-200 mt-1">{m.simulation_duration_s.toFixed(2)} s</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Elapsed Virtual Time</div>
                  </div>
                  <div className="p-3 bg-slate-950 rounded border border-slate-800">
                    <div className="text-slate-400 text-[10px]">BEACON DETECTION RATE</div>
                    <div className="text-base font-bold text-cyan-400 mt-1">{m.detection_rate_percent.toFixed(1)} %</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Sensor Hits / Total Frames</div>
                  </div>
                  <div className="p-3 bg-slate-950 rounded border border-slate-800">
                    <div className="text-slate-400 text-[10px]">MEAN DETECTION CONFIDENCE</div>
                    <div className="text-base font-bold text-indigo-400 mt-1">{(m.average_confidence * 100).toFixed(1)} %</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Clutter Discrimination Index</div>
                  </div>
                  <div className="p-3 bg-slate-950 rounded border border-slate-800">
                    <div className="text-slate-400 text-[10px]">MEAN OPTICAL SNR</div>
                    <div className="text-base font-bold text-amber-400 mt-1">
                      {m.average_snr_db != null ? `${m.average_snr_db.toFixed(1)} dB` : '--'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Radiant Beacon Signal-to-Noise</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Requirements Verification Checklist */}
          {activeTab === 'requirements' && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Problem Statement 4 Mandatory Specification Verification
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Rigorous verification of coarse alignment requirements against sensor measurements
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase tracking-wider bg-slate-950/60">
                      <th className="py-3 px-4">Mandatory Parameter</th>
                      <th className="py-3 px-4">Official Requirement</th>
                      <th className="py-3 px-4">Actual Measured</th>
                      <th className="py-3 px-4">Compliance Margin</th>
                      <th className="py-3 px-4 text-right">Verification Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {report.requirements.map((req, idx) => {
                      const isPass = req.status === 'PASS';
                      return (
                        <tr key={idx} className="hover:bg-slate-800/30 transition">
                          <td className="py-3 px-4 font-bold text-white flex items-center gap-2">
                            {isPass ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : (
                              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                            )}
                            {req.parameter}
                          </td>
                          <td className="py-3 px-4 text-slate-300 font-mono">{req.required}</td>
                          <td className="py-3 px-4 font-bold text-cyan-300 font-mono">{req.actual}</td>
                          <td className="py-3 px-4 text-slate-400 font-mono">
                            {req.margin != null ? `${req.margin > 0 ? '+' : ''}${req.margin} ${req.unit}` : '--'}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span
                              className={`px-2.5 py-1 rounded text-[10px] font-bold border inline-block ${
                                isPass
                                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                  : 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                              }`}
                            >
                              {req.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 3: Graphs / Telemetry Curves */}
          {activeTab === 'graphs' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Tracking & Centroid Error Curves */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4">
                <h4 className="text-xs font-bold text-white mb-2 flex items-center justify-between">
                  <span>Tracking Error (pixels) vs Frame</span>
                  <span className="text-[10px] text-cyan-400">Spec: &le; 10 px</span>
                </h4>
                <div className="h-44 bg-slate-950 rounded border border-slate-800 p-2 flex items-end gap-1 overflow-x-auto">
                  {report.raw_log_sample.map((pt, i) => {
                    const err = pt.total_error_px || 0;
                    const heightPct = Math.min(100, (err / 30.0) * 100);
                    const color = err <= 10.0 ? '#06b6d4' : '#f43f5e';
                    return (
                      <div
                        key={i}
                        className="flex-1 min-w-[4px] rounded-t transition-all hover:opacity-80"
                        style={{ height: `${Math.max(4, heightPct)}%`, backgroundColor: color }}
                        title={`Frame ${pt.frame_number}: Error ${err.toFixed(2)} px`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-2">
                  <span>Frame 1</span>
                  <span>Frame {report.raw_log_sample.length}</span>
                </div>
              </div>

              {/* Processing FPS & Throughput */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4">
                <h4 className="text-xs font-bold text-white mb-2 flex items-center justify-between">
                  <span>Throughput (FPS) vs Frame</span>
                  <span className="text-[10px] text-emerald-400">Spec: &ge; 20 FPS</span>
                </h4>
                <div className="h-44 bg-slate-950 rounded border border-slate-800 p-2 flex items-end gap-1 overflow-x-auto">
                  {report.raw_log_sample.map((pt, i) => {
                    const fps = pt.fps || 30.0;
                    const heightPct = Math.min(100, (fps / 45.0) * 100);
                    const color = fps >= 20.0 ? '#10b981' : '#f59e0b';
                    return (
                      <div
                        key={i}
                        className="flex-1 min-w-[4px] rounded-t transition-all"
                        style={{ height: `${Math.max(4, heightPct)}%`, backgroundColor: color }}
                        title={`Frame ${pt.frame_number}: ${fps.toFixed(1)} FPS (${pt.processing_time_ms.toFixed(1)} ms)`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-2">
                  <span>Frame 1</span>
                  <span>Frame {report.raw_log_sample.length}</span>
                </div>
              </div>

              {/* Gimbal Pan & Tilt Actuation */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4">
                <h4 className="text-xs font-bold text-white mb-2 flex items-center justify-between">
                  <span>Gimbal Orientation (Pan &deg; in Cyan / Tilt &deg; in Purple)</span>
                  <span className="text-[10px] text-slate-400">Max Slew 5&deg;/s</span>
                </h4>
                <div className="h-44 bg-slate-950 rounded border border-slate-800 p-2 flex items-center gap-1 overflow-x-auto relative">
                  <div className="absolute inset-x-0 h-[1px] bg-slate-800" />
                  {report.raw_log_sample.map((pt, i) => {
                    const panH = Math.min(45, Math.abs(pt.pan_deg) * 3);
                    return (
                      <div
                        key={i}
                        className="flex-1 min-w-[4px] bg-cyan-400/80 rounded"
                        style={{ height: `${Math.max(4, panH)}%` }}
                        title={`Frame ${pt.frame_number}: Pan ${pt.pan_deg.toFixed(2)}°, Tilt ${pt.tilt_deg.toFixed(2)}°`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-2">
                  <span>Frame 1</span>
                  <span>Frame {report.raw_log_sample.length}</span>
                </div>
              </div>

              {/* Confidence & SNR Quality */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4">
                <h4 className="text-xs font-bold text-white mb-2 flex items-center justify-between">
                  <span>Detection Confidence (%) vs Frame</span>
                  <span className="text-[10px] text-indigo-400">Target Disambiguation</span>
                </h4>
                <div className="h-44 bg-slate-950 rounded border border-slate-800 p-2 flex items-end gap-1 overflow-x-auto">
                  {report.raw_log_sample.map((pt, i) => {
                    const conf = (pt.confidence || 0) * 100;
                    return (
                      <div
                        key={i}
                        className="flex-1 min-w-[4px] bg-indigo-500/80 rounded-t"
                        style={{ height: `${Math.max(4, conf)}%` }}
                        title={`Frame ${pt.frame_number}: Confidence ${conf.toFixed(1)}%`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-2">
                  <span>Frame 1</span>
                  <span>Frame {report.raw_log_sample.length}</span>
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: Subsystem Configuration */}
          {activeTab === 'config' && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5 space-y-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                Subsystem Architecture & Hardware Configuration Record
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {Object.entries(report.configuration || {}).map(([category, details]) => (
                  <div key={category} className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <div className="text-cyan-400 font-bold uppercase tracking-wider text-xs border-b border-slate-800 pb-2 mb-3">
                      {category.toUpperCase()} CONFIGURATION
                    </div>
                    <div className="space-y-1.5 font-mono text-[11px]">
                      {typeof details === 'object' && details !== null ? (
                        Object.entries(details).map(([k, v]) => (
                          <div key={k} className="flex justify-between text-slate-300">
                            <span className="text-slate-500">{k}:</span>
                            <span className="text-white font-bold">{String(v)}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-white">{String(details)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab 5: Raw Performance Log */}
          {activeTab === 'raw_log' && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Layers className="w-4 h-4 text-cyan-400" />
                    Frame-by-Frame Raw Performance Telemetry Log
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Only includes ground truth reference values when actual ground truth was provided.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Search state, status, frame..."
                    value={rawLogSearch}
                    onChange={(e) => {
                      setRawLogSearch(e.target.value);
                      setRawLogPage(1);
                    }}
                    className="bg-slate-950 border border-slate-800 text-slate-200 px-3 py-1.5 rounded text-xs focus:outline-none focus:border-cyan-500"
                  />
                  <span className="text-[11px] text-slate-400">
                    Showing {paginatedLogs.length} of {filteredRawLogs.length}
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[500px]">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead className="sticky top-0 bg-slate-950 border-b border-slate-800 z-10 text-[10px] text-slate-400 uppercase">
                    <tr>
                      <th className="py-2.5 px-3">Frame</th>
                      <th className="py-2.5 px-3">Time (s)</th>
                      <th className="py-2.5 px-3">Centroid (X, Y)</th>
                      <th className="py-2.5 px-3">Reference (X, Y)</th>
                      <th className="py-2.5 px-3">Error X / Y</th>
                      <th className="py-2.5 px-3">Total Error</th>
                      <th className="py-2.5 px-3">Confidence</th>
                      <th className="py-2.5 px-3">State</th>
                      <th className="py-2.5 px-3">Gimbal (Pan/Tilt)</th>
                      <th className="py-2.5 px-3">FPS</th>
                      <th className="py-2.5 px-3">Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {paginatedLogs.map((log) => (
                      <tr key={log.frame_number} className="hover:bg-slate-800/20">
                        <td className="py-2 px-3 text-slate-300 font-bold">#{log.frame_number}</td>
                        <td className="py-2 px-3 text-slate-400">{log.timestamp_s.toFixed(3)}</td>
                        <td className="py-2 px-3 text-cyan-300">
                          {log.centroid_x != null ? `(${log.centroid_x.toFixed(1)}, ${log.centroid_y?.toFixed(1)})` : '--'}
                        </td>
                        <td className="py-2 px-3 text-slate-400">
                          {log.reference_x != null ? `(${log.reference_x.toFixed(1)}, ${log.reference_y?.toFixed(1)})` : '--'}
                        </td>
                        <td className="py-2 px-3 text-slate-400">
                          {log.error_x_px != null ? `${log.error_x_px > 0 ? '+' : ''}${log.error_x_px} / ${log.error_y_px}` : '--'}
                        </td>
                        <td className="py-2 px-3 font-bold">
                          {log.total_error_px != null ? (
                            <span className={log.total_error_px <= 10.0 ? 'text-emerald-400' : 'text-rose-400'}>
                              {log.total_error_px.toFixed(2)} px
                            </span>
                          ) : (
                            '--'
                          )}
                        </td>
                        <td className="py-2 px-3 text-indigo-300">{(log.confidence * 100).toFixed(0)}%</td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              log.tracking_state === 'LOCKED'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : log.tracking_state === 'TRACKING'
                                ? 'bg-cyan-500/20 text-cyan-400'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {log.tracking_state}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-400">
                          {log.pan_deg.toFixed(1)}&deg; / {log.tilt_deg.toFixed(1)}&deg;
                        </td>
                        <td className="py-2 px-3 text-slate-300">{log.fps.toFixed(1)}</td>
                        <td className="py-2 px-3 text-slate-400">{log.processing_time_ms.toFixed(1)} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-400">
                  <button
                    onClick={() => setRawLogPage((p) => Math.max(1, p - 1))}
                    disabled={rawLogPage === 1}
                    className="px-3 py-1 bg-slate-800 rounded disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span>
                    Page {rawLogPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setRawLogPage((p) => Math.min(totalPages, p + 1))}
                    disabled={rawLogPage === totalPages}
                    className="px-3 py-1 bg-slate-800 rounded disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
