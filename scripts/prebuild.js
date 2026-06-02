/**
 * Pre-build step for the portable .exe.
 *
 * Playwright stores its Chromium under %LOCALAPPDATA%\ms-playwright by default,
 * which means it WON'T get bundled when electron-builder packages node_modules.
 * Setting PLAYWRIGHT_BROWSERS_PATH=0 forces Playwright to put the browser inside
 *   node_modules/playwright-core/.local-browsers/
 * which IS bundled.
 *
 * Run this once before `electron-builder` via:
 *   npm run dist:prep
 * (already wired into `npm run dist`)
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

console.log('[prebuild] Installing Playwright Chromium into node_modules…');
try {
  execSync('npx playwright install chromium', {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' },
  });
} catch (e) {
  console.error('[prebuild] playwright install failed:', e.message);
  process.exit(1);
}

const localBrowsers = path.join(__dirname, '..', 'node_modules', 'playwright-core', '.local-browsers');
if (!fs.existsSync(localBrowsers)) {
  console.error('[prebuild] Expected node_modules/playwright-core/.local-browsers/ to exist after install — not found.');
  console.error('[prebuild] The packaged .exe will not have Chromium and downloads will fail unless the user has Chrome installed.');
  process.exit(1);
}

const sized = fs.readdirSync(localBrowsers);
console.log(`[prebuild] Chromium bundled: ${sized.join(', ')}`);
console.log('[prebuild] Ready for electron-builder.');
