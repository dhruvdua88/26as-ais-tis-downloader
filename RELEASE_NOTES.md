## v2.0.0 — Cross-platform + Bulk

### ✨ New
- **Windows + macOS** — added macOS build targets (`.dmg` + `.zip`, arm64 & x64). Cross-platform ZIP (uses `zip` on macOS/Linux, PowerShell on Windows) and qpdf path handling.
- **Bulk import from Excel/CSV** — add many assessees at once. Flexible header matching (PAN / PAN No. / PAN Number, Password / Pwd, DOB / Date of Birth, …); DOB accepts DD/MM/YYYY, DDMMYYYY or real date cells. Duplicate PANs skipped, invalid PANs reported.
- **Built-in Excel template** — one click writes a ready-to-fill workbook with an Instructions sheet.
- **Download ALL** — one button downloads documents for every assessee, with a live progress bar.
- **Timestamped, per-PAN output** — files now go to `Downloads/26AS-AIS-TIS/Run-<timestamp>/<PAN>/`.

### 📖 Docs
- Rewritten README with non-coder staff guide, Excel format, output layout, troubleshooting, and build-from-source for both platforms.

### ⚠️ Known issue
- AIS PDF can time out when the portal queues it asynchronously (delivered via *Activity History*). 26AS and TIS unaffected.

### Requirements
- Windows 10/11 or macOS (Apple Silicon or Intel) · Google Chrome · internet. Optional qpdf for PDF auto-unlock (`brew install qpdf` on macOS).

---

## v1.0.1 — Bug Fix

### 🐛 Fixed
- **AIS / TIS download failing on first-time use** — The AIS portal shows an instructions/onboarding page on new devices. The app now automatically clicks through intermediate pages (Proceed / Continue / Get Started) before reaching the download button. Users who previously worked fine are unaffected.

---

## v1.0.0 — Initial Release

### ✅ What's included
- One-click download of **Form 26AS**, **AIS** and **TIS** from the IT e-Filing portal
- Auto-login using PAN + password (no OTP required)
- **Dual-login handling** — automatically clicks through "already logged in" prompt
- **Auto PDF unlock** — removes IT department passwords using DOB (no manual entry needed)
- **Per-assessee folders** — each client's files saved in their own Downloads sub-folder
- **ZIP mode** — package all 3 files into a single ZIP with one click
- **Animated splash screen** with startup chime on launch
- **Custom app icon** — shows in taskbar, Start Menu and desktop shortcut
- Developed by **CA Akshay Daiya**, M/s Daiya Tiwari & Soni, Bikaner

### 📥 How to install
1. Download `26AS-AIS-TIS-Downloader-Setup-1.0.1.exe` below
2. Run the installer — choose your install folder, create shortcuts
3. Launch from **Start Menu** or **Desktop shortcut**
4. Click **+ Add Assessee**, enter Name / PAN / DOB / IT portal password
5. Click **Download** → select 26AS, AIS, TIS → **Start Download**
6. Files appear in `Downloads\<AssesseeName>\` folder, password-free

### ⚠️ Requirements
- Windows 10 / 11 (64-bit)
- Active internet connection
- Google Chrome installed (used for portal automation)
