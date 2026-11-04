# Dark Mode for Google Docs

A Chrome and Firefox extension that gives Google Docs a real dark mode — without breaking how your document looks.

![icon](icons/icon128.png)

## What it does

- **Recolors the page and text for dark backgrounds.** White paper becomes dark gray, black text becomes light gray.
- **Keeps your colors meaningful.** Red text stays red, links stay blue, highlights keep their hue — they're just adjusted in brightness so they stay readable on a dark page. Text that is light on purpose (e.g. white text in a dark table cell) stays readable too.
- **Pictures are untouched.** Images, screenshots, drawings and emoji show their real colors (no "negative photo" look).
- **Your document is never changed.** This is display-only. Printing, PDF export, sharing and what collaborators see are exactly the same as before.
- **Dark interface** — menus, toolbar, sidebar, find bar, dialogs, rulers.
- **Instant on/off** from the toolbar popup — no reload needed.

## Install

Download the file for your browser from the [latest release](https://github.com/creeperdiamonds/darkmode-googledocs/releases), or build it yourself (see below).

### Chrome / Edge / Brave (Chromium 111+)
1. Unzip `darkmode-googledocs-chrome-v*.zip` (or use this repo folder directly).
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder containing `manifest.json`.

### Firefox (128+)
Firefox only installs add-ons permanently once Mozilla has signed them. Until this one is on
addons.mozilla.org:

- **Try it now (any Firefox):** open `about:debugging#/runtime/this-firefox`, click
  **Load Temporary Add-on…** and pick the `.xpi` file (or `dist/firefox/manifest.json`).
  It stays installed until Firefox restarts.
- **Keep it installed:** use Firefox Developer Edition or Nightly, set
  `xpinstall.signatures.required` to `false` in `about:config`, then open the `.xpi` file.

If the page stays light, open `about:addons` → Dark Mode for Google Docs → **Permissions**
and make sure access to `docs.google.com` is allowed.

Click the extension icon to turn dark mode on/off.

## How it works

Google Docs draws the document onto `<canvas>` tiles. Most dark-mode extensions put an
`invert()` filter over the whole page, which turns photos into negatives and shifts colors.

This extension instead hooks the canvas drawing calls on Docs' document tiles
(`src/canvas-patch.js`, running in the page) and remaps each fill/stroke color as Docs
draws it:

- lightness is flipped in the perceptual **OKLab** color space while hue and saturation are kept;
- text and lines get a minimum brightness so mid-tone colors (pure red, links) stay readable;
- `drawImage` is never touched, so images keep their true colors.

Each tile keeps a small log of its drawing commands since its last full clear, so turning
dark mode on/off replays the tile with the new colors immediately.

In Firefox, Docs draws the page color and images as SVG layers around the text canvas;
those SVG shapes get the same color mapping (images are skipped), and the original values
are remembered so turning it off restores them exactly.

The interface around the document is themed with CSS (`src/dark.css`).

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 definition (Chrome; the Firefox manifest is generated from it) |
| `scripts/build.js` | Builds `dist/chrome`, `dist/firefox` and their .zip / .xpi |
| `src/canvas-patch.js` | Recolors the document canvas (page world) |
| `src/content.js` | Reads the on/off setting and applies it to the page |
| `src/dark.css` | Dark theme for the Docs interface |
| `popup/` | Toolbar popup with the on/off switch |

## Build & test

```
npm install
npm run build          # dist/chrome, dist/firefox + .zip/.xpi packages
npm run lint:firefox   # Mozilla's add-on linter
npm test               # Chrome: pixel tests against a real Google Doc
npm run test:firefox   # Firefox: same tests (installs dist/firefox as a temporary add-on)
npm test -- "<doc url>" mydoc   # any doc you can open
```

The tests load the extension against a real public Google Doc and compare screenshots
pixel by pixel. They check that dark mode recolors the page, that switching it off
restores the **exact** original rendering (0 changed pixels), that switching back on
reproduces the same dark render, that it survives rapid toggling and scrolling, and that
it causes no page errors.

## Privacy

No data is collected or sent anywhere. The only permission is `storage`, used to remember the on/off switch.
