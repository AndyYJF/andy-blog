import { visit } from 'unist-util-visit';
import { icons } from '@iconify-json/lucide';

const LUCIDE = {
  info: 'info',
  warning: 'triangle-alert',
  danger: 'octagon-alert',
  success: 'circle-check',
};

const SAFE_BVID = /^BV[\w]+$/i;

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

export function remarkCustomDirectives() {
  return (tree) => {
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
    });
  };
}
