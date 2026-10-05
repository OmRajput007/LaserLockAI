import { useSyncExternalStore } from 'react';
import { SimulationTelemetry } from '../types';
import { api } from '../services/api';

export interface TelemetryState {
  telemetry: SimulationTelemetry | null;
  isConnected: boolean;
  errorHistory: { time: number; error: number; fov: number }[];
}

type Listener = () => void;

const EMPTY_ERROR_HISTORY: { time: number; error: number; fov: number }[] = [];

class TelemetryStore {
  private state: TelemetryState = {
    telemetry: null,
    isConnected: false,
    errorHistory: EMPTY_ERROR_HISTORY,
  };

  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private reconnectTimeout: any = null;
  private fallbackInterval: any = null;
  private connectionCount = 0;

  constructor() {
    // Lazy connection initialized on first subscriber or explicit init
    if (typeof window !== 'undefined') {
      this.initConnection();
    }
  }

  public getState = (): TelemetryState => this.state;
  public getTelemetry = (): SimulationTelemetry | null => this.state.telemetry;
  public getIsConnected = (): boolean => this.state.isConnected;
  public getErrorHistory = (): { time: number; error: number; fov: number }[] => this.state.errorHistory;
  public getSimTime = (): number => this.state.telemetry?.simulation_time_s ?? 0;
  public getSimFrame = (): number => this.state.telemetry?.frame_number ?? 0;
  public getSimFps = (): number => this.state.telemetry?.fps ?? 30;
  public getSimRunning = (): boolean => this.state.telemetry?.is_running ?? false;

  // Stable static fallbacks for getServerSnapshot
  public getNull = (): null => null;
  public getFalse = (): boolean => false;
  public getZero = (): number => 0;
  public getThirty = (): number => 30;
  public getEmptyHistory = (): { time: number; error: number; fov: number }[] => EMPTY_ERROR_HISTORY;

  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    this.connectionCount++;
    return () => {
      this.listeners.delete(listener);
      this.connectionCount--;
    };
  };

  private notify() {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.error('Error in telemetry listener:', e);
      }
    });
  }

  public initConnection() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.connectWebSocket();
    this.startFallbackPoller();
  }

  private connectWebSocket() {
    if (typeof window === 'undefined') return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;

    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        if (!this.state.isConnected) {
          this.state = { ...this.state, isConnected: true };
          this.notify();
        }
      };

      ws.onmessage = (event) => {
        try {
          const data: SimulationTelemetry = JSON.parse(event.data);
          let newHistory = this.state.errorHistory;
          if (data.tracking && data.tracking.total_error_px !== null && data.tracking.total_error_px !== undefined) {
            newHistory = [
              ...this.state.errorHistory.slice(-49),
              {
                time: data.simulation_time_s,
                error: data.tracking.total_error_px ?? 0,
                fov: data.target.is_in_fov ? 1 : 0,
              },
            ];
          }

          this.state = {
            ...this.state,
            telemetry: data,
            errorHistory: newHistory,
            isConnected: true,
          };
          this.notify();
        } catch (e) {
          console.error('Error parsing telemetry JSON:', e);
        }
      };

      ws.onerror = () => {
        if (this.state.isConnected) {
          this.state = { ...this.state, isConnected: false };
          this.notify();
        }
      };

      ws.onclose = () => {
        if (this.state.isConnected) {
          this.state = { ...this.state, isConnected: false };
          this.notify();
        }
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => this.connectWebSocket(), 2000);
      };
    } catch (e) {
      if (this.state.isConnected) {
        this.state = { ...this.state, isConnected: false };
        this.notify();
      }
      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = setTimeout(() => this.connectWebSocket(), 2000);
    }
  }

  private startFallbackPoller() {
    if (this.fallbackInterval) return;
    this.fallbackInterval = setInterval(async () => {
      if (!this.state.isConnected) {
        try {
          const snapshot = await api.stepSimulation();
          this.state = { ...this.state, telemetry: snapshot };
          this.notify();
        } catch {
          // Backend starting up
        }
      }
    }, 300);
  }

  public sendGimbalControl = (pan_rate: number, tilt_rate: number) => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ pan_rate, tilt_rate }));
    } else {
      api.sendGimbalRate(pan_rate, tilt_rate);
    }
  };

  public sendGimbalTargetAngles = (target_pan: number, target_tilt: number) => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ target_pan, target_tilt }));
    } else {
      api.sendGimbalTargetAngles(target_pan, target_tilt);
    }
  };

  public toggleSimulation = (running: boolean) => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ is_running: running }));
    } else {
      if (running) api.startSimulation();
      else api.pauseSimulation();
    }
  };

  public resetSimulation = () => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'reset' }));
    } else {
      api.resetSimulation();
    }
    this.state = {
      ...this.state,
      errorHistory: EMPTY_ERROR_HISTORY,
    };
    this.notify();
  };
}

export const telemetryStore = new TelemetryStore();

/**
 * Standard hook to subscribe to full telemetry object
 */
export function useTelemetry(): SimulationTelemetry | null {
  return useSyncExternalStore(
    telemetryStore.subscribe,
    telemetryStore.getTelemetry,
    telemetryStore.getNull
  );
}

/**
 * Granular hook: only re-renders when connection status changes (not at 30 Hz)
 */
export function useIsConnected(): boolean {
  return useSyncExternalStore(
    telemetryStore.subscribe,
    telemetryStore.getIsConnected,
    telemetryStore.getFalse
  );
}

/**
 * Granular hook: only re-renders when error history updates
 */
export function useErrorHistory(): { time: number; error: number; fov: number }[] {
  return useSyncExternalStore(
    telemetryStore.subscribe,
    telemetryStore.getErrorHistory,
    telemetryStore.getEmptyHistory
  );
}

/**
 * Granular hook: returns simulation time in seconds (primitive number)
 */
export function useSimTime(): number {
  return useSyncExternalStore(
    telemetryStore.subscribe,
    telemetryStore.getSimTime,
    telemetryStore.getZero
  );
}

/**
 * Granular hook: returns simulation frame number (primitive number)
 */
export function useSimFrame(): number {
  return useSyncExternalStore(
    telemetryStore.subscribe,
    telemetryStore.getSimFrame,
    telemetryStore.getZero
  );
}

/**
 * Granular hook: returns simulation FPS (primitive number)
 */
export function useSimFps(): number {
  return useSyncExternalStore(
    telemetryStore.subscribe,
    telemetryStore.getSimFps,
    telemetryStore.getThirty
  );
}

/**
 * Granular hook: returns simulation running boolean (primitive boolean)
 */
export function useSimRunning(): boolean {
  return useSyncExternalStore(
    telemetryStore.subscribe,
    telemetryStore.getSimRunning,
    telemetryStore.getFalse
  );
}

/**
 * Returns stable actions object that never causes re-renders
 */
export function useSimActions() {
  return {
    sendGimbalControl: telemetryStore.sendGimbalControl,
    sendGimbalTargetAngles: telemetryStore.sendGimbalTargetAngles,
    toggleSimulation: telemetryStore.toggleSimulation,
    resetSimulation: telemetryStore.resetSimulation,
  };
}

const noopSubscribe = () => () => {};

/**
 * Active Telemetry Hook: Only re-renders the component when `isActive` is true.
 * When `isActive` is false (e.g. tab hidden via display: none), updates are frozen,
 * preventing unneeded virtual DOM recalculations across hidden pages.
 *
 * NOTE: Both telemetry and errorHistory use strictly stable getSnapshot references,
 * preventing infinite synchronous re-renders and browser hangs (RESULT_CODE_HUNG).
 */
export function useActiveTelemetry(isActive: boolean): {
  telemetry: SimulationTelemetry | null;
  errorHistory: { time: number; error: number; fov: number }[];
} {
  const telemetry = useSyncExternalStore(
    isActive ? telemetryStore.subscribe : noopSubscribe,
    telemetryStore.getTelemetry,
    telemetryStore.getNull
  );
  const errorHistory = useSyncExternalStore(
    isActive ? telemetryStore.subscribe : noopSubscribe,
    telemetryStore.getErrorHistory,
    telemetryStore.getEmptyHistory
  );

  return { telemetry, errorHistory };
}
