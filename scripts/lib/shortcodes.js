/**
 * Build-time Typecho/Joe shortcode → remark-directive.
 * Does not mutate the database.
 */
const parseAttrs = (s = '') => {
  const out = {};
  for (const m of String(s).matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};

const escapeAttr = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

const shield = (text) => {
  const store = [];
  const masked = text.replace(/(```[\s\S]*?```|`[^`\n]*`)/g, (m) => {
    store.push(m);
    return `\u0000SHIELD${store.length - 1}\u0000`;
  });
  return [
    masked,
    (s) => s.replace(/\u0000SHIELD(\d+)\u0000/g, (_, i) => store[Number(i)]),
  ];
};

/**
 * @param {string} text
 * @param {number|string} cid
 * @returns {{ text: string, hits: Array<{ kind: string, detail: string }> }}
 */
export function convertShortcodes(text, cid) {
  const [masked, unshield] = shield(text);
  let out = masked;
  const hits = [];

  // Block alert: {alert type="info"}...{/alert}
  out = out.replace(/\{alert([^}]*)\}([\s\S]*?)\{\/alert\}/g, (_, attrs, body) => {
    const { type = 'info' } = parseAttrs(attrs);
    hits.push({ kind: 'alert-block', detail: type });
    return `\n:::alert{type="${escapeAttr(type)}"}\n${body.trim()}\n:::\n`;
  });

  // Joe self-closing message: {message type="info" content="..."/}
  out = out.replace(/\{message([^}]*)\/\}/g, (_, attrs) => {
    const a = parseAttrs(attrs);
    const type = a.type || 'info';
    const content = a.content ?? '';
    hits.push({ kind: 'message', detail: type });
    return `\n:::alert{type="${escapeAttr(type)}"}\n${content}\n:::\n`;
  });

  // Optional paired message (defensive)
  out = out.replace(/\{message([^}]*)\}([\s\S]*?)\{\/message\}/g, (_, attrs, body) => {
    const { type = 'info' } = parseAttrs(attrs);
    hits.push({ kind: 'message-block', detail: type });
    return `\n:::alert{type="${escapeAttr(type)}"}\n${body.trim()}\n:::\n`;
  });

  out = out.replace(/\{cloud([^}]*)\/?\}/g, (_, attrs) => {
    const a = parseAttrs(attrs);
    hits.push({ kind: 'cloud', detail: a.title || '文件' });
    return `\n:::cloud{title="${escapeAttr(a.title ?? '文件')}" url="${escapeAttr(a.url ?? '')}"}\n:::\n`;
  });

  out = out.replace(/\{bilibili([^}]*)\/?\}/g, (_, attrs) => {
    const a = parseAttrs(attrs);
    hits.push({ kind: 'bilibili', detail: a.bvid || '' });
    return `\n:::bilibili{bvid="${escapeAttr(a.bvid ?? '')}"}\n:::\n`;
  });

  // Joe collapse: {collapse}{collapse-item label="…" close}…{/collapse-item}{/collapse}
  out = out.replace(
    /\{collapse-item([^}]*)\}([\s\S]*?)\{\/collapse-item\}/g,
    (_, attrs, body) => {
      const { label = '展开' } = parseAttrs(attrs);
      const open = !/(^|\s)close(\s|$)/.test(attrs);
      hits.push({ kind: 'collapse', detail: label });
      return `\n:::collapse{label="${escapeAttr(label)}"${open ? ' open="true"' : ''}}\n${body.trim()}\n:::\n`;
    },
  );
  // the outer {collapse} wrapper carries no data of its own
  out = out.replace(/\{\/?collapse\}[ \t]*\n?/g, '\n');

  const leftover = out.match(/\{(alert|message|cloud|bilibili|collapse|\/collapse)[^}]*\}/g);
  if (leftover) {
    throw new Error(`cid=${cid} 短代码残留: ${leftover.join(', ')}`);
  }

  return { text: unshield(out), hits };
}

export function convertShortcodesText(text, cid) {
  return convertShortcodes(text, cid).text;
}
