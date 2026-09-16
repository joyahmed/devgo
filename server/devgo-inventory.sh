#!/usr/bin/env bash
#
# devgo-inventory.sh - one json document describing the apps on this box,
# for the Servers lane of DevGo. put it at ~/scripts/devgo-inventory.sh,
# chmod +x, and the app reads it on every refresh of the server row.
#
#   devgo-inventory.sh            # compact json on stdout
#   devgo-inventory.sh --pretty   # indented, through jq or python3 when there
#
# runs as a normal user, needs no root. bash 4 + coreutils + awk are enough;
# everything else is optional and skipped when absent: pm2 (its list read
# through jq or python3), docker, ss, git, nginx's sites-enabled.
# never prints a value out of an env file: DATABASE_URL gives the engine,
# host, port and database name, the credentials are dropped unread.
#
# roots: /var/www and /srv, or DEVGO_ROOTS="/opt/apps:/var/www". a folder
# right under a root is an app when it has .git, package.json, a compose
# file, or a process whose cwd is inside it.
#
# no set -e and no set -u on purpose: a missing tool or an odd line must
# never cut the document short, the app needs the whole thing or nothing

export LC_ALL=C

PRETTY=false
[[ ${1:-} == --pretty ]] && PRETTY=true

IFS=: read -r -a ROOTS <<<"${DEVGO_ROOTS:-/var/www:/srv}"
SITES_ENABLED=/etc/nginx/sites-enabled
NOW_MS=$(( $(date +%s) * 1000 ))

has() { command -v "$1" >/dev/null 2>&1; }

# ------------------------------------------------------------------ json
jstr() {
	local s=$1
	s=${s//\\/\\\\}
	s=${s//\"/\\\"}
	s=${s//$'\n'/\\n}
	s=${s//$'\r'/\\r}
	s=${s//$'\t'/\\t}
	printf '"%s"' "$s"
}
# a string, or null when empty
jopt() { if [[ -n ${1:-} ]]; then jstr "$1"; else printf 'null'; fi; }
# a number, or null when empty or not one
jnum() { if [[ ${1:-} =~ ^-?[0-9]+(\.[0-9]+)?$ ]]; then printf '%s' "$1"; else printf 'null'; fi; }
jstrs() { local out='' x; for x in "$@"; do out+="${out:+,}$(jstr "$x")"; done; printf '[%s]' "$out"; }
jnums() { local out='' x; for x in "$@"; do out+="${out:+,}$x"; done; printf '[%s]' "$out"; }

# ------------------------------------------------------------- processes
# pid -> ppid once: the listener is usually a child or a grandchild of the
# pid pm2 knows, so its ports are found by walking the subtree
PS_TABLE=$(ps -eo pid=,ppid= 2>/dev/null)
subtree() {
	awk -v root="$1" '
		{ kids[$2] = kids[$2] " " $1 }
		END {
			n = 1; q[1] = root
			for (i = 1; i <= n; i++) {
				print q[i]
				m = split(kids[q[i]], k, " ")
				for (j = 1; j <= m; j++) q[++n] = k[j]
			}
		}' <<<"$PS_TABLE"
}

# pid <tab> port per listening tcp socket
PORT_TABLE=''
if has ss; then
	PORT_TABLE=$(ss -lntpH 2>/dev/null | awk '{
		n = split($4, a, ":"); port = a[n]
		if (port !~ /^[0-9]+$/) next
		while (match($0, /pid=[0-9]+/)) {
			print substr($0, RSTART + 4, RLENGTH - 4) "\t" port
			$0 = substr($0, RSTART + RLENGTH)
		}
	}')
fi
# the ports the subtree of $1 listens on, sorted, space separated
ports_of() {
	local pids
	pids=$(subtree "$1" | tr '\n' ' ')
	awk -v pids=" $pids " -F '\t' 'index(pids, " " $1 " ") { print $2 }' <<<"$PORT_TABLE" | sort -n -u | tr '\n' ' '
}

# name pid status restarts uptime_ms cwd node memory, tab separated
pm2_rows() {
	has pm2 || return 0
	local list
	list=$(pm2 jlist 2>/dev/null | grep -m1 -E '^\[(\{.*|\])$') || return 0
	if has jq; then
		jq -r '.[] | [.name, (.pid // 0), (.pm2_env.status // ""), (.pm2_env.restart_time // 0), (.pm2_env.pm_uptime // 0), (.pm2_env.pm_cwd // ""), (.pm2_env.node_version // ""), (.monit.memory // 0)] | @tsv' <<<"$list"
	elif has python3; then
		python3 -c '
import json, sys
for a in json.load(sys.stdin):
    e = a.get("pm2_env") or {}
    m = a.get("monit") or {}
    print("\t".join(str(x) for x in (a.get("name") or "", a.get("pid") or 0, e.get("status") or "", e.get("restart_time") or 0, e.get("pm_uptime") or 0, e.get("pm_cwd") or "", e.get("node_version") or "", m.get("memory") or 0)))' <<<"$list"
	fi
}

# name ports working_dir status, tab separated, running containers only
docker_rows() {
	has docker || return 0
	docker ps --format '{{.Names}}\t{{.Ports}}\t{{.Label "com.docker.compose.project.working_dir"}}\t{{.Status}}' 2>/dev/null
}

P_PM2=(); P_DOCKER=(); P_PID=(); P_STATUS=(); P_RESTARTS=(); P_UPTIME=()
P_CWD=(); P_NODE=(); P_PORTS=(); P_MEM=(); P_APP=()

while IFS=$'\t' read -r name pid status restarts up cwd node mem; do
	[[ -n $name ]] || continue
	[[ $pid =~ ^[0-9]+$ ]] || pid=0
	[[ $restarts =~ ^[0-9]+$ ]] || restarts=0
	[[ $mem =~ ^[0-9]+$ ]] || mem=0
	uptime=''
	[[ $status == online && $up =~ ^[0-9]+$ && $up -gt 0 ]] && uptime=$(( (NOW_MS - up) / 1000 ))
	[[ -n $node && $node != v* ]] && node="v$node"
	ports=''
	[[ $pid -gt 0 ]] && ports=$(ports_of "$pid")
	P_PM2+=("$name"); P_DOCKER+=(''); P_PID+=("$pid"); P_STATUS+=("$status")
	P_RESTARTS+=("$restarts"); P_UPTIME+=("$uptime"); P_CWD+=("$cwd"); P_NODE+=("$node")
	P_PORTS+=("$ports"); P_MEM+=("$(( (mem + 524288) / 1048576 ))")
done < <(pm2_rows)

# a container publishing a port is a process; one that does not (a db, a
# cache) is not a web process and stays out. no pm2 counters, so null
while IFS=$'\t' read -r name ports cwd status; do
	[[ -n $name ]] || continue
	pub=$(grep -oE ':[0-9]+->' <<<"$ports" | tr -d ':>-' | sort -n -u | tr '\n' ' ')
	[[ -n $pub ]] || continue
	st=stopped; [[ $status == Up* ]] && st=online
	P_PM2+=(''); P_DOCKER+=("$name"); P_PID+=(0); P_STATUS+=("$st")
	P_RESTARTS+=(''); P_UPTIME+=(''); P_CWD+=("$cwd"); P_NODE+=('')
	P_PORTS+=("$pub"); P_MEM+=('')
done < <(docker_rows)

# ------------------------------------------------------------------ apps
A_DIR=(); A_NAME=(); A_SITE=()

# the app whose dir holds $1, or -1
app_index() {
	local i
	for i in "${!A_DIR[@]}"; do
		[[ $1 == "${A_DIR[i]}" || $1 == "${A_DIR[i]}"/* ]] && { echo "$i"; return; }
	done
	echo -1
}

is_app() {
	local d=$1 f c
	for f in .git package.json docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do
		[[ -e $d/$f ]] && return 0
	done
	for c in "${P_CWD[@]}"; do
		[[ -n $c && ( $c == "$d" || $c == "$d"/* ) ]] && return 0
	done
	return 1
}

for root in "${ROOTS[@]}"; do
	root=${root%/}
	[[ -d $root ]] || continue
	for d in "$root"/*/; do
		d=${d%/}
		[[ -d $d ]] || continue
		is_app "$d" || continue
		A_DIR+=("$d"); A_NAME+=("${d##*/}"); A_SITE+=(-1)
	done
done

for i in "${!P_CWD[@]}"; do
	P_APP[i]=$(app_index "${P_CWD[i]}")
done

# mono when it is a workspace with apps/, next when a next config is there,
# node for any other package.json, other for the rest. the words the app
# maps onto a site form's shape buttons
app_kind() {
	local d=$1
	if [[ -d $d/apps ]] && { [[ -e $d/turbo.json || -e $d/pnpm-workspace.yaml ]] || grep -qs '"workspaces"' "$d/package.json"; }; then
		echo mono
	elif [[ -e $d/next.config.js || -e $d/next.config.mjs || -e $d/next.config.ts ]]; then
		echo next
	elif [[ -e $d/package.json ]]; then
		echo node
	else
		echo other
	fi
}

# the lockfile says which one; the install and build actions use it
app_pm() {
	local d=$1
	if [[ -e $d/pnpm-lock.yaml ]]; then echo pnpm
	elif [[ -e $d/bun.lock || -e $d/bun.lockb ]]; then echo bun
	elif [[ -e $d/yarn.lock ]]; then echo yarn
	elif [[ -e $d/package-lock.json ]]; then echo npm
	elif [[ -e $d/package.json ]]; then
		grep -oE '"packageManager"[[:space:]]*:[[:space:]]*"[a-z]+' "$d/package.json" 2>/dev/null | grep -oE '[a-z]+$'
	fi
}

# pm2's own file: restarting it restarts everything the app declares
app_eco() {
	local d=$1 f
	for f in ecosystem.config.js ecosystem.config.cjs ecosystem.config.mjs ecosystem.json; do
		[[ -e $d/$f ]] && { echo "$f"; return; }
	done
}

app_git() {
	local d=$1 remote branch head committed subject repo r
	if [[ ! -e $d/.git ]] || ! has git; then printf 'null'; return; fi
	remote=$(git -C "$d" remote get-url origin 2>/dev/null)
	branch=$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null)
	IFS=$'\t' read -r head committed subject < <(git -C "$d" log -1 --format=$'%h\t%cI\t%s' 2>/dev/null)
	repo=''
	r=${remote%/}; r=${r%.git}
	[[ $r =~ ([^/:]+/[^/:]+)$ ]] && repo=${BASH_REMATCH[1]}
	printf '{"remote":%s,"repo":%s,"branch":%s,"head":%s,"committed":%s,"subject":%s}' \
		"$(jopt "$remote")" "$(jopt "$repo")" "$(jopt "$branch")" "$(jopt "$head")" "$(jopt "$committed")" "$(jopt "$subject")"
}

# names only, relative to the app; examples and backups are not env files
app_env() {
	local d=$1 f out=()
	for f in "$d"/.env "$d"/.env.* "$d"/apps/*/.env "$d"/apps/*/.env.*; do
		[[ -f $f ]] || continue
		case $f in *.example|*.sample|*.bak) continue ;; esac
		out+=("${f#"$d"/}")
	done
	[[ ${#out[@]} -gt 0 ]] && mapfile -t out < <(printf '%s\n' "${out[@]}" | sort)
	jstrs "${out[@]}"
}

# only the connection target: everything before the last @ is the
# credentials and is dropped without being looked at
app_db() {
	local d=$1 f line v engine target host port name
	for f in .env apps/api/.env .env.production apps/api/.env.production; do
		[[ -f $d/$f ]] || continue
		line=$(grep -m1 -E '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL[[:space:]]*=' "$d/$f" 2>/dev/null) || continue
		v=${line#*=}
		v=${v#"${v%%[![:space:]]*}"}; v=${v%"${v##*[![:space:]]}"}
		v=${v#\"}; v=${v%\"}; v=${v#\'}; v=${v%\'}
		[[ $v == *://* ]] || break
		engine=${v%%://*}; engine=${engine/postgresql/postgres}
		target=${v#*://}; target=${target##*@}
		host=''; port=''; name=''
		if [[ $target =~ ^([^:/?]+)(:([0-9]+))?(/([^?]*))? ]]; then
			host=${BASH_REMATCH[1]}; port=${BASH_REMATCH[3]}; name=${BASH_REMATCH[5]}
		fi
		printf '{"engine":%s,"host":%s,"port":%s,"name":%s}' \
			"$(jopt "$engine")" "$(jopt "$host")" "$(jnum "$port")" "$(jopt "$name")"
		return
	done
	printf 'null'
}

# ----------------------------------------------------------------- nginx
# per enabled site: D domain, U location port, A alias path, S when tls
site_facts() {
	awk '
		BEGIN { loc = "/" }
		{ sub(/#.*/, ""); gsub(/^[ \t]+|[ \t]+$/, ""); if ($0 == "") next }
		$1 == "server_name" {
			for (i = 2; i <= NF; i++) { n = $i; sub(/;$/, "", n); if (n != "" && n != "_" && !seen[n]++) print "D " n }
		}
		$1 == "location" { loc = $NF; if (loc == "{") loc = $(NF - 1); if (NF < 2) loc = "/" }
		$1 == "proxy_pass" {
			if (match($0, /(127\.0\.0\.1|localhost):[0-9]+/)) {
				p = substr($0, RSTART, RLENGTH); sub(/.*:/, "", p)
				if (!(loc in up)) { up[loc] = 1; print "U " loc " " p }
			}
		}
		$1 == "alias" { a = $0; sub(/^alias[ \t]+/, "", a); sub(/;$/, "", a); print "A " a }
		$1 == "ssl_certificate" || ($1 == "listen" && $0 ~ /(^|[ :])443([ ;]|$)/) { print "S" }
	' "$1"
}

S_FILE=(); S_DOMAINS=(); S_SSL=(); S_UPS=(); S_ALIASES=(); S_APP=()

if [[ -d $SITES_ENABLED ]]; then
	for f in "$SITES_ENABLED"/*; do
		[[ -f $f ]] || continue
		name=${f##*/}
		[[ $name == default ]] && continue
		domains=(); ups=(); aliases=(); ssl=false
		while read -r kind rest; do
			case $kind in
				D) domains+=("$rest") ;;
				U) ups+=("$rest") ;;
				A) aliases+=("$rest") ;;
				S) ssl=true ;;
			esac
		done < <(site_facts "$f")
		# the apex stands for its www. twin
		keep=()
		for n in "${domains[@]}"; do [[ $n == www.* ]] || keep+=("$n"); done
		[[ ${#keep[@]} -gt 0 ]] || keep=("${domains[@]}")
		S_FILE+=("$name"); S_DOMAINS+=("${keep[*]}"); S_SSL+=("$ssl")
		S_UPS+=("$(printf '%s\n' "${ups[@]}")")
		S_ALIASES+=("$(printf '%s\n' "${aliases[@]}")")
		S_APP+=(-1)
	done
fi

# the app one of whose processes listens on $1, or -1
app_of_port() {
	local j p
	for j in "${!P_PORTS[@]}"; do
		for p in ${P_PORTS[j]}; do
			[[ $p == "$1" && ${P_APP[j]} -ge 0 ]] && { echo "${P_APP[j]}"; return; }
		done
	done
	echo -1
}

# a site belongs to the app an alias points into, else to the app behind
# an upstream port, else to the app named like the file (hyphens aside)
for i in "${!S_FILE[@]}"; do
	app=-1
	while IFS= read -r a; do
		[[ -n $a ]] || continue
		app=$(app_index "$a")
		[[ $app -ge 0 ]] && break
	done <<<"${S_ALIASES[i]}"
	if [[ $app -lt 0 ]]; then
		while read -r loc port; do
			[[ -n $port ]] || continue
			app=$(app_of_port "$port")
			[[ $app -ge 0 ]] && break
		done <<<"${S_UPS[i]}"
	fi
	if [[ $app -lt 0 ]]; then
		key=${S_FILE[i]//-/}
		for j in "${!A_NAME[@]}"; do
			[[ ${A_NAME[j]//-/} == "$key" ]] && { app=$j; break; }
		done
	fi
	S_APP[i]=$app
	[[ $app -ge 0 ]] || continue
	# the site named after the app is its site; otherwise the first found
	if [[ ${A_SITE[app]} -lt 0 || ${S_FILE[i]//-/} == "${A_NAME[app]//-/}" ]]; then
		A_SITE[app]=$i
	fi
done

# ------------------------------------------------------------------- out
# web_port is the upstream at /, api_port the first other location that
# proxies to a different port
site_json() {
	local i=$1 loc port web='' api='' ups='' a aliases=() doms=()
	while read -r loc port; do
		[[ -n $port ]] || continue
		ups+="${ups:+,}{\"location\":$(jstr "$loc"),\"port\":$port}"
		[[ $loc == / ]] && web=${web:-$port}
	done <<<"${S_UPS[i]}"
	while read -r loc port; do
		[[ -n $port && $loc != / && $port != "$web" ]] && { api=$port; break; }
	done <<<"${S_UPS[i]}"
	while IFS= read -r a; do [[ -n $a ]] && aliases+=("$a"); done <<<"${S_ALIASES[i]}"
	read -r -a doms <<<"${S_DOMAINS[i]}"
	printf '{"file":%s,"domains":%s,"ssl":%s,"upstreams":[%s],"aliases":%s,"web_port":%s,"api_port":%s}' \
		"$(jstr "${S_FILE[i]}")" "$(jstrs "${doms[@]}")" "${S_SSL[i]}" "$ups" "$(jstrs "${aliases[@]}")" "$(jnum "$web")" "$(jnum "$api")"
}

process_json() {
	local i=$1 pid=${P_PID[i]} ports=()
	read -r -a ports <<<"${P_PORTS[i]}"
	[[ $pid -gt 0 ]] || pid=''
	printf '{"pm2":%s,"docker":%s,"pid":%s,"status":%s,"restarts":%s,"uptime":%s,"cwd":%s,"node":%s,"ports":%s,"memory_mb":%s}' \
		"$(jopt "${P_PM2[i]}")" "$(jopt "${P_DOCKER[i]}")" "$(jnum "$pid")" "$(jopt "${P_STATUS[i]}")" \
		"$(jnum "${P_RESTARTS[i]}")" "$(jnum "${P_UPTIME[i]}")" "$(jopt "${P_CWD[i]}")" "$(jopt "${P_NODE[i]}")" \
		"$(jnums "${ports[@]}")" "$(jnum "${P_MEM[i]}")"
}

app_json() {
	local i=$1 d=${A_DIR[i]} procs='' j site=null
	for j in "${!P_APP[@]}"; do
		[[ ${P_APP[j]} == "$i" ]] && procs+="${procs:+,}$(process_json "$j")"
	done
	[[ ${A_SITE[i]} -ge 0 ]] && site=$(site_json "${A_SITE[i]}")
	printf '{"name":%s,"dir":%s,"kind":%s,"processes":[%s],"site":%s,"git":%s,"env_files":%s,"database":%s,"pm":%s,"ecosystem":%s}' \
		"$(jstr "${A_NAME[i]}")" "$(jstr "$d")" "$(jstr "$(app_kind "$d")")" "$procs" "$site" \
		"$(app_git "$d")" "$(app_env "$d")" "$(app_db "$d")" "$(jopt "$(app_pm "$d")")" "$(jopt "$(app_eco "$d")")"
}

host_json() {
	local up='' l1 l2 l3 load=() disk online=0 i
	[[ -r /proc/uptime ]] && { read -r up _ < /proc/uptime; up=${up%%.*}; }
	[[ -r /proc/loadavg ]] && { read -r l1 l2 l3 _ < /proc/loadavg; load=("$l1" "$l2" "$l3"); }
	disk=$(df -kP / 2>/dev/null | awk 'NR == 2 { printf "{\"total_gb\":%.1f,\"free_gb\":%.1f}", $2 / 976562.5, $4 / 976562.5 }')
	[[ -n $disk ]] || disk=null
	for i in "${!P_STATUS[@]}"; do [[ ${P_STATUS[i]} == online ]] && online=$((online + 1)); done
	printf '{"hostname":%s,"uptime":%s,"load":%s,"disk":%s,"pm2_total":%s,"pm2_online":%s,"nginx_sites":%s}' \
		"$(jopt "$(uname -n 2>/dev/null)")" "$(jnum "$up")" "$(jnums "${load[@]}")" "$disk" \
		"${#P_STATUS[@]}" "$online" "${#S_FILE[@]}"
}

apps=''
for i in "${!A_DIR[@]}"; do apps+="${apps:+,}$(app_json "$i")"; done
orphans=''
for i in "${!P_APP[@]}"; do [[ ${P_APP[i]} -lt 0 ]] && orphans+="${orphans:+,}$(process_json "$i")"; done
osites=''
for i in "${!S_FILE[@]}"; do [[ ${S_APP[i]} -lt 0 ]] && osites+="${osites:+,}$(site_json "$i")"; done

doc="{\"schema\":1,\"generated\":$(jstr "$(date +%Y-%m-%dT%H:%M:%S%z)"),\"host\":$(host_json),\"apps\":[$apps],\"orphan_processes\":[$orphans],\"orphan_sites\":[$osites]}"

if $PRETTY && has jq; then
	jq . <<<"$doc"
elif $PRETTY && has python3; then
	python3 -m json.tool <<<"$doc"
else
	printf '%s\n' "$doc"
fi
