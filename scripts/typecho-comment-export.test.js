import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  READONLY_GUARD_TRIGGERS,
  readFixedExport,
  serializeFixedExport,
  validateGuardRows,
} from './lib/typecho-comment-export.js';
import { parseArgs, validateTarget, writeExclusive } from './export-typecho-comments-mysql.js';

const fixtureRows = [
  { coid: 11, cid: 62, created: 1781943197, author: 'b', authorId: 0, ownerId: 1, mail: 'b@example.test', url: null, ip: '::1', agent: 'ua2', text: 'two', type: 'comment', status: 'approved', parent: 0 },
  { coid: 6, cid: 47, created: 1777077770, author: 'a', authorId: 0, ownerId: 1, mail: 'a@example.test', url: '', ip: '127.0.0.1', agent: 'ua1', text: 'one', type: 'comment', status: 'waiting', parent: 0 },
];

const guardRows = Object.entries(READONLY_GUARD_TRIGGERS).map(([event, name]) => ({
  TRIGGER_NAME: name,
  EVENT_MANIPULATION: event,
  ACTION_TIMING: 'BEFORE',
  ACTION_STATEMENT: "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='TYPECHO_COMMENTS_READ_ONLY_AFTER_ASTRO_CUTOVER'",
}));

test('fixed export is ordered and byte-deterministic', () => {
  const first = serializeFixedExport(fixtureRows);
  const second = serializeFixedExport([...fixtureRows].reverse());
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.rows[0].coid, 6);
  assert.deepEqual(first.summary.groups, { 'comment:approved': 1, 'comment:waiting': 1 });
});

test('readonly guard must cover exact insert update delete triggers', () => {
  assert.doesNotThrow(() => validateGuardRows(guardRows));
  assert.throws(() => validateGuardRows(guardRows.slice(1)), /count mismatch/);
  assert.throws(() => validateGuardRows(guardRows.map((row) => ({ ...row, ACTION_STATEMENT: 'BEGIN END' }))), /marker missing/);
});

test('database reader uses a read-only transaction and requires guards', async () => {
  const calls = [];
  const connection = {
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SELECT `coid`')) return [fixtureRows];
      return [[]];
    },
    async execute(sql) {
      calls.push(sql);
      if (sql.includes('information_schema.COLUMNS')) {
        return [[...Object.keys(fixtureRows[0]).map((COLUMN_NAME) => ({ COLUMN_NAME }))]];
      }
      return [guardRows];
    },
    async commit() { calls.push('COMMIT'); },
    async rollback() { calls.push('ROLLBACK'); },
  };
  const result = await readFixedExport({ connection, database: 'typecho_frf6hh', commentsTable: 'typecho_comments' });
  assert.equal(result.summary.rows, 2);
  assert.ok(calls.includes('START TRANSACTION READ ONLY'));
  assert.ok(calls.includes('COMMIT'));
  assert.ok(!calls.includes('ROLLBACK'));
});

test('CLI target and output guards fail closed', () => {
  assert.deepEqual(parseArgs(['--output', 'x', '--confirm-database', 'd', '--confirm-comments-table', 'typecho_comments']), {
    '--output': 'x', '--confirm-database': 'd', '--confirm-comments-table': 'typecho_comments',
  });
  assert.throws(() => parseArgs(['--unknown', 'x']), /unknown option/);
  assert.throws(() => validateTarget({ database: 'waline', confirmedDatabase: 'waline', commentsTable: 'typecho_comments', confirmedCommentsTable: 'typecho_comments', outputPath: path.join(os.tmpdir(), 'x.json') }), /database confirmation/);
});

test('exclusive output is mode 0600 and refuses overwrite', () => {
  const output = path.join(os.tmpdir(), `andy-blog-typecho-export-${process.pid}-${Date.now()}.json`);
  writeExclusive(output, Buffer.from('[]\n'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert.throws(() => writeExclusive(output, Buffer.from('[]\n')), /EEXIST/);
});
