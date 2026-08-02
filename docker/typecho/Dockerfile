# Typecho PHP-FPM image. Joe theme remains the CMS editor (Stage 5 primary).
FROM php:8.2-fpm-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends libcurl4-openssl-dev \
  && docker-php-ext-install pdo_mysql mysqli \
  && pecl install redis || true \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www/typecho
