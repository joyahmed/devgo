# 73 — Teach a Server to Describe Itself

**Branch:** `73.server-contract` — `git checkout 73.server-contract` gives you this chapter's finished tree; `git diff c6686ab 73.server-contract` is exactly what this chapter adds.

**Starting from:** `main` after 72 and the release series (`c6686ab`). Written from the public work itself. **No app code changes**: the chapter is docs, two scripts and a JSON file — the *server side* of a contract the app has read since 50.

**Goal:** until now the Servers lane's apps and actions worked on exactly one machine, because the two files the app reads over ssh (`~/scripts/devgo-inventory.sh`, `~/scripts/devgo-actions.json`) lived on one machine. The README said *when the box carries a script at…* and nobody else had one. This chapter ships a generic pair anyone can `scp` to a box, the script the example form calls, and the schema written down key by key, so the app's third lane is usable by a stranger. The live files keep their shape and lose their content: no names, no domains, no ports, nobody's scripts.

## Also since 72

The straight-on-main commits between `4f77efa` (72) and this branch — the *branch = it gets a chapter* rule.

- `4aa9ffa ✅UI: the footer stays on the server under a folder row` — `selectFolder` calls `onServerCursor` with the folder's server, so browsing a server's folders keeps its hosts in the footer (72.6's afterthought).
- `3626d7c ✅SCRIPTS: the screenshot shooter` — `scripts/shoot.ps1 -Out <png> [-Knob n] [-Wait s]` and `bun scripts/cdp.mjs eval|file|click|rclick|dbl|key|type|shot|metrics`; the *How to retake* paragraph in `docs/screenshots/README.md`.
- `3beaa9b ✅DOCS: screenshots, the server footer` — `01-four-lanes.png` and `02-app-actions.png` retaken with the 72 footer in frame; the Mac pair replaced.
- `06b6d39 ✅DOCS: mit licence` — `LICENSE` (MIT), the README's Licence section, the About panel's *Licence* section replacing the *repository carries none* comment.
- `95b4163 ✅DOCS: a social preview image` — `docs/screenshots/social-preview.png`, 1280×640, for the repository's Social preview setting.
- `e85afa6 ✅RELEASE: v1.0.0` — `package.json`, `Cargo.toml`, `Cargo.lock`, `tauri.conf.json` to 1.0.0; the tag `v1.0.0` on it, the Actions draft with the `.exe` and the `.dmg`.
- `c6686ab ✅DOCS: installer sizes` — 3 MB and 3.7 MB written into the README's Install section from the real assets.

> **Hold on to:**
> 1. **The contract is the box's, in the box's language.** DevGo parses JSON; what produces it is not the app's business. The public inventory is bash + coreutils + awk because that is what every Linux box has, and everything else (`pm2` through `jq` or `python3`, `docker`, `ss`, `git`, nginx's files) is *used when present, skipped when not* — a missing tool must never cut the document short. No `set -e`, no `set -u`, on purpose and said so at the top.
> 2. **Generalise the shape, not the content.** The two live files were read once, read-only; every key, every `null` rule and the marks survived, and every name, domain, port and script of the live box's did not. Where the live script had a house convention (`/backend/api/` is the api), the public one has a rule (the first other location on another port). Where the live actions called a site script of the box's own, the public example calls a script that ships beside it, so the README never promises a file that is not there.
> 3. **Validate on the real box without writing to it.** The cheapest honest test of an inventory script is its output on a live server: `scp` to `/tmp`, run, diff the keys and types against the file that already works there, `rm`. Nothing under `~`, nothing under `/etc`, no `sudo`; a site script is only ever run with `--dry-run` there.

---

## 73.1 — The inventory script

`server/devgo-inventory.sh`, ~420 lines of bash, one JSON document on stdout, `--pretty` through `jq` or `python3` when there. Roots `/var/www` and `/srv` (`DEVGO_ROOTS="/opt/apps:/var/www"`), a folder right under a root is an app when it has `.git`, `package.json`, a compose file, or a process whose cwd is inside it.

- **JSON by hand**: `jstr` (backslash, quote, newline, CR, tab escaped through `${s//…}`), `jopt` (a string or `null`), `jnum` (a number or `null`), `jstrs`/`jnums` for arrays. Every value the app reads as `Option` is `null` when not known, never `0` or `""`.
- **Processes**: `ps -eo pid=,ppid=` once, `subtree(pid)` in awk (the listener is usually a child or grandchild of the pid pm2 knows), `ss -lntpH` into a `pid<TAB>port` table, `ports_of(pid)` joins the two. `pm2 jlist` is read through `jq -r … @tsv` or, without jq, a nine-line python3 — the one place a JSON parser is needed; without either, the apps still list with no processes. `node` from `pm2_env.node_version` (prefixed `v`), `memory_mb` rounded, `uptime` in seconds only while `online`. Docker containers from `docker ps --format` with the compose `working_dir` label: a container publishing a port is a process (`docker` set, `pm2 null`, the counters `null` — 57's rule), one that does not (a db, a cache) is not.
- **Apps**: `app_index(path)` (dir or `dir/…`), `is_app`, `app_kind` (`mono` for `apps/` + `turbo.json`/`pnpm-workspace.yaml`/`"workspaces"`, `next`, `node`, `other` — the four words the app maps onto a form's shape buttons), `app_pm` from the lockfile (`pnpm-lock.yaml` · `bun.lock`/`bun.lockb` · `yarn.lock` · `package-lock.json`, else `packageManager` in package.json, else `null` — **not** the live script's default of `pnpm`: no lockfile means not known, and the install/build entries hide), `app_eco`, `app_git` (remote, `repo` = the last two path segments, branch, `%h %cI %s`), `app_env` (names only, examples and backups out, sorted), `app_db` (the `DATABASE_URL` line, everything before the last `@` dropped unread, then engine/host/port/name by one bash regex).
- **Sites**: one awk over each `sites-enabled` file emits `D domain`, `U location port`, `A alias`, `S` — `server_name` deduplicated, `location`'s last word before `{`, `proxy_pass` to `127.0.0.1`/`localhost` once per location, `alias` paths, `ssl_certificate` or `listen … 443`. A site joins an app by an alias inside it, else by an upstream port one of its processes listens on, else by the file name with hyphens dropped; **when several sites front one app, the one named after the app wins** (the live script let the last one win, which gave one app its old domain). `web_port` is the upstream at `/`, `api_port` the first other location on another port.
- **Host**: `/proc/uptime`, `/proc/loadavg`, `df -kP /` in decimal GB, the pm2 counts (containers included, as the live script counts), the site count. `orphan_processes` and `orphan_sites` in the same shapes.

> `✅SERVER: the inventory script`

## 73.2 — The example actions

`server/devgo-actions.example.json`, schema 2, an `about` line (unknown keys are ignored by serde, so the file may explain itself). Server: *Inventory (JSON)* (`--pretty | less`), *Disk usage*, *pm2 list*, *nginx -t* (`root`), *Tail nginx error log* (`root`), and the form *New site…*. App: *Shell in {dir}*, *Logs · {pm2_web}* / *{pm2_api}*, *Status · …*, *Restart via {eco}*, *Install ({pm})*, *Build ({pm})*, *What is deployed*, *Pull* (`pretype`), *Open github.com/{repo}* (`url`), *Site config · {domain}* (`sudo less …/{site}`), *Tail access log · {domain}*, *Open https://{domain}*, *Env files present*, *psql · {db}* (`pretype`, no user), *DB tunnel from this PC* (`local`, `ssh -N box-db`). Groups in the order the menu draws them: Box · pm2 · nginx on the server, App · Git · nginx · Config · Database on an app. Every placeholder in the file is one the contract defines (checked by a regex over the whole document: `db dir domain eco flags name pm pm2_api pm2_web port repo site value`).

The form: `sudo ~/scripts/site-new.sh {name} {domain} {port} {flags}`, `preview: --dry-run`, `submit: Create site`; fields `name`, `domain`, `port` (number), `type` (`proxy` · `static`, default `proxy`, `--type {value}`), `api_port` (number, `when: type=proxy`, not required, `--api-port {value}`), `www` (bool, default on, `arg_off: --no-www`), `tls` (bool, default off, `--tls`), `force` (bool, default off, `--force`). Composed by 51's rule: a plain proxy site is `sudo ~/scripts/site-new.sh shop shop.example.com 3025` — no `--type proxy`, no www flag — and *Preview* appends `--dry-run`.

Generalised away from the live file: the DNS group (a registrar script), the backup and certificate groups (scripts of the box's own), `kind: read` (a kind no build knows — the app drops it), the real zones in a `choice`, the `psql -U` user, the tunnel alias. `id`s never name a script that is not shipped.

> `✅SERVER: example actions`

## 73.3 — A site script the form can call

The rule: *the example form must call a script that EXISTS, or the README promises something that fails at the box.* `server/site-new.sh`, `set -euo pipefail`, plain output:

```
sudo site-new.sh <name> <domain> <port> [--type proxy|static] [--api-port N] [--root DIR]
                 [--no-www] [--tls] [--email ADDR] [--force] [--dry-run]
```

A here-doc `usage`, `die`, an option loop that refuses a flag without its value; `name` as `[A-Za-z0-9._-]+`, a domain with a dot and a TLD, numeric ports, `--type` one of two words. Root is required for everything but `--dry-run`, and the refusal prints the `sudo` line to type. `config()` writes the `server` block on port 80 — `server_name` with the www. twin, `client_max_body_size 20m`, `/api` proxied when `--api-port`, then `location /` proxied with the upgrade headers or `root` + `index` + `try_files` for `static`. `run()` echoes `+ cmd` and runs it unless `--dry-run`, so a dry run *is* the command list: `write`, `ln -sfn` into `sites-enabled`, `nginx -t`, `systemctl reload nginx` (or `nginx -s reload`), and `certbot --nginx --non-interactive --agree-tos --redirect -d …` when `--tls` and certbot is on PATH (a line saying it is not, otherwise). An existing file stops the real run unless `--force`, which keeps a `.bak.<epoch>`; a failed `nginx -t` removes the link and the file and puts the backup back before anything reloads. Notes before the config: nothing listening on the port yet (502 until the app starts), a static root that does not exist yet (404).

Stripped from the shape it was read against: the Turborepo layout, `/_next/static/` aliases, Socket.IO detection, docker-published static, uploads roots, real-ip ranges, the DNS step, the certbot-account preflight, colours.

> `✅SERVER: a site script the form can call`

## 73.4 — The contract, written down

`server/README.md` — *Teach a server to describe itself*:

- **What the app runs**: the exact one-line remote command from `combined_command` with the four default globs, the ssh options (`BatchMode=yes`, `ConnectTimeout=5`, `StrictHostKeyChecking=accept-new`), the two marks and the three parts, empty = no file, non-JSON = an error the row shows; where the files live (`~/scripts/`, the `/var/www/server/scripts/devgo-actions.json` fallback); nothing on launch, focus or a timer. **Install**: two `scp`, one `chmod +x`, ↻.
- **The inventory**: the full document as annotated `jsonc`, every key with its type and its `null` rule, then *how the app reads it* (the row's file-system column, the dot's three states, the tooltip, the server tooltip's line, `{pm2_web}`/`{pm2_api}` by suffix, `kind` → shape word, the site-to-app rule) and the note that any language will do — `name` and `dir` are the only required keys.
- **The actions**: the two lists, the action keys table (`kind` in five words, `root` a hint not a gate, `group` clustering), the dropped-unknown-kind rule, the placeholder table with where each comes from, the fields table, the compose rule in bold (**a bool always says its word; a typed value only when it differs from its default**), *values are words* with the character class and why (one single-quoting for `send-keys`), the example form and `site-new.sh`'s usage.
- **How an action runs**: `typed_command`'s line verbatim with `<session>`/`<id>`, Enter left off for `pretype`, the terminal attaching after, tmux-off → the clipboard, `url` https-only, `local` through the run template with the forbidden characters named.
- **Security notes**: read-only inventory as your user, no env value ever printed; the actions are your own lines on a box you hold a key for, nothing runs without a click, a form shows its line first; `sudo` asks in the window and DevGo never sees it; one ssh per click; `chmod 600` the actions file.

Root `README.md` › Servers: the forms sentence now describes the shipped form (*New site…*, `PROXY · STATIC`), and one paragraph names the three files and points at `server/README.md`. Then a **🗺️ Next** section before Licence: *Set up this box* (the app will carry the `server/` scripts and install them from its menu), *Linux* (the crate builds for it; a tested build once it has been run there), *More server actions* as people ask; *Issues are welcome*.

> `✅DOCS: teach a server to describe itself` · `✅DOCS: readme points at the contract` · `✅DOCS: what comes next`

## 73.5 — CI

`ci.yml` gains one step before `bun install`, `shell: bash`: `bash -n` on the two scripts and `jq empty` on the example — a syntax gate that costs nothing (jq and Git's bash are on `windows-latest`). Then, the change of plan on the pins (*v1.0.0 will be re-tagged on this main, so this is the release series*): every action's `runs.using` read from its `action.yml` at the pinned ref through `gh api repos/<owner>/<repo>/contents/action.yml?ref=<tag>` — `actions/checkout@v4` **node20**; `oven-sh/setup-bun@v2`, `Swatinem/rust-cache@v2`, `tauri-apps/tauri-action@v1` already **node24**; `dtolnay/rust-toolchain@stable` composite. So one bump, `actions/checkout@v4 → v7` (the current major, `v7.0.1`; v5 was the node24 step, v6 moved the credentials file, v7 blocks fork checkouts under `pull_request_target`, none of which this workflow uses), three places across `ci.yml` and `release.yml`.

> `✅CI: syntax gate on the server files` · `✅CI: actions on node 24`

## 73.6 — Verify

- **`bash -n`** on both scripts, the example through python's `json.load` and the box's `jq empty` (no jq on the Windows side); `shellcheck` is on neither machine and was not installed.
- **The inventory on the live box, in `/tmp`**: `scp server/devgo-inventory.sh box:/tmp/devgo-inventory-73.sh && ssh box 'bash /tmp/devgo-inventory-73.sh'` — 2.7 s, exit 0, nothing on stderr, **20 563 bytes**. Against the file that already runs there (`~/scripts/devgo-inventory.sh`, 21 682 bytes): **27 apps vs 26** (ours adds a compose-only folder under `/srv`), **23 processes vs 23**, 1 orphan process each, 0 orphan sites each, 16 sites joined each, 26 git blocks each, 15 databases each; the host block identical to the number (`23/23 pm2 · 22 sites`, the same disk). A key-and-type diff over every object kind — top, host, app, process, site, upstream, git, database — found **every key on both sides with the same types** (`restarts`/`memory_mb`/`pid`/`uptime` `null,num`, `docker` `null,str`, `api_port` `null,num`). Per-app values equal except by design: three apps whose site is the one *named after the app* rather than the last file in alphabetical order, and one app with no lockfile whose `pm` is `null` rather than the live default. `--pretty` indents through jq; `DEVGO_ROOTS=/nonexistent` gives `apps: 0`, every process and site an orphan. **The scratch file removed**; nothing under `~`, `/etc` or `/var` touched.
- **The site script on the live box, `--dry-run` only**: `bash /tmp/site-new-73.sh demo73 demo73.example.com 3099 --dry-run` printed the summary (`site demo73 (proxy)`, `names demo73.example.com www.demo73.example.com`, `port 127.0.0.1:3099`), *nothing listens on 127.0.0.1:3099 yet*, the full `server` block, then `+ write`, `+ ln -sfn …`, `+ nginx -t`, `+ systemctl reload nginx`, *dry run: nothing was written, enabled or reloaded*, exit 0; with `--tls --api-port 3100` the `/api` block and `+ certbot --nginx … -d demo73.example.com -d www.demo73.example.com` (certbot is on that box). `/etc/nginx/sites-available/demo73` does not exist after. Scratch file removed. Locally: the refusals (`port must be a number: abc`, `--type must be proxy or static, not php`, `name must be letters, digits, . _ - only: bad name`, no arguments → usage, exit 2) and the `static --no-www` block.
- **Gates**: `bun run build` clean, `cargo test` **209** (unchanged: no app code). CI run `35132642463` on the pushed `main`: `gate` success, the new step `bash -n server/devgo-inventory.sh` green, and **0 annotations** — the run before it (`c6686ab`, `checkout@v4`) carried one: *Node.js 20 is deprecated … actions/checkout@v4*.
- **Hygiene**: 69's grep, plus the old site script's name and the repository the README used to point at, over `server/`, `README.md` and `.github/` → 0.

> `✅STAGE: 73 server-contract`; fetch (nothing new), ff-merge; push `main` + branch.

## 73.7 — Deferred

- *Set up this box* (the README's Next): the app carrying `server/` and installing it over ssh from the row's menu — the copy this chapter still asks for by hand.
- `pm2 jlist` starts the pm2 daemon when none runs (the live script has the same side effect); a `pm2 pid`-style presence check first would avoid it.
- A Mac or BSD box has no `/proc`: `uptime` and `load` come back `null`/`[]` (the lane prints `load ?`); `sysctl` twins were not typed.
- The site script writes port-80 blocks only and leaves HTTPS to certbot; a box that terminates TLS elsewhere edits the file.

---

## What you built

```
server/devgo-inventory.sh           the inventory: processes (pm2, docker), apps, sites, host, orphans; json by hand
server/devgo-actions.example.json   schema 2: 6 server actions (one form), 17 app actions, one local
server/site-new.sh                  the form's script: proxy | static, /api, www, --tls, --force, --dry-run
server/README.md                    the contract: the ssh line, both schemas, placeholders, forms, how an action runs, security
README.md                           Servers points at server/README.md; the Next section
.github/workflows/ci.yml            bash -n + jq empty; checkout@v7
.github/workflows/release.yml       checkout@v7
```

- **Anyone can teach a box** — three files, two `scp`, one ↻.
- **Every key is written down** — with its type, its `null` rule and what the app does with it.
- **The example form calls a script that ships** — and `--dry-run` is what *Preview* sends.
- **Validated on a real server without writing to it** — the same keys and types as the file that already works there.
