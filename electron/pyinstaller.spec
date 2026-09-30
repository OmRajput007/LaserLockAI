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
        # Bundle data files
        (str(ROOT / 'backend' / 'data'), 'backend/data'),
        (str(ROOT / 'backend' / 'saved_configs'), 'backend/saved_configs'),
    ],
    hiddenimports=[
        'backend.app.main',
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
