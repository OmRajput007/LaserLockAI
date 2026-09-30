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
import pathlib
import tempfile

# ── Make sure the project root is on sys.path ──────────────────────────────
# When frozen by PyInstaller the executable sits in resources/sidecar/
# and the project source is copied alongside it.
if getattr(sys, 'frozen', False):
    BASE = pathlib.Path(getattr(sys, '_MEIPASS', pathlib.Path(sys.executable).parent))
else:
    BASE = pathlib.Path(__file__).resolve().parent.parent

sys.path.insert(0, str(BASE))

# ── Redirect mutable user-data dirs to %APPDATA%\LaserLockAI\ ─────────────
APPDATA = pathlib.Path(os.environ.get('APPDATA', os.path.expanduser('~'))) / 'LaserLockAI'
APPDATA.mkdir(parents=True, exist_ok=True)

for d in ['reports_archive', 'benchmark_videos', 'saved_configs', 'data']:
    target = APPDATA / d
    target.mkdir(parents=True, exist_ok=True)
    key = f'LASERLOCKAI_{d.upper().replace("-", "_")}'
    os.environ[key] = str(target)

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
    for port in range(start, start + 100):
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

    # Point frontend dist at the correct location when frozen
    os.environ['VISION_FRONTEND_DIST'] = str(BASE / 'frontend' / 'dist')

    from backend.app.main import app
    import uvicorn
    uvicorn.run(
        app,
        host='127.0.0.1',
        port=port,
        log_level='warning',
        access_log=False,
    )
