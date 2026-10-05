import React, { useState, useEffect, useRef } from 'react';
import {
  Film,
  Upload,
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Layers,
  Target,
  Gauge,
  FileText,
  FileSpreadsheet,
  FileCode,
  ShieldCheck,
  Crosshair,
  RefreshCw,
  Sliders,
} from 'lucide-react';
import { api } from '../services/api';
import {
  VideoMetadata,
  FrameBenchmarkLog,
  BenchmarkResults,
  VideoPlaybackState,
} from '../types';

export const VideoBenchmarkPage: React.FC = () => {
  // State variables
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [playbackState, setPlaybackState] = useState<VideoPlaybackState | null>(null);
  const [frameLog, setFrameLog] = useState<FrameBenchmarkLog | null>(null);
  const [results, setResults] = useState<BenchmarkResults | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [generatingSynthetic, setGeneratingSynthetic] = useState<string | null>(null);
  const [batchProcessing, setBatchProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [annotated, setAnnotated] = useState<boolean>(true);
  const [activeMethod, setActiveMethod] = useState<string>('Classical CV');
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [frameImgKey, setFrameImgKey] = useState<number>(Date.now());
  const [frameImage, setFrameImage] = useState<string | null>(null);
  const [intensityThreshold, setIntensityThreshold] = useState<number>(50);
  const [aiConfidenceThreshold, setAiConfidenceThreshold] = useState<number>(0.20);
  const [useOtsu, setUseOtsu] = useState<boolean>(false);
  const [isIsolated, setIsIsolated] = useState<boolean>(false);
  const [isIsolating, setIsIsolating] = useState<boolean>(false);
  const [isDraggingVideo, setIsDraggingVideo] = useState<boolean>(false);
  const [isDraggingGt, setIsDraggingGt] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const gtInputRef = useRef<HTMLInputElement>(null);
  const playLoopRef = useRef<any>(null);

  // Poll state on initial load
  useEffect(() => {
    refreshBenchmarkState();
  }, []);

  // Continuous playback loop when playing - ultra-smooth single-roundtrip
  useEffect(() => {
    if (playbackState?.is_playing && !batchProcessing) {
      const intervalMs = playbackSpeed > 0 ? Math.max(16, 1000 / (30 * playbackSpeed)) : 16;
      let inFlight = false;
      playLoopRef.current = setInterval(async () => {
        if (inFlight) return;
        inFlight = true;
        try {
          const res = await api.controlBenchmark('step_forward');
          if (res?.state) setPlaybackState(res.state);
          if (res?.frame_log) setFrameLog(res.frame_log);
          if (res?.frame_image) {
            setFrameImage(res.frame_image);
          } else {
            setFrameImgKey(Date.now());
          }
          // If reached end of video, pause
          if (res?.state && res.state.current_frame_idx >= res.state.total_frames - 1) {
            await api.controlBenchmark('pause');
            refreshBenchmarkState();
          }
        } catch {
          if (playLoopRef.current) clearInterval(playLoopRef.current);
        } finally {
          inFlight = false;
        }
      }, intervalMs);
    } else {
      if (playLoopRef.current) {
        clearInterval(playLoopRef.current);
        playLoopRef.current = null;
      }
    }

    return () => {
      if (playLoopRef.current) {
        clearInterval(playLoopRef.current);
        playLoopRef.current = null;
      }
    };
  }, [playbackState?.is_playing, playbackSpeed, batchProcessing]);

  const refreshBenchmarkState = async () => {
    try {
      const data = await api.getBenchmarkState();
      setMetadata(data.metadata);
      setPlaybackState(data.state);
      setActiveMethod(data.state.active_method || 'Classical CV');
      setPlaybackSpeed(data.state.playback_speed || 1.0);
      if (data.config) {
        if (data.config.intensity_threshold !== undefined) setIntensityThreshold(data.config.intensity_threshold);
        if (data.config.ai_confidence_threshold !== undefined) setAiConfidenceThreshold(data.config.ai_confidence_threshold);
        if (data.config.use_otsu !== undefined) setUseOtsu(data.config.use_otsu);
      }

      const telemData = await api.getBenchmarkFrameTelemetry();
      if (telemData.log) setFrameLog(telemData.log);

      try {
        const isoData = await api.getBenchmarkIsolationStatus();
        setIsIsolated(isoData.is_isolated);
      } catch {
        // Backend isolation endpoint optional fallback
      }

      try {
        const resData = await api.getBenchmarkResults();
        if (resData.processed_frames > 0) {
          setResults(resData);
        }
      } catch {
        // No results yet
      }
      setFrameImgKey(Date.now());
    } catch {
      // Backend may be initializing
    }
  };

  const handleToggleIsolate = async () => {
    setIsIsolating(true);
    try {
      const res = await api.isolateBenchmark(!isIsolated);
      setIsIsolated(res.is_isolated);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to toggle isolation mode');
    } finally {
      setIsIsolating(false);
    }
  };

  const processVideoFile = async (file: File) => {
    const validExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.m4v'];
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!validExtensions.includes(ext)) {
      setErrorMsg(`Invalid file format '${ext}'. Supported formats: .mp4, .mov, .avi, .webm, .m4v, .mkv`);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.uploadBenchmarkVideo(file);
      setMetadata(res.metadata);
      await refreshBenchmarkState();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to upload video');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processVideoFile(file);
  };

  const processGtFile = async (file: File) => {
    const fn = file.name.toLowerCase();
    if (!fn.endsWith('.csv') && !fn.endsWith('.json')) {
      setErrorMsg('Invalid format. Please upload ground-truth .csv or .json file.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      await api.uploadGroundTruth(file);
      await refreshBenchmarkState();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to upload ground truth');
    } finally {
      setLoading(false);
      if (gtInputRef.current) gtInputRef.current.value = '';
    }
  };

  const handleGroundTruthUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processGtFile(file);
  };

  const handleThresholdChange = async (val: number) => {
    setIntensityThreshold(val);
    try {
      await api.updateBenchmarkConfig({ intensity_threshold: val, use_otsu: false });
      setUseOtsu(false);
      setFrameImgKey(Date.now());
      const telemData = await api.getBenchmarkFrameTelemetry();
      if (telemData.log) setFrameLog(telemData.log);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update threshold');
    }
  };

  const handleToggleOtsu = async (enabled: boolean) => {
    setUseOtsu(enabled);
    try {
      await api.updateBenchmarkConfig({ use_otsu: enabled });
      setFrameImgKey(Date.now());
      const telemData = await api.getBenchmarkFrameTelemetry();
      if (telemData.log) setFrameLog(telemData.log);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to toggle auto threshold');
    }
  };

  const handleGenerateSynthetic = async (scenario: string) => {
    setGeneratingSynthetic(scenario);
    setErrorMsg(null);
    try {
      await api.generateSyntheticBenchmark(scenario, 10.0);
      await refreshBenchmarkState();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to generate synthetic scenario');
    } finally {
      setGeneratingSynthetic(null);
    }
  };

  const handleControl = async (action: string, frameIdx?: number, speed?: number) => {
    try {
      const res = await api.controlBenchmark(action, frameIdx, speed);
      setPlaybackState(res.state);
      if (res.frame_log) setFrameLog(res.frame_log);
      if (res.frame_image) {
        setFrameImage(res.frame_image);
      } else {
        setFrameImage(null);
        setFrameImgKey(Date.now());
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Control action failed');
    }
  };

  const handleAiConfidenceChange = async (val: number) => {
    setAiConfidenceThreshold(val);
    try {
      await api.updateBenchmarkConfig({ ai_confidence_threshold: val });
      setFrameImage(null);
      setFrameImgKey(Date.now());
      const telemData = await api.getBenchmarkFrameTelemetry();
      if (telemData?.log) setFrameLog(telemData.log);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update AI confidence threshold');
    }
  };

  const handleMethodChange = async (method: string) => {
    setActiveMethod(method);
    setErrorMsg(null);
    try {
      await api.setBenchmarkMethod(method);
      if (metadata) {
        setFrameImage(null);
        setFrameImgKey(Date.now());
        const telemData = await api.getBenchmarkFrameTelemetry();
        if (telemData?.log) setFrameLog(telemData.log);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to set detector method. Ensure the backend server is running.');
    }
  };

  const handleRunBatchBenchmark = async () => {
    setBatchProcessing(true);
    setErrorMsg(null);
    try {
      const res = await api.processBenchmarkVideo();
      setResults(res.results);
      await refreshBenchmarkState();
    } catch (err: any) {
      setErrorMsg(err.message || 'Batch benchmark evaluation failed');
    } finally {
      setBatchProcessing(false);
    }
  };

  const handleCancelBatch = async () => {
    try {
      await api.cancelBenchmarkProcessing();
      setBatchProcessing(false);
      await refreshBenchmarkState();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to cancel processing');
    }
  };

  const currentFrame = playbackState?.current_frame_idx ?? 0;
  const totalFrames = metadata?.total_frames ?? 0;

  return (
    <div className="flex flex-col gap-6 text-[#F0FFEA] font-mono text-xs pb-12">
      {/* Header Navigation Bar */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-5 rounded-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-[#FF5F40]/10 border border-[#FF5F40]/25 flex items-center justify-center shrink-0">
            <Film className="w-5 h-5 text-[#FF5F40]" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-sm font-semibold text-[#F0FFEA] tracking-wide uppercase">MP4 Video Benchmark Suite</h2>
              <span className="px-2 py-0.5 bg-[#262824] border border-[#33362F] text-[#FF5F40] rounded text-[11px] font-medium">
                PTZ BYPASS EVALUATION
              </span>
            </div>
            <p className="text-xs text-[#9CA195] mt-0.5">
              Evaluator Video Stream Ingestion, Decoupled PTZ-Bypass Pipeline, & Centroid Performance Scoring
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 text-xs">
          {metadata ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#FF5F40]/15 border border-[#FF5F40]/40 text-[#FF5F40] font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>ACTIVE: {metadata.filename}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#262824] border border-[#33362F] text-[#9CA195]">
              <AlertTriangle className="w-4 h-4 text-[#FF5F40] shrink-0" />
              <span>No Video Loaded</span>
            </div>
          )}

          {/* Isolate Button */}
          <button
            onClick={handleToggleIsolate}
            disabled={isIsolating}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition cursor-pointer font-semibold text-xs ${
              isIsolated
                ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                : 'bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] border-[#33362F]'
            } ${isIsolating ? 'opacity-60 cursor-not-allowed' : ''}`}
            title={
              isIsolated
                ? 'Simulation isolated: click to restore normal background simulation processes'
                : 'Isolate Video Benchmark: halts all 3D simulation loops, gimbal dynamics, and disturbance generators so 100% compute is dedicated to this page'
            }
          >
            {isIsolated ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400"></span>
                </span>
                <span>Isolate: ACTIVE</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4 text-[#9CA195]" />
                <span>Isolate</span>
              </>
            )}
          </button>

          <button
            onClick={refreshBenchmarkState}
            className="p-2 rounded-lg bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] border border-[#33362F] transition cursor-pointer"
            title="Refresh Benchmark State"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Error alert if any */}
      {errorMsg && (
        <div className="bg-[#262824] border border-[#FF5F40]/50 p-3.5 rounded-xl text-[#FF5F40] text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#FF5F40] shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-[#FF5F40] hover:text-[#F0FFEA] font-medium ml-4 p-1 cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* Active isolation alert banner */}
      {isIsolated && (
        <div className="bg-gradient-to-r from-amber-950/40 via-[#262824] to-amber-950/40 border border-amber-500/40 px-4 py-3 rounded-xl text-amber-200 text-xs flex flex-wrap items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <div className="font-semibold text-amber-300 uppercase tracking-wide flex items-center gap-2">
                <span>Video Benchmark Isolated</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/25 text-amber-300 font-mono">100% COMPUTE DEDICATED</span>
              </div>
              <p className="text-[#9CA195] text-[11px] mt-0.5">
                All background 3D simulation loops, PTZ gimbal calculations, orbital physics, disturbance noise, and telemetry generation are paused so you can test benchmark fixes in complete isolation.
              </p>
            </div>
          </div>
          <button
            onClick={handleToggleIsolate}
            disabled={isIsolating}
            className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition text-xs font-semibold cursor-pointer shrink-0"
          >
            Restore Background Processes
          </button>
        </div>
      )}

      {/* Top Ingestion Grid: Video Upload & One-Click Synthetic Test Sequences */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Video Dropzone & Reference Ingestion */}
        <div className="lg:col-span-6 bg-[#1B1D1A] border border-[#33362F] rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-[#33362F] pb-3 mb-3.5">
              <h3 className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider flex items-center gap-2">
                <Upload className="w-4 h-4 text-[#FF5F40]" />
                Evaluator Video Ingestion
              </h3>
              <span className="text-[11px] text-[#9CA195]">PTZ Gimbal Bypassed</span>
            </div>

            <p className="text-[#9CA195] text-xs mb-4 leading-relaxed">
              Upload external MP4 benchmark video flight recordings (~30 FPS). The pipeline directly decodes frames,
              bypasses the virtual PTZ camera, and executes detection and tracking against recorded optical beacons.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              {/* Video File Picker & Dropzone */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,.avi,.mov,.mkv,.webm,.m4v,video/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDraggingVideo(true); }}
                onDragLeave={() => setIsDraggingVideo(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingVideo(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) processVideoFile(file);
                }}
                disabled={loading}
                className={`p-3.5 rounded-lg border transition text-center group cursor-pointer flex flex-col items-center justify-center gap-2 ${
                  isDraggingVideo
                    ? 'bg-[#FF5F40]/15 border-[#FF5F40] scale-[1.02]'
                    : 'bg-[#262824] hover:bg-[#33362F] border-[#33362F] hover:border-[#FF5F40]/50'
                }`}
              >
                <Upload className={`w-5 h-5 transition-transform ${isDraggingVideo ? 'text-[#FF5F40] scale-110' : 'text-[#FF5F40] group-hover:scale-105'}`} />
                <span className="text-xs font-semibold text-[#F0FFEA]">
                  {loading ? 'Processing Video...' : isDraggingVideo ? 'Drop Video Here' : 'Select Video'}
                </span>
                <span className="text-[10px] text-[#9CA195]">MP4, MOV, AVI, WEBM, MKV</span>
              </button>

              {/* Optional Ground Truth Reference */}
              <input
                ref={gtInputRef}
                type="file"
                accept=".csv,.json"
                onChange={handleGroundTruthUpload}
                className="hidden"
              />
              <button
                onClick={() => gtInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDraggingGt(true); }}
                onDragLeave={() => setIsDraggingGt(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingGt(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) processGtFile(file);
                }}
                disabled={loading}
                className={`p-3.5 rounded-lg border transition text-center group cursor-pointer flex flex-col items-center justify-center gap-2 ${
                  isDraggingGt
                    ? 'bg-[#FF5F40]/15 border-[#FF5F40] scale-[1.02]'
                    : 'bg-[#262824] hover:bg-[#33362F] border-[#33362F] hover:border-[#FF5F40]/50'
                }`}
              >
                <Crosshair className={`w-5 h-5 transition-transform ${isDraggingGt ? 'text-[#FF5F40] scale-110' : 'text-[#FF5F40] group-hover:scale-105'}`} />
                <span className="text-xs font-semibold text-[#F0FFEA]">
                  {isDraggingGt ? 'Drop Reference Data' : 'Load Ground Truth'}
                </span>
                <span className="text-[10px] text-[#9CA195]">Optional CSV or JSON</span>
              </button>
            </div>
          </div>

          {/* Video Metadata Chip Strip */}
          {metadata && (
            <div className="bg-[#262824] border border-[#33362F] rounded-lg p-3.5 text-xs grid grid-cols-3 gap-2.5">
              <div>
                <span className="text-[#9CA195] block text-[10px] uppercase font-semibold">Resolution</span>
                <span className="text-[#F0FFEA] font-medium">{metadata.width} × {metadata.height} px</span>
              </div>
              <div>
                <span className="text-[#9CA195] block text-[10px] uppercase font-semibold">Frame Rate</span>
                <span className="text-[#F0FFEA] font-medium">{metadata.fps} FPS</span>
              </div>
              <div>
                <span className="text-[#9CA195] block text-[10px] uppercase font-semibold">Total Frames</span>
                <span className="text-[#F0FFEA] font-medium">{metadata.total_frames} ({metadata.duration_s}s)</span>
              </div>
              <div>
                <span className="text-[#9CA195] block text-[10px] uppercase font-semibold">Codec</span>
                <span className="text-[#9CA195]">{metadata.codec.toUpperCase()}</span>
              </div>
              <div>
                <span className="text-[#9CA195] block text-[10px] uppercase font-semibold">File Size</span>
                <span className="text-[#9CA195]">{(metadata.file_size_bytes / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              <div>
                <span className="text-[#9CA195] block text-[10px] uppercase font-semibold">Ground Truth</span>
                <span className={metadata.has_ground_truth ? 'text-[#FF5F40] font-semibold' : 'text-[#5E625A]'}>
                  {metadata.has_ground_truth ? '[✓] AVAILABLE' : '[✕] NONE (STRICT)'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right: One-Click Standard 30 FPS Benchmark Sequences */}
        <div className="lg:col-span-6 bg-[#1B1D1A] border border-[#33362F] rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-[#33362F] pb-3 mb-3.5">
              <h3 className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#FF5F40]" />
                Standard 30 FPS Benchmark Test Sets
              </h3>
              <span className="text-[10px] text-[#FF5F40] font-medium">MATHEMATICAL GROUND TRUTH</span>
            </div>

            <p className="text-[#9CA195] text-xs mb-3.5 leading-relaxed">
              Generate official 30 FPS MP4 benchmark flight sequences paired with exact mathematical trajectory reference
              points for instant validation and zero-setup evaluation.
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              {/* Scenario: Straight Line */}
              <button
                onClick={() => handleGenerateSynthetic('Straight Line Traverse')}
                disabled={generatingSynthetic !== null}
                className="p-3 rounded-lg bg-[#262824] border border-[#33362F] hover:border-[#FF5F40]/50 text-left transition flex flex-col justify-between group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-[#F0FFEA] group-hover:text-[#FF5F40]">Straight Line</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1B1D1A] text-[#FF5F40]">40 px/s</span>
                </div>
                <span className="text-[11px] text-[#9CA195] leading-tight">
                  Linear traverse across sensor with background thermal readout noise.
                </span>
              </button>

              {/* Scenario: Circular Orbit */}
              <button
                onClick={() => handleGenerateSynthetic('Circular Orbit')}
                disabled={generatingSynthetic !== null}
                className="p-3 rounded-lg bg-[#262824] border border-[#33362F] hover:border-[#FF5F40]/50 text-left transition flex flex-col justify-between group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-[#F0FFEA] group-hover:text-[#FF5F40]">Circular Orbit</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1B1D1A] text-[#FF5F40]">R=160 px</span>
                </div>
                <span className="text-[11px] text-[#9CA195] leading-tight">
                  Smooth circular trajectory paired with 2.0 Hz radiant beacon flicker.
                </span>
              </button>

              {/* Scenario: Figure of 8 */}
              <button
                onClick={() => handleGenerateSynthetic('Figure of 8')}
                disabled={generatingSynthetic !== null}
                className="p-3 rounded-lg bg-[#262824] border border-[#33362F] hover:border-[#FF5F40]/50 text-left transition flex flex-col justify-between group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-[#F0FFEA] group-hover:text-[#FF5F40]">Figure of 8</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1B1D1A] text-[#FF5F40]">Lemniscate</span>
                </div>
                <span className="text-[11px] text-[#9CA195] leading-tight">
                  Double-loop orbital pattern with high Gaussian sensor noise injection.
                </span>
              </button>

              {/* Scenario: Occlusion Test */}
              <button
                onClick={() => handleGenerateSynthetic('Occlusion Test')}
                disabled={generatingSynthetic !== null}
                className="p-3 rounded-lg bg-[#262824] border border-[#33362F] hover:border-[#FF5F40]/50 text-left transition flex flex-col justify-between group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-[#F0FFEA] group-hover:text-[#FF5F40]">Occlusion Test</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1B1D1A] text-[#FF5F40]">Cloud Block</span>
                </div>
                <span className="text-[11px] text-[#9CA195] leading-tight">
                  Dense cloud obstacle between frames 90-130 for Kalman coasting test.
                </span>
              </button>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#33362F] flex items-center justify-between text-xs text-[#9CA195]">
            <span>Generates 300 frames (10s) at 30 FPS</span>
            {generatingSynthetic && (
              <span className="text-[#FF5F40] font-medium animate-pulse">Rendering {generatingSynthetic}...</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Video Player & Real-time Benchmark Processing Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left 8 Cols: Video Display Screen, Playback Scrubbing, & Control Toolbar */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-xl p-5">
            {/* Top Toolbar: Detection Method Toggle & Annotation Switch */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5 pb-3 border-b border-[#33362F]">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-[#9CA195] mr-1 font-semibold">METHOD:</span>
                {(['Classical CV', 'AI Detector', 'CV + Kalman', 'AI + Kalman'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => handleMethodChange(m)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                      activeMethod === m
                        ? 'bg-[#FF5F40] text-[#0A0A0A] font-semibold'
                        : 'bg-[#262824] text-[#9CA195] hover:text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40]/50'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5 text-[#F0FFEA] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={annotated}
                    onChange={(e) => {
                      setAnnotated(e.target.checked);
                      setFrameImgKey(Date.now());
                    }}
                    className="rounded bg-[#262824] border-[#33362F] text-[#FF5F40] accent-[#FF5F40] focus:ring-0 cursor-pointer"
                  />
                  <span>HUD Overlays</span>
                </label>

                <div className="flex items-center gap-1 text-[#9CA195] text-xs">
                  <span>SPEED:</span>
                  {[0.5, 1.0, 2.0].map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setPlaybackSpeed(s);
                        handleControl('set_speed', undefined, s);
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono transition cursor-pointer ${
                        playbackSpeed === s
                          ? 'bg-[#FF5F40] text-[#0A0A0A] font-semibold'
                          : 'bg-[#262824] text-[#9CA195] hover:text-[#F0FFEA] border border-[#33362F]'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Sensitivity & Threshold Tuning Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3 px-3 py-2 bg-[#121310] border border-[#262824] rounded-lg text-xs">
              <div className="flex items-center flex-wrap gap-3">
                <div className="flex items-center gap-1.5 text-[#9CA195]">
                  <Sliders className="w-3.5 h-3.5 text-[#FF5F40]" />
                  <span className="font-semibold text-[#F0FFEA]">SENSITIVITY:</span>
                </div>

                {activeMethod.includes('AI') ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[#9CA195] text-[11px]">AI Confidence:</span>
                    <input
                      type="range"
                      min={0.05}
                      max={0.95}
                      step={0.05}
                      value={aiConfidenceThreshold}
                      onChange={(e) => handleAiConfidenceChange(Number(e.target.value))}
                      className="w-24 h-1 bg-[#262824] rounded-lg appearance-none cursor-pointer accent-[#FF5F40]"
                      title={`AI Confidence Threshold: ${(aiConfidenceThreshold * 100).toFixed(0)}%`}
                    />
                    <span className="font-mono text-[#FF5F40] w-10 text-[11px] font-semibold">
                      {(aiConfidenceThreshold * 100).toFixed(0)}%
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-[#9CA195] text-[11px]">Threshold:</span>
                      <input
                        type="range"
                        min={5}
                        max={250}
                        step={5}
                        value={intensityThreshold}
                        onChange={(e) => handleThresholdChange(Number(e.target.value))}
                        className="w-24 h-1 bg-[#262824] rounded-lg appearance-none cursor-pointer accent-[#FF5F40]"
                        title={`Detection Intensity Threshold: ${intensityThreshold}`}
                      />
                      <span className="font-mono text-[#FF5F40] w-7 text-[11px] font-semibold">{intensityThreshold}</span>
                    </div>

                    <label className="flex items-center gap-1.5 text-[#9CA195] hover:text-[#F0FFEA] cursor-pointer text-[11px] ml-1">
                      <input
                        type="checkbox"
                        checked={useOtsu}
                        onChange={(e) => handleToggleOtsu(e.target.checked)}
                        className="rounded bg-[#262824] border-[#33362F] text-[#FF5F40] accent-[#FF5F40] focus:ring-0 cursor-pointer"
                      />
                      <span>Dynamic Otsu Auto-Adaptive</span>
                    </label>
                  </>
                )}
              </div>

              <div className="flex items-center gap-1.5 text-[11px]">
                {activeMethod.includes('AI') ? (
                  <>
                    <button
                      onClick={() => handleAiConfidenceChange(0.15)}
                      className={`px-2 py-0.5 rounded border transition cursor-pointer ${
                        aiConfidenceThreshold === 0.15 ? 'bg-[#FF5F40] text-[#0A0A0A] font-semibold' : 'bg-[#262824] hover:bg-[#33362F] text-[#9CA195] border-[#33362F]'
                      }`}
                      title="High Sensitivity for Dim/Faint Beacons"
                    >
                      Sensitive (15%)
                    </button>
                    <button
                      onClick={() => handleAiConfidenceChange(0.20)}
                      className={`px-2 py-0.5 rounded border transition cursor-pointer ${
                        aiConfidenceThreshold === 0.20 ? 'bg-[#FF5F40] text-[#0A0A0A] font-semibold' : 'bg-[#262824] hover:bg-[#33362F] text-[#9CA195] border-[#33362F]'
                      }`}
                      title="Optimized for custom trained beacon model"
                    >
                      Beacon Model (20%)
                    </button>
                    <button
                      onClick={() => handleAiConfidenceChange(0.40)}
                      className={`px-2 py-0.5 rounded border transition cursor-pointer ${
                        aiConfidenceThreshold === 0.40 ? 'bg-[#FF5F40] text-[#0A0A0A] font-semibold' : 'bg-[#262824] hover:bg-[#33362F] text-[#9CA195] border-[#33362F]'
                      }`}
                      title="Strict threshold for high-contrast scenes"
                    >
                      Strict (40%)
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleThresholdChange(30)}
                      className="px-2 py-0.5 rounded bg-[#262824] hover:bg-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] border border-[#33362F] transition cursor-pointer"
                      title="High Sensitivity for Dim/Faint Targets"
                    >
                      Dim Target (30)
                    </button>
                    <button
                      onClick={() => handleThresholdChange(50)}
                      className="px-2 py-0.5 rounded bg-[#262824] hover:bg-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] border border-[#33362F] transition cursor-pointer"
                      title="Default Balanced Sensitivity"
                    >
                      Default (50)
                    </button>
                    <button
                      onClick={() => handleThresholdChange(90)}
                      className="px-2 py-0.5 rounded bg-[#262824] hover:bg-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] border border-[#33362F] transition cursor-pointer"
                      title="Aggressive Clutter Rejection"
                    >
                      Bright/Noisy (90)
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Video Canvas Container */}
            <div className="relative w-full aspect-[4/3] bg-[#000000] rounded-lg overflow-hidden border border-[#33362F] flex items-center justify-center">
              {metadata ? (
                <img
                  key={frameImage ? undefined : frameImgKey}
                  src={frameImage || `/api/benchmark/frame/image?annotated=${annotated}&t=${frameImgKey}`}
                  alt="Benchmark Video Stream"
                  className="w-full h-full object-contain pointer-events-none select-none"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-center p-6 text-[#9CA195]">
                  <Film className="w-12 h-12 text-[#33362F] mb-3 animate-pulse" />
                  <p className="text-sm font-semibold text-[#F0FFEA]">No Benchmark Video Loaded</p>
                  <p className="text-xs text-[#5E625A] mt-1 max-w-sm">
                    Upload an MP4/AVI/MOV video above or click any synthetic scenario to begin optical spot tracking & benchmark analysis.
                  </p>
                </div>
              )}

              {/* In-Frame Status Overlay */}
              {metadata && (
                <div className="absolute bottom-3 left-3 flex items-center gap-2 pointer-events-none">
                  <span className="px-2.5 py-1 rounded bg-[#000000]/80 backdrop-blur-sm border border-[#33362F] text-[#F0FFEA] text-[11px]">
                    FRAME: {currentFrame} / {totalFrames}
                  </span>
                  {frameLog && (
                    <span
                      className={`px-2.5 py-1 rounded text-[11px] font-semibold border backdrop-blur-sm ${
                        frameLog.detection_status === 'DETECTED'
                          ? 'bg-[#FF5F40]/20 border-[#FF5F40] text-[#FF5F40]'
                          : 'bg-[#262824] border-[#5E625A] text-[#9CA195]'
                      }`}
                    >
                      {frameLog.detection_status}
                    </span>
                  )}
                  {frameLog?.centroid_error_px !== null && frameLog?.centroid_error_px !== undefined && (
                    <span className="px-2.5 py-1 rounded bg-[#000000]/80 backdrop-blur-sm border border-[#33362F] text-[#FF5F40] text-[11px]">
                      ERROR: {frameLog.centroid_error_px.toFixed(2)} px
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Scrubber Slider & Timing Info */}
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-[#9CA195]">
                <span className="text-[#F0FFEA] font-medium">
                  Frame {currentFrame} / {totalFrames > 0 ? totalFrames - 1 : 0}
                </span>
                <span>
                  {frameLog ? `${frameLog.timestamp_s.toFixed(2)}s` : '0.00s'} / {metadata ? `${metadata.duration_s.toFixed(2)}s` : '0.00s'}
                </span>
              </div>

              <input
                type="range"
                min={0}
                max={Math.max(0, totalFrames - 1)}
                value={currentFrame}
                onChange={(e) => handleControl('seek', parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-[#262824] rounded-lg appearance-none cursor-pointer accent-[#FF5F40]"
              />

              {/* Playback Controls Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleControl('seek', 0)}
                    disabled={!metadata}
                    className="p-2 rounded-lg bg-[#262824] hover:bg-[#33362F] border border-[#33362F] text-[#F0FFEA] transition cursor-pointer"
                    title="Rewind to Frame 0"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleControl('step_backward')}
                    disabled={!metadata || currentFrame <= 0}
                    className="p-2 rounded-lg bg-[#262824] hover:bg-[#33362F] border border-[#33362F] text-[#F0FFEA] transition cursor-pointer"
                    title="Step Backward 1 Frame"
                  >
                    <SkipBack className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleControl(playbackState?.is_playing ? 'pause' : 'play')}
                    disabled={!metadata}
                    className="px-4 py-2 rounded-lg font-semibold text-xs flex items-center gap-2 transition cursor-pointer bg-[#FF5F40] hover:bg-[#FF7459] text-[#0A0A0A]"
                  >
                    {playbackState?.is_playing ? (
                      <>
                        <Pause className="w-4 h-4 fill-current" />
                        <span>PAUSE</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-current" />
                        <span>PLAY</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleControl('step_forward')}
                    disabled={!metadata || currentFrame >= totalFrames - 1}
                    className="p-2 rounded-lg bg-[#262824] hover:bg-[#33362F] border border-[#33362F] text-[#F0FFEA] transition cursor-pointer"
                    title="Step Forward 1 Frame"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                </div>

                {/* Batch Evaluation Launchers */}
                <div className="flex items-center gap-2">
                  {batchProcessing ? (
                    <button
                      onClick={handleCancelBatch}
                      className="px-3.5 py-2 rounded-lg bg-[#262824] hover:bg-[#33362F] text-[#FF5F40] border border-[#FF5F40]/50 font-medium text-xs flex items-center gap-2 transition cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                      <span>ABORT BENCHMARK</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleRunBatchBenchmark}
                      disabled={!metadata}
                      className="px-4 py-2 rounded-lg bg-[#FF5F40] hover:bg-[#FF7459] text-[#0A0A0A] font-bold text-xs flex items-center gap-2 transition disabled:opacity-50 cursor-pointer"
                    >
                      <Activity className="w-4 h-4" />
                      <span>RUN FULL BENCHMARK (BATCH)</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right 4 Cols: Live Frame Telemetry & Centroid HUD */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-xl p-5 space-y-3">
            <h3 className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider flex items-center gap-2 border-b border-[#33362F] pb-2.5">
              <Target className="w-4 h-4 text-[#FF5F40]" />
              Live Frame Telemetry HUD
            </h3>

            {frameLog ? (
              <div className="space-y-2 text-xs">
                <div className="p-2.5 rounded-lg bg-[#262824] border border-[#33362F] flex justify-between items-center">
                  <span className="text-[#9CA195] font-medium">Detection Status</span>
                  <span
                    className={`font-semibold px-2 py-0.5 rounded text-[10px] ${
                      frameLog.detection_status === 'DETECTED'
                        ? 'bg-[#FF5F40]/15 text-[#FF5F40] border border-[#FF5F40]/40'
                        : 'bg-[#1B1D1A] text-[#9CA195] border border-[#33362F]'
                    }`}
                  >
                    {frameLog.detection_status}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#262824] border border-[#33362F] flex justify-between items-center">
                  <span className="text-[#9CA195] font-medium">PAT State</span>
                  <span className="font-semibold text-[#FF5F40]">{frameLog.tracking_state}</span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#262824] border border-[#33362F] flex justify-between items-center">
                  <span className="text-[#9CA195] font-medium">Detected Centroid</span>
                  <span className="text-[#F0FFEA]">
                    {frameLog.detected_centroid_x !== null && frameLog.detected_centroid_y !== null
                      ? `(${frameLog.detected_centroid_x.toFixed(1)}, ${frameLog.detected_centroid_y.toFixed(1)})`
                      : 'N/A (Loss)'}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#262824] border border-[#33362F] flex justify-between items-center">
                  <span className="text-[#9CA195] font-medium">Confidence</span>
                  <span className="text-[#FF5F40] font-medium">{(frameLog.confidence * 100).toFixed(1)}%</span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#262824] border border-[#33362F] flex justify-between items-center">
                  <span className="text-[#9CA195] font-medium">Latency / Speed</span>
                  <span className="text-[#F0FFEA]">
                    {frameLog.processing_time_ms.toFixed(1)} ms ({frameLog.instantaneous_fps.toFixed(0)} FPS)
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#262824] border border-[#33362F] flex justify-between items-center">
                  <span className="text-[#9CA195] font-medium">Ground Truth</span>
                  <span className="text-[#F0FFEA]">
                    {frameLog.ground_truth_x !== null && frameLog.ground_truth_y !== null
                      ? `(${frameLog.ground_truth_x.toFixed(1)}, ${frameLog.ground_truth_y.toFixed(1)})`
                      : 'Not Provided'}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#262824] border border-[#33362F] flex justify-between items-center">
                  <span className="text-[#9CA195] font-medium">Centroid Error</span>
                  <span
                    className={`font-semibold ${
                      frameLog.centroid_error_px !== null
                        ? frameLog.centroid_error_px <= 10.0
                          ? 'text-[#FF5F40]'
                          : 'text-[#9CA195]'
                        : 'text-[#5E625A]'
                    }`}
                  >
                    {frameLog.centroid_error_px !== null
                      ? `${frameLog.centroid_error_px.toFixed(2)} px (${frameLog.angular_error_deg?.toFixed(3)}°)`
                      : 'Unavailable (No GT)'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-[#9CA195] text-xs">
                Load video to view live frame telemetry.
              </div>
            )}
          </div>

          {/* Quick Ground Truth Status Box */}
          <div className="bg-[#1B1D1A] border border-[#33362F] rounded-xl p-4 text-xs space-y-2">
            <h4 className="font-semibold text-[#F0FFEA] uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#FF5F40]" />
              Truthfulness & Integrity Policy
            </h4>
            <p className="text-[#9CA195] text-xs leading-relaxed">
              When evaluating external MP4 footage without reference coordinates, this system will{' '}
              <strong className="text-[#FF5F40]">never fabricate ground truth</strong>. Absolute centroid errors are
              computed exclusively against verified ground-truth files.
            </p>
          </div>
        </div>
      </div>

      {/* Official Benchmark Results & Performance Scorecard */}
      {results && (
        <div className="bg-[#1B1D1A] border border-[#33362F] rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#33362F] pb-3.5">
            <div>
              <h3 className="text-xs font-semibold text-[#F0FFEA] uppercase tracking-wider flex items-center gap-2">
                <Gauge className="w-4 h-4 text-[#FF5F40]" />
                Benchmark Results Scorecard
              </h3>
              <p className="text-xs text-[#9CA195] mt-0.5">
                Performance evaluation over {results.processed_frames} frames using {results.detection_method}
              </p>
            </div>

            {/* Export Toolbar */}
            <div className="flex items-center gap-2">
              <a
                href={results ? api.getBenchmarkExportCsvUrl() : '#'}
                download
                className={`px-3 py-1.5 rounded-lg bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40]/50 text-xs font-medium flex items-center gap-1.5 transition ${
                  !results ? 'pointer-events-none opacity-50' : ''
                }`}
                title="Export frame-by-frame centroid telemetry CSV"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-[#FF5F40]" />
                <span>Export CSV</span>
              </a>

              <a
                href={results ? api.getBenchmarkExportJsonUrl() : '#'}
                download
                className={`px-3 py-1.5 rounded-lg bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40]/50 text-xs font-medium flex items-center gap-1.5 transition ${
                  !results ? 'pointer-events-none opacity-50' : ''
                }`}
                title="Export full structured benchmark JSON"
              >
                <FileCode className="w-3.5 h-3.5 text-[#FF5F40]" />
                <span>Export JSON</span>
              </a>

              <a
                href={results ? api.getBenchmarkExportReportUrl() : '#'}
                download
                className={`px-3 py-1.5 rounded-lg bg-[#262824] hover:bg-[#33362F] text-[#F0FFEA] border border-[#33362F] hover:border-[#FF5F40]/50 text-xs font-medium flex items-center gap-1.5 transition ${
                  !results ? 'pointer-events-none opacity-50' : ''
                }`}
                title="Export official benchmark evaluation report (Markdown)"
              >
                <FileText className="w-3.5 h-3.5 text-[#FF5F40]" />
                <span>Report (MD)</span>
              </a>
            </div>
          </div>

          {/* Metric Cards Matrix */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {/* Detection Rate */}
            <div className="p-3.5 rounded-lg bg-[#262824] border border-[#33362F]">
              <span className="text-[#9CA195] block text-[10px] uppercase font-semibold">Detection Rate</span>
              <span className="text-xl font-bold text-[#FF5F40] mt-1 block">{results.detection_rate_percent.toFixed(1)}%</span>
              <span className="text-[10px] text-[#9CA195] block mt-1">Frames beacon was detected</span>
            </div>

            {/* RMSE Centroid Error */}
            <div className="p-3.5 rounded-lg bg-[#262824] border border-[#33362F]">
              <span className="text-[#9CA195] block text-[10px] uppercase font-semibold">RMSE Centroid Error</span>
              <span className="text-xl font-bold text-[#F0FFEA] mt-1 block">
                {results.rmse_px !== null ? `${results.rmse_px.toFixed(2)} px` : 'N/A (No GT)'}
              </span>
              <span className="text-[10px] text-[#9CA195] block mt-1">
                {results.average_centroid_error_px !== null
                  ? `Mean: ${results.average_centroid_error_px.toFixed(2)} px | Max: ${results.max_centroid_error_px?.toFixed(2)} px`
                  : 'Ground truth not supplied'}
              </span>
            </div>

            {/* Lock Retention */}
            <div className="p-3.5 rounded-lg bg-[#262824] border border-[#33362F]">
              <span className="text-[#9CA195] block text-[10px] uppercase font-semibold">Lock Retention</span>
              <span className="text-xl font-bold text-[#FF5F40] mt-1 block">{results.lock_retention_percent.toFixed(1)}%</span>
              <span className="text-[10px] text-[#9CA195] block mt-1">Inside coarse alignment lock</span>
            </div>

            {/* Throughput & Latency */}
            <div className="p-3.5 rounded-lg bg-[#262824] border border-[#33362F]">
              <span className="text-[#9CA195] block text-[10px] uppercase font-semibold">Throughput Rate</span>
              <span className="text-xl font-bold text-[#F0FFEA] mt-1 block">{results.average_processing_fps.toFixed(0)} FPS</span>
              <span className="text-[10px] text-[#9CA195] block mt-1">
                Mean Latency: {results.average_processing_time_ms.toFixed(2)} ms/frame
              </span>
            </div>

            {/* Loss Events */}
            <div className="p-3.5 rounded-lg bg-[#262824] border border-[#33362F]">
              <span className="text-[#9CA195] block text-[10px] uppercase font-semibold">Target Loss Occurrences</span>
              <span className="text-xl font-bold text-[#FF5F40] mt-1 block">{results.target_lost_count}</span>
              <span className="text-[10px] text-[#9CA195] block mt-1">
                Duration: {results.target_loss_duration_s.toFixed(2)}s ({results.target_loss_percent.toFixed(1)}%)
              </span>
            </div>

            {/* Acquisition Time */}
            <div className="p-3.5 rounded-lg bg-[#262824] border border-[#33362F]">
              <span className="text-[#9CA195] block text-[10px] uppercase font-semibold">Acquisition Time</span>
              <span className="text-xl font-bold text-[#F0FFEA] mt-1 block">
                {results.acquisition_time_s !== null ? `${results.acquisition_time_s.toFixed(2)}s` : 'N/A'}
              </span>
              <span className="text-[10px] text-[#9CA195] block mt-1">Initial coarse acquisition</span>
            </div>

            {/* Re-acquisition Time */}
            <div className="p-3.5 rounded-lg bg-[#262824] border border-[#33362F]">
              <span className="text-[#9CA195] block text-[10px] uppercase font-semibold">Re-Acquisition Time</span>
              <span className="text-xl font-bold text-[#F0FFEA] mt-1 block">
                {results.reacquisition_time_s !== null ? `${results.reacquisition_time_s.toFixed(2)}s` : 'N/A'}
              </span>
              <span className="text-[10px] text-[#9CA195] block mt-1">Mean recovery time after loss</span>
            </div>

            {/* Input FPS Target */}
            <div className="p-3.5 rounded-lg bg-[#262824] border border-[#33362F]">
              <span className="text-[#9CA195] block text-[10px] uppercase font-semibold">Real-Time Multiplier</span>
              <span className="text-xl font-bold text-[#FF5F40] mt-1 block">
                {(results.average_processing_fps / Math.max(1, results.input_fps)).toFixed(1)}×
              </span>
              <span className="text-[10px] text-[#9CA195] block mt-1">
                Versus native 30 FPS stream
              </span>
            </div>
          </div>

          {/* Status Message / Ground Truth Notice */}
          <div
            className={`p-3.5 rounded-lg text-xs border ${
              results.ground_truth_available
                ? 'bg-[#FF5F40]/15 border-[#FF5F40]/40 text-[#FF5F40]'
                : 'bg-[#262824] border-[#33362F] text-[#9CA195]'
            }`}
          >
            <div className="flex items-center gap-2">
              {results.ground_truth_available ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-[#FF5F40]" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 text-[#FF5F40]" />
              )}
              <span>{results.status_message}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
