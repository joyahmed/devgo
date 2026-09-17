# 51 — One Click for a New nginx Site (post-plan)

**Branch:** `51.server-forms` — `git checkout 51.server-forms` gives you this chapter's finished app; `git diff 50.server-apps 51.server-forms` is exactly what this chapter adds.

**Starting from:** chapter 50 — the server declares its actions and DevGo types them. *New nginx site…* was a `pretype` with `<app> <domain> <port>` for the user to fill by hand.

**Goal:** the holes become a form. A *form* is a fifth kind of action the server can declare — fields, a command template, a preview argument — and DevGo draws it in a drawer, shows the exact line it composes as you type, and sends it through chapter 50's door. Nothing about nginx is hardcoded in DevGo; the JSON says everything.

> **Hold on to:**
> 1. **The rule for `{flags}`.** A bool says its word whenever it is on (`arg`) or off (`arg_off`); a typed value says its `arg` only when it differs from its `default`. So a plain Next.js site composes to `sudo ~/scripts/new-site.sh shop shop.example.com 3025` — no `--type next` — while a regenerate form that opens with *Overwrite* on still sends `--force`.
> 2. **A value is a word.** DevGo never quotes for the remote shell: chapter 50's `send-keys` line single-quotes the whole command once, and a space or a quote in a value would split it or break out of it. `[A-Za-z0-9._@/:+=-]`, refused before anything is composed, naming the field.
> 3. **The line on screen is the line that is sent.** `compose_server_action` and `run_server_action` share one `compose` + `fill`; the drawer calls the first on every keystroke and the second on the click.
>
> Rust: `#[serde(rename = "type")]` on a field named `kind`; `HashMap<String, String>` through a Tauri command; `..new_site()` struct update in a test. TypeScript: a `useEffect` with a `live` flag so a slow answer never overwrites a newer one; one `control(f, v, mine)` that renders a choice, a bool or a box.

> The ask: *"how about i be able to make nginx configurations for new sites with one click with devgo?"* → *"and it won't make devgo heavy right?"*

**Shape of the chapter.** The drawer's buttons are the one `Button` — `target` with `aria-current` for a choice (mono, uppercase) and for the On/Off pair, `secondary` for Cancel and Preview, `primary` for the submit word — never a hand-styled `<button>`; the fields are one `visible.map` with a `control` helper. The `ActionFormRequest` state and the drawer sit beside the root-prompt drawer; `fireAction` decides form-or-run in one place for the two menus and the palette. The live box declares **three** forms (schema 2): *New site…*, *Add record…* (DNS), *Regenerate site…* — the chapter verifies against them.

---

## 51.1 — The contract

`ActionKind::Form`; `Field { name, label, type → kind (default text), required, default, options, prefill, when, arg, arg_off, hint }`; `Action` gains `fields`, `preview`, `submit` (`RawAction` too); `placeholders` gains `{site_type}` — `mono → turbo`, `node → node`, else `next`, the words on the Shape buttons that `new-site.sh` accepts. `compose(action, values, preview)`: the user's value else the default; a field whose `when` (`type=turbo`) does not hold is skipped, requirement included; a required empty → *App name is required*; not a word → *App name: letters, digits and . _ @ / : + = - only, no spaces or quotes*; a `number` that is not a port → *Port must be a port number (1-65535)*; a `choice` off the list → *Shape must be one of next / nest / node / turbo*; `{field}` substituted, `{flags}` joined, the preview word appended when asked, the double space an empty `{flags}` leaves collapsed. Three tests: the rule (next omitted, `--force` on a defaults-on bool, a turbo with `--no-www --dry-run`, a nest with `--force`), the refusals by name, and `site_type` with a regen line that leaves `{dir}` for `fill`.

> `✅SERVERS: a form the server declares, composed as words`

## 51.2 — Compose before the click

`run_server_action` gains `values` and `preview`: a `composed(a)` closure runs `compose` for a `Form` (`ActionRefused` with the message) and hands the command through for the rest; a form then goes exactly the `Run` way — Enter pressed, the window, the attach. `compose_server_action(id, action_id, app_dir, values, preview) -> Result<String, String>`: the same lookup, `compose` + `fill`, nothing sent — the error *is* the validation message.

> `✅CMD: compose before the click` — `cargo test` **185**, `cargo check` 0 warnings.

## 51.3 — Types, data, the drawer

`ServerActionKind` gains `'form'`; `ServerActionField`; `ServerAction` gains `fields`, `preview`, `submit`; `ActionFormRequest`, `ActionFormProps`. `serverApps.ts`: `site_type` in the mirror, `prefillValues(action, app)` (each field's `prefill` placeholder filled from the app, else its default), `whenHolds`. `ActionForm.tsx`: `values` from `initial`; the effect re-composes over `compose_server_action` on every change (a `live` flag drops a stale answer); `visible` = the fields whose `when` holds; the field the error names gets the message under it and a danger border, an error naming no field goes in the line box; *The line, exactly as it will be typed*; the preview sentence; *Cancel · Preview · ‹submit›*, the last two disabled while the line does not compose.

> `✅TYPES: form fields` · `✅DATA: prefill and when` · `✅UI: the form drawer`

## 51.4 — The door

`App`: `actionForm` state, `fireAction(s, a, appDir, app?)` — a `form` opens the drawer with `prefillValues`, anything else runs — used by the server menu, the app menu and the palette; the hint reads `form`; `runServerAction` passes `values` and `preview`; the drawer titled with the label minus its `…`. Help gains a paragraph.

> `✅UI: a form opens its drawer` · `✅UI: help says forms`

## 51.5 — Verify

`cargo test` **185**, `cargo check` 0 warnings, `tsc -b`, contrast and `bun run build` clean. Fifteen app-data files backed up by hash (the existing cache `.bak`ed again by the first launch, restored after). WSL running, left alone.

**The forms the box declares.** After ↻: `new-site` (*New site…*, nine fields incl. `dns:bool` and `api_port:number?type=turbo`, preview `--dry-run`, submit *Create site*), `dns-add` (*Add record…*, four fields), `nginx-regen` (*Regenerate site…*, every field with a `prefill`: `{name} {domain} {web_port} {site_type} {api_port}`).

**New site.** The server menu reads *New site… SUDO · FORM*; the drawer *New site*: *App name \* · Domain \* · Port \* · Shape · Create the DNS record first (GoDaddy) · Add www. · HTTPS via certbot · Overwrite an existing config*, `NEXT` current, the bools at their defaults (`Off · On · On · Off`), focus in *App name*, the line box `…` with *App name is required* under the field, *Preview* and *Create site* disabled. Typed `demo51` / `demo51.example.com` / `3099` → the line **`sudo ~/scripts/new-site.sh demo51 demo51.example.com 3099`**, both buttons enabled. `TURBO` → *API port is required* appears (a fourth input), the line unchanged; `3100`, then *Add www.* Off → **`… 3099 --type turbo --api-port 3100 --no-www`**. Appended `; rm` to the app name → *App name: letters, digits and . _ @ / : + = - only, no spaces or quotes* under a red box, the buttons disabled; back to `demo51`.

**Preview.** Within eight seconds an `ssh` and an `OpenConsole`; on the box `1:new-site*` (active) with `sudo ~/scripts/new-site.sh demo51 demo51.example.com 3099 --type turbo --api-port 3100 --no-www --dry-run` typed and **`[sudo] password for user:`** waiting — nothing created. The drawer had closed. The `ssh` stopped, the window killed, `0:bash` left.

**Regenerate on `shop`.** The app menu reads *Regenerate site… SUDO · FORM*; the drawer opened prefilled — `shop · shop.example.com · 3008 · TURBO · 3009`, the bools `On · On · On` — and composed **`sudo ~/scripts/new-site.sh shop shop.example.com 3008 --path /var/www/shop --type turbo --api-port 3009 --force`**: `{dir}` filled by the app, `--force` from the defaults-on bool. Escape closed it; not sent.

`Ctrl+Q`, the localStorage sets reset, all fifteen files restored and hash-matched, the installed DevGo restarted.

> `✅STAGE: 51 server-forms`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/server_apps.rs    ActionKind::Form; Field; fields/preview/submit; site_type; is_word; compose (+ 3 tests)
  src/commands.rs, lib.rs        run_server_action(values, preview); compose_server_action
src/
  types.d.ts                     'form'; ServerActionField; ActionFormRequest / ActionFormProps
  serverApps.ts                  site_type; prefillValues; whenHolds
  components/ActionForm.tsx      the drawer: fields, the composed line, Preview and the submit word
  App.tsx                        actionForm; fireAction; the drawer
  components/HelpPanel.tsx       the paragraph
```

A form kind the server declares — fields, a template, a preview word, nothing about nginx in DevGo — with the line on screen before the click, composed by the Rust that sends it, and values that are words so the unquoted remote line stays honest.

> **The thread running through this chapter.** The drawer never composes anything itself. It asks Rust on every keystroke and shows the answer, and it sends the same values to the same Rust on the click — one `compose`, one `fill`, one truth. The one place an earlier draft went wrong (a defaults-on bool swallowed by the differs-from-default rule) is the one place the rule is written down twice: in the comment and in the test.
