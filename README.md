# 26AS / AIS / TIS Downloader

> One-click bulk downloader of **Form 26AS**, **AIS** (Annual Information Statement) and **TIS** (Taxpayer Information Summary) from the Indian Income Tax e-Filing portal — built for Indian CA firms.

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Made with Electron](https://img.shields.io/badge/made%20with-Electron-47848f)

---

## Features

- 🔐 **Auto-login** to the IT e-Filing portal using PAN + password
- 📥 **One-click download** of 26AS, AIS and TIS for any number of assessees
- 🔓 **Auto PDF unlock** — strips IT department passwords automatically (no manual entry)
- 📁 **Per-assessee folders** — each client's files go into their own folder in Downloads
- 🗜 **ZIP mode** — optionally package all 3 files into a single ZIP
- 📊 **CompuOffice import** — bulk-import client master from CompuOffice Excel export
- 🔄 **Dual-login handling** — automatically handles "already logged in" prompt
- 🖥 **Single portable .exe** — no installation required; share with colleagues

---

## Screenshots

| Main screen | Download modal |
|-------------|---------------|
| Assessee list with Download / Edit / Delete | Pick 26AS, AIS, TIS or all three |

---

## Quick Start (development)

```bash
# Prerequisites: Node.js 18+, Git
git clone https://github.com/akshaybkn/26as-ais-tis-downloader.git
cd 26as-ais-tis-downloader
npm install
npm start
```

### PDF unlock (optional but recommended)

The IT department password-protects all downloaded PDFs. To auto-unlock:

1. Download `qpdf-*-bin-msvc64.zip` from https://github.com/qpdf/qpdf/releases/latest
2. Extract and copy the contents of `qpdf-X.Y.Z-bin-msvc64\bin\` into `vendor\qpdf\bin\`
   - See `vendor\qpdf\bin\README.txt` for detailed instructions
3. Add the assessee's **Date of Birth** (DDMMYYYY) in the Edit screen

PDF passwords used by the IT department:

| File  | Password format |
|-------|----------------|
| 26AS  | `DDMMYYYY` (e.g. `02091988`) |
| AIS   | `panDDMMYYYY` (e.g. `ajzpd2645j02091988`) |
| TIS   | `panDDMMYYYY` (same as AIS) |

---

## Build portable .exe

```bash
npm run dist
# Output: dist-installer\26AS-AIS-TIS-Downloader-1.0.0-portable.exe
```

---

## CompuOffice Integration

1. In CompuOffice → **Client Master** → filter by FY 2024-25 → **Export to Excel**
2. In this app → click **⬆ Import from CompuOffice** → select the Excel file
3. Preview the detected columns, then click **Import**

Columns auto-detected: Client Name, PAN No, Date of Birth, IT Password.

---

## Project Structure

```
├── main.js              # Electron main process (IPC, persistence, ZIP)
├── preload.js           # Context bridge → window.api
├── renderer/            # UI (vanilla HTML/CSS/JS, no build step)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── automation/
│   ├── downloader.js    # Playwright automation (login + download flow)
│   └── unlocker.js      # PDF password removal via qpdf
├── vendor/qpdf/bin/     # Drop qpdf.exe + DLLs here (see README.txt inside)
└── data/
    └── assessees.json   # Local client store (gitignored)
```

---

## Disclaimer

This tool automates browser actions on your behalf using your own credentials.
It does not store credentials on any server. All data stays on your local machine.
Use responsibly and in compliance with the Income Tax Department's terms of service.

---

**Developed by CA Akshay Daiya** | M/s Daiya Tiwari & Soni | 📞 +91 99290 89598 | ✉ akshaybkn@gmail.com
