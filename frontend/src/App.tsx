import React, { useState, useEffect, useCallback } from 'react';
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
import {
  telemetryStore,
  useTelemetry,
  useIsConnected,
  useSimFps,
  useSimTime,
  useSimFrame,
  useSimRunning,
  useSimActions,
  useActiveTelemetry,
} from './store/telemetryStore';
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
import { Scene3DViewport } from './simulation/Scene3DViewport';

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

/**
 * Leaf component for sidebar connection indicator.
 * Only re-renders when connection status or FPS changes, never re-rendering the sidebar buttons.
 */
const SidebarConnectionStatus: React.FC<{ isSidebarCollapsed: boolean }> = React.memo(({ isSidebarCollapsed }) => {
  const isConnected = useIsConnected();
  const fps = useSimFps();

  return (
    <div className={`border-t border-[#33362F] ${isSidebarCollapsed ? 'flex justify-center py-3' : 'px-4 py-2.5 flex items-center justify-between'}`}>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isConnected ? 'bg-[#FF5F40] shadow-[0_0_6px_#FF5F40]' : 'bg-[#5E625A]'}`} />
        {!isSidebarCollapsed && (
          <span className="text-[10px] text-[#9CA195] font-mono">
            {isConnected ? `LIVE · ${fps.toFixed(0)} HZ` : 'STANDBY'}
          </span>
        )}
      </div>
    </div>
  );
});

/**
 * Leaf component for header simulation clock.
 * Isolates high-frequency 30 Hz time/frame updates to this tiny text node.
 */
const HeaderSimClock: React.FC = React.memo(() => {
  const time = useSimTime();
  const frame = useSimFrame();

  return (
    <div className="hidden sm:flex items-center gap-2 text-[11px] text-[#9CA195] num-mono border-r border-[#33362F] pr-3 mr-1">
      <span>t = <span className="text-[#F0FFEA]">{time.toFixed(1)}s</span></span>
      <span className="text-[#33362F]">·</span>
      <span>f = <span className="text-[#F0FFEA]">{frame}</span></span>
    </div>
  );
});

/**
 * Leaf component for header simulation controls (Run/Pause toggle & Reset).
 * Only re-renders when running state changes.
 */
const HeaderSimControls: React.FC<{ onResetSim: () => void }> = React.memo(({ onResetSim }) => {
  const isRunning = useSimRunning();
  const { toggleSimulation } = useSimActions();

  return (
    <>
      <button
        onClick={() => toggleSimulation(!isRunning)}
        className={`flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold border transition cursor-pointer ${
          isRunning
            ? 'bg-[#262824] border-[#FF5F40] text-[#FF5F40] hover:bg-[rgba(255,95,64,0.14)]'
            : 'bg-[#FF5F40] border-[#FF5F40] text-[#0A0A0A] hover:bg-[#FF7459]'
        }`}
      >
        {isRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
        <span>{isRunning ? 'Pause' : 'Run'}</span>
      </button>

      <button
        onClick={onResetSim}
        className="p-1.5 rounded border border-[#33362F] bg-[#262824] text-[#9CA195] hover:text-[#F0FFEA] hover:border-[#FF5F40] transition cursor-pointer"
        title="Reset simulation"
      >
        <RotateCcw className="w-3 h-3" />
      </button>
    </>
  );
});

/**
 * Leaf component for header alarm toggle.
 * Only re-renders when alarm state transitions (Lost / Armed / Muted), completely isolating App.tsx.
 */
const HeaderAlarmButton: React.FC = React.memo(() => {
  const [isAlarmActive, setIsAlarmActive] = useState<boolean>(alarmAudio.getIsAlarmRunning());
  const [isAlarmMuted, setIsAlarmMuted] = useState<boolean>(alarmAudio.getIsMuted());

  useEffect(() => {
    return alarmAudio.subscribe((active, muted) => {
      setIsAlarmActive(active);
      setIsAlarmMuted(muted);
    });
  }, []);

  return (
    <button
      onClick={() => {
        alarmAudio.unlock();
        alarmAudio.toggleMute();
      }}
      title={isAlarmMuted ? 'Unmute alarm' : isAlarmActive ? 'Beacon lost — click to mute' : 'Alarm armed'}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] border transition cursor-pointer ${
        isAlarmActive && !isAlarmMuted
          ? 'bg-[rgba(255,95,64,0.2)] border-[#FF5F40] text-[#FF5F40]'
          : 'bg-[#262824] border-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] hover:border-[#FF5F40]'
      }`}
    >
      {isAlarmMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
      <span>{isAlarmMuted ? 'Muted' : isAlarmActive ? 'Lost' : 'Armed'}</span>
    </button>
  );
});

/**
 * Standalone Popout 3D Viewport.
 */
const Popout3DViewport: React.FC<{ config: SystemConfig | null; onResetSim: () => void }> = React.memo(({ config, onResetSim }) => {
  const isConnected = useIsConnected();
  const fps = useSimFps();
  const time = useSimTime();
  const frame = useSimFrame();
  const isRunning = useSimRunning();
  const { toggleSimulation } = useSimActions();
  const telemetry = useTelemetry();

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-[#000000] text-[#F0FFEA] antialiased"
      style={{ fontFamily: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace" }}
    >
      <header className="h-10 bg-[#1B1D1A] border-b border-[#33362F] px-4 flex items-center justify-between flex-shrink-0 select-none">
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[#FF5F40] shadow-[0_0_8px_rgba(255,95,64,0.8)]' : 'bg-[#9CA195] animate-pulse'}`} />
          <span className="text-xs font-semibold tracking-wider text-[#F0FFEA] uppercase">
            LaserLockAI — 3D LEO Kinematics (Standalone Window)
          </span>
          <span className="text-[11px] text-[#9CA195] font-mono">
            {isConnected ? `LIVE · ${fps.toFixed(0)} FPS` : 'CONNECTING…'}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-[#9CA195] num-mono border-r border-[#33362F] pr-3 mr-1">
            <span>t = <span className="text-[#F0FFEA]">{time.toFixed(1)}s</span></span>
            <span className="text-[#33362F]">·</span>
            <span>f = <span className="text-[#F0FFEA]">{frame}</span></span>
          </div>

          <button
            onClick={() => toggleSimulation(!isRunning)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold border transition cursor-pointer ${
              isRunning
                ? 'bg-[#262824] border-[#FF5F40] text-[#FF5F40] hover:bg-[rgba(255,95,64,0.14)]'
                : 'bg-[#FF5F40] border-[#FF5F40] text-[#0A0A0A] hover:bg-[#FF7459]'
            }`}
          >
            {isRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span>{isRunning ? 'Pause' : 'Run'}</span>
          </button>

          <button
            onClick={onResetSim}
            className="p-1 rounded border border-[#33362F] bg-[#262824] text-[#9CA195] hover:text-[#F0FFEA] hover:border-[#FF5F40] transition cursor-pointer"
            title="Reset simulation"
          >
            <RotateCcw className="w-3 h-3" />
          </button>

          <button
            onClick={() => {
              window.location.href = window.location.origin + window.location.pathname;
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border border-[#33362F] bg-[#262824] text-[#F0FFEA] hover:border-[#FF5F40] hover:text-[#FF5F40] transition cursor-pointer ml-1"
            title="Open full Mission Control Dashboard in this tab"
          >
            <span>Main Dashboard</span>
          </button>
        </div>
      </header>

      <main className="flex-1 w-full h-full p-2 overflow-hidden bg-[#000000]">
        <Scene3DViewport
          target={telemetry?.target ?? null}
          targets={telemetry?.targets ?? []}
          camera={telemetry?.camera ?? null}
          disturbance={telemetry?.disturbance ?? null}
          worldWidth={config?.motion.screen_width ?? 2000}
          worldHeight={config?.motion.screen_height ?? 2000}
        />
      </main>
    </div>
  );
});

/**
 * Leaf component for Mission Control tab.
 * Subscribes to active telemetry ONLY when isActive is true.
 * When hidden (isActive = false), updates are completely frozen, preventing 30 Hz virtual DOM recalculations.
 */
const MissionControlTabWrapper: React.FC<{
  isActive: boolean;
  config: SystemConfig | null;
  onResetSim: () => void;
  onSelectShape: (shape: 'Square' | 'Circle' | 'Gaussian') => void;
  onUpdateConfig?: (updater: (prev: SystemConfig) => SystemConfig) => void;
}> = React.memo(({ isActive, config, onResetSim, onSelectShape, onUpdateConfig }) => {
  const { telemetry, errorHistory } = useActiveTelemetry(isActive);
  const { sendGimbalControl, sendGimbalTargetAngles, toggleSimulation } = useSimActions();

  return (
    <div style={{ display: isActive ? 'block' : 'none' }}>
      <MissionControlPage
        telemetry={telemetry}
        config={config}
        errorHistory={errorHistory}
        onToggleSim={toggleSimulation}
        onResetSim={onResetSim}
        onGimbalNudge={sendGimbalControl}
        onGimbalAngles={sendGimbalTargetAngles}
        onSelectShape={onSelectShape}
        onUpdateConfig={onUpdateConfig}
      />
    </div>
  );
});

/**
 * Leaf component for rendering the active page.
 * Only subscribes to high-frequency telemetry when the active tab is telemetry-dependent.
 */
const ActiveTabRenderer: React.FC<{
  activeTab: NavTabId;
  config: SystemConfig | null;
  setConfig: React.Dispatch<React.SetStateAction<SystemConfig | null>>;
  onResetSim: () => void;
  onSelectShape: (shape: 'Square' | 'Circle' | 'Gaussian') => void;
  onSelectMotion: (trajectory_type: string) => void;
  onUpdateConfig: (updater: (prev: SystemConfig) => SystemConfig) => Promise<void>;
}> = React.memo(({
  activeTab,
  config,
  setConfig,
  onResetSim,
  onSelectShape,
  onSelectMotion,
  onUpdateConfig,
}) => {
  const isTelemetryTab = [
    'virtual_simulation',
    'camera_view',
    'target_environment',
    'detection_ai',
    'tracking_control',
    'disturbances',
    'analytics',
  ].includes(activeTab);

  const { telemetry, errorHistory } = useActiveTelemetry(isTelemetryTab);
  const { sendGimbalControl, sendGimbalTargetAngles, toggleSimulation } = useSimActions();

  if (activeTab === 'virtual_simulation') {
    return (
      <VirtualSimulationPage
        telemetry={telemetry}
        config={config}
        onUpdateConfig={onUpdateConfig}
        onToggleSim={toggleSimulation}
        onResetSim={onResetSim}
        onSelectMotion={onSelectMotion}
        onSelectShape={onSelectShape}
      />
    );
  }
  if (activeTab === 'camera_view') {
    return (
      <CameraViewPage
        telemetry={telemetry}
        config={config}
        onGimbalNudge={sendGimbalControl}
        onGimbalAngles={sendGimbalTargetAngles}
        onSelectShape={onSelectShape}
      />
    );
  }
  if (activeTab === 'video_benchmark') return <VideoBenchmarkPage />;
  if (activeTab === 'target_environment') {
    return (
      <TargetEnvironmentPage
        telemetry={telemetry}
        config={config}
        onUpdateConfig={onUpdateConfig}
        onSelectMotion={onSelectMotion}
        onSelectShape={onSelectShape}
        onToggleSim={toggleSimulation}
        onResetSim={onResetSim}
      />
    );
  }
  if (activeTab === 'detection_ai') {
    return <DetectionAIPage config={config} telemetry={telemetry} onUpdateConfig={onUpdateConfig} />;
  }
  if (activeTab === 'tracking_control') {
    return <TrackingControlPage config={config} telemetry={telemetry} onUpdateConfig={onUpdateConfig} />;
  }
  if (activeTab === 'disturbances') {
    return <DisturbancesPage config={config} telemetry={telemetry} onUpdateConfig={onUpdateConfig} />;
  }
  if (activeTab === 'analytics') {
    return <AnalyticsPage telemetry={telemetry} config={config} errorHistory={errorHistory} />;
  }
  if (activeTab === 'experiments') return <ExperimentsPage />;
  if (activeTab === 'performance_reports') return <PerformanceReportsPage config={config} />;
  if (activeTab === 'requirements') return <RequirementsPage />;
  if (activeTab === 'architecture') return <ArchitecturePage />;
  if (activeTab === 'documentation') return <DocumentationPage />;
  if (activeTab === 'settings') return <SettingsPage config={config} onConfigChange={setConfig} />;

  return null;
});

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

  const { resetSimulation } = useSimActions();

  const handleResetSim = useCallback(() => {
    resetSimulation();
    window.dispatchEvent(new CustomEvent('fsoc:reset-sim'));
  }, [resetSimulation]);


  // Monitor satellite camera FOV and trigger alarm when beacon is lost (Optimization 4.A: zero App re-renders at 30 Hz)
  useEffect(() => {
    const checkAlarm = () => {
      const pov = satellitePovSync.getData();
      if (pov.isLockedInFov) {
        alarmAudio.stopLostAlarm();
        return;
      }
      if (pov.isLostFromFov) {
        alarmAudio.startLostAlarm();
        return;
      }

      const telemetry = telemetryStore.getState().telemetry;
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

      if (!isVisibleInFov) {
        alarmAudio.startLostAlarm();
      } else {
        alarmAudio.stopLostAlarm();
      }
    };

    const unsubTelemetry = telemetryStore.subscribe(checkAlarm);
    const unsubPov = satellitePovSync.subscribe((data) => {
      if (data.isLockedInFov) {
        alarmAudio.stopLostAlarm();
      } else if (data.isLostFromFov) {
        alarmAudio.startLostAlarm();
      }
    });

    return () => {
      unsubTelemetry();
      unsubPov();
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

  const isPopout3D = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('popout') === '3d';

  if (isPopout3D) {
    return <Popout3DViewport config={config} onResetSim={handleResetSim} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#000000] text-[#F0FFEA] antialiased" style={{ fontFamily: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace" }}>

      {/* ── Sidebar ── */}
      <aside
        className={`${isSidebarCollapsed ? 'w-14' : 'w-56'} flex flex-col flex-shrink-0 bg-[#1B1D1A] border-r border-[#33362F] transition-all duration-200 ease-in-out select-none`}
      >
        {/* Brand */}
        <div className={`flex items-center border-b border-[#33362F] ${isSidebarCollapsed ? 'justify-center p-3' : 'justify-between px-4 py-3'}`}>
          {!isSidebarCollapsed && (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-6 h-6 rounded flex items-center justify-center bg-[#262824] border border-[#33362F] shrink-0">
                <Crosshair className="w-3.5 h-3.5 text-[#FF5F40]" />
              </div>
              <div className="min-w-0">
                <h1 className="text-[11px] font-semibold text-[#F0FFEA] tracking-wide truncate leading-none uppercase">LaserLockAI</h1>
                <p className="text-[10px] text-[#9CA195] truncate leading-none mt-0.5">Optical Tracking</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            className="p-1 rounded text-[#9CA195] hover:text-[#FF5F40] hover:bg-[#262824] transition cursor-pointer shrink-0"
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
                    {idx > 0 && <div className="h-px bg-[#33362F] my-2 mx-1" />}
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
                              ? 'bg-[rgba(255,95,64,0.14)] text-[#FF5F40] border-l-2 border-[#FF5F40]'
                              : 'text-[#9CA195] hover:text-[#F0FFEA] hover:bg-[#262824]'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              <div className="h-px bg-[#33362F] my-2 mx-1" />
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                title="Settings"
                aria-label="Settings"
                className={`w-full flex items-center justify-center p-2 rounded transition cursor-pointer ${
                  activeTab === 'settings'
                    ? 'bg-[rgba(255,95,64,0.14)] text-[#FF5F40] border-l-2 border-[#FF5F40]'
                    : 'text-[#9CA195] hover:text-[#F0FFEA] hover:bg-[#262824]'
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
                        hasActive ? 'text-[#FF5F40]' : 'text-[#9CA195] hover:text-[#F0FFEA]'
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
                                  ? 'bg-[rgba(255,95,64,0.14)] text-[#FF5F40] font-medium border-l-2 border-[#FF5F40]'
                                  : 'text-[#9CA195] hover:text-[#F0FFEA] hover:bg-[#262824]'
                              }`}
                            >
                              <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-[#FF5F40]' : 'text-[#9CA195]'}`} />
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
              <div className="h-px bg-[#33362F]" />
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left cursor-pointer transition text-xs ${
                  activeTab === 'settings'
                    ? 'bg-[rgba(255,95,64,0.14)] text-[#FF5F40] font-medium border-l-2 border-[#FF5F40]'
                    : 'text-[#9CA195] hover:text-[#F0FFEA] hover:bg-[#262824]'
                }`}
              >
                <Settings className={`w-3.5 h-3.5 flex-shrink-0 ${activeTab === 'settings' ? 'text-[#FF5F40]' : 'text-[#9CA195]'}`} />
                <span className="truncate">Settings</span>
              </button>
            </div>
          )}
        </nav>

        {/* Connection status (Optimization 4.A: isolated leaf component) */}
        <SidebarConnectionStatus isSidebarCollapsed={isSidebarCollapsed} />
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#000000]">

        {/* Header */}
        <header className="h-11 bg-[#1B1D1A] border-b border-[#33362F] px-4 flex items-center justify-between flex-shrink-0">
          {/* Left: page title with thin vertical orange accent rule */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleSidebar}
              className="p-1 rounded text-[#9CA195] hover:text-[#FF5F40] hover:bg-[#262824] transition cursor-pointer"
              title={isSidebarCollapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
            >
              {isSidebarCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
            </button>
            <div className="flex items-center gap-2">
              <span className="w-0.5 h-3.5 bg-[#FF5F40] rounded-full inline-block" />
              <span className="text-[13px] font-semibold text-[#F0FFEA] tracking-wide uppercase">
                {navItems.find(i => i.id === activeTab)?.label ?? 'Settings'}
              </span>
            </div>
          </div>

          {/* Right: sim controls + status (Optimization 4.A: isolated leaf components) */}
          <div className="flex items-center gap-2 text-xs">
            {/* Sim clock — isolated leaf node */}
            <HeaderSimClock />

            {/* Alarm — isolated leaf node */}
            <HeaderAlarmButton />

            {/* Demo */}
            <button
              onClick={() => setIsDemoModalOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border border-[#33362F] bg-[#262824] text-[#F0FFEA] hover:text-[#FF5F40] hover:border-[#FF5F40] transition cursor-pointer"
              title="Run demo"
            >
              <Zap className="w-3 h-3 text-[#FF5F40]" />
              <span>Demo</span>
            </button>

            {/* Run / Pause / Reset controls — isolated leaf node */}
            <HeaderSimControls onResetSim={handleResetSim} />
          </div>
        </header>

        {/* Page body */}
        <div className="flex-1 overflow-y-auto p-4 bg-[#000000]">
          {/* Mission Control: Preserved mounted with frozen updates when hidden (Optimization 4.A) */}
          <MissionControlTabWrapper
            isActive={activeTab === 'mission_control'}
            config={config}
            onResetSim={handleResetSim}
            onSelectShape={handleSelectShape}
            onUpdateConfig={handleUpdateConfig}
          />

          {/* Active Tab Renderer: Only subscribes to high-frequency telemetry when active tab needs it */}
          <ActiveTabRenderer
            activeTab={activeTab}
            config={config}
            setConfig={setConfig}
            onResetSim={handleResetSim}
            onSelectShape={handleSelectShape}
            onSelectMotion={handleSelectMotion}
            onUpdateConfig={handleUpdateConfig}
          />
        </div>

        {/* Status bar — single row, minimal */}
        <div className="h-6 bg-[#1B1D1A] border-t border-[#33362F] px-4 flex items-center justify-between text-[10px] text-[#9CA195] flex-shrink-0 num-mono">
          <div className="flex items-center gap-4">
            <span>World <span className="text-[#F0FFEA]">2000³ m</span></span>
            <span>Sensor <span className="text-[#F0FFEA]">640×480 · 4°×3°</span></span>
            <span>Spot <span className="text-[#F0FFEA]">{config?.target.shape ?? 'Square'} 10×10 px</span></span>
            <span>Slew <span className="text-[#F0FFEA]">≤ 5.0°/s</span></span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#FF5F40]" />
              <span className="text-[#F0FFEA]">✓ Spec OK</span>
            </span>
            <span className="text-[#5E625A]">LaserLockAI</span>
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
