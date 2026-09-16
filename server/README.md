# Teach a server to describe itself

DevGo's Servers lane lists a machine's folders over one `ssh`. When the box also carries two small files, the same call brings back its **apps** (what runs where, on which port, behind which domain) and the **actions** the box offers for them (your own shell lines, one click each). Nothing in DevGo knows what a pm2 process or an nginx site is; the box says, and the app draws it.

This folder is the contract, with a working copy of each side:

| File | What it is |
|---|---|
| `devgo-inventory.sh` | a bash script that prints the inventory JSON for a typical Linux box: pm2 and docker processes, nginx sites, git, the lockfile |
| `devgo-actions.example.json` | an actions file to copy and edit: server actions, app actions with placeholders, one local action, one form |
| `site-new.sh` | the script the example form calls: writes, enables and reloads one nginx site, with `--dry-run` |

## What the app runs

Expand a server row (or press ↻) and DevGo runs exactly one remote command, `ssh <alias>` with `BatchMode=yes`, `ConnectTimeout=5` and `StrictHostKeyChecking=accept-new`:

```
echo ~; ls -d ~/*/ ~/projects/*/ /var/www/*/ /srv/*/ 2>/dev/null; echo __DEVGO_INVENTORY__; ~/scripts/devgo-inventory.sh 2>/dev/null; echo __DEVGO_ACTIONS__; cat ~/scripts/devgo-actions.json 2>/dev/null || cat /var/www/server/scripts/devgo-actions.json 2>/dev/null
```

The folder globs are the row's roots (the four defaults, or what you pinned). Then two marks split the output into three parts: the listing, the inventory, the actions. A part that is empty means *this box has no such file* and the row simply shows folders. A part that is there but is not JSON is an error the row's tooltip shows, so a typo in the actions file is visible, not silent.

So the two files live in **`~/scripts/`** of the user you ssh in as: `~/scripts/devgo-inventory.sh` (executable; any language, as long as it prints the JSON below on stdout) and `~/scripts/devgo-actions.json`. The actions file has one fallback, `/var/www/server/scripts/devgo-actions.json`, for a box that keeps its scripts in a checkout there.

Nothing runs on launch, on focus, or on a timer. One `ssh`, on your click.

### Install

```sh
scp server/devgo-inventory.sh server/site-new.sh <alias>:~/scripts/
scp server/devgo-actions.example.json <alias>:~/scripts/devgo-actions.json
ssh <alias> 'chmod +x ~/scripts/devgo-inventory.sh ~/scripts/site-new.sh'
```

Then ↻ on the row. `ssh <alias> '~/scripts/devgo-inventory.sh --pretty'` shows what the app will read.

## The inventory

`devgo-inventory.sh` prints one JSON document. It runs as your user, needs no root, and needs only bash 4, coreutils and awk; pm2 (read through `jq` or `python3`), `docker`, `ss`, `git` and nginx's `sites-enabled` are each used when present and skipped when not. It never prints a value out of an env file: a `DATABASE_URL` yields the engine, host, port and database name, and everything before the last `@` is dropped unread.

Roots are `/var/www` and `/srv` (`DEVGO_ROOTS="/opt/apps:/var/www"` to change them). A folder right under a root is an app when it has `.git`, `package.json`, a compose file, or a process whose working directory is inside it.

Every field is optional on the app's side (`serde(default)`): a document with only `{"apps":[{"name":"x","dir":"/var/www/x"}]}` loads. `null` means *not known*, never zero, and a key the app does not know is ignored, so the box may run ahead of the app.

```jsonc
{
  "schema": 1,
  "generated": "2026-09-16T18:00:52+0000",
  "host": {
    "hostname": "box",
    "uptime": 950933,            // seconds, or null
    "load": [0.03, 0.07, 0.08],  // the three load averages, or []
    "disk": { "total_gb": 206.9, "free_gb": 153.3 },   // or null
    "pm2_total": 23,             // processes listed, containers included
    "pm2_online": 23,
    "nginx_sites": 22
  },
  "apps": [
    {
      "name": "shop",            // required
      "dir": "/var/www/shop",    // required; joins the folder row
      "kind": "mono",            // mono | next | node | other
      "processes": [
        {
          "pm2": "shop-web",     // the pm2 name, or null for a container
          "docker": null,        // the container name, or null
          "pid": 1234,           // or null
          "status": "online",    // pm2's word, or online | stopped for a container
          "restarts": 3,         // null when not known (a container)
          "uptime": 86400,       // seconds, or null
          "cwd": "/var/www/shop/apps/web",
          "node": "v20.19.6",    // or null
          "ports": [3008],       // what the process tree listens on
          "memory_mb": 120       // or null
        }
      ],
      "site": {                  // or null when no nginx site fronts it
        "file": "shop",          // the name in sites-enabled
        "domains": ["shop.example.com"],   // server_name, www. twins dropped
        "ssl": true,             // listen 443 or ssl_certificate seen
        "upstreams": [{ "location": "/", "port": 3008 }, { "location": "/api", "port": 3009 }],
        "aliases": ["/var/www/shop/apps/web/.next/static/"],
        "web_port": 3008,        // the upstream at /
        "api_port": 3009         // the first other location on another port, or null
      },
      "git": {                   // or null when there is no .git
        "remote": "git@github.com:acme/shop.git",
        "repo": "acme/shop",     // the last two path segments of the remote
        "branch": "main",
        "head": "abc1234",
        "committed": "2026-09-01T10:00:00+00:00",
        "subject": "deploy"
      },
      "env_files": [".env", "apps/api/.env"],   // names only, relative to dir
      "database": { "engine": "postgres", "host": "127.0.0.1", "port": 5432, "name": "shop" },  // or null
      "pm": "pnpm",              // from the lockfile: pnpm | bun | yarn | npm, or null
      "ecosystem": "ecosystem.config.js"        // pm2's file when the app has one, or null
    }
  ],
  "orphan_processes": [],        // processes whose cwd is under no app; same shape
  "orphan_sites": []             // sites no app claims; same shape
}
```

How the app reads it:

- **The row.** An app's first domain, a dot and its ports sit in the folder row's file-system column. The dot is green when every process is `online`, amber when one is not, hollow when nothing runs. The row's tooltip lists the processes with their restarts, the site with `https` when `ssl`, and the deployed commit.
- **The server's tooltip** reads `pm2_online/pm2_total pm2 · nginx_sites sites · load[0] · free_gb GB free`.
- **Placeholders** for the actions come from the app: see the table below. A process whose pm2 name or cwd ends in `web` or `frontend` is `{pm2_web}`, one ending in `api` or `backend` is `{pm2_api}`; with no such names the first process is the web and the second the api.
- **Kind** maps onto a site form's shape word: `mono` → `turbo`, `node` → `node`, anything else → `next` (`{site_type}`).
- A site belongs to the app an alias points into, else to the app behind an upstream port, else to the app named like the file (hyphens aside). When several sites front one app, the one named after the app wins.

You can write your own inventory in any language. `name` and `dir` per app are the only required keys; everything else defaults.

## The actions

`devgo-actions.json` declares two lists: `server`, shown on the server row's menu, and `app`, shown on every folder row that the inventory knows as an app. Right-click the row, or select it and open the palette.

```jsonc
{
  "schema": 2,
  "scripts_dir": "~/scripts",     // informational
  "server": [ { …action } ],
  "app":    [ { …action } ]
}
```

An action:

| Key | Meaning |
|---|---|
| `id` | unique in its list; names the tmux window the line is typed into |
| `label` | the menu entry; placeholders work here too (`Logs · {pm2_web}`) |
| `kind` | `run` types the line and presses Enter · `pretype` leaves it on the prompt for you to finish · `url` opens the browser (`https://` only) · `local` runs the line on this PC · `form` composes the line from fields, then goes the `run` way |
| `command` | the line, with placeholders; for `url` the address |
| `root` | `true` when the line begins with `sudo` — a hint DevGo shows beside the label. sudo asks for the password in the window on the box; DevGo never holds it |
| `group` | the heading drawn over the entry; groups appear in the order they are first declared, entries clustered under them |
| `fields`, `preview`, `submit` | forms only, below |

A `kind` this build does not know is dropped on read, never an error, so a newer file works with an older DevGo.

### Placeholders

Filled on the app rows from the inventory entry of that folder. An action whose placeholder is `null` for a row (in its command *or* its label) is hidden on that row rather than shown broken; a word the contract does not define is left as it is.

| Placeholder | From |
|---|---|
| `{dir}` `{name}` | `app.dir`, `app.name` |
| `{pm2}` `{pm2_web}` | the web process's pm2 name (`{pm2}` is the same word) |
| `{pm2_api}` | the api process's pm2 name |
| `{site}` | `site.file` |
| `{domain}` | `site.domains[0]` |
| `{web_port}` `{api_port}` | `site.web_port`, `site.api_port` |
| `{db}` | `database.name` |
| `{repo}` | `git.repo` |
| `{pm}` | `app.pm` |
| `{eco}` | `app.ecosystem` |
| `{site_type}` | `kind` as a shape word: `turbo` · `node` · `next` |

Server actions have no app, so they take no placeholders (a form's own `{field}` names aside).

### Forms

A `form` action opens a drawer instead of running. Each field:

| Key | Meaning |
|---|---|
| `name` | the `{name}` the command uses; also the key `when` refers to |
| `label`, `hint` | what the drawer shows |
| `type` | `text` (default) · `number` (a port, 1–65535) · `choice` (buttons from `options`) · `bool` (on/off) |
| `required` | refused empty, naming the label |
| `default` | the value the drawer opens with |
| `options` | for `choice` |
| `prefill` | a placeholder filled from the app row when the form is on an app (`"{web_port}"`) |
| `when` | `other=value`, or `other` for a bool; the field exists only while it holds, requirement included |
| `arg`, `arg_off` | what the field contributes to `{flags}` (`--type {value}`) |

The command is composed as: every `{field}` replaced by its value, then `{flags}` by the rule — **a bool always says its word**, `arg` when on and `arg_off` when off, default or not; **a typed value says its `arg` only when it differs from its `default`**. So `--type next` is not sent when `next` is the default, but a form that opens with *Overwrite* on still sends `--force`. *Preview* appends the `preview` word (`--dry-run`) and runs that; the `submit` word is on the other button. The drawer shows the exact line as you type; the line shown is the line sent.

**Values are words**: `[A-Za-z0-9._@/:+=-]` only, no spaces, no quotes. DevGo never quotes for the remote shell (the whole line is single-quoted once for `send-keys`), so anything else is refused by field name before anything is composed.

### The example form

*New site…* in the example calls `sudo ~/scripts/site-new.sh {name} {domain} {port} {flags}` with the fields `name`, `domain`, `port`, `type` (`proxy` · `static`), `api_port` (only while `type=proxy`), `www`, `tls`, `force`. `site-new.sh` is in this folder:

```
sudo site-new.sh <name> <domain> <port> [--type proxy|static] [--api-port N] [--root DIR]
                 [--no-www] [--tls] [--email ADDR] [--force] [--dry-run]
```

It writes `/etc/nginx/sites-available/<name>` (a `server` block on port 80: `server_name` with the www. twin, `location /` proxied to `127.0.0.1:<port>` or a `root` with `try_files` for a static site, `/api` to the api port when given), links it into `sites-enabled` (an existing file stops it unless `--force`, and then a backup is kept), runs `nginx -t` — a failed test takes the file back out before anything reloads — then reloads nginx. `--tls` runs `certbot --nginx` for the names when certbot is on PATH and says so when it is not. `--dry-run` prints the config and every command and changes nothing; it is what *Preview* sends. Everything else needs root, and the script says so instead of failing half way.

Replace it with your own script and keep the field names, or change both.

## How an action runs

A `run`, `pretype` or composed `form` line is never put on the terminal's command line (`cmd` eats `&&` and `|`, `wt` splits on `;`). DevGo sends one direct `ssh` whose single argument is:

```
tmux new-session -d -s <session> 2>/dev/null; tmux new-window -t <session> -n <id>; tmux send-keys -t <session>:<id> '<line>' Enter
```

(`<session>` is the row's session name, `devgo` by default; `Enter` is left off for `pretype`.) Then the row's ordinary terminal opens and attaches, landing on that window. The output stays in the window; DevGo reads none of it. With **tmux on the box** off for the row there is no window to type into: the line goes to your clipboard and a plain terminal opens for you to paste it.

- `url` opens `https://…` in your browser; anything else is refused.
- `local` runs the line on this PC through your default terminal's run template, which `cmd` parses first — so the line must be plain: `& | < > ^ ( ) ; % "` are refused by name. `ssh -N box-db` (a tunnel from an `~/.ssh/config` alias) is the shape it is for.

## Security notes

- The inventory is **read-only**: it reads `/proc`, `ss`, `pm2 jlist`, `docker ps`, `git` and nginx's files, and prints names, ports and paths. It runs as your user. No value from any env file is ever printed.
- The actions are **your own shell lines**, on a box you already hold a key for. DevGo adds nothing to them, runs nothing without a click, and a form shows its exact line before you press the button.
- `sudo` is typed into the tmux window on the box and asks there. DevGo never sees or stores the password; `root: true` only marks the entry.
- The one `ssh` per refresh happens on your click; there is no polling.
- Keep `devgo-actions.json` readable only by you (`chmod 600`): whoever can edit it decides what a click runs.
