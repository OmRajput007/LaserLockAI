/**
 * sceneSettingsStore.ts
 *
 * Centralized store for 3D scene, Mission Control, and Virtual Simulation panel settings.
 * State is persisted to localStorage so parameter values survive tab navigation and reloads.
 */

export interface SceneSettings {
  // Beacon motion
  beaconRevolving: boolean;
  beaconSpeedKmh: number;
  beaconInc: number;
  beaconRaan: number;
  // Earth
  earthSpinEnabled: boolean;
  earthSpinMultiplier: number;
  // Layer visibility
  showAtmosphereShells: boolean;
  showReferenceRings: boolean;
  showSunTerminator: boolean;
  showFootprint: boolean;
  showLayerBar: boolean;
  // Panel collapse / minimize state
  isLegendMinimized: boolean;
  isTrackerMinimized: boolean;
  isScaleMinimized: boolean;
  // Beacon path planner
  showBeaconPathPlanner: boolean;
  isPathPlannerMinimized: boolean;
  pathPlannerPosition: 'top-center' | 'top-left' | 'bottom-center';
  // Path follow / draw mode & path deletion
  pathFollowMode: boolean;
  beaconPathCleared: boolean;
  // Render scale
  scaleMode: 'TRUE_SCALE' | 'READABLE_SCALE';
  // Orbit tuner panel
  showOrbitTuner: boolean;
  // Simulation time warp
  simTimeWarp: number;
  // Auto-revolve
  autoRevolve: boolean;
  selectedPresetId: string;
  // Earth visual style
  earthStyle: 'realistic' | 'procedural';
  // MissionControlPage-specific
  missionViewMode: 'dual' | '3d' | '2d_camera';
  missionShowKinematics: boolean;
  // VirtualSimulationPage-specific
  virtualSimTab: '2d' | '3d' | 'orbital';
  // Auto LOS alignment state
  autoLOS: boolean;
}

const STORAGE_KEY = 'laserlockAI_sceneSettings_v4';

export const sceneSettingsDefaults: SceneSettings = {
  beaconRevolving: true,
  beaconSpeedKmh: 150,
  beaconInc: 28.5,
  beaconRaan: 65.0,
  earthSpinEnabled: true,
  earthSpinMultiplier: 1,
  showAtmosphereShells: true,
  showReferenceRings: false,
  showSunTerminator: true,
  showFootprint: true,
  showLayerBar: true,
  isLegendMinimized: false,
  isTrackerMinimized: false,
  isScaleMinimized: false,
  showBeaconPathPlanner: true,
  isPathPlannerMinimized: false,
  pathPlannerPosition: 'top-center',
  pathFollowMode: true,
  beaconPathCleared: false,
  scaleMode: 'TRUE_SCALE',
  showOrbitTuner: false,
  simTimeWarp: 60,
  autoRevolve: true,
  selectedPresetId: 'leo-550-p1',
  earthStyle: 'realistic',
  missionViewMode: '3d',
  missionShowKinematics: true,
  virtualSimTab: '2d',
  autoLOS: false,
};

type Listener = (settings: SceneSettings) => void;
const listeners: Set<Listener> = new Set();

let cachedSettings: SceneSettings | null = null;

export function loadSceneSettings(): SceneSettings {
  if (cachedSettings) return cachedSettings;
  try {
    const raw = typeof window !== 'undefined'
      ? (localStorage.getItem(STORAGE_KEY) || localStorage.getItem('laserlockAI_sceneSettings_v3'))
      : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SceneSettings>;
      // If migrating from previous version that defaulted to 'dual', set to '3d'
      if (!localStorage.getItem(STORAGE_KEY) && parsed.missionViewMode === 'dual') {
        parsed.missionViewMode = '3d';
      }
      cachedSettings = { ...sceneSettingsDefaults, ...parsed };
      return cachedSettings;
    }
  } catch (e) {
    console.warn('Failed to load sceneSettings from localStorage:', e);
  }
  cachedSettings = { ...sceneSettingsDefaults };
  return cachedSettings;
}

export function saveSceneSettings(patch: Partial<SceneSettings>): SceneSettings {
  const current = loadSceneSettings();
  const next: SceneSettings = { ...current, ...patch };
  cachedSettings = next;
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch (e) {
    console.warn('Failed to save sceneSettings to localStorage:', e);
  }
  // Notify listeners
  listeners.forEach((listener) => {
    try {
      listener(next);
    } catch (err) {
      console.error('Error in sceneSettings listener:', err);
    }
  });
  return next;
}

export function subscribeSceneSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Cross-tab / cross-window real-time synchronization
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue) as Partial<SceneSettings>;
        cachedSettings = { ...sceneSettingsDefaults, ...parsed };
        listeners.forEach((listener) => {
          try {
            listener(cachedSettings!);
          } catch (err) {
            console.error('Error in sceneSettings storage listener:', err);
          }
        });
      } catch (err) {
        console.warn('Failed to parse storage update for sceneSettings:', err);
      }
    }
  });
}

