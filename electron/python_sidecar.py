"""
electron/python_sidecar.py
==========================
Entry point used by PyInstaller to produce the bundled Python sidecar.
Finds a free TCP port, writes it to a temp file so Electron can read it,
then starts uvicorn serving the existing FastAPI app.
"""
import os
import sys
import socket
import json
import shutil
import pathlib
import tempfile

# ── Ensure project root is on sys.path and handle PyInstaller 6 _internal ──
if getattr(sys, 'frozen', False):
    exe_dir = pathlib.Path(sys.executable).parent
    internal_dir = exe_dir / '_internal'
    BASE = internal_dir if internal_dir.exists() else exe_dir
    sys.path.insert(0, str(exe_dir))
else:
    BASE = pathlib.Path(__file__).resolve().parent.parent

sys.path.insert(0, str(BASE))
os.chdir(str(BASE))

# ── Redirect mutable user-data dirs to %APPDATA%\LaserLockAI\ ─────────────
APPDATA = pathlib.Path(os.environ.get('APPDATA', os.path.expanduser('~'))) / 'LaserLockAI'
APPDATA.mkdir(parents=True, exist_ok=True)

for d in ['reports_archive', 'benchmark_videos', 'saved_configs', 'data']:
    target = APPDATA / d
    target.mkdir(parents=True, exist_ok=True)
    os.environ[f'LASERLOCKAI_{d.upper()}'] = str(target)
    os.environ[f'LASERLOCKAI_{d.upper().replace("-", "_")}'] = str(target)

# Seed initial configuration if not present in AppData
appdata_active_cfg = APPDATA / 'saved_configs' / 'active_config.json'
if not appdata_active_cfg.exists():
    bundled_cfg = BASE / 'backend' / 'saved_configs' / 'active_config.json'
    if bundled_cfg.exists():
        try:
            shutil.copy2(bundled_cfg, appdata_active_cfg)
        except Exception:
            pass

# Seed model path environment variable
bundled_model = BASE / 'ML_model' / 'my_model.pt'
if bundled_model.exists():
    os.environ['LASERLOCKAI_MODEL_PATH'] = str(bundled_model)

# ── Redirect stdout/stderr so prints work when console=False ───────────────
log_path = APPDATA / 'backend.log'
try:
    log_f = open(log_path, 'a', buffering=1, encoding='utf-8')
    sys.stdout = log_f
    sys.stderr = log_f
except Exception:
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w')
    if sys.stderr is None:
        sys.stderr = open(os.devnull, 'w')


def find_free_port(start: int = 8000) -> int:
    for port in range(start, start + 200):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                if s.connect_ex(('127.0.0.1', port)) != 0:
                    return port
        except Exception:
            continue
    raise RuntimeError("No free port found")


def write_port_file(port: int):
    port_file = pathlib.Path(tempfile.gettempdir()) / 'laserlockaiapp_port.json'
    port_file.write_text(json.dumps({'port': port}))
    return port_file


if __name__ == '__main__':
    port = find_free_port()
    write_port_file(port)

    # Point frontend dist at correct location when frozen or running in dev
    frontend_dist = BASE / 'frontend' / 'dist'
    if getattr(sys, 'frozen', False) and not (frontend_dist / 'index.html').exists():
        if (exe_dir / 'frontend' / 'dist' / 'index.html').exists():
            frontend_dist = exe_dir / 'frontend' / 'dist'
    os.environ['VISION_FRONTEND_DIST'] = str(frontend_dist)

    if sys.platform == 'win32':
        import asyncio
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    from backend.app.main import app
    import uvicorn
    uvicorn.run(
        app,
        host='127.0.0.1',
        port=port,
        loop='none',
        log_level='warning',
        access_log=False,
    )

