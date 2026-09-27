"""
benchmark package initialization
"""
from backend.app.benchmark.video_pipeline import VideoBenchmarkEngine, benchmark_engine
from backend.app.benchmark.synthetic_generator import SyntheticBenchmarkGenerator

__all__ = ["VideoBenchmarkEngine", "benchmark_engine", "SyntheticBenchmarkGenerator"]
