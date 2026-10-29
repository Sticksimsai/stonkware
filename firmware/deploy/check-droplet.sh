#!/usr/bin/env bash
# Read-only check: can this droplet also host Hypeware? Changes nothing.
#   bash check-droplet.sh
echo "== OS =="; grep PRETTY_NAME /etc/os-release | cut -d= -f2 | tr -d '"'; uname -m
echo "== CPU/RAM/disk =="; nproc | sed 's/^/vCPU: /'; free -h | awk '/Mem|Swap/{print $1, "total", $2, "used", $3, "free", $7}'; df -h / | awk 'NR==2{print "disk /:", $2, "total,", $4, "free"}'
echo "== load ==";      uptime
echo "== node/pm2/docker =="; for c in node npm pm2 docker caddy nginx apache2 certbot sqlite3; do printf '%-8s ' "$c"; command -v $c >/dev/null && ($c --version 2>/dev/null || $c -v 2>&1) | head -1 || echo "-"; done
echo "== web servers running =="; for s in nginx caddy apache2 httpd; do systemctl is-active --quiet $s 2>/dev/null && echo "$s: active"; done; true
echo "== listening ports =="; ss -tlnp 2>/dev/null | awk 'NR>1{print $4, $6}' | sed 's/users:((//; s/,pid.*//' | sort -u
echo "== pm2 apps =="; (pm2 ls 2>/dev/null || true) | head -20
echo "== docker containers =="; (docker ps --format '{{.Names}}  {{.Ports}}' 2>/dev/null || true) | head -20
echo "== firewall =="; (ufw status 2>/dev/null || echo "ufw not installed") | head -12
echo "== existing nginx/caddy sites =="; ls /etc/nginx/sites-enabled 2>/dev/null; grep -hE '^[a-z0-9.-]+\s*\{' /etc/caddy/Caddyfile 2>/dev/null
echo "== verdict =="
mem=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo); avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo); free_disk=$(df -m / | awk 'NR==2{print $4}')
[ "$avail" -ge 1500 ] && echo "RAM: OK (${avail} MB available of ${mem})" || echo "RAM: TIGHT (${avail} MB available of ${mem}) — use Browserbase (LOCAL_BROWSER=0) or resize"
[ "$free_disk" -ge 5000 ] && echo "Disk: OK (${free_disk} MB free)" || echo "Disk: LOW (${free_disk} MB free) — need ~5 GB"
ss -tln | grep -q ':3000 ' && echo "Port 3000: IN USE — Hypeware will use PORT=3100" || echo "Port 3000: free"
