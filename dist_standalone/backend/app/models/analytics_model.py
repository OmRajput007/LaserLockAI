from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field


class TelemetryPoint(BaseModel):
    """Instantaneous snapshot for real-time time-series charts."""
    time_s: float
    tracking_error_px: Optional[float] = None
    centroid_error_px: Optional[float] = None
    angular_error_deg: Optional[float] = None
    centroid_x: Optional[float] = None
    centroid_y: Optional[float] = None
    pan_deg: float = 0.0
    tilt_deg: float = 0.0
    fps: float = 0.0
    processing_time_ms: float = 0.0
    confidence: float = 0.0
    snr_db: Optional[float] = None
    is_locked: bool = False
    is_detected: bool = False
    target_state: str = "SEARCHING"


class OfficialRequirementStatus(BaseModel):
    """Individual official requirement compliance row for dashboard."""
    parameter: str = Field(..., description="Name of official parameter")
    required: str = Field(..., description="Official threshold specification")
    actual: str = Field(..., description="Measured real-world actual performance")
    status: Literal["PASS", "FAIL", "PENDING"] = Field(..., description="PASS or FAIL calculated from measurements")
    unit: str = Field(..., description="Measurement unit (s, px, %, FPS)")
    actual_value: Optional[float] = None
    required_threshold: float = 0.0
    margin: Optional[float] = None


class PerformanceMetrics(BaseModel):
    """
    Comprehensive performance metrics calculated from actual measurements
    per Part 8 specification. Never hard-coded.
    """
    simulation_duration_s: float = 0.0
    video_duration_s: Optional[float] = None
    total_frames: int = 0
    average_fps: float = 0.0
    min_fps: float = 0.0
    max_fps: float = 0.0
    average_processing_time_ms: float = 0.0
    max_processing_time_ms: float = 0.0
    acquisition_time_s: Optional[float] = None
    reacquisition_time_s: Optional[float] = None
    average_tracking_error_px: Optional[float] = None
    max_tracking_error_px: Optional[float] = None
    average_centroid_error_px: Optional[float] = None
    max_centroid_error_px: Optional[float] = None
    rmse_px: Optional[float] = None
    target_loss_percent: float = 0.0
    lock_retention_percent: float = 0.0
    detection_rate_percent: float = 0.0
    average_confidence: float = 0.0
    average_snr_db: Optional[float] = None


class AnalyticsSummaryResponse(BaseModel):
    metrics: PerformanceMetrics
    requirements: List[OfficialRequirementStatus]
    overall_compliance: bool
    passed_count: int
    total_count: int
    last_telemetry: Optional[TelemetryPoint] = None


class ChartSeriesResponse(BaseModel):
    points: List[TelemetryPoint]
    total_points: int


class ExperimentRecord(BaseModel):
    """Archived experimental trial record."""
    experiment_id: str
    timestamp: str
    name: str
    algorithm: str
    target_motion: str
    noise_type: str
    noise_level_sigma: float
    atmosphere: str
    pid_kp: float
    pid_ki: float
    pid_kd: float
    kalman_enabled: bool
    duration_s: float
    total_frames: int
    metrics: PerformanceMetrics
    requirements: List[OfficialRequirementStatus]
    overall_status: Literal["PASS", "FAIL"]


class AlgorithmComparisonResult(BaseModel):
    """Objective benchmark comparison for a single algorithm candidate."""
    algorithm_name: str
    mean_tracking_error_px: float
    max_tracking_error_px: float
    rmse_px: float
    lock_retention_percent: float
    target_loss_percent: float
    acquisition_time_s: Optional[float]
    reacquisition_time_s: Optional[float]
    average_latency_ms: float
    average_fps: float
    passed_requirements_count: int
    total_requirements_count: int
    overall_pass: bool


class AlgorithmComparisonResponse(BaseModel):
    scenario_name: str
    duration_s: float
    total_frames_per_run: int
    compared_algorithms: List[AlgorithmComparisonResult]
    timestamp: str
