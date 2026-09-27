from typing import Dict, Any


class VirtualEnvironment:
    """
    Metadata and coordinate mapping for the 2000x2000 virtual space.
    Prepares structure for future 3D scene expansion (Part 2).
    """

    def __init__(self, width: int = 2000, height: int = 2000):
        self.width = width
        self.height = height
        self.background_color = "#030712"  # Space/night sky dark
        self.grid_spacing = 100  # Grid intervals in pixels

    def get_environment_info(self) -> Dict[str, Any]:
        return {
            "coordinate_system": "Cartesian 2D World",
            "world_width": self.width,
            "world_height": self.height,
            "origin": "Center (1000, 1000)",
            "grid_interval_px": self.grid_spacing,
            "future_3d_support": True,
        }
