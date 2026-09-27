import json
import os
from pathlib import Path
from typing import Optional
from backend.app.models.config_model import SystemConfig
from backend.app.config.defaults import get_default_config


class ConfigManager:
    """
    Manages central configuration lifecycle for the FSOC tracking testbench.
    Provides persistence to JSON, loading, validation, and factory defaults reset.
    """

    def __init__(self, config_dir: Optional[Path] = None):
        if config_dir is None:
            # Default to backend/saved_configs
            self.config_dir = Path(__file__).parent.parent.parent / "saved_configs"
        else:
            self.config_dir = Path(config_dir)

        self.config_dir.mkdir(parents=True, exist_ok=True)
        self.active_file = self.config_dir / "active_config.json"
        self._current_config: SystemConfig = self.load_or_create_default()

    def get_config(self) -> SystemConfig:
        """Returns the currently active system configuration."""
        return self._current_config

    def set_config(self, new_config: SystemConfig) -> SystemConfig:
        """Updates the active configuration in memory and persists to active_config.json."""
        self._current_config = new_config
        self.save_to_file(self.active_file, self._current_config)
        return self._current_config

    def update_config(self, new_config: SystemConfig) -> SystemConfig:
        return self.set_config(new_config)

    def reset_defaults(self) -> SystemConfig:
        """Resets the configuration to official Problem Statement 4 defaults."""
        self._current_config = get_default_config()
        self.save_to_file(self.active_file, self._current_config)
        return self._current_config

    def save_to_file(self, file_path: Path, config: Optional[SystemConfig] = None) -> Path:
        """Serializes configuration to a designated JSON file."""
        cfg = config or self._current_config
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(cfg.model_dump_json(indent=2))
        return file_path

    def load_from_file(self, file_path: Path) -> SystemConfig:
        """Loads and validates configuration from a designated JSON file."""
        if not file_path.exists():
            raise FileNotFoundError(f"Configuration file not found: {file_path}")
        with open(file_path, "r", encoding="utf-8") as f:
            raw_data = json.load(f)
        loaded_config = SystemConfig.model_validate(raw_data)
        self._current_config = loaded_config
        # Update active config file
        self.save_to_file(self.active_file, self._current_config)
        return self._current_config

    def load_or_create_default(self) -> SystemConfig:
        """Loads active config if exists; otherwise generates and saves default config."""
        if self.active_file.exists():
            try:
                return self.load_from_file(self.active_file)
            except Exception:
                # Fall back to default if corrupt
                pass
        cfg = get_default_config()
        self.save_to_file(self.active_file, cfg)
        return cfg


# Global singleton instance for application use
config_manager = ConfigManager()
