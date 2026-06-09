/**
 * Bulk-import assessees from an Excel (.xlsx/.xls) or CSV file, and generate a
 * blank template the user can fill in.
 *
 * Expected columns (header row, case/spacing-insensitive — order doesn't matter):
 *   Name      — assessee / client name        (optional, falls back to PAN)
 *   PAN       — 10-char PAN                    (required)
 *   Password  — IT e-Filing portal password    (required to log in)
 *   DOB       — date of birth / incorporation  (optional; needed only to auto-unlock PDFs)
 *
 * DOB accepts DDMMYYYY, DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, or a real Excel date
 * cell. Stored canonical as DDMMYYYY (what the IT department uses in PDF passwords).
 */

const XLSX = require('xlsx');

// Map many possible header spellings to our canonical field names.
const HEADER_ALIASES = {
  name: ['name', 'assessee', 'assesseename', 'clientname', 'client', 'partyname'],
  pan: ['pan', 'panno', 'pannumber', 'pancard'],
  password: ['password', 'pass', 'pwd', 'portalpassword', 'itpassword', 'loginpassword'],
  dob: ['dob', 'dateofbirth', 'doi', 'dateofincorporation', 'birthdate', 'dobdoi'],
};

function normHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function canonicalField(header) {
  const n = normHeader(header);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(n)) return field;
  }
  return null;
}

/**
 * Normalise a DOB cell (string OR Excel serial-date number OR JS Date) to
 * canonical DDMMYYYY. Returns '' when empty/unparseable.
 */
function normalizeDob(raw) {
  if (raw === null || raw === undefined || raw === '') return '';

  // Excel sometimes hands us a real Date (when cellDates:true) or a serial number.
  if (raw instanceof Date && !isNaN(raw)) {
    return pad2(raw.getDate()) + pad2(raw.getMonth() + 1) + raw.getFullYear();
  }
  if (typeof raw === 'number') {
    const d = XLSX.SSF ? XLSX.SSF.parse_date_code(raw) : null;
    if (d && d.y) return pad2(d.d) + pad2(d.m) + d.y;
  }

  const s = String(raw).trim();
  const digits = s.replace(/[^0-9]/g, '');
  if (digits.length === 8) {
    // YYYYMMDD vs DDMMYYYY heuristic.
    if (/^(19|20)\d{6}$/.test(digits) && parseInt(digits.slice(4, 6), 10) <= 12) {
      return digits.slice(6, 8) + digits.slice(4, 6) + digits.slice(0, 4);
    }
    return digits;
  }
  return '';
}

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * Parse a spreadsheet/CSV file into a list of raw assessee objects.
 * Returns { rows: [{name,pan,password,dob}], errors: [string], headerMap }.
 * Does NOT validate PAN/dedupe — the caller (main) does that against the store.
 */
function parseAssesseesFile(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], errors: ['The file has no sheets.'] };

  const sheet = wb.Sheets[sheetName];
  // header:1 → array-of-arrays so we control header mapping ourselves.
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  if (!matrix.length) return { rows: [], errors: ['The first sheet is empty.'] };

  const headerRow = matrix[0];
  const colToField = {};
  headerRow.forEach((h, i) => {
    const f = canonicalField(h);
    if (f) colToField[i] = f;
  });

  const fieldsFound = new Set(Object.values(colToField));
  const errors = [];
  if (!fieldsFound.has('pan')) errors.push('No "PAN" column found in the header row.');
  if (!fieldsFound.has('password')) errors.push('No "Password" column found in the header row.');
  if (errors.length) return { rows: [], errors };

  const rows = [];
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r];
    if (!cells || cells.every((c) => String(c).trim() === '')) continue; // skip blank line
    const rec = { name: '', pan: '', password: '', dob: '' };
    for (const [colIdx, field] of Object.entries(colToField)) {
      rec[field] = cells[colIdx];
    }
    rows.push({
      name: String(rec.name || '').trim(),
      pan: String(rec.pan || '').toUpperCase().replace(/\s/g, '').trim(),
      password: String(rec.password == null ? '' : rec.password),
      dob: normalizeDob(rec.dob),
    });
  }
  return { rows, errors: [], headerMap: colToField };
}

/**
 * Write a ready-to-fill template workbook to `filePath` (an .xlsx path).
 * Includes the header row, one example row, and an instructions sheet.
 */
function writeTemplate(filePath) {
  const data = [
    ['Name', 'PAN', 'Password', 'DOB'],
    ['Example Client Pvt Ltd', 'ABCDE1234F', 'YourPortalPassword@123', '01/01/1990'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 24 }, { wch: 14 }];

  const help = [
    ['How to use this template'],
    [''],
    ['1. Fill ONE row per assessee, starting from row 2 (keep the header row as-is).'],
    ['2. Name     — client / assessee name (optional; PAN is used if left blank).'],
    ['3. PAN      — 10-character PAN, e.g. ABCDE1234F (REQUIRED).'],
    ['4. Password — the Income Tax e-Filing portal login password (REQUIRED).'],
    ['5. DOB      — date of birth (individuals) or incorporation (companies).'],
    ['            Accepts DD/MM/YYYY, DDMMYYYY or a real date cell.'],
    ['            Only needed to auto-remove the password from downloaded PDFs.'],
    [''],
    ['6. Save the file, then in the app click "Import from Excel" and pick it.'],
    ['7. Delete the example row in the data sheet before importing.'],
  ];
  const wsHelp = XLSX.utils.aoa_to_sheet(help);
  wsHelp['!cols'] = [{ wch: 80 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Assessees');
  XLSX.utils.book_append_sheet(wb, wsHelp, 'Instructions');
  XLSX.writeFile(wb, filePath);
  return filePath;
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

module.exports = { parseAssesseesFile, writeTemplate, normalizeDob, PAN_RE };
