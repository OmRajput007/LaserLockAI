import React, { useState, useEffect, useRef } from 'react';
import {
  Film,
  Upload,
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  FastForward,
  CheckCircle2,
  AlertTriangle,
  Download,
  Activity,
  Layers,
  Target,
  Clock,
  Gauge,
  Sliders,
  FileText,
  FileSpreadsheet,
  FileCode,
  ShieldCheck,
  Eye,
  Crosshair,
  RefreshCw,
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
  const [batchProgress, setBatchProgress] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [annotated, setAnnotated] = useState<boolean>(true);
  const [activeMethod, setActiveMethod] = useState<string>('Classical CV');
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [frameImgKey, setFrameImgKey] = useState<number>(Date.now());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const gtInputRef = useRef<HTMLInputElement>(null);
  const playLoopRef = useRef<any>(null);

  // Poll state on initial load
  useEffect(() => {
    refreshBenchmarkState();
  }, []);

  // Continuous playback loop when playing
  useEffect(() => {
    if (playbackState?.is_playing && !batchProcessing) {
      const intervalMs = playbackSpeed > 0 ? Math.max(20, 1000 / (30 * playbackSpeed)) : 20;
      let inFlight = false;
      playLoopRef.current = setInterval(async () => {
        if (inFlight) return;
        inFlight = true;
        try {
          const res = await api.controlBenchmark('step_forward');
          if (res?.state) setPlaybackState(res.state);
          if (res?.frame_log) setFrameLog(res.frame_log);
          setFrameImgKey(Date.now());
          // If reached end of video, pause
          if (res?.state && res.state.current_frame_idx >= res.state.total_frames - 1) {
            await api.controlBenchmark('pause');
            refreshBenchmarkState();
          }
        } catch {
          // If step fails, stop loop
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

      // Fetch telemetry for current frame
      const telemData = await api.getBenchmarkFrameTelemetry();
      if (telemData.log) setFrameLog(telemData.log);

      // Fetch latest results if available
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

  // Video file upload handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.mp4')) {
      setErrorMsg('Invalid file format. Please upload a standard MP4 video (.mp4).');
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

  // Ground truth file upload handler
  const handleGroundTruthUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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

  // Synthetic benchmark video generator
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

  // Playback control actions
  const handleControl = async (action: string, frameIdx?: number, speed?: number) => {
    try {
      const res = await api.controlBenchmark(action, frameIdx, speed);
      setPlaybackState(res.state);
      if (res.frame_log) setFrameLog(res.frame_log);
      setFrameImgKey(Date.now());
    } catch (err: any) {
      setErrorMsg(err.message || 'Control action failed');
    }
  };

  // Method switch
  const handleMethodChange = async (method: string) => {
    try {
      await api.setBenchmarkMethod(method);
      setActiveMethod(method);
      // Re-process current frame with new method
      await handleControl('seek', playbackState?.current_frame_idx || 0);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to set detector method');
    }
  };

  // Batch video process execution
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
  const progressPercent = totalFrames > 0 ? (currentFrame / totalFrames) * 100.0 : 0;

  return (
    <div className="flex flex-col gap-6 text-slate-200 font-sans pb-12">
      {/* Header Navigation Bar */}
      <div className="bg-[#121518] border border-[#252A2E] p-5 rounded-xl flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-[#1A1D20] border border-[#3A4048]/20 flex items-center justify-center shrink-0">
            <Film className="w-5 h-5 text-[#D6D9DC]" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-sm font-semibold text-white tracking-wide">MP4 Video Benchmark Suite</h2>
              <span className="px-2 py-0.5 bg-[#1A1D20] border border-[#3A4048] text-[#D6D9DC] rounded text-[11px] font-medium">
                PTZ BYPASS EVALUATION
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Evaluator Video Stream Ingestion, Decoupled PTZ-Bypass Pipeline, & Centroid Performance Scoring
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 text-xs">
          {metadata ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>ACTIVE: {metadata.filename}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#121518] border border-[#252A2E] text-slate-400">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>No Video Loaded</span>
            </div>
          )}

          <button
            onClick={refreshBenchmarkState}
            className="p-2 rounded-lg bg-[#1A1D20] hover:bg-[#1e2a42] text-slate-300 border border-[#22324e] transition cursor-pointer"
            title="Refresh Benchmark State"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Error alert if any */}
      {errorMsg && (
        <div className="bg-rose-950/60 border border-rose-800/80 p-3.5 rounded-xl text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-rose-400 hover:text-white font-medium ml-4 p-1 cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* Top Ingestion Grid: Video Upload & One-Click Synthetic Test Sequences */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Video Dropzone & Reference Ingestion */}
        <div className="lg:col-span-6 bg-[#121518] border border-[#252A2E] rounded-xl p-5 flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center justify-between border-b border-[#252A2E] pb-3 mb-3.5">
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <Upload className="w-4 h-4 text-[#D6D9DC]" />
                Evaluator Video Ingestion
              </h3>
              <span className="text-[11px] text-slate-500">PTZ Gimbal Bypassed</span>
            </div>

            <p className="text-slate-400 text-xs mb-4 leading-relaxed">
              Upload external MP4 benchmark video flight recordings (~30 FPS). The pipeline directly decodes frames,
              bypasses the virtual PTZ camera, and executes detection and tracking against recorded optical beacons.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              {/* MP4 Picker */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,video/mp4"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="p-3.5 rounded-lg bg-[#121518] hover:bg-[#1A1D20] border border-[#252A2E] flex flex-col items-center justify-center gap-2 transition text-center group cursor-pointer"
              >
                <Upload className="w-5 h-5 text-[#D6D9DC] group-hover:scale-105 transition-transform" />
                <span className="text-xs font-semibold text-slate-200">Select MP4 Video</span>
                <span className="text-[10px] text-slate-400">Drag & drop or file picker</span>
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
                disabled={loading}
                className="p-3.5 rounded-lg bg-[#121518] hover:bg-[#1A1D20] border border-[#252A2E] flex flex-col items-center justify-center gap-2 transition text-center group cursor-pointer"
              >
                <Crosshair className="w-5 h-5 text-amber-400 group-hover:scale-105 transition-transform" />
                <span className="text-xs font-semibold text-slate-200">Load Ground Truth</span>
                <span className="text-[10px] text-slate-400">Optional CSV or JSON</span>
              </button>
            </div>
          </div>

          {/* Video Metadata Chip Strip */}
          {metadata && (
            <div className="bg-[#121518] border border-[#252A2E] rounded-lg p-3.5 text-xs grid grid-cols-3 gap-2.5">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Resolution</span>
                <span className="text-[#E8EAED] font-mono font-medium">{metadata.width} × {metadata.height} px</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Frame Rate</span>
                <span className="text-[#E8EAED] font-mono font-medium">{metadata.fps} FPS</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Total Frames</span>
                <span className="text-[#E8EAED] font-mono font-medium">{metadata.total_frames} ({metadata.duration_s}s)</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Codec</span>
                <span className="text-slate-300 font-mono">{metadata.codec.toUpperCase()}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">File Size</span>
                <span className="text-slate-300 font-mono">{(metadata.file_size_bytes / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Ground Truth</span>
                <span className={metadata.has_ground_truth ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
                  {metadata.has_ground_truth ? 'AVAILABLE' : 'NONE (STRICT)'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right: One-Click Standard 30 FPS Benchmark Sequences */}
        <div className="lg:col-span-6 bg-[#121518] border border-[#252A2E] rounded-xl p-5 flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center justify-between border-b border-[#252A2E] pb-3 mb-3.5">
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                Standard 30 FPS Benchmark Test Sets
              </h3>
              <span className="text-[10px] text-emerald-400 font-medium">MATHEMATICAL GROUND TRUTH</span>
            </div>

            <p className="text-slate-400 text-xs mb-3.5 leading-relaxed">
              Generate official 30 FPS MP4 benchmark flight sequences paired with exact mathematical trajectory reference
              points for instant validation and zero-setup evaluation.
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              {/* Scenario: Straight Line */}
              <button
                onClick={() => handleGenerateSynthetic('Straight Line Traverse')}
                disabled={generatingSynthetic !== null}
                className="p-3 rounded-lg bg-[#121518] border border-[#252A2E] hover:border-[#4A5058] text-left transition flex flex-col justify-between group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-slate-200 group-hover:text-[#E8EAED]">Straight Line</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1A1D20] text-[#D6D9DC] font-mono">40 px/s</span>
                </div>
                <span className="text-[11px] text-slate-400 leading-tight">
                  Linear traverse across sensor with background thermal readout noise.
                </span>
              </button>

              {/* Scenario: Circular Orbit */}
              <button
                onClick={() => handleGenerateSynthetic('Circular Orbit')}
                disabled={generatingSynthetic !== null}
                className="p-3 rounded-lg bg-[#121518] border border-[#252A2E] hover:border-[#4A5058] text-left transition flex flex-col justify-between group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-slate-200 group-hover:text-[#E8EAED]">Circular Orbit</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">R=160 px</span>
                </div>
                <span className="text-[11px] text-slate-400 leading-tight">
                  Smooth circular trajectory paired with 2.0 Hz radiant beacon flicker.
                </span>
              </button>

              {/* Scenario: Figure of 8 */}
              <button
                onClick={() => handleGenerateSynthetic('Figure of 8')}
                disabled={generatingSynthetic !== null}
                className="p-3 rounded-lg bg-[#121518] border border-[#252A2E] hover:border-[#4A5058] text-left transition flex flex-col justify-between group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-slate-200 group-hover:text-[#E8EAED]">Figure of 8</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 font-mono">Lemniscate</span>
                </div>
                <span className="text-[11px] text-slate-400 leading-tight">
                  Double-loop orbital pattern with high Gaussian sensor noise injection.
                </span>
              </button>

              {/* Scenario: Occlusion Test */}
              <button
                onClick={() => handleGenerateSynthetic('Occlusion Test')}
                disabled={generatingSynthetic !== null}
                className="p-3 rounded-lg bg-[#121518] border border-[#252A2E] hover:border-[#4A5058] text-left transition flex flex-col justify-between group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-slate-200 group-hover:text-[#E8EAED]">Occlusion Test</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-mono">Cloud Block</span>
                </div>
                <span className="text-[11px] text-slate-400 leading-tight">
                  Dense cloud obstacle between frames 90-130 for Kalman coasting test.
                </span>
              </button>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#252A2E] flex items-center justify-between text-xs text-slate-500">
            <span>Generates 300 frames (10s) at 30 FPS</span>
            {generatingSynthetic && (
              <span className="text-[#D6D9DC] font-medium animate-pulse">Rendering {generatingSynthetic}...</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Video Player & Real-time Benchmark Processing Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left 8 Cols: Video Display Screen, Playback Scrubbing, & Control Toolbar */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-5 shadow-sm">
            {/* Top Toolbar: Detection Method Toggle & Annotation Switch */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5 pb-3 border-b border-[#252A2E]">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 mr-1 font-semibold">METHOD:</span>
                {(['Classical CV', 'AI Detector', 'CV + Kalman', 'AI + Kalman'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => handleMethodChange(m)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                      activeMethod === m
                        ? 'bg-[#252A2E] text-white shadow-sm'
                        : 'bg-[#121518] text-slate-300 hover:bg-[#1A1D20] border border-[#252A2E]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={annotated}
                    onChange={(e) => {
                      setAnnotated(e.target.checked);
                      setFrameImgKey(Date.now());
                    }}
                    className="rounded bg-[#121518] border-[#252A2E] text-[#D6D9DC] focus:ring-0 cursor-pointer"
                  />
                  <span>HUD Overlays</span>
                </label>

                <div className="flex items-center gap-1 text-slate-400 text-xs">
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
                          ? 'bg-[#1E2124] text-[#D6D9DC] font-semibold border border-[#3A4048]'
                          : 'bg-[#121518] text-slate-400 hover:text-white border border-[#252A2E]'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Video Canvas Container */}
            <div className="relative w-full aspect-[4/3] bg-black rounded-lg overflow-hidden border border-[#252A2E] flex items-center justify-center">
              <img
                key={frameImgKey}
                src={`http://127.0.0.1:8000/api/benchmark/frame/image?annotated=${annotated}&t=${frameImgKey}`}
                alt="Benchmark Video Stream"
                className="w-full h-full object-contain"
              />

              {/* In-Frame Status Overlay */}
              <div className="absolute bottom-3 left-3 flex items-center gap-2 pointer-events-none">
                <span className="px-2.5 py-1 rounded bg-black/80 backdrop-blur-sm border border-[#252A2E] text-[#D6D9DC] text-[11px] font-mono">
                  FRAME: {currentFrame} / {totalFrames}
                </span>
                {frameLog && (
                  <span
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold border font-mono backdrop-blur-sm ${
                      frameLog.detection_status === 'DETECTED'
                        ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-400'
                        : 'bg-rose-950/80 border-rose-500/30 text-rose-400'
                    }`}
                  >
                    {frameLog.detection_status}
                  </span>
                )}
                {frameLog?.centroid_error_px !== null && frameLog?.centroid_error_px !== undefined && (
                  <span className="px-2.5 py-1 rounded bg-black/80 backdrop-blur-sm border border-[#252A2E] text-amber-300 text-[11px] font-mono">
                    ERROR: {frameLog.centroid_error_px.toFixed(2)} px
                  </span>
                )}
              </div>
            </div>

            {/* Scrubber Slider & Timing Info */}
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-mono text-[#E8EAED] font-medium">
                  Frame {currentFrame} / {totalFrames > 0 ? totalFrames - 1 : 0}
                </span>
                <span className="font-mono">
                  {frameLog ? `${frameLog.timestamp_s.toFixed(2)}s` : '0.00s'} / {metadata ? `${metadata.duration_s.toFixed(2)}s` : '0.00s'}
                </span>
              </div>

              <input
                type="range"
                min={0}
                max={Math.max(0, totalFrames - 1)}
                value={currentFrame}
                onChange={(e) => handleControl('seek', parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-[#121518] rounded-lg appearance-none cursor-pointer accent-slate-500"
              />

              {/* Playback Controls Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleControl('seek', 0)}
                    disabled={!metadata}
                    className="p-2 rounded-lg bg-[#121518] hover:bg-[#1A1D20] border border-[#252A2E] text-slate-300 transition cursor-pointer"
                    title="Rewind to Frame 0"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleControl('step_backward')}
                    disabled={!metadata || currentFrame <= 0}
                    className="p-2 rounded-lg bg-[#121518] hover:bg-[#1A1D20] border border-[#252A2E] text-slate-300 transition cursor-pointer"
                    title="Step Backward 1 Frame"
                  >
                    <SkipBack className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleControl(playbackState?.is_playing ? 'pause' : 'play')}
                    disabled={!metadata}
                    className={`px-4 py-2 rounded-lg font-semibold text-xs flex items-center gap-2 transition cursor-pointer ${
                      playbackState?.is_playing
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                        : 'bg-[#252A2E] hover:bg-[#252A2E] text-white'
                    }`}
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
                    className="p-2 rounded-lg bg-[#121518] hover:bg-[#1A1D20] border border-[#252A2E] text-slate-300 transition cursor-pointer"
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
                      className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs flex items-center gap-2 transition cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                      <span>ABORT BENCHMARK</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleRunBatchBenchmark}
                      disabled={!metadata}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center gap-2 shadow-sm transition disabled:opacity-50 cursor-pointer"
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
          <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-5 shadow-sm space-y-3">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2 border-b border-[#252A2E] pb-2.5">
              <Target className="w-4 h-4 text-[#D6D9DC]" />
              Live Frame Telemetry HUD
            </h3>

            {frameLog ? (
              <div className="space-y-2 text-xs">
                <div className="p-2.5 rounded-lg bg-[#121518] border border-[#252A2E] flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Detection Status</span>
                  <span
                    className={`font-semibold px-2 py-0.5 rounded text-[10px] ${
                      frameLog.detection_status === 'DETECTED'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {frameLog.detection_status}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#121518] border border-[#252A2E] flex justify-between items-center">
                  <span className="text-slate-400 font-medium">PAT State</span>
                  <span className="font-semibold text-[#D6D9DC]">{frameLog.tracking_state}</span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#121518] border border-[#252A2E] flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Detected Centroid</span>
                  <span className="font-mono text-slate-200">
                    {frameLog.detected_centroid_x !== null && frameLog.detected_centroid_y !== null
                      ? `(${frameLog.detected_centroid_x.toFixed(1)}, ${frameLog.detected_centroid_y.toFixed(1)})`
                      : 'N/A (Loss)'}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#121518] border border-[#252A2E] flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Confidence</span>
                  <span className="font-mono text-emerald-400 font-medium">{(frameLog.confidence * 100).toFixed(1)}%</span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#121518] border border-[#252A2E] flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Latency / Speed</span>
                  <span className="font-mono text-[#E8EAED]">
                    {frameLog.processing_time_ms.toFixed(1)} ms ({frameLog.instantaneous_fps.toFixed(0)} FPS)
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#121518] border border-[#252A2E] flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Ground Truth</span>
                  <span className="font-mono text-amber-300">
                    {frameLog.ground_truth_x !== null && frameLog.ground_truth_y !== null
                      ? `(${frameLog.ground_truth_x.toFixed(1)}, ${frameLog.ground_truth_y.toFixed(1)})`
                      : 'Not Provided'}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#121518] border border-[#252A2E] flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Centroid Error</span>
                  <span
                    className={`font-mono font-semibold ${
                      frameLog.centroid_error_px !== null
                        ? frameLog.centroid_error_px <= 10.0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                        : 'text-slate-500'
                    }`}
                  >
                    {frameLog.centroid_error_px !== null
                      ? `${frameLog.centroid_error_px.toFixed(2)} px (${frameLog.angular_error_deg?.toFixed(3)}°)`
                      : 'Unavailable (No GT)'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-slate-500 text-xs">
                Load video to view live frame telemetry.
              </div>
            )}
          </div>

          {/* Quick Ground Truth Status Box */}
          <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-4 text-xs space-y-2">
            <h4 className="font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#D6D9DC]" />
              Truthfulness & Integrity Policy
            </h4>
            <p className="text-slate-400 text-xs leading-relaxed">
              When evaluating external MP4 footage without reference coordinates, this system will{' '}
              <strong className="text-amber-400">never fabricate ground truth</strong>. Absolute centroid errors are
              computed exclusively against verified ground-truth files.
            </p>
          </div>
        </div>
      </div>

      {/* Official Benchmark Results & Performance Scorecard */}
      {results && (
        <div className="bg-[#121518] border border-[#252A2E] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#252A2E] pb-3.5">
            <div>
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <Gauge className="w-4 h-4 text-emerald-400" />
                Benchmark Results Scorecard
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Performance evaluation over {results.processed_frames} frames using {results.detection_method}
              </p>
            </div>

            {/* Export Toolbar */}
            <div className="flex items-center gap-2">
              <a
                href="http://127.0.0.1:8000/api/benchmark/export/csv"
                download
                className="px-3 py-1.5 rounded-lg bg-[#121518] hover:bg-[#1A1D20] text-slate-200 border border-[#252A2E] text-xs font-medium flex items-center gap-1.5 transition"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                <span>Export CSV</span>
              </a>

              <a
                href="http://127.0.0.1:8000/api/benchmark/export/json"
                download
                className="px-3 py-1.5 rounded-lg bg-[#121518] hover:bg-[#1A1D20] text-slate-200 border border-[#252A2E] text-xs font-medium flex items-center gap-1.5 transition"
              >
                <FileCode className="w-3.5 h-3.5 text-[#D6D9DC]" />
                <span>Export JSON</span>
              </a>

              <a
                href="http://127.0.0.1:8000/api/benchmark/export/report"
                download
                className="px-3 py-1.5 rounded-lg bg-[#1E2124] hover:bg-[#252A2E]/25 text-[#E8EAED] border border-[#3A4048] text-xs font-medium flex items-center gap-1.5 transition"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Report (MD)</span>
              </a>
            </div>
          </div>

          {/* Metric Cards Matrix */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {/* Detection Rate */}
            <div className="p-3.5 rounded-lg bg-[#121518] border border-[#252A2E]">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Detection Rate</span>
              <span className="text-xl font-bold font-mono text-emerald-400 mt-1 block">{results.detection_rate_percent.toFixed(1)}%</span>
              <span className="text-[10px] text-slate-400 block mt-1">Frames beacon was detected</span>
            </div>

            {/* RMSE Centroid Error */}
            <div className="p-3.5 rounded-lg bg-[#121518] border border-[#252A2E]">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">RMSE Centroid Error</span>
              <span className="text-xl font-bold font-mono text-[#D6D9DC] mt-1 block">
                {results.rmse_px !== null ? `${results.rmse_px.toFixed(2)} px` : 'N/A (No GT)'}
              </span>
              <span className="text-[10px] text-slate-400 block mt-1">
                {results.average_centroid_error_px !== null
                  ? `Mean: ${results.average_centroid_error_px.toFixed(2)} px | Max: ${results.max_centroid_error_px?.toFixed(2)} px`
                  : 'Ground truth not supplied'}
              </span>
            </div>

            {/* Lock Retention */}
            <div className="p-3.5 rounded-lg bg-[#121518] border border-[#252A2E]">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Lock Retention</span>
              <span className="text-xl font-bold font-mono text-emerald-400 mt-1 block">{results.lock_retention_percent.toFixed(1)}%</span>
              <span className="text-[10px] text-slate-400 block mt-1">Inside coarse alignment lock</span>
            </div>

            {/* Throughput & Latency */}
            <div className="p-3.5 rounded-lg bg-[#121518] border border-[#252A2E]">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Throughput Rate</span>
              <span className="text-xl font-bold font-mono text-[#E8EAED] mt-1 block">{results.average_processing_fps.toFixed(0)} FPS</span>
              <span className="text-[10px] text-slate-400 block mt-1 font-mono">
                Mean Latency: {results.average_processing_time_ms.toFixed(2)} ms/frame
              </span>
            </div>

            {/* Loss Events */}
            <div className="p-3.5 rounded-lg bg-[#121518] border border-[#252A2E]">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Target Loss Occurrences</span>
              <span className="text-xl font-bold font-mono text-amber-400 mt-1 block">{results.target_lost_count}</span>
              <span className="text-[10px] text-slate-400 block mt-1 font-mono">
                Duration: {results.target_loss_duration_s.toFixed(2)}s ({results.target_loss_percent.toFixed(1)}%)
              </span>
            </div>

            {/* Acquisition Time */}
            <div className="p-3.5 rounded-lg bg-[#121518] border border-[#252A2E]">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Acquisition Time</span>
              <span className="text-xl font-bold font-mono text-slate-200 mt-1 block">
                {results.acquisition_time_s !== null ? `${results.acquisition_time_s.toFixed(2)}s` : 'N/A'}
              </span>
              <span className="text-[10px] text-slate-400 block mt-1">Initial coarse acquisition</span>
            </div>

            {/* Re-acquisition Time */}
            <div className="p-3.5 rounded-lg bg-[#121518] border border-[#252A2E]">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Re-Acquisition Time</span>
              <span className="text-xl font-bold font-mono text-slate-200 mt-1 block">
                {results.reacquisition_time_s !== null ? `${results.reacquisition_time_s.toFixed(2)}s` : 'N/A'}
              </span>
              <span className="text-[10px] text-slate-400 block mt-1">Mean recovery time after loss</span>
            </div>

            {/* Input FPS Target */}
            <div className="p-3.5 rounded-lg bg-[#121518] border border-[#252A2E]">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Real-Time Multiplier</span>
              <span className="text-xl font-bold font-mono text-purple-400 mt-1 block">
                {(results.average_processing_fps / Math.max(1, results.input_fps)).toFixed(1)}×
              </span>
              <span className="text-[10px] text-slate-400 block mt-1">
                Versus native 30 FPS stream
              </span>
            </div>
          </div>

          {/* Status Message / Ground Truth Notice */}
          <div
            className={`p-3.5 rounded-lg text-xs border ${
              results.ground_truth_available
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
            }`}
          >
            <div className="flex items-center gap-2">
              {results.ground_truth_available ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
              )}
              <span>{results.status_message}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
