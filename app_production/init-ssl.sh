#!/usr/bin/env bash
# Certificado Let's Encrypt para genesisdao.tech (+ www). Serviços: app_nginx, app_certbot (docker-compose.yml).
# Na VM: cd app_production && bash init-ssl.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

DOMAIN="genesisdao.tech"
EMAIL="${SSL_EMAIL:-blockminer.space@gmail.com}"

echo "### Iniciando solicitação de certificado SSL para $DOMAIN..."

if [[ ! -e "certbot/conf/live/$DOMAIN" ]]; then
  echo "### Criando certificados temporários..."
  mkdir -p "certbot/conf/live/$DOMAIN"
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "certbot/conf/live/$DOMAIN/privkey.pem" \
    -out "certbot/conf/live/$DOMAIN/fullchain.pem" \
    -subj "/CN=$DOMAIN"
fi

echo "### Subindo Nginx..."
docker compose up -d app_nginx

echo "### Removendo certificados temporários / slot antigo..."
docker compose run --rm --entrypoint sh app_certbot -c \
  "rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf" || true

echo "### Solicitando certificado real para $DOMAIN..."
docker compose run --rm --entrypoint sh app_certbot -c \
  "certbot certonly --webroot -w /var/www/certbot \
    --email $EMAIL --agree-tos --no-eff-email \
    -d $DOMAIN -d www.$DOMAIN"

echo "### Recarregando Nginx..."
docker compose exec app_nginx nginx -s reload
