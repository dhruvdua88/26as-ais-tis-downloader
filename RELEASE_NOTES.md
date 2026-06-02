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
1. Download `26AS-AIS-TIS-Downloader-Setup-1.0.0.exe` below
2. Run the installer — choose your install folder, create shortcuts
3. Launch from **Start Menu** or **Desktop shortcut**
4. Click **+ Add Assessee**, enter Name / PAN / DOB / IT portal password
5. Click **Download** → select 26AS, AIS, TIS → **Start Download**
6. Files appear in `Downloads\<AssesseeName>\` folder, password-free

### ⚠️ Requirements
- Windows 10 / 11 (64-bit)
- Active internet connection
- Google Chrome installed (used for portal automation)

### 🔓 PDF Passwords
PDFs are auto-unlocked if DOB is filled in the assessee form.
If unlock fails, manual passwords are:
- **26AS**: DOB in DDMMYYYY format
- **AIS / TIS**: PAN (lowercase) + DOB in DDMMYYYY format
