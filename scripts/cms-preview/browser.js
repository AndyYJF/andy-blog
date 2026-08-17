/**
 * Joe editor hook: replace HyperDown.makeHtml with the Astro preview renderer.
 */
import { PREVIEW_THEME_KEY, previewThemeFromStorage, renderAstroPreview } from '../lib/cms-preview-render.js';

const THEME_KEY = PREVIEW_THEME_KEY;

function currentTheme() {
  return previewThemeFromStorage(window.localStorage);
}

function setTheme(theme) {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

function patchHyperDown() {
  const HyperDown = window.HyperDown;
  if (!HyperDown || HyperDown.prototype.__astroPreviewPatched) return false;
  HyperDown.prototype.makeHtml = function makeHtml(text) {
    return renderAstroPreview(text, { theme: currentTheme() });
  };
  HyperDown.prototype.__astroPreviewPatched = true;
  return true;
}

function enhance(root) {
  if (!root) return;
  const preview = root.querySelector('.astro-preview');
  if (!preview) return;

  const theme = currentTheme();
  preview.dataset.theme = theme;
  const toggle = preview.querySelector('[data-astro-preview-theme]');
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(theme === 'dark'));
    toggle.textContent = theme === 'dark' ? '暗色' : '亮色';
  }

  runMermaid(preview);
}

let mermaidLoading = null;

function mermaidSrc() {
  return window.AndyAstroPreviewMermaidSrc || '';
}

async function ensureMermaid(theme) {
  if (window.mermaid) {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
    });
    return window.mermaid;
  }
  const src = mermaidSrc();
  if (!src) return null;
  if (!mermaidLoading) {
    mermaidLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve(window.mermaid);
      script.onerror = () => reject(new Error('mermaid load failed'));
      document.head.appendChild(script);
    }).catch(() => null);
  }
  const mermaid = await mermaidLoading;
  if (!mermaid) return null;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'dark' ? 'dark' : 'default',
  });
  return mermaid;
}

async function runMermaid(preview) {
  const blocks = [...preview.querySelectorAll('.astro-preview-mermaid')];
  if (!blocks.length) return;
  const mermaid = await ensureMermaid(preview.dataset.theme);
  if (!mermaid?.render) return;
  await Promise.all(
    blocks.map(async (block, index) => {
      if (block.dataset.rendered === '1') return;
      const source = block.textContent || '';
      try {
        const id = `astro-preview-mmd-${Date.now()}-${index}`;
        const { svg } = await mermaid.render(id, source);
        const wrap = document.createElement('div');
        wrap.className = 'beoe astro-preview-mermaid-svg';
        wrap.innerHTML = svg;
        block.replaceWith(wrap);
      } catch {
        block.dataset.rendered = 'error';
      }
    }),
  );
}

function observePreview() {
  const attach = (node) => {
    if (!(node instanceof Element)) return;
    const content = node.matches?.('.cm-preview-content')
      ? node
      : node.querySelector?.('.cm-preview-content');
    if (!content || content.dataset.astroPreviewObserved) return;
    content.dataset.astroPreviewObserved = '1';
    enhance(content);
    new MutationObserver(() => enhance(content)).observe(content, { childList: true });
  };

  attach(document);
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) attach(node);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

function bindThemeClicks() {
  if (window.__andyAstroPreviewClicks) return;
  window.__andyAstroPreviewClicks = true;
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('[data-astro-preview-theme]')
      : null;
    if (!button) return;
    event.preventDefault();
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    const preview = button.closest('.astro-preview');
    if (!preview) return;
    preview.dataset.theme = next;
    button.setAttribute('aria-pressed', String(next === 'dark'));
    button.textContent = next === 'dark' ? '暗色' : '亮色';
    runMermaid(preview);
  });
}

function boot() {
  patchHyperDown();
  bindThemeClicks();
  observePreview();
}

window.AndyAstroPreview = {
  render: (text) => renderAstroPreview(text, { theme: currentTheme() }),
  patchHyperDown,
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
setTimeout(patchHyperDown, 0);
