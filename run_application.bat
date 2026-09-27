@echo off
title FSOC Coarse Alignment Tracking System
color 0A

echo ===============================================================================
echo     AI-BASED VIRTUAL CAMERA TRACKING SYSTEM FOR COARSE ALIGNMENT OF FSOC
echo                       STANDALONE APPLICATION LAUNCHER
echo ===============================================================================
echo.

:: Check Python installation
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Please install Python 3.10+ from python.org and add it to PATH.
    pause
    exit /b 1
)

:: Run Standalone Application
python run_application.py

pause
