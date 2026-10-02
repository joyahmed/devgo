// THE ROUTE MAP — data, not code.
//
// Adding a screen next month means adding one object to STEPS below and
// nothing else: scripts/walk.mjs knows the verbs, never the screens. If you
// find yourself wanting to edit walk.mjs to add a route, the verb you want is
// missing — add the verb there, the route here.
//
// ─── the vocabulary ─────────────────────────────────────────────────────────
//
// A STEP is { id, name, themes?, open?, assert?, shot?, close?, tags?, why? }.
//
//   id       file-safe, unique. names the screenshot.
//   name     what a human reads in the manifest.
//   themes   'all'   run this step once per theme in THEMES (5 dark themes)
//            'first' run it once, on THEMES[0]          (the default)
//            ['nord','black']  run it on these only
//   open     ACTIONS to get there, in order.
//   assert   ASSERTIONS, all must hold. An empty assert list is illegal:
//            a step that only shoots is a step that proves nothing.
//   shot     'webview' (default) | 'window' | false
//            'webview'  Page.captureScreenshot — the document only, no window
//                       chrome, no wallpaper. Cheap (~60 ms), no desktop
//                       disruption. This is what nearly every step wants.
//            'window'   scripts/shoot.ps1 — the real window over the
//                       wallpaper. ~2.5 s, MINIMISES EVERY OTHER WINDOW and
//                       hides the desktop icons, so it is opt-in per step AND
//                       needs --window-shots on the command line.
//   close    ACTIONS to leave the screen so the next step starts clean.
//   tags     free labels; --only and --skip filter on them.
//   why      one line, for the reader of a failed manifest.
//
// ACTIONS (each is a one-key object):
//   { key: 'Ctrl+Shift+P' }   a real key event, modifiers and all
//   { click: TARGET }         a real left click at the target's centre
//   { rclick: TARGET }        a real right click
//   { dbl: TARGET }           a real double click
//   { type: 'text' }          Input.insertText into whatever has focus
//   { eval: '<js>' }          evaluate, ignore the value
//   { wait: { css } }         until the selector exists   (default 4 s)
//   { wait: { gone } }        until it does not
//   { wait: { text } }        until document.body has the text
//   { wait: { ms } }          a flat pause — use sparingly, prefer the above
//   { theme: 'nord' }         store the theme and reload the document
//   { reload: true }          location.reload() — F5 does NOT reload a Tauri
//                             webview, which is why this is a verb
//
// TARGETS (each is a one-key object):
//   { css: '<selector>' }              the first match
//   { text: 'Close' }                  the first BUTTON whose trimmed text is
//                                      exactly this, else the first that
//                                      contains it
//   { xy: [x, y] }                     absolute, last resort
//   { outside: '<selector>' }          a point on the BACKDROP of that element
//                                      — inside its parent, outside its own
//                                      rect, at least 24 px clear. Fails the
//                                      step if no such point exists. This is
//                                      the verb that catches "the sheet
//                                      swallows an outside click".
//
// ASSERTIONS (each is a one-key object):
//   { css: '<selector>' }              exists
//   { gone: '<selector>' }             does not exist
//   { text: '<string>' }               document.body.innerText contains it
//   { notext: '<string>' }             does not
//   { count: ['<selector>', n] }       exactly n matches
//   { atleast: ['<selector>', n] }     n or more
//   { menu: ['A', 'B'] }               every label is an ENABLED entry of the
//                                      open context menu
//   { menuDisabled: ['A'] }            every label is a DISABLED entry
//   { hints: { 'Open in editor': 'Ctrl+Enter' } }
//                                      the entry carries that hint
//   { js: '<expression>' }             evaluates truthy
//   { sha: true }                      the text on screen contains the sha the
//                                      binary reported about itself — L6,
//                                      checked in the UI and not only in the
//                                      manifest
//
// Every step additionally fails on a console error or an uncaught exception
// raised while it ran, unless the message matches CONSOLE_NOISE below.

// ⚠️ FIVE DARK THEMES AND NO LIGHT ONE. src/themes.ts ships neon, matrix,
// nord, dracula, black — every one of them a dark ground. The lifecycle rule's
// sweep says "both themes" because it was written against a `darkMode ? x : y`
// repo; here the same reasoning gives five appearances per screen, not two,
// and NONE of them is the light half. A contrast bug that only shows on a
// light ground cannot be found by this walk, because this app has no light
// ground to find it on.
export const THEMES = ['neon', 'matrix', 'nord', 'dracula', 'black'];

// The theme is stored under this key and read by main.tsx before the first
// paint, so { theme } stores it and reloads: that walks the real boot path a
// themed install takes, not just applyTheme() on a live document.
export const THEME_STORAGE_KEY = 'devgo.theme';

// Console lines that are not defects. Declared HERE, as data, so that a
// session silencing real noise has to write it down where a reviewer reads it.
// ⛔ Never add a pattern to make a red step green. The manifest records every
// line it ignored.
export const CONSOLE_NOISE = [
	// vite's own dev-server chatter, and React's StrictMode double-invoke notes
	/\[vite\]/i,
	/Download the React DevTools/i,
	// WebView2 emits this for any resource the CSP legitimately refuses
	/^Refused to (load|connect)/i
];

// ─── what the walk must never let through ───────────────────────────────────
//
// DENY BY DEFAULT. Anything not matched here is blocked when the IPC shim is
// armed (--arm-ipc), because the list of commands that DO something is longer
// than the list that only answer, and a new command added next month must
// default to "do not fire during a walk", not to "fire".
//
// So: reads pass, everything else is recorded and answered with a stub. That
// is the whole of the destructive-entry policy — see ARMED_STEPS below.
export const IPC_READ_ONLY = [
	/^get_/,
	/^list_/,
	/^wsl_(config_report|fragmentation)$/,
	/^(search_github|has_ssh|detect_targets|discover_roots|server_commands)$/,
	/^(refresh_projects|refresh_workspace|refresh_github_repos)$/,
	/^(os_transparency_effects_enabled|window_launched_transparent)$/,
	// the app's own logging door and the startup marks: side effects, but the
	// side effect is a line in devgo.log, which is where we want it
	/^(log_ui_line|mark_startup)$/
];

// What a blocked command answers with, so the UI takes its success path and
// the screen the walk is here to look at actually renders. Anything not named
// here gets `null`.
export const IPC_STUBS = {
	get_wsl_path: '/mnt/g/01_tauri/devgo',
	open_editor: null,
	open_terminal: null,
	open_both: null,
	open_agent: null,
	kill_session: null,
	toggle_pin: null,
	run_script: null,
	reveal_in_explorer: null,
	open_remote: null,
	open_url: null
};

// ─── the project row menu, from src/App.projectMenu.test.tsx ────────────────
//
// ⛔ NOT RE-DERIVED. These two inventories are copied from the two `structure()`
// assertions in src/App.projectMenu.test.tsx (the seven-entry case at :414 and
// the thirteen-entry case at :454), which is the file that owns the
// conditions. If they disagree with that file, that file is right.
//
// The walk asserts the SUBSET that this machine's conditions actually produce,
// because the conditions are the owner's real state: a live tmux session, a
// git remote, a pinned row, registered targets. So it asserts the three
// unconditional entries always, and records which of the conditional ten it
// saw. A menu that is missing an unconditional entry fails; a menu missing
// `Kill session` on a project with no session is correct.
export const MENU_ALWAYS = ['Open in editor', 'Open both', 'Run dev script…'];

export const MENU_CONDITIONAL = {
	'Open terminal': 'no live session (mutually exclusive with Reattach terminal)',
	'Reattach terminal': 'a live session and the multiplexer on',
	'Attach here': 'a live session and the multiplexer on',
	'Kill session': 'a live session and the multiplexer on — DESTRUCTIVE',
	'Reveal in Explorer': 'a file manager on this desktop (label is per-desktop)',
	'Copy Windows path': 'always on Windows; reads "Copy path" elsewhere',
	'Copy WSL path': 'Windows only',
	'Open remote': 'the project has a git remote',
	'Pin to top': 'the row is not pinned',
	Unpin: 'the row is pinned'
};

// The hints the shortcut table declares for the entries that always exist.
// From the same test file, :430-437.
export const MENU_HINTS = {
	'Open in editor': 'Ctrl+Enter',
	'Open both': 'Alt+Enter',
	'Run dev script…': 'Ctrl+Shift+D'
};

// ⛔ THE ENTRIES THE WALK NEVER CLICKS, and why each one.
//
// Default policy (no --arm-ipc): the walk asserts the entry is PRESENT, carries
// its declared hint, and is enabled or disabled as its condition says — and
// stops short of the click. Presence + hint + enabled-state is what can be
// proven from the DOM; the wiring from label to backend command is already
// proven, 49 assertions deep, by src/App.projectMenu.test.tsx against invoke's
// call log. Duplicating that here would buy nothing and cost the owner a
// killed tmux session.
//
// Armed policy (--arm-ipc): the shim above is installed first, so the click
// lands, the command is RECORDED, and the backend never hears it. Then the
// walk asserts the recorded command name and payload — the real-app twin of
// what the vitest suite asserts in jsdom. If the shim cannot be installed
// (window.__TAURI_INTERNALS__.invoke not writable), every armed step is
// SKIPPED with that reason. ⛔ It is never fired for real as a fallback.
export const NEVER_CLICK = {
	'Kill session': 'kills a real tmux/psmux session the owner is working in',
	'Open in editor': 'launches a real editor window',
	'Open terminal': 'launches a real terminal',
	'Reattach terminal': 'launches a real terminal',
	'Open both': 'launches both',
	'Attach here': 'opens a real pty in the attach pane',
	'Open remote': 'opens a browser',
	'Reveal in Explorer': 'opens a file manager window',
	'Pin to top': 'writes the owner’s prefs.json',
	Unpin: 'writes the owner’s prefs.json',
	'Run dev script…': 'the picker is safe, the script it runs is not'
};

// ─── the settings panel registry, from src/components/Settings.tsx:1086 ─────
// 13 panels, none of them conditional. The label is what the nav button reads;
// `anchor` is a string that must appear once the panel is open.
//
// ⚠️ four of these used to repeat the label itself (`anchor: 'Workspaces'` on
// the panel labelled Workspaces, and the same for servers/backups/help). The
// nav column ALSO prints the label, so that assertion passed on the nav
// rendering, not on the panel — a panel that failed to mount at all would
// still show its own label in the nav column and the step would stay green.
// Hardened below: each anchor is now a string that exists ONLY inside that
// panel's own render(), read from source, not the label repeated:
//   workspaces → WorkspaceManager.tsx:49        the "Add Folder" button,
//                always rendered regardless of workspace count (unlike "No
//                workspaces added yet.", which is conditional on zero rows
//                and false on this machine)
//   servers    → Settings.tsx:952 (ServersPanel)  the "Machines" <h4>,
//                unconditional — the rows below it vary, the heading never
//                does
//   backups    → Backups.tsx:238-244             no unconditional STRUCTURAL
//                anchor exists here — the only content that always renders
//                regardless of server count is the intro paragraph's prose.
//                Documented as the weaker case Job 2 allows for: a distinctive
//                sentence, not a control or a count, because this panel has
//                no unconditional control. Chosen fragment is a scoping claim
//                the panel's own comments call out as the point of the file
//                (⭐ "read-only, and it opens no connection of its own"),
//                which makes it less likely to be casually reworded than
//                ordinary copy
//   help       → HelpPanel.tsx:45-55 (SECTIONS[0]) the "What DevGo is"
//                section heading — the first entry in SECTIONS, has no
//                `windowsOnly` gate, so it renders on every desktop
export const SETTINGS_PANELS = [
	{ id: 'workspaces', label: 'Workspaces', anchor: 'Add Folder' },
	{ id: 'targets', label: 'Launch targets', anchor: 'Launch targets' },
	// the label is per-desktop: `isWindows ? 'tmux / psmux' : 'tmux'`
	// (Settings.tsx:1123). This walk needs WebView2, so it only ever runs on
	// Windows, and the Windows label is the one asserted — the first real run
	// failed the nav-current check on exactly this (it read 'tmux / psmux').
	// The anchor is the panel's own first <h4> (Settings.tsx:323), not the label
	// repeated, for the reason given above the table.
	{ id: 'tmux', label: 'tmux / psmux', anchor: 'Use tmux / psmux' },
	{ id: 'wsl', label: 'WSL doctor', anchor: 'WSL' },
	{ id: 'github', label: 'GitHub', anchor: 'GitHub' },
	{ id: 'shortcuts', label: 'Shortcuts', anchor: 'Command palette' },
	{ id: 'scanning', label: 'Scanning', anchor: 'Scanning' },
	{ id: 'appearance', label: 'Appearance', anchor: 'Theme' },
	{ id: 'config', label: 'Config', anchor: 'Export' },
	{ id: 'servers', label: 'Servers', anchor: 'Machines' },
	{ id: 'backups', label: 'Backups', anchor: 'Nothing here asks a remote anything' },
	{ id: 'help', label: 'Help', anchor: 'What DevGo is' },
	{ id: 'about', label: 'About', anchor: 'DevGo' }
];

// ─── selectors, named once ──────────────────────────────────────────────────
//
// ⛔ THIS APP HAS NO data-testid ANYWHERE (verified: zero matches across src/).
// So every anchor below is a STRUCTURAL or TEXT fact about production markup,
// which means a refactor can break the walk without breaking the app. That is
// the honest cost of asserting on a real app with no test hooks, and it is
// why they live here in one block instead of being scattered through the steps.
export const S = {
	// Drawer.tsx renders exactly this for every drawer, sheet and confirm
	dialog: '[role="dialog"][aria-modal="true"]',
	dialogTitled: '[role="dialog"][aria-label]',
	drawerBody: '[data-drawer-body]',
	closeX: '[role="dialog"] [aria-label="Close"]',
	// ContextMenu.tsx: the one fixed w-72 popover
	menu: 'div.fixed.z-50.w-72',
	menuItem: 'div.fixed.z-50.w-72 button',
	// Settings.tsx nav column
	settingsNav: '[role="dialog"] nav',
	settingsNavActive: '[role="dialog"] nav button[aria-current="page"]',
	// rowStyles.ts: every lane is one of these cards
	laneCard: 'div.rounded-panel.border-t-2.border-l-2',
	// ⚠️ A PROJECT row's name cell, and only a project row's. rowStyles.ts is
	// shared, so `nameCell` alone also matches GitHub repo rows and server
	// rows — right-clicking one of those opens a DIFFERENT menu, and the
	// inventory assertion would fail for the wrong reason. ProjectRow
	// (ProjectTree.tsx:262) is the only row that carries `group`, so that is
	// the discriminator.
	projectName: 'div.group div.pl-10 div.basis-\\[34\\%\\]',
	wsHeader: '[data-ws-header]',
	// SearchBox in the projects lane
	search: 'input[placeholder*="Search projects" i]',
	attachPane: '[data-attach]'
};

// ─── the walk ───────────────────────────────────────────────────────────────
export const STEPS = [
	{
		id: 'home',
		name: 'Home — the lanes',
		themes: 'all',
		why: 'the screen every other step starts from, in all five palettes',
		open: [{ wait: { css: S.laneCard } }],
		assert: [
			{ text: 'DevGo' },
			{ atleast: [S.laneCard, 1] },
			{ gone: S.dialog },
			// the title bar's own three buttons on a non-mac desktop
			{ js: 'document.querySelector("header").offsetHeight === 48' }
		],
		shot: 'webview',
		tags: ['home']
	},
	{
		id: 'home-window',
		name: 'Home — the real window over the wallpaper',
		themes: ['neon'],
		why: 'the only step that proves the window chrome, the rounded corners and the transparency knob; cdp shot cannot see any of them',
		open: [{ wait: { css: S.laneCard } }],
		assert: [{ text: 'DevGo' }, { gone: S.dialog }],
		shot: 'window',
		tags: ['home', 'chrome']
	},

	// ── search: many / one / none ──────────────────────────────────────────
	{
		id: 'search-none',
		name: 'Projects — no match (empty state)',
		themes: 'all',
		why: 'the empty half of empty/one/many; its own sentence, not a blank lane',
		open: [
			{ key: 'Ctrl+K' },
			{ type: 'zzzznotarealproject' },
			{ wait: { text: 'No project matches.' } }
		],
		assert: [{ text: 'No project matches.' }, { count: [S.projectName, 0] }],
		shot: 'webview',
		close: [{ key: 'Ctrl+L' }, { wait: { css: S.projectName } }],
		tags: ['state', 'empty']
	},
	{
		id: 'search-many',
		name: 'Projects — the unfiltered list (many)',
		themes: 'first',
		why: 'the many half; also the negative control for search-none — if this shows zero rows the empty assertion above proves nothing',
		open: [{ key: 'Ctrl+L' }, { wait: { css: S.projectName } }],
		assert: [{ atleast: [S.projectName, 2] }, { notext: 'No project matches.' }],
		shot: 'webview',
		tags: ['state']
	},

	// ── the command palette: a top sheet with NO title, so no ✕ ────────────
	{
		id: 'palette',
		name: 'Command palette',
		themes: 'all',
		why: 'the one surface summoned from anywhere; z-60, over everything',
		open: [{ key: 'Ctrl+Shift+P' }, { wait: { css: S.dialog } }],
		assert: [
			{ css: S.dialog },
			{ atleast: ['[role="dialog"] button', 3] },
			// ⚠️ the palette Drawer is given no `title`, so Drawer renders no
			// header and no ✕. Asserted, not assumed: if a title is added later
			// this fails and the route map gets updated on purpose.
			{ gone: S.closeX }
		],
		shot: 'webview',
		close: [{ key: 'Escape' }, { wait: { gone: S.dialog } }],
		tags: ['overlay', 'palette']
	},
	{
		id: 'palette-filtered',
		name: 'Command palette — filtered to "server"',
		themes: 'first',
		why: 'the palette with a query is a different render path from the palette empty',
		open: [
			{ key: 'Ctrl+Shift+P' },
			{ wait: { css: S.dialog } },
			{ type: 'server' },
			{ wait: { ms: 150 } }
		],
		assert: [{ css: S.dialog }, { text: 'server' }],
		shot: 'webview',
		close: [{ key: 'Escape' }, { wait: { gone: S.dialog } }],
		tags: ['overlay', 'palette']
	},
	{
		id: 'palette-escape',
		name: 'Command palette — closed by Escape',
		themes: 'first',
		why: 'exit 1 of 3',
		open: [
			{ key: 'Ctrl+Shift+P' },
			{ wait: { css: S.dialog } },
			{ key: 'Escape' },
			{ wait: { gone: S.dialog } }
		],
		assert: [{ gone: S.dialog }],
		shot: false,
		tags: ['overlay', 'exit']
	},
	{
		id: 'palette-backdrop',
		name: 'Command palette — closed by the backdrop',
		themes: 'first',
		why: 'exit 2 of 3. { outside } computes the point from the panel rect at run time, so it cannot drift with the layout',
		open: [
			{ key: 'Ctrl+Shift+P' },
			{ wait: { css: S.dialog } },
			{ click: { outside: S.dialog } },
			{ wait: { gone: S.dialog } }
		],
		assert: [{ gone: S.dialog }],
		shot: false,
		tags: ['overlay', 'exit']
	},

	// ── Settings: the sheet with the known backdrop defect ─────────────────
	{
		id: 'settings',
		name: 'Settings — the nav column',
		themes: 'all',
		why: 'thirteen panels, and the nav is the only way to reach any of them',
		open: [{ key: 'Ctrl+,' }, { wait: { css: S.settingsNav } }],
		assert: [
			{ css: S.dialog },
			{ text: 'Settings' },
			{ count: [`${S.settingsNav} button`, SETTINGS_PANELS.length] },
			{ count: [S.settingsNavActive, 1] }
		],
		shot: 'webview',
		close: [{ key: 'Escape' }, { wait: { gone: S.dialog } }],
		tags: ['overlay', 'settings']
	},
	// one step per panel, generated from the registry above: adding a panel to
	// Settings.tsx means adding a row to SETTINGS_PANELS and nothing else
	...SETTINGS_PANELS.map(p => ({
		id: `settings-${p.id}`,
		name: `Settings › ${p.label}`,
		// ⭐ the appearance and about panels in every theme: one paints the
		// palette table, the other prints the build's own identity
		themes: p.id === 'appearance' || p.id === 'about' ? 'all' : 'first',
		why: `panel ${p.id} renders, and the nav marks it current`,
		open: [
			{ key: 'Ctrl+,' },
			{ wait: { css: S.settingsNav } },
			{ click: { text: p.label } },
			{ wait: { text: p.anchor } }
		],
		assert: [
			{ css: S.dialog },
			{ text: p.anchor },
			{ count: [S.settingsNavActive, 1] },
			{ js: `document.querySelector('${S.settingsNavActive}').textContent.trim() === ${JSON.stringify(p.label)}` },
			// ⭐ L6 checked in the UI: the About panel prints the sha the binary
			// compiled in, and the manifest stamps the same value. If these two
			// ever disagree the walk is not looking at the build it says it is.
			...(p.id === 'about' ? [{ sha: true }] : []),
			...(p.id === 'appearance'
				? [{ count: ['[role="dialog"] button[aria-pressed="true"]', 1] }]
				: [])
		],
		shot: 'webview',
		close: [{ key: 'Escape' }, { wait: { gone: S.dialog } }],
		tags: ['settings', 'panel']
	})),
	{
		id: 'settings-escape',
		name: 'Settings — closed by Escape',
		themes: 'first',
		why: 'exit 1 of 3. Recorded as passing by the prior walk; kept so a regression is caught',
		open: [
			{ key: 'Ctrl+,' },
			{ wait: { css: S.dialog } },
			{ key: 'Escape' },
			{ wait: { gone: S.dialog } }
		],
		assert: [{ gone: S.dialog }],
		shot: false,
		tags: ['settings', 'exit']
	},
	{
		id: 'settings-close-button',
		name: 'Settings — closed by its own Close button',
		themes: 'first',
		why: 'exit 2 of 3. ⚠️ Settings gets no Drawer `title`, so it has no ✕ — the footer button is the button, and asserting the ✕ here would be asserting the wrong control',
		open: [
			{ key: 'Ctrl+,' },
			{ wait: { css: S.settingsNav } },
			{ click: { text: 'Close' } },
			{ wait: { gone: S.dialog } }
		],
		assert: [{ gone: S.dialog }],
		shot: false,
		tags: ['settings', 'exit']
	},
	{
		id: 'settings-backdrop',
		name: 'Settings — closed by the backdrop',
		themes: 'first',
		why: 'exit 3 of 3, and the guard on a once-reported defect (D1): the Settings sheet was seen swallowing an outside click while Close and Escape worked. 33a4f20 closed the title-bar-strip gap; the first real walk (6d2b16d) found this step GREEN, with a negative control: a click inside the panel left it open, a click on the backdrop closed it. A red here is a regression, not an expected failure.',
		open: [
			{ key: 'Ctrl+,' },
			{ wait: { css: S.dialog } },
			{ click: { outside: S.dialog } },
			{ wait: { gone: S.dialog } }
		],
		assert: [{ gone: S.dialog }],
		shot: false,
		tags: ['settings', 'exit', 'regression']
	},

	// ── the project row menu: all thirteen entries, none of them clicked ───
	{
		id: 'project-menu',
		name: 'Project row menu — the inventory',
		themes: 'all',
		why: '⭐ the densest surface in the app: thirteen entries in four sections, ten of them conditional. Asserted, screenshot, and NOT clicked — see NEVER_CLICK.',
		open: [
			{ key: 'Ctrl+L' },
			{ wait: { css: S.projectName } },
			{ rclick: { css: S.projectName } },
			{ wait: { css: S.menu } }
		],
		assert: [
			{ css: S.menu },
			{ menu: MENU_ALWAYS },
			{ hints: MENU_HINTS },
			// four sections means three separators in the thirteen-entry case and
			// three in the seven-entry case too — the sections are the same four
			{ atleast: [`${S.menu} > div.border-b`, 2] }
		],
		shot: 'webview',
		close: [{ key: 'Escape' }, { wait: { gone: S.menu } }],
		tags: ['menu', 'project']
	},
	{
		id: 'project-menu-escape',
		name: 'Project row menu — closed by Escape',
		themes: 'first',
		open: [
			{ rclick: { css: S.projectName } },
			{ wait: { css: S.menu } },
			{ key: 'Escape' },
			{ wait: { gone: S.menu } }
		],
		assert: [{ gone: S.menu }],
		shot: false,
		tags: ['menu', 'exit']
	},
	{
		id: 'project-menu-outside',
		name: 'Project row menu — closed by a click away',
		themes: 'first',
		why: 'ContextMenu listens on mousedown, not click — a different exit from the Drawer backdrop, and worth its own step',
		open: [
			{ rclick: { css: S.projectName } },
			{ wait: { css: S.menu } },
			// the title bar: always present, never a menu, and clicking it starts
			// a window drag that ends with the mouse release CDP already sends
			{ click: { css: 'header span.text-18' } },
			{ wait: { gone: S.menu } }
		],
		assert: [{ gone: S.menu }],
		shot: false,
		tags: ['menu', 'exit']
	},
	{
		id: 'workspace-menu',
		name: 'Workspace header menu',
		themes: 'first',
		why: 'the second context menu, on the lane heading rather than a row',
		open: [{ rclick: { css: S.wsHeader } }, { wait: { css: S.menu } }],
		assert: [{ css: S.menu }, { atleast: [S.menuItem, 2] }],
		shot: 'webview',
		close: [{ key: 'Escape' }, { wait: { gone: S.menu } }],
		tags: ['menu']
	},

	// ── the confirm sheet, opened and CANCELLED ────────────────────────────
	{
		id: 'confirm-remove-workspace',
		name: 'Confirm — Remove workspace (cancelled)',
		themes: 'first',
		why: '⭐ the destructive confirm, reached and refused. The Delete key opens it; Cancel closes it; nothing is removed. This is the shape of the only class of modal that can lose the owner data, so it is walked deliberately and it never gets to Confirm.',
		open: [
			{ click: { css: S.wsHeader } },
			{ key: 'Delete' },
			{ wait: { text: 'Remove workspace' } }
		],
		assert: [
			{ css: S.dialog },
			{ text: 'Your files will not be deleted.' },
			{ js: `!!document.querySelector('${S.dialog}') && [...document.querySelectorAll('${S.dialog} button')].some(b => b.textContent.trim() === 'Cancel')` },
			{ js: `[...document.querySelectorAll('${S.dialog} button')].some(b => b.textContent.trim() === 'Remove')` }
		],
		shot: 'webview',
		// ⛔ Cancel, never Remove. The assertion above proved the Remove button
		// is there and reads the right word; clicking it would take a workspace
		// out of the owner's prefs.json.
		close: [{ click: { text: 'Cancel' } }, { wait: { gone: S.dialog } }],
		tags: ['overlay', 'confirm', 'destructive']
	},
	{
		id: 'confirm-escape',
		name: 'Confirm — closed by Escape',
		themes: 'first',
		open: [
			{ click: { css: S.wsHeader } },
			{ key: 'Delete' },
			{ wait: { css: S.dialog } },
			{ key: 'Escape' },
			{ wait: { gone: S.dialog } }
		],
		assert: [{ gone: S.dialog }],
		shot: false,
		tags: ['confirm', 'exit']
	},
	{
		id: 'confirm-x',
		name: 'Confirm — closed by its ✕',
		themes: 'first',
		why: 'exit 3 of 3, and the only surface in the walk that HAS a ✕: ConfirmDialog passes a title, so Drawer renders the header',
		open: [
			{ click: { css: S.wsHeader } },
			{ key: 'Delete' },
			{ wait: { css: S.closeX } },
			{ click: { css: S.closeX } },
			{ wait: { gone: S.dialog } }
		],
		assert: [{ gone: S.dialog }],
		shot: false,
		tags: ['confirm', 'exit']
	},
	{
		id: 'confirm-backdrop',
		name: 'Confirm — closed by the backdrop',
		themes: 'first',
		why: 'the same class as settings-backdrop, on a top sheet instead of a right drawer — the two sides compute a different backdrop point',
		open: [
			{ click: { css: S.wsHeader } },
			{ key: 'Delete' },
			{ wait: { css: S.dialog } },
			{ click: { outside: S.dialog } },
			{ wait: { gone: S.dialog } }
		],
		assert: [{ gone: S.dialog }],
		shot: false,
		tags: ['confirm', 'exit']
	},

	// ── the drawers reached from Settings › Scanning / the empty screen ────
	{
		id: 'scan-drawer',
		name: 'Scan for folders (drawer)',
		themes: 'first',
		why: 'a right drawer with a title, so it has the ✕ the palette and Settings do not',
		// ⚠️ JOB 1 FIX: there is no "Scan" button. The real path (verified
		// against src/App.tsx): open the `Workspaces ▾` menu button
		// (App.tsx:2641, text is the two spans "Workspaces" + "▾" — the click
		// target's exact-match branch fails on the concatenated string but its
		// substring branch finds "Workspaces"), which opens `addMenu`, an
		// ordinary ContextMenu (App.tsx:2505-2521, the same `div.fixed.z-50.w-72`
		// class every ContextMenu renders — S.menu). Its second entry is
		// literally `{ label: 'Scan for folders…', onClick: () => setScanOpen(true) }`
		// (App.tsx:2516, ellipsis character matched exactly). ContextMenu's own
		// Button.onClick calls `item.onClick(); onClose();` (ContextMenu.tsx:88-89)
		// so the click both opens the drawer and closes the menu in one step —
		// no extra close action needed before waiting on the drawer. The drawer
		// itself is `<Drawer title='Scan for folders' ...>` (App.tsx:2526-2543),
		// and Drawer renders `aria-label={title}` + the ✕ only `{title && (...)}`
		// (Drawer.tsx:209-237), which is exactly what S.dialogTitled and
		// S.closeX already assert. Both selectors already existed in the S
		// table above (S.menu, S.dialogTitled) — nothing new added there.
		open: [
			{ click: { text: 'Workspaces' } },
			{ wait: { css: S.menu } },
			{ click: { text: 'Scan for folders…' } },
			{ wait: { css: S.dialogTitled } }
		],
		assert: [
			{ css: S.dialogTitled },
			{ css: S.closeX },
			{ js: `document.querySelector('${S.dialogTitled}').getAttribute('aria-label').length > 0` }
		],
		shot: 'webview',
		close: [{ click: { css: S.closeX } }, { wait: { gone: S.dialog } }],
		tags: ['overlay', 'drawer']
	}
];

// ─── what this walk does NOT cover, named so it is never counted as passing ─
//
// The lifecycle rule's own words: "Name what could not be reached and why — an
// untested screen named is useful; one silently counted as passing is how this
// rule got written twice."
export const NOT_COVERED = [
	'HOVER STATES — scripts/cdp.mjs has no hover verb and neither does this walk. Input.dispatchMouseEvent mouseMoved is sent before every click, so a :hover style is on screen for the click but never captured on its own. src/themes.ts warns that muted text ran under 4:1 on a HOVERED row for months; this walk would not have caught that.',
	'NATIVE WINDOW CHROME in all themes — only the `home-window` step uses shoot.ps1, and only in neon. The other four palettes are captured by Page.captureScreenshot, which sees the document and not the window: no rounded corners, no transparency knob, no title-bar buttons as the OS composites them.',
	'THE ATTACH PANE and any live pty — opening one starts a real shell in the owner’s session. Never walked.',
	'THE SERVERS LANE beyond its rows — every server action reaches a real box over SSH.',
	'GITHUB CLONE, group edit and add-repo — they write to disk and to the GitHub account.',
	'LOADING and ERROR states — they are timing- and network-dependent, and faking them needs an IPC shim per command. Reachable with --arm-ipc and a stub that rejects; no step does it yet.',
	'A LIGHT THEME — there is not one. See the note on THEMES above.',
	'macOS and LINUX — this harness needs WebView2 and shoot.ps1 needs Win32. The mac and linux builds are captured by hand (docs/screenshots/README.md).',
	'CI — WebView2 needs a real interactive desktop session, windows-latest has no installed DevGo, and shoot.ps1 minimises every window on the box. This is a LOCAL gate and nothing else.'
];
