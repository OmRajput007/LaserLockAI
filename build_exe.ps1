# build_exe.ps1 — Run from project root in PowerShell (as normal user)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Step($n, $msg) { Write-Host "`n[$n/6] $msg" -ForegroundColor Cyan }

Step 1 "Installing Python build dependencies"
python -m pip install -r requirements.txt pyinstaller

Step 2 "Building Vite/React frontend"
Push-Location frontend
npm install
npm run build
Pop-Location

Step 3 "Bundling Python sidecar (PyInstaller)"
python -m PyInstaller electron/pyinstaller.spec `
    --distpath dist `
    --workpath build/pyinstaller `
    --clean --noconfirm

Step 4 "Installing Electron node_modules"
Push-Location electron
npm install
Pop-Location

Step 5 "Building NSIS installer (electron-builder)"
Push-Location electron
npx electron-builder --win --x64
Pop-Location

Step 6 "Done"
Write-Host "`n[SUCCESS] Installer: release\LaserLockAI Setup 1.0.0.exe" -ForegroundColor Green
