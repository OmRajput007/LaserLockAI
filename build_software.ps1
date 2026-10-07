# LaserLockAI — Standalone Software Build Pipeline (PowerShell)
$ErrorActionPreference = "Stop"

Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host "   LASERLOCKAI — FULL STANDALONE WINDOWS SOFTWARE BUILD PIPELINE" -ForegroundColor Cyan
Write-Host "   (Bundles complete Frontend, Backend, AI Model & Electron Runtime)" -ForegroundColor Cyan
Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host ""

$Root = $PSScriptRoot
if (-not $Root) { $Root = Get-Location }

# 0. Check prerequisites
Write-Host "[*] Checking build environment prerequisites..." -ForegroundColor Yellow
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "Python not found in PATH. Install Python 3.10+ x64."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js not found in PATH. Install Node.js 18+."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm not found in PATH."
}
Write-Host "[+] Python and Node.js detected." -ForegroundColor Green
Write-Host ""

# 1. Build React/Vite Frontend
Write-Host "[1/4] Building React Production SPA (Vite + TypeScript)..." -ForegroundColor Yellow
Push-Location "$Root\frontend"
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "    [*] Installing frontend npm dependencies..."
        npm install
    }
    Write-Host "    [*] Compiling production bundle..."
    npm run build
} finally {
    Pop-Location
}

if (-not (Test-Path "$Root\frontend\dist\index.html")) {
    throw "frontend\dist\index.html was not generated."
}
Write-Host "[+] Frontend SPA built successfully in frontend\dist\" -ForegroundColor Green
Write-Host ""

# 2. Freeze Python Backend into Standalone Sidecar
Write-Host "[2/4] Freezing Python Backend into standalone sidecar using PyInstaller..." -ForegroundColor Yellow
python -m PyInstaller "$Root\electron\pyinstaller.spec" --distpath "$Root\dist" --workpath "$Root\build\pyinstaller" --clean --noconfirm

$backendExe = "$Root\dist\laserlockaiapp_backend\laserlockaiapp_backend.exe"
if (-not (Test-Path $backendExe)) {
    throw "Backend executable not found at $backendExe"
}
Write-Host "[+] Standalone Python backend frozen in dist\laserlockaiapp_backend\" -ForegroundColor Green
Write-Host ""

# 3. Package Electron Standalone Desktop Application
Write-Host "[3/4] Packaging Electron Desktop Application (No browser required)..." -ForegroundColor Yellow
Push-Location "$Root\electron"
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "    [*] Installing electron npm dependencies..."
        npm install
    }
    Write-Host "    [*] Building standalone application folder and installer with electron-builder..."
    npx electron-builder --win --x64
} finally {
    Pop-Location
}
Write-Host "[+] Electron packaging complete." -ForegroundColor Green
Write-Host ""

# 4. Organize Output Folder
Write-Host "[4/4] Finalizing standalone distribution folder..." -ForegroundColor Yellow
$unpackedDir = "$Root\dist_software\win-unpacked"
$targetDir = "$Root\dist_software\LaserLockAI-win32-x64"

if (Test-Path $unpackedDir) {
    if (Test-Path $targetDir) {
        Remove-Item -Recurse -Force $targetDir
    }
    Rename-Item -Path $unpackedDir -NewName "LaserLockAI-win32-x64"
}

Write-Host ""
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host "   [SUCCESS] STANDALONE LASERLOCKAI SOFTWARE READY!" -ForegroundColor Green
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Standalone Multi-File Software Folder:"
Write-Host "  dist_software\LaserLockAI-win32-x64\" -ForegroundColor Cyan
Write-Host ""
Write-Host "Launcher Executable:"
Write-Host "  dist_software\LaserLockAI-win32-x64\LaserLockAI.exe" -ForegroundColor Cyan
Write-Host ""
Write-Host "(Optional) NSIS Installer:"
Write-Host "  dist_software\LaserLockAI Setup 1.0.2.exe" -ForegroundColor Cyan
Write-Host ""
Write-Host "How to run on ANY Windows PC (No Python or Node required):"
Write-Host "  1. Copy the folder 'LaserLockAI-win32-x64' to any Windows machine."
Write-Host "  2. Double-click 'LaserLockAI.exe'."
Write-Host "  3. It opens in its own dedicated desktop window with zero prerequisites!"
Write-Host "=========================================================================" -ForegroundColor Green
