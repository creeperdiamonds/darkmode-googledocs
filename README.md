# Dark Mode for Google Docs

A Chrome extension that gives Google Docs a real dark mode — without breaking how your document looks.

![icon](icons/icon128.png)

## What it does

- **Recolors the page and text for dark backgrounds.** White paper becomes dark gray, black text becomes light gray.
- **Keeps your colors meaningful.** Red text stays red, links stay blue, highlights keep their hue — they're just adjusted in brightness so they stay readable on a dark page. Text that is light on purpose (e.g. white text in a dark table cell) stays readable too.
- **Pictures are untouched.** Images, screenshots, drawings and emoji show their real colors (no "negative photo" look).
- **Your document is never changed.** This is display-only. Printing, PDF export, sharing and what collaborators see are exactly the same as before.
- **Dark interface** — menus, toolbar, sidebar, find bar, dialogs, rulers.
- **Instant on/off** from the toolbar popup — no reload needed.

## Install (unpacked)

1. Download this repo (`Code → Download ZIP`) and unzip it, or `git clone` it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder containing `manifest.json`.
4. Open any Google Doc. Click the extension icon to turn dark mode on/off.

Works in Chrome, Edge, Brave and other Chromium browsers (Chrome 111+).

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

The interface around the document is themed with CSS (`src/dark.css`).

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 definition |
| `src/canvas-patch.js` | Recolors the document canvas (page world) |
| `src/content.js` | Reads the on/off setting and applies it to the page |
| `src/dark.css` | Dark theme for the Docs interface |
| `popup/` | Toolbar popup with the on/off switch |

## Testing

An automated test loads the extension into Chromium against a real public Google Doc and
compares screenshots pixel by pixel:

```
npm install
npm test                       # default sample doc
npm test -- "<doc url>" mydoc  # any doc you can open
```

It checks that dark mode recolors the page, that switching it off restores the **exact**
original rendering (0 changed pixels), that switching back on reproduces the same dark
render, that it survives rapid toggling and scrolling, and that it causes no page errors.

## Privacy

No data is collected or sent anywhere. The only permission is `storage`, used to remember the on/off switch.
