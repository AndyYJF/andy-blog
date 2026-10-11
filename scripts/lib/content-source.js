import { jsonSafeInteger } from './json-safe.js';
import { readI18nTables } from './i18n-snapshot.js';

function jsonSafeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') out[key] = jsonSafeInteger(value);
    else if (Buffer.isBuffer(value)) out[key] = value.toString('utf8');
    else if (value instanceof Date) out[key] = Math.floor(value.getTime() / 1000);
    else out[key] = value ?? null;
  }
  return out;
}

export function resolveContentSource(env = process.env) {
  const raw = env.CONTENT_SOURCE == null || env.CONTENT_SOURCE === '' ? 'typecho' : env.CONTENT_SOURCE;
  if (raw !== 'typecho' && raw !== 'cms') throw new Error(`unknown CONTENT_SOURCE ${raw}`);
  return raw;
}

export function contentTablePrefix(source) {
  if (source === 'typecho') return 'typecho_';
  if (source === 'cms') return 'cms_';
  throw new Error(`unknown content source ${source}`);
}

export async function readBuildSnapshot(db, { source, epoch }) {
  const prefix = contentTablePrefix(source);
  const [contents] = await db.query(
    `SELECT cid, type, title, slug, text, created, modified,
            allowComment, allowFeed, \`order\`, template, password, status
     FROM ${prefix}contents
     WHERE type IN ('post','page','post_draft')
     ORDER BY cid`,
  );
  const [relations] = await db.query(
    `SELECT r.cid, m.mid, m.name, m.slug, m.type, m.\`order\`
     FROM ${prefix}relationships r
     JOIN ${prefix}metas m ON m.mid=r.mid
     ORDER BY r.cid, m.type, m.\`order\`, m.mid`,
  );
  const [fields] = await db.query(
    `SELECT cid, name, type, str_value, int_value, float_value
     FROM ${prefix}fields ORDER BY cid, name`,
  );
  const [metas] = await db.query(
    `SELECT mid, name, slug, type, description, count, \`order\`
     FROM ${prefix}metas WHERE type IN ('category','tag')
     ORDER BY type, \`order\`, mid`,
  );
  const i18n = await readI18nTables(db, prefix);
  if (source === 'cms' && !i18n) throw new Error('cms export is missing i18n tables');
  return {
    snapshotEpoch: epoch,
    schemaVersion: 2,
    contents: contents.map(jsonSafeRow),
    relations: relations.map(jsonSafeRow),
    fields: fields.map(jsonSafeRow),
    metas: metas.map(jsonSafeRow),
    ...(i18n
      ? {
        i18n: {
          sourceState: i18n.sourceState.map(jsonSafeRow),
          heads: i18n.heads.map(jsonSafeRow),
          versions: i18n.versions.map(jsonSafeRow),
          ledger: i18n.ledger.map(jsonSafeRow),
        },
      }
      : {}),
  };
}
