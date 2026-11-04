/*
 * Dark Mode for Google Docs - settings bridge (isolated content script).
 * Reads the on/off setting and reflects it onto <html> so that the CSS theme
 * (html.gdm-dark) and the canvas recoloring (data-gdm-dark) follow it.
 */
(() => {
  'use strict';
  const root = document.documentElement;
  let wanted = true;
  let isEditor = true; // assumed until the page has loaded, to avoid a white flash

  function apply() {
    const on = wanted && isEditor;
    root.classList.toggle('gdm-dark', on);
    root.setAttribute('data-gdm-dark', on ? '1' : '0');
  }

  apply();

  chrome.storage.sync.get({ enabled: true }, (s) => {
    wanted = s.enabled !== false;
    apply();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.enabled) {
      wanted = changes.enabled.newValue !== false;
      apply();
    }
  });

  // Safety net: only theme pages that actually contain the Docs editor.
  const checkEditor = () => {
    isEditor = !!document.getElementById('docs-editor-container');
    apply();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkEditor, { once: true });
  else checkEditor();
})();
