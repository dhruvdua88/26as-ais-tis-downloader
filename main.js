// Tell Playwright to look for its bundled Chromium inside the app's node_modules
// (instead of the user's AppData). MUST be set before requiring playwright/the
// downloader. Packaged builds depend on this since Chromium is shipped inside
// the .exe's resources/app/node_modules tree.
process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const XLSX = require('xlsx');
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
 * Parse a CompuOffice Excel/CSV export and return an array of
 * { name, pan, dob, password, _row } objects. Auto-detects columns by
 * matching against common CompuOffice header names.
 */
function parseCompuOfficeExcel(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) throw new Error('No data found in the Excel file.');

  // Column name aliases — CompuOffice uses various header labels.
  const ALIASES = {
    name: ['client name', 'assessee name', 'name of assessee', 'name', 'assessee', 'client'],
    pan:  ['pan no', 'pan number', 'pan', 'permanent account number', 'pan no.'],
    dob:  ['date of birth', 'dob', 'd.o.b', 'date of birth / doi', 'doi', 'date of incorporation', 'birth date'],
    password: ['it password', 'income tax password', 'efiling password', 'e-filing password', 'portal password', 'password', 'login password'],
  };

  // Match actual column headers to our fields.
  const headers = Object.keys(rows[0]);
  const colMap = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const match = headers.find(h =>
      aliases.some(a => a.toLowerCase() === h.toLowerCase().trim())
    );
    if (match) colMap[field] = match;
  }

  // Fallback: fuzzy partial match if no exact hit.
  for (const [field, aliases] of Object.entries(ALIASES)) {
    if (colMap[field]) continue;
    const match = headers.find(h =>
      aliases.some(a => h.toLowerCase().includes(a.toLowerCase()))
    );
    if (match) colMap[field] = match;
  }

  const parsed = rows.map((row, i) => ({
    _row: i + 2, // 1-based row number (1 = header)
    name:     String(row[colMap.name]     || '').trim(),
    pan:      String(row[colMap.pan]      || '').trim().toUpperCase(),
    dob:      String(row[colMap.dob]      || '').trim(),
    password: String(row[colMap.password] || '').trim(),
  })).filter(r => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(r.pan)); // valid PANs only

  return { colMap, totalRows: rows.length, validRows: parsed.length, rows: parsed };
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: '26AS AIS TIS Downloader',
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
  const win = createWindow();

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

  // ── CompuOffice Excel Import ─────────────────────────────────────────────
  ipcMain.handle('compuoffice:pick', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Select CompuOffice Excel Export',
      filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('compuoffice:preview', (_e, filePath) => {
    return parseCompuOfficeExcel(filePath);
  });

  ipcMain.handle('compuoffice:import', (_e, rows) => {
    // rows = array of { name, pan, dob, password } already validated by renderer
    const list = loadAssessees();
    const added = [], skipped = [], updated = [];

    for (const r of rows) {
      const pan = String(r.pan || '').toUpperCase().trim();
      if (!pan) continue;
      const existing = list.findIndex(x => x.pan === pan);
      const entry = {
        name: String(r.name || '').trim(),
        pan,
        password: String(r.password || ''),
        dob: normalizeDob(r.dob),
      };
      if (existing === -1) {
        list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ...entry });
        added.push(pan);
      } else if (r.overwrite) {
        list[existing] = { ...list[existing], ...entry };
        updated.push(pan);
      } else {
        skipped.push(pan);
      }
    }
    saveAssessees(list);
    return { list, added, skipped, updated };
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
