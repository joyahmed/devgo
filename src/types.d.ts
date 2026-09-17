// ambient type declarations — usable everywhere, no import needed.
// No top-level import/export in this file: the moment one appears, every
// interface here stops being global. React's types are reached through the
// global `React` namespace (React.ReactNode, React.Ref<T>) for the same reason.

/* Rust wire types — mirror the structs in src-tauri/src/models */

interface Project {
	name: string;
	full_path: string;
	workspace: string;
	file_system: string;
}

/// The WSL chip's state: the watcher's event and `get_wsl_state` share it.
/// `up` is the VM's process being in the process table; `distros` is what
/// `wsl -l -q --running` last said. Up with an empty list is a VM that has
/// just started and not yet registered its distro.
interface WslState {
	up: boolean;
	distros: string[];
}

// what the machine is, from the cached probe: the name of its own file
// system as rust spells it, and whether wsl is there at all
interface RuntimeInfo {
	runtime: 'windows' | 'wsl';
	wsl_available: boolean;
	distros: string[];
	default_distro: string | null;
	local_fs: string;
}

type WorkspaceStatus = 'live' | 'cached' | 'unavailable';

/// Why a workspace could not be read. "distro_stopped" is not a failure — it
/// means we declined to boot WSL just to render a list.
type UnavailableReason = 'distro_stopped' | 'not_mounted' | 'access_denied';

interface WorkspaceState {
	workspace: string;
	status: WorkspaceStatus;
	reason: UnavailableReason | null;
	scanned_at: number | null;
	count: number;
}

/// Ranking metadata travels beside Project, not on it — Project stays the four
/// fields the scanner produces.
interface ProjectRank {
	full_path: string;
	score: number;
	launch_count: number;
	last_opened: number;
	hint: 'recent' | 'frequent' | null;
	pinned: boolean;
}

interface ProjectsPayload {
	projects: Project[];
	workspaces: WorkspaceState[];
	ranks: ProjectRank[];
}

type SortMode = 'frecency' | 'name' | 'activity';

/// Git state, read off the scan's hot path and never persisted — a branch name
/// from yesterday is worse than none, because it looks current.
interface GitInfo {
	full_path: string;
	branch: string | null;
	dirty: boolean;
	remote: string | null;
	last_commit: number;
	/// filled on demand by get_remote_branches; null until someone asks
	remote_branches: string[] | null;
}

/// What a project appears to be, from the names in its top directory alone.
interface ProjectTech {
	full_path: string;
	tags: string[];
	package_manager: string | null;
	pins_node_version: boolean;
	has_deps: boolean;
}

/// a suggested workspace root for an empty first run
interface DiscoveredRoot {
	path: string;
	label: string;
	kind: 'windows' | 'wsl';
}

/// a runnable script: what to show, and the command line behind it
interface DevScript {
	name: string;
	command: string;
}

/// bare folder names the scan skips, on top of dotfolders, and how many
/// levels deep to look (1 = immediate children only)
interface ScanConfig {
	ignore: string[];
	depth: number;
}

/// The windows a terminal launch opens, in order: tmux for a WSL project,
/// psmux for a Windows one; the count is the length. snake_case: the Rust
/// struct has no rename_all, so the wire field really is window_names.
interface TmuxConfig {
	/// off means one plain shell in the project directory, on either side
	enabled: boolean;
	window_names: string[];
}

/// one GitHub repository as gh repo list reported it and the cache holds
/// it. url has the shape remote_to_url gives a project's remote, which is
/// what makes the local match a string compare on the Rust side
interface GithubRepo {
	full_name: string;
	name: string;
	owner: string;
	url: string;
	/// RFC 3339 straight from gh; rendered relative by relativeTime
	updated_at: string;
	private: boolean;
	archived: boolean;
	/// null for an empty repository
	default_branch: string | null;
	/// added by hand (any owner) rather than listed by gh; survives a refresh
	added: boolean;
	/// only on a live search hit
	stars: number | null;
}

/// installed / logged in as / neither, read without the network
interface GhStatus {
	installed: boolean;
	version: string | null;
	login: string | null;
}

interface GithubCache {
	/// unix seconds of the last successful fetch; 0 means never
	fetched_at: number;
	login: string | null;
	/// every org the last refresh found: the Settings checkboxes
	orgs: string[];
	repos: GithubRepo[];
}

interface GithubPayload {
	cache: GithubCache;
	/// older than the six-hour rule, decided in Rust
	stale: boolean;
	refreshing: boolean;
	/// the user's org choice; null means every org in cache.orgs
	orgs: string[] | null;
	/// full_name to local project path, for rows cloned on this disk
	local: Record<string, string>;
	/// the opt-in for live gh search as you type
	live_search: boolean;
}

/// one live search's answer, stamped with the generation that asked
interface SearchAnswer {
	generation: number;
	repos: GithubRepo[];
}

/// a named group inside the GitHub list: a label over full_names, in the
/// user's order. a repo may be in several; a name the cache no longer
/// carries renders as gone rather than vanishing
interface GithubGroup {
	name: string;
	repos: string[];
}

/// a machine you ssh into: an alias into ~/.ssh/config, or a host typed
/// by hand with a key path. never a password
interface Server {
	id: string;
	name: string;
	alias: string | null;
	host: string;
	user: string | null;
	port: number | null;
	identity: string | null;
	default_path: string | null;
	tmux: boolean;
	session: string | null;
	tunnel: boolean;
	source: string;
	/// where its folders are listed from; empty = the defaults
	roots: string[];
}

/// where a server's ssh line runs on this machine, beside the terminal
/// targets: a psmux session whose window runs it, or the default distro's
/// own ssh. rust's ServerVia; the terminal itself is the absent case
type ServerVia = 'psmux' | 'wsl';

/// one button in a footer group: a launch target, or a server host that
/// is not one. blocked is the reason it is disabled, shown as the title
interface TargetChoice {
	id: string;
	name: string;
	title?: string;
	blocked?: string;
}

/// a server row's local hosts: every terminal target by id, then psmux
/// and wsl through the default one
interface ServerHost extends TargetChoice {
	targetId?: string;
	via?: ServerVia;
}

/// a folder on a server, from one ls -d over the roots
interface RemoteFolder {
	name: string;
	path: string;
	root: string;
}

interface ServerListing {
	folders: RemoteFolder[];
	/// children of folders drilled into, by absolute path
	subdirs: Record<string, RemoteFolder[]>;
	listed_at: number;
	up: boolean;
	error: string | null;
	/// the apps on the box, from ~/scripts/devgo-inventory.sh; null when
	/// the box has no such script
	inventory: ServerInventory | null;
	/// the actions the server declares, from devgo-actions.json beside it
	actions: ServerActions | null;
	inventory_error: string | null;
}

/// one app on a server: a /var/www/<name> with what runs it and what
/// fronts it. every field but name and dir may be empty on a bare deploy
interface ServerApp {
	name: string;
	dir: string;
	kind: string;
	processes: {
		pm2: string | null;
		/// the container name when the process is a docker container (then pm2 is null)
		docker: string | null;
		status: string | null;
		restarts: number | null;
		uptime: number | null;
		cwd: string | null;
		ports: number[];
		memory_mb: number | null;
	}[];
	site: {
		file: string;
		domains: string[];
		ssl: boolean;
		web_port: number | null;
		api_port: number | null;
	} | null;
	git: {
		repo: string | null;
		branch: string | null;
		head: string | null;
		subject: string | null;
	} | null;
	env_files: string[];
	database: { engine: string | null; name: string | null } | null;
	/// from the lockfile: pnpm | bun | yarn | npm
	pm: string | null;
	/// pm2's own file, when the app has one
	ecosystem: string | null;
}

interface ServerInventory {
	schema: number;
	generated: string | null;
	host: {
		hostname: string | null;
		uptime: number | null;
		load: number[];
		disk: { total_gb: number; free_gb: number } | null;
		pm2_total: number;
		pm2_online: number;
		nginx_sites: number;
	};
	apps: ServerApp[];
}

/// run types the line and presses enter; pretype leaves it on the prompt;
/// url opens the browser; local runs on this pc
type ServerActionKind = 'run' | 'pretype' | 'url' | 'local' | 'form';

/// one field of a form action. arg is emitted when the value differs from
/// default (a bool: arg when on, arg_off when off); when hides the field
/// until it holds; prefill is a placeholder filled from the app row
interface ServerActionField {
	name: string;
	label: string | null;
	type: 'text' | 'number' | 'choice' | 'bool';
	required: boolean;
	default: string | null;
	options: string[];
	prefill: string | null;
	when: string | null;
	arg: string | null;
	arg_off: string | null;
	hint: string | null;
}

interface ServerAction {
	id: string;
	label: string;
	kind: ServerActionKind;
	/// the line starts with sudo; the window will ask
	root: boolean;
	command: string;
	/// the heading the menu draws over it; null = none
	group: string | null;
	/// form only: the fields, what Preview appends, the word on the button
	fields: ServerActionField[];
	preview: string | null;
	submit: string | null;
}

interface ServerActions {
	schema: number;
	scripts_dir: string | null;
	server: ServerAction[];
	app: ServerAction[];
}

/// what run_server_action did
type ActionOutcome =
	| { kind: 'ran'; window: string }
	| { kind: 'typed'; window: string }
	| { kind: 'copied'; line: string }
	| { kind: 'opened'; url: string }
	| { kind: 'local'; line: string };

/// the form's answer: a new row has no id yet
type ServerDraft = Omit<Server, 'id'> & { id?: string };

/// one edit to the groups: the Rust GroupEdit enum, tagged by op
type GroupEdit =
	| { op: 'assign'; group: string; repo: string }
	| { op: 'unassign'; group: string; repo: string }
	| { op: 'rename'; from: string; to: string }
	| { op: 'delete'; name: string }
	| { op: 'reorder'; order: string[] };

/// one section of the list with no query: a group (or the ungrouped
/// tail), its rows in order, and which of them the cache no longer carries
interface LaneSection {
	/// a group's name, or null for the ungrouped tail
	group: string | null;
	rows: GithubRepo[];
	gone: Set<string>;
	/// for the tail: how many ungrouped repos exist beyond the ones shown
	total: number;
}

/// what the refresh thread emits when it is done
interface GithubUpdated {
	ok: boolean;
	error: string | null;
}

/// one clone, as the row shows it
interface CloneJob {
	full_name: string;
	workspace: string;
	status: 'queued' | 'running' | 'done' | 'failed';
	/// git's phase (Receiving objects, Resolving deltas) and its percent
	phase: string;
	percent: number | null;
	dest: string | null;
	error: string | null;
}

/// what clone_repo answers before the clone has started
interface CloneStarted {
	full_name: string;
	dest: string;
	protocol: 'ssh' | 'https';
}

interface CloneProgress {
	full_name: string;
	phase: string;
	percent: number | null;
}

interface CloneDone {
	full_name: string;
	ok: boolean;
	dest: string;
	error: string | null;
}

interface CloneState {
	jobs: Map<string, CloneJob>;
	enqueue: (repos: GithubRepo[], workspace: string) => void;
}

// the --color-* names in index.css; a theme must set every one
type ThemeKey =
	| 'bg-primary'
	| 'bg-secondary'
	| 'bg-panel'
	| 'bg-hover'
	| 'bg-selected'
	| 'bg-raised'
	| 'text-primary'
	| 'text-secondary'
	| 'text-muted'
	| 'accent'
	| 'accent-hover'
	| 'danger'
	| 'border'
	| 'border-strong'
	// not a colour: a box-shadow, or none
	| 'glow';

interface Theme {
	id: string;
	name: string;
	colors: Record<ThemeKey, string>;
}

interface LastProject {
	full_path: string;
	workspace: string;
}

type TargetKind = 'editor' | 'terminal' | 'agent';

/// An editor or terminal DevGo can launch into. Both share one shape because
/// both are "a program plus how to hand it a directory". `string | null`, not
/// `?`: Rust's Option serialises to an explicit null, and one is built here to
/// send back.
interface LaunchTarget {
	id: string;
	name: string;
	kind: TargetKind;
	executable: string;
	args_template: string;
	wsl_executable: string | null;
	wsl_args_template: string | null;
	/// `{command}` beside `{path}`; null means the target cannot run scripts.
	/// These two existed on the Rust struct with serde(default), so every
	/// terminal added through the form arrived without them and failed its
	/// first run_script.
	run_args_template: string | null;
	wsl_run_args_template: string | null;
}

/// A target DevGo found installed but has not registered. It is added back
/// by id, never by posting this object to add_target: LaunchTarget above has
/// no run templates, so a round trip would strip them from a terminal.
interface DetectedTarget {
	target: LaunchTarget;
	/// "path" for a Windows program, or the distro name
	source: string;
	/// a resolved exe path, or "Ubuntu-26.04 · nvim"
	detail: string;
}

/* Shortcuts — see src/shortcuts.ts */

type ShortcutId =
	| 'commandPalette'
	| 'focusSearch'
	| 'focusGithubSearch'
	| 'clearSearch'
	| 'refresh'
	| 'refreshAlt'
	| 'settings'
	| 'textBigger'
	| 'textSmaller'
	| 'textReset'
	| 'quit'
	| 'addWorkspace'
	| 'removeWorkspace'
	| 'revealWorkspace'
	| 'moveWorkspaceUp'
	| 'moveWorkspaceDown'
	| 'openEditor'
	| 'openTerminal'
	| 'openBoth'
	| 'openAgent'
	| 'revealExplorer'
	| 'copyWinPath'
	| 'copyWslPath'
	| 'togglePin'
	| 'moveUp'
	| 'moveDown'
	| 'openSelected'
	| 'runScript'
	| 'openRemote'
	| 'expand'
	| 'collapse'
	| 'toggleWorkspace'
	| 'top'
	| 'bottom';

type ShortcutGroup = 'Global' | 'Navigation' | 'Project' | 'Workspace';

interface Shortcut {
	id: ShortcutId;
	/// Canonical form: modifiers in Ctrl→Alt→Shift order, then the key.
	keys: string;
	label: string;
	/// what the same action is called on a mac, where the windows word is
	/// wrong: explorer is finder there, and a windows path is simply the
	/// path. read through labelFor, never directly, so every menu agrees
	macLabel?: string;
	/// meaningless on a mac: there is no second filesystem to have a path
	/// in. the menus and the settings panel drop it there (isAvailable)
	windowsOnly?: boolean;
	group: ShortcutGroup;
	/// Requires a selected project to do anything.
	needsSelection?: boolean;
}

/* Command palette */

/// a label, ways to find it, and a handle to an action that lives in App
interface PaletteCommand {
	id: string;
	title: string;
	subtitle?: string;
	/// from shortcuts.ts, never typed here
	hint?: string;
	/// aliases matched beside the title, so `term` finds "Open terminal"
	keywords?: string[];
	/// shown greyed, not hidden, e.g. a project action with nothing selected
	disabled?: boolean;
	run: () => void;
}

/* Component props */

type ButtonVariant =
	| 'primary'
	| 'secondary'
	| 'danger'
	| 'ghost'
	| 'pill'
	| 'tab'
	| 'badge'
	| 'card'
	| 'target'
	| 'choice'
	| 'add'
	| 'segment';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	ref?: React.Ref<HTMLButtonElement>;
}

/// the footer: the launch groups, and the palette's door
/// which default just fired; its button pulses once, the launch moment
type LaunchKind = 'editor' | 'terminal' | 'both' | 'agent';

interface Launching {
	path: string;
	kind: LaunchKind;
	/// the moment it fired, so a second launch of the same row replays
	seq: number;
}

interface StatusBarProps {
	hasSelection: boolean;
	selectionIsWsl: boolean;
	editors: LaunchTarget[];
	terminals: LaunchTarget[];
	/// coding agents: the group is absent entirely when none is detected
	agents: LaunchTarget[];
	defaults: Record<string, string>;
	onEditor: (targetId?: string) => void;
	onAgent: (targetId?: string) => void;
	onTerminal: (targetId?: string) => void;
	onBoth: () => void;
	onOpenPalette: () => void;
	pulse?: LaunchKind | null;
	/// the one shortcut shown nowhere else, and the door into the app
	summonHotkey: string;
	onOpenShortcuts: () => void;
	onOpenHelp: () => void;
	/// the selection has a live session and the multiplexer is on: the
	/// terminal group reads Reattach, which is what the script does
	reattach?: boolean;
	/// a server row under the cursor: the terminal group becomes its hosts,
	/// the tmux chip follows, and the editor group and open both step aside
	server?: Server | null;
	serverHosts?: ServerHost[];
	onServerHost?: (host: ServerHost) => void;
	onServerTmux?: (server: Server, on: boolean) => void;
}

interface TitleBarProps {
	children?: React.ReactNode;
}

interface KbdProps {
	children: React.ReactNode;
}

interface TitleBarButtonProps {
	className?: string;
	onClick: () => void;
	children: React.ReactNode;
}

interface ScanPickerProps {
	/// workspaces already in the list: shown checked and disabled, not
	/// hidden, or a rescan looks like it found less than last time
	existing: string[];
	onAddMany: (paths: string[]) => void;
	onError: (message: string) => void;
	/// after a successful add, so a modal host can close itself
	onDone?: () => void;
}

interface NameDialogProps {
	/// what the name is for, shown above the box
	hint: string;
	initial?: string;
	submitLabel: string;
	/// resolves on success; a thrown error is shown under the box
	onSubmit: (name: string) => Promise<void>;
	onDone: () => void;
}

interface AddRepoProps {
	onAdded: (repo: GithubRepo) => void;
	onDone: () => void;
}

interface ClonePickerProps {
	/// every cached repo. rows already on disk are ticked and disabled,
	/// the way ScanPicker shows folders already added
	repos: GithubRepo[];
	local: Record<string, string>;
	workspaces: string[];
	/// the repo that opened the picker from its row's menu: pre-ticked
	preselect?: string;
	/// into: a workspace, or a folder chosen through the os picker; add
	/// says the folder is outside every workspace and wants to be one
	onStart: (repos: GithubRepo[], into: string, add: boolean) => void;
	onDone: () => void;
	/// group: the same list and checkboxes, but the destination is a group
	/// name (typed, or picked from the ones that exist) and nothing is cloned
	mode?: 'clone' | 'group';
	groups?: GithubGroup[];
	/// the group the picker opens pointed at; a header passes its own name
	initialGroup?: string;
	onGroup?: (repos: GithubRepo[], group: string) => Promise<void>;
}

interface OnboardingProps {
	onAdd: (path: string) => void;
	onAddMany: (paths: string[]) => void;
	onError: (message: string) => void;
}

interface ScanningPanelProps {
	onSaved: () => void;
	onError: (message: string) => void;
}

interface TmuxPanelProps {
	onError: (message: string) => void;
}

interface GithubPanelProps {
	github: GithubState;
	onError: (message: string) => void;
}

interface GithubLaneProps {
	github: GithubState;
	/// the keyboard/click cursor, by full_name. beside the project
	/// selection, not instead of it
	cursor: string | null;
	onSelect: (repo: GithubRepo) => void;
	onOpen: (repo: GithubRepo) => void;
	onContextMenu: (repo: GithubRepo, x: number, y: number) => void;
	/// a row cloned here can jump to its disk row
	onShowLocal: (path: string) => void;
	/// the branch chip: every branch on GitHub, read on the click
	onOpenBranches: (repo: GithubRepo, x: number, y: number) => void;
	/// clones in flight or just finished, by full_name
	jobs?: Map<string, CloneJob>;
	/// right-click on a group heading: rename, move, delete
	onGroupContextMenu?: (name: string, x: number, y: number) => void;
	/// the + menu when the controls sit in the heading
	onAddMenu?: (x: number, y: number) => void;
	/// where the lane's box lives: in the heading on a narrow window, in
	/// the command row over the lane on a wide one. a css hidden cannot
	/// move a focused input, so the lane mounts it or does not
	searchInHeading?: boolean;
	searchRef?: React.Ref<HTMLInputElement>;
	/// from the heading's box the arrows walk the github rows alone
	onArrow?: (dir: 1 | -1) => void;
	onEnter?: () => void;
}

/// recents, + Add repo, refresh: beside the github box on the search line
interface RefreshIconProps {
	spinning?: boolean;
	size?: number;
}

interface GithubControlsProps {
	github: GithubState;
	/// the + menu: clone repos / add repo by name / group repos, at (x, y)
	onAddMenu: (x: number, y: number) => void;
	/// the row form: + Add repo ▾ as a button in the + Workspace shape; the
	/// heading keeps the bare glyphs, a heading being a line of text
	labelled?: boolean;
}

/// a lane's sticky heading: the caps label in the lane's hue, the count
/// line, and whatever sits at its right end
interface LaneHeadingProps {
	label: string;
	tone: string;
	line: string;
	/// a collapsing lane: the arrow before the label, the click on the
	/// whole heading
	open?: boolean;
	onToggle?: () => void;
	/// a right-click on the heading: the lane's own menu at (x, y)
	onContextMenu?: (x: number, y: number) => void;
	children?: React.ReactNode;
}

interface RepoRowProps {
	repo: GithubRepo;
	isCursor: boolean;
	localPath?: string;
	/// a clone in flight or just finished, shown in the time's slot
	job?: CloneJob;
	/// the user: their own repos drop the owner/ prefix
	login: string | null;
	/// the row's place under its heading, for the zebra
	i: number;
	/// a group member the cache no longer carries
	gone?: boolean;
	onSelect: (repo: GithubRepo) => void;
	onOpen: (repo: GithubRepo) => void;
	onContextMenu: (repo: GithubRepo, x: number, y: number) => void;
	onShowLocal: (path: string) => void;
	onOpenBranches: (repo: GithubRepo, x: number, y: number) => void;
}

interface ConfigPanelProps {
	/// an import or a cache reset changed what the launcher should show
	onChanged: () => void;
	onError: (message: string) => void;
}

interface WorkspaceManagerProps {
	workspaces: string[];
	onAdd: (path: string) => void;
	onRemove: (index: number) => void;
}

/// A settings section. Later chapters add panels by adding to the registry in
/// Settings.tsx — the shell itself never changes.
interface HelpSectionProps {
	title: string;
	children: React.ReactNode;
}

interface HelpPanelProps {
	onError: (message: string) => void;
}

interface SettingsPanel {
	id: string;
	label: string;
	render: () => React.ReactNode;
}

interface SettingsProps {
	open: boolean;
	onClose: () => void;
	workspaces: string[];
	onAddWorkspace: (path: string) => void;
	onRemoveWorkspace: (index: number) => void;
	summonHotkey: string;
	onError: (message: string) => void;
	/// a panel to land on when opened this way, else the last one used
	panel?: string;
	/// the launcher re-scans with the saved config
	onScanChanged: () => void;
	/// an import can change workspaces, targets, the hotkey: reload them all
	onImported: () => void;
	onSummonChanged: (hotkey: string) => void;
	targets: TargetRegistry;
	/// owned by App for the same reason targets is: the panel's Refresh
	/// and the lane's header must agree on "refreshing"
	github: GithubState;
	showHints: boolean;
	onToggleHints: () => void;
	/// the servers card's state and the doors App owns
	servers: ServersState;
	onAddServer: () => void;
	onEditServer: (server: Server) => void;
	onImportSsh: () => void;
}

interface AppearancePanelProps {
	showHints: boolean;
	onToggleHints: () => void;
}

/// the transparency slider: 0 to the cap, the window is the preview
/// the transparency stepper: the value, null until read
interface TransparencyStepProps {
	value: number | null;
	onChange: (percent: number) => void;
}

/// the text-size stepper's three controls
interface TextStepProps {
	scale: number;
	onScale: (scale: number) => void;
}

interface ShortcutTableProps {
	summonHotkey: string;
	/// the accelerator the backend actually bound
	onSummonChanged: (hotkey: string) => void;
	onError: (message: string) => void;
}

/// The add form's fields — all strings, because an input cannot hold null.
type TargetDraft = Record<
	| 'name'
	| 'executable'
	| 'args_template'
	| 'wsl_executable'
	| 'wsl_args_template'
	| 'run_args_template'
	| 'wsl_run_args_template',
	string
>;

/// What useTargets returns. Named so Settings can take it as a prop: App
/// owns the one copy, and the row and the panel read the same list.
/// what useGithub hands out; named because ambient types cannot import
interface GithubState {
	/// the github box's text; the hook owns it, not App
	query: string;
	setQuery: (q: string) => void;
	payload: GithubPayload | null;
	status: GhStatus | null;
	refreshing: boolean;
	lastError: string | null;
	/// a cache, or a gh to fetch with: whether the lane has anything to say
	available: boolean;
	isOpen: boolean;
	toggleOpen: () => void;
	visible: GithubRepo[];
	/// null while searching: then visible is the flat list of matches
	sections: LaneSection[] | null;
	/// while searching, the cache's matches and the live hits it lacked
	cacheMatches: GithubRepo[] | null;
	liveExtras: GithubRepo[];
	/// a live search is eligible and not yet answered
	searching: boolean;
	liveOn: boolean;
	setLiveSearch: (on: boolean) => Promise<void>;
	groups: GithubGroup[];
	/// one edit in, the whole list back
	editGroups: (edit: GroupEdit) => Promise<GithubGroup[]>;
	folded: Set<string>;
	toggleGroup: (name: string) => void;
	/// the ungrouped tail on or off, remembered
	showRecents: boolean;
	toggleRecents: () => void;
	refresh: () => void;
	reload: () => void;
	setOrgs: (orgs: string[] | null) => Promise<void>;
}

interface TargetRegistry {
	editors: LaunchTarget[];
	terminals: LaunchTarget[];
	agents: LaunchTarget[];
	defaults: Record<string, string>;
	addTarget: (target: Omit<LaunchTarget, 'id'>) => Promise<void>;
	detect: () => Promise<DetectedTarget[]>;
	addDetected: (id: string) => Promise<void>;
	removeTarget: (id: string) => Promise<void>;
	setDefaultTarget: (kind: TargetKind, id: string) => Promise<void>;
}

interface TargetListProps {
	kind: TargetKind;
	items: LaunchTarget[];
	defaultId?: string;
	onRemove: (id: string) => void;
	onSetDefault: (kind: TargetKind, id: string) => void;
}

interface TargetManagerProps {
	editors: LaunchTarget[];
	terminals: LaunchTarget[];
	agents: LaunchTarget[];
	/// Kind → id of the target that would actually launch, resolved in Rust.
	defaults: Record<string, string>;
	onAdd: (t: Omit<LaunchTarget, 'id'>) => Promise<void>;
	onDetect: () => Promise<DetectedTarget[]>;
	onAddDetected: (id: string) => Promise<void>;
	onRemove: (id: string) => Promise<void>;
	onSetDefault: (kind: TargetKind, id: string) => Promise<void>;
	onError: (message: string) => void;
}

interface CommandPaletteProps {
	commands: PaletteCommand[];
	onClose: () => void;
}

/// right for anything you work inside (settings, a picker, a name box):
/// full height, the list still visible beside it. top for a sentence and
/// two buttons, a confirm sheet under the title bar, and the palette
type DrawerSide = 'right' | 'top';

interface DrawerProps {
	open: boolean;
	side: DrawerSide;
	/// omit for a surface that is its own heading (the palette's input)
	title?: string;
	onClose: () => void;
	children: React.ReactNode;
	/// a right drawer's default fits a form; a picker with a list wants more
	width?: string;
	/// settings sits at 40 so a confirm sheet (50) opens over it
	z?: 40 | 50;
}

interface ConfirmDialogProps {
	open: boolean;
	title: string;
	message: string;
	/// What the confirming button says — the verb, so the dialog cannot say
	/// "Remove" over a question about stopping something.
	confirmLabel?: string;
	onConfirm: () => void;
	onCancel: () => void;
}

/// the branch popover; branches null is the loading state
interface BranchMenu {
	project: Project;
	x: number;
	y: number;
	branches: string[] | null;
}

/// the same popover on a github row: null while gh api is answering
interface RepoBranchMenu {
	repo: GithubRepo;
	x: number;
	y: number;
	branches: string[] | null;
}

interface RepoMenu {
	repo: GithubRepo;
	x: number;
	y: number;
}

/// what useServers hands out; named because ambient types cannot import
interface ServersState {
	servers: Server[];
	/// no ssh client on PATH, no card
	hasSsh: boolean;
	isOpen: boolean;
	toggleOpen: () => void;
	reload: () => Promise<void>;
	add: (server: ServerDraft) => Promise<Server>;
	update: (server: Server) => Promise<void>;
	remove: (id: string) => Promise<void>;
	/// (added, updated): the sentence the toast says
	importSshConfig: () => Promise<{ added: number; updated: number }>;
	/// whether a row prints user@host and the port. off by default: the
	/// name is the row, and a screenshot is not a list of where you ssh
	showDetails: boolean;
	setShowDetails: (on: boolean) => Promise<void>;
	/// the folders on each server: the cache paints first, an ask on
	/// expand or refresh, never on launch
	listings: Record<string, ServerListing>;
	/// servers with an ask in flight
	listing: Set<string>;
	expanded: Set<string>;
	toggleExpanded: (id: string) => void;
	listFolders: (id: string) => Promise<ServerListing>;
	/// the card's own box: a server by name, alias or host, a folder by
	/// name or path
	query: string;
	setQuery: (q: string) => void;
	/// folders drilled into, `${id}:${path}`; their children sit on the
	/// listing under subdirs. the first open is an ask
	openDirs: Set<string>;
	loadingDirs: Set<string>;
	toggleDir: (id: string, path: string) => void;
	listDir: (id: string, path: string) => Promise<RemoteFolder[]>;
	/// root groups folded shut, `${id}:${root}`, remembered
	foldedRoots: Set<string>;
	toggleRoot: (id: string, root: string) => void;
	/// parents whose curated view was opened up to all this session
	showAllIn: Set<string>;
	toggleShowAll: (id: string, path: string) => void;
	/// the servers the query leaves, each with its root groups and their
	/// rows in render order when it is open; the card renders this and the
	/// tree walks it
	visible: VisibleServer[];
}

interface VisibleServer {
	server: Server;
	open: boolean;
	groups: VisibleRoot[];
}

/// one root heading and, unless folded, the rows under it: a folder, then
/// its children one step deeper while it is open
interface VisibleRoot {
	root: string;
	folded: boolean;
	/// how many folders sit directly under the root, folded or not
	count: number;
	/// system folders the curation left out; 0 when none or shown
	hidden: number;
	rows: VisibleFolder[];
}

interface VisibleFolder {
	folder: RemoteFolder;
	depth: number;
	open: boolean;
	busy: boolean;
	/// how many children the last look found; absent until looked
	inside?: number;
	/// the app this folder is, when the inventory knows it
	app?: ServerApp;
	/// children the curation left out under this folder
	hidden?: number;
}

interface ServersLaneProps {
	servers: ServersState;
	/// the keyboard/click cursor, by id, beside the project selection
	cursor: string | null;
	onSelect: (server: Server) => void;
	/// Enter / double-click: a terminal on the box
	onOpen: (server: Server) => void;
	onContextMenu: (server: Server, x: number, y: number) => void;
	/// the heading's +: add a server, or import ~/.ssh/config
	onAddMenu: (x: number, y: number) => void;
	/// a right-click on the heading: the details switch and the adds
	onHeadingContextMenu: (x: number, y: number) => void;
	/// the box and the + in the heading, or in the command row over the
	/// lane on a wide window
	searchInHeading?: boolean;
	/// a folder under an expanded server: the cursor by `${id}:${path}`
	folderCursor: string | null;
	onSelectFolder: (server: Server, folder: RemoteFolder) => void;
	onOpenFolder: (server: Server, folder: RemoteFolder) => void;
	onFolderContextMenu: (
		server: Server,
		folder: RemoteFolder,
		x: number,
		y: number
	) => void;
	onRootContextMenu: (server: Server, root: string, x: number, y: number) => void;
	/// set up this box: the note under a server with no inventory offers it
	onSetup: (server: Server) => void;
	/// from the card's box the arrows walk the servers and folders alone
	onArrow: (dir: 1 | -1) => void;
	onEnter: () => void;
}

interface ServerRowProps {
	server: Server;
	isCursor: boolean;
	/// the row's place in the lane, for the zebra
	i: number;
	/// the last listing, if any: the dot and the folders
	listing?: ServerListing;
	/// an ask in flight
	busy: boolean;
	expanded: boolean;
	/// user@host and the port after the name, or the name alone
	showDetails: boolean;
	onToggle: (server: Server) => void;
	onRefresh: (server: Server) => void;
	onSelect: (server: Server) => void;
	onOpen: (server: Server) => void;
	onContextMenu: (server: Server, x: number, y: number) => void;
}

interface FolderRowProps {
	server: Server;
	row: VisibleFolder;
	isCursor: boolean;
	onToggle: (server: Server, folder: RemoteFolder) => void;
	onSelect: (server: Server, folder: RemoteFolder) => void;
	onOpen: (server: Server, folder: RemoteFolder) => void;
	onContextMenu: (
		server: Server,
		folder: RemoteFolder,
		x: number,
		y: number
	) => void;
}

interface ServerFormProps {
	/// editing this row, or adding when absent
	initial?: Server;
	onSubmit: (server: ServerDraft) => Promise<void>;
	onDone: () => void;
}

interface ServersPanelProps {
	servers: ServersState;
	onAdd: () => void;
	onEdit: (server: Server) => void;
	onImport: () => void;
	onError: (message: string) => void;
}

interface ServerMenu {
	server: Server;
	x: number;
	y: number;
}

interface FolderMenu {
	server: Server;
	folder: RemoteFolder;
	x: number;
	y: number;
}

/// a top-level group's heading on a server: the row that owns the pin
interface RootMenu {
	server: Server;
	root: string;
	x: number;
	y: number;
}

/// the clone picker modal; preselect is the row whose menu opened it
interface ClonePickerRequest {
	preselect?: string;
}

/// a group heading's menu
interface GroupHeaderMenu {
	name: string;
	x: number;
	y: number;
}

/// the one name dialog: a new group for these repos, or a rename
type NamePrompt =
	| { kind: 'new'; repos: string[] }
	| { kind: 'rename'; from: string };

interface MenuAction {
	label: string;
	hint?: string;
	onClick: () => void;
	danger?: boolean;
	disabled?: boolean;
}

/// a section heading: the server menus grew past twenty rows, so the
/// entries are grouped, not pruned. not focusable, not clickable
interface MenuHeading {
	heading: string;
}

type MenuEntry = MenuAction | MenuHeading | 'separator';

interface ContextMenuProps {
	x: number;
	y: number;
	items: MenuEntry[];
	onClose: () => void;
}

interface FsCellProps {
	fs: string;
	className?: string;
}

// a title-bar chip for one file system: its name in its hue, a light when
// it has one, and a menu under it when it has something to act on. the
// menu is given the way to close itself
interface FsChipProps {
	fs: string;
	label?: string;
	title: string;
	light?: boolean;
	disabled?: boolean;
	menu?: (close: () => void) => React.ReactNode;
}

// the wsl menu's hands: the state it lists, the app's confirm and toast,
// and the way back
interface WslMenuProps {
	wsl: WslState;
	/// Called after every stop attempt, success or not — the caller re-reads.
	onChanged: () => void;
	onConfirm: (message: string, action: () => void) => void;
	onResult: (message: string, kind: ToastType) => void;
	close: () => void;
}

// the title bar's chips: the machine, and the wsl menu's hands
interface FileSystemsProps extends Omit<WslMenuProps, 'close'> {
	runtime: RuntimeInfo;
}

/// which rows a search box searches
type SearchLane = 'projects' | 'github' | 'servers';

interface SearchBoxProps {
	value: string;
	onChange: (v: string) => void;
	onEnter?: () => void;
	onArrow?: (dir: 1 | -1) => void;
	/// enter has a target: the chip says so
	enterHint?: boolean;
	placeholder?: string;
	/// the project box takes focus on mount; the github box does not
	lane?: SearchLane;
	className?: string;
	ref?: React.Ref<HTMLInputElement>;
}

interface ProjectTreeHandle {
	/// from the github box the arrows walk the github rows alone
	navigate: (dir: 1 | -1, lane?: SearchLane) => void;
	/// the repo under the cursor, opened; false when there is none
	openRepo: () => boolean;
	/// the server or folder under the cursor, opened; false when none
	openServerRow: () => boolean;
}

/// one row the arrows can land on, in the order the tree renders them
type NavRow =
	| { kind: 'project'; project: Project }
	| { kind: 'ws'; ws: string }
	| { kind: 'repo'; repo: GithubRepo }
	| { kind: 'server'; server: Server }
	| { kind: 'folder'; server: Server; folder: RemoteFolder };

interface ProjectTreeProps {
	projects: Project[];
	selected: Project | null;
	onSelect: (p: Project) => void;
	onDoubleClick: (p: Project) => void;
	onLaunch: (p: Project) => void;
	query: string;
	loading?: boolean;
	workspaceStates?: WorkspaceState[];
	ranks?: Map<string, ProjectRank>;
	gitInfo?: Map<string, GitInfo>;
	techInfo?: Map<string, ProjectTech>;
	/// projects with a live tmux / psmux session: the live chip
	sessions?: Set<string>;
	pinnedProjects?: Project[];
	onTogglePin?: (p: Project) => void;
	onOpenBranches?: (p: Project, x: number, y: number) => void;
	onContextMenu?: (p: Project, x: number, y: number) => void;
	/// right-click on a workspace row; workspaces had no menu at all
	onWorkspaceContextMenu?: (workspace: string, x: number, y: number) => void;
	/// the store's order; without it the tree fell back to first-seen order
	/// of the name-sorted project list
	workspaceOrder?: string[];
	/// the FULL new order after a drag or an Alt+Arrow move
	onReorder?: (order: string[]) => void;
	/// the github group. absent when gh is not installed and nothing was
	/// ever cached; then the table is exactly what it was
	github?: GithubState;
	/// Enter / double-click on a repo row: its page in the browser
	onRepoOpen?: (repo: GithubRepo) => void;
	onRepoContextMenu?: (repo: GithubRepo, x: number, y: number) => void;
	/// the local mark: select the disk project this repo is cloned at
	onShowLocal?: (path: string) => void;
	/// the branch chip on a repo row: the popover at (x, y)
	onRepoBranches?: (repo: GithubRepo, x: number, y: number) => void;
	cloneJobs?: Map<string, CloneJob>;
	onGroupContextMenu?: (name: string, x: number, y: number) => void;
	/// the servers card. absent when there is no ssh client
	servers?: ServersState;
	/// Enter / double-click on a server row: a terminal on it
	onServerOpen?: (server: Server) => void;
	/// the server under the cursor, or none: the footer follows it
	onServerCursor?: (server: Server | null) => void;
	onServerContextMenu?: (server: Server, x: number, y: number) => void;
	onServerSetup?: (server: Server) => void;
	onServersAddMenu?: (x: number, y: number) => void;
	onServersHeadingContextMenu?: (x: number, y: number) => void;
	/// a folder on a server: Enter is a terminal there
	onFolderOpen?: (server: Server, folder: RemoteFolder) => void;
	onFolderContextMenu?: (
		server: Server,
		folder: RemoteFolder,
		x: number,
		y: number
	) => void;
	onRootContextMenu?: (server: Server, root: string, x: number, y: number) => void;
	/// the recent / frequent words on rows, off unless Appearance says so
	showHints?: boolean;
	/// the project that was just launched; its row plays the launch motion
	launchingPath?: string | null;
	/// what the machine calls its own disk: the local lane's label
	localFs?: string;
	/// the github lane's box and + when the command row does not hold them
	onGithubAddMenu?: (x: number, y: number) => void;
	githubSearchRef?: React.Ref<HTMLInputElement>;
	githubSearchInHeading?: boolean;
	serversSearchInHeading?: boolean;
	ref?: React.Ref<ProjectTreeHandle>;
}

/// one filesystem lane: its workspaces in the store's order
interface WorkspaceLaneProps {
	label: string;
	tone: string;
	edge: string;
	entries: [string, Project[]][];
	children: React.ReactNode;
}

interface WorkspaceHeaderProps {
	ws: string;
	count: number;
	fs: string;
	state?: WorkspaceState;
	open: boolean;
	/// the keyboard cursor is on this header
	cursor: boolean;
	dragging: boolean;
	/// the insertion line while a drag hovers this header
	drop?: 'before' | 'after';
	onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
	onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
	onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
	onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
	onClick: () => void;
	onContextMenu: (x: number, y: number) => void;
}

interface GitBadgeProps {
	info?: GitInfo;
	/// the chip was clicked: open the branch popover at (x, y)
	onOpenBranches?: (x: number, y: number) => void;
}

interface TechBadgesProps {
	tech?: ProjectTech;
}

interface StatusPillProps {
	state: WorkspaceState | undefined;
}

interface RowMetaProps {
	project: Project;
	/// whether the recent / frequent words render (Appearance)
	showHints?: boolean;
	rank?: ProjectRank;
	git?: GitInfo;
	tech?: ProjectTech;
	/// a tmux / psmux session is running for the project
	live?: boolean;
	onTogglePin?: (p: Project) => void;
	onOpenBranches?: (p: Project, x: number, y: number) => void;
}

interface ProjectRowProps {
	project: Project;
	selected: boolean;
	/// the row's place under its heading, for the zebra; a pinned row has
	/// none and names its workspace instead
	i?: number;
	pinned?: boolean;
	/// Served from cache — the row dims to say so.
	stale?: boolean;
	/// a github row has the cursor: the selection stays, dimmed, so the
	/// strong blue is always the row Enter acts on
	quiet?: boolean;
	showHints?: boolean;
	/// just launched: the row plays the launch motion
	launching?: boolean;
	rank?: ProjectRank;
	git?: GitInfo;
	tech?: ProjectTech;
	live?: boolean;
	onSelect: (p: Project) => void;
	onDoubleClick: (p: Project) => void;
	onTogglePin?: (p: Project) => void;
	onOpenBranches?: (p: Project, x: number, y: number) => void;
	onContextMenu?: (p: Project, x: number, y: number) => void;
}

interface TargetGroupProps {
	label: string;
	/// blocked ones are disabled with their reason, not hidden
	items: TargetChoice[];
	defaultId?: string;
	hasSelection: boolean;
	shortcut: string;
	onPick: (id?: string) => void;
	/// the default just fired: it pulses once
	pulse?: boolean;
}

/* Toast */

type ToastType = 'error' | 'success' | 'info';

/// a button on the toast: one word, one click, the toast goes
interface ToastAction {
	label: string;
	onClick: () => void;
}

interface Toast {
	id: number;
	message: string;
	type: ToastType;
	action?: ToastAction;
}

interface ToastContextType {
	toasts: Toast[];
	toast: (message: string, type?: ToastType, action?: ToastAction) => void;
}

interface ToastProviderProps {
	children: React.ReactNode;
}

/// a form action's drawer: which server, which action, the app row it came
/// from, and the values it opens with
interface ActionFormRequest {
	server: Server;
	action: ServerAction;
	appDir: string | null;
	initial: Record<string, string>;
}

interface ActionFormProps {
	server: Server;
	action: ServerAction;
	appDir: string | null;
	initial: Record<string, string>;
	/// send the composed line; preview = with the action's preview word
	onRun: (values: Record<string, string>, preview: boolean) => Promise<void>;
	onDone: () => void;
}

/// set up this box: what plan_server_setup found under ~/scripts for each
/// file the app carries. missing is installed on confirm; same needs
/// nothing; differs is the user's own and stays
type SetupFileStatus = 'missing' | 'same' | 'differs';

interface SetupFile {
	name: string;
	status: SetupFileStatus;
	bytes: number;
	install: boolean;
}

interface SetupPlan {
	dir: string;
	files: SetupFile[];
}

/// the sheet's state: which server, and the plan once the probe answers
interface SetupRequest {
	server: Server;
	plan: SetupPlan | null;
}

interface ServerSetupState {
	request: SetupRequest | null;
	/// the probe or the write is in flight
	busy: boolean;
	/// the look: one ssh, then the sheet
	open: (server: Server) => void;
	/// the write, then the row's refresh; resolves with the count installed
	confirm: () => Promise<void>;
	close: () => void;
}

interface SetupSheetProps {
	setup: ServerSetupState;
}
