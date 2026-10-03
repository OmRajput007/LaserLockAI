import React, { useState, useEffect } from 'react';
import {
  Cpu,
  Target,
  Sparkles,
  Layers,
  Activity,
  Zap,
  RefreshCw,
  CheckCircle,
  GitCompare,
  Box,
  Crosshair,
  ShieldCheck,
  ShieldAlert,
  Flame,
} from 'lucide-react';
import { SystemConfig, SimulationTelemetry, DetectionComparisonResponse } from '../types';

interface Props {
  config: SystemConfig | null;
  telemetry?: SimulationTelemetry | null;
  onUpdateConfig: (updater: (prev: SystemConfig) => SystemConfig) => void;
}

export const DetectionAIPage: React.FC<Props> = ({ config, telemetry, onUpdateConfig }) => {
  const det = telemetry?.detection;
  const isDetected = det?.beacon_detected ?? false;

  // Active Detection Method
  const activeMethod = det?.active_method || config?.detection.method || 'Classical CV';
  const isKalmanActive = det?.kalman_active ?? (activeMethod.includes('Kalman'));

  // Intermediate pipeline stages inspection state
  const [intermediateStages, setIntermediateStages] = useState<Record<string, string> | null>(null);
  const [loadingStages, setLoadingStages] = useState(false);
  const [autoRefreshStages, setAutoRefreshStages] = useState(false);

  // Side-by-side comparison state
  const [comparisonData, setComparisonData] = useState<DetectionComparisonResponse | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);

  const fetchIntermediates = async () => {
    try {
      setLoadingStages(true);
      const res = await fetch('http://127.0.0.1:8000/api/simulation/detection/intermediates');
      if (res.ok) {
        const data = await res.json();
        if (data.stages) {
          setIntermediateStages(data.stages);
        }
      }
    } catch (err) {
      console.error('Failed to fetch intermediates', err);
    } finally {
      setLoadingStages(false);
    }
  };

  const fetchComparison = async () => {
    try {
      setLoadingComparison(true);
      const res = await fetch('http://127.0.0.1:8000/api/simulation/detection/comparison');
      if (res.ok) {
        const data = await res.json();
        setComparisonData(data);
      }
    } catch (err) {
      console.error('Failed to fetch comparison', err);
    } finally {
      setLoadingComparison(false);
    }
  };

  const handleSelectMethod = async (method: 'Classical CV' | 'AI Detector' | 'CV + Kalman' | 'AI + Kalman') => {
    try {
      await fetch('http://127.0.0.1:8000/api/simulation/detection/method', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method }),
      });
      onUpdateConfig((prev) => ({
        ...prev,
        detection: { ...prev.detection, method },
      }));
    } catch (err) {
      console.error('Failed to set detection method', err);
    }
  };

  const handleToggleClutter = async (inject: boolean, count?: number) => {
    const currentCount = count ?? config?.detection.false_bright_object_count ?? 2;
    try {
      await fetch('http://127.0.0.1:8000/api/simulation/detection/clutter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inject, count: currentCount }),
      });
      onUpdateConfig((prev) => ({
        ...prev,
        detection: {
          ...prev.detection,
          inject_false_bright_objects: inject,
          false_bright_object_count: currentCount,
        },
      }));
    } catch (err) {
      console.error('Failed to toggle clutter injection', err);
    }
  };

  useEffect(() => {
    fetchIntermediates();
    fetchComparison();
  }, []);

  useEffect(() => {
    if (!autoRefreshStages) return;
    const interval = setInterval(() => {
      fetchIntermediates();
    }, 1000);
    return () => clearInterval(interval);
  }, [autoRefreshStages]);

  return (
    <div className="flex flex-col gap-4 font-mono text-xs text-[#F0FFEA]">
      {/* Top Header */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-4 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-[#262824] border border-[#33362F] flex items-center justify-center">
            <Cpu className="w-5 h-5 text-[#FF5F40]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#F0FFEA]">
              Optical Beacon Detection & Target Identification
            </h2>
            <p className="text-[#9CA195] text-[11px]">
              Multi-Method Detection Architecture: Classical CV, AI Detector (ONNX), and Kalman Kinematic Filtering
            </p>
          </div>
        </div>

        {/* Live Operational Badges */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Active Method Badge */}
          <div className="px-2.5 py-1 rounded bg-[#262824] border border-[#33362F] text-[#F0FFEA] font-bold text-xs flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-[#FF5F40]" />
            Method: {activeMethod}
          </div>

          {/* Beacon Acquired Badge */}
          <div
            className={`px-3 py-1 rounded border font-bold text-xs flex items-center gap-2 ${
              isDetected
                ? 'bg-[#FF5F40]/15 border-[#FF5F40]/40 text-[#FF5F40]'
                : 'bg-[#262824] border-[#33362F] text-[#9CA195]'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isDetected ? 'bg-[#FF5F40]' : 'bg-[#5E625A]'}`} />
            {isDetected ? '✓ Beacon Acquired' : '● Acquiring / No Beacon'}
          </div>

          {/* Target Classification Badge */}
          {det?.target_classification && (
            <div
              className={`px-2.5 py-1 rounded border text-xs font-bold flex items-center gap-1.5 ${
                det.target_classification.includes('Primary')
                  ? 'bg-[#FF5F40]/15 border-[#FF5F40]/40 text-[#FF5F40]'
                  : 'bg-[#262824] border-[#33362F] text-[#9CA195]'
              }`}
            >
              <Target className="w-3.5 h-3.5 text-[#FF5F40]" />
              {det.target_classification}
            </div>
          )}
        </div>
      </div>

      {/* 4 Detection Methods Operational Selector */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-3.5 rounded-lg flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[#F0FFEA] font-semibold text-xs flex items-center gap-2 uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5 text-[#FF5F40]" />
            Detection Architecture
          </span>
          <span className="text-[11px] text-[#9CA195]">
            Pipeline Interface: <code className="text-[#FF5F40] bg-[#262824] px-1.5 py-0.5 rounded border border-[#33362F]">detect(frame) &rarr; detections</code>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[
            {
              id: 'Classical CV',
              title: 'Classical CV',
              desc: 'OpenCV Moments Centroid (Cx=M10/M00, Cy=M01/M00)',
              tag: 'Baseline CV',
            },
            {
              id: 'AI Detector',
              title: 'AI Detector',
              desc: 'YOLO/ONNX-Ready (Honest Fallback to CV if no weights)',
              tag: 'AI-Ready',
            },
            {
              id: 'CV + Kalman',
              title: 'CV + Kalman',
              desc: 'OpenCV Centroid + 4-State Kinematic Filter [x,y,vx,vy]',
              tag: 'Filtered CV',
            },
            {
              id: 'AI + Kalman',
              title: 'AI + Kalman',
              desc: 'AI Architecture + 4-State Kalman Kinematic Filter',
              tag: 'Optimal PAT',
            },
          ].map((m) => {
            const isSelected = activeMethod === m.id;
            return (
              <button
                key={m.id}
                onClick={() => handleSelectMethod(m.id as any)}
                className={`p-3 rounded border text-left transition flex flex-col justify-between font-mono ${
                  isSelected
                    ? 'bg-[#FF5F40] border-[#FF5F40] text-[#0A0A0A] shadow'
                    : 'bg-[#262824] border-[#33362F] hover:border-[#FF5F40]/50 text-[#F0FFEA]'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-xs flex items-center gap-1.5 uppercase">
                    {isSelected ? <CheckCircle className="w-3.5 h-3.5 text-[#0A0A0A]" /> : <div className="w-3.5 h-3.5 rounded-full border border-[#5E625A]" />}
                    {m.title}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      isSelected
                        ? 'bg-[#0A0A0A] text-[#FF5F40]'
                        : 'bg-[#1B1D1A] text-[#9CA195] border border-[#33362F]'
                    }`}
                  >
                    {m.tag}
                  </span>
                </div>
                <p className={`text-[11px] leading-snug ${isSelected ? 'text-[#0A0A0A]/80 font-medium' : 'text-[#9CA195]'}`}>{m.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Real-time Detection Telemetry Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Detected Centroid */}
        <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex flex-col justify-between">
          <span className="text-[#9CA195] text-[11px]">Detected Centroid</span>
          <div className="text-[#F0FFEA] font-bold text-sm mt-1 font-mono">
            {isDetected && det?.detected_centroid_x !== null && det?.detected_centroid_x !== undefined ? (
              <span className="text-[#FF5F40]">
                ({det.detected_centroid_x.toFixed(1)}, {det.detected_centroid_y?.toFixed(1)})
              </span>
            ) : (
              <span className="text-[#5E625A]">None</span>
            )}
          </div>
          <span className="text-[10px] text-[#9CA195] mt-0.5">FPA Sensor (640×480)</span>
        </div>

        {/* Kalman State Filter */}
        <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[#9CA195] text-[11px]">Kalman Filter</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                isKalmanActive ? 'bg-[#FF5F40]/15 text-[#FF5F40] border border-[#FF5F40]/40' : 'bg-[#262824] text-[#5E625A]'
              }`}
            >
              {isKalmanActive ? 'Active' : 'Off'}
            </span>
          </div>
          <div className="text-[#F0FFEA] font-medium text-xs mt-1 font-mono">
            {isKalmanActive && det?.kalman_velocity_x !== null && det?.kalman_velocity_x !== undefined ? (
              <span className="text-[#FF5F40]">
                Vel: ({det.kalman_velocity_x.toFixed(1)}, {det.kalman_velocity_y?.toFixed(1)}) px/s
              </span>
            ) : isKalmanActive ? (
              <span className="text-[#FF5F40]">Tracking...</span>
            ) : (
              <span className="text-[#5E625A]">Not enabled</span>
            )}
          </div>
          <span className="text-[10px] text-[#9CA195] mt-0.5 font-mono">
            {isKalmanActive && det?.kalman_predicted_x !== null && det?.kalman_predicted_x !== undefined
              ? `Pred: (${det.kalman_predicted_x.toFixed(1)}, ${det.kalman_predicted_y?.toFixed(1)})`
              : 'Switch to Method 3 or 4'}
          </span>
        </div>

        {/* Pixel Error */}
        <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex flex-col justify-between">
          <span className="text-[#9CA195] text-[11px]">Pixel Error (Ex, Ey)</span>
          <div className="text-[#F0FFEA] font-bold text-sm mt-1 font-mono">
            {isDetected && det?.pixel_error_x !== null && det?.pixel_error_x !== undefined ? (
              <span className="text-[#FF5F40]">
                {det.pixel_error_x > 0 ? `+${det.pixel_error_x.toFixed(1)}` : det.pixel_error_x.toFixed(1)},{' '}
                {det.pixel_error_y && det.pixel_error_y > 0 ? `+${det.pixel_error_y.toFixed(1)}` : det.pixel_error_y?.toFixed(1)}
              </span>
            ) : (
              <span className="text-[#5E625A]">--</span>
            )}
          </div>
          <span className="text-[10px] text-[#9CA195] mt-0.5">Offset from boresight</span>
        </div>

        {/* Total Euclidean Error */}
        <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex flex-col justify-between">
          <span className="text-[#9CA195] text-[11px]">Total Pixel Error</span>
          <div className="text-[#F0FFEA] font-bold text-sm mt-1 font-mono">
            {isDetected && det?.total_pixel_error !== null && det?.total_pixel_error !== undefined ? (
              <span className={det.total_pixel_error <= 10.0 ? 'text-[#FF5F40] font-bold' : 'text-[#F0FFEA] font-bold'}>
                {det.total_pixel_error.toFixed(2)} px
              </span>
            ) : (
              <span className="text-[#5E625A]">--</span>
            )}
          </div>
          <span className="text-[10px] text-[#9CA195] mt-0.5">
            {isDetected && det?.total_pixel_error !== null && det?.total_pixel_error !== undefined && det.total_pixel_error <= 10.0
              ? '≤10 px [Pass]'
              : 'Target budget: ≤10 px'}
          </span>
        </div>

        {/* Confidence & SNR */}
        <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex flex-col justify-between">
          <span className="text-[#9CA195] text-[11px]">Confidence & SNR</span>
          <div className="text-[#F0FFEA] font-bold text-sm mt-1 font-mono">
            {isDetected && det ? (
              <span className="text-[#FF5F40]">
                {(det.confidence * 100).toFixed(0)}% <span className="text-[#9CA195] text-xs">| {det.snr_db?.toFixed(1)} dB</span>
              </span>
            ) : (
              <span className="text-[#5E625A]">0%</span>
            )}
          </div>
          <span className="text-[10px] text-[#9CA195] mt-0.5 font-mono">Peak: {det?.brightness?.toFixed(0) ?? '--'}</span>
        </div>

        {/* Execution Latency & Clutter Count */}
        <div className="bg-[#1B1D1A] border border-[#33362F] p-3 rounded-lg flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[#9CA195] text-[11px]">Latency</span>
            <span className="text-[#FF5F40] font-bold text-xs font-mono">{det?.processing_time_ms.toFixed(1) ?? '0.0'} ms</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-[#9CA195]">Rejected Clutter:</span>
            <span className="text-[#F0FFEA] font-bold font-mono">{det?.rejected_clutter_count ?? 0}</span>
          </div>
          <span className="text-[10px] text-[#9CA195] mt-0.5">
            Budget: ≤50 ms (≥20 Hz)
          </span>
        </div>
      </div>

      {/* Main Grid: Visual Pipeline & Diagnostics (2 cols) vs AI & Target ID Controls (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column: Visual Pipeline Inspector & Candidates / Side-by-Side Comparison */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* OpenCV 8-Stage Image Pipeline Visualizer */}
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-[#33362F] pb-3">
              <h3 className="text-[#F0FFEA] font-semibold text-xs uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#FF5F40]" />
                Image Pipeline Visualizer
              </h3>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[#9CA195] text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoRefreshStages}
                    onChange={(e) => setAutoRefreshStages(e.target.checked)}
                    className="accent-[#FF5F40] rounded"
                  />
                  Live 1Hz Poll
                </label>
                <button
                  onClick={fetchIntermediates}
                  disabled={loadingStages}
                  className="px-2.5 py-1 bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] rounded border border-[#33362F] flex items-center gap-1.5 transition text-xs font-medium"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingStages ? 'animate-spin text-[#FF5F40]' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>

            {/* 4 Intermediate Stages Visual Matrix */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { id: 'grayscale', name: 'Grayscale', desc: 'Raw 640×480 mono sensor' },
                {
                  id: 'preprocessed',
                  name: 'Gaussian Blur',
                  desc: `Kernel: ${config?.detection.gaussian_blur_kernel ?? 3}×${config?.detection.gaussian_blur_kernel ?? 3}`,
                },
                {
                  id: 'threshold',
                  name: 'Thresholding',
                  desc: config?.detection.use_otsu
                    ? 'Otsu Binarization'
                    : `Fixed Val: ${config?.detection.intensity_threshold ?? 120}`,
                },
                {
                  id: 'morphed',
                  name: 'Morphology',
                  desc: `Open+Close (${config?.detection.morph_kernel_size ?? 3}px)`,
                },
              ].map((st) => (
                <div key={st.id} className="bg-[#262824] border border-[#33362F] rounded p-2.5 flex flex-col gap-1.5">
                  <span className="font-bold text-[#F0FFEA] text-xs">{st.name}</span>
                  <span className="text-[11px] text-[#9CA195]">{st.desc}</span>
                  <div className="relative aspect-[4/3] bg-[#000000] rounded border border-[#33362F] overflow-hidden flex items-center justify-center">
                    {intermediateStages && intermediateStages[st.id] ? (
                      <img src={intermediateStages[st.id]} alt={st.name} className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-[#5E625A] text-[11px]">Processing...</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Side-by-Side Detection Comparison Card (Classical CV vs AI Detector) */}
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-[#33362F] pb-3">
              <h3 className="text-[#F0FFEA] font-semibold text-xs uppercase tracking-wider flex items-center gap-2">
                <GitCompare className="w-4 h-4 text-[#FF5F40]" />
                Detector Comparison: Classical CV vs. AI Detector
              </h3>
              <button
                onClick={fetchComparison}
                disabled={loadingComparison}
                className="px-2.5 py-1 bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] rounded border border-[#33362F] flex items-center gap-1.5 transition text-xs font-medium"
              >
                <RefreshCw className={`w-3 h-3 ${loadingComparison ? 'animate-spin text-[#FF5F40]' : ''}`} />
                Run Benchmark
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Classical CV Column */}
              <div className="bg-[#262824] border border-[#33362F] rounded p-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between border-b border-[#33362F] pb-2">
                  <span className="text-[#F0FFEA] font-bold flex items-center gap-1.5 text-xs">
                    <Box className="w-3.5 h-3.5 text-[#FF5F40]" />
                    Classical CV Detector
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#1B1D1A] text-[#FF5F40] border border-[#33362F] font-bold">
                    OpenCV Moments
                  </span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[#9CA195]">Detection Status:</span>
                    <span className={comparisonData?.classical_cv.detected ? 'text-[#FF5F40] font-bold' : 'text-[#5E625A]'}>
                      {comparisonData?.classical_cv.detected ? '✓ Detected' : '● Not Detected'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#9CA195]">Centroid (Cx, Cy):</span>
                    <span className="text-[#F0FFEA] font-mono">
                      {comparisonData?.classical_cv.centroid
                        ? `(${comparisonData.classical_cv.centroid[0].toFixed(1)}, ${comparisonData.classical_cv.centroid[1].toFixed(1)})`
                        : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#9CA195]">Bounding Box:</span>
                    <span className="text-[#9CA195] font-mono text-[11px]">
                      {comparisonData?.classical_cv.bbox ? `[${comparisonData.classical_cv.bbox.join(', ')}]` : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#9CA195]">Confidence:</span>
                    <span className="text-[#FF5F40] font-bold font-mono">
                      {comparisonData?.classical_cv.confidence ? `${(comparisonData.classical_cv.confidence * 100).toFixed(0)}%` : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#9CA195]">Execution Latency:</span>
                    <span className="text-[#FF5F40] font-bold font-mono">
                      {comparisonData?.classical_cv.latency_ms.toFixed(2)} ms
                    </span>
                  </div>
                  <div className="pt-2 border-t border-[#33362F] text-[11px] text-[#9CA195]">
                    {comparisonData?.classical_cv.status ?? 'High precision centroid calculation via image moments.'}
                  </div>
                </div>
              </div>

              {/* AI Detector Column */}
              <div className="bg-[#262824] border border-[#33362F] rounded p-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between border-b border-[#33362F] pb-2">
                  <span className="text-[#F0FFEA] font-bold flex items-center gap-1.5 text-xs">
                    <Cpu className="w-3.5 h-3.5 text-[#FF5F40]" />
                    AI Detector (YOLO/ONNX)
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#1B1D1A] text-[#9CA195] border border-[#33362F] font-bold">
                    {comparisonData?.ai_detector.status.includes('Fallback') ? 'Fallback Mode' : 'Inference Active'}
                  </span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[#9CA195]">Detection Status:</span>
                    <span className={comparisonData?.ai_detector.detected ? 'text-[#FF5F40] font-bold' : 'text-[#5E625A]'}>
                      {comparisonData?.ai_detector.detected ? '✓ Detected' : '● Not Detected'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#9CA195]">Centroid (Cx, Cy):</span>
                    <span className="text-[#F0FFEA] font-mono">
                      {comparisonData?.ai_detector.centroid
                        ? `(${comparisonData.ai_detector.centroid[0].toFixed(1)}, ${comparisonData.ai_detector.centroid[1].toFixed(1)})`
                        : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#9CA195]">Bounding Box:</span>
                    <span className="text-[#9CA195] font-mono text-[11px]">
                      {comparisonData?.ai_detector.bbox ? `[${comparisonData.ai_detector.bbox.join(', ')}]` : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#9CA195]">Confidence:</span>
                    <span className="text-[#FF5F40] font-bold font-mono">
                      {comparisonData?.ai_detector.confidence ? `${(comparisonData.ai_detector.confidence * 100).toFixed(0)}%` : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#9CA195]">Execution Latency:</span>
                    <span className="text-[#FF5F40] font-bold font-mono">
                      {comparisonData?.ai_detector.latency_ms.toFixed(2)} ms
                    </span>
                  </div>
                  <div className="pt-2 border-t border-[#33362F] text-[11px] text-[#9CA195]">
                    {comparisonData?.ai_detector.status ?? 'AI architecture on standby (no fabricated predictions).'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Candidates & Target Identification Disambiguation Table */}
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4">
            <div className="flex items-center justify-between mb-3 border-b border-[#33362F] pb-2">
              <span className="text-[#F0FFEA] font-semibold text-xs flex items-center gap-1.5 uppercase tracking-wider">
                <Activity className="w-3.5 h-3.5 text-[#FF5F40]" />
                Target Candidates & Clutter Disambiguation (Total: {det?.raw_candidate_count ?? det?.candidate_count ?? 0})
              </span>
              <span className="text-[#9CA195] text-[11px]">
                Engine: <span className="text-[#FF5F40] font-bold">{config?.detection.target_id_mode ?? 'Multi-Criteria'}</span>
              </span>
            </div>

            {det?.candidates && det.candidates.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#33362F] text-[#9CA195] text-[11px] uppercase tracking-wider">
                      <th className="pb-2 font-medium">Candidate</th>
                      <th className="pb-2 font-medium">Centroid (Cx, Cy)</th>
                      <th className="pb-2 font-medium">BBox [x,y,w,h]</th>
                      <th className="pb-2 font-medium">Area (px²)</th>
                      <th className="pb-2 font-medium">Brightness</th>
                      <th className="pb-2 font-medium">Track Dist</th>
                      <th className="pb-2 font-medium">Persistence</th>
                      <th className="pb-2 font-medium">Classification</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#33362F]">
                    {det.candidates.map((c) => {
                      const isPrimary = c.is_primary ?? false;
                      const isClutter = c.classification?.includes('False') || c.classification?.includes('Clutter');
                      return (
                        <tr key={c.candidate_id} className={isPrimary ? 'bg-[#FF5F40]/10 text-[#F0FFEA]' : isClutter ? 'text-[#9CA195]' : 'text-[#F0FFEA]'}>
                          <td className="py-1.5 font-bold text-[#FF5F40] font-mono">#{c.candidate_id}</td>
                          <td className="py-1.5 font-mono">({c.centroid_x.toFixed(1)}, {c.centroid_y.toFixed(1)})</td>
                          <td className="py-1.5 font-mono text-[11px] text-[#9CA195]">
                            [{c.bbox[0]}, {c.bbox[1]}, {c.bbox[2]}, {c.bbox[3]}]
                          </td>
                          <td className="py-1.5 font-mono">{c.area.toFixed(1)}</td>
                          <td className="py-1.5 font-bold font-mono">{c.brightness.toFixed(0)}</td>
                          <td className="py-1.5 text-[#9CA195] font-mono">
                            {c.spatial_distance_to_track !== null && c.spatial_distance_to_track !== undefined
                              ? `${c.spatial_distance_to_track.toFixed(1)} px`
                              : '--'}
                          </td>
                          <td className="py-1.5 font-mono">
                            {c.temporal_consistency_score !== undefined
                              ? `${(c.temporal_consistency_score * 100).toFixed(0)}%`
                              : '100%'}
                          </td>
                          <td className="py-1.5">
                            {isPrimary ? (
                              <span className="text-[#FF5F40] font-bold flex items-center gap-1">
                                <CheckCircle className="w-3 h-3 text-[#FF5F40]" /> Primary Beacon
                              </span>
                            ) : isClutter ? (
                              <span className="text-[#9CA195] font-medium flex items-center gap-1">
                                <ShieldAlert className="w-3 h-3 text-[#9CA195]" /> Rejected Clutter
                              </span>
                            ) : (
                              <span className="text-[#F0FFEA]">Secondary Candidate</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-6 text-center text-[#9CA195] text-xs">
                No bright contours detected above intensity threshold ({config?.detection.intensity_threshold ?? 120}).
              </div>
            )}
          </div>
        </div>

        {/* Right Column: AI Model Settings, Target Identification, Kalman Filter & Clutter Injection */}
        <div className="flex flex-col gap-4">
          {/* AI Model Architecture & Status Card */}
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 flex flex-col gap-3">
            <h3 className="text-[#F0FFEA] font-semibold border-b border-[#33362F] pb-2 uppercase tracking-wider flex items-center gap-2 text-xs">
              <Cpu className="w-4 h-4 text-[#FF5F40]" />
              AI Model & Inference Status
            </h3>

            {/* Truthful Operational Status Callout */}
            <div className="p-3 rounded bg-[#262824] border border-[#33362F] space-y-1">
              <div className="flex items-center gap-1.5 text-[#FF5F40] font-bold text-xs uppercase tracking-wider">
                <ShieldCheck className="w-3.5 h-3.5 text-[#FF5F40]" />
                Operational Status:
              </div>
              <p className="text-[11px] text-[#9CA195] leading-relaxed">
                {det?.ai_model_status ||
                  'AI-Ready Architecture: Model standby mode active. Operating in Classical CV fallback without fabricated predictions.'}
              </p>
            </div>

            <div className="space-y-3">
              {/* Architecture Name */}
              <div className="flex justify-between items-center text-xs">
                <span className="text-[#9CA195]">Architecture:</span>
                <span className="text-[#F0FFEA] font-bold">{config?.detection.ai_model_name ?? 'YOLOv8-Nano-LLA'}</span>
              </div>

              {/* Weights Path & Loaded Indicator */}
              <div className="flex justify-between items-center text-xs">
                <span className="text-[#9CA195]">Weights File:</span>
                <span className="text-[#9CA195] font-mono text-[11px]">{config?.detection.model_weights_path ?? 'models/yolov8_beacon.onnx'}</span>
              </div>

              <div className="flex justify-between items-center text-xs">
                <span className="text-[#9CA195]">Status:</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  det?.ai_model_loaded ? 'bg-[#FF5F40]/15 text-[#FF5F40] border border-[#FF5F40]/40' : 'bg-[#262824] text-[#9CA195] border border-[#33362F]'
                }`}>
                  {det?.ai_model_loaded ? '✓ Active ONNX Weights' : 'Fallback Standby (No Weights)'}
                </span>
              </div>

              {/* Execution Device */}
              <div>
                <div className="flex justify-between mb-1.5 text-xs">
                  <span className="text-[#F0FFEA]">Inference Device</span>
                  <span className="text-[#FF5F40] font-bold">{config?.detection.ai_inference_device ?? 'CPU'}</span>
                </div>
                <select
                  value={config?.detection.ai_inference_device ?? 'CPU'}
                  onChange={async (e) => {
                    const dev = e.target.value as any;
                    try {
                      await fetch('http://127.0.0.1:8000/api/simulation/detection/ai', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ai_inference_device: dev }),
                      });
                      onUpdateConfig((prev) => ({
                        ...prev,
                        detection: { ...prev.detection, ai_inference_device: dev },
                      }));
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                  className="w-full bg-[#262824] border border-[#33362F] rounded p-2 text-[#F0FFEA] text-xs focus:border-[#FF5F40] focus:outline-none font-mono"
                >
                  <option value="CPU">CPU (OpenVINO / ONNXRuntime)</option>
                  <option value="GPU">GPU (DirectML / OpenCL)</option>
                  <option value="CUDA">CUDA (NVIDIA TensorRT)</option>
                  <option value="DirectML">DirectML (Windows Hardware Acceleration)</option>
                </select>
              </div>

              {/* Confidence Threshold */}
              <div>
                <div className="flex justify-between mb-1 text-xs">
                  <span className="text-[#9CA195]">AI Confidence Threshold</span>
                  <span className="text-[#FF5F40] font-bold font-mono">
                    {((config?.detection.ai_confidence_threshold ?? 0.5) * 100).toFixed(0)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.05"
                  value={config?.detection.ai_confidence_threshold ?? 0.5}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    onUpdateConfig((prev) => ({
                      ...prev,
                      detection: { ...prev.detection, ai_confidence_threshold: val },
                    }));
                  }}
                  className="w-full h-1.5 bg-[#262824] rounded appearance-none cursor-pointer accent-[#FF5F40]"
                />
              </div>

              {/* Inference Frequency */}
              <div>
                <div className="flex justify-between mb-1 text-xs">
                  <span className="text-[#9CA195]">Inference Frequency</span>
                  <span className="text-[#FF5F40] font-bold font-mono">
                    {config?.detection.ai_detection_frequency_hz ?? 30.0} Hz
                  </span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="60"
                  step="5"
                  value={config?.detection.ai_detection_frequency_hz ?? 30.0}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    onUpdateConfig((prev) => ({
                      ...prev,
                      detection: { ...prev.detection, ai_detection_frequency_hz: val },
                    }));
                  }}
                  className="w-full h-1.5 bg-[#262824] rounded appearance-none cursor-pointer accent-[#FF5F40]"
                />
              </div>
            </div>
          </div>

          {/* Target Identification & False Bright Object Rejection Card */}
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 flex flex-col gap-3">
            <h3 className="text-[#F0FFEA] font-semibold border-b border-[#33362F] pb-2 uppercase tracking-wider flex items-center gap-2 text-xs">
              <ShieldCheck className="w-4 h-4 text-[#FF5F40]" />
              Target ID & Clutter Rejection
            </h3>

            <div className="space-y-3">
              {/* ID Mode */}
              <div>
                <div className="flex justify-between mb-1.5 text-xs">
                  <span className="text-[#9CA195]">Identification Criterion</span>
                  <span className="text-[#FF5F40] font-bold">{config?.detection.target_id_mode ?? 'Multi-Criteria'}</span>
                </div>
                <select
                  value={config?.detection.target_id_mode ?? 'Multi-Criteria'}
                  onChange={(e) => {
                    const val = e.target.value as any;
                    onUpdateConfig((prev) => ({
                      ...prev,
                      detection: { ...prev.detection, target_id_mode: val },
                    }));
                  }}
                  className="w-full bg-[#262824] border border-[#33362F] rounded p-2 text-[#F0FFEA] text-xs focus:border-[#FF5F40] focus:outline-none font-mono"
                >
                  <option value="Multi-Criteria">Multi-Criteria (Spatial + Size + Persistence)</option>
                  <option value="Highest Confidence">Highest Confidence Composite Score</option>
                  <option value="Brightest Spot">Brightest Spot (Peak Pixel Brightness)</option>
                </select>
              </div>

              {/* Rejection Toggle */}
              <div className="flex items-center justify-between p-2.5 rounded bg-[#262824] border border-[#33362F]">
                <div>
                  <div className="font-bold text-[#F0FFEA] text-xs">Reject False Bright Objects</div>
                  <div className="text-[11px] text-[#9CA195]">Filters solar glints, cloud reflections, hot pixels</div>
                </div>
                <input
                  type="checkbox"
                  checked={config?.detection.reject_false_bright_objects ?? true}
                  onChange={(e) => {
                    const val = e.target.checked;
                    onUpdateConfig((prev) => ({
                      ...prev,
                      detection: { ...prev.detection, reject_false_bright_objects: val },
                    }));
                  }}
                  className="rounded bg-[#1B1D1A] border-[#33362F] text-[#FF5F40] focus:ring-0 cursor-pointer accent-[#FF5F40]"
                />
              </div>

              {/* Max Spatial Jump */}
              <div>
                <div className="flex justify-between mb-1 text-xs">
                  <span className="text-[#9CA195]">Max Spatial Jump Gate</span>
                  <span className="text-[#FF5F40] font-bold font-mono">{config?.detection.max_spatial_jump_px ?? 80} px</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="150"
                  step="5"
                  value={config?.detection.max_spatial_jump_px ?? 80}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    onUpdateConfig((prev) => ({
                      ...prev,
                      detection: { ...prev.detection, max_spatial_jump_px: val },
                    }));
                  }}
                  className="w-full h-1.5 bg-[#262824] rounded appearance-none cursor-pointer accent-[#FF5F40]"
                />
              </div>

              {/* Synthetic Clutter Injection Testbench */}
              <div className="p-3 bg-[#262824] border border-[#33362F] rounded space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#FF5F40] text-xs flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-[#FF5F40]" />
                    Inject Synthetic False Objects
                  </span>
                  <input
                    type="checkbox"
                    checked={config?.detection.inject_false_bright_objects ?? false}
                    onChange={(e) => handleToggleClutter(e.target.checked)}
                    className="rounded bg-[#1B1D1A] border-[#33362F] text-[#FF5F40] focus:ring-0 cursor-pointer accent-[#FF5F40]"
                  />
                </div>
                <p className="text-[11px] text-[#9CA195] leading-snug">
                  Simulates solar glints and optical clutter to test live disambiguation.
                </p>

                {config?.detection.inject_false_bright_objects && (
                  <div className="pt-2 border-t border-[#33362F] space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-[#9CA195]">Injected Glints Count</span>
                      <span className="text-[#FF5F40] font-bold font-mono">{config.detection.false_bright_object_count ?? 2}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={config.detection.false_bright_object_count ?? 2}
                      onChange={(e) => handleToggleClutter(true, parseInt(e.target.value))}
                      className="w-full h-1.5 bg-[#1B1D1A] rounded appearance-none cursor-pointer accent-[#FF5F40]"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Kalman Filter Tuning Card */}
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-lg p-4 flex flex-col gap-3">
            <h3 className="text-[#F0FFEA] font-semibold border-b border-[#33362F] pb-2 uppercase tracking-wider flex items-center gap-2 text-xs">
              <Crosshair className="w-4 h-4 text-[#FF5F40]" />
              Kalman Kinematic Filter Tuning
            </h3>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between mb-1 text-xs">
                  <span className="text-[#9CA195]">Process Noise (Q Covariance)</span>
                  <span className="text-[#FF5F40] font-bold font-mono">{config?.detection.kalman_process_noise ?? 0.5}</span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="5.0"
                  step="0.05"
                  value={config?.detection.kalman_process_noise ?? 0.5}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    onUpdateConfig((prev) => ({
                      ...prev,
                      detection: { ...prev.detection, kalman_process_noise: val },
                    }));
                  }}
                  className="w-full h-1.5 bg-[#262824] rounded appearance-none cursor-pointer accent-[#FF5F40]"
                />
              </div>

              <div>
                <div className="flex justify-between mb-1 text-xs">
                  <span className="text-[#9CA195]">Measurement Noise (R Covariance)</span>
                  <span className="text-[#FF5F40] font-bold font-mono">{config?.detection.kalman_measurement_noise ?? 1.0}</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="10.0"
                  step="0.1"
                  value={config?.detection.kalman_measurement_noise ?? 1.0}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    onUpdateConfig((prev) => ({
                      ...prev,
                      detection: { ...prev.detection, kalman_measurement_noise: val },
                    }));
                  }}
                  className="w-full h-1.5 bg-[#262824] rounded appearance-none cursor-pointer accent-[#FF5F40]"
                />
              </div>

              <div>
                <div className="flex justify-between mb-1 text-xs">
                  <span className="text-[#9CA195]">Max Occlusion Coasting Frames</span>
                  <span className="text-[#FF5F40] font-bold font-mono">{config?.detection.kalman_max_coast_frames ?? 15} frames</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="60"
                  step="5"
                  value={config?.detection.kalman_max_coast_frames ?? 15}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    onUpdateConfig((prev) => ({
                      ...prev,
                      detection: { ...prev.detection, kalman_max_coast_frames: val },
                    }));
                  }}
                  className="w-full h-1.5 bg-[#262824] rounded appearance-none cursor-pointer accent-[#FF5F40]"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
