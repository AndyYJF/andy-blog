# Shared CONTENT_SOURCE gate for rebuild and content backup.
# Default is Typecho. CMS is explicit and must name a different database,
# worker prefix, and observe prefix together. This file only sets flags;
# it does not open a database or start a build.

content_source_load_env_file() {
  local file="$COMPOSE_DIR/.env"
  [[ -f "$file" ]] || return 0
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue
    key="${line%%=*}"
    case "$key" in
      CONTENT_SOURCE|DB_PREFIX|TYPECHO_DB_PREFIX|TYPECHO_DB_NAME|I18N_OBSERVE_PREFIX|I18N_OBSERVE_DB|I18N_OBSERVE_MYSQL_CONTAINER|CMS_DB_HOST|CMS_RO_DB_USER|CMS_RO_DB_PASSWORD|CMS_DB_NAME)
        [[ -z "${!key:-}" ]] || continue
        value="${line#*=}"
        if [[ "$value" == \"*\" ]]; then
          value="${value:1:${#value}-2}"
        fi
        printf -v "$key" '%s' "$value"
        export "$key"
        ;;
    esac
  done <"$file"
  if [[ -z "${DB_PREFIX:-}" && -n "${TYPECHO_DB_PREFIX:-}" ]]; then
    DB_PREFIX="$TYPECHO_DB_PREFIX"
    export DB_PREFIX
  fi
}

content_source_resolve() {
  local plan line key value
  CONTENT_SOURCE_VALUE=""
  CONTENT_SOURCE_OBSERVE_PREFIX=""
  CONTENT_SOURCE_USE_CMS_DB=""
  export CONTENT_SOURCE_VALUE CONTENT_SOURCE_OBSERVE_PREFIX CONTENT_SOURCE_USE_CMS_DB
  content_source_load_env_file
  if ! plan="$(node "$COMPOSE_DIR/scripts/print-content-source-plan.js")"; then
    return 65
  fi
  while IFS= read -r line; do
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      source) CONTENT_SOURCE_VALUE="$value" ;;
      observePrefix) CONTENT_SOURCE_OBSERVE_PREFIX="$value" ;;
      useCmsDb) CONTENT_SOURCE_USE_CMS_DB="$value" ;;
    esac
  done <<<"$plan"
  case "$CONTENT_SOURCE_VALUE" in
    typecho|cms) ;;
    *) echo "content source plan missing source" >&2; return 65 ;;
  esac
  case "$CONTENT_SOURCE_OBSERVE_PREFIX" in
    typecho_|cms_) ;;
    *) echo "content source plan missing observe prefix" >&2; return 65 ;;
  esac
  case "$CONTENT_SOURCE_USE_CMS_DB" in
    0|1) ;;
    *) echo "content source plan missing database choice" >&2; return 65 ;;
  esac
  export CONTENT_SOURCE_VALUE CONTENT_SOURCE_OBSERVE_PREFIX CONTENT_SOURCE_USE_CMS_DB
}

content_source_snapshot_script() {
  case "$CONTENT_SOURCE_USE_CMS_DB" in
    1) printf '%s\n' export-content-snapshot.js ;;
    0) printf '%s\n' export-typecho-snapshot.js ;;
    *) echo "content source was not resolved" >&2; return 65 ;;
  esac
}

content_source_fill_docker_env() {
  local -n _source_env=$1
  case "$CONTENT_SOURCE_USE_CMS_DB" in
    0) return 0 ;;
    1) ;;
    *) echo "content source was not resolved" >&2; return 65 ;;
  esac
    _source_env+=(
      -e CONTENT_SOURCE=cms
      -e DB_PREFIX=cms_
      -e "I18N_OBSERVE_PREFIX=${CONTENT_SOURCE_OBSERVE_PREFIX}"
      -e "CMS_DB_HOST=${CMS_DB_HOST}"
      -e "CMS_RO_DB_USER=${CMS_RO_DB_USER}"
      -e "CMS_RO_DB_PASSWORD=${CMS_RO_DB_PASSWORD}"
      -e "CMS_DB_NAME=${CMS_DB_NAME}"
      -e "DB_HOST=${CMS_DB_HOST}"
      -e "DB_USER=${CMS_RO_DB_USER}"
      -e "DB_PASSWORD=${CMS_RO_DB_PASSWORD}"
      -e "DB_NAME=${CMS_DB_NAME}"
    )
    if [[ -n "${TYPECHO_DB_NAME:-}" ]]; then
      _source_env+=(-e "TYPECHO_DB_NAME=${TYPECHO_DB_NAME}")
    fi
}

content_source_blank_db_env() {
  local -n _blank_env=$1
  _blank_env+=(
    -e CONTENT_SOURCE=cms
    -e DB_HOST=
    -e DB_USER=
    -e DB_PASSWORD=
    -e DB_NAME=
  )
}

content_source_export_mounts() {
  local -n _source_mounts=$1
  _source_mounts+=(
    -v "$COMPOSE_DIR/scripts/export-typecho-snapshot.js:/app/scripts/export-typecho-snapshot.js:ro"
    -v "$COMPOSE_DIR/scripts/export-content-snapshot.js:/app/scripts/export-content-snapshot.js:ro"
    -v "$COMPOSE_DIR/scripts/lib/content-source.js:/app/scripts/lib/content-source.js:ro"
    -v "$COMPOSE_DIR/scripts/lib/content-source-launch.js:/app/scripts/lib/content-source-launch.js:ro"
    -v "$COMPOSE_DIR/scripts/lib/i18n-snapshot.js:/app/scripts/lib/i18n-snapshot.js:ro"
  )
}
