/**
 * CMS live-preview renderer: Joe editor markdown → Astro-like article HTML.
 * Approximates the public pipeline (shortcodes, GFM, KaTeX, mermaid fences)
 * without Playwright/Expressive Code.
 */
import { marked } from 'marked';
import katex from '../../astro/node_modules/katex/dist/katex.mjs';
import { convertShortcodes } from './shortcodes.js';
import { normalizeHeadings } from './headings.js';
import { remapFenceLangs } from './fence-langs.js';
import { normalizeJoeTaskMarkers } from './joe-task-markers.js';

const ALERT_TYPES = {
  info: 'info',
  warning: 'warning',
  danger: 'danger',
  success: 'success',
};

const ICONS = {
  info: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></g>',
  'triangle-alert': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4m0 4h.01"/>',
  'octagon-alert': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 16h.01M12 8v4m3.312-10a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>',
  'circle-check': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12l2 2l4-4"/></g>',
  'hard-drive-download': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 2v8m4-4l-4 4l-4-4"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 18h.01M10 18h.01"/></g>',
  'chevron-right': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m9 18l6-6l-6-6"/>',
};

const ALERT_ICON = {
  info: 'info',
  warning: 'triangle-alert',
  danger: 'octagon-alert',
  success: 'circle-check',
};

const iconSvg = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ico">${ICONS[name] || ''}</svg>`;

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const parseAttrs = (s = '') => {
  const out = {};
  for (const m of String(s).matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};

const shieldFences = (text) => {
  const store = [];
  const masked = text.replace(/(```[\s\S]*?```|`[^`\n]*`)/g, (m) => {
    store.push(m);
    return `\u0000SHIELD${store.length - 1}\u0000`;
  });
  return [masked, (s) => s.replace(/\u0000SHIELD(\d+)\u0000/g, (_, i) => store[Number(i)])];
};

function renderKatex(source, displayMode) {
  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      output: 'html',
    });
  } catch {
    return `<code>${escapeHtml(source)}</code>`;
  }
}

function renderMath(text) {
  const [masked, unshield] = shieldFences(text);
  let out = masked.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) =>
    renderKatex(expr.trim(), true),
  );
  out = out.replace(/(^|[^\\])\$([^\s$][^$\n]*?[^\s$])\$/g, (_, prefix, expr) =>
    `${prefix}${renderKatex(expr.trim(), false)}`,
  );
  return unshield(out);
}

function slugifyHeading(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function renderCode({ text, lang }) {
  const language = String(lang || '').trim().split(/\s+/)[0];
  if (language === 'mermaid') {
    return `<pre class="astro-preview-mermaid"><code class="ap-pre">${escapeHtml(text)}</code></pre>\n`;
  }
  const label = language ? ` data-lang="${escapeHtml(language)}"` : '';
  return `<pre class="astro-preview-code"${label}><code class="ap-pre">${escapeHtml(text)}</code></pre>\n`;
}

const renderer = {
  code(token, infostring) {
    if (token && typeof token === 'object') {
      return renderCode({ text: token.text, lang: token.lang });
    }
    return renderCode({ text: token, lang: infostring });
  },
  codespan(token) {
    const text = token && typeof token === 'object' ? token.text : token;
    return `<code class="ap-code">${escapeHtml(text)}</code>`;
  },
  heading(token, level, raw) {
    if (token && typeof token === 'object' && token.text != null) {
      const depth = token.depth || 2;
      const id = slugifyHeading(token.text);
      const inner = this.parser ? this.parser.parseInline(token.tokens) : escapeHtml(token.text);
      return `<h${depth} id="${escapeHtml(id)}">${inner}<a class="anchor" href="#${escapeHtml(id)}" aria-label="本节锚点">#</a></h${depth}>\n`;
    }
    const depth = level;
    const id = slugifyHeading(raw);
    return `<h${depth} id="${escapeHtml(id)}">${token}<a class="anchor" href="#${escapeHtml(id)}" aria-label="本节锚点">#</a></h${depth}>\n`;
  },
};

marked.use({
  gfm: true,
  breaks: false,
  renderer,
});

function renderAlert(attrs, innerHtml) {
  const type = ALERT_TYPES[attrs.type] ? attrs.type : 'info';
  const role = type === 'danger' ? 'alert' : 'note';
  return `<div class="alert alert-${type}" role="${role}">${iconSvg(ALERT_ICON[type])}<div>${innerHtml}</div></div>\n`;
}

function renderCloud(attrs) {
  const title = attrs.title ?? '文件';
  const url = attrs.url || '#';
  return `<a class="cloud-card" href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank">${iconSvg('hard-drive-download')}<span class="cloud-title">${escapeHtml(title)}</span></a>\n`;
}

function renderCollapse(attrs, innerHtml) {
  const open = attrs.open === 'true' ? ' open' : '';
  const label = attrs.label ?? '展开';
  return `<details class="collapse"${open}><summary class="collapse-summary">${iconSvg('chevron-right')}<span>${escapeHtml(label)}</span></summary>${innerHtml}</details>\n`;
}

function renderBilibili(attrs) {
  const bvid = attrs.bvid || '';
  return `<iframe class="bili-embed" loading="lazy" allowfullscreen title="Bilibili 视频 ${escapeHtml(bvid)}" src="https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&autoplay=0"></iframe>\n`;
}

function renderNetease(attrs) {
  const rawId = String(attrs.id || '').trim();
  const fromUrl = /(?:[?&#]id=|\/song\/|song\?id=)(\d{1,12})/i.exec(rawId);
  const id = fromUrl ? fromUrl[1] : rawId;
  // Preview is sync: title/artist are optional; build will fill from NetEase when publishing.
  const title = String(attrs.title || '').trim() || (id ? `歌曲 ${id}` : '');
  const artist = String(attrs.artist || '').trim() || (id ? '网易云' : '');
  const cover = attrs.cover || '';
  const note = String(attrs.note || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  if (!/^\d{1,12}$/.test(id)) {
    return `<p class="netease-card-fallback">无效的网易云歌曲</p>\n`;
  }
  const songUrl = `https://music.163.com/#/song?id=${id}`;
  const embedUrl = `https://music.163.com/outchain/player?type=2&id=${encodeURIComponent(id)}&auto=0&height=66`;
  const placeholder =
    '<svg class="netease-cover-placeholder" viewBox="0 0 96 96" width="96" height="96" aria-hidden="true"><rect width="96" height="96" rx="4" fill="currentColor"/><circle cx="48" cy="48" r="28" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="48" cy="48" r="8" fill="currentColor"/><circle cx="48" cy="48" r="2.5" fill="currentColor"/></svg>';
  const artHtml = cover
    ? `<div class="netease-art"><img class="netease-cover" src="${escapeHtml(cover)}" alt="" width="72" height="72" loading="lazy" decoding="async" /></div>`
    : `<div class="netease-art" aria-hidden="true">${placeholder}</div>`;
  const noteHtml = note ? `<p class="netease-note">${escapeHtml(note)}</p>` : '';
  const classes = ['netease-card'];
  if (note) classes.push('netease-card--noted');
  return `<div class="${classes.join(' ')}">${artHtml}<div class="netease-body"><span class="netease-title">${escapeHtml(title)}</span><span class="netease-artist">${escapeHtml(artist)}</span></div><div class="netease-side"><a class="netease-listen" href="${escapeHtml(songUrl)}" rel="noopener noreferrer" target="_blank">网易云收听 <span aria-hidden="true">↗</span></a><details class="netease-embed-panel"><summary>站内播放</summary><iframe class="netease-embed" loading="lazy" title="网易云 ${escapeHtml(title)}" src="${escapeHtml(embedUrl)}"></iframe></details></div>${noteHtml}</div>\n`;
}

function replaceDirectives(text) {
  let out = text.replace(/:::alert\{([^}]*)\}\n([\s\S]*?)\n:::/g, (_, attrs, body) =>
    renderAlert(parseAttrs(attrs), renderMarkdown(body.trim())),
  );
  out = out.replace(/:::collapse\{([^}]*)\}\n([\s\S]*?)\n:::/g, (_, attrs, body) =>
    renderCollapse(parseAttrs(attrs), renderMarkdown(body.trim())),
  );
  out = out.replace(/:::cloud\{([^}]*)\}\n:::/g, (_, attrs) => renderCloud(parseAttrs(attrs)));
  out = out.replace(/:::bilibili\{([^}]*)\}\n:::/g, (_, attrs) => renderBilibili(parseAttrs(attrs)));
  out = out.replace(/:::netease\{([^}]*)\}\n:::/g, (_, attrs) => renderNetease(parseAttrs(attrs)));
  return out;
}

function renderMarkdown(source) {
  const withDirectives = replaceDirectives(source);
  const withMath = renderMath(withDirectives);
  return marked.parse(withMath, { async: false });
}

/**
 * @param {string} source
 * @param {{ theme?: 'light' | 'dark', cid?: string|number }} [options]
 */
export function renderAstroPreview(source, { theme = 'light', cid = 'preview' } = {}) {
  const stripped = String(source || '').replace(/^<!--markdown-->\s*/i, '');
  const converted = convertShortcodes(stripped, cid, { strict: false });
  const headings = normalizeHeadings(converted.text);
  const fences = remapFenceLangs(headings.text);
  const tasks = normalizeJoeTaskMarkers(fences.text, { sourceFormat: 'markdown' });
  const body = renderMarkdown(tasks.text);
  const safeTheme = theme === 'dark' ? 'dark' : 'light';
  return `<div class="astro-preview" data-theme="${safeTheme}">
<div class="astro-preview-toolbar">
<button type="button" class="astro-preview-theme" data-astro-preview-theme aria-label="切换预览明暗主题" aria-pressed="${safeTheme === 'dark' ? 'true' : 'false'}">${safeTheme === 'dark' ? '暗色' : '亮色'}</button>
<span class="astro-preview-hint">Astro 预览</span>
</div>
<article class="prose">${body}</article>
</div>`;
}

export const PREVIEW_THEME_KEY = 'astro-preview-theme-v2';

export function previewThemeFromStorage(storage) {
  try {
    const saved = storage?.getItem?.(PREVIEW_THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  return 'light';
}
