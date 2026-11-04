// Builds browser packages into dist/:
//   dist/chrome/   + dist/darkmode-googledocs-chrome-v<ver>.zip
//   dist/firefox/  + dist/darkmode-googledocs-firefox-v<ver>.xpi (unsigned zip)
// The repo root manifest.json is the Chrome manifest (so "Load unpacked" works
// straight from the repo); the Firefox manifest is derived from it here.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const FILES = ['README.md', 'src', 'popup', 'icons'];

const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const version = base.version;

function firefoxManifest(m) {
  const f = JSON.parse(JSON.stringify(m));
  delete f.minimum_chrome_version;
  f.browser_specific_settings = {
    gecko: {
      id: 'darkmode-googledocs@creeperdiamonds',
      // content_scripts "world": "MAIN" needs Firefox 128+
      strict_min_version: '128.0',
      data_collection_permissions: { required: ['none'] },
    },
  };
  return f;
}

function build(name, manifest, ext) {
  const out = path.join(DIST, name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const f of FILES) fs.cpSync(path.join(ROOT, f), path.join(out, f), { recursive: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const zip = new AdmZip();
  zip.addLocalFolder(out);
  const file = path.join(DIST, `darkmode-googledocs-${name}-v${version}.${ext}`);
  zip.writeZip(file);
  console.log('built', path.relative(ROOT, out), '->', path.relative(ROOT, file));
}

fs.mkdirSync(DIST, { recursive: true });
build('chrome', base, 'zip');
build('firefox', firefoxManifest(base), 'xpi');
