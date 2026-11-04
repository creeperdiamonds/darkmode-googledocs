// Usage: npm test -- <google-doc-url> [tag] [viewportHeight]
// Loads the unpacked extension in Chromium and checks, pixel by pixel, that
// turning dark mode off restores the exact original rendering and that toggling
// back on reproduces the same dark rendering. Screenshots go to tests/out/.
const { chromium } = require('playwright'); const path = require('path'); const os = require('os'); const fs = require('fs'); const { PNG } = require('pngjs');
const EXT = path.resolve(__dirname, '..');
const URL = process.argv[2] || 'https://docs.google.com/document/d/1LRk9qs1wLHAMIfo-RJeyWVXMAuzO6v9D2gN8HhMBa3Q/edit?hl=en';
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const TAG = path.join(OUT, process.argv[3] || 'doc'), VH = +(process.argv[4] || 900);
const PAGE = { x: 310, y: 85, width: 790, height: Math.min(VH, 900) - 100 }; // inside the first page
let failed = false;
function check(label, d, expectSame) { const ok = expectSame ? d.changedPx === 0 : d.changedPx > d.totalPx * 0.5; if (!ok) failed = true; console.log((ok ? 'PASS ' : 'FAIL ') + label, d); }
function diff(a, b) { const A = PNG.sync.read(a), B = PNG.sync.read(b); let n = 0, max = 0; for (let i = 0; i < A.data.length; i += 4) { const d = Math.max(...[0,1,2].map(k => Math.abs(A.data[i+k] - B.data[i+k]))); if (d > 2) n++; max = Math.max(max, d); } return { changedPx: n, totalPx: A.data.length / 4, max }; }
async function open(withExt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-'));
  const args = withExt ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : [];
  const ctx = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, viewport: { width: 1400, height: VH }, locale: 'en-US', args });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('.kix-canvas-tile-content', { timeout: 60000 }); await p.waitForTimeout(5000);
  return { ctx, p, errs };
}
(async () => {
  const base = await open(false);
  const baseShot = await base.p.screenshot({ clip: PAGE });
  base.errCount = base.errs.length; await base.ctx.close();

  const { ctx, p, errs } = await open(true);
  const ep = await ctx.newPage(); await ep.goto('chrome://extensions');
  const id = await ep.evaluate(() => document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-item-list').shadowRoot.querySelector('extensions-item').id); await ep.close();
  const dark1 = await p.screenshot({ clip: PAGE }); await p.screenshot({ path: TAG + '-dark.png' });
  check('dark mode recolors the page', diff(baseShot, dark1), false);
  const pop = await ctx.newPage(); await pop.goto(`chrome-extension://${id}/popup/popup.html`);
  const toggle = async () => { await pop.bringToFront(); await pop.click('.row'); await p.bringToFront(); await p.waitForTimeout(800); };
  await toggle(); const off = await p.screenshot({ clip: PAGE }); await p.screenshot({ path: TAG + '-off.png' });
  check('switching off restores the exact original', diff(baseShot, off), true);
  await toggle(); const dark2 = await p.screenshot({ clip: PAGE });
  check('switching back on matches first dark render', diff(dark1, dark2), true);
  // toggle several times quickly
  for (let i = 0; i < 6; i++) await toggle();
  check('stable after 6 rapid toggles', diff(dark1, await p.screenshot({ clip: PAGE })), true);
  // scroll down and back, ensure stable
  await p.mouse.move(700, 500); await p.mouse.wheel(0, 3000); await p.waitForTimeout(1500); await p.screenshot({ path: TAG + '-scrolled.png' });
  await toggle(); await p.screenshot({ path: TAG + '-scrolled-off.png' }); await toggle();
  await p.mouse.wheel(0, -3000); await p.waitForTimeout(1500);
  check('stable after scrolling away and back', diff(dark1, await p.screenshot({ clip: PAGE })), true);
  // find bar + menu
  await p.keyboard.press('Control+f'); await p.waitForTimeout(800); await p.keyboard.type('Docs'); await p.waitForTimeout(1000); await p.screenshot({ path: TAG + '-find.png' });
  await p.keyboard.press('Escape');
  if (errs.length > base.errCount) failed = true;
  console.log((errs.length > base.errCount ? 'FAIL' : 'PASS') + ' page errors: with extension', errs.length, 'without', base.errCount, errs.slice(0, 5));
  await ctx.close();
  console.log(failed ? 'RESULT: FAILED' : 'RESULT: ALL PASSED');
  process.exit(failed ? 1 : 0);
})();
