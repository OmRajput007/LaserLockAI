@echo off
setlocal enabledelayedexpansion
title LaserLockAI — Standalone Software Build Pipeline
color 0B

echo =========================================================================
echo   LASERLOCKAI — FULL STANDALONE WINDOWS SOFTWARE BUILD PIPELINE
echo   (Bundles complete Frontend, Backend, AI Model & Electron Runtime)
echo =========================================================================
echo.

:: ── 0. Prerequisites check ──────────────────────────────────────────────────
echo [*] Checking build environment prerequisites...
where python >nul 2>&1 || (echo [ERROR] Python not found. Please install Python 3.10+ x64. & pause & exit /b 1)
where node   >nul 2>&1 || (echo [ERROR] Node.js not found. Please install Node.js 18+. & pause & exit /b 1)
where npm    >nul 2>&1 || (echo [ERROR] npm not found. Please install Node.js. & pause & exit /b 1)

echo [+] Python and Node.js detected.
echo.

:: ── 1. Build React/Vite Frontend SPA ───────────────────────────────────────
echo [1/4] Building React Production SPA (Vite + TypeScript)...
cd frontend
if not exist node_modules (
    echo     [*] Installing frontend npm dependencies...
    call npm install
    if errorlevel 1 (echo [FAIL] Frontend npm install failed. & cd .. & pause & exit /b 1)
)
echo     [*] Compiling production bundle...
call npm run build
if errorlevel 1 (echo [FAIL] Frontend build failed. & cd .. & pause & exit /b 1)
cd ..

if not exist frontend\dist\index.html (
    echo [ERROR] frontend\dist\index.html was not generated.
    pause
    exit /b 1
)
echo [+] Frontend SPA built successfully in frontend\dist\
echo.

:: ── 2. Freeze Python Backend into Standalone Sidecar ───────────────────────
echo [2/4] Freezing Python Backend into standalone sidecar using PyInstaller...
python -m PyInstaller electron/pyinstaller.spec --distpath dist --workpath build/pyinstaller --clean --noconfirm
if errorlevel 1 (
    echo [FAIL] PyInstaller backend build failed.
    pause
    exit /b 1
)

if not exist dist\laserlockaiapp_backend\laserlockaiapp_backend.exe (
    echo [ERROR] dist\laserlockaiapp_backend\laserlockaiapp_backend.exe was not created!
    pause
    exit /b 1
)
echo [+] Standalone Python backend frozen in dist\laserlockaiapp_backend\
echo.

:: ── 3. Package Electron Standalone Desktop Application ─────────────────────
echo [3/4] Packaging Electron Desktop Application (No browser required)...
cd electron
if not exist node_modules (
    echo     [*] Installing electron npm dependencies...
    call npm install
    if errorlevel 1 (echo [FAIL] Electron npm install failed. & cd .. & pause & exit /b 1)
)
echo     [*] Building standalone application folder and installer with electron-builder...
call npx electron-builder --win --x64
if errorlevel 1 (echo [FAIL] electron-builder failed. & cd .. & pause & exit /b 1)
cd ..
echo [+] Electron packaging complete.
echo.

:: ── 4. Organize Output Folder ──────────────────────────────────────────────
echo [4/4] Finalizing standalone distribution folder...
if exist dist_software\win-unpacked (
    if exist dist_software\LaserLockAI-win32-x64 (
        echo     [*] Removing previous dist_software\LaserLockAI-win32-x64...
        rmdir /s /q dist_software\LaserLockAI-win32-x64
    )
    echo     [*] Renaming dist_software\win-unpacked -> dist_software\LaserLockAI-win32-x64...
    ren dist_software\win-unpacked LaserLockAI-win32-x64
)

echo.
echo =========================================================================
echo   [SUCCESS] STANDALONE LASERLOCKAI SOFTWARE READY!
echo =========================================================================
echo.
echo Standalone Multi-File Software Folder:
echo   dist_software\LaserLockAI-win32-x64\
echo.
echo Launcher Executable:
echo   dist_software\LaserLockAI-win32-x64\LaserLockAI.exe
echo.
echo (Optional) NSIS One-Click / Custom Installer:
echo   dist_software\LaserLockAI Setup 1.0.2.exe
echo.
echo How to run on ANY Windows PC (No Python or Node required):
echo   1. Simply copy the folder "LaserLockAI-win32-x64" to any Windows machine.
echo   2. Double-click "LaserLockAI.exe".
echo   3. It opens in its own dedicated desktop window with zero prerequisites!
echo =========================================================================
pause
