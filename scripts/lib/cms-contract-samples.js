import fs from 'node:fs';
import path from 'node:path';
import { contentDigest, publishIdemKey, sourceHash, translateIdemKey } from './i18n-store.js';
import { validateBuildSnapshot, writeMigrationPackage } from './cms-contract.js';

const EPOCH = 1700000001;
const postTitle = '示例文章';
const postText = '<!--markdown-->正文示例\n';
const postHash = sourceHash(postTitle, postText);
const enTitle = 'Sample';
const enSummary = '一句摘要';
const enBody = 'Hello\n';
const enDigest = contentDigest(enTitle, enSummary, enBody);
const oldTitle = 'Old sample';
const oldDigest = contentDigest(oldTitle, '', 'Previous\n');
const draftTitle = 'Draft sample';
const draftBody = 'Draft body\n';
const draftDigest = contentDigest(draftTitle, '', draftBody);

function buildContent(row) {
  return {
    cid: row.cid,
    type: row.type,
    title: row.title,
    slug: row.slug,
    text: row.text,
    created: row.created,
    modified: row.modified,
    allowComment: row.allowComment,
    allowFeed: row.allowFeed,
    order: row.order,
    template: row.template,
    password: row.password,
    status: row.status,
  };
}

function migrationContent(row) {
  return {
    cid: row.cid,
    title: row.title,
    slug: row.slug,
    created: row.created,
    modified: row.modified,
    text: row.text,
    order: row.order,
    authorId: 1,
    template: row.template,
    type: row.type,
    status: row.status,
    password: row.password,
    commentsNum: 0,
    allowComment: row.allowComment,
    allowPing: '0',
    allowFeed: row.allowFeed,
    parent: 0,
  };
}

const rows = [
  { cid: 1, type: 'page', title: '关于示例', slug: 'about-sample', text: '<!--markdown-->关于示例\n', created: 1700000000, modified: 1700000002, allowComment: 1, allowFeed: 1, order: 0, template: '', password: '', status: 'publish' },
  { cid: 2, type: 'post', title: postTitle, slug: 'sample-post', text: postText, created: 1700000100, modified: 1700000200, allowComment: '1', allowFeed: '1', order: 0, template: null, password: null, status: 'publish' },
  { cid: 3, type: 'post', title: '私密示例', slug: 'private-sample', text: '<!--markdown-->私密示例\n', created: 1700000101, modified: 1700000101, allowComment: '0', allowFeed: '0', order: 0, template: null, password: null, status: 'private' },
  { cid: 4, type: 'post', title: '密码示例', slug: 'password-sample', text: '<!--markdown-->密码示例\n', created: 1700000102, modified: 1700000102, allowComment: '1', allowFeed: '0', order: 0, template: null, password: 'secret', status: 'publish' },
  { cid: 5, type: 'post', title: '撤回示例', slug: 'withdrawn-sample', text: '<!--markdown-->撤回示例\n', created: 1700000103, modified: 1700000300, allowComment: '1', allowFeed: '1', order: 0, template: null, password: null, status: 'hidden' },
  { cid: 6, type: 'post_draft', title: '草稿示例', slug: 'draft-sample', text: '<!--markdown-->草稿示例\n', created: 1700000104, modified: 1700000104, allowComment: '1', allowFeed: '1', order: 0, template: null, password: null, status: 'publish' },
  { cid: 7, type: 'post', title: '闲话示例', slug: 'moment-sample', text: '<!--markdown-->闲话示例\n', created: 1700000105, modified: 1700000105, allowComment: '0', allowFeed: '0', order: 0, template: null, password: null, status: 'publish' },
  { cid: 8, type: 'post', title: 'HTML 存量', slug: 'html-sample', text: '<p>存量 HTML</p>', created: 1700000106, modified: 1700000106, allowComment: '1', allowFeed: '1', order: 0, template: null, password: null, status: 'publish' },
  { cid: 9, type: 'attachment', title: 'sample.txt', slug: 'sample-txt', text: '{"path":"usr/uploads/sample.txt"}', created: 1700000107, modified: 1700000107, allowComment: '0', allowFeed: '0', order: 0, template: null, password: null, status: 'publish' },
  { cid: 10, type: 'page_draft', title: '页面草稿', slug: 'page-draft-sample', text: '<!--markdown-->页面草稿\n', created: 1700000108, modified: 1700000108, allowComment: '1', allowFeed: '0', order: 0, template: null, password: null, status: 'publish' },
];

function field(cid, name, type, str, intValue, floatValue) {
  return { cid, name, type, str_value: str, int_value: intValue, float_value: floatValue };
}

const buildFields = [
  field(2, 'astroPath', 'str', '/posts/sample/', null, null),
  field(2, 'legacy_counter', 'int', null, 3, 0),
  field(2, 'legacy_note', 'str', '历史字段', null, null),
  field(2, 'thumb', 'str', 'https://img.example/thumb.png', null, null),
  field(7, 'content_kind', 'str', 'moment', null, null),
  field(7, 'moment_images', 'str', '', null, null),
  field(7, 'moment_topics', 'str', '示例', null, null),
];

const buildMetas = [
  { mid: 1, name: '示例分类', slug: 'sample-cat', type: 'category', description: '', count: 1, order: 0 },
  { mid: 2, name: '示例标签', slug: 'sample-tag', type: 'tag', description: null, count: 1, order: 1 },
];

const buildRelations = [
  { cid: 2, mid: 1, name: '示例分类', slug: 'sample-cat', type: 'category', order: 0 },
  { cid: 7, mid: 2, name: '示例标签', slug: 'sample-tag', type: 'tag', order: 1 },
];

function version(row) {
  return {
    version_id: row.version_id,
    cid: row.cid,
    locale: 'en',
    translation_revision: row.translation_revision,
    title: row.title,
    summary: row.summary,
    body: row.body,
    source_revision: row.source_revision,
    source_hash: postHash,
    content_digest: row.content_digest,
    glossary_version: '',
    author: 'fixture',
    proofread_at: null,
    proofreader: null,
    render_verdict: null,
    render_fingerprint: null,
    verified_at: null,
    created_at: 1700000400 + row.version_id,
  };
}

const approved = version({ version_id: 10, cid: 2, translation_revision: 2, title: enTitle, summary: enSummary, body: enBody, source_revision: 2, content_digest: enDigest });
const draft = version({ version_id: 11, cid: 2, translation_revision: 3, title: draftTitle, summary: '', body: draftBody, source_revision: 3, content_digest: draftDigest });
const history = version({ version_id: 9, cid: 2, translation_revision: 1, title: oldTitle, summary: '', body: 'Previous\n', source_revision: 1, content_digest: oldDigest });

const sourceState = [{
  cid: 2,
  source_revision: 3,
  source_hash: postHash,
  visibility: 'publish',
  content_type: 'post',
  saved_at: 1700000200,
}];

const heads = [
  {
    cid: 2,
    locale: 'en',
    translation_revision: 3,
    draft_version_id: 11,
    approved_version_id: 10,
    publication_state: 'enabled',
    equivalence_state: 'not_equivalent',
    updated_at: 1700000500,
  },
  {
    cid: 5,
    locale: 'en',
    translation_revision: 0,
    draft_version_id: null,
    approved_version_id: null,
    publication_state: 'disabled',
    equivalence_state: 'equivalent',
    updated_at: 1700000300,
  },
];

const ledger = [{
  cid: 2,
  locale: 'en',
  translation_available_at: 1700000400,
  first_published_at: 1700000400,
  last_live_version_id: 10,
  last_live_release: null,
  updated_at: 1700000400,
}];

export function positiveBuildSnapshot() {
  const snapshot = {
    snapshotEpoch: EPOCH,
    schemaVersion: 2,
    contents: rows.filter((row) => ['post', 'page', 'post_draft'].includes(row.type)).map(buildContent),
    relations: buildRelations,
    fields: buildFields,
    metas: buildMetas,
    i18n: {
      sourceState,
      heads,
      versions: [approved],
      ledger,
    },
  };
  const errors = validateBuildSnapshot(snapshot);
  if (errors.length) throw new Error(errors.join('\n'));
  return snapshot;
}

export function duplicateCidSnapshot() {
  const snapshot = positiveBuildSnapshot();
  snapshot.contents.push({ ...snapshot.contents[0], title: '重复主键' });
  return snapshot;
}

export function stringCidSnapshot() {
  const snapshot = positiveBuildSnapshot();
  snapshot.contents[0] = { ...snapshot.contents[0], cid: '1' };
  return snapshot;
}

export function unapprovedBodySnapshot() {
  const snapshot = positiveBuildSnapshot();
  snapshot.i18n.versions = [approved, draft];
  return snapshot;
}

function job(row) {
  return {
    job_id: row.job_id,
    idem_key: translateIdemKey(2, 'en', row.revision),
    cid: 2,
    locale: 'en',
    status: row.status,
    expected_source_revision: 3,
    expected_source_hash: postHash,
    expected_translation_revision: 3,
    lease_owner: row.lease_owner,
    lease_until: row.lease_until,
    attempts: row.attempts,
    max_attempts: 50,
    next_run_at: 1700000600,
    last_error: row.last_error,
    created_at: 1700000600,
    updated_at: 1700000600,
  };
}

function outbox(row) {
  return {
    event_id: row.event_id,
    idem_key: publishIdemKey(2, 'en', row.version_id) + `:${row.status}`,
    cid: 2,
    locale: 'en',
    version_id: row.version_id,
    status: row.status,
    attempts: 0,
    next_retry_at: 1700000700,
    release_id: null,
    observed_at: null,
    last_error: null,
    created_at: 1700000700,
    updated_at: 1700000700,
  };
}

export function positiveMigrationTables() {
  const upload = Buffer.from('demo\n');
  return {
    tables: {
      contents: rows.map(migrationContent),
      metas: buildMetas.map((meta) => ({ ...meta, parent: 0 })),
      relationships: [
        { cid: 2, mid: 1 },
        { cid: 7, mid: 2 },
        { cid: 9, mid: 1 },
      ],
      fields: buildFields,
      i18n_source_state: sourceState,
      i18n_translation_head: heads,
      i18n_translation_version: [history, approved, draft],
      i18n_translation_job: [
        job({ job_id: 1, revision: 31, status: 'queued', lease_owner: null, lease_until: null, attempts: 0, last_error: null }),
        job({ job_id: 2, revision: 32, status: 'leased', lease_owner: 'worker-a', lease_until: 1700000800, attempts: 1, last_error: null }),
        job({ job_id: 3, revision: 33, status: 'failed', lease_owner: null, lease_until: null, attempts: 2, last_error: 'fixture failure' }),
      ],
      i18n_publish_outbox: [
        outbox({ event_id: 1, version_id: 10, status: 'pending' }),
        outbox({ event_id: 2, version_id: 10, status: 'accepted' }),
      ],
      i18n_publication_ledger: ledger,
      i18n_migrations: [{ version: 1, applied_at: 1700000000 }],
    },
    extras: {
      source: 'synthetic-sanitized-fixture',
      extraColumns: {},
      attachments: rows.filter((row) => row.type === 'attachment').map((row) => ({
        cid: row.cid,
        title: row.title,
        slug: row.slug,
        text: row.text,
        type: row.type,
      })),
      uploads: [{ path: 'usr/uploads/sample.txt', bytes: upload }],
    },
  };
}

export function writePositiveMigrationPackage(dir) {
  const sample = positiveMigrationTables();
  writeMigrationPackage(dir, sample.tables, sample.extras);
}

export function writeSanitizedFixtures(root) {
  const buildDir = path.join(root, 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  const files = {
    'snapshot-1700000001.json': positiveBuildSnapshot(),
    'snapshot-1700000002-duplicate-cid.json': duplicateCidSnapshot(),
    'snapshot-1700000003-string-cid.json': stringCidSnapshot(),
    'snapshot-1700000004-unapproved-body.json': unapprovedBodySnapshot(),
  };
  for (const [name, value] of Object.entries(files)) {
    fs.writeFileSync(path.join(buildDir, name), `${JSON.stringify(value)}\n`);
  }
  writePositiveMigrationPackage(path.join(root, 'migration', 'positive'));
}

if (import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href || process.argv[1]?.endsWith('cms-contract-samples.js')) {
  const dest = path.resolve(import.meta.dirname, '..', '..', 'docs', 'cms', 'fixtures');
  writeSanitizedFixtures(dest);
  console.log(dest);
}
