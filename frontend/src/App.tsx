import React, { useState, useEffect } from 'react';
import {
  Compass,
  Video,
  Film,
  Cpu,
  Activity,
  CloudRain,
  BarChart3,
  FlaskConical,
  FileText,
  CheckSquare,
  Network,
  BookOpen,
  Settings,
  Radar,
  Play,
  Pause,
  RotateCcw,
  Wifi,
  WifiOff,
  Crosshair,
  ShieldCheck,
  Zap,
  Volume2,
  VolumeX,
  AlertTriangle,
} from 'lucide-react';

import { NavTabId, SystemConfig } from './types';
import { useTelemetry } from './hooks/useTelemetry';
import { api } from './services/api';
import { alarmAudio } from './services/alarmAudio';
import { satellitePovSync } from './simulation/satellitePovSync';

import { MissionControlPage } from './pages/MissionControlPage';
import { VirtualSimulationPage } from './pages/VirtualSimulationPage';
import { CameraViewPage } from './pages/CameraViewPage';
import { VideoBenchmarkPage } from './pages/VideoBenchmarkPage';
import { TargetEnvironmentPage } from './pages/TargetEnvironmentPage';
import { DetectionAIPage } from './pages/DetectionAIPage';
import { TrackingControlPage } from './pages/TrackingControlPage';
import { DisturbancesPage } from './pages/DisturbancesPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { ExperimentsPage } from './pages/ExperimentsPage';
import { PerformanceReportsPage } from './pages/PerformanceReportsPage';
import { RequirementsPage } from './pages/RequirementsPage';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { DocumentationPage } from './pages/DocumentationPage';
import { SettingsPage } from './pages/SettingsPage';
import { DemoModal } from './pages/DemoModal';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTabId>('mission_control');
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [isDemoModalOpen, setIsDemoModalOpen] = useState<boolean>(false);

  const {
    telemetry,
    isConnected,
    errorHistory,
    sendGimbalControl,
    sendGimbalTargetAngles,
    toggleSimulation,
    resetSimulation,
  } = useTelemetry();

  // Beacon Lost FOV Alarm State & Subscription
  const [isAlarmActive, setIsAlarmActive] = useState<boolean>(false);
  const [isAlarmMuted, setIsAlarmMuted] = useState<boolean>(alarmAudio.getIsMuted());
  const [isAlarmSuspended, setIsAlarmSuspended] = useState<boolean>(alarmAudio.getIsSuspended());

  useEffect(() => {
    const unsub = alarmAudio.subscribe((active, muted, suspended) => {
      setIsAlarmActive(active);
      setIsAlarmMuted(muted);
      setIsAlarmSuspended(suspended);
    });
    return unsub;
  }, []);

  // Synchronize alarm with satellitePovSync (when rectangular frustum turns green -> silence, when red -> beep)
  useEffect(() => {
    const unsub = satellitePovSync.subscribe((data) => {
      if (data.isLockedInFov) {
        alarmAudio.stopLostAlarm();
      } else if (data.isLostFromFov) {
        alarmAudio.startLostAlarm();
      }
    });
    return unsub;
  }, []);

  // Monitor satellite camera FOV and trigger alarm when beacon is lost
  useEffect(() => {
    // 3D FOV frustum is the primary source of truth:
    // When locked in FOV (rectangular frustum is GREEN), alarm MUST be silent
    const pov = satellitePovSync.getData();
    if (pov.isLockedInFov) {
      alarmAudio.stopLostAlarm();
      return;
    }
    // When lost from FOV (rectangular frustum is RED), alarm MUST sound
    if (pov.isLostFromFov) {
      alarmAudio.startLostAlarm();
      return;
    }

    if (!telemetry) {
      alarmAudio.stopLostAlarm();
      return;
    }

    const t = telemetry.target;
    const det = telemetry.detection;
    const trk = telemetry.tracking;

    const isCvDetected = Boolean(
      det?.beacon_detected &&
      det.detected_centroid_x !== null &&
      det.detected_centroid_y !== null &&
      det.detected_centroid_x >= 0 &&
      det.detected_centroid_x <= 640 &&
      det.detected_centroid_y >= 0 &&
      det.detected_centroid_y <= 480
    );

    const isTrackingLocked = Boolean(
      trk?.is_locked ||
      trk?.state === 'LOCKED' ||
      trk?.state === 'TRACKING' ||
      trk?.mode === 'TRACKING' ||
      trk?.mode === 'LOCKED'
    );

    const isTrackedInSensor = Boolean(
      trk &&
      trk.state !== 'LOST' &&
      trk.state !== 'SEARCHING' &&
      trk.filtered_x !== null &&
      trk.filtered_x !== undefined &&
      trk.filtered_y !== null &&
      trk.filtered_y !== undefined &&
      trk.filtered_x >= 0 &&
      trk.filtered_x <= 640 &&
      trk.filtered_y >= 0 &&
      trk.filtered_y <= 480
    );

    const isGroundTruthInSensor = Boolean(
      t &&
      t.pixel_x !== null &&
      t.pixel_x !== undefined &&
      t.pixel_y !== null &&
      t.pixel_y !== undefined &&
      t.pixel_x >= 0 &&
      t.pixel_x <= 640 &&
      t.pixel_y >= 0 &&
      t.pixel_y <= 480
    );

    const isPovOccluded = Boolean(satellitePovSync.getCurrent()?.isOccluded);
    const isOccluded = Boolean(
      telemetry.disturbance?.is_occluded ||
      telemetry.orbital?.link?.link_state === 'LINK_BLOCKED' ||
      isPovOccluded
    );

    const isVisibleInFov = !isOccluded && (isCvDetected || isTrackingLocked || isTrackedInSensor || isGroundTruthInSensor);

    // Alarm beeps whenever beacon is lost from the satellite camera FOV
    if (!isVisibleInFov) {
      alarmAudio.startLostAlarm();
    } else {
      alarmAudio.stopLostAlarm();
    }
  }, [telemetry]);

  useEffect(() => {
    return () => {
      alarmAudio.stopLostAlarm();
    };
  }, []);

  // Load active configuration from backend on mount
  useEffect(() => {
    api
      .getConfig()
      .then(setConfig)
      .catch((err) => console.error('Failed to load initial configuration:', err));
  }, []);

  const handleUpdateConfig = async (updater: (prev: SystemConfig) => SystemConfig) => {
    if (!config) return;
    const updated = updater(config);
    setConfig(updated);
    try {
      const saved = await api.updateConfig(updated);
      setConfig(saved);
    } catch (e) {
      console.error('Failed to auto-save configuration:', e);
    }
  };

  const handleSelectShape = async (shape: 'Square' | 'Circle' | 'Gaussian') => {
    try {
      await api.setTargetShape(shape);
      if (config) {
        setConfig({
          ...config,
          target: { ...config.target, shape },
        });
      }
    } catch (e) {
      console.error('Failed to set target shape:', e);
    }
  };

  const handleSelectMotion = async (trajectory_type: string) => {
    try {
      await api.setTargetMotion(trajectory_type);
      if (config) {
        setConfig({
          ...config,
          motion: { ...config.motion, trajectory_type: trajectory_type as any },
        });
      }
    } catch (e) {
      console.error('Failed to set target motion:', e);
    }
  };

  const navItems: { id: NavTabId; label: string; icon: React.ComponentType<{ className?: string }>; group: string }[] = [
    { id: 'mission_control', label: '1. Mission Control', icon: Radar, group: 'OPERATIONS' },
    { id: 'virtual_simulation', label: '2. Virtual Simulation', icon: Compass, group: 'OPERATIONS' },
    { id: 'camera_view', label: '3. Camera View', icon: Video, group: 'OPERATIONS' },
    { id: 'video_benchmark', label: '4. Video Benchmark', icon: Film, group: 'OPERATIONS' },
    { id: 'target_environment', label: '5. Target & Environment', icon: Crosshair, group: 'OPERATIONS' },
    { id: 'detection_ai', label: '6. Detection & AI', icon: Cpu, group: 'PIPELINE & CONTROL' },
    { id: 'tracking_control', label: '7. Tracking & Control', icon: Activity, group: 'PIPELINE & CONTROL' },
    { id: 'disturbances', label: '8. Disturbances', icon: CloudRain, group: 'PIPELINE & CONTROL' },
    { id: 'analytics', label: '9. Analytics', icon: BarChart3, group: 'VALIDATION' },
    { id: 'experiments', label: '10. Experiments', icon: FlaskConical, group: 'VALIDATION' },
    { id: 'performance_reports', label: '11. Performance Reports', icon: FileText, group: 'VALIDATION' },
    { id: 'requirements', label: '12. Official Requirements', icon: CheckSquare, group: 'SPECIFICATION' },
    { id: 'architecture', label: '13. Architecture', icon: Network, group: 'SPECIFICATION' },
    { id: 'documentation', label: '14. Documentation', icon: BookOpen, group: 'SPECIFICATION' },
    { id: 'settings', label: '15. Settings', icon: Settings, group: 'SPECIFICATION' },
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#07090e] text-slate-100 font-sans">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-[#0a0d16] border-r border-slate-800 flex flex-col flex-shrink-0 select-none">
        {/* Brand / Title Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-700 flex items-center justify-center shadow-lg shadow-cyan-950">
              <Crosshair className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-mono text-xs font-bold text-white tracking-wider">FSOC TESTBENCH</h1>
              <p className="text-[10px] text-cyan-400 font-mono">Mobile PAT Coarse Alignment</p>
            </div>
          </div>
          <div className="mt-3 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-950/70 border border-blue-800/60 text-[10px] font-mono text-cyan-300">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
            Part 10: Final System Integration
          </div>
        </div>

        {/* 14 Navigation Tabs */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-4">
          {['OPERATIONS', 'PIPELINE & CONTROL', 'VALIDATION', 'SPECIFICATION'].map((grp) => (
            <div key={grp}>
              <div className="px-2.5 py-1 text-[9px] font-mono font-bold tracking-widest text-slate-500 uppercase">
                {grp}
              </div>
              <div className="mt-1 space-y-0.5">
                {navItems
                  .filter((item) => item.group === grp)
                  .map((item) => {
                    const active = activeTab === item.id;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-xs font-mono transition text-left ${
                          active
                            ? 'bg-cyan-950/90 text-cyan-300 border border-cyan-700/60 shadow-sm font-bold'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                        }`}
                      >
                        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-cyan-400' : 'text-slate-500'}`} />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </nav>

        {/* System Health / Telemetry Link Footer in Sidebar */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/80 font-mono text-[11px] space-y-1.5 text-slate-400">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Telemetry Stream:</span>
            <div className="flex items-center gap-1.5">
              {isConnected ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-bold">30 Hz LIVE</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                  <span className="text-amber-400 font-bold">CONNECTING</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">Sensor Clock:</span>
            <span className="text-white">{telemetry?.fps.toFixed(0) || '30'} FPS</span>
          </div>
        </div>
      </aside>

      {/* Main Operational Stage */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#07090e] overflow-hidden">
        {/* Top Operational Header */}
        <header className="h-14 bg-[#0a0d16] border-b border-slate-800 px-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="font-mono">
              <span className="text-xs text-slate-400">SUBSYSTEM / </span>
              <span className="text-sm font-bold text-white uppercase tracking-wider">
                {navItems.find((i) => i.id === activeTab)?.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 font-mono text-xs">
            {/* Simulation Clock Readout */}
            <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded">
              <span className="text-slate-400">Sim T: <strong className="text-white">{telemetry?.simulation_time_s.toFixed(2)}s</strong></span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-400">Frames: <strong className="text-white">{telemetry?.frame_number || 0}</strong></span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-400">Atmosphere: <strong className="text-cyan-400">{telemetry?.atmospheric_condition || 'Clear'}</strong></span>
            </div>

            {/* Quick Transport Buttons */}
            <div className="flex items-center gap-1.5">
              {/* Lost Alarm Indicator / Mute Toggle Button */}
              <button
                onClick={() => {
                  alarmAudio.unlock();
                  alarmAudio.toggleMute();
                }}
                title={
                  isAlarmMuted
                    ? 'Alarm Audio Muted (Click to Unmute)'
                    : isAlarmActive
                    ? isAlarmSuspended
                      ? 'Alarm is active - Click to enable browser sound output'
                      : 'ALARM BEEPING: Beacon lost from satellite camera FOV (Click to Mute)'
                    : 'Alarm Armed: Beeps if beacon leaves camera FOV (Click to Mute)'
                }
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border font-mono text-xs font-bold transition shadow-sm ${
                  isAlarmMuted
                    ? 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                    : isAlarmActive
                    ? 'bg-rose-950 border-rose-500 text-rose-200 animate-pulse shadow-rose-950/60'
                    : 'bg-slate-900/90 border-slate-800 text-cyan-400 hover:border-slate-700'
                }`}
              >
                {isAlarmMuted ? (
                  <VolumeX className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <Volume2 className={`w-3.5 h-3.5 ${isAlarmActive ? 'text-rose-400 animate-bounce' : 'text-cyan-400'}`} />
                )}
                <span>
                  {isAlarmMuted
                    ? 'ALARM: MUTED'
                    : isAlarmActive
                    ? isAlarmSuspended
                      ? 'ALARM: CLICK FOR SOUND'
                      : 'ALARM: BEACON LOST'
                    : 'ALARM: ARMED'}
                </span>
              </button>

              <button
                onClick={() => setIsDemoModalOpen(true)}
                className="px-3 py-1.5 rounded font-bold flex items-center gap-1.5 transition bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-sm"
                title="Launch Automated 14-Phase Demonstration & Benchmark Mode"
              >
                <Zap className="w-3.5 h-3.5 text-cyan-200" />
                DEMO MODE
              </button>
              <button
                onClick={() => toggleSimulation(!telemetry?.is_running)}
                className={`px-3 py-1.5 rounded font-bold flex items-center gap-1.5 transition ${
                  telemetry?.is_running
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {telemetry?.is_running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {telemetry?.is_running ? 'PAUSE' : 'RUN'}
              </button>
              <button
                onClick={resetSimulation}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition"
                title="Reset Simulation State"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Scrollable Page Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'mission_control' && (
            <MissionControlPage
              telemetry={telemetry}
              config={config}
              errorHistory={errorHistory}
              onToggleSim={toggleSimulation}
              onResetSim={resetSimulation}
              onGimbalNudge={sendGimbalControl}
              onGimbalAngles={sendGimbalTargetAngles}
              onSelectShape={handleSelectShape}
            />
          )}

          {activeTab === 'virtual_simulation' && (
            <VirtualSimulationPage
              telemetry={telemetry}
              config={config}
              onUpdateConfig={handleUpdateConfig}
              onToggleSim={toggleSimulation}
              onResetSim={resetSimulation}
              onSelectMotion={handleSelectMotion}
              onSelectShape={handleSelectShape}
            />
          )}

          {activeTab === 'camera_view' && (
            <CameraViewPage
              telemetry={telemetry}
              config={config}
              onGimbalNudge={sendGimbalControl}
              onGimbalAngles={sendGimbalTargetAngles}
              onSelectShape={handleSelectShape}
            />
          )}

          {activeTab === 'video_benchmark' && <VideoBenchmarkPage />}

          {activeTab === 'target_environment' && (
            <TargetEnvironmentPage
              telemetry={telemetry}
              config={config}
              onUpdateConfig={handleUpdateConfig}
              onSelectMotion={handleSelectMotion}
              onSelectShape={handleSelectShape}
              onToggleSim={toggleSimulation}
              onResetSim={resetSimulation}
            />
          )}

          {activeTab === 'detection_ai' && (
            <DetectionAIPage config={config} telemetry={telemetry} onUpdateConfig={handleUpdateConfig} />
          )}

          {activeTab === 'tracking_control' && (
            <TrackingControlPage config={config} telemetry={telemetry} onUpdateConfig={handleUpdateConfig} />
          )}

          {activeTab === 'disturbances' && (
            <DisturbancesPage config={config} telemetry={telemetry} onUpdateConfig={handleUpdateConfig} />
          )}

          {activeTab === 'analytics' && (
            <AnalyticsPage telemetry={telemetry} config={config} errorHistory={errorHistory} />
          )}

          {activeTab === 'experiments' && <ExperimentsPage />}

          {activeTab === 'performance_reports' && (
            <PerformanceReportsPage config={config} />
          )}

          {activeTab === 'requirements' && <RequirementsPage />}

          {activeTab === 'architecture' && <ArchitecturePage />}

          {activeTab === 'documentation' && <DocumentationPage />}

          {activeTab === 'settings' && (
            <SettingsPage config={config} onConfigChange={setConfig} />
          )}
        </div>

        {/* Global Status Footer */}
        <footer className="h-8 bg-[#090c14] border-t border-slate-800/80 px-4 flex items-center justify-between text-[10px] font-mono text-slate-500 flex-shrink-0">
          <div className="flex items-center gap-4">
            <span>3D WORLD: <strong className="text-slate-300">2000 × 2000 × 2000 M</strong></span>
            <span>CAMERA FPA: <strong className="text-slate-300">640 × 480 (4° × 3°)</strong></span>
            <span>BEACON SPOT: <strong className="text-cyan-300">{config?.target.shape || 'Square'} 10×10 PX</strong></span>
            <span>SLEW LIMIT: <strong className="text-emerald-400">≤ 5.0°/S (PAN/TILT)</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>PS4 3D OPTICS COMPLIANT</span>
            </span>
            <span className="text-slate-600">|</span>
            <span>PART 10 & FINAL INTEGRATION COMPLETE</span>
          </div>
        </footer>

        {/* Demo Mode Modal */}
        <DemoModal
          isOpen={isDemoModalOpen}
          onClose={() => setIsDemoModalOpen(false)}
          onNavigateToReports={() => setActiveTab('performance_reports')}
        />
      </main>
    </div>
  );
};

export default App;
