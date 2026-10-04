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
    <div className="flex flex-col gap-6 text-[#F0FFEA] font-mono pb-12">
      {/* Top Header Bar */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-5 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded bg-[#262824] border border-[#33362F] flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-[#FF5F40]" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-sm font-semibold text-[#F0FFEA] tracking-wide uppercase">
                Automated Performance Report & Certification
              </h2>
              {report && (
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                    report.status === 'PASS'
                      ? 'bg-[#FF5F40]/15 text-[#FF5F40] border-[#FF5F40]'
                      : 'bg-[#262824] text-[#F0FFEA] border-[#33362F]'
                  }`}
                >
                  {report.status === 'PASS' ? '✓ PASS' : '✕ FAIL'}
                </span>
              )}
            </div>
            <p className="text-[#9CA195] text-xs mt-0.5">
              Official Evaluation Protocol • Telemetry Certification
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
                className="bg-[#262824] border border-[#33362F] hover:border-[#FF5F40] text-[#F0FFEA] text-xs px-3 py-2 rounded font-mono appearance-none pr-8 cursor-pointer focus:outline-none focus:border-[#FF5F40] transition"
              >
                {reportList.map((r) => (
                  <option key={r.report_id} value={r.report_id} className="bg-[#262824] text-[#F0FFEA]">
                    {r.report_id} • {r.mode} ({r.status})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-[#9CA195] absolute right-2.5 top-3 pointer-events-none" />
            </div>
          )}

          <button
            onClick={() => loadReports(selectedReportId)}
            disabled={loading}
            className="px-3.5 py-2 bg-[#262824] hover:bg-[#33362F] border border-[#33362F] hover:border-[#FF5F40] text-[#F0FFEA] rounded text-xs font-mono flex items-center gap-1.5 transition cursor-pointer"
            title="Refresh active report"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#FF5F40]' : ''}`} />
            REFRESH
          </button>

          <button
            onClick={handleGenerateNow}
            disabled={generating}
            className="px-4 py-2 bg-[#FF5F40] hover:bg-[#FF7459] active:bg-[#E5492B] text-[#0A0A0A] font-semibold rounded text-xs font-mono flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
          >
            <Zap className={`w-3.5 h-3.5 ${generating ? 'animate-pulse' : ''}`} />
            {generating ? 'COMPILING...' : 'GENERATE NEW REPORT'}
          </button>

          <div className="h-5 w-[1px] bg-[#33362F] mx-1 hidden sm:block" />

          {/* Export Buttons */}
          <button
            onClick={handlePrintPdf}
            disabled={!report}
            className="px-3 py-2 bg-[#262824] hover:bg-[#33362F] border border-[#33362F] hover:border-[#FF5F40] text-[#F0FFEA] rounded text-xs font-mono flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
            title="Export printable HTML document for Save-As-PDF"
          >
            <Printer className="w-3.5 h-3.5 text-[#FF5F40]" />
            PRINT / PDF
          </button>

          <a
            href={report ? api.getExportCsvUrl(report.report_id) : '#'}
            download
            aria-disabled={!report}
            tabIndex={!report ? -1 : undefined}
            className={`px-3 py-2 bg-[#262824] hover:bg-[#33362F] border border-[#33362F] hover:border-[#FF5F40] text-[#F0FFEA] rounded text-xs font-mono flex items-center gap-1.5 transition ${
              !report ? 'pointer-events-none opacity-50' : ''
            }`}
            title="Export raw frame performance log CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-[#FF5F40]" />
            CSV LOG
          </a>

          <a
            href={report ? api.getExportJsonUrl(report.report_id) : '#'}
            download
            aria-disabled={!report}
            tabIndex={!report ? -1 : undefined}
            className={`px-3 py-2 bg-[#262824] hover:bg-[#33362F] border border-[#33362F] hover:border-[#FF5F40] text-[#F0FFEA] rounded text-xs font-mono flex items-center gap-1.5 transition ${
              !report ? 'pointer-events-none opacity-50' : ''
            }`}
            title="Export full structured report JSON"
          >
            <Download className="w-3.5 h-3.5 text-[#FF5F40]" />
            JSON
          </a>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-[#1B1D1A] border border-[#FF5F40] text-[#FF5F40] p-3.5 rounded-lg flex items-center gap-2 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 text-[#FF5F40]" />
          <span>{errorMsg}</span>
        </div>
      )}

      {report && (
        <>
          {/* Metadata Banner */}
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-[#262824] p-3 rounded border border-[#33362F]">
              <div className="text-[10px] text-[#9CA195] uppercase tracking-wider font-semibold">Report Identifier</div>
              <div className="font-semibold text-[#F0FFEA] mt-1 text-xs truncate font-mono">{report.report_id}</div>
            </div>
            <div className="bg-[#262824] p-3 rounded border border-[#33362F]">
              <div className="text-[10px] text-[#9CA195] uppercase tracking-wider font-semibold">Experiment ID</div>
              <div className="font-semibold text-[#FF5F40] mt-1 text-xs truncate font-mono">{report.experiment_id}</div>
            </div>
            <div className="bg-[#262824] p-3 rounded border border-[#33362F]">
              <div className="text-[10px] text-[#9CA195] uppercase tracking-wider font-semibold">Date & Time</div>
              <div className="font-semibold text-[#F0FFEA] mt-1 text-xs truncate font-mono">
                {new Date(report.timestamp).toLocaleString()}
              </div>
            </div>
            <div className="bg-[#262824] p-3 rounded border border-[#33362F]">
              <div className="text-[10px] text-[#9CA195] uppercase tracking-wider font-semibold">Operational Mode</div>
              <div className="font-semibold text-[#FF5F40] mt-1 text-xs truncate">{report.mode}</div>
            </div>
            <div className="bg-[#262824] p-3 rounded border border-[#33362F]">
              <div className="text-[10px] text-[#9CA195] uppercase tracking-wider font-semibold">Total Raw Frames</div>
              <div className="font-semibold text-[#F0FFEA] mt-1 text-xs font-mono">{report.total_log_entries} frames</div>
            </div>
            <div className="bg-[#262824] p-3 rounded border border-[#33362F]">
              <div className="text-[10px] text-[#9CA195] uppercase tracking-wider font-semibold">Verification Result</div>
              <div
                className={`font-semibold mt-1 text-xs flex items-center gap-1.5 ${
                  report.status === 'PASS' ? 'text-[#FF5F40]' : 'text-[#F0FFEA]'
                }`}
              >
                {report.status === 'PASS' ? <CheckCircle2 className="w-3.5 h-3.5 text-[#FF5F40]" /> : <XCircle className="w-3.5 h-3.5 text-[#9CA195]" />}
                {report.status}
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-[#33362F] gap-1.5 bg-[#1B1D1A] p-1.5 rounded-lg overflow-x-auto">
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
                  className={`flex items-center gap-2 px-4 py-2 rounded font-mono transition text-xs cursor-pointer whitespace-nowrap border ${
                    isActive
                      ? 'bg-[#FF5F40] text-[#0A0A0A] font-semibold border-[#FF5F40]'
                      : 'bg-[#262824] border-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] hover:border-[#FF5F40]'
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
                <div className="bg-[#1B1D1A] border border-[#33362F] p-4 rounded-lg">
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] text-[#9CA195] uppercase tracking-wider font-semibold">
                      Average Tracking Error
                    </span>
                    <Target className="w-4 h-4 text-[#FF5F40]" />
                  </div>
                  <div className="text-2xl font-bold font-mono text-[#F0FFEA] mt-2">
                    {m.average_tracking_error_px != null ? `${m.average_tracking_error_px.toFixed(2)} px` : '--'}
                  </div>
                  <div className="text-xs text-[#9CA195] mt-2 flex justify-between border-t border-[#33362F] pt-2 font-mono">
                    <span>Max: {m.max_tracking_error_px != null ? `${m.max_tracking_error_px.toFixed(2)} px` : '--'}</span>
                    <span className="text-[#FF5F40] font-semibold">RMSE: {m.rmse_px != null ? `${m.rmse_px.toFixed(2)} px` : '--'}</span>
                  </div>
                  <div className="text-[10px] text-[#5E625A] mt-1">Official Threshold: ≤ 10.0 pixels</div>
                </div>

                {/* Lock Retention */}
                <div className="bg-[#1B1D1A] border border-[#33362F] p-4 rounded-lg">
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] text-[#9CA195] uppercase tracking-wider font-semibold">
                      Lock Retention Rate
                    </span>
                    <ShieldCheck className="w-4 h-4 text-[#FF5F40]" />
                  </div>
                  <div className="text-2xl font-bold font-mono text-[#FF5F40] mt-2">
                    {m.lock_retention_percent.toFixed(1)} %
                  </div>
                  <div className="text-xs text-[#9CA195] mt-2 flex justify-between border-t border-[#33362F] pt-2 font-mono">
                    <span>Target Loss: {m.target_loss_percent.toFixed(1)}%</span>
                    <span className="text-[#F0FFEA]">Continuous PAT</span>
                  </div>
                  <div className="text-[10px] text-[#5E625A] mt-1">Target Loss Spec: &lt; 5.0 %</div>
                </div>

                {/* Acquisition Timing */}
                <div className="bg-[#1B1D1A] border border-[#33362F] p-4 rounded-lg">
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] text-[#9CA195] uppercase tracking-wider font-semibold">
                      Acquisition Time
                    </span>
                    <Clock className="w-4 h-4 text-[#FF5F40]" />
                  </div>
                  <div className="text-2xl font-bold font-mono text-[#F0FFEA] mt-2">
                    {m.acquisition_time_s != null ? `${m.acquisition_time_s.toFixed(2)} s` : 'Searching'}
                  </div>
                  <div className="text-xs text-[#9CA195] mt-2 flex justify-between border-t border-[#33362F] pt-2 font-mono">
                    <span>Re-acq: {m.reacquisition_time_s != null ? `${m.reacquisition_time_s.toFixed(2)} s` : '0.00 s'}</span>
                    <span className="text-[#FF5F40] font-semibold">Req: ≤ 2.0s</span>
                  </div>
                  <div className="text-[10px] text-[#5E625A] mt-1">Re-acquisition Spec: ≤ 1.0 s</div>
                </div>

                {/* Processing Speed */}
                <div className="bg-[#1B1D1A] border border-[#33362F] p-4 rounded-lg">
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] text-[#9CA195] uppercase tracking-wider font-semibold">
                      Processing Throughput
                    </span>
                    <Zap className="w-4 h-4 text-[#FF5F40]" />
                  </div>
                  <div className="text-2xl font-bold font-mono text-[#FF5F40] mt-2">
                    {m.average_fps.toFixed(1)} FPS
                  </div>
                  <div className="text-xs text-[#9CA195] mt-2 flex justify-between border-t border-[#33362F] pt-2 font-mono">
                    <span>Min/Max: {m.min_fps.toFixed(0)} / {m.max_fps.toFixed(0)}</span>
                    <span className="text-[#F0FFEA]">Latency: {m.average_processing_time_ms.toFixed(1)}ms</span>
                  </div>
                  <div className="text-[10px] text-[#5E625A] mt-1">Official Threshold: ≥ 20.0 FPS</div>
                </div>
              </div>

              {/* Extended Metrics Table */}
              <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-5">
                <h3 className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider mb-3.5 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#FF5F40]" />
                  Comprehensive Experimental Telemetry Summary
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 text-xs">
                  <div className="p-3.5 bg-[#262824] rounded border border-[#33362F]">
                    <div className="text-[#9CA195] text-[10px] uppercase font-semibold">Simulation Duration</div>
                    <div className="text-base font-bold font-mono text-[#F0FFEA] mt-1">{m.simulation_duration_s.toFixed(2)} s</div>
                    <div className="text-[10px] text-[#5E625A] mt-0.5">Elapsed Virtual Time</div>
                  </div>
                  <div className="p-3.5 bg-[#262824] rounded border border-[#33362F]">
                    <div className="text-[#9CA195] text-[10px] uppercase font-semibold">Beacon Detection Rate</div>
                    <div className="text-base font-bold font-mono text-[#FF5F40] mt-1">{m.detection_rate_percent.toFixed(1)} %</div>
                    <div className="text-[10px] text-[#5E625A] mt-0.5">Sensor Hits / Total Frames</div>
                  </div>
                  <div className="p-3.5 bg-[#262824] rounded border border-[#33362F]">
                    <div className="text-[#9CA195] text-[10px] uppercase font-semibold">Mean Detection Confidence</div>
                    <div className="text-base font-bold font-mono text-[#F0FFEA] mt-1">{(m.average_confidence * 100).toFixed(1)} %</div>
                    <div className="text-[10px] text-[#5E625A] mt-0.5">Clutter Discrimination Index</div>
                  </div>
                  <div className="p-3.5 bg-[#262824] rounded border border-[#33362F]">
                    <div className="text-[#9CA195] text-[10px] uppercase font-semibold">Mean Optical SNR</div>
                    <div className="text-base font-bold font-mono text-[#FF5F40] mt-1">
                      {m.average_snr_db != null ? `${m.average_snr_db.toFixed(1)} dB` : '--'}
                    </div>
                    <div className="text-[10px] text-[#5E625A] mt-0.5">Radiant Beacon Signal-to-Noise</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab: Requirements Verification Checklist */}
          {activeTab === 'requirements' && (
            <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#33362F] pb-3.5">
                <div>
                  <h3 className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#FF5F40]" />
                    Mandatory Specification Verification
                  </h3>
                  <p className="text-xs text-[#9CA195] mt-0.5">
                    Rigorous verification of coarse alignment requirements against sensor measurements
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded border border-[#33362F]">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[#262824] border-b border-[#33362F] text-[11px] font-semibold text-[#9CA195] uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-3.5">Mandatory Parameter</th>
                      <th className="py-3 px-3 text-right">Official Requirement</th>
                      <th className="py-3 px-3 text-right">Actual Measured</th>
                      <th className="py-3 px-3 text-right">Compliance Margin</th>
                      <th className="py-3 px-3.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#33362F] text-[#F0FFEA]">
                    {report.requirements.map((req, idx) => {
                      const isPass = req.status === 'PASS';
                      return (
                        <tr key={idx} className="hover:bg-[#262824] transition">
                          <td className="py-3 px-3.5 font-medium text-[#F0FFEA] flex items-center gap-2">
                            {isPass ? (
                              <CheckCircle2 className="w-4 h-4 text-[#FF5F40] shrink-0" />
                            ) : (
                              <XCircle className="w-4 h-4 text-[#9CA195] shrink-0" />
                            )}
                            {req.parameter}
                          </td>
                          <td className="py-3 px-3 text-right text-[#9CA195] font-mono">{req.required}</td>
                          <td className="py-3 px-3 text-right font-semibold text-[#F0FFEA] font-mono">{req.actual}</td>
                          <td className="py-3 px-3 text-right text-[#9CA195] font-mono">
                            {req.margin != null ? `${req.margin > 0 ? '+' : ''}${req.margin} ${req.unit}` : '--'}
                          </td>
                          <td className="py-3 px-3.5 text-center">
                            <span
                              className={`px-2.5 py-0.5 rounded text-[10px] font-semibold border inline-block ${
                                isPass
                                  ? 'bg-[#FF5F40]/15 text-[#FF5F40] border-[#FF5F40]'
                                  : 'bg-[#262824] text-[#F0FFEA] border-[#33362F]'
                              }`}
                            >
                              {req.status === 'PASS' ? '✓ PASS' : '✕ FAIL'}
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
              <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider">Tracking Error (pixels) vs Frame</span>
                  <span className="text-[11px] font-mono text-[#FF5F40]">Spec: ≤ 10 px</span>
                </div>
                <div className="h-44 bg-[#000000] rounded border border-[#33362F] p-2.5 flex items-end gap-1 overflow-x-auto">
                  {report.raw_log_sample.map((pt, i) => {
                    const err = pt.total_error_px || 0;
                    const heightPct = Math.min(100, (err / 30.0) * 100);
                    const color = err <= 10.0 ? '#F0FFEA' : '#FF5F40';
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
                <div className="flex justify-between text-[11px] font-mono text-[#9CA195] mt-2">
                  <span>Frame 1</span>
                  <span>Frame {report.raw_log_sample.length}</span>
                </div>
              </div>

              {/* Processing FPS & Throughput */}
              <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider">Throughput (FPS) vs Frame</span>
                  <span className="text-[11px] font-mono text-[#FF5F40]">Spec: ≥ 20 FPS</span>
                </div>
                <div className="h-44 bg-[#000000] rounded border border-[#33362F] p-2.5 flex items-end gap-1 overflow-x-auto">
                  {report.raw_log_sample.map((pt, i) => {
                    const fps = pt.fps || 30.0;
                    const heightPct = Math.min(100, (fps / 45.0) * 100);
                    const color = fps >= 20.0 ? '#FF5F40' : '#5E625A';
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
                <div className="flex justify-between text-[11px] font-mono text-[#9CA195] mt-2">
                  <span>Frame 1</span>
                  <span>Frame {report.raw_log_sample.length}</span>
                </div>
              </div>

              {/* Gimbal Pan & Tilt Actuation */}
              <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider">Gimbal Orientation (Pan ° / Tilt °)</span>
                  <span className="text-[11px] font-mono text-[#9CA195]">Max Slew 5°/s</span>
                </div>
                <div className="h-44 bg-[#000000] rounded border border-[#33362F] p-2.5 flex items-center gap-1 overflow-x-auto relative">
                  <div className="absolute inset-x-0 h-[1px] bg-[#33362F]" />
                  {report.raw_log_sample.map((pt, i) => {
                    const panH = Math.min(45, Math.abs(pt.pan_deg) * 3);
                    return (
                      <div
                        key={i}
                        className="flex-1 min-w-[4px] bg-[#FF5F40] rounded"
                        style={{ height: `${Math.max(4, panH)}%` }}
                        title={`Frame ${pt.frame_number}: Pan ${pt.pan_deg.toFixed(2)}°, Tilt ${pt.tilt_deg.toFixed(2)}°`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[11px] font-mono text-[#9CA195] mt-2">
                  <span>Frame 1</span>
                  <span>Frame {report.raw_log_sample.length}</span>
                </div>
              </div>

              {/* Confidence & SNR Quality */}
              <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider">Detection Confidence (%) vs Frame</span>
                  <span className="text-[11px] font-mono text-[#FF5F40]">Target Disambiguation</span>
                </div>
                <div className="h-44 bg-[#000000] rounded border border-[#33362F] p-2.5 flex items-end gap-1 overflow-x-auto">
                  {report.raw_log_sample.map((pt, i) => {
                    const conf = (pt.confidence || 0) * 100;
                    return (
                      <div
                        key={i}
                        className="flex-1 min-w-[4px] bg-[#FF5F40] rounded-t opacity-90"
                        style={{ height: `${Math.max(4, conf)}%` }}
                        title={`Frame ${pt.frame_number}: Confidence ${conf.toFixed(1)}%`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[11px] font-mono text-[#9CA195] mt-2">
                  <span>Frame 1</span>
                  <span>Frame {report.raw_log_sample.length}</span>
                </div>
              </div>
            </div>
          )}

          {/* Tab: Subsystem Configuration */}
          {activeTab === 'config' && (
            <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-5 space-y-4">
              <h3 className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#FF5F40]" />
                Subsystem Architecture & Hardware Configuration Record
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                {Object.entries(report.configuration || {}).map(([category, details]) => (
                  <div key={category} className="bg-[#262824] p-4 rounded border border-[#33362F]">
                    <div className="text-[#FF5F40] font-semibold uppercase tracking-wider text-xs border-b border-[#33362F] pb-2 mb-3">
                      {category.toUpperCase()} CONFIGURATION
                    </div>
                    <div className="space-y-2 font-mono text-xs">
                      {typeof details === 'object' && details !== null ? (
                        Object.entries(details).map(([k, v]) => (
                          <div key={k} className="flex justify-between text-[#F0FFEA] py-1 border-b border-[#33362F]/40 last:border-b-0">
                            <span className="text-[#9CA195]">{k}:</span>
                            <span className="text-[#F0FFEA] font-medium">{String(v)}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-[#F0FFEA]">{String(details)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab: Raw Performance Log */}
          {activeTab === 'raw_log' && (
            <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider flex items-center gap-2">
                    <Layers className="w-4 h-4 text-[#FF5F40]" />
                    Frame-by-Frame Raw Performance Telemetry Log
                  </h3>
                  <p className="text-xs text-[#9CA195] mt-0.5">
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
                    className="bg-[#262824] border border-[#33362F] focus:border-[#FF5F40] text-[#F0FFEA] px-3 py-1.5 rounded text-xs outline-none transition font-mono placeholder:text-[#5E625A]"
                  />
                  <span className="text-xs text-[#9CA195] font-mono">
                    Showing {paginatedLogs.length} of {filteredRawLogs.length}
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[500px] rounded border border-[#33362F]">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="sticky top-0 bg-[#262824] border-b border-[#33362F] z-10 text-[11px] text-[#9CA195] uppercase font-semibold">
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
                  <tbody className="divide-y divide-[#33362F] text-[#F0FFEA]">
                    {paginatedLogs.map((log) => (
                      <tr key={log.frame_number} className="hover:bg-[#262824] transition">
                        <td className="py-2 px-3 text-[#9CA195] font-medium">#{log.frame_number}</td>
                        <td className="py-2 px-3 text-[#9CA195]">{log.timestamp_s.toFixed(3)}</td>
                        <td className="py-2 px-3 text-[#F0FFEA]">
                          {log.centroid_x != null ? `(${log.centroid_x.toFixed(1)}, ${log.centroid_y?.toFixed(1)})` : '--'}
                        </td>
                        <td className="py-2 px-3 text-[#9CA195]">
                          {log.reference_x != null ? `(${log.reference_x.toFixed(1)}, ${log.reference_y?.toFixed(1)})` : '--'}
                        </td>
                        <td className="py-2 px-3 text-[#9CA195]">
                          {log.error_x_px != null ? `${log.error_x_px > 0 ? '+' : ''}${log.error_x_px} / ${log.error_y_px}` : '--'}
                        </td>
                        <td className="py-2 px-3 font-semibold">
                          {log.total_error_px != null ? (
                            <span className={log.total_error_px <= 10.0 ? 'text-[#F0FFEA]' : 'text-[#FF5F40]'}>
                              {log.total_error_px.toFixed(2)} px
                            </span>
                          ) : (
                            '--'
                          )}
                        </td>
                        <td className="py-2 px-3 text-[#FF5F40]">{(log.confidence * 100).toFixed(0)}%</td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              log.tracking_state === 'LOCKED'
                                ? 'bg-[#FF5F40]/15 text-[#FF5F40] border border-[#FF5F40]'
                                : log.tracking_state === 'TRACKING'
                                ? 'bg-[#262824] text-[#F0FFEA] border border-[#33362F]'
                                : 'bg-[#262824] text-[#9CA195] border border-[#33362F]'
                            }`}
                          >
                            {log.tracking_state}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-[#9CA195]">
                          {log.pan_deg.toFixed(1)}° / {log.tilt_deg.toFixed(1)}°
                        </td>
                        <td className="py-2 px-3 text-[#F0FFEA]">{log.fps.toFixed(1)}</td>
                        <td className="py-2 px-3 text-right text-[#9CA195]">{log.processing_time_ms.toFixed(1)} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-[#33362F] pt-3.5 text-xs text-[#9CA195] font-mono">
                  <button
                    onClick={() => setRawLogPage((p) => Math.max(1, p - 1))}
                    disabled={rawLogPage === 1}
                    className="px-3 py-1.5 bg-[#262824] hover:bg-[#33362F] border border-[#33362F] hover:border-[#FF5F40] text-[#F0FFEA] rounded disabled:opacity-40 transition cursor-pointer"
                  >
                    PREVIOUS
                  </button>
                  <span className="font-mono">
                    Page {rawLogPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setRawLogPage((p) => Math.min(totalPages, p + 1))}
                    disabled={rawLogPage === totalPages}
                    className="px-3 py-1.5 bg-[#262824] hover:bg-[#33362F] border border-[#33362F] hover:border-[#FF5F40] text-[#F0FFEA] rounded disabled:opacity-40 transition cursor-pointer"
                  >
                    NEXT
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
