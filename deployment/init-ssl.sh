#!/bin/bash

# Configurações
DOMAIN="genesisdao.tech"
EMAIL="blockminer.space@gmail.com" # Ajuste se necessário

echo "### Iniciando solicitação de certificado SSL para $DOMAIN..."

# 1. Cria certificados dummy para o Nginx não dar erro ao iniciar
if [ ! -e "certbot/conf/live/$DOMAIN" ]; then
  echo "### Criando certificados temporários..."
  mkdir -p "certbot/conf/live/$DOMAIN"
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "certbot/conf/live/$DOMAIN/privkey.pem" \
    -out "certbot/conf/live/$DOMAIN/fullchain.pem" \
    -subj "/CN=localhost"
fi

echo "### Subindo Nginx..."
docker compose up -d nginx

echo "### Removendo certificados temporários..."
docker compose run --rm --entrypoint \
  "rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf" certbot

echo "### Solicitando certificado real para $DOMAIN..."
docker compose run --rm --entrypoint \
  "certbot certonly --webroot -w /var/www/certbot \
    --email $EMAIL --agree-tos --no-eff-email \
    -d $DOMAIN -d www.$DOMAIN" certbot

echo "### Recarregando Nginx..."
docker compose exec nginx nginx -s reload
