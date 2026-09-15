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

interface RuntimeInfo {
	runtime: 'windows' | 'wsl';
	wsl_available: boolean;
	distros: string[];
	default_distro: string | null;
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
	| 'choice';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	ref?: React.Ref<HTMLButtonElement>;
}

interface StatusBarProps {
	onOpenPalette: () => void;
}

interface TitleBarProps {
	children?: React.ReactNode;
}

interface TitleBarButtonProps {
	className?: string;
	onClick: () => void;
	children: React.ReactNode;
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
}

interface ShortcutTableProps {
	summonHotkey: string;
	/// the accelerator the backend actually bound
	onSummonChanged: (hotkey: string) => void;
	onError: (message: string) => void;
}

/// The add form's fields — all strings, because an input cannot hold null.
type TargetDraft = Record<
	'name' | 'executable' | 'args_template' | 'wsl_executable' | 'wsl_args_template',
	string
>;

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
	onRemove: (id: string) => Promise<void>;
	onSetDefault: (kind: TargetKind, id: string) => Promise<void>;
	onError: (message: string) => void;
}

interface CommandPaletteProps {
	commands: PaletteCommand[];
	onClose: () => void;
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

interface SearchBoxProps {
	value: string;
	onChange: (v: string) => void;
	onEnter?: () => void;
	onArrow?: (dir: 1 | -1) => void;
	enterHint?: string;
	sortMode?: SortMode;
	onToggleSort?: () => void;
	ref?: React.Ref<HTMLInputElement>;
}

interface RuntimeIndicatorProps {
	runtime: RuntimeInfo['runtime'];
}

interface ProjectTreeHandle {
	navigate: (dir: 1 | -1) => void;
}

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
	onOpenRemote?: (p: Project) => void;
	onContextMenu?: (p: Project, x: number, y: number) => void;
	ref?: React.Ref<ProjectTreeHandle>;
}

interface GitBadgeProps {
	info?: GitInfo;
	onOpenRemote?: () => void;
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
	onOpenRemote?: (p: Project) => void;
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
	onOpenRemote?: (p: Project) => void;
	onContextMenu?: (p: Project, x: number, y: number) => void;
}

interface ActionButtonsProps {
	hasSelection: boolean;
	onAddWorkspace: () => void;
	onRemoveWorkspace: () => void;
	onEditor: () => void;
	onTerminal: () => void;
	onBoth: () => void;
	onRefresh: () => void;
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
