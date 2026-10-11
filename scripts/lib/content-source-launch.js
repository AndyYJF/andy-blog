import { resolveContentSource } from './content-source.js';

function selectedPrefix(env) {
  const raw = env.DB_PREFIX == null || env.DB_PREFIX === '' ? 'typecho_' : env.DB_PREFIX;
  if (!/^[A-Za-z0-9_]{1,32}$/.test(raw)) throw new Error(`bad DB_PREFIX ${raw}`);
  return raw;
}

export function assertWorkerSource(env = process.env) {
  const source = resolveContentSource(env);
  const prefix = selectedPrefix(env);
  if (source === 'typecho' && prefix !== 'typecho_') {
    throw new Error(`CONTENT_SOURCE=typecho refuses DB_PREFIX ${prefix}`);
  }
  if (source === 'cms' && prefix !== 'cms_') {
    throw new Error(`CONTENT_SOURCE=cms refuses DB_PREFIX ${prefix}`);
  }
  return { source, prefix };
}

export function assertContentSourceGroup(env = process.env) {
  const { source, prefix } = assertWorkerSource(env);
  const observe = env.I18N_OBSERVE_PREFIX == null || env.I18N_OBSERVE_PREFIX === ''
    ? 'typecho_'
    : env.I18N_OBSERVE_PREFIX;
  if (observe !== prefix) {
    throw new Error(`I18N_OBSERVE_PREFIX ${observe} does not match DB_PREFIX ${prefix}`);
  }
  if (source === 'typecho') {
    if (env.CMS_DB_HOST || env.CMS_DB_NAME) {
      throw new Error('typecho source refuses CMS_DB_HOST or CMS_DB_NAME');
    }
    return { source, observePrefix: observe, useCmsDb: false };
  }
  for (const key of ['CMS_DB_HOST', 'CMS_RO_DB_USER', 'CMS_RO_DB_PASSWORD', 'CMS_DB_NAME']) {
    if (!env[key]) throw new Error(`${key} is required when CONTENT_SOURCE=cms`);
  }
  if (env.I18N_OBSERVE_DB && env.I18N_OBSERVE_DB !== env.CMS_DB_NAME) {
    throw new Error('I18N_OBSERVE_DB must equal CMS_DB_NAME');
  }
  if (env.TYPECHO_DB_NAME && env.CMS_DB_NAME === env.TYPECHO_DB_NAME) {
    throw new Error('CMS_DB_NAME must be a different database from TYPECHO_DB_NAME');
  }
  return { source, observePrefix: observe, useCmsDb: true };
}
