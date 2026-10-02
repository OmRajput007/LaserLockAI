/**
 * useSceneSettings.ts
 *
 * Custom hook that wraps the sceneSettingsStore.
 * Returns the current settings, a typed setter, and a `bindSetting` helper
 * that handles both direct values and functional updaters (e.g., (prev) => !prev).
 * Subscribes to changes so components stay synchronized.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  SceneSettings,
  loadSceneSettings,
  saveSceneSettings,
  subscribeSceneSettings,
} from '../stores/sceneSettingsStore';

export interface UseSceneSettings {
  settings: SceneSettings;
  set: (patch: Partial<SceneSettings>) => void;
  bindSetting: <K extends keyof SceneSettings>(
    key: K
  ) => (valueOrFn: SceneSettings[K] | ((prev: SceneSettings[K]) => SceneSettings[K])) => void;
}

export function useSceneSettings(): UseSceneSettings {
  const [settings, setSettings] = useState<SceneSettings>(() => loadSceneSettings());

  useEffect(() => {
    const unsub = subscribeSceneSettings((newSettings) => {
      setSettings(newSettings);
    });
    return unsub;
  }, []);

  const set = useCallback((patch: Partial<SceneSettings>) => {
    saveSceneSettings(patch);
  }, []);

  const bindSetting = useCallback(
    <K extends keyof SceneSettings>(key: K) => {
      return (valueOrFn: SceneSettings[K] | ((prev: SceneSettings[K]) => SceneSettings[K])) => {
        const current = loadSceneSettings();
        const currentVal = current[key];
        const nextVal =
          typeof valueOrFn === 'function'
            ? (valueOrFn as (p: SceneSettings[K]) => SceneSettings[K])(currentVal)
            : valueOrFn;
        saveSceneSettings({ [key]: nextVal });
      };
    },
    []
  );

  return { settings, set, bindSetting };
}
