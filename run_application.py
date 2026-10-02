"""
run_application.py
==================
Standalone 1-Click Application Launcher for FSOC Coarse Alignment Tracking System.

Starts the unified high-performance FastAPI backend server which simultaneously
serves the React/TypeScript frontend (SPA) and all real-time WebSocket & REST endpoints
on http://127.0.0.1:8000. Automatically opens the user's default web browser.

Usage:
    python run_application.py
    (or double-click run_application.bat on Windows)
"""

import os
import sys
import time
import webbrowser
import threading
import subprocess

WORKSPACE_ROOT = os.path.abspath(os.path.dirname(__file__))
sys.path.insert(0, WORKSPACE_ROOT)


def check_and_build_frontend():
    dist_index = os.path.join(WORKSPACE_ROOT, "frontend", "dist", "index.html")
    node_modules_dir = os.path.join(WORKSPACE_ROOT, "frontend", "node_modules")
    frontend_dir = os.path.join(WORKSPACE_ROOT, "frontend")
    if not os.path.exists(dist_index):
        print("[*] Production frontend bundle not detected. Building frontend...")
        try:
            if not os.path.exists(node_modules_dir):
                print("[*] Node modules not found. Running npm install...")
                subprocess.run(["npm", "install"], cwd=frontend_dir, check=True, shell=True)
            subprocess.run(["npm", "run", "build"], cwd=frontend_dir, check=True, shell=True)
            print("[+] Frontend build succeeded.")
        except Exception as e:
            print(f"[!] Warning: npm build failed ({e}). Proceeding with available files.")


def launch_browser():
    time.sleep(1.5)
    url = "http://127.0.0.1:8000"
    print(f"[*] Opening browser to {url} ...")
    webbrowser.open(url)


def main():
    print("=" * 80)
    print("   AI-BASED VIRTUAL CAMERA TRACKING SYSTEM FOR COARSE ALIGNMENT OF FSOC   ")
    print("                      STANDALONE APPLICATION LAUNCHER                      ")
    print("=" * 80)

    # 1. Verify / build production bundle
    check_and_build_frontend()

    # 2. Launch browser in a background daemon thread
    browser_thread = threading.Thread(target=launch_browser, daemon=True)
    browser_thread.start()

    # 3. Start unified FastAPI uvicorn server
    print("\n[*] Starting Standalone Production Server on http://127.0.0.1:8000 ...")
    print("[*] Press Ctrl+C to stop the application.\n")

    import uvicorn
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, log_level="info", access_log=False)


if __name__ == "__main__":
    main()
