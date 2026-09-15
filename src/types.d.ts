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
}

/// a named group inside the GitHub list: a label over full_names, in the
/// user's order. a repo may be in several; a name the cache no longer
/// carries renders as gone rather than vanishing
interface GithubGroup {
	name: string;
	repos: string[];
}

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
	| 'text-primary'
	| 'text-secondary'
	| 'text-muted'
	| 'accent'
	| 'accent-hover'
	| 'danger'
	| 'border'
	| 'border-strong';

interface Theme {
	id: string;
	name: string;
	colors: Record<ThemeKey, string>;
}

interface LastProject {
	full_path: string;
	workspace: string;
}

type TargetKind = 'editor' | 'terminal';

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
	| 'clearSearch'
	| 'refresh'
	| 'settings'
	| 'quit'
	| 'addWorkspace'
	| 'removeWorkspace'
	| 'moveWorkspaceUp'
	| 'moveWorkspaceDown'
	| 'openEditor'
	| 'openTerminal'
	| 'openBoth'
	| 'revealExplorer'
	| 'copyWinPath'
	| 'copyWslPath'
	| 'togglePin'
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
	| 'choice';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	ref?: React.Ref<HTMLButtonElement>;
}

/// the footer: the launch groups, and the palette's door
interface StatusBarProps {
	hasSelection: boolean;
	selectionIsWsl: boolean;
	editors: LaunchTarget[];
	terminals: LaunchTarget[];
	defaults: Record<string, string>;
	onEditor: (targetId?: string) => void;
	onTerminal: (targetId?: string) => void;
	onBoth: () => void;
	onManageTargets: () => void;
	onOpenPalette: () => void;
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
	onStart: (repos: GithubRepo[], workspace: string) => void;
	onDone: () => void;
	/// group: the same list and checkboxes, but the destination is a group
	/// name (typed, or picked from the ones that exist) and nothing is cloned
	mode?: 'clone' | 'group';
	groups?: GithubGroup[];
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
	/// clones in flight or just finished, by full_name
	jobs?: Map<string, CloneJob>;
	/// the header's +: clone repos / add repo by name, opened at (x, y)
	onAddMenu?: (x: number, y: number) => void;
	/// right-click on a group heading: rename, move, delete
	onGroupContextMenu?: (name: string, x: number, y: number) => void;
}

interface RepoRowProps {
	repo: GithubRepo;
	isCursor: boolean;
	localPath?: string;
	/// a clone in flight or just finished, shown in the time's slot
	job?: CloneJob;
	/// under a group heading: one indent deeper
	nested?: boolean;
	/// a group member the cache no longer carries
	gone?: boolean;
	onSelect: (repo: GithubRepo) => void;
	onOpen: (repo: GithubRepo) => void;
	onContextMenu: (repo: GithubRepo, x: number, y: number) => void;
	onShowLocal: (path: string) => void;
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
	groups: GithubGroup[];
	/// one edit in, the whole list back
	editGroups: (edit: GroupEdit) => Promise<GithubGroup[]>;
	folded: Set<string>;
	toggleGroup: (name: string) => void;
	refresh: () => void;
	reload: () => void;
	setOrgs: (orgs: string[] | null) => Promise<void>;
}

interface TargetRegistry {
	editors: LaunchTarget[];
	terminals: LaunchTarget[];
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

interface ModalProps {
	open: boolean;
	title: string;
	onClose: () => void;
	children: React.ReactNode;
	/// the confirm dialog is a sentence and two buttons; a list wants more
	width?: string;
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

interface RepoMenu {
	repo: GithubRepo;
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

type MenuEntry = MenuAction | 'separator';

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

interface WslControlProps {
	distros: string[];
	/// Called after every stop attempt, success or not — the caller re-reads.
	onChanged: () => void;
	onConfirm: (message: string, action: () => void) => void;
	onResult: (message: string, kind: ToastType) => void;
}

/// which rows a search box searches
type SearchLane = 'projects' | 'github';

interface SearchBoxProps {
	value: string;
	onChange: (v: string) => void;
	onEnter?: () => void;
	onArrow?: (dir: 1 | -1) => void;
	enterHint?: string;
	placeholder?: string;
	/// the project box takes focus on mount; the github box does not
	lane?: SearchLane;
	className?: string;
	ref?: React.Ref<HTMLInputElement>;
}

interface ProjectTreeHandle {
	navigate: (dir: 1 | -1) => void;
	/// the repo under the cursor, opened; false when there is none
	openRepo: () => boolean;
}

/// one row the arrows can land on, in the order the tree renders them
type NavRow =
	| { kind: 'project'; project: Project }
	| { kind: 'repo'; repo: GithubRepo };

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
	cloneJobs?: Map<string, CloneJob>;
	onGithubAddMenu?: (x: number, y: number) => void;
	onGroupContextMenu?: (name: string, x: number, y: number) => void;
	ref?: React.Ref<ProjectTreeHandle>;
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
	rank?: ProjectRank;
	git?: GitInfo;
	tech?: ProjectTech;
	onTogglePin?: (p: Project) => void;
	onOpenBranches?: (p: Project, x: number, y: number) => void;
}

interface ProjectRowProps {
	project: Project;
	selected: boolean;
	/// Rendered in the Pinned strip rather than under its workspace header.
	pinnedStrip?: boolean;
	/// Served from cache — the row dims to say so.
	stale?: boolean;
	rank?: ProjectRank;
	git?: GitInfo;
	tech?: ProjectTech;
	onSelect: (p: Project) => void;
	onDoubleClick: (p: Project) => void;
	onTogglePin?: (p: Project) => void;
	onOpenBranches?: (p: Project, x: number, y: number) => void;
	onContextMenu?: (p: Project, x: number, y: number) => void;
}

interface TargetGroupProps {
	label: string;
	items: LaunchTarget[];
	defaultId?: string;
	/// a target with no WSL form is disabled for a WSL selection, not hidden
	isWsl: boolean;
	hasSelection: boolean;
	shortcut: string;
	onPick: (id?: string) => void;
}

/* Toast */

type ToastType = 'error' | 'success' | 'info';

interface Toast {
	id: number;
	message: string;
	type: ToastType;
}

interface ToastContextType {
	toasts: Toast[];
	toast: (message: string, type?: ToastType) => void;
}

interface ToastProviderProps {
	children: React.ReactNode;
}
