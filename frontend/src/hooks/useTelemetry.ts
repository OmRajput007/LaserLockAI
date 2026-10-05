import {
  useTelemetry as useStoreTelemetry,
  useIsConnected,
  useErrorHistory,
  useSimActions,
  telemetryStore,
} from '../store/telemetryStore';

export * from '../store/telemetryStore';

export function useTelemetry() {
  const telemetry = useStoreTelemetry();
  const isConnected = useIsConnected();
  const errorHistory = useErrorHistory();
  const { sendGimbalControl, sendGimbalTargetAngles, toggleSimulation, resetSimulation } = useSimActions();

  return {
    telemetry,
    isConnected,
    errorHistory,
    sendGimbalControl,
    sendGimbalTargetAngles,
    toggleSimulation,
    resetSimulation,
    telemetryStore,
  };
}
