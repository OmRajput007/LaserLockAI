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
    <div className="flex flex-col gap-6 text-slate-200 font-sans pb-12">
      {/* Top Header Bar */}
      <div className="bg-[#121518] border border-[#252A2E] p-5 rounded-xl flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-[#1A1D20] border border-[#3A4048]/20 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-[#D6D9DC]" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-sm font-semibold text-white tracking-wide">
                Automated Performance Report & Certification
              </h2>
              {report && (
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                    report.status === 'PASS'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                  }`}
                >
                  {report.status}
                </span>
              )}
            </div>
            <p className="text-slate-400 text-xs mt-0.5">
              Official Evaluation Protocol &bull; Telemetry Certification
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center flex-wrap gap-2.5">
          {/* Report Selector Dropdown */}
          {reportList.length > 0 && (
            <div className="relative">
              <select
                value={selectedReportId}
                onChange={(e) => handleSelectReport(e.target.value)}
                className="bg-[#121518] border border-[#252A2E] hover:border-[#22324e] text-slate-200 text-xs px-3 py-2 rounded-lg font-mono appearance-none pr-8 cursor-pointer focus:outline-none focus:border-[#3A4048] transition"
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
            className="px-3.5 py-2 bg-[#1A1D20] hover:bg-[#1e2a42] border border-[#22324e] text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
            title="Refresh active report"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <button
            onClick={handleGenerateNow}
            disabled={generating}
            className="px-4 py-2 bg-[#252A2E] hover:bg-[#252A2E] text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-sm disabled:opacity-50 cursor-pointer"
          >
            <Zap className={`w-3.5 h-3.5 ${generating ? 'animate-pulse' : ''}`} />
            {generating ? 'Compiling Report...' : 'Generate New Report'}
          </button>

          <div className="h-5 w-[1px] bg-[#252A2E] mx-1 hidden sm:block" />

          {/* Export Buttons */}
          <button
            onClick={handlePrintPdf}
            disabled={!report}
            className="px-3 py-2 bg-[#1A1D20] hover:bg-[#1e2a42] border border-[#22324e] text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
            title="Export printable HTML document for Save-As-PDF"
          >
            <Printer className="w-3.5 h-3.5 text-[#D6D9DC]" />
            Print / PDF
          </button>

          <a
            href={report ? api.getExportCsvUrl(report.report_id) : '#'}
            download
            className={`px-3 py-2 bg-[#1A1D20] hover:bg-[#1e2a42] border border-[#22324e] text-emerald-400 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
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
            className={`px-3 py-2 bg-[#1A1D20] hover:bg-[#1e2a42] border border-[#22324e] text-purple-400 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
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
        <div className="bg-rose-950/60 border border-rose-800/80 text-rose-300 p-3.5 rounded-xl flex items-center gap-2 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {report && (
        <>
          {/* Metadata Banner */}
          <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-[#121518] p-3 rounded-lg border border-[#252A2E]">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Report Identifier</div>
              <div className="font-semibold text-white mt-1 text-xs truncate font-mono">{report.report_id}</div>
            </div>
            <div className="bg-[#121518] p-3 rounded-lg border border-[#252A2E]">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Experiment ID</div>
              <div className="font-semibold text-[#D6D9DC] mt-1 text-xs truncate font-mono">{report.experiment_id}</div>
            </div>
            <div className="bg-[#121518] p-3 rounded-lg border border-[#252A2E]">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Date & Time</div>
              <div className="font-semibold text-slate-200 mt-1 text-xs truncate font-mono">
                {new Date(report.timestamp).toLocaleString()}
              </div>
            </div>
            <div className="bg-[#121518] p-3 rounded-lg border border-[#252A2E]">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Operational Mode</div>
              <div className="font-semibold text-indigo-400 mt-1 text-xs truncate">{report.mode}</div>
            </div>
            <div className="bg-[#121518] p-3 rounded-lg border border-[#252A2E]">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Total Raw Frames</div>
              <div className="font-semibold text-amber-400 mt-1 text-xs font-mono">{report.total_log_entries} frames</div>
            </div>
            <div className="bg-[#121518] p-3 rounded-lg border border-[#252A2E]">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Verification Result</div>
              <div
                className={`font-semibold mt-1 text-xs flex items-center gap-1.5 ${
                  report.status === 'PASS' ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {report.status === 'PASS' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {report.status}
              </div>
            </div>
          </div>

          {/* Navigation Tabs - Strict rule: No Numbers */}
          <div className="flex border-b border-[#252A2E] gap-1.5 bg-[#121518] p-1.5 rounded-xl overflow-x-auto">
            {[
              { id: 'kpis', label: 'Executive KPIs', icon: Activity },
              { id: 'requirements', label: 'Requirements Verification', icon: ShieldCheck },
              { id: 'graphs', label: 'Telemetry Curves', icon: Zap },
              { id: 'config', label: 'Subsystem Configuration', icon: Sliders },
              { id: 'raw_log', label: 'Raw Performance Log', icon: Layers },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition text-xs cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-[#1A1D20] text-[#D6D9DC] border border-[#3A4048]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-[#1A1D20]/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab: Executive KPIs */}
          {activeTab === 'kpis' && m && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Tracking Accuracy */}
                <div className="bg-[#121518] border border-[#252A2E] p-4 rounded-xl">
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                      Average Tracking Error
                    </span>
                    <Target className="w-4 h-4 text-[#D6D9DC]" />
                  </div>
                  <div className="text-2xl font-bold font-mono text-[#D6D9DC] mt-2">
                    {m.average_tracking_error_px != null ? `${m.average_tracking_error_px.toFixed(2)} px` : '--'}
                  </div>
                  <div className="text-xs text-slate-400 mt-2 flex justify-between border-t border-[#252A2E] pt-2 font-mono">
                    <span>Max: {m.max_tracking_error_px != null ? `${m.max_tracking_error_px.toFixed(2)} px` : '--'}</span>
                    <span className="text-[#E8EAED] font-semibold">RMSE: {m.rmse_px != null ? `${m.rmse_px.toFixed(2)} px` : '--'}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">Official Threshold: &le; 10.0 pixels</div>
                </div>

                {/* Lock Retention */}
                <div className="bg-[#121518] border border-[#252A2E] p-4 rounded-xl">
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                      Lock Retention Rate
                    </span>
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-2xl font-bold font-mono text-emerald-400 mt-2">
                    {m.lock_retention_percent.toFixed(1)} %
                  </div>
                  <div className="text-xs text-slate-400 mt-2 flex justify-between border-t border-[#252A2E] pt-2 font-mono">
                    <span>Target Loss: {m.target_loss_percent.toFixed(1)}%</span>
                    <span className="text-emerald-400">Continuous PAT</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">Target Loss Spec: &lt; 5.0 %</div>
                </div>

                {/* Acquisition Timing */}
                <div className="bg-[#121518] border border-[#252A2E] p-4 rounded-xl">
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                      Acquisition Time
                    </span>
                    <Clock className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="text-2xl font-bold font-mono text-amber-400 mt-2">
                    {m.acquisition_time_s != null ? `${m.acquisition_time_s.toFixed(2)} s` : 'Searching'}
                  </div>
                  <div className="text-xs text-slate-400 mt-2 flex justify-between border-t border-[#252A2E] pt-2 font-mono">
                    <span>Re-acq: {m.reacquisition_time_s != null ? `${m.reacquisition_time_s.toFixed(2)} s` : '0.00 s'}</span>
                    <span className="text-amber-300 font-semibold">Req: &le; 2.0s</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">Re-acquisition Spec: &le; 1.0 s</div>
                </div>

                {/* Processing Speed */}
                <div className="bg-[#121518] border border-[#252A2E] p-4 rounded-xl">
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                      Processing Throughput
                    </span>
                    <Zap className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="text-2xl font-bold font-mono text-purple-400 mt-2">
                    {m.average_fps.toFixed(1)} FPS
                  </div>
                  <div className="text-xs text-slate-400 mt-2 flex justify-between border-t border-[#252A2E] pt-2 font-mono">
                    <span>Min/Max: {m.min_fps.toFixed(0)} / {m.max_fps.toFixed(0)}</span>
                    <span className="text-purple-300">Latency: {m.average_processing_time_ms.toFixed(1)}ms</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">Official Threshold: &ge; 20.0 FPS</div>
                </div>
              </div>

              {/* Extended Metrics Table */}
              <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-5">
                <h3 className="text-xs font-semibold text-white uppercase tracking-wider mb-3.5 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#D6D9DC]" />
                  Comprehensive Experimental Telemetry Summary
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 text-xs">
                  <div className="p-3.5 bg-[#121518] rounded-lg border border-[#252A2E]">
                    <div className="text-slate-400 text-[10px] uppercase font-semibold">Simulation Duration</div>
                    <div className="text-base font-bold font-mono text-slate-200 mt-1">{m.simulation_duration_s.toFixed(2)} s</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Elapsed Virtual Time</div>
                  </div>
                  <div className="p-3.5 bg-[#121518] rounded-lg border border-[#252A2E]">
                    <div className="text-slate-400 text-[10px] uppercase font-semibold">Beacon Detection Rate</div>
                    <div className="text-base font-bold font-mono text-[#D6D9DC] mt-1">{m.detection_rate_percent.toFixed(1)} %</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Sensor Hits / Total Frames</div>
                  </div>
                  <div className="p-3.5 bg-[#121518] rounded-lg border border-[#252A2E]">
                    <div className="text-slate-400 text-[10px] uppercase font-semibold">Mean Detection Confidence</div>
                    <div className="text-base font-bold font-mono text-indigo-400 mt-1">{(m.average_confidence * 100).toFixed(1)} %</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Clutter Discrimination Index</div>
                  </div>
                  <div className="p-3.5 bg-[#121518] rounded-lg border border-[#252A2E]">
                    <div className="text-slate-400 text-[10px] uppercase font-semibold">Mean Optical SNR</div>
                    <div className="text-base font-bold font-mono text-amber-400 mt-1">
                      {m.average_snr_db != null ? `${m.average_snr_db.toFixed(1)} dB` : '--'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Radiant Beacon Signal-to-Noise</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab: Requirements Verification Checklist */}
          {activeTab === 'requirements' && (
            <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#252A2E] pb-3.5">
                <div>
                  <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Mandatory Specification Verification
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Rigorous verification of coarse alignment requirements against sensor measurements
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-[#252A2E]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#121518] border-b border-[#252A2E] text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-3.5">Mandatory Parameter</th>
                      <th className="py-3 px-3 text-right">Official Requirement</th>
                      <th className="py-3 px-3 text-right">Actual Measured</th>
                      <th className="py-3 px-3 text-right">Compliance Margin</th>
                      <th className="py-3 px-3.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#252A2E] text-slate-300">
                    {report.requirements.map((req, idx) => {
                      const isPass = req.status === 'PASS';
                      return (
                        <tr key={idx} className="hover:bg-[#1A1D20]/60 transition">
                          <td className="py-3 px-3.5 font-medium text-white flex items-center gap-2">
                            {isPass ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : (
                              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                            )}
                            {req.parameter}
                          </td>
                          <td className="py-3 px-3 text-right text-slate-300 font-mono">{req.required}</td>
                          <td className="py-3 px-3 text-right font-semibold text-[#E8EAED] font-mono">{req.actual}</td>
                          <td className="py-3 px-3 text-right text-slate-400 font-mono">
                            {req.margin != null ? `${req.margin > 0 ? '+' : ''}${req.margin} ${req.unit}` : '--'}
                          </td>
                          <td className="py-3 px-3.5 text-center">
                            <span
                              className={`px-2.5 py-0.5 rounded text-[10px] font-semibold border inline-block ${
                                isPass
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
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

          {/* Tab: Graphs / Telemetry Curves */}
          {activeTab === 'graphs' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Tracking & Centroid Error Curves */}
              <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">Tracking Error (pixels) vs Frame</span>
                  <span className="text-[11px] font-mono text-[#D6D9DC]">Spec: &le; 10 px</span>
                </div>
                <div className="h-44 bg-[#121518] rounded-lg border border-[#252A2E] p-2.5 flex items-end gap-1 overflow-x-auto">
                  {report.raw_log_sample.map((pt, i) => {
                    const err = pt.total_error_px || 0;
                    const heightPct = Math.min(100, (err / 30.0) * 100);
                    const color = err <= 10.0 ? '#D6D9DC' : '#ef4444';
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
                <div className="flex justify-between text-[11px] font-mono text-slate-500 mt-2">
                  <span>Frame 1</span>
                  <span>Frame {report.raw_log_sample.length}</span>
                </div>
              </div>

              {/* Processing FPS & Throughput */}
              <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">Throughput (FPS) vs Frame</span>
                  <span className="text-[11px] font-mono text-emerald-400">Spec: &ge; 20 FPS</span>
                </div>
                <div className="h-44 bg-[#121518] rounded-lg border border-[#252A2E] p-2.5 flex items-end gap-1 overflow-x-auto">
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
                <div className="flex justify-between text-[11px] font-mono text-slate-500 mt-2">
                  <span>Frame 1</span>
                  <span>Frame {report.raw_log_sample.length}</span>
                </div>
              </div>

              {/* Gimbal Pan & Tilt Actuation */}
              <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">Gimbal Orientation (Pan &deg; / Tilt &deg;)</span>
                  <span className="text-[11px] font-mono text-slate-400">Max Slew 5&deg;/s</span>
                </div>
                <div className="h-44 bg-[#121518] rounded-lg border border-[#252A2E] p-2.5 flex items-center gap-1 overflow-x-auto relative">
                  <div className="absolute inset-x-0 h-[1px] bg-[#252A2E]" />
                  {report.raw_log_sample.map((pt, i) => {
                    const panH = Math.min(45, Math.abs(pt.pan_deg) * 3);
                    return (
                      <div
                        key={i}
                        className="flex-1 min-w-[4px] bg-blue-400/80 rounded"
                        style={{ height: `${Math.max(4, panH)}%` }}
                        title={`Frame ${pt.frame_number}: Pan ${pt.pan_deg.toFixed(2)}°, Tilt ${pt.tilt_deg.toFixed(2)}°`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[11px] font-mono text-slate-500 mt-2">
                  <span>Frame 1</span>
                  <span>Frame {report.raw_log_sample.length}</span>
                </div>
              </div>

              {/* Confidence & SNR Quality */}
              <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-white uppercase tracking-wider">Detection Confidence (%) vs Frame</span>
                  <span className="text-[11px] font-mono text-indigo-400">Target Disambiguation</span>
                </div>
                <div className="h-44 bg-[#121518] rounded-lg border border-[#252A2E] p-2.5 flex items-end gap-1 overflow-x-auto">
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
                <div className="flex justify-between text-[11px] font-mono text-slate-500 mt-2">
                  <span>Frame 1</span>
                  <span>Frame {report.raw_log_sample.length}</span>
                </div>
              </div>
            </div>
          )}

          {/* Tab: Subsystem Configuration */}
          {activeTab === 'config' && (
            <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-5 space-y-4">
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#D6D9DC]" />
                Subsystem Architecture & Hardware Configuration Record
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {Object.entries(report.configuration || {}).map(([category, details]) => (
                  <div key={category} className="bg-[#121518] p-4 rounded-lg border border-[#252A2E]">
                    <div className="text-[#D6D9DC] font-semibold uppercase tracking-wider text-xs border-b border-[#252A2E] pb-2 mb-3">
                      {category.toUpperCase()} CONFIGURATION
                    </div>
                    <div className="space-y-2 font-mono text-xs">
                      {typeof details === 'object' && details !== null ? (
                        Object.entries(details).map(([k, v]) => (
                          <div key={k} className="flex justify-between text-slate-300 py-1 border-b border-[#252A2E]/40 last:border-b-0">
                            <span className="text-slate-500">{k}:</span>
                            <span className="text-white font-medium">{String(v)}</span>
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

          {/* Tab: Raw Performance Log */}
          {activeTab === 'raw_log' && (
            <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                    <Layers className="w-4 h-4 text-[#D6D9DC]" />
                    Frame-by-Frame Raw Performance Telemetry Log
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Only includes ground truth reference values when actual ground truth was provided.
                  </p>
                </div>

                <div className="flex items-center gap-2.5">
                  <input
                    type="text"
                    placeholder="Search state, status, frame..."
                    value={rawLogSearch}
                    onChange={(e) => {
                      setRawLogSearch(e.target.value);
                      setRawLogPage(1);
                    }}
                    className="bg-[#121518] border border-[#252A2E] focus:border-[#3A4048] text-slate-200 px-3 py-1.5 rounded-lg text-xs outline-none transition"
                  />
                  <span className="text-xs text-slate-400">
                    Showing {paginatedLogs.length} of {filteredRawLogs.length}
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[500px] rounded-lg border border-[#252A2E]">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="sticky top-0 bg-[#121518] border-b border-[#252A2E] z-10 text-[11px] text-slate-400 uppercase font-semibold">
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
                      <th className="py-2.5 px-3 text-right">Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#252A2E] text-slate-300">
                    {paginatedLogs.map((log) => (
                      <tr key={log.frame_number} className="hover:bg-[#1A1D20]/60 transition">
                        <td className="py-2 px-3 text-slate-300 font-medium">#{log.frame_number}</td>
                        <td className="py-2 px-3 text-slate-400">{log.timestamp_s.toFixed(3)}</td>
                        <td className="py-2 px-3 text-[#E8EAED]">
                          {log.centroid_x != null ? `(${log.centroid_x.toFixed(1)}, ${log.centroid_y?.toFixed(1)})` : '--'}
                        </td>
                        <td className="py-2 px-3 text-slate-400">
                          {log.reference_x != null ? `(${log.reference_x.toFixed(1)}, ${log.reference_y?.toFixed(1)})` : '--'}
                        </td>
                        <td className="py-2 px-3 text-slate-400">
                          {log.error_x_px != null ? `${log.error_x_px > 0 ? '+' : ''}${log.error_x_px} / ${log.error_y_px}` : '--'}
                        </td>
                        <td className="py-2 px-3 font-semibold">
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
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              log.tracking_state === 'LOCKED'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                : log.tracking_state === 'TRACKING'
                                ? 'bg-[#1A1D20] text-[#D6D9DC] border border-[#3A4048]'
                                : 'bg-[#1A1D20] text-slate-400 border border-[#22324e]'
                            }`}
                          >
                            {log.tracking_state}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-400">
                          {log.pan_deg.toFixed(1)}&deg; / {log.tilt_deg.toFixed(1)}&deg;
                        </td>
                        <td className="py-2 px-3 text-slate-300">{log.fps.toFixed(1)}</td>
                        <td className="py-2 px-3 text-right text-slate-400">{log.processing_time_ms.toFixed(1)} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-[#252A2E] pt-3.5 text-xs text-slate-400">
                  <button
                    onClick={() => setRawLogPage((p) => Math.max(1, p - 1))}
                    disabled={rawLogPage === 1}
                    className="px-3 py-1.5 bg-[#1A1D20] hover:bg-[#1e2a42] border border-[#22324e] text-slate-200 rounded-lg disabled:opacity-40 transition cursor-pointer"
                  >
                    Previous
                  </button>
                  <span className="font-mono">
                    Page {rawLogPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setRawLogPage((p) => Math.min(totalPages, p + 1))}
                    disabled={rawLogPage === totalPages}
                    className="px-3 py-1.5 bg-[#1A1D20] hover:bg-[#1e2a42] border border-[#22324e] text-slate-200 rounded-lg disabled:opacity-40 transition cursor-pointer"
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
