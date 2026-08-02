import { visit } from 'unist-util-visit';
import { icons } from '@iconify-json/lucide';

const LUCIDE = {
  info: 'info',
  warning: 'triangle-alert',
  danger: 'octagon-alert',
  success: 'circle-check',
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
        node.data = {
          hName: 'a',
          hProperties: {
            className: ['cloud-card'],
            href: attrs.url || '#',
            rel: 'noopener noreferrer',
            target: '_blank',
          },
        };
        node.children = [
          { type: 'html', value: iconSvg('hard-drive-download') },
          {
            type: 'html',
            value: `<span class="cloud-title">${escapeHtml(attrs.title ?? '文件')}</span>`,
          },
        ];
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
        node.data = {
          hName: 'iframe',
          hProperties: {
            className: ['bili-embed'],
            loading: 'lazy',
            allowfullscreen: true,
            title: `Bilibili 视频 ${attrs.bvid || ''}`,
            src: `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(attrs.bvid || '')}&autoplay=0`,
          },
        };
        node.children = [];
      }
    });
  };
}
