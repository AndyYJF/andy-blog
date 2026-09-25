import { visit } from 'unist-util-visit';
import { icons } from '@iconify-json/lucide';

const LUCIDE = {
  info: 'info',
  warning: 'triangle-alert',
  danger: 'octagon-alert',
  success: 'circle-check',
};

const SAFE_BVID = /^BV[\w]+$/i;
const SAFE_NETEASE_ID = /^\d{1,12}$/;
const NETEASE_NOTE_MAX = 48;
const NETEASE_COVER_HOST = /(^|\.)music\.(126|163)\.net$/i;
/** @type {Map<string, Promise<string|null>>} */
const neteaseCoverCache = new Map();

const sanitizeNeteaseNote = (value) => {
  const note = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!note) return '';
  return note.slice(0, NETEASE_NOTE_MAX);
};

const iconSvg = (name) => {
  const i = icons.icons[name];
  if (!i) return '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ico">${i.body}</svg>`;
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Allow only http(s) absolute URLs and same-origin paths starting with a single `/`.
 * Rejects javascript:/data:/vbscript:, protocol-relative `//…`, and other schemes.
 */
const safeHttpUrl = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  // Same-origin absolute path: `/files/x` — not `//evil.com`
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return raw;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
};

const safeNeteaseCoverUrl = (value) => {
  const href = safeHttpUrl(value);
  if (!href) return null;
  try {
    const host = new URL(href).hostname;
    if (!NETEASE_COVER_HOST.test(host)) return null;
    return href;
  } catch {
    return null;
  }
};

async function fetchNeteaseCover(id) {
  if (neteaseCoverCache.has(id)) return neteaseCoverCache.get(id);
  const job = (async () => {
    try {
      const res = await fetch(`https://music.163.com/api/song/detail/?ids=[${id}]`, {
        headers: {
          Referer: 'https://music.163.com/',
          'User-Agent': 'Mozilla/5.0 (compatible; andy-blog-build)',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return safeNeteaseCoverUrl(data?.songs?.[0]?.album?.picUrl);
    } catch {
      return null;
    }
  })();
  neteaseCoverCache.set(id, job);
  return job;
}

function renderNeteaseCardHtml({ id, title, artist, cover, note }) {
  const songUrl = `https://music.163.com/#/song?id=${id}`;
  const embedUrl = `https://music.163.com/outchain/player?type=2&id=${encodeURIComponent(id)}&auto=0&height=66`;
  const placeholder =
    '<svg class="netease-cover-placeholder" viewBox="0 0 96 96" width="96" height="96" aria-hidden="true"><rect width="96" height="96" rx="4" fill="currentColor"/><circle cx="48" cy="48" r="28" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="48" cy="48" r="8" fill="currentColor"/><circle cx="48" cy="48" r="2.5" fill="currentColor"/></svg>';
  const artHtml = cover
    ? `<div class="netease-art"><img class="netease-cover" src="${escapeHtml(cover)}" alt="" width="72" height="72" loading="lazy" decoding="async" /></div>`
    : `<div class="netease-art" aria-hidden="true">${placeholder}</div>`;
  // Note is a card-level sibling so ListeningPage can lift it into .listening-comment.
  const noteHtml = note ? `<p class="netease-note">${escapeHtml(note)}</p>` : '';
  return [
    artHtml,
    `<div class="netease-body"><span class="netease-title">${escapeHtml(title)}</span><span class="netease-artist">${escapeHtml(artist)}</span></div>`,
    `<div class="netease-side"><a class="netease-listen" href="${escapeHtml(songUrl)}" rel="noopener noreferrer" target="_blank">网易云收听 <span aria-hidden="true">↗</span></a><details class="netease-embed-panel"><summary>站内播放</summary><iframe class="netease-embed" loading="lazy" title="网易云 ${escapeHtml(title)}" src="${escapeHtml(embedUrl)}"></iframe></details></div>`,
    noteHtml,
  ].join('');
}

export function remarkCustomDirectives() {
  return async (tree) => {
    const neteaseNodes = [];
    visit(tree, (node) => {
      if (node.type !== 'containerDirective' && node.type !== 'leafDirective') return;
      const attrs = node.attributes ?? {};

      if (node.name === 'alert') {
        const type = LUCIDE[attrs.type] ? attrs.type : 'info';
        node.data = {
          hName: 'div',
          hProperties: {
            className: ['alert', `alert-${type}`],
            role: type === 'danger' ? 'alert' : 'note',
          },
        };
        node.children = node.children || [];
        node.children.unshift({ type: 'html', value: iconSvg(LUCIDE[type]) });
      }

      if (node.name === 'cloud') {
        const href = safeHttpUrl(attrs.url);
        const titleChild = {
          type: 'html',
          value: `<span class="cloud-title">${escapeHtml(attrs.title ?? '文件')}</span>`,
        };
        const iconChild = { type: 'html', value: iconSvg('hard-drive-download') };

        if (href) {
          node.data = {
            hName: 'a',
            hProperties: {
              className: ['cloud-card'],
              href,
              rel: 'noopener noreferrer',
              target: '_blank',
            },
          };
        } else {
          // Non-clickable fallback — never put unsanitized attrs.url into href
          node.data = {
            hName: 'span',
            hProperties: {
              className: ['cloud-card'],
            },
          };
        }
        node.children = [iconChild, titleChild];
      }

      if (node.name === 'collapse') {
        node.data = {
          hName: 'details',
          hProperties: { className: ['collapse'], open: attrs.open === 'true' },
        };
        node.children = [
          {
            type: 'html',
            value: `<summary class="collapse-summary">${iconSvg('chevron-right')}<span>${escapeHtml(attrs.label ?? '展开')}</span></summary>`,
          },
          ...(node.children ?? []),
        ];
      }

      if (node.name === 'bilibili') {
        const bvid = String(attrs.bvid ?? '').trim();
        if (SAFE_BVID.test(bvid)) {
          node.data = {
            hName: 'iframe',
            hProperties: {
              className: ['bili-embed'],
              loading: 'lazy',
              allowfullscreen: true,
              title: `Bilibili 视频 ${bvid}`,
              src: `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&autoplay=0`,
            },
          };
          node.children = [];
        } else {
          node.data = {
            hName: 'p',
            hProperties: { className: ['bili-embed-fallback'] },
          };
          node.children = [{ type: 'text', value: '无效的 Bilibili 视频' }];
        }
      }

      if (node.name === 'netease') {
        neteaseNodes.push(node);
      }
    });

    await Promise.all(
      neteaseNodes.map(async (node) => {
        const attrs = node.attributes ?? {};
        const id = String(attrs.id ?? '').trim();
        const title = String(attrs.title ?? '').trim();
        const artist = String(attrs.artist ?? '').trim();
        const note = sanitizeNeteaseNote(attrs.note);
        if (!SAFE_NETEASE_ID.test(id) || !title || !artist) {
          node.data = {
            hName: 'p',
            hProperties: { className: ['netease-card-fallback'] },
          };
          node.children = [{ type: 'text', value: '无效的网易云歌曲' }];
          return;
        }
        const cover = safeHttpUrl(attrs.cover) || (await fetchNeteaseCover(id));
        const classes = ['netease-card'];
        if (note) classes.push('netease-card--noted');
        node.data = {
          hName: 'div',
          hProperties: { className: classes },
        };
        node.children = [
          {
            type: 'html',
            value: renderNeteaseCardHtml({ id, title, artist, cover, note }),
          },
        ];
      }),
    );
  };
}
