// electron/main.js
'use strict';

const { app, BrowserWindow, Tray, Menu, session, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn, execSync } = require('child_process');

// ── Persistent File Logger ──────────────────────────────────────────────────
const LOG_DIR = path.join(process.env.APPDATA || os.homedir(), 'LaserLockAI');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
const LOG_FILE = path.join(LOG_DIR, 'electron_runtime.log');

function log(...args) {
  const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
  const line = `[${new Date().toISOString()}] ${text}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch (_) {}
  console.log(...args);
}

log('================================================================');
log(`[LaserLockAI] Starting Electron (Packaged: ${app.isPackaged})`);
log(`[LaserLockAI] Version: ${app.getVersion()}`);
log('================================================================');

process.on('uncaughtException', (err) => {
  log(`[CRITICAL] Uncaught exception: ${err ? (err.stack || err.message) : err}`);
});

process.on('unhandledRejection', (reason) => {
  log(`[CRITICAL] Unhandled rejection: ${reason ? (reason.stack || reason.message) : reason}`);
});

// ── Single-instance lock ────────────────────────────────────────────────────
const lock = app.requestSingleInstanceLock();
if (!lock) {
  log('[LaserLockAI] Another instance is already running. Quitting.');
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

log(`[Paths] SIDECAR_DIR: ${SIDECAR_DIR}`);
log(`[Paths] SIDECAR_EXE: ${SIDECAR_EXE} (Exists: ${fs.existsSync(SIDECAR_EXE)})`);
log(`[Paths] PORT_FILE:   ${PORT_FILE}`);

// ── State ──────────────────────────────────────────────────────────────────
let mainWindow   = null;
let splashWindow = null;
let tray         = null;
let backendProc  = null;
let isQuitting   = false;

// ── Helpers ────────────────────────────────────────────────────────────────
function deletePortFile() {
  try { fs.unlinkSync(PORT_FILE); } catch (_) {}
}

function readPort(retries = 90, delay = 500) {
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
              log(`[readPort] Successfully found port: ${data.port}`);
              resolve(data.port);
              return;
            }
          }
        }
      } catch (e) {
        log(`[readPort] Parse error on attempt ${attempts}: ${e.message}`);
      }

      // Check if backend died while waiting
      if (backendProc && backendProc.exitCode !== null) {
        clearInterval(poll);
        reject(new Error(`Backend sidecar terminated unexpectedly with exit code ${backendProc.exitCode}. Check %APPDATA%\\LaserLockAI\\backend.log for details.`));
        return;
      }

      if (++attempts >= retries) {
        clearInterval(poll);
        reject(new Error(`Timed out waiting for backend to write port file (${PORT_FILE}). Check %APPDATA%\\LaserLockAI\\backend.log for errors.`));
      }
    }, delay);
  });
}

function waitForBackend(port, retries = 90, delay = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = setInterval(() => {
      const req = http.get(`http://127.0.0.1:${port}/api/status`, (res) => {
        res.resume(); // consume response body
        if (res.statusCode === 200) {
          clearInterval(poll);
          log(`[waitForBackend] Backend is responsive at http://127.0.0.1:${port} (Status 200)`);
          resolve(port);
        } else {
          log(`[waitForBackend] Non-200 status code: ${res.statusCode}`);
        }
      });

      req.on('error', (err) => {
        if (attempts % 10 === 0) {
          log(`[waitForBackend] Waiting for http://127.0.0.1:${port}/api/status (${err.message})...`);
        }
        if (++attempts >= retries) {
          clearInterval(poll);
          reject(new Error(`Backend health-check timed out after ${attempts} attempts.`));
        }
      });

      req.setTimeout(2000, () => {
        req.destroy();
      });

      req.end();
    }, delay);
  });
}

// ── Splash Window ──────────────────────────────────────────────────────────
function createSplash() {
  log('[Splash] Creating splash window');
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
  log(`[MainWindow] Creating main window for port ${port}`);
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

  // Content Security Policy
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

  let hasShown = false;
  const showMainWindow = () => {
    if (hasShown) return;
    hasShown = true;
    log('[MainWindow] Revealing main window to user');
    mainWindow.show();
    mainWindow.focus();

    // Destroy splash window only AFTER main window is visible
    if (splashWindow && !splashWindow.isDestroyed()) {
      log('[Splash] Destroying splash window');
      splashWindow.destroy();
      splashWindow = null;
    }
  };

  mainWindow.once('ready-to-show', () => {
    log('[MainWindow] ready-to-show event received');
    showMainWindow();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    log('[MainWindow] did-finish-load event received');
    showMainWindow();
  });

  mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => {
    log(`[MainWindow] did-fail-load: ${code} - ${desc} (${url})`);
  });

  // Fallback safety: ensure window is revealed within 3.5s regardless
  setTimeout(() => {
    if (mainWindow && !hasShown) {
      log('[MainWindow] Fallback reveal triggered');
      showMainWindow();
    }
  }, 3500);

  log(`[MainWindow] Loading URL: http://127.0.0.1:${port}`);
  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  // External links → real browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', () => {
    log('[MainWindow] Window close requested by user');
    isQuitting = true;
  });

  mainWindow.on('closed', () => {
    log('[MainWindow] Window closed event');
    mainWindow = null;
    killBackend();
    app.quit();
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
          isQuitting = true;
          killBackend();
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
    log('[Tray] System tray initialized');
  } catch (err) {
    log(`[Tray] Failed to initialize system tray: ${err.message}`);
  }
}

// ── Backend Sidecar ────────────────────────────────────────────────────────
function launchBackend() {
  deletePortFile();

  if (fs.existsSync(SIDECAR_EXE)) {
    log(`[Sidecar] Spawning frozen executable: ${SIDECAR_EXE}`);
    backendProc = spawn(SIDECAR_EXE, [], {
      cwd:         SIDECAR_DIR,
      stdio:       'ignore',
      detached:    false,
      windowsHide: true,
    });
  } else {
    const sidecarScript = path.join(__dirname, 'python_sidecar.py');
    log(`[Sidecar] Spawning development script: ${sidecarScript}`);
    backendProc = spawn('python', [sidecarScript], {
      cwd:         path.join(__dirname, '..'),
      stdio:       'ignore',
      detached:    false,
      windowsHide: true,
    });
  }

  backendProc.on('error', (err) => log(`[Sidecar] Spawn error: ${err.message}`));
  backendProc.on('exit',  (code) => log(`[Sidecar] Exited with code: ${code}`));
}

function killBackend() {
  if (backendProc && backendProc.pid) {
    log(`[Sidecar] Killing backend process (PID: ${backendProc.pid})`);
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
  log('[App] app.whenReady fired');
  createSplash();
  launchBackend();
  createTray();

  try {
    const port = await readPort();
    await waitForBackend(port);
    createMainWindow(port);
  } catch (err) {
    log(`[App] Startup error: ${err.message}`);
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.destroy();
      splashWindow = null;
    }
    dialog.showErrorBox(
      'LaserLockAI Startup Error',
      `${err.message}\n\nPlease check logs at:\n${path.join(LOG_DIR, 'electron_runtime.log')}\n${path.join(LOG_DIR, 'backend.log')}`
    );
    isQuitting = true;
    killBackend();
    app.quit();
  }
});

// Second-instance → focus existing window
app.on('second-instance', () => {
  log('[App] second-instance fired');
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// Protect window-all-closed from closing prematurely during splash -> main window transition
app.on('window-all-closed', () => {
  log('[App] window-all-closed fired');
  if (isQuitting || (!mainWindow && !splashWindow)) {
    killBackend();
    app.quit();
  }
});

app.on('before-quit', () => {
  log('[App] before-quit fired');
  isQuitting = true;
  killBackend();
});

process.on('exit', () => {
  killBackend();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
});
