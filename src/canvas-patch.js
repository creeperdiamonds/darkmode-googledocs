/*
 * Dark Mode for Google Docs - canvas recoloring (runs in the page's MAIN world).
 *
 * Google Docs draws the document onto <canvas class="kix-canvas-tile-content">
 * tiles. Instead of putting an invert filter over the page (which also inverts
 * images and makes colors lie), we recolor at draw time: every fill/stroke
 * color Docs sets on a document tile is mapped to a dark-theme equivalent.
 *
 *  - Lightness is flipped in the perceptual OKLab space, so white paper turns
 *    dark gray and black text turns light gray.
 *  - Hue and chroma are kept, so red text stays red, blue links stay blue, and
 *    highlights keep their color (just darker).
 *  - drawImage is never touched, so pictures and emoji keep their real colors.
 *
 * Nothing is written back to the document; it is purely how it is displayed.
 *
 * To switch on/off instantly (without a reload), each tile keeps a log of the
 * drawing commands since its last full clear. On toggle the tile is replayed
 * with the new color mapping.
 */
(() => {
  'use strict';

  if (window.__gdmCanvasPatched) return;
  window.__gdmCanvasPatched = true;

  const TILE_CLASS = 'kix-canvas-tile-content';
  const ATTR = 'data-gdm-dark';
  const MAX_LOG = 150000;

  // Output lightness range (OKLab L). White paper -> L_DARK, black text -> L_LIGHT.
  const L_DARK = 0.255; // ~#212121
  const L_LIGHT = 0.915; // ~#e3e3e3
  // < 1 lifts mid-tones a little so colored text stays readable on dark paper.
  const GAMMA = 0.85;
  // Text and lines that were darker than FG_FROM on the original page get at
  // least FG_MIN lightness, so mid-tone colors (pure red, links...) stay readable.
  // Text that was light to begin with (made for dark cells) is left alone.
  const FG_FROM = 0.75;
  const FG_MIN = 0.72;

  // On by default until the isolated content script says otherwise
  // (it reads chrome.storage and reflects the setting into an attribute).
  let enabled = true;
  const readAttr = () => {
    const v = document.documentElement && document.documentElement.getAttribute(ATTR);
    if (v === '0') enabled = false;
    else if (v === '1') enabled = true;
  };
  readAttr();

  // ---------- color math ----------
  const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

  function rgbToOklab(r, g, b) {
    r = srgbToLinear(r / 255);
    g = srgbToLinear(g / 255);
    b = srgbToLinear(b / 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  function oklabToLinear(L, a, b) {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  }

  const inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

  // Map one sRGB color (0-255 channels) to its dark-theme counterpart.
  function darkify(r, g, b, fg) {
    const [L, A, B] = rgbToOklab(r, g, b);
    const inv = Math.pow(1 - Math.min(1, Math.max(0, L)), GAMMA);
    let L2 = L_DARK + (L_LIGHT - L_DARK) * inv;
    if (fg && L < FG_FROM) L2 = Math.max(L2, FG_MIN);
    // Keep hue; reduce chroma only as much as needed to stay displayable.
    let lin = oklabToLinear(L2, A, B);
    if (!inGamut(lin)) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 18; i++) {
        const k = (lo + hi) / 2;
        if (inGamut(oklabToLinear(L2, A * k, B * k))) lo = k;
        else hi = k;
      }
      lin = oklabToLinear(L2, A * lo, B * lo);
    }
    return lin.map((c) => Math.round(255 * Math.min(1, Math.max(0, linearToSrgb(c)))));
  }

  // Private canvas used to normalize CSS color strings (it is not a doc tile).
  const scratch = document.createElement('canvas').getContext('2d');
  const normalize = (v) => {
    scratch.fillStyle = '#000000';
    scratch.fillStyle = v;
    return scratch.fillStyle;
  };
  const RGBA_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;
  const HEX_RE = /^#([0-9a-f]{6})$/i;

  function parse(color) {
    let m = RGBA_RE.exec(color);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    m = HEX_RE.exec(color);
    if (m) {
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    return null;
  }

  const cache = new Map(); // original string -> mapped string
  const fgCache = new Map(); // original string -> mapped foreground string
  const inverse = new Map(); // normalized mapped string -> original string
  function convert(value, fg) {
    const p = parse(value.trim()) || parse(normalize(value));
    if (!p) return value;
    const [r, g, b] = darkify(p[0], p[1], p[2], fg);
    return p[3] >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${p[3]})`;
  }
  function mapColor(value) {
    if (typeof value !== 'string') return value; // gradients / patterns pass through
    let out = cache.get(value);
    if (out !== undefined) return out;
    out = convert(value, false);
    if (cache.size > 4096) {
      cache.clear();
      fgCache.clear();
      inverse.clear();
    }
    cache.set(value, out);
    inverse.set(normalize(out), value);
    return out;
  }
  // Foreground version of the color currently set on ctx (already mapped), or null.
  function foregroundFor(current) {
    if (typeof current !== 'string') return null;
    const orig = inverse.get(current);
    if (orig === undefined) return null;
    let out = fgCache.get(orig);
    if (out === undefined) {
      out = convert(orig, true);
      fgCache.set(orig, out);
    }
    return out;
  }

  // ---------- per-tile draw log ----------
  const proto = CanvasRenderingContext2D.prototype;
  const recs = new WeakMap(); // canvas -> record
  let replaying = false;

  const isTile = (canvas) => !!(canvas && canvas.classList && canvas.classList.contains(TILE_CLASS));

  function freshRec(canvas) {
    const rec = { log: [], depth: 0, rootClip: false, broken: false, mode: enabled };
    recs.set(canvas, rec);
    return rec;
  }
  const recFor = (canvas) => recs.get(canvas) || freshRec(canvas);

  function push(rec, entry) {
    if (rec.broken) return;
    if (rec.log.length >= MAX_LOG) {
      rec.broken = true; // stop recording until Docs resets this tile
      rec.log = [];
      return;
    }
    rec.log.push(entry);
  }

  const origGetTransform = proto.getTransform;
  const origGetLineDash = proto.getLineDash;
  const origSetTransform = proto.setTransform;
  const origSetLineDash = proto.setLineDash;
  const origReset = proto.reset;

  // Accessor properties that are part of the drawing state.
  const stateProps = Object.getOwnPropertyNames(proto).filter((name) => {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    return d && d.get && d.set;
  });
  const propDesc = {};
  for (const name of stateProps) propDesc[name] = Object.getOwnPropertyDescriptor(proto, name);

  // Capture the full state of a context so the log before this point can be dropped.
  function snapshot(ctx, rec) {
    const props = {};
    for (const name of stateProps) {
      let v = propDesc[name].get.call(ctx);
      if ((name === 'fillStyle' || name === 'strokeStyle') && typeof v === 'string' && rec.mode) {
        const orig = inverse.get(v);
        if (orig !== undefined) v = orig;
      }
      props[name] = v;
    }
    return [2, origGetTransform.call(ctx), origGetLineDash.call(ctx), props];
  }

  function coversCanvas(ctx, x, y, w, h) {
    const t = origGetTransform.call(ctx);
    if (t.b !== 0 || t.c !== 0) return false;
    const xs = [t.a * x + t.e, t.a * (x + w) + t.e];
    const ys = [t.d * y + t.f, t.d * (y + h) + t.f];
    const c = ctx.canvas;
    return Math.min(...xs) <= 0 && Math.max(...xs) >= c.width && Math.min(...ys) <= 0 && Math.max(...ys) >= c.height;
  }

  // ---------- patch state setters (colors are mapped here) ----------
  for (const name of stateProps) {
    const desc = propDesc[name];
    const isColor = name === 'fillStyle' || name === 'strokeStyle';
    Object.defineProperty(proto, name, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set(value) {
        const canvas = this.canvas;
        if (!isTile(canvas)) return desc.set.call(this, value);
        if (!replaying) push(recFor(canvas), [0, name, value]);
        let v = value;
        if (isColor && enabled) {
          try {
            v = mapColor(value);
          } catch (e) {
            v = value; // never break drawing
          }
        }
        desc.set.call(this, v);
      },
    });
  }

  // ---------- patch methods (recorded for replay) ----------
  const READ_ONLY = new Set([
    'constructor', 'reset', 'measureText', 'getImageData', 'isPointInPath', 'isPointInStroke',
    'getTransform', 'getLineDash', 'getContextAttributes', 'createLinearGradient',
    'createRadialGradient', 'createConicGradient', 'createPattern', 'createImageData', 'isContextLost',
  ]);
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (READ_ONLY.has(name)) continue;
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== 'function') continue;
    const orig = desc.value;
    const wrapped = {
      [name](...args) {
        const canvas = this.canvas;
        if (replaying || !isTile(canvas)) return orig.apply(this, args);
        const rec = recFor(canvas);
        if (name === 'save') rec.depth++;
        else if (name === 'restore') rec.depth = Math.max(0, rec.depth - 1);
        else if (name === 'clip' && rec.depth === 0) rec.rootClip = true;
        else if (
          name === 'clearRect' &&
          rec.depth === 0 &&
          !rec.rootClip &&
          coversCanvas(this, args[0], args[1], args[2], args[3])
        ) {
          // Everything drawn before a full clear is gone; keep only the state.
          rec.log = [snapshot(this, rec)];
          rec.broken = false;
          rec.mode = enabled;
        }
        push(rec, [1, orig, args, name]);
        return invoke(this, name, orig, args);
      },
    }[name];
    Object.defineProperty(proto, name, { ...desc, value: wrapped });
  }

  if (origReset) {
    Object.defineProperty(proto, 'reset', {
      ...Object.getOwnPropertyDescriptor(proto, 'reset'),
      value: function reset() {
        if (!replaying && isTile(this.canvas)) freshRec(this.canvas);
        return origReset.call(this);
      },
    });
  }

  // Resizing a canvas wipes its bitmap and context state.
  for (const dim of ['width', 'height']) {
    const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dim);
    if (!d || !d.set) continue;
    Object.defineProperty(HTMLCanvasElement.prototype, dim, {
      ...d,
      set(v) {
        if (!replaying && isTile(this)) freshRec(this);
        d.set.call(this, v);
      },
    });
  }

  // Text/lines are drawn with the foreground mapping; fills keep the plain one.
  const FG_METHODS = { fillText: 'fillStyle', strokeText: 'strokeStyle', stroke: 'strokeStyle' };
  function invoke(ctx, name, orig, args) {
    const prop = enabled && FG_METHODS[name];
    if (prop) {
      const d = propDesc[prop];
      const current = d.get.call(ctx);
      const fg = foregroundFor(current);
      if (fg && fg !== current) {
        d.set.call(ctx, fg);
        try {
          return orig.apply(ctx, args);
        } finally {
          d.set.call(ctx, current);
        }
      }
    }
    return orig.apply(ctx, args);
  }

  function replayTile(canvas) {
    const rec = recs.get(canvas);
    if (!rec || rec.broken || !rec.log.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    replaying = true;
    try {
      if (origReset) origReset.call(ctx);
      else canvas.width = canvas.width; // eslint-disable-line no-self-assign
      for (const e of rec.log) {
        if (e[0] === 1) {
          invoke(ctx, e[3], e[1], e[2]);
        } else if (e[0] === 0) {
          ctx[e[1]] = e[2]; // goes through the patched setter -> current mapping
        } else {
          origSetTransform.call(ctx, e[1]);
          origSetLineDash.call(ctx, e[2]);
          for (const k in e[3]) {
            try {
              ctx[k] = e[3][k];
            } catch (err) {
              /* ignore unsupported props */
            }
          }
        }
      }
      rec.mode = enabled;
    } catch (err) {
      rec.broken = true;
    } finally {
      replaying = false;
    }
  }

  function repaintAll() {
    document.querySelectorAll('canvas.' + TILE_CLASS).forEach(replayTile);
  }

  // ---------- react to the on/off switch ----------
  const startObserver = () => {
    new MutationObserver(() => {
      const before = enabled;
      readAttr();
      if (before !== enabled) repaintAll();
    }).observe(document.documentElement, { attributes: true, attributeFilter: [ATTR] });
  };
  if (document.documentElement) startObserver();
  else document.addEventListener('readystatechange', startObserver, { once: true });
})();
