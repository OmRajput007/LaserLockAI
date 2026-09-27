import { useState, useEffect, useRef, useCallback } from 'react';
import { SimulationTelemetry } from '../types';
import { api } from '../services/api';

export function useTelemetry() {
  const [telemetry, setTelemetry] = useState<SimulationTelemetry | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [errorHistory, setErrorHistory] = useState<{ time: number; error: number; fov: number }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  const connectWebSocket = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data: SimulationTelemetry = JSON.parse(event.data);
          setTelemetry(data);

          if (data.tracking.total_error_px !== null) {
            setErrorHistory((prev) => {
              const updated = [
                ...prev.slice(-49),
                {
                  time: data.simulation_time_s,
                  error: data.tracking.total_error_px ?? 0,
                  fov: data.target.is_in_fov ? 1 : 0,
                },
              ];
              return updated;
            });
          }
        } catch (e) {
          console.error('Error parsing telemetry JSON:', e);
        }
      };

      ws.onerror = () => {
        setIsConnected(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 2000);
      };
    } catch (e) {
      setIsConnected(false);
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, 2000);
    }
  }, []);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connectWebSocket]);

  // Fallback poller if WebSocket is not connecting initially
  useEffect(() => {
    let interval: any;
    if (!isConnected) {
      interval = setInterval(async () => {
        try {
          const snapshot = await api.stepSimulation();
          setTelemetry(snapshot);
        } catch {
          // backend starting up
        }
      }, 300);
    }
    return () => clearInterval(interval);
  }, [isConnected]);

  const sendGimbalControl = (pan_rate: number, tilt_rate: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ pan_rate, tilt_rate }));
    } else {
      api.sendGimbalRate(pan_rate, tilt_rate);
    }
  };

  const sendGimbalTargetAngles = (target_pan: number, target_tilt: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ target_pan, target_tilt }));
    } else {
      api.sendGimbalTargetAngles(target_pan, target_tilt);
    }
  };

  const toggleSimulation = (running: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ is_running: running }));
    } else {
      if (running) api.startSimulation();
      else api.pauseSimulation();
    }
  };

  const resetSimulation = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'reset' }));
    } else {
      api.resetSimulation();
    }
    setErrorHistory([]);
  };

  return {
    telemetry,
    isConnected,
    errorHistory,
    sendGimbalControl,
    sendGimbalTargetAngles,
    toggleSimulation,
    resetSimulation,
  };
}
