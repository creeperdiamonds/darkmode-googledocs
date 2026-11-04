// Usage: npm run test:firefox -- [google-doc-url] [tag] [viewportHeight]
// Same checks as tests/suite.js, in Firefox: installs dist/firefox as a temporary
// add-on through Firefox's remote debugging protocol, then compares screenshots.
// Run `npm run build` first.
const { firefox } = require('playwright');
const net = require('net'); const path = require('path'); const fs = require('fs'); const { PNG } = require('pngjs');

const SHIPPED = path.resolve(__dirname, '..', 'dist', 'firefox');
// Test copy = the shipped package + an empty background script. It only gives the
// debugger a context inside the add-on to flip the setting from; every shipped file
// (content scripts, CSS, popup) is identical.
const EXT = path.resolve(__dirname, '..', 'dist', 'firefox-test');
function makeTestCopy() {
  fs.rmSync(EXT, { recursive: true, force: true });
  fs.cpSync(SHIPPED, EXT, { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  m.background = { scripts: ['test-bg.js'] };
  fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify(m, null, 2));
  fs.writeFileSync(path.join(EXT, 'test-bg.js'), '// test hook only\n');
}
const ADDON_ID = 'darkmode-googledocs@creeperdiamonds';
const URL = process.argv[2] || 'https://docs.google.com/document/d/1LRk9qs1wLHAMIfo-RJeyWVXMAuzO6v9D2gN8HhMBa3Q/edit?hl=en';
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const TAG = path.join(OUT, 'firefox-' + (process.argv[3] || 'doc')), VH = +(process.argv[4] || 900);
const PAGE = { x: 310, y: 85, width: 790, height: Math.min(VH, 900) - 100 };

let failed = false;
function check(label, d, expectSame) { const ok = expectSame ? d.changedPx === 0 : d.changedPx > d.totalPx * 0.5; if (!ok) failed = true; console.log((ok ? 'PASS ' : 'FAIL ') + label, d); }
function diff(a, b) { const A = PNG.sync.read(a), B = PNG.sync.read(b); let n = 0, max = 0; for (let i = 0; i < A.data.length; i += 4) { const d = Math.max(...[0, 1, 2].map(k => Math.abs(A.data[i + k] - B.data[i + k]))); if (d > 2) n++; max = Math.max(max, d); } return { changedPx: n, totalPx: A.data.length / 4, max }; }

// Minimal client for Firefox's remote debugging protocol (length-prefixed JSON).
class RDP {
  static connect(port) {
    return new Promise((resolve, reject) => {
      const c = new RDP(); c.sock = net.connect(port, '127.0.0.1'); c.buf = Buffer.alloc(0); c.waiters = [];
      c.sock.on('data', (d) => { c.buf = Buffer.concat([c.buf, d]); c.drain(); });
      c.sock.on('error', reject);
      c.waitFor((m) => m.applicationType).then(() => resolve(c), reject);
    });
  }
  drain() {
    for (;;) {
      const i = this.buf.indexOf(':'); if (i < 0) return;
      const n = +this.buf.slice(0, i).toString(); if (this.buf.length < i + 1 + n) return;
      const msg = JSON.parse(this.buf.slice(i + 1, i + 1 + n).toString('utf8')); this.buf = this.buf.slice(i + 1 + n);
      const w = this.waiters.findIndex((x) => x.pred(msg)); if (w >= 0) this.waiters.splice(w, 1)[0].resolve(msg);
    }
  }
  waitFor(pred) { return new Promise((resolve) => this.waiters.push({ pred, resolve })); }
  request(to, type, extra = {}, pred) {
    const p = this.waitFor(pred || ((m) => m.from === to));
    const j = JSON.stringify({ to, type, ...extra }); this.sock.write(Buffer.byteLength(j) + ':' + j);
    return p;
  }
  async evalInAddon(consoleActor, text) {
    const r = await this.request(consoleActor, 'evaluateJSAsync', { text }, (m) => m.from === consoleActor && m.resultID);
    const res = await this.waitFor((m) => m.type === 'evaluationResult' && m.resultID === r.resultID);
    if (res.exceptionMessage) throw new Error(res.exceptionMessage);
    return res.result;
  }
  close() { this.sock.end(); }
}

async function installAndAttach(port) {
  let rdp;
  for (let i = 0; ; i++) { try { rdp = await RDP.connect(port); break; } catch (e) { if (i > 20) throw e; await new Promise((r) => setTimeout(r, 500)); } }
  const root = await rdp.request('root', 'getRoot');
  const inst = await rdp.request(root.addonsActor, 'installTemporaryAddon', { addonPath: EXT, openDevTools: false });
  if (inst.error) throw new Error(inst.error + ': ' + inst.message);
  const list = await rdp.request('root', 'listAddons');
  const addon = list.addons.find((a) => a.id === ADDON_ID);
  // Ask the add-on's watcher for its frame target (its extension document) and use its console.
  const watcher = await rdp.request(addon.actor, 'getWatcher', { isServerTargetSwitchingEnabled: true }, (m) => m.from === addon.actor && m.actor);
  const avail = rdp.waitFor((m) => m.type === 'target-available-form' && m.target && m.target.consoleActor && String(m.target.url).startsWith('moz-extension://'));
  rdp.request(watcher.actor, 'watchTargets', { targetType: 'frame' });
  const target = (await avail).target;
  return { rdp, consoleActor: target.consoleActor };
}

async function open(withExt) {
  const port = 6000 + Math.floor(Math.random() * 2000);
  const browser = await firefox.launch({
    headless: true,
    args: withExt ? ['-start-debugger-server', String(port)] : [],
    firefoxUserPrefs: withExt ? {
      'devtools.debugger.remote-enabled': true, 'devtools.chrome.enabled': true, 'devtools.debugger.prompt-connection': false,
      'extensions.background.idle.timeout': 3600000,
    } : {},
  });
  if (withExt) {
    var addonCtl = await installAndAttach(port);
  }
  const ctx = await browser.newContext({ viewport: { width: 1400, height: VH }, locale: 'en-US' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('.kix-canvas-tile-content', { timeout: 60000 }); await p.waitForTimeout(5000);
  return { browser, ctx, p, errs, addonCtl };
}

(async () => {
  if (!fs.existsSync(path.join(SHIPPED, 'manifest.json'))) { console.error('dist/firefox missing - run `npm run build` first'); process.exit(2); }
  makeTestCopy();
  const base = await open(false);
  const baseShot = await base.p.screenshot({ clip: PAGE });
  const baseErrs = base.errs.length; await base.browser.close();

  const { browser, ctx, p, errs, addonCtl } = await open(true);
  const dark1 = await p.screenshot({ clip: PAGE }); await p.screenshot({ path: TAG + '-dark.png' });
  check('dark mode recolors the page', diff(baseShot, dark1), false);
  // Flip the setting exactly as the popup does (browser.storage.sync), from the add-on's own context.
  let on = true;
  const toggle = async () => {
    on = !on;
    await addonCtl.rdp.evalInAddon(addonCtl.consoleActor, `browser.storage.sync.set({ enabled: ${on} })`);
    await p.waitForTimeout(800);
  };
  await toggle(); const off = await p.screenshot({ clip: PAGE }); await p.screenshot({ path: TAG + '-off.png' });
  check('switching off restores the exact original', diff(baseShot, off), true);
  await toggle();
  check('switching back on matches first dark render', diff(dark1, await p.screenshot({ clip: PAGE })), true);
  for (let i = 0; i < 6; i++) await toggle();
  check('stable after 6 rapid toggles', diff(dark1, await p.screenshot({ clip: PAGE })), true);
  await p.mouse.move(700, 500); await p.mouse.wheel(0, 3000); await p.waitForTimeout(1500); await p.screenshot({ path: TAG + '-scrolled.png' });
  await p.mouse.wheel(0, -3000); await p.waitForTimeout(1500);
  check('stable after scrolling away and back', diff(dark1, await p.screenshot({ clip: PAGE })), true);
  await p.keyboard.press('Control+f'); await p.waitForTimeout(800); await p.keyboard.type('Docs'); await p.waitForTimeout(1000); await p.screenshot({ path: TAG + '-find.png' }); await p.keyboard.press('Escape');
  if (errs.length > baseErrs) failed = true;
  console.log((errs.length > baseErrs ? 'FAIL' : 'PASS') + ' page errors: with extension', errs.length, 'without', baseErrs, errs.slice(0, 5));
  addonCtl.rdp.close(); await browser.close();
  console.log(failed ? 'RESULT: FAILED' : 'RESULT: ALL PASSED');
  process.exit(failed ? 1 : 0);
})();
