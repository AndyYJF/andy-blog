#!/usr/bin/env bash
# host/cert-new-andy-y.sh — issue / renew TLS for new.andy-y.cn (staging preview).
# Run on the VPS as root/deploy with DNS pointing to this origin. Not for www cutover.
set -Eeuo pipefail

DOMAIN="${DOMAIN:-new.andy-y.cn}"
EMAIL="${CERTBOT_EMAIL:?set CERTBOT_EMAIL}"
WWW_ROOT="${WWW_ROOT:-/var/www/andy-y.cn}"

if ! command -v certbot >/dev/null 2>&1; then
  echo "certbot not installed" >&2
  exit 1
fi

# Prefer webroot if an HTTP vhost already answers ACME; otherwise standalone (nginx briefly stopped by operator).
METHOD="${CERTBOT_METHOD:-webroot}"

case "$METHOD" in
  webroot)
    WEBROOT="${CERTBOT_WEBROOT:-$WWW_ROOT/current/site}"
    mkdir -p "$WEBROOT"
    certbot certonly --webroot -w "$WEBROOT" \
      -d "$DOMAIN" \
      --email "$EMAIL" \
      --agree-tos \
      --non-interactive \
      --keep-until-expiring
    ;;
  standalone)
    echo "Ensure nginx is stopped or port 80 is free before standalone" >&2
    certbot certonly --standalone \
      -d "$DOMAIN" \
      --email "$EMAIL" \
      --agree-tos \
      --non-interactive \
      --keep-until-expiring
    ;;
  *)
    echo "CERTBOT_METHOD must be webroot or standalone" >&2
    exit 1
    ;;
esac

echo "certificate paths:"
echo "  /etc/letsencrypt/live/$DOMAIN/fullchain.pem"
echo "  /etc/letsencrypt/live/$DOMAIN/privkey.pem"
echo "Next: docker compose config → start waline-staging → candidate symlink → nginx -t -c candidate-staging → load staging-loader"
