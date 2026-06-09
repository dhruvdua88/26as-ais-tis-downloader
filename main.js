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
const { parseAssesseesFile, writeTemplate, PAN_RE } = require('./automation/importer');

// Root for all downloads: <Downloads>/26AS-AIS-TIS/Run-<timestamp>/<PAN>/
function runStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-06-09T11-30-00
}
function runRoot(stamp) {
  return path.join(app.getPath('downloads'), '26AS-AIS-TIS', `Run-${stamp}`);
}
function safePan(assessee) {
  return String(assessee.pan || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
let idSeq = 0; // ensures unique ids when bulk-importing within the same millisecond

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

  /**
   * Download docs for ONE assessee into <runDir>/<PAN>/. Returns the list of
   * saved file paths (plus a zip if requested). Never throws on a doc-level
   * failure — those are logged; only a hard launch/login error propagates.
   */
  async function runForAssessee(assessee, which, runDir, zip, notify) {
    const dir = path.join(runDir, safePan(assessee));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let saved = [];
    try {
      saved = await downloadAll({ assessee, which, downloadsDir: dir, onLog: notify });
      if (zip && saved.length > 0) {
        const zipPath = path.join(dir, `${safePan(assessee)}.zip`);
        notify(`Creating ZIP: ${path.basename(zipPath)}`);
        await zipFiles(saved, zipPath);
        notify(`ZIP saved: ${zipPath}`);
        return { saved, zip: zipPath, dir };
      }
      return { saved, zip: null, dir };
    } catch (e) {
      if (Array.isArray(e?.savedFiles)) saved = e.savedFiles;
      notify(`ERROR for ${assessee.pan}: ${e.message || e}`);
      return { saved, zip: null, dir, error: e.message || String(e) };
    }
  }

  // Single assessee — its own timestamped run folder.
  ipcMain.handle('download:run', async (_e, { id, which, zip = false }) => {
    const list = loadAssessees();
    const assessee = list.find(x => x.id === id);
    if (!assessee) throw new Error('Assessee not found');

    const stamp = runStamp();
    const runDir = runRoot(stamp);
    if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true });
    const notify = (msg) => win.webContents.send('download:log', { id, msg });

    const r = await runForAssessee(assessee, which, runDir, zip, notify);
    try { await shell.openPath(runDir); notify(`Opened folder: ${runDir}`); } catch {}
    if (r.error && r.saved.length === 0) throw new Error(r.error);
    return zip ? (r.zip ? [r.zip] : []) : r.saved;
  });

  // Batch — every assessee, ONE shared timestamped run folder, per-PAN subfolders.
  ipcMain.handle('download:runBatch', async (_e, { ids = null, which, zip = false }) => {
    let list = loadAssessees();
    if (Array.isArray(ids) && ids.length) list = list.filter(x => ids.includes(x.id));
    if (!list.length) throw new Error('No assessees to download.');

    const stamp = runStamp();
    const runDir = runRoot(stamp);
    if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true });
    const notify = (msg) => win.webContents.send('download:log', { id: 'batch', msg });

    notify(`Batch start — ${list.length} assessee(s) → ${runDir}`);
    const summary = [];
    let i = 0;
    for (const assessee of list) {
      i++;
      notify(`[${i}/${list.length}] ${assessee.name || assessee.pan} (${assessee.pan})`);
      win.webContents.send('download:progress', { done: i - 1, total: list.length, pan: assessee.pan });
      const r = await runForAssessee(assessee, which, runDir, zip, notify);
      summary.push({ pan: assessee.pan, name: assessee.name, files: r.saved.length, error: r.error || null });
    }
    win.webContents.send('download:progress', { done: list.length, total: list.length, pan: null });

    const ok = summary.filter(s => !s.error && s.files > 0).length;
    notify(`Batch done — ${ok}/${list.length} assessee(s) downloaded successfully. Folder: ${runDir}`);
    try { await shell.openPath(runDir); } catch {}
    return { runDir, summary };
  });

  // Bulk import assessees from an Excel/CSV file the user picks.
  ipcMain.handle('assessees:importExcel', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Select an Excel or CSV file of assessees',
      properties: ['openFile'],
      filters: [{ name: 'Spreadsheet', extensions: ['xlsx', 'xls', 'csv'] }],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };

    let parsed;
    try {
      parsed = parseAssesseesFile(res.filePaths[0]);
    } catch (e) {
      return { error: `Could not read the file: ${e.message}` };
    }
    if (parsed.errors.length) return { error: parsed.errors.join(' ') };

    const list = loadAssessees();
    const existing = new Set(list.map(x => x.pan));
    let added = 0, skipped = 0, invalid = 0;
    const invalidRows = [];

    for (const row of parsed.rows) {
      if (!PAN_RE.test(row.pan)) { invalid++; invalidRows.push(row.pan || '(blank PAN)'); continue; }
      if (existing.has(row.pan)) { skipped++; continue; }
      list.push({
        id: Date.now().toString(36) + '-' + (idSeq++).toString(36),
        name: row.name, pan: row.pan, password: row.password, dob: row.dob,
      });
      existing.add(row.pan);
      added++;
    }
    saveAssessees(list);
    return { added, skipped, invalid, invalidRows: invalidRows.slice(0, 10), total: parsed.rows.length, list };
  });

  // Save a blank fill-in template to a location the user picks.
  ipcMain.handle('assessees:downloadTemplate', async () => {
    const res = await dialog.showSaveDialog(win, {
      title: 'Save the assessee import template',
      defaultPath: 'assessees-template.xlsx',
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    try {
      writeTemplate(res.filePath);
      try { await shell.showItemInFolder(res.filePath); } catch {}
      return { path: res.filePath };
    } catch (e) {
      return { error: e.message };
    }
  });

  /**
   * Zip an array of files into destZip. Cross-platform, no npm packages:
   *   - Windows: PowerShell's Compress-Archive (ships with every modern Windows)
   *   - macOS / Linux: the `zip` CLI (preinstalled on macOS; `apt install zip` on Linux)
   * Files are stored flat (no directory paths) inside the archive.
   */
  function zipFiles(files, destZip) {
    return new Promise((resolve, reject) => {
      if (process.platform === 'win32') {
        const sources = files.map((f) => `'${f.replace(/'/g, "''")}'`).join(',');
        const script = `Compress-Archive -Path ${sources} -DestinationPath '${destZip.replace(/'/g, "''")}' -Force`;
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || err.message));
          resolve(destZip);
        });
      } else {
        // `zip -j -X dest file...` — -j junks paths (flat archive), -X drops extra
        // attributes. Overwrite any stale archive first so -Force semantics match.
        try { if (fs.existsSync(destZip)) fs.unlinkSync(destZip); } catch {}
        execFile('zip', ['-j', '-X', destZip, ...files], (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || err.message));
          resolve(destZip);
        });
      }
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
