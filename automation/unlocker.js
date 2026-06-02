/**
 * Strip the password from a downloaded 26AS / AIS / TIS PDF.
 *
 * IT department PDF password conventions (current as of mid-2026):
 *   - Form 26AS         : DOB in DDMMYYYY (e.g. 01011990)
 *   - AIS (PDF)         : PAN (uppercase) + DOB in DDMMYYYY (e.g. ABCDE1234F01011990)
 *   - TIS (PDF)         : same as AIS
 *
 * We try every plausible combination of PAN-case + DOB so the user doesn't have
 * to remember which doc uses which format.
 *
 * Implementation: shells out to qpdf, a tiny single-file utility that handles
 * PDF encryption. We try, in order:
 *   1. <appdir>\vendor\qpdf\bin\qpdf.exe  (bundled if you ship it)
 *   2. qpdf  (from PATH)
 *
 * If qpdf isn't found, we DO NOT fail the download — we just log a friendly
 * message and leave the encrypted file alone.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BUNDLED = path.join(__dirname, '..', 'vendor', 'qpdf', 'bin', 'qpdf.exe');

/**
 * Build the list of password candidates to try.
 */
function passwordCandidates(pan, dob) {
  if (!dob) return [];
  const PAN = String(pan || '').toUpperCase();
  const pan_ = String(pan || '').toLowerCase();
  const set = new Set([
    dob,                  // 26AS
    PAN + dob,            // AIS/TIS standard
    pan_ + dob,           // AIS/TIS lowercase variant
    dob + PAN,
    dob + pan_,
    PAN,
    pan_,
  ].filter(Boolean));
  return [...set];
}

/**
 * Detect which qpdf binary to use. Returns the executable name or null.
 */
function findQpdf() {
  if (fs.existsSync(BUNDLED)) return BUNDLED;
  return 'qpdf'; // assume on PATH; spawn() will ENOENT if not
}

function runQpdf(qpdfPath, args) {
  return new Promise((resolve) => {
    let stderr = '';
    let stdout = '';
    let proc;
    try {
      proc = spawn(qpdfPath, args, { windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: e.message });
    }
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => resolve({ code: -1, stdout, stderr: stderr || e.message }));
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Inspect a PDF — returns { encrypted: bool, ok: bool, qpdfMissing: bool }.
 *
 * qpdf --show-encryption output cases:
 *   - "File is not encrypted"          -> plain PDF
 *   - "R = N\nP = ..."                 -> encrypted, password was empty/correct
 *   - "Incorrect password supplied\nR = N\n..." -> encrypted, need a password
 * The wrong-password case used to slip through because the output never
 * contains the literal word "encrypted". Assume encrypted unless qpdf
 * explicitly says otherwise.
 */
async function inspect(qpdfPath, file) {
  const r = await runQpdf(qpdfPath, ['--show-encryption', file]);
  if (r.code === -1 && /ENOENT/i.test(r.stderr)) return { encrypted: false, ok: false, qpdfMissing: true };
  const out = (r.stdout + r.stderr);
  const notEncrypted = /File is not encrypted/i.test(out);
  const looksEncrypted = /R\s*=\s*\d|Incorrect password|encryption key|User password/i.test(out);
  const encrypted = !notEncrypted && (looksEncrypted || r.code !== 0);
  return { encrypted, ok: r.code === 0 || r.code === 3, qpdfMissing: false };
}

/**
 * Try to decrypt `file` in place. Returns:
 *   { unlocked: true, password: '<which one worked>' }
 *   { unlocked: false, reason: 'not-encrypted' | 'qpdf-missing' | 'no-password-matched' | 'no-dob' }
 */
async function unlockPdf(file, { pan, dob, log } = {}) {
  if (!fs.existsSync(file)) {
    return { unlocked: false, reason: 'file-missing' };
  }

  const qpdfPath = findQpdf();

  // Probe first — if file isn't encrypted, nothing to do.
  const probe = await inspect(qpdfPath, file);
  if (probe.qpdfMissing) {
    log?.(`  qpdf not found — leaving ${path.basename(file)} encrypted. Install qpdf from https://github.com/qpdf/qpdf/releases or put qpdf.exe at vendor/qpdf/bin/qpdf.exe.`);
    return { unlocked: false, reason: 'qpdf-missing' };
  }
  if (!probe.encrypted) {
    log?.(`  ${path.basename(file)} is not encrypted`);
    return { unlocked: false, reason: 'not-encrypted' };
  }

  const candidates = passwordCandidates(pan, dob);
  if (!candidates.length) {
    log?.(`  no DOB stored for ${pan} — leaving ${path.basename(file)} encrypted`);
    return { unlocked: false, reason: 'no-dob' };
  }

  const tmp = file + '.unlocked.tmp';
  for (const pwd of candidates) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}

    const r = await runQpdf(qpdfPath, [`--password=${pwd}`, '--decrypt', file, tmp]);
    if (r.code === 0 && fs.existsSync(tmp)) {
      // Replace original with unlocked copy.
      try {
        fs.renameSync(tmp, file);
        log?.(`  unlocked ${path.basename(file)}`);
        return { unlocked: true, password: pwd };
      } catch (e) {
        log?.(`  unlocked but failed to overwrite ${path.basename(file)}: ${e.message}`);
        return { unlocked: false, reason: 'overwrite-failed' };
      }
    }
    // qpdf exits non-zero on wrong password — try the next candidate.
  }

  try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
  log?.(`  none of the ${candidates.length} password candidates worked for ${path.basename(file)}`);
  return { unlocked: false, reason: 'no-password-matched' };
}

module.exports = { unlockPdf, passwordCandidates };
