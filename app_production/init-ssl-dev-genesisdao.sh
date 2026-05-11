#!/usr/bin/env bash
# Emite certificado Let's Encrypt só para dev.genesisdao.tech (vhost HTTPS dedicado no nginx).
# Na VM: cd app_production && bash init-ssl-dev-genesisdao.sh
# Requisitos: DNS dev.genesisdao.tech → IP da VM; portas 80/443 abertas; HTTP-01 acessível (Cloudflare “laranja” OK).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

DOMAIN="dev.genesisdao.tech"
EMAIL="${SSL_EMAIL:-blockminer.space@gmail.com}"

echo "### SSL para $DOMAIN (certificado separado de genesisdao.tech)..."

if [[ ! -e "certbot/conf/live/$DOMAIN" ]]; then
  echo "### Certificados temporários (nginx arranca antes do LE)..."
  mkdir -p "certbot/conf/live/$DOMAIN"
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "certbot/conf/live/$DOMAIN/privkey.pem" \
    -out "certbot/conf/live/$DOMAIN/fullchain.pem" \
    -subj "/CN=$DOMAIN"
fi

echo "### Garantir Nginx a correr (porta 80 para desafio ACME)..."
docker compose up -d app_nginx

echo "### Remover dummy / renovação antiga (se existir) antes do certonly..."
docker compose run --rm --entrypoint sh app_certbot -c \
  "rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf" || true

echo "### Certbot certonly (webroot)..."
docker compose run --rm --entrypoint sh app_certbot -c \
  "certbot certonly --webroot -w /var/www/certbot \
    --email $EMAIL --agree-tos --no-eff-email \
    -d $DOMAIN"

echo "### Recarregar Nginx..."
docker compose exec app_nginx nginx -s reload
echo "### Concluído: /etc/letsencrypt/live/$DOMAIN/ (no volume certbot/conf)."
