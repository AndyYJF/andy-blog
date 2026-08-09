import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPreparedSource } from './lib/comment-migration-core.js';
import { runMysqlMigration, validateMysqlSchema } from './lib/comment-migration-mysql.js';

const routeMap = {
  1: { state: 'active', commentKey: '/posts/root/' },
};

const sourceRow = (overrides = {}) => ({
  coid: 1,
  cid: 1,
  created: 1700000000,
  author: 'A',
  mail: 'a@example.com',
  url: 'https://example.com',
  ip: '192.0.2.1',
  agent: 'test-agent',
  text: 'root',
  type: 'comment',
  status: 'approved',
  parent: 0,
  ...overrides,
});

const REQUIRED_COLUMNS = {
  wl_Comment: [
    'id', 'user_id', 'comment', 'insertedAt', 'ip', 'link', 'mail', 'nick',
    'pid', 'rid', 'sticky', 'status', 'like', 'ua', 'url', 'createdAt', 'updatedAt',
  ],
  astro_comment_migration_map: [
    'source', 'legacy_coid', 'waline_id', 'source_hash', 'migrated_at',
  ],
};

function canonicalSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

class FakeMysqlConnection {
  constructor({ schemaReady = true } = {}) {
    this.schemaReady = schemaReady;
    this.comments = new Map();
    this.maps = new Map();
    this.nextId = 1;
    this.snapshot = null;
    this.commits = 0;
    this.rollbacks = 0;
  }

  async query() {
    return [[], []];
  }

  async beginTransaction() {
    this.snapshot = structuredClone({
      comments: this.comments,
      maps: this.maps,
      nextId: this.nextId,
    });
  }

  async commit() {
    this.snapshot = null;
    this.commits += 1;
  }

  async rollback() {
    if (this.snapshot) {
      this.comments = this.snapshot.comments;
      this.maps = this.snapshot.maps;
      this.nextId = this.snapshot.nextId;
    }
    this.snapshot = null;
    this.rollbacks += 1;
  }

  async execute(sql, params = []) {
    const statement = canonicalSql(sql);
    if (statement.includes('information_schema.COLUMNS')) {
      if (!this.schemaReady) return [[], []];
      return [Object.entries(REQUIRED_COLUMNS).flatMap(([table, columns]) => (
        columns.map((column) => ({ table_name: table, column_name: column }))
      )), []];
    }
    if (statement.includes('information_schema.TABLES')) {
      if (!this.schemaReady) return [[], []];
      return [[
        { table_name: 'wl_Comment', engine: 'InnoDB', table_collation: 'utf8mb4_unicode_ci' },
        { table_name: 'astro_comment_migration_map', engine: 'InnoDB', table_collation: 'utf8mb4_unicode_ci' },
      ], []];
    }
    if (statement.includes('information_schema.STATISTICS')) {
      if (!this.schemaReady) return [[], []];
      return [[
        { index_name: 'PRIMARY', non_unique: 0, seq_in_index: 1, column_name: 'source' },
        { index_name: 'PRIMARY', non_unique: 0, seq_in_index: 2, column_name: 'legacy_coid' },
        { index_name: 'waline_id', non_unique: 0, seq_in_index: 1, column_name: 'waline_id' },
      ], []];
    }
    if (statement.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }], []];
    if (statement.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }], []];

    if (statement.includes('FROM `waline`.astro_comment_migration_map m')) {
      const rows = [...this.maps.values()]
        .sort((a, b) => a.legacyCoid - b.legacyCoid)
        .map((mapping) => {
          const comment = this.comments.get(mapping.walineId);
          return {
            legacy_coid: mapping.legacyCoid,
            waline_id: mapping.walineId,
            source_hash: mapping.sourceHash,
            comment_id: comment?.id ?? null,
            comment: comment?.comment ?? null,
            inserted_epoch: comment?.insertedEpoch ?? null,
            ip: comment?.ip ?? null,
            link: comment?.link ?? null,
            mail: comment?.mail ?? null,
            nick: comment?.nick ?? null,
            pid: comment?.pid ?? null,
            rid: comment?.rid ?? null,
            sticky: comment?.sticky ?? null,
            status: comment?.status ?? null,
            like_count: comment?.like ?? null,
            ua: comment?.ua ?? null,
            url: comment?.url ?? null,
            created_epoch: comment?.createdEpoch ?? null,
            updated_epoch: comment?.updatedEpoch ?? null,
          };
        });
      return [rows, []];
    }

    if (statement.startsWith('INSERT INTO `waline`.wl_Comment')) {
      const id = this.nextId;
      this.nextId += 1;
      const [comment, insertedEpoch, ip, link, mail, nick, sticky, status, likeCount, ua, url, createdEpoch, updatedEpoch] = params;
      this.comments.set(id, {
        id, comment, insertedEpoch, ip, link, mail, nick, pid: null, rid: null,
        sticky, status, like: likeCount, ua, url, createdEpoch, updatedEpoch,
      });
      return [{ insertId: id, affectedRows: 1 }, []];
    }
    if (statement.startsWith('INSERT INTO `waline`.astro_comment_migration_map')) {
      const [source, legacyCoid, walineId, sourceHash] = params;
      this.maps.set(Number(legacyCoid), { source, legacyCoid: Number(legacyCoid), walineId: Number(walineId), sourceHash });
      return [{ affectedRows: 1 }, []];
    }
    if (statement.startsWith('UPDATE `waline`.wl_Comment SET user_id')) {
      const [comment, insertedEpoch, ip, link, mail, nick, sticky, status, likeCount, ua, url, createdEpoch, updatedEpoch, id] = params;
      const current = this.comments.get(Number(id));
      this.comments.set(Number(id), {
        ...current, comment, insertedEpoch, ip, link, mail, nick, sticky,
        status, like: likeCount, ua, url, createdEpoch, updatedEpoch,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (statement.startsWith('UPDATE `waline`.astro_comment_migration_map')) {
      const [sourceHash, source, legacyCoid, walineId] = params;
      this.maps.set(Number(legacyCoid), {
        source, legacyCoid: Number(legacyCoid), walineId: Number(walineId), sourceHash,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (statement.startsWith('UPDATE `waline`.wl_Comment SET pid')) {
      const [pid, rid, id] = params;
      const comment = this.comments.get(Number(id));
      comment.pid = pid;
      comment.rid = rid;
      return [{ affectedRows: 1 }, []];
    }
    if (statement.startsWith('SELECT id, pid, rid FROM `waline`.wl_Comment')) {
      const absent = new Set(params.slice(0, params.length / 3).map(Number));
      const dependents = [...this.comments.values()].filter((comment) => (
        !absent.has(comment.id) && (absent.has(Number(comment.pid)) || absent.has(Number(comment.rid)))
      ));
      return [dependents.slice(0, 20), []];
    }
    if (statement.startsWith('DELETE FROM `waline`.wl_Comment')) {
      for (const id of params) this.comments.delete(Number(id));
      return [{ affectedRows: params.length }, []];
    }
    if (statement.startsWith('DELETE FROM `waline`.astro_comment_migration_map')) {
      for (const legacyCoid of params.slice(1)) this.maps.delete(Number(legacyCoid));
      return [{ affectedRows: params.length - 1 }, []];
    }
    if (statement.startsWith('SELECT COUNT(*) AS count FROM `waline`.wl_Comment c')) {
      const mappedIds = new Set([...this.maps.values()].map((item) => item.walineId));
      const count = [...this.comments.keys()].filter((id) => !mappedIds.has(id)).length;
      return [[{ count }], []];
    }
    throw new Error(`unhandled fake SQL: ${statement}`);
  }
}

function prepared(rows = [sourceRow(), sourceRow({ coid: 2, text: 'reply', parent: 1 })]) {
  return buildPreparedSource(rows, routeMap);
}

test('schema validation fails closed when production tables are absent', async () => {
  const connection = new FakeMysqlConnection({ schemaReady: false });
  await assert.rejects(
    validateMysqlSchema(connection, 'waline'),
    (error) => error.code === 'SCHEMA_NOT_READY' && error.missing.length > 0,
  );
});

test('dry-run executes two passes and rolls back a clean migration', async () => {
  const connection = new FakeMysqlConnection();
  const result = await runMysqlMigration({ connection, database: 'waline', prepared: prepared() });
  assert.equal(result.ok, true);
  assert.equal(result.committed, false);
  assert.deepEqual(result.first, {
    inserted: 2,
    updated: 1,
    deleted: 0,
    insertedLegacyCoids: [1, 2],
    updatedLegacyCoids: [2],
    deletedLegacyCoids: [],
    pendingAbsentLegacyCoids: [],
    repairedDrift: [],
  });
  assert.equal(result.secondNoop, true);
  assert.equal(connection.comments.size, 0);
  assert.equal(connection.maps.size, 0);
  assert.equal(connection.rollbacks, 1);
});

test('apply commits stable IDs and a later apply is a no-op', async () => {
  const connection = new FakeMysqlConnection();
  const first = await runMysqlMigration({ connection, database: 'waline', prepared: prepared(), apply: true });
  assert.equal(first.ok, true);
  assert.equal(first.committed, true);
  assert.deepEqual([...connection.maps.values()].map((item) => item.walineId), [1, 2]);
  assert.deepEqual({ pid: connection.comments.get(2).pid, rid: connection.comments.get(2).rid }, { pid: 1, rid: 1 });

  const second = await runMysqlMigration({ connection, database: 'waline', prepared: prepared(), apply: true });
  assert.equal(second.first.inserted, 0);
  assert.equal(second.first.updated, 0);
  assert.equal(second.secondNoop, true);
  assert.deepEqual([...connection.maps.values()].map((item) => item.walineId), [1, 2]);
});

test('field drift is repaired without changing the mapped Waline ID', async () => {
  const connection = new FakeMysqlConnection();
  await runMysqlMigration({ connection, database: 'waline', prepared: prepared(), apply: true });
  connection.comments.get(1).status = 'waiting';
  const result = await runMysqlMigration({ connection, database: 'waline', prepared: prepared(), apply: true });
  assert.equal(result.ok, true);
  assert.equal(result.first.updated, 1);
  assert.deepEqual(result.first.repairedDrift, [{ coid: 1, fields: ['status'] }]);
  assert.equal(connection.maps.get(1).walineId, 1);
  assert.equal(connection.comments.get(1).status, 'approved');
});

test('absent mappings block without explicit sweep and native comments survive scoped sweep', async () => {
  const connection = new FakeMysqlConnection();
  await runMysqlMigration({ connection, database: 'waline', prepared: prepared(), apply: true });
  connection.comments.set(900, {
    id: 900, comment: 'native', insertedEpoch: 1700000100, ip: '', link: '', mail: '',
    nick: 'native', pid: null, rid: null, sticky: 0, status: 'approved', like: 0,
    ua: '', url: '/posts/root/', createdEpoch: 1700000100, updatedEpoch: 1700000100,
  });

  const reduced = prepared([sourceRow()]);
  const blocked = await runMysqlMigration({ connection, database: 'waline', prepared: reduced, apply: true });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.committed, false);
  assert.deepEqual(blocked.first.pendingAbsentLegacyCoids, [2]);
  assert.equal(connection.maps.has(2), true);

  const swept = await runMysqlMigration({
    connection, database: 'waline', prepared: reduced, apply: true, applySweep: true,
  });
  assert.equal(swept.ok, true);
  assert.deepEqual(swept.first.deletedLegacyCoids, [2]);
  assert.equal(connection.maps.has(2), false);
  assert.equal(connection.comments.has(2), false);
  assert.equal(connection.comments.has(900), true);
  assert.equal(swept.reconciliation.nativeWalineComments, 1);
});

test('a mapping that points to a missing Waline row aborts and rolls back', async () => {
  const connection = new FakeMysqlConnection();
  await runMysqlMigration({ connection, database: 'waline', prepared: prepared(), apply: true });
  connection.comments.delete(1);
  await assert.rejects(
    runMysqlMigration({ connection, database: 'waline', prepared: prepared(), apply: true }),
    (error) => error.code === 'MAPPED_COMMENT_MISSING',
  );
  assert.equal(connection.comments.has(1), false);
  assert.equal(connection.maps.has(1), true);
});
