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
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  PanelLeftClose,
  PanelLeftOpen,
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

const NAV_GROUPS = [
  'OPERATIONS',
  'PIPELINE & CONTROL',
  'VALIDATION',
  'SPECIFICATION',
] as const;

type NavGroup = (typeof NAV_GROUPS)[number];

interface NavItem {
  id: NavTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group?: NavGroup;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'mission_control', label: 'Mission Control', icon: Radar, group: 'OPERATIONS' },
  { id: 'virtual_simulation', label: 'Virtual Simulation', icon: Compass, group: 'OPERATIONS' },
  { id: 'camera_view', label: 'Camera View', icon: Video, group: 'OPERATIONS' },
  { id: 'video_benchmark', label: 'Video Benchmark', icon: Film, group: 'OPERATIONS' },
  { id: 'target_environment', label: 'Target & Environment', icon: Crosshair, group: 'OPERATIONS' },
  { id: 'detection_ai', label: 'Detection & AI', icon: Cpu, group: 'PIPELINE & CONTROL' },
  { id: 'tracking_control', label: 'Tracking & Control', icon: Activity, group: 'PIPELINE & CONTROL' },
  { id: 'disturbances', label: 'Disturbances', icon: CloudRain, group: 'PIPELINE & CONTROL' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, group: 'VALIDATION' },
  { id: 'experiments', label: 'Experiments', icon: FlaskConical, group: 'VALIDATION' },
  { id: 'performance_reports', label: 'Performance Reports', icon: FileText, group: 'VALIDATION' },
  { id: 'requirements', label: 'Official Requirements', icon: CheckSquare, group: 'SPECIFICATION' },
  { id: 'architecture', label: 'Architecture', icon: Network, group: 'SPECIFICATION' },
  { id: 'documentation', label: 'Documentation', icon: BookOpen, group: 'SPECIFICATION' },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTabId>('mission_control');
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [isDemoModalOpen, setIsDemoModalOpen] = useState<boolean>(false);

  // Left Navigation Sidebar Minimize / Expand state (persisted in localStorage)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('laserlockAI_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('laserlockAI_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  // Keyboard shortcut Ctrl+B or Cmd+B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Top-level dropdown group collapse/expand state (OPERATIONS expanded initially)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    OPERATIONS: true,
    'PIPELINE & CONTROL': false,
    VALIDATION: false,
    SPECIFICATION: false,
  });

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [group]: !prev[group],
    }));
  };

  // Ensure parent dropdown remains expanded when active tab changes so active item is visible
  useEffect(() => {
    const activeItem = NAV_ITEMS.find((item) => item.id === activeTab);
    if (activeItem && activeItem.group && !expandedGroups[activeItem.group]) {
      setExpandedGroups((prev) => ({
        ...prev,
        [activeItem.group!]: true,
      }));
    }
  }, [activeTab]);

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

  const navItems = NAV_ITEMS;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#06080A] text-[#E8EAED] antialiased" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* ── Sidebar ── */}
      <aside
        className={`${isSidebarCollapsed ? 'w-14' : 'w-56'} flex flex-col flex-shrink-0 bg-[#0A0D10] border-r border-[#1F2429] transition-all duration-200 ease-in-out select-none`}
      >
        {/* Brand */}
        <div className={`flex items-center border-b border-[#1F2429] ${isSidebarCollapsed ? 'justify-center p-3' : 'justify-between px-4 py-3'}`}>
          {!isSidebarCollapsed && (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-6 h-6 rounded flex items-center justify-center bg-[#1E2023] border border-[#2A2D31] shrink-0">
                <Crosshair className="w-3.5 h-3.5 text-[#8B949E]" />
              </div>
              <div className="min-w-0">
                <h1 className="text-[11px] font-semibold text-[#E8EAED] tracking-wide truncate leading-none">LaserLockAI</h1>
                <p className="text-[10px] text-[#525A63] truncate leading-none mt-0.5">Optical Tracking</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            className="p-1 rounded text-[#525A63] hover:text-[#8B949E] hover:bg-[#1F2429] transition cursor-pointer shrink-0"
            title={isSidebarCollapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
          >
            {isSidebarCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2">
          {isSidebarCollapsed ? (
            /* Icon-only mode */
            <div className="space-y-0.5 px-1.5">
              {NAV_GROUPS.map((grp, idx) => {
                const groupItems = NAV_ITEMS.filter(i => i.group === grp);
                return (
                  <div key={grp}>
                    {idx > 0 && <div className="h-px bg-[#1A1C1F] my-2 mx-1" />}
                    {groupItems.map(item => {
                      const active = activeTab === item.id;
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setActiveTab(item.id)}
                          title={item.label}
                          aria-label={item.label}
                          className={`w-full flex items-center justify-center p-2 rounded transition cursor-pointer ${
                            active
                              ? 'bg-[#1E2023] text-[#E8EAED]'
                              : 'text-[#525A63] hover:text-[#8B949E] hover:bg-[#141618]'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              <div className="h-px bg-[#1A1C1F] my-2 mx-1" />
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                title="Settings"
                aria-label="Settings"
                className={`w-full flex items-center justify-center p-2 rounded transition cursor-pointer ${
                  activeTab === 'settings'
                    ? 'bg-[#1E2023] text-[#E8EAED]'
                    : 'text-[#525A63] hover:text-[#8B949E] hover:bg-[#141618]'
                }`}
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            /* Expanded mode */
            <div className="px-2 space-y-3">
              {NAV_GROUPS.map((grp) => {
                const isExpanded = !!expandedGroups[grp];
                const groupItems = NAV_ITEMS.filter(i => i.group === grp);
                const hasActive = groupItems.some(i => i.id === activeTab);

                return (
                  <div key={grp}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(grp)}
                      aria-expanded={isExpanded}
                      className={`w-full flex items-center justify-between px-2 py-1 rounded text-left cursor-pointer transition ${
                        hasActive ? 'text-[#8B949E]' : 'text-[#525A63] hover:text-[#6B7280]'
                      }`}
                    >
                      <span className="text-[10px] font-semibold tracking-widest uppercase">{grp}</span>
                      {isExpanded
                        ? <ChevronDown className="w-3 h-3 flex-shrink-0" />
                        : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
                    </button>

                    {isExpanded && (
                      <div className="mt-0.5 space-y-0.5">
                        {groupItems.map(item => {
                          const active = activeTab === item.id;
                          const Icon = item.icon;
                          return (
                            <button
                              key={item.id}
                              onClick={() => { setActiveTab(item.id); setExpandedGroups(p => ({ ...p, [grp]: true })); }}
                              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left cursor-pointer transition text-xs ${
                                active
                                  ? 'bg-[#1E2023] text-[#E8EAED] font-medium'
                                  : 'text-[#6B7280] hover:text-[#8B949E] hover:bg-[#141618]'
                              }`}
                            >
                              <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-[#8B949E]' : 'text-[#525A63]'}`} />
                              <span className="truncate">{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Settings */}
              <div className="h-px bg-[#1A1C1F]" />
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left cursor-pointer transition text-xs ${
                  activeTab === 'settings'
                    ? 'bg-[#1E2023] text-[#E8EAED] font-medium'
                    : 'text-[#6B7280] hover:text-[#8B949E] hover:bg-[#141618]'
                }`}
              >
                <Settings className={`w-3.5 h-3.5 flex-shrink-0 ${activeTab === 'settings' ? 'text-[#8B949E]' : 'text-[#525A63]'}`} />
                <span className="truncate">Settings</span>
              </button>
            </div>
          )}
        </nav>

        {/* Connection status */}
        <div className={`border-t border-[#1F2429] ${isSidebarCollapsed ? 'flex justify-center py-3' : 'px-4 py-2.5 flex items-center justify-between'}`}>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isConnected ? 'bg-[#4CAF7D]' : 'bg-[#D6A84F] animate-pulse'}`} />
            {!isSidebarCollapsed && (
              <span className="text-[10px] text-[#525A63]">
                {isConnected ? `Live · ${telemetry?.fps.toFixed(0) || 30} Hz` : 'Connecting…'}
              </span>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#06080A]">

        {/* Header */}
        <header className="h-11 bg-[#0A0D10] border-b border-[#1F2429] px-4 flex items-center justify-between flex-shrink-0">
          {/* Left: page title */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleSidebar}
              className="p-1 rounded text-[#525A63] hover:text-[#8B949E] hover:bg-[#1F2429] transition cursor-pointer"
              title={isSidebarCollapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
            >
              {isSidebarCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
            </button>
            <span className="text-[13px] font-medium text-[#E8EAED]">
              {navItems.find(i => i.id === activeTab)?.label ?? 'Settings'}
            </span>
          </div>

          {/* Right: sim controls + status */}
          <div className="flex items-center gap-2 text-xs">
            {/* Sim clock — minimal */}
            <div className="hidden sm:flex items-center gap-2 text-[11px] text-[#525A63] num-mono border-r border-[#1F2429] pr-3 mr-1">
              <span>t = <span className="text-[#8B949E]">{telemetry?.simulation_time_s.toFixed(1)}s</span></span>
              <span className="text-[#1E2023]">·</span>
              <span>f = <span className="text-[#8B949E]">{telemetry?.frame_number ?? 0}</span></span>
            </div>

            {/* Alarm */}
            <button
              onClick={() => { alarmAudio.unlock(); alarmAudio.toggleMute(); }}
              title={isAlarmMuted ? 'Unmute alarm' : isAlarmActive ? 'Beacon lost — click to mute' : 'Alarm armed'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] border transition cursor-pointer ${
                isAlarmActive && !isAlarmMuted
                  ? 'bg-[#2A1515] border-[#D95C5C]/40 text-[#D95C5C]'
                  : 'bg-transparent border-[#1E2023] text-[#525A63] hover:text-[#8B949E] hover:border-[#252A2E]'
              }`}
            >
              {isAlarmMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              <span>{isAlarmMuted ? 'Muted' : isAlarmActive ? 'Lost' : 'Armed'}</span>
            </button>

            {/* Demo */}
            <button
              onClick={() => setIsDemoModalOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] border border-[#1E2023] text-[#525A63] hover:text-[#8B949E] hover:border-[#252A2E] transition cursor-pointer"
              title="Run demo"
            >
              <Zap className="w-3 h-3" />
              <span>Demo</span>
            </button>

            {/* Run / Pause */}
            <button
              onClick={() => toggleSimulation(!telemetry?.is_running)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border transition cursor-pointer ${
                telemetry?.is_running
                  ? 'bg-[#D6A84F]/10 border-[#D6A84F]/30 text-[#D6A84F] hover:bg-[#D6A84F]/15'
                  : 'bg-[#4CAF7D]/10 border-[#4CAF7D]/30 text-[#4CAF7D] hover:bg-[#4CAF7D]/15'
              }`}
            >
              {telemetry?.is_running ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              <span>{telemetry?.is_running ? 'Pause' : 'Run'}</span>
            </button>

            {/* Reset */}
            <button
              onClick={resetSimulation}
              className="p-1.5 rounded border border-[#1E2023] text-[#525A63] hover:text-[#8B949E] hover:border-[#252A2E] transition cursor-pointer"
              title="Reset simulation"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        </header>

        {/* Page body */}
        <div className="flex-1 overflow-y-auto p-4">
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
          {activeTab === 'performance_reports' && <PerformanceReportsPage config={config} />}
          {activeTab === 'requirements' && <RequirementsPage />}
          {activeTab === 'architecture' && <ArchitecturePage />}
          {activeTab === 'documentation' && <DocumentationPage />}
          {activeTab === 'settings' && <SettingsPage config={config} onConfigChange={setConfig} />}
        </div>

        {/* Status bar — single row, minimal */}
        <div className="h-6 bg-[#0A0D10] border-t border-[#1F2429] px-4 flex items-center justify-between text-[10px] text-[#525A63] flex-shrink-0 num-mono">
          <div className="flex items-center gap-4">
            <span>World <span className="text-[#6B7280]">2000³ m</span></span>
            <span>Sensor <span className="text-[#6B7280]">640×480 · 4°×3°</span></span>
            <span>Spot <span className="text-[#6B7280]">{config?.target.shape ?? 'Square'} 10×10 px</span></span>
            <span>Slew <span className="text-[#6B7280]">≤ 5.0°/s</span></span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4CAF7D]" />
              <span className="text-[#4CAF7D]">Spec OK</span>
            </span>
            <span>LaserLockAI</span>
          </div>
        </div>
      </main>

      <DemoModal
        isOpen={isDemoModalOpen}
        onClose={() => setIsDemoModalOpen(false)}
        onNavigateToReports={() => setActiveTab('performance_reports')}
      />
    </div>
  );
};

export default App;
