/**
 * Compare two generated nginx/release-http.conf files for unattended switch.
 *
 * Allowed: identical files, or extra map entries (new post legacy redirects).
 * Refused: redirect-status change, server/location drift, removed keys, retargeted keys.
 */
import fs from 'node:fs';

const STATUS_RE = /^# redirect status: (301|302)\s*$/m;
const ENTRIES_RE = /^# entries: .*$/m;

const parseMaps = (text) => {
  const maps = [];
  const mapRe = /^map\s+(\S+)\s+(\$\w+)\s*\{/gm;
  let match;
  while ((match = mapRe.exec(text))) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    for (; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) throw new Error(`unclosed map ${match[2]}`);
    const body = text.slice(start, i);
    const entries = new Map();
    let defaultValue = null;
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const defaultHit = /^default\s+(.+);$/.exec(line);
      if (defaultHit) {
        defaultValue = defaultHit[1];
        continue;
      }
      const entryHit = /^(\S+)\s+(.+);$/.exec(line);
      if (!entryHit) throw new Error(`unparsed map line: ${line}`);
      if (entries.has(entryHit[1])) throw new Error(`duplicate map key ${entryHit[1]}`);
      entries.set(entryHit[1], entryHit[2]);
    }
    maps.push({
      expr: match[1],
      variable: match[2],
      defaultValue,
      entries,
      start: match.index,
      end: i + 1,
    });
  }
  return maps;
};

export const compareNginxPolicy = (currentText, candidateText) => {
  const currentStatus = STATUS_RE.exec(currentText)?.[1];
  const candidateStatus = STATUS_RE.exec(candidateText)?.[1];
  if (!currentStatus || !candidateStatus) {
    return { ok: false, reason: 'missing redirect status comment' };
  }
  if (currentStatus !== candidateStatus) {
    return {
      ok: false,
      reason: `redirect status ${currentStatus} -> ${candidateStatus}`,
    };
  }

  const currentMaps = parseMaps(currentText);
  const candidateMaps = parseMaps(candidateText);
  if (currentMaps.length !== candidateMaps.length) {
    return { ok: false, reason: 'map block count changed' };
  }

  const replaceMaps = (text, maps) => {
    let out = '';
    let cursor = 0;
    for (const block of maps) {
      out += text.slice(cursor, block.start);
      out += `map ${block.expr} ${block.variable} { default ${block.defaultValue}; }`;
      cursor = block.end;
    }
    out += text.slice(cursor);
    return out.replace(ENTRIES_RE, '# entries:');
  };

  const currentSkeleton = replaceMaps(currentText, currentMaps);
  const candidateSkeleton = replaceMaps(candidateText, candidateMaps);
  if (currentSkeleton !== candidateSkeleton) {
    return { ok: false, reason: 'nginx skeleton changed (server/location/status)' };
  }

  const added = [];
  for (let i = 0; i < currentMaps.length; i += 1) {
    const from = currentMaps[i];
    const to = candidateMaps[i];
    if (from.expr !== to.expr || from.variable !== to.variable || from.defaultValue !== to.defaultValue) {
      return { ok: false, reason: `map header changed ${from.variable}` };
    }
    for (const [key, value] of from.entries) {
      if (!to.entries.has(key)) {
        return { ok: false, reason: `removed ${from.variable} ${key}` };
      }
      if (to.entries.get(key) !== value) {
        return {
          ok: false,
          reason: `retargeted ${from.variable} ${key}: ${value} -> ${to.entries.get(key)}`,
        };
      }
    }
    for (const [key, value] of to.entries) {
      if (!from.entries.has(key)) added.push({ map: from.variable, key, value });
    }
  }

  return { ok: true, added };
};

const invokedDirectly = String(process.argv[1] || '').replaceAll('\\', '/').endsWith('/compare-nginx-policy.js');
if (invokedDirectly) {
  const [, , currentPath, candidatePath] = process.argv;
  if (!currentPath || !candidatePath) {
    console.error('usage: node scripts/compare-nginx-policy.js <current.conf> <candidate.conf>');
    process.exit(64);
  }
  const result = compareNginxPolicy(
    fs.readFileSync(currentPath, 'utf8'),
    fs.readFileSync(candidatePath, 'utf8'),
  );
  if (!result.ok) {
    console.error(`release nginx policy changed; refusing unattended switch: ${result.reason}`);
    process.exit(69);
  }
  console.log(JSON.stringify({ ok: true, added: result.added }, null, 2));
}
