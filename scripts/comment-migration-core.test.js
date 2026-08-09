import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCommentPayload,
  buildPreparedSource,
  compareCommentRow,
  expectedParentIds,
  sourceHash,
  validateSourceShape,
} from './lib/comment-migration-core.js';

const routeMap = {
  1: { state: 'active', commentKey: '/posts/root/' },
  2: { state: 'active', commentKey: '/posts/reply/' },
};

const row = (overrides = {}) => ({
  coid: 1,
  cid: 1,
  created: 1700000000,
  author: 'A',
  mail: 'a@example.com',
  url: 'https://example.com',
  ip: '192.0.2.1',
  agent: 'ua',
  text: 'hello\r\n',
  type: 'comment',
  status: 'approved',
  parent: 0,
  ...overrides,
});

test('source hash covers every migrated source field', () => {
  const base = sourceHash(row(), '/posts/root/');
  for (const patch of [
    { url: 'https://changed.example' },
    { ip: '192.0.2.2' },
    { agent: 'changed-ua' },
    { mail: 'b@example.com' },
    { author: 'B' },
    { text: 'changed' },
    { status: 'waiting' },
    { parent: 2 },
    { created: 1700000001 },
    { cid: 2 },
  ]) {
    assert.notEqual(sourceHash(row(patch), routeMap[String(patch.cid || 1)].commentKey), base);
  }
});

test('source shape rejects duplicate identifiers', () => {
  assert.throws(() => validateSourceShape([row(), row()]), /duplicate coid=1/);
});

test('prepared source archives unsupported rows and validates routes', () => {
  const prepared = buildPreparedSource([
    row(),
    row({ coid: 2, type: 'pingback' }),
  ], routeMap);
  assert.equal(prepared.selected.length, 1);
  assert.deepEqual(prepared.archived, [{ coid: 2, reason: 'type=pingback' }]);
  assert.throws(
    () => buildPreparedSource([row({ cid: 99 })], routeMap),
    /unpublished cid/,
  );
});

test('parent graph resolves direct parent and root independently', () => {
  const rows = [
    row({ coid: 1, parent: 0 }),
    row({ coid: 2, parent: 1 }),
    row({ coid: 3, parent: 2 }),
  ];
  const prepared = buildPreparedSource(rows, routeMap);
  const ids = new Map([[1, 101], [2, 102], [3, 103]]);
  assert.deepEqual(expectedParentIds(rows[2], prepared.byCoid, ids), { pid: 102, rid: 101 });
});

test('payload and reconciliation comparison are deterministic', () => {
  const source = row();
  const payload = buildCommentPayload(source, '/posts/root/');
  const expected = { payload };
  const actual = {
    ...payload,
    insertedEpoch: String(payload.insertedEpoch),
    createdEpoch: String(payload.createdEpoch),
    updatedEpoch: String(payload.updatedEpoch),
  };
  assert.deepEqual(compareCommentRow(expected, actual, { pid: null, rid: null }), []);
  actual.status = 'waiting';
  assert.deepEqual(compareCommentRow(expected, actual, { pid: null, rid: null }), ['status']);
});
