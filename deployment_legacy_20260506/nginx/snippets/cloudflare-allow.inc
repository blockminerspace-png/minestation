# Incluir no `server { }` que faz proxy para a aplicação (HTTPS), **antes** de `location /`.
# OPCIONAL — não está incluído em conf.d/minestation.conf por omissão.
# Se o site “morre” fora da Cloudflare (DNS cinzento, IP directo, ranges desatualizados),
# não uses este ficheiro ou remove o `include` correspondente do server { }.
#
# Só aceita HTTP(s) de IPs da Cloudflare + localhost (health/debug na VM).
# Não substitui UFW: feche 5432, 6379, etc. na firewall e não exponha portas de debug.

allow 127.0.0.1;
allow ::1;

allow 103.21.244.0/22;
allow 103.22.200.0/22;
allow 103.31.4.0/22;
allow 104.16.0.0/13;
allow 104.24.0.0/14;
allow 108.162.192.0/18;
allow 131.0.72.0/22;
allow 141.101.64.0/18;
allow 162.158.0.0/15;
allow 172.64.0.0/13;
allow 173.245.48.0/20;
allow 188.114.96.0/20;
allow 190.93.240.0/20;
allow 197.234.240.0/22;
allow 198.41.128.0/17;

allow 2400:cb00::/32;
allow 2606:4700::/32;
allow 2803:f800::/32;
allow 2405:b500::/32;
allow 2405:8100::/32;
allow 2a06:98c0::/29;
allow 2c0f:f248::/32;

deny all;
