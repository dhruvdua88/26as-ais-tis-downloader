// Tell Playwright to look for its bundled Chromium inside the app's node_modules
// (instead of the user's AppData). MUST be set before requiring playwright/the
// downloader. Packaged builds depend on this since Chromium is shipped inside
// the .exe's resources/app/node_modules tree.
process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { downloadAll } = require('./automation/downloader');

// Store assessees.json under %APPDATA% when packaged (resources/app is read-
// only inside the .exe), but keep using the project's data/ folder during
// development so the existing file isn't orphaned.
const DATA_DIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'data')
  : path.join(__dirname, 'data');
const ASSESSEES_FILE = path.join(DATA_DIR, 'assessees.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ASSESSEES_FILE)) fs.writeFileSync(ASSESSEES_FILE, '[]', 'utf8');
}

function loadAssessees() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(ASSESSEES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveAssessees(list) {
  ensureDataFile();
  fs.writeFileSync(ASSESSEES_FILE, JSON.stringify(list, null, 2), 'utf8');
}


/**
 * Accept DOB as DDMMYYYY, DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD.
 * Store canonical DDMMYYYY (8 digits) — matches the format the IT department
 * uses inside PDF passwords. Returns '' if input is empty/invalid.
 */
function normalizeDob(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const digits = s.replace(/[^0-9]/g, '');
  if (digits.length === 8) {
    // Heuristic: if starts with 19xx/20xx it's YYYYMMDD, else DDMMYYYY.
    if (/^(19|20)\d{6}$/.test(digits) && parseInt(digits.slice(4, 6), 10) <= 12) {
      const yyyy = digits.slice(0, 4);
      const mm = digits.slice(4, 6);
      const dd = digits.slice(6, 8);
      return dd + mm + yyyy;
    }
    return digits;
  }
  return '';
}

const ICON_PATH = path.join(__dirname, 'assets', 'icon.ico');

function createSplash() {
  const splash = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload-splash.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splash.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
  return splash;
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: '26AS AIS TIS Downloader',
    show: false,             // hidden until splash finishes
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  const splash = createSplash();

  // Create main window but keep it hidden — no reference to win in outer
  // scope yet so we can't accidentally call win.show() early.
  let win = null;

  function showMain() {
    if (win && !win.isDestroyed() && !win.isVisible()) {
      if (!splash.isDestroyed()) splash.destroy();
      win.show();
      win.focus();
    }
  }

  // Give Electron a tick to paint the splash before creating the heavier
  // main window (avoids the main window stealing focus immediately).
  setTimeout(() => {
    win = createMainWindow();

    // IPC signal from splash animation end.
    ipcMain.once('splash:done', showMain);

    // Hard fallback: show main after 4 s even if splash IPC never fires.
    setTimeout(showMain, 4000);
  }, 50);

  ipcMain.handle('assessees:list', () => loadAssessees());

  ipcMain.handle('assessees:add', (_e, a) => {
    const list = loadAssessees();
    const pan = String(a.pan || '').toUpperCase().trim();
    if (!pan) throw new Error('PAN required');
    if (list.some(x => x.pan === pan)) throw new Error('PAN already exists');
    list.push({
      id: Date.now().toString(36),
      name: String(a.name || '').trim(),
      pan,
      password: String(a.password || ''),
      dob: normalizeDob(a.dob),
    });
    saveAssessees(list);
    return list;
  });

  ipcMain.handle('assessees:update', (_e, a) => {
    const list = loadAssessees();
    const idx = list.findIndex(x => x.id === a.id);
    if (idx === -1) throw new Error('Assessee not found');
    list[idx] = {
      ...list[idx],
      name: String(a.name || '').trim(),
      pan: String(a.pan || '').toUpperCase().trim(),
      password: String(a.password || ''),
      dob: normalizeDob(a.dob),
    };
    saveAssessees(list);
    return list;
  });

  ipcMain.handle('assessees:delete', (_e, id) => {
    const list = loadAssessees().filter(x => x.id !== id);
    saveAssessees(list);
    return list;
  });

  ipcMain.handle('download:run', async (_e, { id, which, zip = false }) => {
    const list = loadAssessees();
    const assessee = list.find(x => x.id === id);
    if (!assessee) throw new Error('Assessee not found');

    // Create a dedicated folder inside Downloads named after the assessee.
    // Sanitise: strip characters Windows doesn't allow in folder names.
    const folderName = (assessee.name || assessee.pan)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .trim() || assessee.pan;
    const downloadsDir = path.join(app.getPath('downloads'), folderName);
    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

    const notify = (msg) => win.webContents.send('download:log', { id, msg });
    let saved = [];
    let zipPath = null;

    try {
      saved = await downloadAll({
        assessee,
        which,
        downloadsDir,
        onLog: notify,
      });

      // ZIP mode — compress all saved files into one archive inside the folder.
      if (zip && saved.length > 0) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        zipPath = path.join(downloadsDir, `${assessee.pan}_${stamp}.zip`);
        notify(`Creating ZIP: ${path.basename(zipPath)}`);
        await zipFiles(saved, zipPath);
        notify(`ZIP saved: ${zipPath}`);
      }

      return zip ? [zipPath] : saved;
    } catch (e) {
      if (Array.isArray(e?.savedFiles)) saved = e.savedFiles;
      throw e;
    } finally {
      // Always open the assessee folder when done.
      try {
        await shell.openPath(downloadsDir);
        notify(`Opened folder: ${downloadsDir}`);
      } catch {}
    }
  });

  /**
   * Zip an array of files using PowerShell's Compress-Archive.
   * No npm packages required — PowerShell ships with every modern Windows.
   */
  function zipFiles(files, destZip) {
    return new Promise((resolve, reject) => {
      // Build a comma-separated quoted list of source paths for PowerShell.
      const sources = files.map((f) => `'${f.replace(/'/g, "''")}'`).join(',');
      const script = `Compress-Archive -Path ${sources} -DestinationPath '${destZip.replace(/'/g, "''")}' -Force`;
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(destZip);
      });
    });
  }

  ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createMainWindow();
      w.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
