import crypto from 'node:crypto';
import { sourceHash, translateIdemKey } from '../../../scripts/lib/i18n-store.js';
import { appendAudit } from './audit-log.js';
import { enqueuePublish, publishChange } from './publish-outbox.js';
import { ensureCmsSchema } from './schema.js';
import { acceptStoredText } from './text-fidelity.js';
import { shadowWriteRefusal } from './shadow-guard.js';

export { ensureCmsSchema };

export function sha256Text(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

export function assertLocalDbHost(host) {
  const name = String(host || '');
  if (name !== '127.0.0.1' && name !== 'localhost' && name !== '::1') {
    throw new Error('CMS prototype refuses a non-local database host');
  }
}

function rowText(row) {
  const text = row.text == null ? '' : String(row.text);
  if (sha256Text(text) !== row.text_sha256) {
    throw new Error(`cid ${row.cid} text did not round-trip`);
  }
  return text;
}

export async function getContent(db, cid) {
  const [rows] = await db.query(
    `SELECT cid, title, slug, created, modified, text, type, status, password,
            allowComment, allowPing, allowFeed, \`order\`, template, revision, text_sha256
     FROM cms_contents WHERE cid = ?`,
    [cid],
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    cid: Number(row.cid),
    title: row.title,
    slug: row.slug,
    created: Number(row.created),
    modified: Number(row.modified),
    text: rowText(row),
    type: row.type,
    status: row.status,
    password: row.password,
    allowComment: row.allowComment,
    allowPing: row.allowPing,
    allowFeed: row.allowFeed,
    order: Number(row.order),
    template: row.template,
    revision: Number(row.revision),
    textSha256: row.text_sha256,
  };
}

async function insertRevision(db, row) {
  const snapshot = {
    cid: row.cid,
    title: row.title,
    slug: row.slug,
    type: row.type,
    status: row.status,
    password: row.password,
    allowComment: row.allowComment,
    allowPing: row.allowPing,
    allowFeed: row.allowFeed,
    fields: row.fields || [],
    relationships: row.relationships || [],
    created: row.contentCreated,
    modified: row.contentModified,
  };
  await db.query(
    `INSERT INTO cms_content_revisions
      (cid, revision, title, slug, text, type, status, password, allowComment, allowPing, allowFeed,
       snapshot, newline_normalization, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.cid,
      row.revision,
      row.title,
      row.slug,
      Buffer.from(row.text, 'utf8'),
      row.type,
      row.status,
      row.password,
      row.allowComment,
      row.allowPing,
      row.allowFeed,
      JSON.stringify(snapshot),
      row.newlineNormalization ? JSON.stringify(row.newlineNormalization) : null,
      row.createdAt,
    ],
  );
}

function momentFieldError(fields) {
  if (!Array.isArray(fields)) return null;
  for (const field of fields) {
    if (field.name !== 'moment_topics' && field.name !== 'moment_images') continue;
    const text = String(field.str_value ?? '').trim();
    if (!text) continue;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return `${field.name} must be a JSON array`;
    }
    if (!Array.isArray(parsed)) return `${field.name} must be a JSON array`;
    if (field.name === 'moment_images' && parsed.some((item) => (
      !item || typeof item !== 'object' || !String(item.src || item.url || '').trim()
    ))) {
      return 'moment_images must be a JSON array';
    }
  }
  return null;
}

async function recordSave(db, { before, after, revision, now }) {
  await db.query(
    `INSERT INTO cms_change_log (table_name, op, cid, before_json, after_json, created_at)
     VALUES ('cms_contents', ?, ?, ?, ?, ?)`,
    [
      before ? 'update' : 'insert',
      after.cid,
      before ? JSON.stringify({ revision: before.revision, textSha256: before.textSha256 }) : null,
      JSON.stringify({ revision, textSha256: after.textSha256, status: after.status, type: after.type }),
      now,
    ],
  );
  const decision = publishChange(before, after);
  if (!decision) return null;
  await enqueuePublish(db, { cid: after.cid, revision, op: decision.op, now });
  return { state: 'queued', op: decision.op };
}

async function loadFields(db, cid) {
  const [rows] = await db.query(
    `SELECT name, type, str_value, int_value, float_value
     FROM cms_fields WHERE cid = ? ORDER BY name`,
    [cid],
  );
  return rows;
}

async function loadRelationships(db, cid) {
  const [rows] = await db.query(
    'SELECT mid FROM cms_relationships WHERE cid = ? ORDER BY mid',
    [cid],
  );
  return rows.map((row) => Number(row.mid));
}

async function replaceFields(db, cid, fields) {
  await db.query('DELETE FROM cms_fields WHERE cid = ?', [cid]);
  for (const field of fields) {
    await db.query(
      `INSERT INTO cms_fields (cid, name, type, str_value, int_value, float_value)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [cid, field.name, field.type, field.str_value ?? null, field.int_value ?? null, field.float_value ?? null],
    );
  }
}

async function replaceRelationships(db, cid, mids) {
  await db.query('DELETE FROM cms_relationships WHERE cid = ?', [cid]);
  for (const mid of mids) {
    await db.query('INSERT INTO cms_relationships (cid, mid) VALUES (?, ?)', [cid, mid]);
  }
}

async function syncSourceAndJobs(db, row, now) {
  const hash = sourceHash(row.title ?? '', row.text ?? '');
  await db.query(
    `INSERT INTO cms_i18n_source_state
       (cid, source_revision, source_hash, visibility, content_type, saved_at)
     VALUES (?, 1, ?, ?, ?, ?) AS new
     ON DUPLICATE KEY UPDATE
       source_revision = cms_i18n_source_state.source_revision + 1,
       source_hash = new.source_hash,
       visibility = new.visibility,
       content_type = new.content_type,
       saved_at = new.saved_at`,
    [row.cid, hash, row.status, row.type, now],
  );
  const [kind] = await db.query(
    `SELECT str_value FROM cms_fields WHERE cid = ? AND name = 'content_kind'`,
    [row.cid],
  );
  const isMoment = kind.length > 0 && String(kind[0].str_value || '').trim() === 'moment';
  const isPublic = (row.type === 'post' || row.type === 'page')
    && row.status === 'publish'
    && !String(row.password || '');
  if (isPublic && !isMoment) {
    const [state] = await db.query(
      'SELECT source_revision, source_hash FROM cms_i18n_source_state WHERE cid = ?',
      [row.cid],
    );
    await db.query(
      `INSERT IGNORE INTO cms_i18n_translation_job
         (idem_key, cid, locale, status, expected_source_revision, expected_source_hash,
          next_run_at, created_at, updated_at)
       VALUES (?, ?, 'en', 'queued', ?, ?, ?, ?, ?)`,
      [
        translateIdemKey(row.cid, 'en', state[0].source_revision),
        row.cid,
        state[0].source_revision,
        state[0].source_hash,
        now,
        now,
        now,
      ],
    );
    return;
  }
  await db.query(
    `UPDATE cms_i18n_translation_job
     SET status = 'cancelled', updated_at = ?
     WHERE cid = ? AND status IN ('queued', 'leased', 'failed')`,
    [now, row.cid],
  );
}

const CONTENT_TYPES = new Set(['post', 'page', 'post_draft', 'page_draft', 'attachment']);
const CONTENT_STATUSES = new Set(['publish', 'private', 'hidden']);
const FLAG_DEFAULTS = { allowComment: '1', allowPing: '0', allowFeed: '1' };

function flagChar(value) {
  if (value === true || value === 1 || value === '1') return '1';
  if (value === false || value === 0 || value === '0') return '0';
  return null;
}

function resolvedFlags(input, current) {
  const flags = {};
  for (const key of Object.keys(FLAG_DEFAULTS)) {
    if (input[key] === undefined) {
      flags[key] = current ? String(current[key]) : FLAG_DEFAULTS[key];
      continue;
    }
    const next = flagChar(input[key]);
    if (!next) return null;
    flags[key] = next;
  }
  return flags;
}

function resolvedVisibility(input, current) {
  const type = input.type === undefined ? (current ? current.type : 'post') : String(input.type);
  const status = input.status === undefined ? (current ? current.status : 'publish') : String(input.status);
  const password = input.password === undefined ? (current ? current.password : null) : input.password;
  if (!CONTENT_TYPES.has(type) || !CONTENT_STATUSES.has(status)) return null;
  return { type, status, password };
}

export async function saveContent(db, input) {
  const refused = await shadowWriteRefusal(db);
  if (refused) return refused;
  const current = await getContent(db, input.cid);
  const stored = current ? current.text : '';
  const decision = acceptStoredText(stored, String(input.text), input.newlineNormalization || null);
  if (!decision.ok) return { ok: false, status: 400, error: decision.error, current };
  const text = decision.text;
  const hash = sha256Text(text);
  const now = Math.floor(Date.now() / 1000);
  const title = input.title == null ? current?.title || '' : String(input.title);
  const visibility = resolvedVisibility(input, current);
  if (!visibility) return { ok: false, status: 400, error: 'bad type or status' };
  const flags = resolvedFlags(input, current);
  if (!flags) return { ok: false, status: 400, error: 'bad allow flag' };
  if (visibility.type !== 'attachment') {
    const markdown = /^<!--markdown-->/i.test(text);
    if (!current && !markdown) return { ok: false, status: 400, error: 'new content must be markdown' };
    if (current && !/^<!--markdown-->/i.test(String(current.text || '')) && text !== current.text) {
      return { ok: false, status: 400, error: 'html stock text is read-only' };
    }
  }
  const storedSlug = !current
    ? (input.slug || String(input.cid))
    : (input.slug === undefined ? current.slug : String(input.slug));
  const overColumn = String(title).length > 200
    || String(storedSlug ?? '').length > 200
    || String(visibility.password ?? '').length > 32
    || (Array.isArray(input.fields) && input.fields.some((field) => (
      String(field.name || '').length > 200 || String(field.type || '').length > 8
    )));
  if (overColumn) return { ok: false, status: 400, error: 'value exceeds the column length' };
  const fieldError = momentFieldError(input.fields);
  if (fieldError) return { ok: false, status: 400, error: fieldError };
  await db.beginTransaction();
  try {
    if (!current) {
      if (input.baseRevision !== 0) {
        await db.rollback();
        return { ok: false, status: 409, error: 'missing content', current: null };
      }
      await db.query(
        `INSERT INTO cms_contents
          (cid, title, slug, created, modified, text, \`order\`, authorId, template, type, status,
           password, commentsNum, allowComment, allowPing, allowFeed, parent, revision, text_sha256)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, NULL, ?, ?, ?, 0, ?, ?, ?, 0, 1, ?)`,
        [
          input.cid, title, input.slug || String(input.cid), now, now, text,
          visibility.type, visibility.status, visibility.password,
          flags.allowComment, flags.allowPing, flags.allowFeed, hash,
        ],
      );
      const created = {
        cid: input.cid,
        title,
        slug: input.slug || String(input.cid),
        text,
        type: visibility.type,
        status: visibility.status,
        password: visibility.password,
        allowComment: flags.allowComment,
        allowPing: flags.allowPing,
        allowFeed: flags.allowFeed,
        textSha256: hash,
      };
      if (Array.isArray(input.fields)) await replaceFields(db, input.cid, input.fields);
      if (Array.isArray(input.relationshipMids)) await replaceRelationships(db, input.cid, input.relationshipMids);
      await insertRevision(db, {
        ...created,
        revision: 1,
        fields: await loadFields(db, input.cid),
        relationships: await loadRelationships(db, input.cid),
        newlineNormalization: decision.newlineNormalization,
        createdAt: now,
        contentCreated: now,
        contentModified: now,
      });
      await syncSourceAndJobs(db, created, now);
      const publish = await recordSave(db, { before: null, after: created, revision: 1, now });
      await appendAudit(db, {
        action: 'content.save',
        cid: input.cid,
        detail: { revision: 1, type: visibility.type, status: visibility.status, publishOp: publish?.op ?? null, password: visibility.password },
        now,
      });
      await db.commit();
      return { ok: true, revision: 1, textSha256: hash, publish };
    }
    const status = visibility.status;
    const type = visibility.type;
    const password = visibility.password;
    const slug = input.slug === undefined ? current.slug : String(input.slug);
    const [result] = await db.query(
      `UPDATE cms_contents
       SET title = ?, slug = ?, text = ?, modified = ?, type = ?, status = ?, password = ?,
           allowComment = ?, allowPing = ?, allowFeed = ?,
           revision = revision + 1, text_sha256 = ?
       WHERE cid = ? AND revision = ?`,
      [
        title, slug, text, now, type, status, password,
        flags.allowComment, flags.allowPing, flags.allowFeed,
        hash, input.cid, input.baseRevision,
      ],
    );
    if (result.affectedRows !== 1) {
      await db.rollback();
      return { ok: false, status: 409, error: 'revision conflict', current: await getContent(db, input.cid) };
    }
    if (Array.isArray(input.fields)) await replaceFields(db, input.cid, input.fields);
    if (Array.isArray(input.relationshipMids)) await replaceRelationships(db, input.cid, input.relationshipMids);
    const revision = input.baseRevision + 1;
    const updated = {
      ...current,
      title,
      slug,
      text,
      type,
      status,
      password,
      textSha256: hash,
      allowComment: flags.allowComment,
      allowPing: flags.allowPing,
      allowFeed: flags.allowFeed,
    };
    await insertRevision(db, {
      cid: input.cid,
      revision,
      title,
      slug,
      text,
      type,
      status,
      password,
      allowComment: flags.allowComment,
      allowPing: flags.allowPing,
      allowFeed: flags.allowFeed,
      fields: await loadFields(db, input.cid),
      relationships: await loadRelationships(db, input.cid),
      newlineNormalization: decision.newlineNormalization,
      createdAt: now,
      contentCreated: current.created,
      contentModified: now,
    });
    await syncSourceAndJobs(db, updated, now);
    const publish = await recordSave(db, { before: current, after: updated, revision, now });
    await appendAudit(db, {
      action: 'content.save',
      cid: input.cid,
      detail: { revision, type, status, publishOp: publish?.op ?? null, password },
      now,
    });
    await db.commit();
    return { ok: true, revision, textSha256: hash, publish };
  } catch (error) {
    try { await db.rollback(); } catch {}
    if (error && error.code === 'ER_DUP_ENTRY' && String(error.message).includes('cms_contents')) {
      return { ok: false, status: 409, error: 'revision conflict', current: await getContent(db, input.cid) };
    }
    throw error;
  }
}

export async function deleteContent(db, { cid, baseRevision }) {
  const refused = await shadowWriteRefusal(db);
  if (refused) return refused;
  const current = await getContent(db, cid);
  if (!current) return { ok: false, status: 404, error: 'missing content' };
  const now = Math.floor(Date.now() / 1000);
  await db.beginTransaction();
  try {
    const [removed] = await db.query(
      'DELETE FROM cms_contents WHERE cid = ? AND revision = ?',
      [cid, baseRevision],
    );
    if (removed.affectedRows !== 1) {
      await db.rollback();
      return { ok: false, status: 409, error: 'revision conflict', current: await getContent(db, cid) };
    }
    for (const table of [
      'cms_relationships',
      'cms_fields',
      'cms_i18n_translation_job',
      'cms_i18n_publish_outbox',
      'cms_i18n_publication_ledger',
      'cms_i18n_translation_head',
      'cms_i18n_translation_version',
      'cms_i18n_source_state',
    ]) {
      await db.query(`DELETE FROM ${table} WHERE cid = ?`, [cid]);
    }
    await db.query(
      `INSERT INTO cms_change_log (table_name, op, cid, before_json, created_at)
       VALUES ('cms_contents', 'delete', ?, ?, ?)`,
      [cid, JSON.stringify({ revision: current.revision, textSha256: current.textSha256 }), now],
    );
    const decision = publishChange(current, null);
    const publish = decision
      ? { state: 'queued', op: decision.op }
      : null;
    if (decision) await enqueuePublish(db, { cid, revision: current.revision, op: decision.op, now });
    await appendAudit(db, {
      action: 'content.delete',
      cid,
      detail: { revision: current.revision, publishOp: publish?.op ?? null },
      now,
    });
    await db.commit();
    return { ok: true, publish };
  } catch (error) {
    try { await db.rollback(); } catch {}
    throw error;
  }
}

function revisionText(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return value == null ? '' : String(value);
}

function revisionSnapshot(value) {
  const snapshot = typeof value === 'string' ? JSON.parse(value) : value;
  return {
    fields: Array.isArray(snapshot?.fields) ? snapshot.fields : [],
    relationships: Array.isArray(snapshot?.relationships) ? snapshot.relationships : [],
  };
}

export async function restoreContentRevision(db, { cid, baseRevision, revision }) {
  if (!Number.isInteger(cid) || cid <= 0 || !Number.isInteger(baseRevision) || baseRevision < 1) {
    return { ok: false, status: 400, error: 'bad-params' };
  }
  if (!Number.isInteger(revision) || revision < 1) return { ok: false, status: 400, error: 'bad-params' };
  const refused = await shadowWriteRefusal(db);
  if (refused) return refused;
  const current = await getContent(db, cid);
  if (!current) return { ok: false, status: 404, error: 'missing content' };
  const now = Math.floor(Date.now() / 1000);
  await db.beginTransaction();
  try {
    const [rows] = await db.query(
      `SELECT title, slug, text, type, status, password, allowComment, allowPing, allowFeed, snapshot
       FROM cms_content_revisions WHERE cid = ? AND revision = ?`,
      [cid, revision],
    );
    if (!rows.length) {
      await db.rollback();
      return { ok: false, status: 404, error: 'missing revision' };
    }
    const stored = rows[0];
    const text = revisionText(stored.text);
    const snapshot = revisionSnapshot(stored.snapshot);
    const hash = sha256Text(text);
    const [result] = await db.query(
      `UPDATE cms_contents
       SET title = ?, slug = ?, text = ?, modified = ?, type = ?, status = ?, password = ?,
           allowComment = ?, allowPing = ?, allowFeed = ?,
           revision = revision + 1, text_sha256 = ?
       WHERE cid = ? AND revision = ?`,
      [
        stored.title, stored.slug, text, now, stored.type, stored.status, stored.password,
        stored.allowComment, stored.allowPing, stored.allowFeed, hash, cid, baseRevision,
      ],
    );
    if (result.affectedRows !== 1) {
      await db.rollback();
      return { ok: false, status: 409, error: 'revision conflict', current: await getContent(db, cid) };
    }
    await replaceFields(db, cid, snapshot.fields);
    await replaceRelationships(db, cid, snapshot.relationships);
    const next = baseRevision + 1;
    const restored = {
      cid,
      title: stored.title,
      slug: stored.slug,
      text,
      type: stored.type,
      status: stored.status,
      password: stored.password,
      allowComment: stored.allowComment,
      allowPing: stored.allowPing,
      allowFeed: stored.allowFeed,
      textSha256: hash,
    };
    await insertRevision(db, {
      ...restored,
      revision: next,
      fields: await loadFields(db, cid),
      relationships: await loadRelationships(db, cid),
      createdAt: now,
      contentCreated: snapshot.created ?? current.created,
      contentModified: now,
    });
    await syncSourceAndJobs(db, restored, now);
    const publish = await recordSave(db, { before: current, after: restored, revision: next, now });
    await appendAudit(db, {
      action: 'content.restore',
      cid,
      detail: { revision: next, restoredFrom: revision, publishOp: publish?.op ?? null },
      now,
    });
    await db.commit();
    return { ok: true, revision: next, restoredFrom: revision, textSha256: hash, publish };
  } catch (error) {
    try { await db.rollback(); } catch {}
    throw error;
  }
}

export function exportContentRow(row) {
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
