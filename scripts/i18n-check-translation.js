// 校验子代理译文的受保护 token 计数与源一致（与 i18n-kimi.js 同一思路）
import fs from 'node:fs';

const [srcFile, bodyFile, metaFile] = process.argv.slice(2);
const src = fs.readFileSync(srcFile, 'utf8');
// 源的正文 = 去掉 frontmatter
const fmEnd = src.indexOf('\n---\n', 3);
const srcBody = fmEnd === -1 ? src : src.slice(fmEnd + 5);
const out = fs.readFileSync(bodyFile, 'utf8');

const count = (s, re) => (s.match(re) || []).length;
const checks = {
  fences: /^```/gm,
  urls: /https?:\/\/[^\s)\]]+/g,
  directives: /^:::[a-z]+/gm,
  htmlComments: /<!--[\s\S]*?-->/g,
  images: /!\[[^\]]*\]\(/g,
};
let bad = 0;
for (const [name, re] of Object.entries(checks)) {
  const a = count(srcBody, re), b = count(out, re);
  const ok = a === b;
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'MISMATCH '} ${name}: src=${a} out=${b}`);
}
console.log('meta:', fs.readFileSync(metaFile, 'utf8').trim());
console.log('body chars:', out.length);
process.exit(bad ? 1 : 0);
