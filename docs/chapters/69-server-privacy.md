# 69 — The Row Is Its Name

**Branch:** `69.server-privacy` — `git checkout 69.server-privacy` gives you this chapter's finished app; `git diff ce3b7ba 69.server-privacy` is exactly what this chapter adds.

**Starting from:** `main` after the fix pass and the Mac's clone commit (`ce3b7ba`). Written from the public work itself.

**Goal:** a server row stops printing where it reaches. The ask, 2026-09-16: *"we are showing critical server information in the ui… user name ip address and port… we have to put toggle or something… or menu."* Since 47/48 the row's first column read `user@host` and the meta cell `:port` — on screen for anyone looking over a shoulder, and in every future screenshot. Now the row is its name; `user@host` and the port come back behind one preference, off by default, flipped from Settings › Servers, from the row's menu, from the lane heading's menu, or from the palette. Same chapter, one more thing noticed the same evening: *"remove button has no opacity"* — the red button was the one solid block on a see-through window.

## Also since 68

The straight-on-main commits between `1710276` (68) and this branch — the *branch = it gets a chapter* rule: a subtle change goes on `main` with no number, and the next chapter lists it.

- `d4b31cb ✅UI: no manage door in the footer` — the `Manage…` ghost button and its `onManageTargets` prop are gone from `StatusBar.tsx`, `App.tsx`, `types.d.ts`; Settings › Editors & Terminals and the palette's `Settings: Editors & Terminals` are the two doors that remain.
- `71ac39c ✅FIX: remove sheet stays centred while sliding` — the top sheet's `slide-down` keyframes carried `translate(-50%, …)` while Tailwind 4's `-translate-x-1/2` is the `translate` property; the two composed and the sheet sat at −100 % for the whole slide. The keyframes now move `translateY` only.
- `6fc9cc8 ✅WINDOW: the mac is see-through too` — the Mac's: `macos-private-api` in `Cargo.toml`, `macOSPrivateApi: true` in `tauri.conf.json`, and the one `transparent(...)` call in `lib.rs` for both platforms.
- `ceb07d0 ✅FIX: a failed folder drill closes and says why` — `useServers.toggleDir` swallowed a failed `list_server_dir`; the hook takes `onError`, App passes the toast, and the failed key leaves `openDirs`.
- `3f4365b ✅DOCS: readme without history for now` — the five-line History section pulled; to be written by hand.
- `ce3b7ba ✅CLONE: hand the mac clone gh's credential` — the Mac's: an https clone passes `-c credential.https://github.com.helper=!gh auth git-credential` under `#[cfg(not(windows))]`, so a headless clone does not die asking for a username.

> **Hold on to:**
> 1. **A flag with four doors and one home.** Settings, the row menu, the heading menu and the palette all flip `show_server_details`; none of them owns it. Rust stores it, `set_` hands back what it stored, and every door reads the same word from one hook. Two switches that each kept their own copy would disagree by the second click.
> 2. **Search sees what the row hides.** The query still matches `host` and `user` — typing an IP finds the row — because a filter is a question, not a display. What the row prints and what it answers to are two different lists.
> 3. **A derived colour is derived everywhere.** 67 mixed six `--solid-bg-*` with `--ground-alpha` into `--color-bg-*`; the red fill was a raw `bg-danger`, so the knob missed it. A colour that should follow the knob is a seventh line in that block, not a special case on the button.

> Rust: a `bool` field with `#[serde(default)]` is `false` for every `prefs.json` written before it existed — the privacy default and the upgrade default are the same word, which is what makes this field safe to add without a `.bak`.

---

## 69.0 — Fixtures name nobody's box

First on the branch, before the feature. The public tests and comments still carried real infrastructure: the inventory JSON in `server_apps.rs` (a hostname, `/var/www/erp`, two live domains, a runner name, a tunnel alias), the `Server` fixture in `servers.rs` and `server_folders.rs` (a real IP), `clone.rs` and `groups.rs` (the name of a repo that is not public), `ssh_config.rs` (the same IP twice). One grep was the gate:

```
grep -rn -i -E "<alias>|<ip>|<lan-ip>|<domain>|<domain>|/var/www/(<root>|<root>)" src src-tauri/src README.md
```

— the box's alias, its two addresses, its two domains and its two web roots, one `-i -E` alternation (the real words are not repeated here). **106 hits before, 0 after** (the identifier `app.zetta.devgo` stays: it is the install identity, and it is excluded from the count). The words that replaced them: `box` / `lanbox` / `box-db` for the machines, `203.0.113.7` (a documentation address, RFC 5737) for the IP, `shop` / `blog` / `wiki` with `.example.com` for the apps and their domains, `joyahmed/notes` and `joyahmed/cloud` for the repos, `acme` / `Acme` / `ACME` in `groups.rs` so the case-insensitivity test still tests something. The tests are unchanged in meaning: **202 pass, as before.**

The README named a repository that is not public as the inventory script's home; it now says *a script at `~/scripts/devgo-inventory.sh`*, and the Help panel and the lane's *No inventory on this box* tooltip say the same.

> `✅TEST: fixtures name nobody's box`

## 69.1 — The preference

`preferences.rs`, the last field of `Preferences`:

```rust
    /// Whether a server row prints user@host and the port. Off, the
    /// default, the lane shows the name only: a screenshot of the window
    /// is not a list of where you ssh. `serde(default)`, as above.
    #[serde(default)]
    pub show_server_details: bool,
```

A getter and a setter beside `window_transparency`'s:

```rust
    pub fn show_server_details(&self) -> bool {
        self.prefs.show_server_details
    }

    pub fn set_show_server_details(&mut self, on: bool) -> Result<(), String> {
        self.prefs.show_server_details = on;
        self.save()
    }
```

`commands.rs`: `get_show_server_details` reads it; `set_show_server_details(on)` stores it and **returns the stored value** — the `set_window_transparency` shape, so the caller shows what the file says, never what it asked for. Both registered in `lib.rs` after `set_github_live_search`.

> `✅PREFS: show server details flag`

The test writes a `prefs.json` that predates the field (`{"window_transparency":30}`), asserts the default is off, flips it, reopens the store, and asserts both the flag and the untouched transparency:

```rust
    #[test]
    fn server_details_are_hidden_until_asked() {
        // …
        let mut s = PreferencesStore::new(dir.clone()).unwrap();
        assert!(!s.show_server_details(), "the name only, by default");
        s.set_show_server_details(true).unwrap();

        let again = PreferencesStore::new(dir).unwrap();
        assert!(again.show_server_details());
        assert_eq!(again.window_transparency(), 30, "the rest untouched");
    }
```

> `✅TEST: server details hidden until asked` — **203**.

## 69.2 — The hook

`src/hooks/useServerDetails.ts`, small: one `useState(false)`, one `invoke('get_show_server_details')` on mount, and `setShowDetails(on)` that invokes the setter and stores **what came back**. `useServers` calls it and returns `showDetails` / `setShowDetails` on `ServersState` (`types.d.ts`), so every component that already holds `servers` has the flag — no new prop threads through `ProjectTree`.

> `✅UI: server details hook`

## 69.3 — The row is its name

`ServersLane.tsx`. `whoAt` stays (it is the text when the switch is on); the row prints it only then:

```tsx
{showDetails && (
	<span className='font-mono text-13 text-text-muted truncate max-w-[18rem]'>
		{whoAt(server)}
	</span>
)}
```

`metaWords(s, details)` shows the `:port` word only when `details` is on; `tunnel` and `tmux` stay, they say how, not where. The tooltip follows the same rule — `rowTitle(s, details)`: `ssh <alias>` when the row has one (the alias is the row's identity, like its name), `ssh user@host` when the switch is on, and otherwise *Open a terminal on <name>*. The dot's tooltip already said `Reached … · n folders` and the inventory's pm2/sites/load line — no host in it. `ServerRowProps.showDetails` is the one new prop, and the lane passes `servers.showDetails` into the row's spread.

**What stays on purpose.** The alias (`box`) — it is a name, not an address. An app row's domain and its upstream ports (`shop.example.com`, `3008/3009`) — a website's domain is public by nature, and the port is nginx's upstream, not the ssh port; the ask was *user name, ip address and port* of the box. And search: `visible` still matches `server.host` and `server.user`, so typing the box's IP into the Servers box finds the row — the row does not print it back.

> `✅UI: server rows show the name only`

The palette's `Server: open <name>` subtitle read `ssh user@host` for a row without an alias; it now says `ssh <alias>`, or `ssh user@host` only when the switch is on, or *over ssh*. `s.host` stays in its `keywords`.

> `✅UI: palette keeps the host quiet`

## 69.4 — Settings › Servers

Under the machines and their two doors, a third block in `ServersPanel`, the `HINT_MODES` pair (Show / Hide) every other switch on the page uses:

```tsx
<h4 className={heading}>Show connection details in the lane</h4>
<p className='text-13 text-text-muted mb-2'>
	Off, a server row is its name. On, the row also prints user@host
	and the port, as the row menu's <em>Show connection details</em>{' '}
	does.
</p>
```

`aria-current` marks the one that matches `servers.showDetails`; a click is `attempt(servers.setShowDetails(m.value))`.

> `✅SETTINGS: connection details switch`

The machines list above it printed the ssh line under each name — `ssh user@host -p port` for a row with no alias. `serverLine(s, details)` now prints `ssh <alias>`, or the host line only when the switch is on, or `ssh by host`; the default path still follows.

> `✅SETTINGS: the machines list follows the switch`

## 69.5 — The menus

`App.tsx`. One list, built once, spread into two menus:

```tsx
const detailsEntries: MenuEntry[] = [
	{ heading: 'Lane' },
	{
		label: servers.showDetails
			? 'Hide connection details'
			: 'Show connection details',
		onClick: () =>
			servers
				.setShowDetails(!servers.showDetails)
				.catch(e => toast(showError(e)))
	},
	'separator'
];
```

`buildServerMenu` starts with `...detailsEntries` — the first entry, under its own small heading (52's `MenuHeading`), before *Open terminal*. The entry's label flips with the flag, so the menu reads the state back.

> `✅UI: connection details on the server menu`

The lane heading had no menu. `LaneHeadingProps.onContextMenu?: (x, y) => void` — `LaneHeading` takes the right-click on its whole line and hands over the point; `ServersLane` passes `onHeadingContextMenu`; `ProjectTree` threads `onServersHeadingContextMenu`; App keeps `serversHeadingMenu` beside `serversAddMenu` and renders a `ContextMenu` with `[...detailsEntries, ...serversAddItems]` — the switch, then *Add a server…* and *Import from ~/.ssh/config*. The GitHub and workspace headings do not pass the prop and are unchanged.

> `✅UI: the servers heading has a menu`

The palette: `servers.details`, titled `Servers: show connection details` / `Servers: hide connection details` by the flag, subtitle *user@host and the port on every row, or the name alone*, keywords `ssh server host port privacy details`. No key combo, so no row in `SHORTCUTS`; palette ids are strings.

> `✅UI: palette toggles connection details`

## 69.6 — The remove button follows the knob

67's `index.css` derives six surfaces: `--solid-bg-*` (set by `applyTheme`) mixed with `--ground-alpha` into `--color-bg-*`, so every `bg-bg-*` utility follows the transparency slider. The `danger` `Button` variant was `bg-danger` — the ink token, solid by design (it is text and an edge too) — so the Remove button in the workspace header, the remove sheets and the row menus stayed a hard red block on a see-through window.

A seventh pair. `@theme` mints the utility:

```css
--color-danger-bg: #fb7185;
```

and `:root` derives it like the six (two excerpts, thirty lines apart — the solid beside the other `--solid-bg-*`, the mix after `--color-bg-raised`):

```css
--solid-danger-bg: #fb7185;
/* … */
--color-danger-bg: color-mix(
	in srgb,
	var(--solid-danger-bg) calc(var(--ground-alpha) * 100%),
	transparent
);
```

`applyTheme` sets `--solid-danger-bg` from the palette's `danger` after the loop (no new theme key: the red is the same hex, only its fill is derived). The variant is `bg-danger-bg text-white hover:not-disabled:bg-danger-bg/80` — the `/80` composes on the derived value the way `bg-bg-hover/50` already does. `border-danger` and `text-danger` stay solid. The contrast gate reads `danger-bg` out of `@theme` as one more token; no rule names it, and white on the red was never a rule (2.9:1), so the gate stays at `6 palettes x 8 rules`.

> `✅UI: the remove button follows the knob`

## 69.7 — Verify

`cargo test` **203** (202 + `server_details_are_hidden_until_asked`; 62's probe ignored), `cargo check` 0 warnings, `cargo fmt --check` clean, `tsc -b` and `bun run build` clean (`contrast ok: 6 palettes x 8 rules, 5 lane hues`). One dev launch over CDP on 9223, a real `servers.json` (two rows, both aliased, one with a port), 2560×1392; the fourteen app-data files backed up by hash first, the installed DevGo stopped, WSL left alone.

- **Details hidden (the default, nothing in `prefs.json`):** every text node and every `title` in the Servers card read — **196 texts, 164 titles, 0** matching `\S@\S`, an IPv4, or `:<port>`. The two server rows are `▼ | lanbox | tmux | ↻` and `▼ | box | tmux | ↻`; their tooltips `ssh lanbox` and `ssh box`. Over the whole document: no IPv4, no `:9999`, no `user@` in text or titles.
- **Search:** `box` in the Servers box → both rows (`2 machines`); the box's IP typed in → the `box` row alone, and the IP appears nowhere on the page outside the box.
- **Settings › Servers:** the switch reads `Show · Hide*`; its line *Off, a server row is its name. On, the row also prints user@host and the port…*. *Show* → `Show* Hide`; Escape; the rows read `▼ | lanbox | lanbox | tmux | ↻` (its host is its hostname, no user) and `▼ | box | user@host | :port | tmux | ↻` — user, host and port exactly as before 69. `prefs.json`: `"show_server_details": true`, `"window_transparency": 30` untouched.
- **The row menu** on `box`: `Lane · Hide connection details · — · Open terminal Enter · List folders & apps · …`. Click → rows back to the name, the menu closed, `prefs.json` `false`; reopen → `Lane · Show connection details`.
- **The heading menu** (right-click on `SERVERS`): `Lane · Show connection details · — · Add a server… · Import from ~/.ssh/config`.
- **The palette:** `connection details` → one row, `Servers: show connection details | user@host and the port on every row, or the name alone`; Enter → details on, `prefs.json` `true`; reopened, the row reads `Servers: hide connection details`.
- **A relaunch keeps it:** `location.reload()` with the flag on → the rows come back with `user@host` and `:port` (the hook reads the store on mount).
- **The tunnel row:** `~/.ssh/config` imported through the palette (four rows for the run: the two, `box-db` and `homebox`); with details hidden, `▶ | box-db | tunnel | tmux | ↻`; its menu keeps *Copy tunnel command* with the hint `ssh -N box-db` — no `LocalForward` line anywhere.
- **The knob, at 30 % on a window born see-through** (`window_launched_transparent` true, `--ground-alpha 0.7`): the Remove sheet's `Remove` button computes `color(srgb 0.984 0.443 0.522 / 0.7)` — the red at **0.7**, the same alpha as the sheet (`bg-bg-secondary`, `… / 0.7`) and the lane heading; the lane card itself is `bg-bg-secondary/50` and reads `0.35` = 0.7 × ½, as designed. Cancel; nothing removed.
- Toggled back off through the palette before the stop; `servers.json` and `prefs.json` restored by hash after — **14 OK, 0 mismatches**, `window_transparency` 30, `show_server_details` absent as before.

> `✅STAGE: 69 server-privacy`; fetch, rebase onto the Mac's `ce3b7ba`, re-gate on Windows (203, 0 warnings), ff-merge; push `main` + branch.

---

## What you built

```
src-tauri/src/services/server_apps.rs        fixtures: shop, blog, box, example.com
src-tauri/src/services/servers.rs            fixture: box, 203.0.113.7
src-tauri/src/services/server_folders.rs     the same
src-tauri/src/services/clone.rs              joyahmed/notes
src-tauri/src/services/groups.rs             acme / Acme / ACME
src-tauri/src/services/ssh_config.rs         lanbox, box, box-db
src-tauri/src/services/preferences.rs        show_server_details + getter/setter + 1 test
src-tauri/src/commands.rs                    get_/set_show_server_details
src-tauri/src/lib.rs                         the registration
src/types.d.ts                               ServersState, ServerRowProps, LaneHeadingProps, ServersLaneProps, ProjectTreeProps
src/hooks/useServerDetails.ts                the flag, read on mount, set through rust
src/hooks/useServers.ts                      carries it
src/components/ServersLane.tsx               the name only; rowTitle; metaWords(details); the heading's right-click
src/components/LaneHeading.tsx               onContextMenu
src/components/ProjectTree.tsx               threads it
src/components/Settings.tsx                  the switch; serverLine(details)
src/components/HelpPanel.tsx                 no repo name for the script
src/components/ServerForm.tsx                placeholders box / 203.0.113.7
src/App.tsx                                  detailsEntries on two menus, the heading menu, the palette entry, the subtitle
src/index.css                                --solid-danger-bg → --color-danger-bg
src/themes.ts                                applyTheme sets the solid red
src/components/Button.tsx                    danger fills with bg-danger-bg
README.md                                    the inventory script, no repo name
```

- **A server row is its name.** `user@host` and the port live behind one preference, off by default, and nothing on the lane, in a tooltip, in the palette or in Settings prints them until it is on.
- **Four doors, one flag** — Settings › Servers, the row menu, the lane heading's new menu, the palette — all reading the value Rust stored back.
- **Search still finds by host** — the filter answers to what the row hides.
- **The red follows the knob** — the danger fill is the seventh derived surface, and the Remove button is as see-through as the sheet it sits on.
- **The fixtures name nobody's box** — 106 real-infrastructure hits to 0, same 202 tests.
