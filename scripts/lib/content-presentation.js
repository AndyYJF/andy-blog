const KNOWN_META_NAMES = new Map([
  [7, '技术分析'],
]);

const decodeEntities = (value) => value
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));

const cleanBlock = (value) => decodeEntities(String(value))
  .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
  .replace(/^\s*>\s?/gmu, '')
  .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gmu, '')
  .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
  .replace(/`([^`]+)`/gu, '$1')
  .replace(/<[^>]+>/gu, ' ')
  .replace(/[~*_]+/gu, '')
  .replace(/\s+/gu, ' ')
  .trim();

const normalizeDescriptionSource = (value) => String(value)
  // Some legacy Typecho posts use a closing hash and place the next heading
  // directly after a sentence. Treat those short labels as block boundaries.
  .replace(/(?<=[。！？；.!?])\s*#{1,6}\s*[^#\n]{1,18}#(?=\s|$)/gu, '\n\n')
  .split('\n')
  .map((line) => {
    const heading = line.match(/^\s{0,3}#{1,6}\s*(.*?)\s*#*\s*$/u);
    if (!heading) return line;
    const label = heading[1].trim();
    return Array.from(label).length <= 18 ? '' : label;
  })
  .join('\n');

const truncate = (value, maxLength) => {
  const chars = Array.from(value);
  if (chars.length <= maxLength) return value;
  const window = chars.slice(0, maxLength + 1).join('');
  const punctuation = Math.max(
    window.lastIndexOf('。'),
    window.lastIndexOf('！'),
    window.lastIndexOf('？'),
    window.lastIndexOf('；'),
  );
  const end = punctuation >= Math.floor(maxLength * 0.58) ? punctuation + 1 : maxLength;
  return `${chars.slice(0, end).join('').trimEnd()}…`;
};

export function deriveDescription(markdown, maxLength = 150) {
  const withoutCode = String(markdown || '')
    .replace(/```[\s\S]*?```/gu, '\n\n')
    .replace(/~~~[\s\S]*?~~~/gu, '\n\n')
    .replace(/<script\b[\s\S]*?<\/script>/giu, '\n\n')
    .replace(/<style\b[\s\S]*?<\/style>/giu, '\n\n')
    .replace(/^:::[^\n]*$/gmu, '')
    .replace(/^:::$/gmu, '');

  const descriptionSource = normalizeDescriptionSource(withoutCode);
  const blocks = descriptionSource
    .split(/\n\s*\n/gu)
    .map(cleanBlock)
    .filter((value) => Array.from(value).length >= 24)
    .filter((value) => !/^[-|:\s]+$/u.test(value));

  const fallback = cleanBlock(descriptionSource);
  const preferred = blocks.find((value) => !/^(?:提示|声明|阅前须知)[：:]/u.test(value));
  return truncate(preferred || blocks[0] || fallback, maxLength);
}

export function normalizeMetaName(name, mid) {
  return KNOWN_META_NAMES.get(Number(mid)) || String(name || '').trim();
}

export function repairKnownContent(item, source) {
  let text = String(source || '');
  let count = 0;
  const replace = (pattern, replacement) => {
    const next = text.replace(pattern, replacement);
    if (next !== text) count += 1;
    text = next;
  };

  if (Number(item.cid) === 16) {
    replace(/^(#{1,6}[ \t]*[^#\n]+?)#[ \t]*$/gmu, '$1');
    replace(
      /^My Looking Glass:\s*lg\.andy-y\.cn\s*$/gmu,
      'My Looking Glass: [lg.andy-y.cn](https://lg.andy-y.cn)',
    );
    replace(
      /^My Flap Alerted:\s*flap\.andy-y\.cn\s*$/gmu,
      'My Flap Alerted: [flap.andy-y.cn](https://flap.andy-y.cn)',
    );
    replace(/^##[ \t]*Features:[ \t]*$/gmu, '## Features');
    replace(/^#[ \t]*Contact:[ \t]*$/gmu, '## Contact');
  }

  return { text, count };
}

export function isDiscoverableMeta(meta, count, mid) {
  if (meta.state !== 'active' || Number(count) <= 0) return false;
  return !(meta.type === 'category' && Number(mid) === 1);
}
