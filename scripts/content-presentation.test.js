import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveDescription,
  isDiscoverableMeta,
  normalizeIncidentalTrailingWhitespace,
  normalizeMetaName,
  repairKnownContent,
} from './lib/content-presentation.js';

test('deriveDescription selects readable prose and removes markup', () => {
  const source = `## TL;DR

> 这是一段足够长的正文摘要，用来说明故障发生的背景、影响范围以及最后采取的修复措施。

\`inline-code\` and [link](https://example.com)

\`\`\`bash
echo secret-noise
\`\`\``;
  const description = deriveDescription(source, 80);
  assert.equal(description, '这是一段足够长的正文摘要，用来说明故障发生的背景、影响范围以及最后采取的修复措施。');
  assert.doesNotMatch(description, /[`\[\]<>]/u);
});

test('deriveDescription caps long content by code point', () => {
  const description = deriveDescription(`这是${'很长的说明'.repeat(50)}`, 60);
  assert.ok(Array.from(description).length <= 61);
  assert.match(description, /…$/u);
});

test('deriveDescription ignores short legacy headings and inline closing hashes', () => {
  const markdown = [
    '# 灵感来源#',
    '最近一直在捣鼓 QQ 机器人，希望把功能性与拟人化兼顾起来。# 部署方案#',
    '## 检查环境##',
    '继续执行后续步骤。',
  ].join('\n');
  assert.equal(
    deriveDescription(markdown),
    '最近一直在捣鼓 QQ 机器人，希望把功能性与拟人化兼顾起来。',
  );
});

test('deriveDescription keeps a full introductory sentence written as a heading', () => {
  const markdown = '## 前言：退出 SSH 后进程会被终止，长时间运行的复制任务也会中断，这里提供两种解决办法。';
  assert.equal(
    deriveDescription(markdown),
    '前言：退出 SSH 后进程会被终止，长时间运行的复制任务也会中断，这里提供两种解决办法。',
  );
});

test('deriveDescription prefers article prose over a leading disclaimer', () => {
  const markdown = [
    '声明：这是一段足够长但不适合作为文章摘要的授权与免责说明。',
    '',
    '# 前言',
    '这篇文章介绍如何组合两个机器人后端，并在不同网络环境中完成稳定部署。',
  ].join('\n');
  assert.equal(
    deriveDescription(markdown),
    '这篇文章介绍如何组合两个机器人后端，并在不同网络环境中完成稳定部署。',
  );
});

test('DN42 repair is deterministic and fixes links plus heading hierarchy', () => {
  const source = '##Basic Information#\nMy Looking Glass:lg.andy-y.cn\nMy Flap Alerted:flap.andy-y.cn\n\n##Features:#\n- Multi Protocol BGP\n\n#Contact:#\n- Email:test@example.com';
  const first = repairKnownContent({ cid: 16 }, source);
  const second = repairKnownContent({ cid: 16 }, first.text);
  assert.equal(first.count, 5);
  assert.equal(second.count, 0);
  assert.match(first.text, /\[lg\.andy-y\.cn\]\(https:\/\/lg\.andy-y\.cn\)/u);
  assert.match(first.text, /^## Contact$/mu);
  assert.doesNotMatch(first.text, /^# Contact/mu);
  assert.doesNotMatch(first.text, /^#{1,6} .*#$/mu);
});

test('taxonomy presentation keeps compatibility routes but limits discovery', () => {
  assert.equal(normalizeMetaName("技术fen'x", 7), '技术分析');
  assert.equal(isDiscoverableMeta({ state: 'active', type: 'tag' }, 0, 7), false);
  assert.equal(isDiscoverableMeta({ state: 'active', type: 'category' }, 11, 1), false);
  assert.equal(isDiscoverableMeta({ state: 'active', type: 'category' }, 3, 10), true);
});

test('Markdown whitespace cleanup removes incidental single spaces but preserves hard breaks', () => {
  const markdown = ['paragraph ', 'hard break  ', ' \t', 'image ![](demo.png) ', 'clean'].join('\n');
  assert.equal(
    normalizeIncidentalTrailingWhitespace(markdown),
    ['paragraph', 'hard break  ', '', 'image ![](demo.png)', 'clean'].join('\n'),
  );
});
