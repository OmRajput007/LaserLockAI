# electron/pyinstaller.spec
# Run:  pyinstaller electron/pyinstaller.spec
import sys, pathlib
ROOT = pathlib.Path(SPECPATH).parent  # Vision-main root

block_cipher = None

icon_path = ROOT / 'electron' / 'assets' / 'icon.ico'

a = Analysis(
    [str(ROOT / 'electron' / 'python_sidecar.py')],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        # Bundle entire backend Python package
        (str(ROOT / 'backend'), 'backend'),
        # Bundle the pre-built React SPA
        (str(ROOT / 'frontend' / 'dist'), 'frontend/dist'),
        # Bundle data files and configurations
        (str(ROOT / 'backend' / 'data'), 'backend/data'),
        (str(ROOT / 'backend' / 'saved_configs'), 'backend/saved_configs'),
        # Bundle trained AI models
        (str(ROOT / 'ML_model'), 'ML_model'),
        # Bundle benchmark videos if present
        (str(ROOT / 'benchmark_videos'), 'benchmark_videos'),
    ],
    hiddenimports=[
        'backend',
        'backend.app',
        'backend.app.main',
        'backend.app.api',
        'backend.app.api.routes',
        'backend.app.api.websocket',
        'backend.app.config',
        'backend.app.config.manager',
        'backend.app.config.defaults',
        'backend.app.models',
        'backend.app.models.config_model',
        'backend.app.models.telemetry_model',
        'backend.app.models.benchmark_model',
        'backend.app.models.detection_model',
        'backend.app.models.camera_model',
        'backend.app.detection',
        'backend.app.detection.ai_detector',
        'backend.app.detection.cv_detector',
        'backend.app.detection.detection_manager',
        'backend.app.detection.detector_base',
        'backend.app.detection.kalman_filter',
        'backend.app.detection.target_identifier',
        'backend.app.reports',
        'backend.app.reports.report_generator',
        'backend.app.reports.report_base',
        'backend.app.reports.technical_documentation',
        'backend.app.simulation',
        'backend.app.simulation.engine',
        'backend.app.camera',
        'backend.app.camera.camera_simulator',
        'backend.app.camera.fpa_sensor',
        'backend.app.control',
        'backend.app.control.controller',
        'backend.app.control.pid',
        'backend.app.control.gimbal',
        'backend.app.disturbances',
        'backend.app.disturbances.turbulence',
        'backend.app.disturbances.jitter',
        'backend.app.orbital',
        'backend.app.orbital.orbit_engine',
        'backend.app.orbital.validation_suite',
        'backend.app.demo',
        'backend.app.demo.demo_orchestrator',
        'backend.app.benchmark',
        'backend.app.benchmark.benchmark_runner',
        'backend.app.benchmark.video_pipeline',
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'fastapi',
        'pydantic',
        'pydantic.deprecated.class_validators',
        'pydantic_core',
        'pydantic_core._pydantic_core',
        'starlette',
        'starlette.routing',
        'starlette.staticfiles',
        'starlette.responses',
        'numpy',
        'cv2',
        'reportlab',
        'reportlab.pdfgen',
        'reportlab.lib',
        'websockets',
        'websockets.legacy',
        'anyio',
        'anyio._backends._asyncio',
        'httptools',
        'h11',
        'multipart',
        'python_multipart',
        'torch',
        'torchvision',
        'ultralytics',
        'onnxruntime',
        'onnx',
    ],
    hookspath=[str(ROOT / 'electron' / 'pyinstaller_hooks')],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='laserlockaiapp_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,   # no console window
    icon=str(icon_path) if icon_path.exists() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='laserlockaiapp_backend',   # output: dist/laserlockaiapp_backend/
)
