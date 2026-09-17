# 35 — Groups Are Labels (post-plan)

**Branch:** `35.github-groups` — `git checkout 35.github-groups` gives you this chapter's finished app; `git diff 34.github-clone 35.github-groups` is exactly what this chapter adds.

**Starting from:** chapter 34 — a GitHub group in the table that finds, opens, clones and adds. 381 repositories in one flat list, the newest twenty on top, the rest a search away.

**Goal:** named groups inside the GitHub rows — *work*, *clients*, *old* — each a collapsible heading in the user's order, a repo in as many as it likes, a group that survives a refresh, and a repo that vanished from GitHub still visible in its group as *gone*.

> **Hold on to:**
> 1. **A label, not a folder.** A repo can carry several groups; deleting a group touches no repo; an emptied group stays. Every rule in the chapter follows from that one word.
> 2. **Pure functions, tested as data.** `assign`, `unassign`, `rename`, `delete`, `reorder` take the list and return the list; the store and the command only persist what they return.
> 3. **One door, whole-list answers.** One command, one tagged enum, and the reply is always the entire list — the frontend never predicts what the store did.
> 4. **Sections without a query, a flat list with one.** A search that respected group boundaries would hide the thing you typed for.
>
> Rust: `#[serde(tag = "op", rename_all = "snake_case")]` on an enum of struct variants — the tagged union a TypeScript discriminated union deserialises into; `Option::is_none_or`; `Vec::retain`; `eq_ignore_ascii_case`. TypeScript: a discriminated union type (`GroupEdit`) mirroring the Rust enum field for field; `Set<string>` in state; a `<datalist>` under an input; `flatMap` to flatten sections into the row order the keyboard walks.

> A group is the obvious thing — a named set inside the list, like the workspaces are for disk projects — and the design question underneath it is the only one that matters: **is a group a folder or a label?** A folder would mean a repo lives in exactly one, and grouping it would move it. A label means a repo can carry several, deleting a group touches nothing, and the list can show the same repo under *clients* and under *old*. Labels are what people mean when they say "group my repos".

---

## 35.1 — Assign and unassign

`services/groups.rs`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GithubGroup {
    pub name: String,
    #[serde(default)]
    pub repos: Vec<String>,
}
```

Keyed by `full_name`, so a repository that vanishes from GitHub stays in its group — never silently dropped by a refresh. `valid_name` trims, refuses empty (*A group needs a name*) and refuses a case-insensitive duplicate (*There is already a group called work*), with an `except` for a rename to itself:

```rust
    let clash = groups.iter().any(|g| {
        g.name.eq_ignore_ascii_case(name)
            && except.is_none_or(|e| !g.name.eq_ignore_ascii_case(e))
    });
```

`assign(groups, group, repo)` finds the group case-insensitively and pushes the repo if it is not there, or creates the group through `valid_name`; `unassign` retains everything but the repo — and **leaves an empty group behind on purpose**: it is the user's, and an empty group is a place to put the next repo. `AppError::GroupRefused(String)`. Three tests: assign creates then is idempotent (and a name in another case finds the same group); a repo in two groups leaves one at a time with the empty group kept; `{"name":"old"}` deserialises with no repos.

> `✅GROUPS: assign and unassign` — **145** tests.

`rename(from, to)` goes through `valid_name` with `Some(from)` as the exception, then errors with *No group called …* when `from` is not there; `delete(name)` is a `retain` — the label only; `reorder(order)` is chapter 31's rule again: the order must be a permutation of what is stored (*The order names 2 groups but 3 are stored. The list changed; refresh and try again*), because honouring it would drop whatever the client did not know about. Three tests.

> `✅GROUPS: rename delete reorder` — **148** tests.

`Preferences.github_groups: Vec<GithubGroup>` under `#[serde(default)]`, with `github_groups()` / `set_github_groups()`.

> `✅PREFS: github groups`

## 35.2 — One command, one enum

```rust
#[derive(serde::Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum GroupEdit {
    Assign { group: String, repo: String },
    Unassign { group: String, repo: String },
    Rename { from: String, to: String },
    Delete { name: String },
    Reorder { order: Vec<String> },
}

// …

#[tauri::command]
pub fn edit_github_groups(
    edit: GroupEdit,
    state: State<AppState>,
) -> Result<Vec<GithubGroup>, AppError> {
    let mut prefs = state.pref_store.lock().map_err(lock_err)?;
    let current = prefs.github_groups();
    let next = match edit {
        GroupEdit::Assign { group, repo } => {
            groups::assign(current, &group, &repo)?
        }
        GroupEdit::Unassign { group, repo } => {
            groups::unassign(current, &group, &repo)
        }
        GroupEdit::Rename { from, to } => groups::rename(current, &from, &to)?,
        GroupEdit::Delete { name } => groups::delete(current, &name),
        GroupEdit::Reorder { order } => groups::reorder(current, &order)?,
    };
    prefs
        .set_github_groups(next.clone())
        .map_err(AppError::Lock)?;
    Ok(next)
}
```

Five edits, one door, and the answer is always **the whole list**. `get_github_groups` reads it. Both registered.

> `✅CMD: edit_github_groups one door` — `cargo check` 0 warnings.

## 35.3 — The rows, in sections

`types.d.ts` gains `GithubGroup`, the `GroupEdit` union (`{ op: 'assign'; group; repo } | …` — the Rust enum field for field), and `LaneSection { group: string | null; rows; gone: Set<string>; total }`. In `github.ts`:

```ts
// the sections with no query: every group in order with all its rows,
// then the ungrouped tail, the newest RECENT_LIMIT of what is in no group.
// with a query, sectioning is off and visibleRepos is the answer
export const laneSections = (
	repos: GithubRepo[],
	groups: GithubGroup[]
): LaneSection[] => {
	const byName = new Map(repos.map(r => [r.full_name, r]));
	const grouped = new Set<string>();
	const sections: LaneSection[] = groups.map(g => {
		const gone = new Set<string>();
		const rows = g.repos.map(full => {
			grouped.add(full);
			const r = byName.get(full);
			if (r) return r;
			gone.add(full);
			return goneRow(full);
		});
		return { group: g.name, rows, gone, total: rows.length };
	});
	const rest = repos.filter(r => !grouped.has(r.full_name));
	sections.push({
		group: null,
		rows: rest.slice(0, RECENT_LIMIT),
		gone: new Set(),
		total: rest.length
	});
	return sections;
};
```

With no query the list is the groups in order, each with all of its rows, then the ungrouped tail — the newest twenty of what is in no group. **A name the cache no longer carries becomes a row anyway** — `goneRow` builds a `GithubRepo` from the name, so every menu and key that works on a row works on it — because a repo you deleted or lost access to is a fact worth a row in the group you curated.

> `✅UI: sections without a query`

`useGithub` loads the groups once (`get_github_groups`) and routes every edit through `editGroups(edit)`, which replaces its copy with what came back — which is why a refused rename leaves the rows exactly as they were and shows the store's own sentence under the box. `folded` is a `Set` in `devgo.githubGroupsFolded`, toggled per name. Then, plain consts:

```ts
	const sections = query.trim() ? null : laneSections(payload?.cache.repos ?? [], groups);
	const visible = sections
		? sections.flatMap(s => (s.group && folded.has(s.group) ? [] : s.rows))
		: visibleRepos(payload?.cache.repos ?? [], query);
```

`visible` is still the flat row order the keyboard walks — with folded groups contributing nothing, exactly as a collapsed workspace contributes nothing to `rows` in chapter 11. `GithubState` grows `sections`, `groups`, `editGroups`, `folded`, `toggleGroup`.

> `✅HOOK: groups through one command`

**The headings.** In the table a group heading is one more row in the four-column grid, indented like the repo rows (`ml-6`), with the arrow and the name in the first column and the count in the last; the rows under it step in once more (`RepoRowProps.nested` → `ml-12`). The tail's heading — *Not in a group*, muted, no arrow — appears only when there is at least one group. A `gone` row is dimmed, shows the word in the danger tone with the fix in its title, and has no time to show. An empty group says *Empty. Right-click a repo and choose Add to group.* The footer counts the tail: *20 most recently updated of 348 not in a group. Type to search all of them.* One `rowFor(repo, nested, gone)` renders a row in both the flat list and the sections, so the element is never repeated. `onGroupContextMenu` threads through `ProjectTree`.

> `✅UI: group headings in the github rows`

## 35.4 — Four doors, one new component

`NameDialog` — a hint line, a box, a `primary` Button, an error line — is the shape every "give it a name" moment shares: `Enter` submits, the store's own refusal is the message, unedited. `NameDialogProps` in `types.d.ts`.

> `✅UI: name dialog`

`ClonePicker` grows `mode: 'clone' | 'group'` rather than a second picker: the list, the search and the checkboxes were the whole component and the footer was the only thing that differed. In group mode every row is a candidate (a clone that is here can be grouped as well as one that is not — `local` still shows as a word), the footer is a text input with a `<datalist>` of the groups that exist, and the button reads *Add N repos to group*. `onGroup` is awaited, and its error lands under the list.

> `✅UI: picker in group mode`

**App.** Four doors:

- **A row's menu → *Add to group…*** (its hint lists the groups the repo is already in) opens a second `ContextMenu` at the same spot: one entry per group, `✓` when the repo is in it — click to leave — then *New group…*, which opens `NameDialog` (*A name for the group. user/blog goes in it.*) and assigns on submit.
- **A heading's menu**: *Rename…*, *Move up* / *Move down* (disabled at the ends; a `reorder` with the name spliced), *Delete group work* in the danger tone — **no confirm**, because a label is not a file, and the toast says *Its repos are untouched*, which is the undo hint.
- **The `+` menu and the palette**: *Group repos…* opens the picker in group mode.

`groupEdit` wraps `github.editGroups` with a toast and rethrows, so a menu entry shows the sentence and a dialog keeps it under the box. `GroupHeaderMenu` and the `NamePrompt` union (`{ kind: 'new'; repos } | { kind: 'rename'; from }`) in `types.d.ts`.

> `✅UI: groups wired into app` — `bun run build` clean.

**FIX.** The first live *New group…* read *user/blog go in it* — the plural was hard-wired. The hint now says *goes* for one repo and *N repos go* for more.

> `✅FIX: new group hint reads goes for one repo`

## 35.5 — Verify

```powershell
cd src-tauri
cargo test
cd ..
```

`cargo test` reports **148** — chapter 34's 142 plus six for groups. Back up the six files. Nothing here opens a browser.

**Real data.** `bun tauri dev` with two groups already in `prefs.json` (written by hand, or by an earlier run): the table shows them without being told: `▼ FREQUENT 8`, `▼ SERVER 1`, `Not in a group 373` — 31 rows.

**A row's menu.** Right-click `blog` → *Add to group…* → `FREQUENT`, `SERVER`, *New group…* → the dialog reads *A name for the group. user/blog goes in it.* Type `work`, `Enter`: `▼ work 1` appears, the tail drops to 372, `prefs.json` has the group.

**The picker.** `+` → *Group repos…*: `shop` → *25 of 382*, *Tick shown* → *25 ticked*, the group box pre-filled with `FREQUENT` and the datalist listing all three; type `work`, *Add 25 repos to group*: toast *25 repos → work*, heading `▼ work 26`, tail 348.

**Rename, and a clash.** Right-click the heading → *Rename…*, *Move up*, *Move down (disabled)* — it is last — *Delete group work*. *Rename…* → `Work apps` → the heading follows. Right-click `SERVER` → *Rename…* → `frequent` → *There is already a group called frequent* under the box; `Escape`.

**Fold.** Click `Work apps`: `▶`, `devgo.githubGroupsFolded` = `["Work apps"]`, the rows drop from 57 to 31; `End` lands on `wiki`, the tail's last row, never on a folded one. Click again: 57.

**Order and gone.** *Move up* → `FREQUENT, Work apps, SERVER`. Through the command, assign `user/not-there-any-more` to `Work apps`; reload: `▼ Work apps 27` and a dimmed row `user | not-there-any-more | GitHub | gone` whose title reads *Not in your GitHub list any more. Remove it from the group, or refresh*. Its menu → *Add to group…* (hint `Work apps`) → `✓ Work apps` → click: 26 again.

**Delete.** Heading → *Delete group Work apps*: toast *Deleted group Work apps. Its repos are untouched*; `FREQUENT 8, SERVER 1, Not in a group 373` — `prefs.json` is back to the two groups it started with.

**Search is flat.** `shop-api` in the box: no headings, two rows.

Remove `devgo.githubGroupsFolded` from `localStorage`, `Ctrl+Q`, restore the six files.

> `✅STAGE: 35 github-groups`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/groups.rs  GithubGroup; valid_name, assign, unassign, rename, delete, reorder; 6 tests
  src/services/preferences.rs  github_groups
  src/commands.rs, lib.rs GroupEdit (tagged enum); get_github_groups, edit_github_groups
  src/error.rs            GroupRefused
src/
  github.ts               goneRow, laneSections
  hooks/useGithub.ts      groups, editGroups, folded, toggleGroup, sections; visible flattened
  components/GithubLane.tsx   headings in the grid, nested rows, gone, empty line, tail footer; rowFor
  components/NameDialog.tsx   a box, a button, an error line
  components/ClonePicker.tsx  mode: 'group', datalist, Add N repos to group
  components/ProjectTree.tsx  onGroupContextMenu passed through
  App.tsx                 groupMenu, groupHeaderMenu, namePrompt, groupPicker; Add to group…; palette
  types.d.ts              GithubGroup, GroupEdit, LaneSection, NameDialogProps, GroupHeaderMenu,
                          NamePrompt; GithubState, RepoRowProps, GithubLaneProps, ClonePickerProps grown
```

Named groups in the GitHub rows: collapsible headings in your order, a repo in as many as you like, edits through one command that answers with the whole list, and a *gone* row for anything GitHub no longer has.

> **The thread running through this chapter.** One word — *label* — decided everything: several groups per repo, delete touches nothing, empty groups stay, a vanished repo stays as *gone*. The mechanics are chapter 31's (a permutation-only reorder), chapter 30's (the picker with a flag), chapter 22's (`serde(default)`), and one new component that is a box and a button.
