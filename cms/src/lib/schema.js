/**
 * Local CMS tables. i18n business tables match scripts/i18n-migrate.js version 1
 * with the prefix cms_. The generic publish queue is a different table and does
 * not carry locale or version_id.
 */
export const CMS_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS cms_contents (
    cid INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NULL,
    slug VARCHAR(200) NULL,
    created INT UNSIGNED NOT NULL,
    modified INT UNSIGNED NOT NULL,
    text LONGTEXT NULL,
    \`order\` INT UNSIGNED NOT NULL DEFAULT 0,
    authorId INT UNSIGNED NOT NULL DEFAULT 0,
    template VARCHAR(32) NULL,
    type VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL,
    password VARCHAR(32) NULL,
    commentsNum INT UNSIGNED NOT NULL DEFAULT 0,
    allowComment CHAR(1) NOT NULL DEFAULT '1',
    allowPing CHAR(1) NOT NULL DEFAULT '0',
    allowFeed CHAR(1) NOT NULL DEFAULT '1',
    parent INT UNSIGNED NOT NULL DEFAULT 0,
    revision INT UNSIGNED NOT NULL,
    text_sha256 CHAR(64) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS cms_metas (
    mid INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NULL,
    slug VARCHAR(200) NULL,
    type VARCHAR(32) NOT NULL,
    description VARCHAR(200) NULL,
    count INT UNSIGNED NOT NULL DEFAULT 0,
    \`order\` INT UNSIGNED NOT NULL DEFAULT 0,
    parent INT UNSIGNED NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS cms_relationships (
    cid INT UNSIGNED NOT NULL,
    mid INT UNSIGNED NOT NULL,
    PRIMARY KEY (cid, mid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS cms_fields (
    cid INT UNSIGNED NOT NULL,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(8) NOT NULL,
    str_value TEXT NULL,
    int_value INT NULL,
    float_value FLOAT NULL,
    PRIMARY KEY (cid, name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS cms_content_revisions (
    revision_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    cid INT UNSIGNED NOT NULL,
    revision INT UNSIGNED NOT NULL,
    title VARCHAR(200) NULL,
    slug VARCHAR(200) NULL,
    text LONGBLOB NOT NULL,
    type VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL,
    password VARCHAR(32) NULL,
    allowComment CHAR(1) NOT NULL,
    allowPing CHAR(1) NOT NULL,
    allowFeed CHAR(1) NOT NULL,
    snapshot JSON NOT NULL,
    newline_normalization JSON NULL,
    created_at INT UNSIGNED NOT NULL,
    UNIQUE KEY uniq_cid_revision (cid, revision)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS cms_change_log (
    log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    table_name VARCHAR(64) NOT NULL,
    op ENUM('insert','update','delete') NOT NULL,
    cid INT UNSIGNED NULL,
    mid INT UNSIGNED NULL,
    package_id VARCHAR(80) NULL,
    before_json JSON NULL,
    after_json JSON NULL,
    created_at INT UNSIGNED NOT NULL,
    KEY idx_created (created_at, log_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS cms_import_runs (
    run_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    package_id VARCHAR(80) NOT NULL,
    mode ENUM('bootstrap','mirror') NOT NULL,
    status ENUM('staging','complete','failed') NOT NULL,
    source VARCHAR(64) NOT NULL,
    row_counts JSON NULL,
    started_at INT UNSIGNED NOT NULL,
    finished_at INT UNSIGNED NULL,
    KEY idx_package (package_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS cms_publish_seq (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    next_seq BIGINT UNSIGNED NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS cms_publish_outbox (
    event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    idem_key VARCHAR(96) NOT NULL,
    change_seq BIGINT UNSIGNED NOT NULL,
    cid INT UNSIGNED NULL,
    mid INT UNSIGNED NULL,
    op ENUM('publish','update','unpublish','delete','meta') NOT NULL,
    status ENUM('pending','sending','accepted','failed') NOT NULL DEFAULT 'pending',
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    max_attempts INT UNSIGNED NOT NULL DEFAULT 8,
    lease_owner VARCHAR(64) NULL,
    lease_until INT UNSIGNED NULL,
    next_retry_at INT UNSIGNED NOT NULL,
    last_error VARCHAR(500) NULL,
    created_at INT UNSIGNED NOT NULL,
    updated_at INT UNSIGNED NOT NULL,
    UNIQUE KEY uniq_idem (idem_key),
    UNIQUE KEY uniq_change_seq (change_seq),
    KEY idx_due (status, next_retry_at, event_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS cms_media (
    media_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    url VARCHAR(500) NOT NULL,
    sha256 CHAR(64) NOT NULL,
    mime VARCHAR(64) NOT NULL,
    width INT UNSIGNED NULL,
    height INT UNSIGNED NULL,
    created_at INT UNSIGNED NOT NULL,
    UNIQUE KEY uniq_sha (sha256)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS cms_audit_log (
    audit_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_at INT UNSIGNED NOT NULL,
    actor VARCHAR(64) NOT NULL,
    action VARCHAR(64) NOT NULL,
    cid INT UNSIGNED NULL,
    detail JSON NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS cms_i18n_source_state (
    cid INT UNSIGNED NOT NULL PRIMARY KEY,
    source_revision INT UNSIGNED NOT NULL,
    source_hash CHAR(64) NOT NULL,
    visibility VARCHAR(16) NOT NULL,
    content_type VARCHAR(16) NOT NULL,
    saved_at INT UNSIGNED NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS cms_i18n_translation_head (
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
  `CREATE TABLE IF NOT EXISTS cms_i18n_translation_version (
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
  `CREATE TABLE IF NOT EXISTS cms_i18n_translation_job (
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
    max_attempts INT UNSIGNED NOT NULL DEFAULT 50,
    next_run_at INT UNSIGNED NOT NULL,
    last_error VARCHAR(500) NULL,
    created_at INT UNSIGNED NOT NULL,
    updated_at INT UNSIGNED NOT NULL,
    KEY idx_pick (status, next_run_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS cms_i18n_publish_outbox (
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
  `CREATE TABLE IF NOT EXISTS cms_i18n_publication_ledger (
    cid INT UNSIGNED NOT NULL,
    locale VARCHAR(8) NOT NULL,
    translation_available_at INT UNSIGNED NULL,
    first_published_at INT UNSIGNED NULL,
    last_live_version_id BIGINT UNSIGNED NULL,
    last_live_release VARCHAR(48) NULL,
    updated_at INT UNSIGNED NOT NULL,
    PRIMARY KEY (cid, locale)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS cms_i18n_migrations (
    version INT NOT NULL PRIMARY KEY,
    applied_at INT UNSIGNED NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS cms_runtime (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    mode ENUM('active','shadow') NOT NULL,
    package_id VARCHAR(80) NULL,
    updated_at INT UNSIGNED NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
];

const AUTH_TABLE = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';

export const CMS_AUTH_SQL = [
  `CREATE TABLE IF NOT EXISTS cms_auth_bootstrap (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    secret_hash CHAR(64) NOT NULL,
    expires_at INT UNSIGNED NOT NULL,
    uses_remaining TINYINT UNSIGNED NOT NULL,
    created_at INT UNSIGNED NOT NULL,
    CONSTRAINT chk_bootstrap_uses CHECK (uses_remaining <= 1)
  ) ${AUTH_TABLE}`,
  `CREATE TABLE IF NOT EXISTS cms_auth_admin (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    user_handle VARCHAR(128) NOT NULL,
    user_name VARCHAR(200) NOT NULL,
    created_at INT UNSIGNED NOT NULL
  ) ${AUTH_TABLE}`,
  `CREATE TABLE IF NOT EXISTS cms_auth_challenges (
    challenge_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    flow ENUM('registration','authentication') NOT NULL,
    challenge VARCHAR(200) NOT NULL,
    origin VARCHAR(200) NOT NULL,
    rp_id VARCHAR(200) NOT NULL,
    user_handle VARCHAR(128) NOT NULL,
    user_name VARCHAR(200) NOT NULL,
    expires_at INT UNSIGNED NOT NULL,
    used_at INT UNSIGNED NULL,
    created_at INT UNSIGNED NOT NULL,
    UNIQUE KEY uq_auth_challenge (challenge)
  ) ${AUTH_TABLE}`,
  `CREATE TABLE IF NOT EXISTS cms_auth_credentials (
    credential_id VARCHAR(512) NOT NULL PRIMARY KEY,
    public_key BLOB NOT NULL,
    counter BIGINT UNSIGNED NOT NULL,
    transports VARCHAR(255) NULL,
    aaguid CHAR(36) NOT NULL,
    fmt VARCHAR(32) NOT NULL,
    device_type ENUM('singleDevice','multiDevice') NOT NULL,
    backed_up TINYINT(1) NOT NULL,
    user_verified TINYINT(1) NOT NULL,
    user_handle VARCHAR(128) NOT NULL,
    user_name VARCHAR(200) NOT NULL,
    created_at INT UNSIGNED NOT NULL
  ) ${AUTH_TABLE}`,
];

export const CMS_AUTH_LOGIN_SQL = [
  `ALTER TABLE cms_auth_challenges
   MODIFY flow ENUM('registration','authentication') NOT NULL`,
  `CREATE TABLE IF NOT EXISTS cms_auth_sessions (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    credential_id VARCHAR(512) NOT NULL,
    created_at INT UNSIGNED NOT NULL,
    absolute_until INT UNSIGNED NOT NULL,
    idle_until INT UNSIGNED NOT NULL,
    revoked_at INT UNSIGNED NULL
  ) ${AUTH_TABLE}`,
];

export const CMS_AUTH_SESSION_SQL = [
  'ALTER TABLE cms_auth_sessions ADD COLUMN csrf_hash CHAR(64) NULL',
];

export const CMS_AUTH_REAUTH_SQL = [
  `ALTER TABLE cms_auth_challenges
   MODIFY flow ENUM('registration','authentication','credential','reauth') NOT NULL`,
  'ALTER TABLE cms_auth_sessions ADD COLUMN reauth_at INT UNSIGNED NULL',
];

export const CMS_AUTH_TOTP_SQL = [
  `ALTER TABLE cms_auth_sessions
   ADD COLUMN purpose ENUM('full','rebind') NOT NULL DEFAULT 'full'`,
  `CREATE TABLE IF NOT EXISTS cms_auth_totp (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    secret_enc VARBINARY(128) NOT NULL,
    last_step BIGINT NULL,
    enabled_at INT UNSIGNED NOT NULL,
    failures INT UNSIGNED NOT NULL DEFAULT 0,
    failures_reset_at INT UNSIGNED NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS cms_auth_recovery_codes (
    code_hash CHAR(64) NOT NULL PRIMARY KEY,
    used_at INT UNSIGNED NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS cms_auth_offline_rebind (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    secret_hash CHAR(64) NOT NULL,
    expires_at INT UNSIGNED NOT NULL,
    uses_remaining TINYINT UNSIGNED NOT NULL,
    created_at INT UNSIGNED NOT NULL,
    CONSTRAINT chk_offline_rebind_uses CHECK (uses_remaining <= 1)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
];

export const CMS_SCHEMA_STEPS = [
  { version: 1, statements: CMS_SCHEMA_SQL },
  { version: 2, statements: CMS_AUTH_SQL },
  { version: 3, statements: CMS_AUTH_LOGIN_SQL },
  { version: 4, statements: CMS_AUTH_SESSION_SQL },
  { version: 5, statements: CMS_AUTH_REAUTH_SQL },
  { version: 6, statements: CMS_AUTH_TOTP_SQL },
];

const SCHEMA_MIGRATIONS = `CREATE TABLE IF NOT EXISTS cms_schema_migrations (
  version INT NOT NULL PRIMARY KEY,
  applied_at INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;

export async function applyCmsSchema(db, steps = CMS_SCHEMA_STEPS) {
  await db.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'");
  await db.query(SCHEMA_MIGRATIONS);
  const [rows] = await db.query('SELECT version, applied_at FROM cms_schema_migrations');
  const applied = new Map(rows.map((row) => [Number(row.version), Number(row.applied_at)]));
  for (const step of steps) {
    if (applied.has(step.version)) continue;
    for (const statement of step.statements) await db.query(statement);
    const now = Math.floor(Date.now() / 1000);
    await db.query(
      'INSERT INTO cms_schema_migrations (version, applied_at) VALUES (?, ?)',
      [step.version, now],
    );
    applied.set(step.version, now);
  }
}

export async function ensureCmsSchema(db) {
  await applyCmsSchema(db);
}
