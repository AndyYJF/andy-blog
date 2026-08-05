/**
 * Post-build: ensure BEOE mermaid <img> tags have alt (A11y/SEO).
 * Defensive — rehype may not persist alt depending on serializer order.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'astro', 'dist');

const walk = (dir, out = []) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.html')) out.push(p);
  }
  return out;
};

let patched = 0;
for (const file of walk(DIST)) {
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(
    /<img\b([^>]*\bclass="[^"]*\bbeoe-(?:light|dark)\b[^"]*"[^>]*)>/gi,
    (full, attrs) => {
      if (/\balt\s*=/.test(attrs)) return full;
      const theme = /\bbeoe-dark\b/.test(attrs) ? 'dark' : 'light';
      const alt = `Mermaid diagram (${theme} theme)`;
      return `<img${attrs} alt="${alt}">`;
    },
  );
  // also handle class before other attrs / self-closing variants with beoe class mid-attr
  const after2 = after.replace(
    /<img(?![^>]*\balt=)([^>]*\bbeoe-(?:light|dark)\b[^>]*)>/gi,
    (full, attrs) => {
      if (/\balt\s*=/.test(full)) return full;
      const theme = /\bbeoe-dark\b/.test(attrs) ? 'dark' : 'light';
      return `<img${attrs} alt="Mermaid diagram (${theme} theme)">`;
    },
  );
  if (after2 !== before) {
    fs.writeFileSync(file, after2);
    patched += 1;
  }
}

console.log(JSON.stringify({ ok: true, patched }));
