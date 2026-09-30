// electron/main.js
'use strict';

const { app, BrowserWindow, Tray, Menu, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn, execSync } = require('child_process');

// ── Single-instance lock ────────────────────────────────────────────────────
const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
  process.exit(0);
}

// ── Paths ──────────────────────────────────────────────────────────────────
const IS_PACKAGED = app.isPackaged;
const SIDECAR_DIR = IS_PACKAGED
  ? path.join(process.resourcesPath, 'sidecar')
  : path.join(__dirname, '..', 'dist', 'laserlockaiapp_backend');

const SIDECAR_EXE = path.join(SIDECAR_DIR, 'laserlockaiapp_backend.exe');
const PORT_FILE   = path.join(os.tmpdir(), 'laserlockaiapp_port.json');

// ── State ──────────────────────────────────────────────────────────────────
let mainWindow   = null;
let splashWindow = null;
let tray         = null;
let backendProc  = null;

// ── Helpers ────────────────────────────────────────────────────────────────
function deletePortFile() {
  try { fs.unlinkSync(PORT_FILE); } catch (_) {}
}

function readPort(retries = 60, delay = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = setInterval(() => {
      try {
        if (fs.existsSync(PORT_FILE)) {
          const content = fs.readFileSync(PORT_FILE, 'utf8').trim();
          if (content) {
            const data = JSON.parse(content);
            if (data && data.port) {
              clearInterval(poll);
              resolve(data.port);
              return;
            }
          }
        }
      } catch (_) {
        // File may be midway through being written, retry
      }
      if (++attempts >= retries) {
        clearInterval(poll);
        reject(new Error('Backend did not write port file in time.'));
      }
    }, delay);
  });
}

function waitForBackend(port, retries = 60, delay = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = setInterval(() => {
      const req = http.get(`http://127.0.0.1:${port}/api/status`, (res) => {
        if (res.statusCode === 200) {
          clearInterval(poll);
          resolve(port);
        }
      });
      req.on('error', () => {
        if (++attempts >= retries) {
          clearInterval(poll);
          reject(new Error('Backend health-check timed out.'));
        }
      });
      req.setTimeout(1000, () => {
        req.destroy();
      });
      req.end();
    }, delay);
  });
}

// ── Splash Window ──────────────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width:          560,
    height:         320,
    frame:          false,
    transparent:    true,
    resizable:      false,
    alwaysOnTop:    true,
    skipTaskbar:    true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

// ── Main Window ────────────────────────────────────────────────────────────
function createMainWindow(port) {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  const hasIcon = fs.existsSync(iconPath);

  mainWindow = new BrowserWindow({
    width:           1440,
    height:          900,
    minWidth:        1024,
    minHeight:       640,
    show:            false,
    title:           'LaserLockAI — FSOC Coarse Alignment Tracking',
    icon:            hasIcon ? iconPath : undefined,
    backgroundColor: '#050510',
    webPreferences: {
      nodeIntegration:             false,
      contextIsolation:            true,
      webSecurity:                 true,
      allowRunningInsecureContent: false,
    },
  });

  // Content Security Policy — allow loopback API + WebSocket only
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "img-src 'self' data: blob:; " +
          "font-src 'self' data: https://fonts.gstatic.com;"
        ],
      },
    });
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.destroy();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  // External links → real browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Close button → minimize to tray (not quit)
  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── System Tray ────────────────────────────────────────────────────────────
function createTray() {
  const trayIconPath = path.join(__dirname, 'assets', 'tray.ico');
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  const selectedIcon = fs.existsSync(trayIconPath)
    ? trayIconPath
    : (fs.existsSync(iconPath) ? iconPath : null);

  if (!selectedIcon) return;

  try {
    tray = new Tray(selectedIcon);
    const menu = Menu.buildFromTemplate([
      {
        label: 'Open LaserLockAI',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit LaserLockAI',
        click: () => {
          app.isQuiting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(menu);
    tray.setToolTip('LaserLockAI — FSOC Coarse Alignment Tracking');
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (err) {
    console.error('[tray] Failed to initialize system tray:', err);
  }
}

// ── Backend Sidecar ────────────────────────────────────────────────────────
function launchBackend() {
  deletePortFile();

  if (fs.existsSync(SIDECAR_EXE)) {
    backendProc = spawn(SIDECAR_EXE, [], {
      cwd:         SIDECAR_DIR,
      stdio:       'ignore',
      detached:    false,
      windowsHide: true,
    });
  } else {
    // Development fallback when run directly via electron .
    const sidecarScript = path.join(__dirname, 'python_sidecar.py');
    backendProc = spawn('python', [sidecarScript], {
      cwd:         path.join(__dirname, '..'),
      stdio:       'ignore',
      detached:    false,
      windowsHide: true,
    });
  }

  backendProc.on('error', (err) => console.error('[sidecar] spawn error:', err));
  backendProc.on('exit',  (code) => console.log('[sidecar] exited with code', code));
}

function killBackend() {
  if (backendProc && backendProc.pid) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /T /PID ${backendProc.pid}`, { stdio: 'ignore' });
      } else {
        backendProc.kill('SIGTERM');
      }
    } catch (_) {
      try { backendProc.kill(); } catch (_) {}
    }
    backendProc = null;
  }
  deletePortFile();
}

// ── App Lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createSplash();
  launchBackend();
  createTray();

  try {
    const port = await readPort();
    await waitForBackend(port);
    createMainWindow(port);
  } catch (err) {
    console.error('[LaserLockAI] startup error:', err);
    if (splashWindow) {
      splashWindow.destroy();
      splashWindow = null;
    }
    app.quit();
  }
});

// Second-instance → focus existing window
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// Keep process alive on Windows (lives in tray until quit explicitly)
app.on('window-all-closed', (e) => {
  // Minimize to tray behavior on Windows
});

app.on('before-quit', () => {
  app.isQuiting = true;
  killBackend();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
});
