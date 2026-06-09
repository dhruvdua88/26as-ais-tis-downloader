# 26AS / AIS / TIS Downloader

> One-click **bulk** downloader of **Form 26AS**, **AIS** (Annual Information Statement) and **TIS** (Taxpayer Information Summary) from the Indian Income Tax e-Filing portal — built for CA firms and their staff.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Made with Electron](https://img.shields.io/badge/made%20with-Electron-47848f)

> This is a fork of the original by CA Akshay Daiya, extended for **cross-platform (Windows + macOS)** use, **bulk import from Excel**, and **timestamped per-PAN output folders**.

---

## What it does

For every client (assessee) you add, the app logs into the IT e-Filing portal with their PAN + password and downloads:

- **Form 26AS** (via TRACES)
- **AIS** — Annual Information Statement
- **TIS** — Taxpayer Information Summary

It then **auto-removes the PDF password** (using the client's date of birth / incorporation) so the files open directly. Everything is saved into a neat, dated folder, one sub-folder per PAN.

### New in v2.0

- 📊 **Bulk import from Excel/CSV** — add hundreds of clients at once
- 🗂 **Timestamped run folders** — every download run goes into `Downloads/26AS-AIS-TIS/Run-<date-time>/<PAN>/`
- ⬇ **Download ALL** — one button downloads documents for every client in the list
- 🍎 **macOS support** — runs on Mac as well as Windows
- 📄 **Built-in Excel template** — click once to get a ready-to-fill sheet

---

## For staff — quick start (no coding)

You only need the prebuilt app. Ask your admin for the installer, or download it from the
[**Releases**](https://github.com/dhruvdua88/26as-ais-tis-downloader/releases/latest) page.

### Windows

1. Download `26AS-AIS-TIS-Downloader-Setup-<version>.exe`.
2. Double-click it → follow the setup wizard → launch from the Start Menu / desktop shortcut.
3. (One time) Make sure **Google Chrome** is installed — the app uses it to open the portal.

### macOS

1. Download `26AS-AIS-TIS-Downloader-<version>-<arch>.dmg`
   (use **arm64** for Apple-Silicon M-series Macs, **x64** for older Intel Macs).
2. Open the `.dmg`, drag the app into **Applications**.
3. **First launch only:** right-click the app → **Open** → **Open** again.
   (macOS shows a warning because the app is not signed with a paid Apple certificate — this is expected. Right-click-Open tells macOS to trust it. After the first time, double-click works normally.)
4. (One time) Make sure **Google Chrome** is installed.

---

## How to use the app

### 1. Add your clients

**Option A — one at a time:** Click **➕ Add Assessee** and fill in Name, PAN, DOB and the portal password.

**Option B — bulk import from Excel (recommended for many clients):**

1. Click **📄 Excel Template** and save the template somewhere (e.g. Desktop).
2. Open it in Excel. Fill one row per client:

   | Name              | PAN          | Password              | DOB         |
   |-------------------|--------------|-----------------------|-------------|
   | Example Pvt Ltd   | ABCDE1234F   | YourPortalPassword@1  | 01/01/1990  |

   - **Name** — optional (PAN is used if blank)
   - **PAN** — required, 10 characters (e.g. `ABCDE1234F`)
   - **Password** — required, the IT portal login password
   - **DOB** — date of birth (individuals) or incorporation (companies). Accepts `DD/MM/YYYY` or `DDMMYYYY`. Only needed to auto-unlock the PDFs; leave blank to skip unlocking.
   - Delete the example row before importing.
3. Save the file. Back in the app, click **📥 Import from Excel** and pick it.
   The log shows how many were added, how many duplicates were skipped, and any invalid PANs.

> Column headers are matched flexibly — `PAN`, `PAN No.`, `PAN Number` all work; `Password`, `Portal Password`, `Pwd` all work; etc.

### 2. Download

- **One client:** click **Download** on that row → choose 26AS / AIS / TIS → **Download**.
- **Everyone:** click **⬇ Download ALL** → choose the documents → it processes each client in turn, with a progress bar.

A Chrome window opens and drives the portal automatically. **Don't close it** while it runs.

### 3. Find your files

Everything lands in your **Downloads** folder:

```
Downloads/
└── 26AS-AIS-TIS/
    └── Run-2026-06-09T11-30-00/        ← one folder per run (date & time)
        ├── ABCDE1234F/                  ← one sub-folder per PAN
        │   ├── ABCDE1234F_26AS_...pdf
        │   ├── ABCDE1234F_AIS_...pdf
        │   └── ABCDE1234F_TIS_...pdf
        └── FGHIJ5678K/
            └── ...
```

The folder opens automatically when the run finishes. PDFs are already password-free (if you supplied DOB).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Chrome not found" in the log | Install Google Chrome. The app prefers it; it falls back to a bundled browser if missing. |
| PDFs are still password-protected | Make sure the client's **DOB** is filled in. On macOS, install qpdf once: `brew install qpdf`. On Windows the bundled qpdf is used automatically. |
| macOS: "app is damaged / can't be opened" | Right-click the app → **Open** → **Open**. If it persists, run `xattr -dr com.apple.quarantine "/Applications/26AS AIS TIS Downloader.app"`. |
| Login fails | Re-check the PAN and password. The IT portal occasionally rate-limits — wait a minute and retry. |
| **AIS download times out** | Known limitation: the portal sometimes generates the **AIS PDF asynchronously** (it appears later under *Activity History* on the portal) instead of downloading immediately. 26AS and TIS are unaffected. A fix that polls Activity History is planned. |

---

## For developers — run / build from source

```bash
# Prerequisites: Node.js 18+, Git, Google Chrome
git clone https://github.com/dhruvdua88/26as-ais-tis-downloader.git
cd 26as-ais-tis-downloader
npm install          # also fetches the Playwright browser
npm start            # launch the app
```

### Optional: PDF auto-unlock

The IT department password-protects the AIS/TIS PDFs. To strip them automatically:

- **macOS:** `brew install qpdf`
- **Linux:** `sudo apt install qpdf`
- **Windows:** download `qpdf-*-bin-msvc64.zip` from the [qpdf releases](https://github.com/qpdf/qpdf/releases/latest) and copy the contents of `bin/` into `vendor/qpdf/bin/`.

If qpdf isn't found the downloads still succeed — they're just left encrypted.

### Build installers

```bash
npm run dist:win     # Windows .exe (NSIS) — run on Windows
npm run dist:mac     # macOS .dmg + .zip (arm64 + x64) — run on macOS
```

Output appears in `dist-installer/`. macOS builds are **unsigned** (no paid Apple Developer certificate); distribute with the right-click-Open instructions above. To sign, set `mac.identity` in `package.json` and provide a certificate.

---

## How it works (under the hood)

- **Electron** desktop shell (`main.js`, `renderer/`).
- **Playwright** drives a headed Chrome session against the portal (`automation/downloader.js`), with anti-automation hardening so the portal accepts it.
- **qpdf** strips PDF passwords (`automation/unlocker.js`).
- **SheetJS (xlsx)** reads the import file and writes the template (`automation/importer.js`).
- Client list is stored locally in `data/assessees.json` (dev) or your user-data folder (installed).

---

## ⚠️ Security & privacy

- Client PANs, **passwords** and DOBs are stored **in plain text** on the local machine (`assessees.json`). Keep the machine secure; don't commit `data/assessees.json` (it's git-ignored).
- The app talks **only** to the official IT portal / TRACES. Nothing is sent anywhere else.
- Use only for clients you are authorised to act for.

---

## License

MIT. Original work © CA Akshay Daiya; fork modifications by Dhruv Dua.
