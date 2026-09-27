"""
package_standalone.py
=====================
Packages the complete FSOC Virtual Camera Tracking Application into a clean,
self-contained standalone distribution bundle ready for deployment and archival.

Creates:
    dist_standalone/
      ├── backend/
      ├── frontend/dist/
      ├── config/
      ├── reports_archive/
      ├── benchmark_videos/
      ├── models/
      ├── tests/
      ├── run_application.py
      ├── run_application.bat
      ├── requirements.txt
      ├── pytest.ini
      └── README.md
"""

import os
import shutil
import subprocess

ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
DIST_DIR = os.path.join(ROOT_DIR, "dist_standalone")


def package():
    print("=" * 80)
    print("   PACKAGING FSOC VIRTUAL CAMERA TRACKING STANDALONE DISTRIBUTION BUNDLE   ")
    print("=" * 80)

    # 1. Clean previous build if any
    if os.path.exists(DIST_DIR):
        print(f"[*] Removing existing {DIST_DIR}...")
        shutil.rmtree(DIST_DIR)
    os.makedirs(DIST_DIR, exist_ok=True)

    # 2. Build frontend production assets
    print("[*] Ensuring frontend is built into frontend/dist ...")
    subprocess.run(["npm", "run", "build"], cwd=os.path.join(ROOT_DIR, "frontend"), check=True, shell=True)

    # 3. Copy Backend
    print("[*] Copying backend package...")
    shutil.copytree(
        os.path.join(ROOT_DIR, "backend"),
        os.path.join(DIST_DIR, "backend"),
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".pytest_cache")
    )

    # 4. Copy Frontend Built Distribution (SPA only - no node_modules required!)
    print("[*] Copying frontend/dist production bundle...")
    shutil.copytree(
        os.path.join(ROOT_DIR, "frontend", "dist"),
        os.path.join(DIST_DIR, "frontend", "dist"),
    )

    # 5. Copy Configuration & Data directories
    for folder in ["config", "reports_archive", "benchmark_videos"]:
        src = os.path.join(ROOT_DIR, folder)
        dst = os.path.join(DIST_DIR, folder)
        if os.path.exists(src):
            print(f"[*] Copying {folder}...")
            shutil.copytree(src, dst, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        else:
            os.makedirs(dst, exist_ok=True)

    # 6. Copy Tests & Acceptance Suite
    print("[*] Copying tests suite...")
    shutil.copytree(
        os.path.join(ROOT_DIR, "tests"),
        os.path.join(DIST_DIR, "tests"),
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".pytest_cache")
    )

    # 7. Copy Launchers, Configs & Documentation
    for item in ["run_application.py", "run_application.bat", "requirements.txt", "pytest.ini", "README.md"]:
        src = os.path.join(ROOT_DIR, item)
        dst = os.path.join(DIST_DIR, item)
        if os.path.exists(src):
            print(f"[*] Copying {item}...")
            shutil.copy2(src, dst)

    print("\n" + "=" * 80)
    print(" [SUCCESS] Standalone Application Package created successfully in:")
    print(f"           {DIST_DIR}")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    package()
