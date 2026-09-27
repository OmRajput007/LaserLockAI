export interface CameraConfig {
  sensor_type: string;
  resolution_width: number;
  resolution_height: number;
  fov_horizontal_deg: number;
  fov_vertical_deg: number;
  update_rate_hz: number;
  initial_pan_deg: number;
  initial_tilt_deg: number;
  max_pan_speed_deg_s: number;
  max_tilt_speed_deg_s: number;
  pan_min_limit_deg: number;
  pan_max_limit_deg: number;
  tilt_min_limit_deg: number;
  tilt_max_limit_deg: number;
  focal_length_mm: number;
  position_x: number;
  position_y: number;
  position_z: number;
  color_mode?: 'Monochrome' | 'Colour';
}

export interface TargetConfig {
  target_id: number;
  target_type: string;
  target_count: number;
  shape: 'Square' | 'Circle' | 'Gaussian';
  size_pixels: number;
  initial_location_mode: 'Random' | 'Manual' | 'Center';
  intensity: number;
  default_depth_z: number;
  background_level?: number;
  noise_sigma?: number;
  flicker_enabled?: boolean;
  flicker_frequency_hz?: number;
  flicker_depth?: number;
}

export interface MotionConfig {
  trajectory_type:
    | 'Straight Line'
    | 'Circular'
    | 'Figure of 8'
    | 'Random'
    | 'Spiral'
    | 'Sinusoidal'
    | 'Waypoint'
    | 'User-defined';
  speed_pixels_per_s: number;
  screen_width: number;
  screen_height: number;
  world_depth_z: number;
}

export interface DetectionConfig {
  method?: 'Classical CV' | 'AI Detector' | 'CV + Kalman' | 'AI + Kalman';
  algorithm: 'OpenCV Classical' | 'Threshold Centroid' | 'Blob Detector' | 'AI-CNN' | 'Bypass';
  intensity_threshold: number;
  use_otsu?: boolean;
  min_area?: number;
  max_area?: number;
  morph_kernel_size?: number;
  gaussian_blur_kernel?: number;
  subpixel_accuracy: boolean;
  annotate_frame?: boolean;
  // Part 4 AI Settings
  ai_model_name?: string;
  ai_confidence_threshold?: number;
  ai_input_resolution?: string;
  ai_inference_device?: 'CPU' | 'GPU' | 'CUDA' | 'DirectML';
  ai_detection_frequency_hz?: number;
  model_weights_path?: string;
  // Part 4 Target Identification
  target_id_mode?: 'Multi-Criteria' | 'Highest Confidence' | 'Brightest Spot';
  reject_false_bright_objects?: boolean;
  max_spatial_jump_px?: number;
  min_track_persistence_frames?: number;
  expected_spot_size_px?: number;
  // Part 4 Kalman Filter
  kalman_process_noise?: number;
  kalman_measurement_noise?: number;
  kalman_max_coast_frames?: number;
  // Synthetic Clutter Injection
  inject_false_bright_objects?: boolean;
  false_bright_object_count?: number;
}

export interface DetectionCandidateTelemetry {
  candidate_id: number;
  bbox: [number, number, number, number];
  centroid_x: number;
  centroid_y: number;
  area: number;
  brightness: number;
  confidence: number;
  snr_db: number;
  is_primary?: boolean;
  classification?: string;
  spatial_distance_to_track?: number | null;
  temporal_consistency_score?: number;
}

export interface DetectionTelemetry {
  beacon_detected: boolean;
  detected_centroid_x: number | null;
  detected_centroid_y: number | null;
  bbox: [number, number, number, number] | null;
  area: number | null;
  brightness: number | null;
  confidence: number;
  pixel_error_x: number | null;
  pixel_error_y: number | null;
  total_pixel_error: number | null;
  angular_error_x_deg: number | null;
  angular_error_y_deg: number | null;
  snr_db: number | null;
  processing_time_ms: number;
  candidate_count: number;
  candidates: DetectionCandidateTelemetry[];
  flicker_intensity?: number;
  // Part 4 AI and Multi-Method Telemetry
  active_method?: string;
  ai_model_loaded?: boolean;
  ai_model_status?: string;
  kalman_active?: boolean;
  kalman_predicted_x?: number | null;
  kalman_predicted_y?: number | null;
  kalman_velocity_x?: number | null;
  kalman_velocity_y?: number | null;
  target_classification?: string;
  raw_candidate_count?: number;
  rejected_clutter_count?: number;
}

export interface DetectionComparisonItem {
  method: string;
  detected: boolean;
  centroid: [number, number] | null;
  bbox: [number, number, number, number] | null;
  confidence: number;
  latency_ms: number;
  status: string;
  is_primary?: boolean;
}

export interface DetectionComparisonResponse {
  classical_cv: DetectionComparisonItem;
  ai_detector: DetectionComparisonItem;
  timestamp: number;
}

export interface TrackingConfig {
  algorithm: 'None' | 'Kalman Filter' | 'Alpha-Beta' | 'Particle Filter';
  update_interval_hz: number;
  process_noise_q?: number;
  measurement_noise_r?: number;
  max_coast_frames?: number;
  search_pattern?: 'Raster Search' | 'Sector Search' | 'Spiral Search';
  search_pan_range_deg?: number;
  search_tilt_range_deg?: number;
  search_slew_speed_deg_s?: number;
  lock_angular_error_threshold_deg?: number;
  lock_pixel_error_threshold_px?: number;
  lock_confidence_threshold?: number;
  lock_consecutive_frames?: number;
  acquisition_timeout_s?: number;
  reacquisition_timeout_s?: number;
}

export interface ControlConfig {
  mode: 'Open Loop' | 'PID Coarse Pointing' | 'State Feedback';
  kp_pan: number;
  ki_pan: number;
  kd_pan: number;
  kp_tilt: number;
  ki_tilt: number;
  kd_tilt: number;
  max_pan_rate_deg_s?: number;
  max_tilt_rate_deg_s?: number;
  integral_windup_limit?: number;
  derivative_filter_alpha?: number;
  deadband_px?: number;
}

export interface DisturbanceConfig {
  noise_type: 'None' | 'Salt & Pepper' | 'Gaussian' | 'Poisson' | 'Multi-Noise';
  gaussian_noise_enabled?: boolean;
  salt_pepper_enabled?: boolean;
  poisson_noise_enabled?: boolean;
  noise_std_dev: number;
  salt_pepper_ratio?: number;
  camera_jitter_enabled?: boolean;
  camera_jitter_max_px: number;
  camera_jitter_frequency_hz?: number;
  atmospheric_condition: 'Clear' | 'Haze' | 'Fog' | 'Rain' | 'Low Light';
  atmospheric_extinction_coeff?: number;
  fog_density?: number;
  rain_rate_mm_hr?: number;
  ambient_light_factor?: number;
  platform_motion_enabled?: boolean;
  platform_motion_type: 'Linear' | 'None' | 'Sinusoidal' | 'Circular' | 'Random' | 'Spiral' | 'Figure of 8';
  platform_motion_max_px: number;
  platform_motion_frequency_hz?: number;
  motion_blur_enabled?: boolean;
  motion_blur_kernel_size?: number;
  beacon_flicker_enabled?: boolean;
  beacon_flicker_frequency_hz?: number;
  beacon_flicker_depth?: number;
  temporary_occlusion_enabled?: boolean;
  occlusion_duration_s?: number;
  occlusion_period_s?: number;
  sudden_camera_movement_enabled?: boolean;
  sudden_movement_max_px?: number;
  brightness_fluctuation_enabled?: boolean;
  brightness_fluctuation_amplitude?: number;
  snr_reduction_db?: number;
  preset_scenario?:
    | 'Custom'
    | 'Normal'
    | 'High Noise'
    | 'High Jitter'
    | 'Haze'
    | 'Fog'
    | 'Rain'
    | 'Low Light'
    | 'Fast Motion'
    | 'Combined Disturbance';
}

export interface DisturbanceTelemetry {
  preset_scenario: string;
  jitter_offset_x_px: number;
  jitter_offset_y_px: number;
  platform_offset_x_px: number;
  platform_offset_y_px: number;
  atmospheric_condition: string;
  atmospheric_transmittance: number;
  is_occluded: boolean;
  occlusion_remaining_s: number;
  applied_noise_types: string[];
  effective_snr_db?: number | null;
  motion_blur_applied: boolean;
}

export interface PerformanceConfig {
  max_acquisition_time_s: number;
  max_tracking_error_pixels: number;
  max_target_loss_percent: number;
  max_reacquisition_time_s: number;
  min_processing_speed_fps: number;
}

export interface SystemConfig {
  project_title: string;
  version: string;
  camera: CameraConfig;
  target: TargetConfig;
  motion: MotionConfig;
  detection: DetectionConfig;
  tracking: TrackingConfig;
  control: ControlConfig;
  disturbance: DisturbanceConfig;
  performance: PerformanceConfig;
}

export interface TargetState {
  target_id: number;
  world_x: number;
  world_y: number;
  world_z: number;
  velocity_x: number;
  velocity_y: number;
  velocity_z: number;
  acceleration_x: number;
  acceleration_y: number;
  acceleration_z: number;
  pixel_x: number | null;
  pixel_y: number | null;
  azimuth_cam_deg: number | null;
  elevation_cam_deg: number | null;
  range_z_cam: number | null;
  is_in_fov: boolean;
  shape: 'Square' | 'Circle' | 'Gaussian';
  size_pixels: number;
  intensity: number;
  trajectory_trail: [number, number, number][];
}

export interface CameraState {
  pan_deg: number;
  tilt_deg: number;
  target_pan_deg: number;
  target_tilt_deg: number;
  pan_rate_deg_s: number;
  tilt_rate_deg_s: number;
  max_pan_speed_deg_s: number;
  max_tilt_speed_deg_s: number;
  pan_min_limit_deg: number;
  pan_max_limit_deg: number;
  tilt_min_limit_deg: number;
  tilt_max_limit_deg: number;
  position_x: number;
  position_y: number;
  position_z: number;
  world_center_x: number;
  world_center_y: number;
  world_center_z: number;
  fov_horizontal_deg: number;
  fov_vertical_deg: number;
  resolution_width: number;
  resolution_height: number;
  update_rate_hz: number;
  frustum_corners_world: [number, number, number][];
}

export interface TrackingTelemetry {
  state?: 'SEARCHING' | 'ACQUIRING' | 'TRACKING' | 'LOCKED' | 'LOST' | 'REACQUIRING' | string;
  mode: string;
  measured_x?: number | null;
  measured_y?: number | null;
  predicted_x?: number | null;
  predicted_y?: number | null;
  filtered_x?: number | null;
  filtered_y?: number | null;
  velocity_x?: number | null;
  velocity_y?: number | null;
  error_x_px: number | null;
  error_y_px: number | null;
  total_error_px: number | null;
  error_azimuth_deg: number | null;
  error_elevation_deg: number | null;
  acquisition_time_s: number | null;
  reacquisition_time_s?: number | null;
  target_lost_count: number;
  lost_frames?: number;
  loss_duration_s?: number;
  target_loss_percent?: number;
  is_locked: boolean;
  consecutive_locked_frames?: number;
  pan_pid_p?: number;
  pan_pid_i?: number;
  pan_pid_d?: number;
  pan_cmd_deg_s?: number;
  tilt_pid_p?: number;
  tilt_pid_i?: number;
  tilt_pid_d?: number;
  tilt_cmd_deg_s?: number;
  search_pattern_name?: string;
}

export interface SimulationTelemetry {
  timestamp: number;
  simulation_time_s: number;
  frame_number: number;
  is_running: boolean;
  fps: number;
  target: TargetState;
  targets: TargetState[];
  camera: CameraState;
  tracking: TrackingTelemetry;
  detection: DetectionTelemetry;
  disturbance?: DisturbanceTelemetry;
  atmospheric_condition: string;
}

export interface VideoMetadata {
  filename: string;
  filepath: string;
  width: number;
  height: number;
  fps: number;
  total_frames: number;
  duration_s: number;
  codec: string;
  file_size_bytes: number;
  has_ground_truth: boolean;
}

export interface GroundTruthPoint {
  frame: number;
  timestamp_s: number;
  x: number;
  y: number;
  radius_px?: number;
}

export interface FrameBenchmarkLog {
  frame_number: number;
  timestamp_s: number;
  detected_centroid_x?: number | null;
  detected_centroid_y?: number | null;
  confidence: number;
  detection_status: 'DETECTED' | 'LOST' | string;
  tracking_state: string;
  processing_time_ms: number;
  instantaneous_fps: number;
  ground_truth_x?: number | null;
  ground_truth_y?: number | null;
  centroid_error_px?: number | null;
  angular_error_deg?: number | null;
  is_locked: boolean;
}

export interface BenchmarkResults {
  video_name: string;
  total_frames: number;
  processed_frames: number;
  detection_method: string;
  input_fps: number;
  average_processing_fps: number;
  min_processing_fps: number;
  max_processing_fps: number;
  average_processing_time_ms: number;
  detection_rate_percent: number;
  target_lost_count: number;
  target_loss_duration_s: number;
  target_loss_percent: number;
  acquisition_time_s?: number | null;
  reacquisition_time_s?: number | null;
  lock_retention_percent: number;
  ground_truth_available: boolean;
  average_centroid_error_px?: number | null;
  max_centroid_error_px?: number | null;
  rmse_px?: number | null;
  status_message: string;
}

export interface VideoPlaybackState {
  is_playing: boolean;
  current_frame_idx: number;
  total_frames: number;
  playback_speed: number;
  is_processing_batch: boolean;
  batch_progress_percent: number;
  active_method: string;
}

// Part 8: Analytics & Official Requirements Interfaces
export interface TelemetryPoint {
  time_s: number;
  tracking_error_px?: number | null;
  centroid_error_px?: number | null;
  angular_error_deg?: number | null;
  centroid_x?: number | null;
  centroid_y?: number | null;
  pan_deg: number;
  tilt_deg: number;
  fps: number;
  processing_time_ms: number;
  confidence: number;
  snr_db?: number | null;
  is_locked: boolean;
  is_detected: boolean;
  target_state: string;
}

export interface OfficialRequirementStatus {
  parameter: string;
  required: string;
  actual: string;
  status: 'PASS' | 'FAIL' | 'PENDING';
  unit: string;
  actual_value?: number | null;
  required_threshold: number;
  margin?: number | null;
}

export interface PerformanceMetrics {
  simulation_duration_s: number;
  video_duration_s?: number | null;
  total_frames: number;
  average_fps: number;
  min_fps: number;
  max_fps: number;
  average_processing_time_ms: number;
  max_processing_time_ms: number;
  acquisition_time_s?: number | null;
  reacquisition_time_s?: number | null;
  average_tracking_error_px?: number | null;
  max_tracking_error_px?: number | null;
  average_centroid_error_px?: number | null;
  max_centroid_error_px?: number | null;
  rmse_px?: number | null;
  target_loss_percent: number;
  lock_retention_percent: number;
  detection_rate_percent: number;
  average_confidence: number;
  average_snr_db?: number | null;
}

export interface AnalyticsSummaryResponse {
  metrics: PerformanceMetrics;
  requirements: OfficialRequirementStatus[];
  overall_compliance: boolean;
  passed_count: number;
  total_count: number;
  last_telemetry?: TelemetryPoint | null;
}

export interface ExperimentRecord {
  experiment_id: string;
  timestamp: string;
  name: string;
  algorithm: string;
  target_motion: string;
  noise_type: string;
  noise_level_sigma: number;
  atmosphere: string;
  pid_kp: number;
  pid_ki: number;
  pid_kd: number;
  kalman_enabled: boolean;
  duration_s: number;
  total_frames: number;
  metrics: PerformanceMetrics;
  requirements: OfficialRequirementStatus[];
  overall_status: 'PASS' | 'FAIL';
}

export interface AlgorithmComparisonResult {
  algorithm_name: string;
  mean_tracking_error_px: number;
  max_tracking_error_px: number;
  rmse_px: number;
  lock_retention_percent: number;
  target_loss_percent: number;
  acquisition_time_s?: number | null;
  reacquisition_time_s?: number | null;
  average_latency_ms: number;
  average_fps: number;
  passed_requirements_count: number;
  total_requirements_count: number;
  overall_pass: boolean;
}

export interface AlgorithmComparisonResponse {
  scenario_name: string;
  duration_s: number;
  total_frames_per_run: number;
  compared_algorithms: AlgorithmComparisonResult[];
  timestamp: string;
}


export type NavTabId =
  | 'mission_control'
  | 'virtual_simulation'
  | 'camera_view'
  | 'video_benchmark'
  | 'target_environment'
  | 'detection_ai'
  | 'tracking_control'
  | 'disturbances'
  | 'analytics'
  | 'experiments'
  | 'performance_reports'
  | 'requirements'
  | 'architecture'
  | 'documentation'
  | 'settings';


// ==============================================================================
// PART 9: AUTOMATIC REPORTING, TECHNICAL DOCUMENTATION & DEMO MODE TYPES
// ==============================================================================

export interface RawFrameLogEntry {
  frame_number: number;
  timestamp_s: number;
  centroid_x?: number | null;
  centroid_y?: number | null;
  reference_x?: number | null;
  reference_y?: number | null;
  error_x_px?: number | null;
  error_y_px?: number | null;
  total_error_px?: number | null;
  confidence: number;
  detection_status: string;
  tracking_state: string;
  pan_deg: number;
  tilt_deg: number;
  fps: number;
  processing_time_ms: number;
}

export interface PerformanceReport {
  report_id: string;
  experiment_id: string;
  timestamp: string;
  mode: 'Simulation Testbench' | 'MP4 Video Benchmark' | 'Automated Demonstration';
  video_filename?: string | null;
  configuration: Record<string, any>;
  metrics: PerformanceMetrics;
  requirements: OfficialRequirementStatus[];
  raw_log_sample: RawFrameLogEntry[];
  total_log_entries: number;
  markdown_content: string;
  status: 'PASS' | 'FAIL' | 'NON_COMPLIANT';
}

export interface PerformanceReportSummary {
  report_id: string;
  experiment_id: string;
  timestamp: string;
  mode: string;
  status: string;
  average_tracking_error_px?: number | null;
  rmse_px?: number | null;
  lock_retention_percent?: number | null;
  average_fps?: number | null;
}

export interface DemoStepStatus {
  step_number: number;
  name: string;
  description: string;
  completed: boolean;
  active: boolean;
}

export interface DemoStatusResponse {
  is_running: boolean;
  demo_type: 'SIMULATION_DEMO' | 'VIDEO_DEMO' | 'IDLE';
  current_step: number;
  total_steps: number;
  current_step_name: string;
  current_step_desc: string;
  elapsed_time_s: number;
  progress_percent: number;
  steps: DemoStepStatus[];
  latest_report_id?: string | null;
}

export interface DocumentationSection {
  id: number;
  title: string;
  tag: string;
  summary: string;
  content: string;
}

export interface TechnicalReportResponse {
  title: string;
  sections_count: number;
  sections: DocumentationSection[];
}

export interface UserManualResponse {
  title: string;
  chapters_count: number;
  chapters: DocumentationSection[];
}
