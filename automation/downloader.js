const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { unlockPdf } = require('./unlocker');

const PORTAL_URL = 'https://www.incometax.gov.in/iec/foportal/';
const LOGIN_URL  = 'https://eportal.incometax.gov.in/iec/foservices/#/login';

/**
 * Drive a headed Chromium session to download 26AS / AIS / TIS for one assessee.
 *
 * Selectors below are best-effort against the current IT portal markup. The portal
 * changes occasionally — if a step fails, open DevTools in the live window and
 * update the corresponding selector here. The function logs each step so you can
 * see where it stopped.
 */
async function downloadAll({ assessee, which, downloadsDir, onLog }) {
  const log = (m) => { try { onLog?.(m); } catch {} ; console.log(m); };
  const saved = [];
  const failed = [];

  if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

  log(`Launching Chromium for ${assessee.name || assessee.pan}`);

  // The IT portal aggressively blocks "controlled" browsers. Defeat that by:
  //   1. Preferring the user's installed Chrome (channel: 'chrome') — full fingerprint
  //   2. Removing the AutomationControlled blink feature
  //   3. Dropping the --enable-automation switch
  //   4. Overriding navigator.webdriver to undefined at every doc init
  const launchArgs = [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
  ];
  const ignoreDefaultArgs = ['--enable-automation'];

  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      channel: 'chrome',
      args: launchArgs,
      ignoreDefaultArgs,
    });
  } catch (e) {
    log('System Chrome not found, falling back to bundled Chromium: ' + e.message);
    browser = await chromium.launch({
      headless: false,
      args: launchArgs,
      ignoreDefaultArgs,
    });
  }

  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1600, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-IN', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = window.chrome || { runtime: {} };
  });

  const page = await context.newPage();

  try {
    // --- LOGIN ---------------------------------------------------------------
    log('Opening login page');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

    // Wait for the Angular SPA to hydrate the form.
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    log('Locating PAN / User ID input');
    const panInput = await findFirstVisible(page, [
      'input[placeholder*="user id" i]',
      'input[placeholder*="PAN" i]',
      'input[formcontrolname*="userid" i]',
      'input[formcontrolname*="loginid" i]',
      'input[id*="userid" i]',
      'input[name*="userid" i]',
      'input[type="text"]:not([disabled])',
    ], { timeout: 30000, log });

    if (!panInput) {
      await dumpInputs(page, log);
      throw new Error('Could not find the PAN / User ID input. See input dump above.');
    }

    log('Entering PAN');
    await panInput.click();
    await panInput.fill(assessee.pan);

    // Click Continue after PAN
    await clickExactButton(page, 'Continue', log, { timeout: 10000 });

    // Now wait for the password page (or the optional Secure Access Message page).
    // Loop because the SPA can show SAM first, then password page.
    log('Waiting for password page');
    let onPasswordPage = false;
    for (let i = 0; i < 150 && !onPasswordPage; i++) {
      await page.waitForTimeout(200);
      await handleDualLoginPrompt(page, log);
      onPasswordPage = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
      if (onPasswordPage) break;
      // Otherwise we may be on the SAM page — click its Continue.
      if (/\/login\/sam/i.test(page.url()) || /secure access/i.test(await page.content().catch(() => ''))) {
        await clickExactButton(page, 'Continue', log);
      }
    }

    if (!onPasswordPage) {
      await dumpInputs(page, log);
      throw new Error('Password page never appeared.');
    }

    const pwdInput = page.locator('input[type="password"]').first();
    log('Entering password');
    await pwdInput.fill(assessee.password);

    // Tick the consent checkbox AFTER the password is filled (otherwise Angular's
    // form validation can desync and the Continue click silently no-ops).
    const consent = page.locator('input[type="checkbox"]:visible').first();
    if (await consent.isVisible().catch(() => false)) {
      log('Ticking consent checkbox');
      // The visible "checkbox" is often a styled label; click it via JS for reliability.
      await consent.check({ force: true }).catch(async () => {
        await page.evaluate(() => {
          const cb = document.querySelector('input[type="checkbox"]');
          if (cb && !cb.checked) cb.click();
        });
      });
    }

    log('Submitting login');
    await submitPasswordContinue(page, pwdInput, log);

    // Poll for one of: dashboard (success), dual-session prompt, generic error.
    // The portal sometimes shows "You are already logged in from another
    // session. Do you wish to continue?" — click Continue/Yes to terminate
    // the other session and proceed.
    log('Waiting for dashboard…');
    const loginDeadline = Date.now() + 60_000;
    let reachedDashboard = false;
    while (Date.now() < loginDeadline) {
      await handleDualLoginPrompt(page, log);
      const url = page.url();
      if (!/\/login(\/|$)/.test(url)) { reachedDashboard = true; break; }

      // Look for a dual-session / "already logged in" prompt and handle it.
      const dualPrompt = await page.evaluate(() => {
        const body = (document.body.innerText || '').toLowerCase();
        return /already logged in|another session|concurrent session|active session|terminate.*session|wish to continue/.test(body);
      }).catch(() => false);

      if (dualPrompt) {
        log('Dual-session prompt detected — confirming');
        // Try the common confirm buttons in order of likelihood.
        const confirmed =
          await clickExactButton(page, 'Login Here', log) ||
          await clickExactButton(page, 'Continue', log) ||
          await clickExactButton(page, 'Yes', log) ||
          await clickExactButton(page, 'Proceed', log) ||
          await clickExactButton(page, 'OK', log);
        if (!confirmed) {
          // Generic fallback — any visible button whose text says continue/yes/proceed/ok
          await clickButtonByName(page, /^(login here|continue|yes|proceed|ok)$/i, log);
        }
        await page.waitForTimeout(800);
      } else {
        await page.waitForTimeout(300);
      }
    }

    if (!reachedDashboard) {
      await dumpInputs(page, log);
      throw new Error('Login did not complete — still on ' + page.url());
    }
    await page.waitForSelector('#hamburgerOpen, a#AIS, a#e-File', { timeout: 10000 }).catch(() => {});
    log('Dashboard URL: ' + page.url());
    log('Login complete; starting downloads');

    // --- DOWNLOADS -----------------------------------------------------------
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // AIS / TIS — AIS is its own top-level menu item (a#AIS); clicking it
    // opens https://ais.insight.gov.in/ in a new tab.
    if (which.includes('AIS') || which.includes('TIS')) {
      try {
        log('Opening AIS (top-level menu)');
        await openHamburger(page, log);

        const aisLink = page.locator('a#AIS').first();
        if (!(await aisLink.isVisible().catch(() => false))) {
          await dumpInputs(page, log);
          throw new Error('a#AIS link not visible after opening hamburger.');
        }
        log('  clicking a#AIS');
        const aisPagePromise = context.waitForEvent('page', { timeout: 15000 });
        aisPagePromise.catch(() => {});
        await aisLink.click({ timeout: 10000 }).catch(() => {});

        // Optional Yes-confirm dialog — only present if the portal asks to
        // confirm before opening AIS in a new tab. Short probe so the happy
        // path (no dialog) doesn't burn ~800ms.
        const yes = page.getByRole('button', { name: /^yes$/i }).first();
        if (await yes.waitFor({ state: 'visible', timeout: 250 }).then(() => true).catch(() => false)) {
          log('  confirming AIS redirect');
          await yes.click({ timeout: 10000 }).catch(async () => {
            await yes.click({ force: true, timeout: 10000 });
          });
        }

        const aisPage = await Promise.race([
          aisPagePromise.catch(() => null),
          page.waitForURL(/ais\.insight\.gov\.in/i, { timeout: 15000 }).then(() => page).catch(() => null),
        ]);
        const tab = aisPage || page;

        // Skip waitForLoadState('domcontentloaded') — the Promise.race below
        // resolves as soon as either the disclaimer Proceed OR the final
        // Download AIS/TIS button is visible, which is the actual gate.
        await Promise.race([
          tab.locator('button', { hasText: /Download AIS\/TIS/i }).first()
            .waitFor({ state: 'visible', timeout: 8000 }),
          tab.locator('button', { hasText: /proceed|accept|continue|i agree/i }).first()
            .waitFor({ state: 'visible', timeout: 8000 }),
        ]).catch(() => {});
        log('AIS tab URL: ' + tab.url());

        // AIS portal disclaimer / Proceed
        const proceed = tab.locator('button', { hasText: /proceed|accept|continue|i agree/i }).first();
        if (await proceed.isVisible().catch(() => false)) {
          log('  clicking AIS disclaimer Proceed');
          await proceed.click().catch(() => {});
          await tab.locator('button', { hasText: /Download AIS\/TIS/i }).first()
            .waitFor({ state: 'visible', timeout: 8000 })
            .catch(() => {});
        }

        if (which.includes('AIS')) {
          await downloadAisOrTis(tab, 'AIS', assessee.pan, downloadsDir, stamp, saved, log, assessee);
        }
        if (which.includes('TIS')) {
          await dismissLogoutPrompt(tab, log);
          if (
            !(await tab.locator('button', { hasText: /Download AIS\/TIS/i }).first().isVisible().catch(() => false)) &&
            /ais\.insight\.gov\.in/i.test(tab.url())
          ) {
            await tab.goBack().catch(() => {});
            await tab.waitForTimeout(2000);
            await dismissLogoutPrompt(tab, log);
          }
          await downloadAisOrTis(tab, 'TIS', assessee.pan, downloadsDir, stamp, saved, log, assessee);
        }
      } catch (e) {
        log('AIS/TIS flow failed: ' + e.message);
        failed.push('AIS/TIS');
      }
    }

    // 26AS — MUST be reached via the IT portal SPA's own redirect. Direct
    // navigation to traces61services.tdscpc.gov.in breaks the SPA session
    // (Playwright's full-page goto wipes the in-memory token), so the only
    // reliable path is: stay on the e-Filing SPA, expand the e-File menu,
    // click "View Form 26AS" — the portal then POSTs a redirect token to
    // TRACES that creates a valid session.
    if (which.includes('26AS')) {
      try {
        log('Navigating to 26AS via e-File menu');
        await page.bringToFront();
        await dismissLogoutPrompt(page, log);

        await openHamburger(page, log);

        // Clicking "View Form 26AS" opens TRACES in a NEW TAB (same pattern as
        // AIS, not an iframe). Set up the popup listener BEFORE the click so
        // we don't miss it.
        const tracesPagePromise = context.waitForEvent('page', { timeout: 30000 });
        tracesPagePromise.catch(() => {});

        await openViewForm26AS(page, log);
        await page.waitForTimeout(1500);

        // Confirm disclaimer on the IT portal (e.g. "You'll be redirected to TRACES")
        const confirm = page.locator('button', { hasText: /confirm|proceed|continue/i }).first();
        if (await confirm.isVisible().catch(() => false)) {
          log('  confirming TRACES redirect on e-Filing');
          await confirm.click().catch(() => {});
        }

        // Wait for the TRACES tab to open. Race the popup event against a
        // URL-change check (in case the IT portal navigates the same tab on
        // some configurations).
        const tracesPage = await Promise.race([
          tracesPagePromise.catch(() => null),
          page.waitForURL(/traces|tdscpc/i, { timeout: 15000 }).then(() => page).catch(() => null),
        ]);
        const tab = tracesPage || page;
        await tab.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
        await tab.bringToFront().catch(() => {});
        await tab.waitForTimeout(2000);

        log('TRACES tab URL: ' + tab.url());

        // TRACES "ATTENTION TAX PAYERS" modal — tick I-agree, click Proceed.
        await tickTracesAgreeAndProceed(tab, log);

        // After Proceed, TRACES navigates to a new page that contains the
        // "View Tax Credit (Form 26AS/Annual Tax Statement)" hyperlink. Wait
        // for that navigation and re-find the frame in case the URL changed.
        await tab.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await tab.waitForTimeout(2000);
        log('  TRACES URL after Proceed: ' + tab.url());

        let tracesFrame = await findTracesFrame(tab, log);

        // Click "View Tax Credit (Form 26AS/Annual Tax Statement)" hyperlink.
        // It's an <a> tag — be specific so we don't grab paragraph text.
        const viewCreditLink = tracesFrame.getByRole('link', { name: /View Tax Credit.*Form 26AS/i })
          .or(tracesFrame.locator('a', { hasText: /View Tax Credit/i }))
          .first();
        if (await viewCreditLink.isVisible().catch(() => false)) {
          log('  clicking "View Tax Credit (Form 26AS/Annual Tax Statement)"');
          await viewCreditLink.click({ timeout: 10000 }).catch(async () => {
            await viewCreditLink.click({ force: true, timeout: 10000 });
          });
          await tab.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
          await tab.waitForTimeout(2500);
          log('  TRACES URL after View Tax Credit: ' + tab.url());
          tracesFrame = await findTracesFrame(tab, log);
        } else {
          log('  View Tax Credit link not visible — dumping TRACES tab');
          await dumpInputs(tab, log);
        }

        // AY selection page (TRACES "Form 26AS/Annual Tax Statement"):
        //   Assessment Year:  <select>  — defaults to current AY (2026-27)
        //   View As:          <select>  — defaults to HTML
        //   Buttons:  [ View / Download ]  [ Export as PDF ]
        // Page instructs: "to Download PDF, please view HTML then click on
        // Export as PDF button." So it's a 2-step flow:
        //   1. Click "View / Download" — loads the 26AS HTML view in-page
        //   2. Click "Export as PDF"  — triggers the PDF download

        // Set the form: Assessment Year (pick the most recent — first non-
        // placeholder option), View As = HTML. Both buttons stay disabled
        // until AY is picked.
        const formState = await tracesFrame.evaluate(() => {
          const selects = [...document.querySelectorAll('select')];

          // Assessment Year dropdown: identify by options that look like "2026-27"
          const ayDropdown = selects.find((s) =>
            [...s.options].some((o) => /^\s*\d{4}\s*-\s*\d{2}\s*$/.test(o.text || ''))
          );
          let pickedAy = null;
          if (ayDropdown) {
            const realOptions = [...ayDropdown.options].filter((o) =>
              /^\s*\d{4}\s*-\s*\d{2}\s*$/.test(o.text || '')
            );
            // Sort descending by starting year so we pick the latest AY.
            realOptions.sort((a, b) => {
              const ya = parseInt((a.text.match(/\d{4}/) || [0])[0], 10);
              const yb = parseInt((b.text.match(/\d{4}/) || [0])[0], 10);
              return yb - ya;
            });
            const target = realOptions[0];
            if (target && ayDropdown.value !== target.value) {
              ayDropdown.value = target.value;
              ayDropdown.dispatchEvent(new Event('change', { bubbles: true }));
            }
            pickedAy = target ? target.text.trim() : null;
          }

          // View-As dropdown — set to HTML.
          const viewAs = selects.find((s) => {
            const opts = [...s.options].map((o) => (o.text || '').toLowerCase());
            return opts.some((t) => t.includes('html')) && opts.some((t) => t.includes('text'));
          });
          if (viewAs) {
            const htmlOpt = [...viewAs.options].find((o) => /^html$/i.test((o.text || '').trim()));
            if (htmlOpt && viewAs.value !== htmlOpt.value) {
              viewAs.value = htmlOpt.value;
              viewAs.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }

          return { pickedAy, viewAsValue: viewAs ? viewAs.value : null };
        }).catch(() => ({}));
        log(`  AY selected: ${formState.pickedAy || '(none)'}, View As: ${formState.viewAsValue || '(unchanged)'}`);
        await tab.waitForTimeout(500);

        // Step 1: click "View / Download" to render the HTML view.
        log('  clicking "View / Download"');
        const viewDlBtn = tracesFrame.locator(
          'input[type="button"][value*="View" i][value*="Download" i], ' +
          'input[type="submit"][value*="View" i][value*="Download" i]'
        ).first()
          .or(tracesFrame.getByRole('button', { name: /View ?\/ ?Download/i }))
          .or(tracesFrame.locator('a, button, input', { hasText: /View ?\/ ?Download/i }).first());

        if (await viewDlBtn.isVisible().catch(() => false)) {
          await viewDlBtn.click({ timeout: 15000 }).catch(async () => {
            await viewDlBtn.click({ force: true, timeout: 15000 });
          });
        } else {
          log('  "View / Download" button not visible — dumping');
          await dumpInputs(tab, log);
        }

        // Wait for the HTML 26AS view to render. The Export-as-PDF button is
        // disabled until then.
        await tab.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
        await tab.waitForTimeout(3000);
        log('  TRACES URL after View/Download: ' + tab.url());
        tracesFrame = await findTracesFrame(tab, log);

        // Step 2: click "Export as PDF" — triggers the download.
        log('  clicking "Export as PDF"');
        const pdfBtn = tracesFrame.locator(
          'input[type="button"][value*="Export" i][value*="PDF" i], ' +
          'input[type="submit"][value*="Export" i][value*="PDF" i]'
        ).first()
          .or(tracesFrame.getByRole('button', { name: /Export as PDF/i }))
          .or(tracesFrame.locator('a, button, input', { hasText: /export.*pdf/i }).first());

        const dl = await Promise.all([
          tab.waitForEvent('download', { timeout: 90000 }),
          pdfBtn.click({ timeout: 15000 }).catch(async () => {
            await pdfBtn.click({ force: true, timeout: 15000 });
          }),
        ]);
        const file = path.join(downloadsDir, `${assessee.pan}_26AS_${stamp}.pdf`);
        await dl[0].saveAs(file);
        saved.push(file);
        log(`Saved ${file}`);
        await unlockPdf(file, { pan: assessee.pan, dob: assessee.dob, log });
      } catch (e) {
        log('26AS flow failed: ' + e.message);
        failed.push('26AS');
        // Dump the TRACES tab if we ever captured one, otherwise the IT portal.
        const tracesTab = context.pages().find((p) => /traces|tdscpc/i.test(p.url()));
        if (tracesTab) {
          log('--- TRACES tab dump ---');
          await dumpInputs(tracesTab, log);
        } else {
          await dumpInputs(page, log);
        }
      }
    }
  } finally {
    if (failed.length) {
      log('One or more downloads failed; keeping browser open for manual continuation.');
    } else {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }

  if (saved.length === 0) {
    const err = new Error('No files were downloaded. Check the activity log for the portal step that failed.');
    err.savedFiles = [];
    throw err;
  }
  if (failed.length) {
    const err = new Error(`${failed.join(', ')} failed. Files saved so far: ${saved.join(', ')}`);
    err.savedFiles = saved;
    throw err;
  }

  return saved;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Try each selector in order, return the first one that resolves to a visible
 * element within the overall timeout. Returns null if none match.
 */
async function findFirstVisible(page, selectors, { timeout = 30000, log } = {}) {
  // Single waitForSelector against the OR-joined selector is much faster than
  // polling each one. Once an element appears, walk the list to figure out which
  // selector actually matched (for diagnostics).
  const joined = selectors.join(', ');
  try {
    await page.waitForSelector(joined, { state: 'visible', timeout });
  } catch {
    return null;
  }
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      log?.(`  matched selector: ${sel}`);
      return loc;
    }
  }
  return page.locator(joined).first();
}

/**
 * Open a top-level menu (e-File, Services, etc.). Tries the visible top nav
 * first; if the menu item isn't visible (narrow viewport — collapsed into
 * hamburger), opens the hamburger then tries again.
 */
async function openTopMenu(page, nameRegex, log) {
  // First try: click directly in the top nav (anchor/button/span/li).
  const direct = page.locator('a, button, span, li', { hasText: nameRegex }).first();
  if (await direct.isVisible().catch(() => false)) {
    log?.('  clicking top-nav: ' + nameRegex);
    await direct.click().catch(() => {});
    await page.waitForTimeout(1000);
    log?.('  --- after top-nav click ---');
    await dumpInputs(page, log);
    return;
  }

  // Fall back to hamburger.
  const hamburger = page.locator('#hamburgerOpen, button[aria-label*="main menu" i]').first();
  if (await hamburger.isVisible().catch(() => false)) {
    log?.('  opening hamburger menu');
    await hamburger.click().catch(() => {});
    await page.waitForTimeout(900);
    log?.('  --- after hamburger click ---');
    await dumpInputs(page, log);
    const inMenu = page.locator('a, button, span, li', { hasText: nameRegex }).first();
    if (await inMenu.isVisible().catch(() => false)) {
      log?.('  clicking menu item: ' + nameRegex);
      await inMenu.click().catch(() => {});
      await page.waitForTimeout(1000);
      log?.('  --- after menu-item click ---');
      await dumpInputs(page, log);
      return;
    }
  }
  log?.('  could not open menu for: ' + nameRegex);
}

/**
 * Open the e-Filing portal hamburger menu and wait until menu links become
 * available. The portal changes its labels/classes often, so this tries the
 * stable id first and then falls back to common accessible labels.
 */
async function openHamburger(page, log) {
  await dismissLogoutPrompt(page, log);

  const alreadyOpen = await page.locator('a#AIS, a#e-File, a#Services, a#Dashboard')
    .first()
    .isVisible()
    .catch(() => false);
  if (alreadyOpen) {
    log?.('  top menu already visible');
    return true;
  }

  const menuSelectors = [
    '#hamburgerOpen',
    'button[aria-label*="main menu" i]',
    'button[aria-label*="menu" i]',
    '[role="button"][aria-label*="menu" i]',
    '.hamburger',
    '.hamburger-menu',
  ];

  for (const selector of menuSelectors) {
    const button = page.locator(selector).first();
    if (await button.isVisible().catch(() => false)) {
      log?.(`  opening hamburger: ${selector}`);
      await button.click().catch(() => {});
      await page.waitForTimeout(1000);

      const menuVisible = await page.locator('a#AIS, a#e-File, a, button, [role="menuitem"]')
        .filter({ hasText: /AIS|e-File|Services|Pending Actions|Dashboard/i })
        .first()
        .isVisible()
        .catch(() => false);
      if (menuVisible) return true;
    }
  }

  log?.('  hamburger menu not found/opened; dumping page controls');
  await dumpInputs(page, log);
  throw new Error('Could not open the e-Filing portal hamburger menu.');
}

async function openViewForm26AS(page, log) {
  const view26asPattern = /View Form 26\s*AS/i;
  log('  opening e-File menu');
  const eFile = page.locator('a#e-File').first();
  await eFile.click({ timeout: 10000 }).catch(async () => {
    await eFile.hover({ timeout: 10000 }).catch(() => {});
  });
  await page.waitForTimeout(700);

  // Use role-based locator for the menuitem (more reliable than text-based).
  const itr = page.getByRole('menuitem', { name: 'Income Tax Returns', exact: true })
    .or(page.getByRole('button', { name: 'Income Tax Returns', exact: true }))
    .first();
  log('  expanding "Income Tax Returns"');
  if (await itr.isVisible().catch(() => false)) {
    // Helper: is the submenu open?
    const submenuVisible = async () =>
      await page.locator('a, button, [role="menuitem"]', { hasText: view26asPattern })
        .first().isVisible().catch(() => false);

    const attempts = [
      // 1. Playwright's locator.dispatchEvent fires real protocol-level events
      //    with proper detail/clientX/clientY — Angular Material's nested
      //    menu checks for `event.detail === 0` to drop fake screen-reader
      //    events, so JS-evaluated events get ignored. Protocol events don't.
      async () => {
        log('    [1] dispatchEvent(mouseenter)');
        await itr.dispatchEvent('mouseenter').catch(() => {});
        await itr.dispatchEvent('mouseover').catch(() => {});
        await page.waitForTimeout(1500);
      },
      // 2. Real CDP mouse move into the button — Playwright drives the actual
      //    Chromium mouse, so events are 100% real. Slide right into the
      //    submenu zone to keep Material from closing it.
      async () => {
        log('    [2] real mouse move');
        const box = await itr.boundingBox().catch(() => null);
        if (box) {
          await page.mouse.move(box.x + 5, box.y + box.height / 2, { steps: 10 }).catch(() => {});
          await page.waitForTimeout(300);
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 }).catch(() => {});
          await page.waitForTimeout(1500);
        }
      },
      // 3. Force-click the menuitem (bypasses pointer-events interception).
      async () => {
        log('    [3] force click');
        await itr.click({ force: true, timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1500);
      },
      // 4. Regular click.
      async () => {
        log('    [4] click');
        await itr.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1500);
      },
      // 5. Keyboard: focus + ArrowRight (WAI-ARIA standard for nested menus).
      async () => {
        log('    [5] keyboard ArrowRight');
        await itr.focus().catch(() => {});
        await page.keyboard.press('ArrowRight').catch(() => {});
        await page.waitForTimeout(1200);
      },
      // 6. Keyboard: Enter after focus.
      async () => {
        log('    [6] keyboard Enter');
        await itr.focus().catch(() => {});
        await page.keyboard.press('Enter').catch(() => {});
        await page.waitForTimeout(1200);
      },
    ];

    for (const attempt of attempts) {
      await attempt();
      if (await submenuVisible()) {
        log('  submenu opened');
        break;
      }
    }
  }

  // Use role-based locator first (most reliable for Material menuitems), then
  // fall back to anchor/button with text matching. AVOID matching span/div —
  // those are usually inner wrappers, not the actual clickable element.
  let view26as = page.getByRole('menuitem', { name: view26asPattern })
    .or(page.locator('button[role="menuitem"]', { hasText: view26asPattern }))
    .or(page.locator('a', { hasText: view26asPattern }))
    .or(page.locator('button', { hasText: view26asPattern }))
    .first();

  if (!(await view26as.isVisible().catch(() => false))) {
    log('  trying DOM fallback for "View Form 26AS"');
    const clicked = await page.evaluate(() => {
      const norm = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
      // Prefer elements that are themselves clickable. Walk the DOM, find a
      // clickable parent whose innerText is JUST "View Form 26AS" (not the
      // whole menu).
      const targetText = (el) => norm(el.innerText || el.textContent);
      const clickable = [...document.querySelectorAll('a[role="menuitem"], button[role="menuitem"], [role="menuitem"], a, button')]
        .filter((el) => /^view form 26\s*as$/i.test(targetText(el))
                     || /view form 26\s*as/i.test(targetText(el)))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
      // Sort: shorter innerText first (less likely to be a wrapping container).
      clickable.sort((a, b) => targetText(a).length - targetText(b).length);
      const target = clickable[0];
      if (!target) return false;
      target.click();
      return true;
    }).catch(() => false);
    if (clicked) {
      log('  DOM fallback click dispatched');
      return;
    }
  }

  if (!(await view26as.isVisible().catch(() => false))) {
    log('--- after Income Tax Returns ---');
    await dumpInputs(page, log);
    await dumpTextMatches(page, /26\s*AS|Tax Credit|Income Tax Returns|e-File/i, log);
    throw new Error('Could not find "View Form 26AS" after expanding Income Tax Returns.');
  }

  log('  clicking "View Form 26AS"');
  await view26as.click({ timeout: 10000 }).catch(async () => {
    await view26as.click({ force: true, timeout: 10000 });
  });
}

/**
 * The e-Filing portal opens a logout confirmation if automation accidentally
 * triggers browser back/refresh protection. Stay logged in by choosing No.
 */
async function dismissLogoutPrompt(page, log) {
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  if (!/sure you want to logout|disabled Back, Forward and Refresh/i.test(bodyText)) return false;

  const noButton = page.getByRole('button', { name: /^no$/i }).first();
  if (await noButton.isVisible().catch(() => false)) {
    log?.('  dismissing logout prompt');
    await noButton.click({ timeout: 10000 }).catch(async () => {
      await noButton.click({ force: true, timeout: 10000 });
    });
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

/**
 * Click the first visible button whose accessible name matches EXACTLY.
 * Use this when there are similarly-named buttons on the page ("Continue" vs
 * "Login Here" etc.) so we don't accidentally hit the wrong one.
 */
async function clickExactButton(page, exactName, log, { timeout = 5000 } = {}) {
  const btn = page.getByRole('button', { name: exactName, exact: true }).first();
  try {
    await btn.waitFor({ state: 'visible', timeout });
    log?.(`  clicking button: ${exactName}`);
    await btn.click({ timeout });
    return true;
  } catch (e) {
    log?.(`  exact button not clicked: ${exactName} (${e.message.split('\n')[0]})`);
    return false;
  }
}

/**
 * The e-Filing login page sometimes shows "Request is not authenticated" if
 * Continue is clicked immediately after the password/checkbox update. A manual
 * second click works, so retry that exact state instead of treating it as a
 * failed login.
 */
async function submitPasswordContinue(page, pwdInput, log) {
  await waitForLoginFormReady(page, log);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const clicked = await clickExactButton(page, 'Continue', log, { timeout: 5000 });
    if (!clicked) {
      log('  Continue button did not click; pressing Enter in password field');
      await pwdInput.press('Enter').catch(() => {});
    }

    const result = await waitForLoginSubmitResult(page);

    if (result === 'submitted') return;
    if (attempt < 3) {
      log(result === 'auth-error'
        ? '  portal showed "Request is not authenticated"; slowing down and retrying Continue'
        : '  still on password page; slowing down and retrying Continue');
      await page.waitForTimeout(2500);
    }
  }
}

async function waitForLoginFormReady(page, log) {
  log?.('  waiting for login form to be ready');
  await page.waitForFunction(() => {
    const pwd = document.querySelector('input[type="password"]');
    const cb = document.querySelector('input[type="checkbox"]');
    const btn = [...document.querySelectorAll('button')]
      .find((button) => /continue/i.test(button.innerText || ''));
    return pwd?.value && (!cb || cb.checked) && btn && !btn.disabled;
  }, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2200);
}

async function waitForLoginSubmitResult(page) {
  const deadline = Date.now() + 6500;
  while (Date.now() < deadline) {
    const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
    if (/request is not authenticated/i.test(bodyText)) return 'auth-error';
    if (/dual login detected|session is currently active in another/i.test(bodyText)) return 'submitted';

    const stillOnPassword = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
    if (!stillOnPassword || !/\/login(\/|$)/.test(page.url())) return 'submitted';

    await page.waitForTimeout(250);
  }
  return 'pending';
}

/**
 * If a prior browser session was closed abruptly, the portal shows
 * "Dual Login Detected" and asks for Login Here. Continue through it.
 */
async function handleDualLoginPrompt(page, log) {
  const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
  if (!/dual login detected|session is currently active in another/i.test(bodyText)) return false;

  log?.('Dual login prompt detected; clicking Login Here');
  return await clickExactButton(page, 'Login Here', log, { timeout: 10000 });
}

/**
 * Click the first visible button (button element or role=button) whose accessible
 * name matches the given regex. Returns true if clicked.
 */
async function clickButtonByName(page, nameRegex, log) {
  const candidates = [
    page.getByRole('button', { name: nameRegex }).first(),
    page.locator('button', { hasText: nameRegex }).first(),
    page.locator('input[type="submit"]').first(),
  ];
  for (const c of candidates) {
    if (await c.isVisible().catch(() => false)) {
      const label = await c.textContent().catch(() => '') || '(submit)';
      log?.(`  clicking button: ${label.trim().slice(0, 40)}`);
      await c.click().catch(() => {});
      return true;
    }
  }
  log?.('  no button matched ' + nameRegex);
  return false;
}

/**
 * Dump every input + button on the page to the log so we can see what selectors
 * to target when something doesn't match.
 */
async function dumpInputs(page, log) {
  try {
    const info = await page.evaluate(() => {
      const out = [];
      const sel = 'input, button, a, [role="button"], [role="menuitem"], mat-expansion-panel-header, mat-menu-item';
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        out.push({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || '',
          id: el.id || '',
          href: el.getAttribute('href') || '',
          placeholder: el.getAttribute('placeholder') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          text: (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        });
      }
      return { url: location.href, controls: out };
    });
    log?.('--- Page diagnostics ---');
    log?.('URL: ' + info.url);
    for (const c of info.controls) {
      log?.(JSON.stringify(c));
    }
    log?.('--- End diagnostics ---');
  } catch (e) {
    log?.('dumpInputs failed: ' + e.message);
  }
}

async function dumpTextMatches(page, regex, log) {
  try {
    const source = regex.source;
    const flags = regex.flags;
    const matches = await page.evaluate(({ source, flags }) => {
      const pattern = new RegExp(source, flags);
      return [...document.querySelectorAll('a, button, [role="menuitem"], span, div')]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            role: el.getAttribute('role') || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            hidden: r.width === 0 && r.height === 0,
            text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 140),
          };
        })
        .filter((item) => pattern.test(item.text) || pattern.test(item.ariaLabel))
        .slice(0, 80);
    }, { source, flags });
    log?.('--- Text match diagnostics ---');
    for (const item of matches) log?.(JSON.stringify(item));
    log?.('--- End text match diagnostics ---');
  } catch (e) {
    log?.('dumpTextMatches failed: ' + e.message);
  }
}

/**
 * On the AIS portal landing page (ais.insight.gov.in), click the AIS or TIS
 * tile and download its PDF.
 */
async function downloadAisOrTis(tab, kind, pan, downloadsDir, stamp, saved, log, assessee) {
  try {
    log(`Downloading ${kind}`);

    const combinedButton = tab.locator('button', { hasText: /Download AIS\/TIS/i }).first();
    if (await combinedButton.isVisible().catch(() => false)) {
      await downloadFromAisTisModal(tab, kind, pan, downloadsDir, stamp, saved, log, assessee);
      return;
    }

    // Click the tile/card whose heading is "AIS" or "TIS"
    const tile = tab.locator('div, a, button, [role="button"]', { hasText: new RegExp(`^\\s*${kind}\\s*$`, 'i') }).first();
    if (await tile.isVisible().catch(() => false)) {
      await tile.click().catch(() => {});
      await tab.waitForTimeout(2500);
    } else {
      log(`  ${kind} tile not visible — dumping AIS portal`);
      await dumpInputs(tab, log);
      throw new Error(`Could not find the ${kind} download entry.`);
    }

    // The AIS detail page has a download icon → menu → PDF
    const downloadIcon = tab.locator('button, a', { hasText: /download/i })
      .or(tab.locator('[title*="Download" i], [aria-label*="Download" i]'))
      .first();
    if (await downloadIcon.isVisible().catch(() => false)) {
      await downloadIcon.click().catch(() => {});
      await tab.waitForTimeout(800);
    }

    const dl = await Promise.all([
      tab.waitForEvent('download', { timeout: 60000 }),
      tab.locator('a, button, li', { hasText: /pdf/i }).first().click(),
    ]);
    const file = path.join(downloadsDir, `${pan}_${kind}_${stamp}.pdf`);
    await dl[0].saveAs(file);
    saved.push(file);
    log(`Saved ${file}`);
    if (assessee) await unlockPdf(file, { pan: assessee.pan, dob: assessee.dob, log });
  } catch (e) {
    log(`${kind} download failed: ` + e.message);
    await dumpInputs(tab, log);
  }
}

/**
 * Current AIS portal layout: a single "Download AIS/TIS" button opens a modal
 * with per-document PDF download entries and a final OK confirmation.
 */
async function downloadFromAisTisModal(tab, kind, pan, downloadsDir, stamp, saved, log, assessee) {
  const textPattern = kind === 'AIS'
    ? /Annual Information Statement \(AIS\)\s*-\s*PDF/i
    : /Taxpayer Information Summary \(TIS\)\s*-\s*PDF/i;

  let row = tab.locator('div, li, tr', {
    hasText: textPattern,
    has: tab.getByRole('button', { name: /download/i }),
  }).last();

  if (!(await row.isVisible().catch(() => false))) {
    log('  opening Download AIS/TIS modal');
    await tab.locator('button', { hasText: /Download AIS\/TIS/i }).first().click({ timeout: 10000 });
    row = tab.locator('div, li, tr', {
      hasText: textPattern,
      has: tab.getByRole('button', { name: /download/i }),
    }).last();
    // Wait for the row to appear instead of a blind 1s sleep — typically ~300ms.
    await row.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  } else {
    log('  AIS/TIS modal already open');
  }

  const startedDownload = tab.waitForEvent('download', { timeout: 60000 });
  startedDownload.catch(() => {});

  const button = row.getByRole('button', { name: /download/i }).first();
  if (!(await button.isVisible().catch(() => false))) {
    await dumpInputs(tab, log);
    throw new Error(`Could not find ${kind} PDF option in AIS/TIS modal.`);
  }
  log(`  clicking ${kind} PDF Download`);
  await button.click({ timeout: 10000 }).catch(async () => {
    await button.click({ force: true, timeout: 10000 });
  });

  await tab.waitForTimeout(500);
  const ok = tab.getByRole('button', { name: /^ok$/i }).first();
  if (await ok.isVisible().catch(() => false)) {
    log('  confirming AIS/TIS download');
    await ok.click({ timeout: 10000 }).catch(async () => {
      await ok.click({ force: true, timeout: 10000 });
    });
  }

  const download = await startedDownload;
  const file = path.join(downloadsDir, `${pan}_${kind}_${stamp}.pdf`);
  await download.saveAs(file);
  saved.push(file);
  log(`Saved ${file}`);
  if (assessee) await unlockPdf(file, { pan: assessee.pan, dob: assessee.dob, log });
  await closeAisTisModalIfOpen(tab, log);
}

/**
 * Find the frame (main or iframe) that contains the TRACES welcome page.
 * The IT portal renders TRACES via a same-origin proxy, so the iframe's
 * .url() can show the eportal URL — match by VISIBLE CONTENT, not URL.
 */
async function findTracesFrame(page, log) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const frames = page.frames();

    // 1. URL match (fastest, works when iframe loads from a TRACES URL)
    const byUrl = frames.find((f) => /traces|tdscpc|welcome26as|tapn/i.test(f.url()));
    if (byUrl) {
      log?.(`  TRACES frame (by URL): ${byUrl.url()}`);
      return byUrl;
    }

    // 2. Content match — look for the modal text inside each frame body.
    for (const f of frames) {
      const hit = await f.evaluate(() => {
        const t = (document.body && document.body.innerText) || '';
        return /ATTENTION TAX PAYERS|I agree to the usage|View\/ ?Verify Tax Credit|Form 26AS\/Annual Tax Statement/i.test(t);
      }).catch(() => false);
      if (hit) {
        log?.(`  TRACES frame (by content): ${f.url() || '(no url)'}`);
        return f;
      }
    }

    await page.waitForTimeout(500);
  }

  // Nothing matched — dump every frame's URL so we can see what's there.
  log?.('  TRACES frame not located; frame inventory:');
  for (const f of page.frames()) {
    log?.(`    - url=${f.url() || '(none)'}  name=${f.name() || '(none)'}`);
  }
  return page.mainFrame();
}

/**
 * TRACES welcome26AS.xhtml shows a modal:
 *   [✓] I agree to the usage and acceptance of Form 16 / 16A generated from TRACES
 *   [ Proceed ]
 * The Proceed button is disabled until the checkbox is ticked. Tick it via JS
 * (label clicks can swallow the change in TRACES's old jQuery markup), then
 * click Proceed. Returns the frame that hosted TRACES so callers can run
 * subsequent steps inside the same context.
 */
async function tickTracesAgreeAndProceed(page, log) {
  const frame = await findTracesFrame(page, log);

  // Wait until the modal text or checkbox is in this frame.
  await frame.locator('text=/I agree to the usage|ATTENTION TAX PAYERS/i')
    .first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

  const checked = await frame.evaluate(() => {
    const cb = [...document.querySelectorAll('input[type="checkbox"]')]
      .find((el) => !el.disabled);
    if (!cb) return false;
    if (!cb.checked) {
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      cb.dispatchEvent(new Event('click', { bubbles: true }));
    }
    return cb.checked;
  }).catch(() => false);

  if (checked) {
    log?.('  TRACES: agree checkbox ticked');
  } else {
    log?.('  TRACES: agree checkbox not found (continuing anyway)');
  }
  await page.waitForTimeout(400);

  // Click Proceed. TRACES uses <input type="button" value="Proceed"> — value
  // attributes don't match `hasText`, so check both.
  let proceedClicked = false;
  const proceedBtn = frame.getByRole('button', { name: 'Proceed', exact: true }).first();
  if (await proceedBtn.isVisible().catch(() => false)) {
    log?.('  TRACES: clicking Proceed button');
    await proceedBtn.click({ timeout: 10000 }).catch(() => {});
    proceedClicked = true;
  }
  if (!proceedClicked) {
    const proceedInput = frame.locator('input[type="button"][value*="Proceed" i], input[type="submit"][value*="Proceed" i]').first();
    if (await proceedInput.isVisible().catch(() => false)) {
      log?.('  TRACES: clicking Proceed input');
      await proceedInput.click({ timeout: 10000 }).catch(() => {});
      proceedClicked = true;
    }
  }
  if (!proceedClicked) {
    log?.('  TRACES: Proceed button not found');
  }
  return frame;
}

async function closeAisTisModalIfOpen(tab, log) {
  const closeButton = tab.locator('button, [role="button"]', { hasText: /^×$|^x$/i }).first()
    .or(tab.locator('[aria-label*="close" i], .close').first());
  if (await closeButton.isVisible().catch(() => false)) {
    log?.('  closing AIS/TIS modal');
    await closeButton.click({ timeout: 5000 }).catch(async () => {
      await closeButton.click({ force: true, timeout: 5000 });
    });
    await tab.waitForTimeout(500);
  }
}

module.exports = { downloadAll };
