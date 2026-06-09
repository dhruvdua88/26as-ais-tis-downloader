const $ = (sel) => document.querySelector(sel);
const tbody = $('#assessee-table tbody');
const emptyHint = $('#empty-hint');
const logEl = $('#log');

let editingId = null;
let downloadingId = null;
let batchMode = false;

function logLine(msg) {
  const ts = new Date().toLocaleTimeString();
  logEl.textContent += `[${ts}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function maskPwd(p) {
  if (!p) return '';
  return '•'.repeat(Math.min(p.length, 10));
}

function render(list) {
  tbody.innerHTML = '';
  if (!list.length) {
    emptyHint.hidden = false;
    return;
  }
  emptyHint.hidden = true;
  for (const a of list) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(a.name) || '<span class="pwd-mask">(no name)</span>'}</td>
      <td class="pan-mono">${escapeHtml(a.pan)}</td>
      <td class="pan-mono">${escapeHtml(formatDob(a.dob)) || '<span class="pwd-mask">—</span>'}</td>
      <td class="pwd-mask">${maskPwd(a.password)}</td>
      <td class="actions row-btns">
        <button class="primary" data-act="download" data-id="${a.id}">Download</button>
        <button class="ghost" data-act="edit" data-id="${a.id}">Edit</button>
        <button class="danger" data-act="delete" data-id="${a.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function formatDob(dob) {
  const s = String(dob || '');
  if (/^\d{8}$/.test(s)) return `${s.slice(0,2)}/${s.slice(2,4)}/${s.slice(4)}`;
  return s;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function refresh() {
  const list = await window.api.list();
  render(list);
}

function openModal({ id = null, name = '', pan = '', password = '', dob = '' } = {}) {
  editingId = id;
  $('#modal-title').textContent = id ? 'Edit Assessee' : 'Add Assessee';
  $('#f-name').value = name;
  $('#f-pan').value = pan;
  $('#f-dob').value = formatDob(dob);
  $('#f-password').value = password;
  $('#modal').hidden = false;
  $('#f-name').focus();
}

function closeModal() {
  $('#modal').hidden = true;
  editingId = null;
}

async function saveModal() {
  const payload = {
    name: $('#f-name').value.trim(),
    pan: $('#f-pan').value.trim().toUpperCase(),
    password: $('#f-password').value,
    dob: $('#f-dob').value.trim(),
  };
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(payload.pan)) {
    alert('Enter a valid PAN (e.g. ABCDE1234F)');
    return;
  }
  if (payload.dob && !/^\d{8}$/.test(payload.dob.replace(/[^0-9]/g, ''))) {
    alert('Enter DOB as DDMMYYYY or DD/MM/YYYY (e.g. 01011990 or 01/01/1990). Leave blank to skip PDF unlock.');
    return;
  }
  try {
    if (editingId) {
      await window.api.update({ id: editingId, ...payload });
    } else {
      await window.api.add(payload);
    }
    closeModal();
    refresh();
  } catch (e) {
    alert(e.message || String(e));
  }
}

function openDownloadModal(a) {
  batchMode = false;
  downloadingId = a.id;
  $('#dl-name').textContent = a.name || a.pan;
  $('#opt-26as').checked = true;
  $('#opt-ais').checked = true;
  $('#opt-tis').checked = true;
  $('#dl-modal').hidden = false;
}

async function openBatchModal() {
  const list = await window.api.list();
  if (!list.length) { alert('Add or import at least one assessee first.'); return; }
  batchMode = true;
  downloadingId = null;
  $('#dl-name').textContent = `ALL ${list.length} assessee(s)`;
  $('#opt-26as').checked = true;
  $('#opt-ais').checked = true;
  $('#opt-tis').checked = true;
  $('#dl-modal').hidden = false;
}

function setProgress(done, total) {
  const wrap = $('#progress-wrap');
  if (total <= 0) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const pct = Math.round((done / total) * 100);
  $('#progress-bar').style.width = pct + '%';
  $('#progress-text').textContent = `${done} / ${total} done`;
}

async function importExcel() {
  logLine('Opening file picker for Excel/CSV import…');
  const r = await window.api.importExcel();
  if (r.canceled) { logLine('Import cancelled.'); return; }
  if (r.error) { alert(r.error); logLine('Import failed: ' + r.error); return; }
  logLine(`Import: ${r.added} added, ${r.skipped} duplicate(s) skipped, ${r.invalid} invalid PAN(s) of ${r.total} row(s).`);
  if (r.invalid && r.invalidRows?.length) logLine('  Invalid PANs: ' + r.invalidRows.join(', '));
  refresh();
}

async function downloadTemplate() {
  const r = await window.api.downloadTemplate();
  if (r.canceled) return;
  if (r.error) { alert(r.error); return; }
  logLine('Template saved: ' + r.path);
}

function closeDownloadModal() {
  $('#dl-modal').hidden = true;
  downloadingId = null;
}

function getWhich() {
  const which = [];
  if ($('#opt-26as').checked) which.push('26AS');
  if ($('#opt-ais').checked) which.push('AIS');
  if ($('#opt-tis').checked) which.push('TIS');
  return which;
}

async function startDownload(zip = false) {
  const which = getWhich();
  if (!which.length) {
    alert('Select at least one document.');
    return;
  }
  const id = downloadingId;
  const isBatch = batchMode;
  closeDownloadModal();
  setBusy(true);
  logLine(`Starting ${isBatch ? 'BATCH ' : ''}download for ${which.join(', ')}${zip ? ' (ZIP)' : ''}…`);
  try {
    if (isBatch) {
      const r = await window.api.downloadBatch({ which, zip });
      const ok = r.summary.filter(s => !s.error && s.files > 0).length;
      logLine(`Batch complete — ${ok}/${r.summary.length} succeeded. Folder: ${r.runDir}`);
      for (const s of r.summary) {
        logLine(`   ${s.pan}: ${s.error ? 'FAILED — ' + s.error : s.files + ' file(s)'}`);
      }
    } else {
      const result = await window.api.download({ id, which, zip });
      logLine('Done. ' + (zip ? 'ZIP: ' : 'Files: ') + JSON.stringify(result));
    }
  } catch (e) {
    logLine('ERROR: ' + (e.message || e));
  } finally {
    setBusy(false);
    setProgress(0, 0);
  }
}

function setBusy(busy) {
  for (const sel of ['#btn-add', '#btn-import', '#btn-template', '#btn-download-all']) {
    const el = $(sel); if (el) el.disabled = busy;
  }
}

document.addEventListener('click', async (e) => {
  const t = e.target;
  // Assessee CRUD
  if (t.id === 'btn-add') openModal();
  else if (t.id === 'btn-import') importExcel();
  else if (t.id === 'btn-template') downloadTemplate();
  else if (t.id === 'btn-download-all') openBatchModal();
  else if (t.id === 'm-cancel') closeModal();
  else if (t.id === 'm-save') saveModal();
  // Download modal
  else if (t.id === 'dl-cancel') closeDownloadModal();
  else if (t.id === 'dl-go') startDownload(false);
  else if (t.id === 'dl-zip') startDownload(true);
  // Log
  else if (t.id === 'btn-clear-log') { logEl.textContent = ''; }
  // Row actions
  else if (t.dataset.act) {
    const id = t.dataset.id;
    const list = await window.api.list();
    const a = list.find(x => x.id === id);
    if (!a) return;
    if (t.dataset.act === 'edit') openModal(a);
    else if (t.dataset.act === 'delete') {
      if (confirm(`Delete ${a.name || a.pan}?`)) {
        await window.api.remove(id);
        refresh();
      }
    }
    else if (t.dataset.act === 'download') openDownloadModal(a);
  }
});

window.api.onLog(({ msg }) => logLine(msg));
window.api.onProgress(({ done, total }) => setProgress(done, total));

refresh();
