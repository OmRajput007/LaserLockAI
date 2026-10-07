param (
    [string]$Repo = "",
    [string]$Token = "",
    [string]$Tag = "v1.0.2",
    [string]$Title = "LaserLockAI v1.0.2 Release",
    [string]$Notes = "Official release installer for LaserLockAI v1.0.2 (Windows x64).",
    [string]$FilePath = "dist_software\LaserLockAI Setup 1.0.2.exe"
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   LaserLockAI - GitHub Release & Asset Uploader" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not $Token) {
    if ($env:GITHUB_TOKEN) {
        $Token = $env:GITHUB_TOKEN
    } else {
        $Token = Read-Host "Enter your GitHub Personal Access Token (PAT)"
    }
}

if (-not $Repo) {
    # Check if git remote origin is configured
    try {
        $remote = git remote get-url origin 2>$null
        if ($remote) {
            $Repo = $remote
        }
    } catch {}
    
    if (-not $Repo) {
        $Repo = Read-Host "Enter your GitHub repository (e.g. username/repo-name or full URL)"
    }
}

if (-not (Test-Path $FilePath)) {
    Write-Host "[ERROR] Target installer not found at $FilePath" -ForegroundColor Red
    Write-Host "Please build the project first using build_exe.bat" -ForegroundColor Yellow
    exit 1
}

Write-Host "`nTarget Repo : $Repo" -ForegroundColor Green
Write-Host "Tag         : $Tag" -ForegroundColor Green
Write-Host "File        : $FilePath" -ForegroundColor Green
$EncodedName = [System.Uri]::EscapeDataString([System.IO.Path]::GetFileName($FilePath))
$UploadUrl = "https://uploads.github.com/repos/$Repo/releases/$Tag/assets?name=$EncodedName"

# If release exists, get release id or upload directly
python upload_github_release.py --repo "$Repo" --token "$Token" --tag "$Tag" --title "$Title" --notes "$Notes" --file "$FilePath"

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n[SUCCESS] Release published and installer attached successfully!" -ForegroundColor Green
} else {
    Write-Host "`n[FAIL] Release upload failed with exit code $LASTEXITCODE" -ForegroundColor Red
}

