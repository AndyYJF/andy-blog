#!/usr/bin/env node
/**
 * i18n migration runner — versioned, re-runnable.
 * Creates/upgrades the translation tables from docs/i18n-p1-design-2026-09-26.md §2.
 *
 * Usage:
 *   DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=... node scripts/i18n-migrate.js
 *   DB_PREFIX=typecho_ (default) — must match the Typecho config prefix.
 *   DB_NAME may point at an isolated test schema for verification runs.
 */
const PREFIX = /^[a-zA-Z0-9_]{1,32}$/.test(process.env.DB_PREFIX || 'typecho_')
  ? (process.env.DB_PREFIX || 'typecho_')
  : (() => { throw new Error('bad DB_PREFIX'); })();

const MIGRATIONS = [
  {
    version: 1,
    statements: (p) => [
      `CREATE TABLE IF NOT EXISTS ${p}i18n_source_state (
        cid INT UNSIGNED NOT NULL PRIMARY KEY,
        source_revision INT UNSIGNED NOT NULL,
        source_hash CHAR(64) NOT NULL,
        visibility VARCHAR(16) NOT NULL,
        content_type VARCHAR(16) NOT NULL,
        saved_at INT UNSIGNED NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS ${p}i18n_translation_head (
        cid INT UNSIGNED NOT NULL,
        locale VARCHAR(8) NOT NULL,
        translation_revision INT UNSIGNED NOT NULL DEFAULT 0,
        draft_version_id BIGINT UNSIGNED NULL,
        approved_version_id BIGINT UNSIGNED NULL,
        publication_state ENUM('enabled','disabled') NOT NULL DEFAULT 'enabled',
        equivalence_state ENUM('equivalent','not_equivalent') NOT NULL DEFAULT 'equivalent',
        updated_at INT UNSIGNED NOT NULL,
        PRIMARY KEY (cid, locale)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS ${p}i18n_translation_version (
        version_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        cid INT UNSIGNED NOT NULL,
        locale VARCHAR(8) NOT NULL,
        translation_revision INT UNSIGNED NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NULL,
        body LONGTEXT NOT NULL,
        source_revision INT UNSIGNED NOT NULL,
        source_hash CHAR(64) NOT NULL,
        content_digest CHAR(64) NOT NULL,
        glossary_version VARCHAR(40) NOT NULL DEFAULT '',
        author VARCHAR(40) NOT NULL,
        proofread_at INT UNSIGNED NULL,
        proofreader VARCHAR(40) NULL,
        render_verdict VARCHAR(32) NULL,
        render_fingerprint CHAR(64) NULL,
        verified_at INT UNSIGNED NULL,
        created_at INT UNSIGNED NOT NULL,
        KEY idx_cid_locale (cid, locale, version_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS ${p}i18n_translation_job (
        job_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        idem_key VARCHAR(80) NOT NULL UNIQUE,
        cid INT UNSIGNED NOT NULL,
        locale VARCHAR(8) NOT NULL,
        status ENUM('queued','leased','done','failed','superseded','cancelled') NOT NULL DEFAULT 'queued',
        expected_source_revision INT UNSIGNED NOT NULL,
        expected_source_hash CHAR(64) NOT NULL,
        expected_translation_revision INT UNSIGNED NULL,
        lease_owner VARCHAR(64) NULL,
        lease_until INT UNSIGNED NULL,
        attempts INT UNSIGNED NOT NULL DEFAULT 0,
        max_attempts INT UNSIGNED NOT NULL DEFAULT 5,
        next_run_at INT UNSIGNED NOT NULL,
        last_error VARCHAR(500) NULL,
        created_at INT UNSIGNED NOT NULL,
        updated_at INT UNSIGNED NOT NULL,
        KEY idx_pick (status, next_run_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS ${p}i18n_publish_outbox (
        event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        idem_key VARCHAR(96) NOT NULL UNIQUE,
        cid INT UNSIGNED NOT NULL,
        locale VARCHAR(8) NOT NULL,
        version_id BIGINT UNSIGNED NOT NULL,
        status ENUM('pending','accepted','needs_fix','superseded','cancelled','live') NOT NULL DEFAULT 'pending',
        attempts INT UNSIGNED NOT NULL DEFAULT 0,
        next_retry_at INT UNSIGNED NOT NULL,
        release_id VARCHAR(48) NULL,
        observed_at INT UNSIGNED NULL,
        last_error VARCHAR(500) NULL,
        created_at INT UNSIGNED NOT NULL,
        updated_at INT UNSIGNED NOT NULL,
        KEY idx_send (status, next_retry_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS ${p}i18n_publication_ledger (
        cid INT UNSIGNED NOT NULL,
        locale VARCHAR(8) NOT NULL,
        translation_available_at INT UNSIGNED NULL,
        first_published_at INT UNSIGNED NULL,
        last_live_version_id BIGINT UNSIGNED NULL,
        last_live_release VARCHAR(48) NULL,
        updated_at INT UNSIGNED NOT NULL,
        PRIMARY KEY (cid, locale)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ],
  },
];

async function main() {
  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`${key} is required`);
      process.exit(64);
    }
  }
  const mysql = await import('mysql2/promise');
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    multipleStatements: false,
  });
  try {
    await db.query(
      `CREATE TABLE IF NOT EXISTS ${PREFIX}i18n_migrations (
        version INT NOT NULL PRIMARY KEY,
        applied_at INT UNSIGNED NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    const [rows] = await db.query(`SELECT version FROM ${PREFIX}i18n_migrations ORDER BY version`);
    const applied = new Set(rows.map((r) => Number(r.version)));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      for (const statement of migration.statements(PREFIX)) {
        await db.query(statement);
      }
      await db.query(
        `INSERT INTO ${PREFIX}i18n_migrations (version, applied_at) VALUES (?, UNIX_TIMESTAMP())`,
        [migration.version],
      );
      console.log(`applied migration v${migration.version}`);
    }
    const [tables] = await db.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE '${PREFIX}i18n_%' ORDER BY TABLE_NAME`,
    );
    console.log(JSON.stringify({ ok: true, prefix: PREFIX, tables: tables.map((t) => t.TABLE_NAME) }));
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
