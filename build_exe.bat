@echo off
setlocal enabledelayedexpansion
title LaserLockAI — EXE Build Script
color 0B

echo =========================================================================
echo   LASERLOCKAI — FULL WINDOWS EXE BUILD PIPELINE
echo =========================================================================
echo.

:: ── 0. Prerequisites check ──────────────────────────────────────────────
where python >nul 2>&1 || (echo [ERROR] Python not found. Install Python 3.11 x64. & pause & exit /b 1)
where npm    >nul 2>&1 || (echo [ERROR] Node.js not found. Install Node.js 20+.    & pause & exit /b 1)

:: ── 1. Install Python deps (build machine only, not shipped) ─────────────
echo [1/6] Installing Python dependencies...
python -m pip install -r requirements.txt pyinstaller --quiet
if errorlevel 1 (echo [FAIL] pip install failed & pause & exit /b 1)

:: ── 2. Build React/Vite frontend ─────────────────────────────────────────
echo [2/6] Building React frontend (Vite)...
cd frontend
call npm install
call npm run build
cd ..
if errorlevel 1 (echo [FAIL] Frontend build failed & pause & exit /b 1)

:: ── 3. PyInstaller — bundle Python + all deps into dist\laserlockaiapp_backend\ ──
echo [3/6] Bundling Python sidecar with PyInstaller...
python -m PyInstaller electron/pyinstaller.spec --distpath dist --workpath build/pyinstaller --clean --noconfirm
if errorlevel 1 (echo [FAIL] PyInstaller failed & pause & exit /b 1)

:: ── 4. Install Electron / electron-builder ───────────────────────────────
echo [4/6] Installing Electron dependencies...
cd electron
call npm install
cd ..
if errorlevel 1 (echo [FAIL] npm install for electron failed & pause & exit /b 1)

:: ── 5. electron-builder → NSIS installer ─────────────────────────────────
echo [5/6] Building Windows installer with electron-builder...
cd electron
call npx electron-builder --win --x64
cd ..
if errorlevel 1 (echo [FAIL] electron-builder failed & pause & exit /b 1)

:: ── 6. Done ───────────────────────────────────────────────────────────────
echo.
echo =========================================================================
echo  [SUCCESS] Installer created in:  release\LaserLockAI Setup 1.0.0.exe
echo =========================================================================
pause
