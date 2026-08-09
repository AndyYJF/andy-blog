/**
 * Comment migration (Stage 7) — fixture / dry-run / memory backend.
 *
 * Usage:
 *   node scripts/migrate-comments.js --epoch 1785565762 --backend memory
 *   node scripts/migrate-comments.js --epoch 1785565762 --backend memory --twice
 *
 * Live MySQL backends land in Stage 9/10; this script gates the algorithm
 * against the Stage 0 dump fixture without requiring a Waline DB.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STATUS_MAP,
  buildCommentPayload,
  normalizeText,
  rootCoid,
  selectMigratable,
  sourceHash,
  validateParentGraph,
  validateSourceShape,
} from './lib/comment-migration-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};
const has = (name) => process.argv.includes(name);

const epoch = arg('--epoch') || process.env.SNAPSHOT_EPOCH;
if (!/^\d{10}$/.test(epoch ?? '')) throw new Error('--epoch / SNAPSHOT_EPOCH required');
const backend = arg('--backend') || 'memory';
if (backend !== 'memory') throw new Error('only --backend memory is implemented locally');

const commentsPath = path.join(ROOT, 'docs/baselines/fixtures', `comments-${epoch}.json`);
const routeMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/route-map.json'), 'utf8'));
const sourceComments = JSON.parse(fs.readFileSync(commentsPath, 'utf8'));

function createMemoryBackend() {
  let nextId = 1;
  /** @type {Map<string, { walineId: number, hash: string, row: object }>} */
  const map = new Map();
  /** @type {Map<number, object>} */
  const comments = new Map();

  return {
    async run(fn) {
      return fn({ map, comments });
    },
    snapshot() {
      return {
        mapSize: map.size,
        commentIds: [...comments.keys()].sort((a, b) => a - b),
        hashes: [...map.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, v.hash, v.walineId]),
      };
    },
    async migrateOnce(selected) {
      let inserted = 0;
      let updated = 0;
      let deleted = 0;
      const byCoid = new Map(selected.map((r) => [Number(r.coid), r]));
      const sourceKeys = new Set();

      await this.run(async ({ map, comments }) => {
        // upsert
        for (const row of selected) {
          const route = routeMap[String(row.cid)];
          const commentKey = route.commentKey;
          const key = `typecho:${row.coid}`;
          sourceKeys.add(key);
          const hash = sourceHash(row, commentKey);
          const existing = map.get(key);
          const corePayload = buildCommentPayload(row, commentKey);
          const payload = {
            nick: corePayload.nick,
            mail: corePayload.mail,
            link: corePayload.link,
            comment: corePayload.comment,
            ip: corePayload.ip,
            ua: corePayload.ua,
            url: corePayload.url,
            status: corePayload.status,
            insertedAt: new Date(corePayload.insertedEpoch * 1000).toISOString(),
            pid: null,
            rid: null,
            sticky: false,
            like: 0,
          };
          if (!existing) {
            const walineId = nextId++;
            map.set(key, { walineId, hash, row });
            comments.set(walineId, { id: walineId, ...payload });
            inserted += 1;
          } else if (existing.hash !== hash) {
            comments.set(existing.walineId, { id: existing.walineId, ...payload });
            existing.hash = hash;
            existing.row = row;
            updated += 1;
          }
        }

        // backfill pid/rid
        for (const row of selected) {
          const key = `typecho:${row.coid}`;
          const mapped = map.get(key);
          const comment = comments.get(mapped.walineId);
          const parent = Number(row.parent) || 0;
          if (parent === 0) {
            comment.pid = null;
            comment.rid = null;
          } else {
            const parentMapped = map.get(`typecho:${parent}`);
            const root = rootCoid(row, byCoid);
            const rootMapped = map.get(`typecho:${root}`);
            comment.pid = parentMapped.walineId;
            comment.rid = rootMapped.walineId;
          }
        }

        // absent-key sweep (typecho namespace only)
        for (const [key, mapped] of [...map.entries()]) {
          if (!key.startsWith('typecho:')) continue;
          if (sourceKeys.has(key)) continue;
          // would orphan children?
          for (const c of comments.values()) {
            if (c.pid === mapped.walineId || c.rid === mapped.walineId) {
              throw new Error(`sweep blocked: deleting ${key} would orphan waline id children`);
            }
          }
          comments.delete(mapped.walineId);
          map.delete(key);
          deleted += 1;
        }
      });

      return { inserted, updated, deleted };
    },
  };
}

function runPipeline(store, selected) {
  return store.migrateOnce(selected);
}

const { selected, archived } = selectMigratable(sourceComments);
validateSourceShape(sourceComments);
validateParentGraph(selected, routeMap);

const store = createMemoryBackend();
const first = await runPipeline(store, selected);
const snap1 = store.snapshot();
let second = null;
let snap2 = null;
if (has('--twice')) {
  second = await runPipeline(store, selected);
  snap2 = store.snapshot();
  if (second.inserted || second.updated || second.deleted) {
    throw new Error(`second run not idempotent: ${JSON.stringify(second)}`);
  }
  if (JSON.stringify(snap1) !== JSON.stringify(snap2)) {
    throw new Error('second run changed store snapshot');
  }
}

const report = {
  snapshotEpoch: Number(epoch),
  backend,
  counts: {
    source: sourceComments.length,
    selected: selected.length,
    archived: archived.length,
    mapped: snap1.mapSize,
    approved: selected.filter((r) => r.status === 'approved').length,
    waiting: selected.filter((r) => r.status === 'waiting').length,
  },
  first,
  second,
  archived,
  statusMap: STATUS_MAP,
  pingbackPolicy: 'archive-only (not migrated)',
  privacy: {
    mail: 'retained',
    ip: 'retained',
    ua: 'retained',
    note: 'Stage 10 cutover may shorten retention; documented here for gate evidence',
  },
};

fs.mkdirSync(path.join(ROOT, '.cache'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, '.cache', 'comment-migration-report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
fs.mkdirSync(path.join(ROOT, 'docs/baselines/reports'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'docs/baselines/reports/stage7-comment-migration.md'),
  [
    '# Stage 7 comment migration (fixture dry-run)',
    '',
    `Epoch: \`${epoch}\``,
    '',
    `- Source rows: ${report.counts.source}`,
    `- Migratable comments: ${report.counts.selected} (approved ${report.counts.approved}, waiting ${report.counts.waiting})`,
    `- Archived (pingback/trackback/other): ${report.counts.archived}`,
    `- Mapped after run: ${report.counts.mapped}`,
    `- First run: +${first.inserted} / ~${first.updated} / -${first.deleted}`,
    second
      ? `- Second run: +${second.inserted} / ~${second.updated} / -${second.deleted} (must be zeros)`
      : '- Second run: not requested',
    '',
    'Parent graph: no orphans, no cycles, all CIDs active.',
    '',
  ].join('\n'),
);

console.log(JSON.stringify({ ok: true, ...report.counts, first, second }, null, 2));
