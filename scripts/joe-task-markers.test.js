import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeJoeTaskMarkers } from './lib/joe-task-markers.js';

test('normalizes Joe checked markers with or without an existing Markdown bullet', () => {
  const input = [
    '{x} 一个DN42域名',
    ' {X} 一台服务器',
    '-  {x} 保留回滚二进制',
    '+ {x} 审计登录历史',
    '{ } 尚未完成',
  ].join('\n');
  const result = normalizeJoeTaskMarkers(input);
  assert.equal(result.count, 5);
  assert.equal(result.text, [
    '- [x] 一个DN42域名',
    ' - [x] 一台服务器',
    '- [x] 保留回滚二进制',
    '- [x] 审计登录历史',
    '- [ ] 尚未完成',
  ].join('\n'));
});

test('does not rewrite inline markers, escaped markers, or fenced examples', () => {
  const input = [
    '正文中的 {x} 保持原样',
    '\\{x} 转义示例',
    '```text',
    '{x} 代码示例',
    '```',
    '~~~',
    '- {x} 另一段代码',
    '~~~',
  ].join('\n');
  const result = normalizeJoeTaskMarkers(input);
  assert.equal(result.count, 0);
  assert.equal(result.text, input);
});

test('requires non-empty text after a marker', () => {
  const input = '{x}\n{x}   \n{ }\n{ }   \n{xylophone} not a task';
  const result = normalizeJoeTaskMarkers(input);
  assert.equal(result.count, 0);
  assert.equal(result.text, input);
});

test('does not close a fence on an info string, shorter marker, or different marker', () => {
  const input = [
    '````text',
    '```js',
    '{x} still fenced',
    '~~~',
    '{ } still fenced too',
    '````',
    '{x} converted after the real close',
  ].join('\n');
  const result = normalizeJoeTaskMarkers(input);
  assert.equal(result.count, 1);
  assert.match(result.text, /\{x\} still fenced/u);
  assert.match(result.text, /\{ \} still fenced too/u);
  assert.match(result.text, /- \[x\] converted after the real close/u);
});

test('does not rewrite indented code, existing GFM tasks, or approximate markers', () => {
  const input = [
    '    {x} four-space code',
    '\t{x} tab-indented code',
    '- [x] existing task',
    '{xylophone} approximate marker',
  ].join('\n');
  const result = normalizeJoeTaskMarkers(input);
  assert.equal(result.count, 0);
  assert.equal(result.text, input);
});

test('does not rewrite HTML source', () => {
  const input = '<pre>\n{x} literal HTML example\n</pre>';
  const result = normalizeJoeTaskMarkers(input, { sourceFormat: 'html' });
  assert.equal(result.count, 0);
  assert.equal(result.text, input);
});

test('does not rewrite protected raw HTML blocks inside Markdown', () => {
  const input = [
    '<pre>',
    '{x} literal preformatted example',
    '</pre>',
    '<script>',
    '{ } literal script example',
    '</script>',
    '{x} real task',
  ].join('\n');
  const result = normalizeJoeTaskMarkers(input);
  assert.equal(result.count, 1);
  assert.match(result.text, /\{x\} literal preformatted example/u);
  assert.match(result.text, /\{ \} literal script example/u);
  assert.match(result.text, /- \[x\] real task/u);
});

test('preserves CRLF while normalizing Joe markers', () => {
  const input = '{x} checked\r\n{ } unchecked\r\nplain';
  const result = normalizeJoeTaskMarkers(input);
  assert.equal(result.count, 2);
  assert.equal(result.text, '- [x] checked\r\n- [ ] unchecked\r\nplain');
});
