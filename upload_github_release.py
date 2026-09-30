#!/usr/bin/env python3
"""
upload_github_release.py

Automates creating a GitHub Release and uploading release assets (e.g., LaserLockAI Setup 1.0.0.exe).
Supports standard library only (no external pip dependencies required).
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path


def parse_repo_string(repo_str: str):
    """Extracts (owner, repo) from formats like:
    - owner/repo
    - https://github.com/owner/repo
    - https://github.com/owner/repo.git
    - git@github.com:owner/repo.git
    """
    clean = repo_str.strip()
    if clean.endswith(".git"):
        clean = clean[:-4]
    if "github.com/" in clean:
        clean = clean.split("github.com/")[-1]
    elif "github.com:" in clean:
        clean = clean.split("github.com:")[-1]
    
    parts = [p for p in clean.strip("/").split("/") if p]
    if len(parts) >= 2:
        return parts[0], parts[1]
    raise ValueError(f"Could not parse owner and repository name from '{repo_str}'. Format should be 'owner/repo'.")


def api_request(url: str, method: str = "GET", headers: dict = None, data: bytes = None):
    req = urllib.request.Request(url, data=data, method=method)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as resp:
            status = resp.status
            body = resp.read()
            return status, body
    except urllib.error.HTTPError as e:
        body = e.read()
        return e.code, body


def main():
    parser = argparse.ArgumentParser(description="Upload an executable or build asset to GitHub Releases.")
    parser.add_argument("--repo", required=False, help="GitHub repository as 'owner/repo' or clone URL")
    parser.add_argument("--token", required=False, help="GitHub Personal Access Token (or set GITHUB_TOKEN env var)")
    parser.add_argument("--tag", default="v1.0.0", help="Git tag for the release (default: v1.0.0)")
    parser.add_argument("--title", default="LaserLockAI v1.0.0 Release", help="Release title")
    parser.add_argument("--notes", default="Production release build for LaserLockAI Windows x64 Installer.", help="Release description notes")
    parser.add_argument("--file", default=r"release\LaserLockAI Setup 1.0.0.exe", help="Path to asset file to upload")
    parser.add_argument("--draft", action="store_true", help="Create as draft release")
    parser.add_argument("--prerelease", action="store_true", help="Create as prerelease")

    args = parser.parse_args()

    token = args.token or os.environ.get("GITHUB_TOKEN")
    if not token:
        print("[ERROR] GitHub token is required. Pass --token <TOKEN> or set GITHUB_TOKEN environment variable.")
        sys.exit(1)

    repo_arg = args.repo or os.environ.get("GITHUB_REPOSITORY")
    if not repo_arg:
        # Try to infer from git remote if available
        try:
            import subprocess
            out = subprocess.check_output(["git", "remote", "get-url", "origin"], text=True).strip()
            repo_arg = out
        except Exception:
            pass

    if not repo_arg:
        print("[ERROR] GitHub repository is required. Pass --repo owner/repo or configure git remote origin.")
        sys.exit(1)

    owner, repo = parse_repo_string(repo_arg)
    print(f"[*] Target GitHub Repository: {owner}/{repo}")

    asset_path = Path(args.file)
    if not asset_path.exists():
        print(f"[ERROR] Asset file not found: {asset_path.resolve()}")
        sys.exit(1)

    file_size_mb = asset_path.stat().st_size / (1024 * 1024)
    print(f"[*] Asset file: {asset_path.name} ({file_size_mb:.2f} MB)")

    common_headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "LaserLockAI-ReleaseUploader"
    }

    # 1. Check if release already exists for this tag
    release_url = f"https://api.github.com/repos/{owner}/{repo}/releases/tags/{args.tag}"
    status, body = api_request(release_url, headers=common_headers)
    release_data = None

    if status == 200:
        release_data = json.loads(body.decode("utf-8"))
        print(f"[*] Found existing release for tag '{args.tag}' (ID: {release_data['id']})")
    elif status == 404:
        # Create release
        print(f"[*] Creating new release '{args.title}' with tag '{args.tag}'...")
        payload = json.dumps({
            "tag_name": args.tag,
            "name": args.title,
            "body": args.notes,
            "draft": args.draft,
            "prerelease": args.prerelease
        }).encode("utf-8")
        
        post_url = f"https://api.github.com/repos/{owner}/{repo}/releases"
        headers = dict(common_headers)
        headers["Content-Type"] = "application/json"
        st, b = api_request(post_url, method="POST", headers=headers, data=payload)
        if st in (200, 201):
            release_data = json.loads(b.decode("utf-8"))
            print(f"[+] Release created successfully (ID: {release_data['id']})")
        else:
            print(f"[ERROR] Failed to create release. HTTP {st}: {b.decode('utf-8')}")
            sys.exit(1)
    else:
        print(f"[ERROR] Failed checking release for tag '{args.tag}'. HTTP {status}: {body.decode('utf-8')}")
        sys.exit(1)

    upload_url_template = release_data.get("upload_url", "")
    # format is https://uploads.github.com/repos/:owner/:repo/releases/:id/assets{?name,label}
    upload_base = upload_url_template.split("{")[0]

    # Check if asset already exists in the release
    existing_assets = release_data.get("assets", [])
    for ast in existing_assets:
        if ast.get("name") == asset_path.name:
            print(f"[*] Asset '{asset_path.name}' already exists in release. Deleting previous version...")
            del_url = ast.get("url")
            dst, db = api_request(del_url, method="DELETE", headers=common_headers)
            if dst in (204, 200):
                print("[+] Old asset removed.")
            else:
                print(f"[!] Warning: Failed to remove old asset: {db.decode('utf-8')}")

    # Upload new asset
    encoded_name = urllib.parse.quote(asset_path.name)
    upload_url = f"{upload_base}?name={encoded_name}"
    print(f"[*] Uploading {asset_path.name} to release (this may take a couple minutes depending on network speed)...")

    upload_headers = dict(common_headers)
    upload_headers["Content-Type"] = "application/octet-stream"
    upload_headers["Content-Length"] = str(asset_path.stat().st_size)

    with open(asset_path, "rb") as f:
        file_bytes = f.read()

    st, b = api_request(upload_url, method="POST", headers=upload_headers, data=file_bytes)
    if st in (200, 201):
        asset_info = json.loads(b.decode("utf-8"))
        download_url = asset_info.get("browser_download_url")
        print("\n" + "=" * 60)
        print("  [SUCCESS] RELEASE ASSET UPLOADED SUCCESSFULLY!")
        print(f"  Release Page: {release_data.get('html_url')}")
        print(f"  Direct Download: {download_url}")
        print("=" * 60)
    else:
        print(f"[ERROR] Upload failed with HTTP {st}: {b.decode('utf-8')}")
        sys.exit(1)


if __name__ == "__main__":
    main()
