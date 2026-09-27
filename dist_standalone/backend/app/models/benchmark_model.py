"""
benchmark_model.py
===================
Pydantic schemas and data structures for Part 7:
MP4 VIDEO BENCHMARK MODE.

Defines schemas for:
- Video metadata & upload validation
- Frame-by-frame centroid telemetry logs
- Ground-truth reference data structures
- Comprehensive benchmark performance reports
- Playback & batch processing state
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class VideoMetadata(BaseModel):
    filename: str = Field(..., description="Original video filename")
    filepath: str = Field(..., description="Absolute path on disk")
    width: int = Field(640, description="Video width in pixels")
    height: int = Field(480, description="Video height in pixels")
    fps: float = Field(30.0, description="Native video frame rate")
    total_frames: int = Field(0, description="Total frame count")
    duration_s: float = Field(0.0, description="Total duration in seconds")
    codec: str = Field("mp4v", description="FourCC codec identifier")
    file_size_bytes: int = Field(0, description="File size on disk in bytes")
    has_ground_truth: bool = Field(False, description="True if reference trajectory is loaded")


class GroundTruthPoint(BaseModel):
    frame: int = Field(..., description="Frame index (0-indexed)")
    timestamp_s: float = Field(0.0, description="Time offset in seconds")
    x: float = Field(..., description="True optical beacon centroid X")
    y: float = Field(..., description="True optical beacon centroid Y")
    radius_px: Optional[float] = Field(None, description="True beacon radius in pixels")


class FrameBenchmarkLog(BaseModel):
    frame_number: int = Field(..., description="0-indexed frame index")
    timestamp_s: float = Field(..., description="Timestamp in seconds from video start")
    detected_centroid_x: Optional[float] = Field(None, description="Detector measured centroid X (px)")
    detected_centroid_y: Optional[float] = Field(None, description="Detector measured centroid Y (px)")
    confidence: float = Field(0.0, description="Detector confidence score [0.0 to 1.0]")
    detection_status: str = Field("LOST", description="'DETECTED' or 'LOST'")
    tracking_state: str = Field("SEARCHING", description="PAT State Machine state")
    processing_time_ms: float = Field(0.0, description="Time taken to process frame in ms")
    instantaneous_fps: float = Field(0.0, description="Instantaneous processing throughput FPS")
    ground_truth_x: Optional[float] = Field(None, description="Reference ground truth X (px)")
    ground_truth_y: Optional[float] = Field(None, description="Reference ground truth Y (px)")
    centroid_error_px: Optional[float] = Field(None, description="Euclidean distance to GT: sqrt(dx² + dy²)")
    angular_error_deg: Optional[float] = Field(None, description="Angular deviation from GT in degrees")
    is_locked: bool = Field(False, description="True if coarse alignment lock criteria met")


class BenchmarkResults(BaseModel):
    video_name: str = Field(..., description="Processed video identifier")
    total_frames: int = Field(0, description="Total frames in video stream")
    processed_frames: int = Field(0, description="Number of frames evaluated")
    detection_method: str = Field("Classical CV", description="Detector algorithm used")
    input_fps: float = Field(30.0, description="Native video input FPS")
    average_processing_fps: float = Field(0.0, description="Average processing throughput FPS")
    min_processing_fps: float = Field(0.0, description="Minimum processing FPS observed")
    max_processing_fps: float = Field(0.0, description="Maximum processing FPS observed")
    average_processing_time_ms: float = Field(0.0, description="Average per-frame latency in ms")
    detection_rate_percent: float = Field(0.0, description="Percentage of frames beacon was detected")
    target_lost_count: int = Field(0, description="Total number of target loss events")
    target_loss_duration_s: float = Field(0.0, description="Cumulative time in lost state (s)")
    target_loss_percent: float = Field(0.0, description="Percentage of time spent in lost state")
    acquisition_time_s: Optional[float] = Field(None, description="Time from start to first lock (s)")
    reacquisition_time_s: Optional[float] = Field(None, description="Average time to recover after loss (s)")
    lock_retention_percent: float = Field(0.0, description="Percentage of frames maintaining lock")
    ground_truth_available: bool = Field(False, description="True if reference trajectory provided")
    average_centroid_error_px: Optional[float] = Field(None, description="Mean centroid error vs GT (px)")
    max_centroid_error_px: Optional[float] = Field(None, description="Maximum centroid error vs GT (px)")
    rmse_px: Optional[float] = Field(None, description="Root Mean Square Error vs GT (px)")
    status_message: str = Field(
        "Evaluation completed.",
        description="Official note regarding ground-truth availability and evaluation validity",
    )


class VideoPlaybackState(BaseModel):
    is_playing: bool = Field(False, description="True if live playback stream is active")
    current_frame_idx: int = Field(0, description="Current frame cursor position (0-indexed)")
    total_frames: int = Field(0, description="Total video frames")
    playback_speed: float = Field(1.0, description="Playback multiplier (0.25, 0.5, 1.0, 2.0, 0.0=Max)")
    is_processing_batch: bool = Field(False, description="True if batch offline benchmark is in progress")
    batch_progress_percent: float = Field(0.0, description="Progress percentage [0.0 to 100.0]")
    active_method: str = Field("Classical CV", description="Current detector method")
