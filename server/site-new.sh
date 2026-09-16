#!/usr/bin/env bash
#
# site-new.sh - write, enable and reload one nginx site. the script the
# example *New site…* form in devgo-actions.example.json calls; put it at
# ~/scripts/site-new.sh beside the inventory, chmod +x.
#
#   sudo site-new.sh <name> <domain> <port> [options]
#
# needs root for everything but --dry-run, and says so. plain output, no
# colours: it is read in a terminal window DevGo opened on the box.

set -euo pipefail

SITES_AVAILABLE=/etc/nginx/sites-available
SITES_ENABLED=/etc/nginx/sites-enabled

usage() {
	cat <<'EOF'
usage: sudo site-new.sh <name> <domain> <port> [options]

  name      the site file: /etc/nginx/sites-available/<name>
  domain    the apex; www.<domain> is added unless --no-www
  port      what nginx proxies to on 127.0.0.1 (ignored for --type static)

options
  --type proxy|static   proxy (default): location / -> http://127.0.0.1:<port>
                        static: root <dir> with try_files, nothing proxied
  --api-port <n>        location /api -> http://127.0.0.1:<n>
  --root <dir>          the static root, default /var/www/<name>
  --no-www              server_name is the apex alone
  --tls                 certbot --nginx for the names after the reload,
                        when certbot is on PATH; otherwise it says so
  --email <addr>        the contact certbot wants for a first registration
  --force               overwrite an existing site file (a backup is kept)
  --dry-run             print the config and every command, change nothing
EOF
	exit 2
}

die() { echo "site-new.sh: $*" >&2; exit 1; }

ORIG=("$@")
TYPE=proxy; API_PORT=''; ROOT=''; EMAIL=''
WWW=true; TLS=false; FORCE=false; DRY=false
POS=()
while [[ $# -gt 0 ]]; do
	case $1 in
		--type|--api-port|--root|--email)
			[[ $# -ge 2 ]] || die "$1 needs a value"
			case $1 in
				--type) TYPE=$2 ;;
				--api-port) API_PORT=$2 ;;
				--root) ROOT=$2 ;;
				--email) EMAIL=$2 ;;
			esac
			shift 2 ;;
		--no-www) WWW=false; shift ;;
		--tls) TLS=true; shift ;;
		--force) FORCE=true; shift ;;
		--dry-run) DRY=true; shift ;;
		-h|--help) usage ;;
		-*) echo "unknown option: $1" >&2; usage ;;
		*) POS+=("$1"); shift ;;
	esac
done

NAME=${POS[0]:-}; DOMAIN=${POS[1]:-}; PORT=${POS[2]:-}
[[ -n $NAME && -n $DOMAIN && -n $PORT ]] || usage
[[ $NAME =~ ^[A-Za-z0-9._-]+$ ]] || die "name must be letters, digits, . _ - only: $NAME"
[[ $DOMAIN =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "domain looks wrong: $DOMAIN"
[[ $PORT =~ ^[0-9]+$ ]] || die "port must be a number: $PORT"
[[ -z $API_PORT || $API_PORT =~ ^[0-9]+$ ]] || die "--api-port must be a number: $API_PORT"
case $TYPE in proxy|static) ;; *) die "--type must be proxy or static, not $TYPE" ;; esac
ROOT=${ROOT:-/var/www/$NAME}

if ! $DRY && [[ $EUID -ne 0 ]]; then
	die "needs root: sudo $0 ${ORIG[*]}"
fi

NAMES=$DOMAIN
$WWW && NAMES="$DOMAIN www.$DOMAIN"
CONF=$SITES_AVAILABLE/$NAME
LINK=$SITES_ENABLED/$NAME

proxy_headers() {
	cat <<'EOF'
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
EOF
}

config() {
	echo "# $NAME ($TYPE) - written by site-new.sh on $(date +%Y-%m-%dT%H:%M:%S%z)"
	echo "# certbot rewrites this block when it adds https"
	echo "server {"
	echo "    listen 80;"
	echo "    listen [::]:80;"
	echo "    server_name $NAMES;"
	echo
	echo "    client_max_body_size 20m;"
	if [[ -n $API_PORT ]]; then
		echo
		echo "    location /api {"
		echo "        proxy_pass http://127.0.0.1:$API_PORT;"
		proxy_headers
		echo "    }"
	fi
	echo
	if [[ $TYPE == static ]]; then
		echo "    root $ROOT;"
		echo "    index index.html;"
		echo
		echo "    location / {"
		echo '        try_files $uri $uri/ /index.html;'
		echo "    }"
	else
		echo "    location / {"
		echo "        proxy_pass http://127.0.0.1:$PORT;"
		proxy_headers
		echo '        proxy_set_header Upgrade $http_upgrade;'
		echo '        proxy_set_header Connection "upgrade";'
		echo "    }"
	fi
	echo "}"
}

# every command is printed before it runs; with --dry-run it is only printed
run() {
	echo "+ $*"
	$DRY || "$@"
}

echo "site    $NAME ($TYPE)"
echo "names   $NAMES"
case $TYPE in
	static) echo "root    $ROOT" ;;
	*) echo "port    127.0.0.1:$PORT" ;;
esac
[[ -n $API_PORT ]] && echo "api     127.0.0.1:$API_PORT at /api"
echo "file    $CONF"
echo

if [[ -e $CONF ]] && ! $FORCE; then
	if $DRY; then
		echo "note: $CONF exists; without --force the real run stops here"
	else
		die "$CONF exists. --force overwrites it (a backup is kept)"
	fi
fi
if [[ $TYPE == static && ! -d $ROOT ]]; then
	echo "note: $ROOT does not exist yet; nginx answers 404 until it does"
fi
if [[ $TYPE == proxy ]] && command -v ss >/dev/null 2>&1 && ! ss -lnt 2>/dev/null | awk '{ print $4 }' | grep -qE "[:.]$PORT\$"; then
	echo "note: nothing listens on 127.0.0.1:$PORT yet; nginx answers 502 until the app starts"
fi

echo "--- $CONF"
config
echo "---"
echo

BAK=''
if [[ -e $CONF ]] && $FORCE; then
	BAK="$CONF.bak.$(date +%s)"
	run cp "$CONF" "$BAK"
fi

echo "+ write $CONF"
$DRY || config > "$CONF"
run ln -sfn "$CONF" "$LINK"

# a config that fails the test is taken back out before anything reloads:
# a reload with a broken file takes every other site down with it
if ! run nginx -t; then
	echo "nginx -t failed; nothing was reloaded" >&2
	rm -f "$LINK" "$CONF"
	[[ -n $BAK ]] && mv "$BAK" "$CONF" && echo "previous $CONF restored" >&2
	exit 1
fi

if command -v systemctl >/dev/null 2>&1; then
	run systemctl reload nginx
else
	run nginx -s reload
fi

if $TLS; then
	if command -v certbot >/dev/null 2>&1; then
		CB=(certbot --nginx --non-interactive --agree-tos --redirect -d "$DOMAIN")
		$WWW && CB+=(-d "www.$DOMAIN")
		[[ -n $EMAIL ]] && CB+=(-m "$EMAIL")
		run "${CB[@]}" || echo "certbot failed; the site still answers on http. retry: sudo ${CB[*]}"
	else
		echo "certbot is not on PATH, so no certificate was requested; the site answers on http"
	fi
fi

echo
if $DRY; then
	echo "dry run: nothing was written, enabled or reloaded"
else
	echo "$NAME is up: http://$DOMAIN"
	echo "disable: sudo rm $LINK && sudo systemctl reload nginx"
fi
