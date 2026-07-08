#!/bin/sh
# Runs automatically before nginx starts (official nginx image convention:
# every executable script under /docker-entrypoint.d/ is sourced/run first).
# Picks the HTTPS-enabled vhost if certs are mounted at /certs, otherwise
# keeps plain HTTP - so the image works unchanged when TLS isn't configured.
set -e

if [ -f /certs/fullchain.pem ] && [ -f /certs/privkey.pem ]; then
  echo "[web] Certificados TLS encontrados en /certs - HTTPS habilitado en :443"
  cp /etc/nginx/conf-available/https.conf /etc/nginx/conf.d/default.conf
else
  echo "[web] Sin certificados en /certs - sirviendo solo HTTP en :80"
  cp /etc/nginx/conf-available/http.conf /etc/nginx/conf.d/default.conf
fi
