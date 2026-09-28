from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field
from backend.app.models.analytics_model import PerformanceMetrics, OfficialRequirementStatus


class RawFrameLogEntry(BaseModel):
    """Frame-level raw telemetry log per Part 9 specification."""
    frame_number: int
    timestamp_s: float
    centroid_x: Optional[float] = None
    centroid_y: Optional[float] = None
    reference_x: Optional[float] = None
    reference_y: Optional[float] = None
    error_x_px: Optional[float] = None
    error_y_px: Optional[float] = None
    total_error_px: Optional[float] = None
    confidence: float = 0.0
    detection_status: str = "NOT_DETECTED"
    tracking_state: str = "SEARCHING"
    pan_deg: float = 0.0
    tilt_deg: float = 0.0
    fps: float = 0.0
    processing_time_ms: float = 0.0
    angular_error_deg: Optional[float] = None
    slew_saturated: bool = False
    gimbal_limit: bool = False
    is_link_blocked: bool = False
    range_km: Optional[float] = None
    angular_rate_deg_s: Optional[float] = None
    atmosphere_path_frac: Optional[float] = None


class PerformanceReport(BaseModel):
    """Complete experimental performance report record."""
    report_id: str
    experiment_id: str
    timestamp: str
    mode: Literal["Simulation Testbench", "MP4 Video Benchmark", "Automated Demonstration"]
    video_filename: Optional[str] = None
    configuration: Dict[str, Any]
    metrics: PerformanceMetrics
    requirements: List[OfficialRequirementStatus]
    raw_log_sample: List[RawFrameLogEntry] = Field(default_factory=list)
    total_log_entries: int = 0
    markdown_content: str = ""
    status: Literal["PASS", "FAIL", "NON_COMPLIANT"] = "PASS"


class DemoStepStatus(BaseModel):
    """Status for an individual phase of the automated demonstration."""
    step_number: int
    name: str
    description: str
    completed: bool
    active: bool


class DemoStatusResponse(BaseModel):
    """Live state of the automated Demonstration Mode."""
    is_running: bool
    demo_type: Literal["SIMULATION_DEMO", "VIDEO_DEMO", "IDLE"]
    current_step: int
    total_steps: int
    current_step_name: str
    current_step_desc: str
    elapsed_time_s: float
    progress_percent: float
    steps: List[DemoStepStatus]
    latest_report_id: Optional[str] = None
