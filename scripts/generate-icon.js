/**
 * Generates assets/icon.png (256×256) and assets/icon.ico using Playwright
 * to render an HTML canvas, then png-to-ico for the ICO conversion.
 * Run: node scripts/generate-icon.js
 */
const { chromium } = require('playwright');
const { imagesToIco } = require('png-to-ico');
const fs         = require('fs');
const path       = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');

const ICON_HTML = /* html */`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 256px; height: 256px; overflow: hidden;
    background: transparent;
    display: flex; align-items: center; justify-content: center;
  }
  .bg {
    width: 224px; height: 224px;
    border-radius: 40px;
    background: linear-gradient(145deg, #1e40af, #1e3a8a);
    box-shadow: 0 8px 32px rgba(30,58,138,0.5);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 6px;
    position: relative;
    overflow: hidden;
  }
  /* Glossy top sheen */
  .bg::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 50%;
    background: linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 100%);
    border-radius: 40px 40px 0 0;
  }
  /* Document icon */
  .doc {
    width: 72px; height: 90px;
    background: #fff;
    border-radius: 6px 12px 6px 6px;
    position: relative;
    margin-bottom: 2px;
  }
  .doc::before {
    content: '';
    position: absolute; top: 0; right: 0;
    width: 20px; height: 20px;
    background: #93c5fd;
    clip-path: polygon(0 0, 100% 100%, 100% 0);
    border-radius: 0 12px 0 0;
  }
  /* Lines on document */
  .line {
    position: absolute;
    left: 10px; height: 4px; border-radius: 2px;
    background: #bfdbfe;
  }
  .l1 { top: 28px; width: 50px; }
  .l2 { top: 38px; width: 40px; }
  .l3 { top: 48px; width: 45px; }
  .l4 { top: 58px; width: 30px; }
  /* Download arrow — overlaid on lower-right of doc */
  .arrow-wrap {
    position: absolute;
    bottom: -10px; right: -10px;
    width: 32px; height: 32px;
    background: #f59e0b;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .arrow {
    width: 0; height: 0;
    border-left: 7px solid transparent;
    border-right: 7px solid transparent;
    border-top: 10px solid #fff;
    margin-top: 4px;
  }
  /* Label */
  .label {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 17px;
    font-weight: 800;
    color: #fff;
    letter-spacing: 1px;
    text-shadow: 0 1px 4px rgba(0,0,0,0.3);
    line-height: 1;
  }
  .sub {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 9px;
    font-weight: 600;
    color: #bfdbfe;
    letter-spacing: 1.5px;
    text-transform: uppercase;
  }
</style>
</head>
<body>
  <div class="bg">
    <div class="doc">
      <div class="line l1"></div>
      <div class="line l2"></div>
      <div class="line l3"></div>
      <div class="line l4"></div>
      <div class="arrow-wrap"><div class="arrow"></div></div>
    </div>
    <div class="label">26AS</div>
    <div class="sub">AIS · TIS · Downloader</div>
  </div>
</body>
</html>`;

async function generate() {
  console.log('Launching browser to render icon…');
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();

  await page.setViewportSize({ width: 256, height: 256 });
  await page.setContent(ICON_HTML, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);

  const pngBuf = await page.screenshot({
    type: 'png',
    clip: { x: 0, y: 0, width: 256, height: 256 },
    omitBackground: false,
  });
  await browser.close();

  fs.mkdirSync(ASSETS, { recursive: true });

  const pngPath = path.join(ASSETS, 'icon.png');
  fs.writeFileSync(pngPath, pngBuf);
  console.log('Saved', pngPath);

  const icoBuf = await imagesToIco([pngPath]);
  const icoPath = path.join(ASSETS, 'icon.ico');
  fs.writeFileSync(icoPath, icoBuf);
  console.log('Saved', icoPath);

  console.log('Icon generation complete ✓');
}

generate().catch((e) => { console.error(e); process.exit(1); });
