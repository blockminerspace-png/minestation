# Nginx atrás da Cloudflare

Dois ficheiros em `snippets/`:

1. **`cloudflare-real-ip.conf`** — incluir uma vez em `http { }` para o Nginx registar o IP real do cliente (`CF-Connecting-IP`).
2. **`cloudflare-allow.inc`** — incluir dentro de cada `server { }` que expõe o site à internet, **no topo do bloco** (antes das `location`), para recusar ligações que não venham da Cloudflare (bypass do proxy).

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
