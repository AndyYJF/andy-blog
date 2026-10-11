import fs from 'node:fs';
import path from 'node:path';

export function contentHasMermaid(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith('.md') && fs.readFileSync(abs, 'utf8').includes('```mermaid')) {
        return true;
      }
    }
  }
  return false;
}
