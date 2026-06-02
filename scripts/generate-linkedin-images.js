/**
 * Generates 3 LinkedIn post images:
 *   assets/linkedin-1-splash.png   — App splash screen (1200×628)
 *   assets/linkedin-2-ui.png       — App UI mockup (1200×628)
 *   assets/linkedin-3-features.png — Feature highlight card (1200×628)
 *
 * Run: node scripts/generate-linkedin-images.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const W = 1200, H = 628;

// ─── Image 1: Splash screen (enlarged) ────────────────────────────────────
const SPLASH_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;background:#0f172a;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden}
.glow{position:absolute;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(30,64,175,0.35) 0%,transparent 70%);top:50%;left:50%;transform:translate(-50%,-50%)}
.icon-wrap{position:relative;z-index:2;width:160px;height:160px;border-radius:36px;background:linear-gradient(145deg,#1e40af,#1e3a8a);box-shadow:0 20px 60px rgba(30,58,138,0.6),0 0 0 1px rgba(255,255,255,0.08);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.doc{width:56px;height:70px;background:#fff;border-radius:5px 14px 5px 5px;position:relative}
.doc::before{content:'';position:absolute;top:0;right:0;width:16px;height:16px;background:#93c5fd;clip-path:polygon(0 0,100% 100%,100% 0);border-radius:0 14px 0 0}
.dl{position:absolute;left:8px;height:3px;border-radius:2px;background:#bfdbfe}
.dl1{top:22px;width:36px}.dl2{top:30px;width:28px}.dl3{top:38px;width:32px}.dl4{top:46px;width:20px}
.ab{position:absolute;bottom:-8px;right:-8px;width:24px;height:24px;background:#f59e0b;border-radius:50%;display:flex;align-items:center;justify-content:center}
.ab::after{content:'';width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:8px solid #fff;margin-top:3px}
.it{font-size:18px;font-weight:800;color:#fff;letter-spacing:1px}
.title-wrap{z-index:2;margin-top:30px;text-align:center}
.title{font-size:42px;font-weight:800;color:#fff;letter-spacing:1px}
.title span{color:#60a5fa}
.subtitle{font-size:15px;color:#64748b;letter-spacing:3px;text-transform:uppercase;margin-top:8px}
.progress-track{z-index:2;margin-top:40px;width:300px;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden}
.progress-bar{height:100%;width:75%;background:linear-gradient(90deg,#1e40af,#60a5fa);border-radius:2px}
.credit{position:absolute;bottom:24px;font-size:13px;color:#334155;letter-spacing:0.5px}
</style></head><body>
<div class="glow"></div>
<div class="icon-wrap">
  <div class="doc"><div class="dl dl1"></div><div class="dl dl2"></div><div class="dl dl3"></div><div class="dl dl4"></div><div class="ab"></div></div>
  <div class="it">26AS</div>
</div>
<div class="title-wrap">
  <div class="title">26AS / <span>AIS</span> / TIS</div>
  <div class="subtitle">Income Tax Downloader</div>
</div>
<div class="progress-track"><div class="progress-bar"></div></div>
<div class="credit">Developed by CA Akshay Daiya &nbsp;·&nbsp; M/s Daiya Tiwari &amp; Soni, Bikaner</div>
</body></html>`;

// ─── Image 2: App UI mockup ────────────────────────────────────────────────
const UI_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;background:#0f172a;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',system-ui,sans-serif;padding:32px;gap:32px}
.window{width:100%;max-width:880px;border-radius:12px;overflow:hidden;box-shadow:0 40px 80px rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.08)}
.titlebar{background:#1e293b;padding:12px 16px;display:flex;align-items:center;gap:8px}
.dot{width:12px;height:12px;border-radius:50%}
.d1{background:#ef4444}.d2{background:#f59e0b}.d3{background:#22c55e}
.app-title{color:#94a3b8;font-size:12px;margin-left:8px;letter-spacing:0.5px}
.header{background:#1e3a8a;padding:16px 24px}
.header h1{color:#fff;font-size:18px;font-weight:700}
.header p{color:rgba(255,255,255,0.7);font-size:12px;margin-top:2px}
.body{background:#f4f6fa;padding:20px}
.panel{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px}
.ph{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.ph h2{font-size:14px;font-weight:600;color:#1f2937}
.btn-primary{background:#1e3a8a;color:#fff;border:none;padding:7px 14px;border-radius:6px;font-size:12px;cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px 12px;background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid #f1f5f9}
td{padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#1f2937}
.mono{font-family:monospace;font-size:12px}
.mask{color:#94a3b8;font-family:monospace}
.actions{text-align:right;white-space:nowrap}
.btn-dl{background:#1e3a8a;color:#fff;border:none;padding:5px 10px;border-radius:5px;font-size:11px;margin-left:4px;cursor:pointer}
.btn-ed{background:transparent;color:#475569;border:1px solid #cbd5e1;padding:5px 10px;border-radius:5px;font-size:11px;margin-left:4px;cursor:pointer}
.footer{background:#fff;border-top:1px solid #e5e7eb;text-align:center;padding:12px;font-size:11px;color:#475569}
.footer b{color:#1e3a8a}
.badge{display:inline-block;background:#dcfce7;color:#166534;font-size:10px;padding:2px 6px;border-radius:9px;margin-left:6px}
</style></head><body>
<div class="window">
  <div class="titlebar"><div class="dot d1"></div><div class="dot d2"></div><div class="dot d3"></div><span class="app-title">26AS AIS TIS Downloader</span></div>
  <div class="header"><h1>26AS / AIS / TIS Downloader</h1><p>One-click downloads from the Indian Income Tax e-Filing portal</p></div>
  <div class="body">
    <div class="panel">
      <div class="ph"><h2>Assessees</h2><button class="btn-primary">+ Add Assessee</button></div>
      <table>
        <thead><tr><th>Name</th><th>PAN</th><th>DOB</th><th>Password</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>
          <tr><td>Ramesh Kumar Sharma</td><td class="mono">ABCDE1234F</td><td class="mono">01/04/1975</td><td class="mask">••••••••</td><td class="actions"><button class="btn-dl">Download</button><button class="btn-ed">Edit</button></td></tr>
          <tr><td>Priya Mehta<span class="badge">✓ Done</span></td><td class="mono">FGHIJ5678K</td><td class="mono">15/08/1982</td><td class="mask">••••••••</td><td class="actions"><button class="btn-dl">Download</button><button class="btn-ed">Edit</button></td></tr>
          <tr><td>Suresh Trading Pvt Ltd</td><td class="mono">LMNOP9012Q</td><td class="mono">22/11/1990</td><td class="mask">••••••••</td><td class="actions"><button class="btn-dl">Download</button><button class="btn-ed">Edit</button></td></tr>
        </tbody>
      </table>
    </div>
  </div>
  <div class="footer">Developed by <b>CA Akshay Daiya</b> &nbsp;·&nbsp; M/s Daiya Tiwari &amp; Soni &nbsp;·&nbsp; +91 99290 89598 &nbsp;·&nbsp; akshaybkn@gmail.com</div>
</div>
</body></html>`;

// ─── Image 3: Feature card ─────────────────────────────────────────────────
const FEATURES_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%);display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',system-ui,sans-serif;padding:48px}
.card{width:100%;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.left{}
.tag{display:inline-block;background:rgba(96,165,250,0.15);color:#60a5fa;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;padding:6px 14px;border-radius:20px;border:1px solid rgba(96,165,250,0.3);margin-bottom:20px}
.left h1{font-size:36px;font-weight:800;color:#fff;line-height:1.2;margin-bottom:12px}
.left h1 span{color:#60a5fa}
.left p{font-size:14px;color:#94a3b8;line-height:1.7;margin-bottom:24px}
.dl-btn{display:inline-flex;align-items:center;gap:8px;background:#1e40af;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:13px;font-weight:600}
.dl-btn .arrow{font-size:18px}
.right{display:flex;flex-direction:column;gap:14px}
.feat{display:flex;align-items:flex-start;gap:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px 16px}
.icon{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.feat-text h3{font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:2px}
.feat-text p{font-size:11px;color:#64748b;line-height:1.5}
.i1{background:rgba(59,130,246,0.15)}
.i2{background:rgba(16,185,129,0.15)}
.i3{background:rgba(245,158,11,0.15)}
.i4{background:rgba(139,92,246,0.15)}
.free{display:inline-block;background:rgba(34,197,94,0.15);color:#4ade80;font-size:11px;font-weight:600;padding:3px 10px;border-radius:10px;border:1px solid rgba(34,197,94,0.2);margin-bottom:8px}
</style></head><body>
<div class="card">
  <div class="left">
    <div class="tag">Free Tool for Tax Professionals</div>
    <div class="free">100% Free &amp; Open Source</div>
    <h1>Download 26AS, <span>AIS &amp; TIS</span> in One Click</h1>
    <p>Stop spending 10 minutes per client navigating the IT portal. Automate the entire download workflow — login, download, unlock PDFs — all in a single click.</p>
    <div class="dl-btn"><span class="arrow">⬇</span> Download Free (Windows)</div>
    <div style="margin-top:10px;font-size:11px;color:#475569">github.com/DaiyaAkshay/26as-ais-tis-downloader</div>
  </div>
  <div class="right">
    <div class="feat"><div class="icon i1">🔐</div><div class="feat-text"><h3>Auto Login</h3><p>Logs in with PAN & password automatically — no manual portal navigation</p></div></div>
    <div class="feat"><div class="icon i2">📥</div><div class="feat-text"><h3>One-Click Download</h3><p>Downloads Form 26AS, AIS and TIS for all your clients in sequence</p></div></div>
    <div class="feat"><div class="icon i3">🔓</div><div class="feat-text"><h3>Auto PDF Unlock</h3><p>Removes IT department passwords automatically — files open directly</p></div></div>
    <div class="feat"><div class="icon i4">📁</div><div class="feat-text"><h3>Per-Client Folders</h3><p>Each client's files saved in their own named folder in Downloads</p></div></div>
  </div>
</div>
</body></html>`;

async function generate() {
  console.log('Launching browser…');
  const browser = await chromium.launch({ headless: true });

  const pages = [
    { name: 'linkedin-1-splash',   html: SPLASH_HTML   },
    { name: 'linkedin-2-ui',       html: UI_HTML        },
    { name: 'linkedin-3-features', html: FEATURES_HTML  },
  ];

  for (const { name, html } of pages) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: W, height: H });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    const buf = await page.screenshot({ type: 'png' });
    const outPath = path.join(ASSETS, `${name}.png`);
    fs.writeFileSync(outPath, buf);
    console.log('✓ Saved', outPath);
    await page.close();
  }

  await browser.close();
  console.log('\nAll 3 LinkedIn images generated in assets/');
}

generate().catch(e => { console.error(e); process.exit(1); });
