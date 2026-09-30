import {
  SystemConfig,
  SimulationTelemetry,
  AnalyticsSummaryResponse,
  OfficialRequirementStatus,
  TelemetryPoint,
  ExperimentRecord,
  AlgorithmComparisonResponse,
  PerformanceReport,
  PerformanceReportSummary,
  DemoStatusResponse,
  TechnicalReportResponse,
  UserManualResponse,
  ValidationSuiteReport,
} from '../types';

const API_BASE = '/api';

export const api = {
  async getStatus(): Promise<any> {
    const res = await fetch(`${API_BASE}/status`);
    if (!res.ok) throw new Error(`Status check failed: ${res.statusText}`);
    return res.json();
  },

  async getConfig(): Promise<SystemConfig> {
    const res = await fetch(`${API_BASE}/config`);
    if (!res.ok) throw new Error(`Failed to load config: ${res.statusText}`);
    return res.json();
  },

  async updateConfig(config: SystemConfig): Promise<SystemConfig> {
    const res = await fetch(`${API_BASE}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error(`Failed to save config: ${res.statusText}`);
    return res.json();
  },

  async resetConfig(): Promise<SystemConfig> {
    const res = await fetch(`${API_BASE}/config/reset`, { method: 'POST' });
    if (!res.ok) throw new Error(`Failed to reset config: ${res.statusText}`);
    return res.json();
  },

  async startSimulation(): Promise<void> {
    await fetch(`${API_BASE}/simulation/start`, { method: 'POST' });
  },

  async pauseSimulation(): Promise<void> {
    await fetch(`${API_BASE}/simulation/pause`, { method: 'POST' });
  },

  async resetSimulation(): Promise<void> {
    await fetch(`${API_BASE}/simulation/reset`, { method: 'POST' });
  },

  async stepSimulation(): Promise<SimulationTelemetry> {
    const res = await fetch(`${API_BASE}/simulation/step`, { method: 'POST' });
    if (!res.ok) throw new Error(`Failed to step simulation: ${res.statusText}`);
    return res.json();
  },

  async sendGimbalRate(pan_rate_deg_s: number, tilt_rate_deg_s: number): Promise<void> {
    await fetch(`${API_BASE}/simulation/gimbal/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pan_rate_deg_s, tilt_rate_deg_s }),
    });
  },

  async sendGimbalTargetAngles(pan_deg: number, tilt_deg: number): Promise<void> {
    await fetch(`${API_BASE}/simulation/gimbal/angles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pan_deg, tilt_deg }),
    });
  },

  async setTargetShape(shape: 'Square' | 'Circle' | 'Gaussian'): Promise<void> {
    await fetch(`${API_BASE}/simulation/target/shape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shape }),
    });
  },

  async setTargetMotion(trajectory_type: string, speed_pixels_per_s?: number): Promise<void> {
    await fetch(`${API_BASE}/simulation/target/motion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trajectory_type, speed_pixels_per_s }),
    });
  },

  async setCustomPath(waypoints: [number, number][], speed_pixels_per_s?: number): Promise<void> {
    await fetch(`${API_BASE}/simulation/target/custom_path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waypoints, speed_pixels_per_s }),
    });
  },

  async setTargetPosition(x: number, y: number, z: number = 1000.0): Promise<void> {
    await fetch(`${API_BASE}/simulation/target/position`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y, z }),
    });
  },

  async setBeaconSpeed(speed_kmh: number): Promise<void> {
    await fetch(`${API_BASE}/simulation/target/speed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed_kmh, speed_pixels_per_s: speed_kmh }),
    });
  },


  async setControlMode(mode: 'Open Loop' | 'PID Coarse Pointing' | 'State Feedback'): Promise<void> {
    await fetch(`${API_BASE}/simulation/control/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
  },

  async updatePIDParameters(params: {
    kp_pan?: number;
    ki_pan?: number;
    kd_pan?: number;
    kp_tilt?: number;
    ki_tilt?: number;
    kd_tilt?: number;
  }): Promise<void> {
    await fetch(`${API_BASE}/simulation/control/pid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  },

  async setTrackingFilter(algorithm: 'None' | 'Kalman Filter' | 'Alpha-Beta' | 'Particle Filter'): Promise<void> {
    await fetch(`${API_BASE}/simulation/tracking/filter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ algorithm }),
    });
  },

  async triggerSearchPattern(
    action: 'start' | 'stop' | 'reset',
    search_pattern?: 'Raster Search' | 'Sector Search' | 'Spiral Search'
  ): Promise<void> {
    await fetch(`${API_BASE}/simulation/tracking/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, search_pattern }),
    });
  },

  async getTrackingTelemetry(): Promise<any> {
    const res = await fetch(`${API_BASE}/simulation/tracking/telemetry`);
    if (!res.ok) throw new Error(`Failed to fetch tracking telemetry: ${res.statusText}`);
    return res.json();
  },

  async applyDisturbancePreset(preset: string): Promise<any> {
    const res = await fetch(`${API_BASE}/simulation/disturbance/preset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset }),
    });
    if (!res.ok) throw new Error(`Failed to apply preset: ${res.statusText}`);
    return res.json();
  },

  async updateDisturbanceConfig(params: Record<string, any>): Promise<any> {
    const res = await fetch(`${API_BASE}/simulation/disturbance/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`Failed to update disturbance config: ${res.statusText}`);
    return res.json();
  },

  async triggerOcclusion(duration_s?: number): Promise<any> {
    const res = await fetch(`${API_BASE}/simulation/disturbance/occlusion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration_s }),
    });
    if (!res.ok) throw new Error(`Failed to trigger occlusion: ${res.statusText}`);
    return res.json();
  },

  async getDisturbanceTelemetry(): Promise<any> {
    const res = await fetch(`${API_BASE}/simulation/disturbance/telemetry`);
    if (!res.ok) throw new Error(`Failed to fetch disturbance telemetry: ${res.statusText}`);
    return res.json();
  },

  // =========================================================================
  // Part 7: Video Benchmark Suite API Methods
  // =========================================================================

  async uploadBenchmarkVideo(file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/benchmark/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to upload video');
    }
    return res.json();
  },

  async generateSyntheticBenchmark(scenario: string, duration_s: number = 10.0): Promise<any> {
    const res = await fetch(`${API_BASE}/benchmark/synthetic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario, duration_s }),
    });
    if (!res.ok) throw new Error(`Failed to generate synthetic benchmark: ${res.statusText}`);
    return res.json();
  },

  async uploadGroundTruth(file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/benchmark/groundtruth`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error(`Failed to upload ground truth: ${res.statusText}`);
    return res.json();
  },

  async controlBenchmark(action: string, frame_idx?: number, speed?: number): Promise<any> {
    const res = await fetch(`${API_BASE}/benchmark/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, frame_idx, speed }),
    });
    if (!res.ok) throw new Error(`Failed to apply benchmark control: ${res.statusText}`);
    return res.json();
  },

  async setBenchmarkMethod(method: string): Promise<any> {
    const res = await fetch(`${API_BASE}/benchmark/method`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method }),
    });
    if (!res.ok) throw new Error(`Failed to set benchmark method: ${res.statusText}`);
    return res.json();
  },

  async processBenchmarkVideo(max_frames?: number): Promise<any> {
    const res = await fetch(`${API_BASE}/benchmark/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_frames }),
    });
    if (!res.ok) throw new Error(`Failed to process benchmark video: ${res.statusText}`);
    return res.json();
  },

  async cancelBenchmarkProcessing(): Promise<any> {
    const res = await fetch(`${API_BASE}/benchmark/cancel`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`Failed to cancel benchmark processing: ${res.statusText}`);
    return res.json();
  },

  async getBenchmarkState(): Promise<any> {
    const res = await fetch(`${API_BASE}/benchmark/state`);
    if (!res.ok) throw new Error(`Failed to get benchmark state: ${res.statusText}`);
    return res.json();
  },

  async getBenchmarkFrameTelemetry(): Promise<any> {
    const res = await fetch(`${API_BASE}/benchmark/frame/telemetry`);
    if (!res.ok) throw new Error(`Failed to get benchmark frame telemetry: ${res.statusText}`);
    return res.json();
  },

  async getBenchmarkResults(): Promise<any> {
    const res = await fetch(`${API_BASE}/benchmark/results`);
    if (!res.ok) throw new Error(`Failed to get benchmark results: ${res.statusText}`);
    return res.json();
  },

  // Part 8: Real-Time Analytics & Requirements Endpoints
  async getAnalyticsSummary(): Promise<AnalyticsSummaryResponse> {
    const res = await fetch(`${API_BASE}/analytics/summary`);
    if (!res.ok) throw new Error(`Failed to get analytics summary: ${res.statusText}`);
    return res.json();
  },

  async getOfficialRequirements(): Promise<OfficialRequirementStatus[]> {
    const res = await fetch(`${API_BASE}/analytics/requirements`);
    if (!res.ok) throw new Error(`Failed to get official requirements: ${res.statusText}`);
    return res.json();
  },

  async getChartSeries(window?: number): Promise<TelemetryPoint[]> {
    const url = window ? `${API_BASE}/analytics/charts?window=${window}` : `${API_BASE}/analytics/charts`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to get chart series: ${res.statusText}`);
    return res.json();
  },

  async resetAnalytics(): Promise<any> {
    const res = await fetch(`${API_BASE}/analytics/reset`, { method: 'POST' });
    if (!res.ok) throw new Error(`Failed to reset analytics: ${res.statusText}`);
    return res.json();
  },

  // Part 8: Experiment & Comparison Endpoints
  async runCustomExperiment(params: any): Promise<ExperimentRecord> {
    const res = await fetch(`${API_BASE}/experiments/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`Failed to run custom experiment: ${res.statusText}`);
    return res.json();
  },

  async listExperiments(): Promise<ExperimentRecord[]> {
    const res = await fetch(`${API_BASE}/experiments/list`);
    if (!res.ok) throw new Error(`Failed to list experiments: ${res.statusText}`);
    return res.json();
  },

  async getExperimentDetails(expId: string): Promise<ExperimentRecord> {
    const res = await fetch(`${API_BASE}/experiments/${expId}`);
    if (!res.ok) throw new Error(`Failed to get experiment details: ${res.statusText}`);
    return res.json();
  },

  async deleteExperiment(expId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/experiments/${expId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Failed to delete experiment: ${res.statusText}`);
    return res.json();
  },

  async compareAlgorithms(scenarioName?: string, durationS?: number): Promise<AlgorithmComparisonResponse> {
    const res = await fetch(`${API_BASE}/experiments/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario_name: scenarioName, duration_s: durationS }),
    });
    if (!res.ok) throw new Error(`Failed to run algorithm comparison: ${res.statusText}`);
    return res.json();
  },

  // =========================================================================
  // Part 9: Automatic Reporting & Technical Documentation
  // =========================================================================

  async getLatestPerformanceReport(): Promise<PerformanceReport> {
    const res = await fetch(`${API_BASE}/reports/latest`);
    if (!res.ok) throw new Error(`Failed to fetch latest report: ${res.statusText}`);
    return res.json();
  },

  async listPerformanceReports(): Promise<PerformanceReportSummary[]> {
    const res = await fetch(`${API_BASE}/reports/list`);
    if (!res.ok) throw new Error(`Failed to list performance reports: ${res.statusText}`);
    return res.json();
  },

  async getPerformanceReportById(reportId: string): Promise<PerformanceReport> {
    const res = await fetch(`${API_BASE}/reports/${reportId}`);
    if (!res.ok) throw new Error(`Failed to fetch report ${reportId}: ${res.statusText}`);
    return res.json();
  },

  async generateReportNow(): Promise<PerformanceReport> {
    const res = await fetch(`${API_BASE}/reports/generate`, { method: 'POST' });
    if (!res.ok) throw new Error(`Failed to generate report: ${res.statusText}`);
    return res.json();
  },

  getExportHtmlUrl(reportId?: string): string {
    return reportId ? `${API_BASE}/reports/export/html?report_id=${encodeURIComponent(reportId)}` : `${API_BASE}/reports/export/html`;
  },

  getExportCsvUrl(reportId?: string): string {
    return reportId ? `${API_BASE}/reports/export/csv?report_id=${encodeURIComponent(reportId)}` : `${API_BASE}/reports/export/csv`;
  },

  getExportJsonUrl(reportId?: string): string {
    return reportId ? `${API_BASE}/reports/export/json?report_id=${encodeURIComponent(reportId)}` : `${API_BASE}/reports/export/json`;
  },

  async getTechnicalReport(): Promise<TechnicalReportResponse> {
    const res = await fetch(`${API_BASE}/reports/technical`);
    if (!res.ok) throw new Error(`Failed to fetch technical report: ${res.statusText}`);
    return res.json();
  },

  async getUserManual(): Promise<UserManualResponse> {
    const res = await fetch(`${API_BASE}/reports/user-manual`);
    if (!res.ok) throw new Error(`Failed to fetch user manual: ${res.statusText}`);
    return res.json();
  },

  // =========================================================================
  // Part 9: Automated Demonstration Mode Orchestration
  // =========================================================================

  async startSimulationDemo(stepDurationS: number = 12.0): Promise<any> {
    const res = await fetch(`${API_BASE}/demo/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step_duration_s: stepDurationS }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to start simulation demo: ${res.statusText}`);
    }
    return res.json();
  },

  async startVideoDemo(stepDurationS: number = 4.0): Promise<any> {
    const res = await fetch(`${API_BASE}/demo/video/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step_duration_s: stepDurationS }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to start video demo: ${res.statusText}`);
    }
    return res.json();
  },

  async getDemoStatus(): Promise<DemoStatusResponse> {
    const res = await fetch(`${API_BASE}/demo/status`);
    if (!res.ok) throw new Error(`Failed to fetch demo status: ${res.statusText}`);
    return res.json();
  },

  async stopDemo(): Promise<any> {
    const res = await fetch(`${API_BASE}/demo/stop`, { method: 'POST' });
    if (!res.ok) throw new Error(`Failed to stop demo: ${res.statusText}`);
    return res.json();
  },

  // Orbital Scenario (Part 2)
  async getOrbitalConfig(): Promise<any> {
    const res = await fetch(`${API_BASE}/orbital/config`);
    if (!res.ok) throw new Error(`Failed to get orbital config: ${res.statusText}`);
    return res.json();
  },

  async updateOrbitalConfig(config: any): Promise<{ status: string; maneuver_note: string; telemetry: any }> {
    const res = await fetch(`${API_BASE}/orbital/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to update orbital config: ${res.statusText}`);
    }
    return res.json();
  },

  async resetOrbital(): Promise<{ status: string; telemetry: any }> {
    const res = await fetch(`${API_BASE}/orbital/reset`, { method: 'POST' });
    if (!res.ok) throw new Error(`Failed to reset orbital: ${res.statusText}`);
    return res.json();
  },

  async getOrbitalTelemetry(): Promise<any> {
    const res = await fetch(`${API_BASE}/orbital/telemetry`);
    if (!res.ok) throw new Error(`Failed to fetch orbital telemetry: ${res.statusText}`);
    return res.json();
  },

  async setTimeWarp(time_warp: number): Promise<{ status: string; time_warp: number }> {
    const res = await fetch(`${API_BASE}/orbital/time-warp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time_warp }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to set time warp: ${res.statusText}`);
    }
    return res.json();
  },

  async runOrbitalValidation(durationS: number = 120.0): Promise<ValidationSuiteReport> {
    const res = await fetch(`${API_BASE}/experiments/orbital-validation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration_s: durationS }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Orbital validation suite execution failed: ${res.statusText}`);
    }
    return res.json();
  },

  async getOrbitalValidationReport(): Promise<ValidationSuiteReport> {
    const res = await fetch(`${API_BASE}/experiments/orbital-validation`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to fetch orbital validation report: ${res.statusText}`);
    }
    return res.json();
  },
};



