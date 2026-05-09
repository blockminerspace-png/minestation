# Nginx atrás da Cloudflare

Dois ficheiros em `snippets/`:

1. **`cloudflare-real-ip.conf`** — incluir uma vez em `http { }` para o Nginx registar o IP real do cliente (`CF-Connecting-IP`). Isto é seguro e recomendado quando usas Cloudflare como proxy.
2. **`cloudflare-allow.inc`** — **opcional**. Só faz sentido se quiseres recusar na origem qualquer ligação que **não** venha dos IPs oficiais da Cloudflare (reduz bypass do proxy). **Não** está ligado no `conf.d/minestation.conf` deste repo. Se activaste isto na VM e o site deixou de responder (403 / ligação recusada), **remove o `include`** — sobretudo com DNS “cinzento”, teste directo ao IP da origem, ou até ranges Cloudflare desactualizados.

O exemplo abaixo mostra **como** incluir o allowlist se precisares; não é o default do deploy.

Exemplo mínimo no `server` HTTPS que faz `proxy_pass` à API/SPA:

```nginx
server {
    listen 443 ssl;
    server_name exemplo.com;

    # … certificados ssl …

    include /caminho/para/snippets/cloudflare-allow.inc;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

No `http { }` do `nginx.conf`:

```nginx
http {
    include /caminho/para/snippets/cloudflare-real-ip.conf;
    # …
}
```

## Manutenção

A Cloudflare pode alterar rangos IP. Atualizar a partir de:

- https://www.cloudflare.com/ips-v4  
- https://www.cloudflare.com/ips-v6  

## UFW

Manter `ufw default deny incoming`, permitir só `80/tcp`, `443/tcp` e SSH a partir dos IPs de confiança. O Nginx não protege portas que não passam por ele (PostgreSQL, Redis, etc.).

## Origem em desenvolvimento

Não uses `cloudflare-allow.inc` no `server` que serve `localhost` sem Cloudflare — bloqueia o teu browser. Reserva esta include para o vhost de produção atrás do proxy.

## Erro 526 (Invalid SSL certificate)

Com modo SSL na Cloudflare **Full (strict)** (recomendado), a origem tem de apresentar um certificado **válido** cujo **CN/SAN** coincida com o hostname que o visitante pediu (ex.: `dev.genesisdao.tech` não pode usar só o certificado de `genesisdao.tech`).

Neste repositório:

- **`genesisdao.tech`** / `www` → ficheiros em `/etc/letsencrypt/live/genesisdao.tech/` (script `app_production/init-ssl.sh`).
- **`dev.genesisdao.tech`** → certificado **à parte** em `/etc/letsencrypt/live/dev.genesisdao.tech/`; na VM, após o DNS apontar para o servidor: `cd app_production && bash init-ssl-dev-genesisdao.sh`.
- **`minestation.tech`** → `/etc/letsencrypt/live/minestation.tech/` (emitir com certbot de forma análoga, se ainda não existir).

Variável opcional: `SSL_EMAIL` para o e-mail do Let's Encrypt em todos os scripts.
