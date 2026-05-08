# Incluir dentro de cada `server { }` **antes** de `location /`.
# Responde 404 na borda (não chega ao Node); alinha com curl -I em /.env, /.git, etc.

location ~ /\.(env|git|hg|svn|bzr|htpasswd|htaccess|DS_Store)(/|$) {
    access_log off;
    log_not_found off;
    return 404;
}

location ~* ^/\.env {
    access_log off;
    log_not_found off;
    return 404;
}

location = /package.json { access_log off; return 404; }
location = /package-lock.json { access_log off; return 404; }
location = /yarn.lock { access_log off; return 404; }
location = /pnpm-lock.yaml { access_log off; return 404; }
location = /docker-compose.yml { access_log off; return 404; }
location = /docker-compose.yaml { access_log off; return 404; }

location ~* ^/prisma/schema\.prisma$ {
    access_log off;
    log_not_found off;
    return 404;
}

# Extensões típicas de backup/config em URI (evita /api/… com sufixo acidental)
location ~* ^(?!/api/).*\.(env|ini|log|sql|bak|backup|old|swp)$ {
    access_log off;
    log_not_found off;
    return 404;
}
