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

interface LastProject {
	full_path: string;
	workspace: string;
}

/* Shortcuts — see src/shortcuts.ts */

type ShortcutId =
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

/* Component props */

type ButtonVariant =
	| 'primary'
	| 'secondary'
	| 'danger'
	| 'ghost'
	| 'pill'
	| 'tab';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
}

interface TitleBarProps {
	children?: React.ReactNode;
}

interface TitleBarButtonProps {
	className?: string;
	onClick: () => void;
	children: React.ReactNode;
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
}

interface ShortcutTableProps {
	summonHotkey: string;
}

interface ConfirmDialogProps {
	open: boolean;
	title: string;
	message: string;
	onConfirm: () => void;
	onCancel: () => void;
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
	pinnedProjects?: Project[];
	onTogglePin?: (p: Project) => void;
	onOpenRemote?: (p: Project) => void;
	ref?: React.Ref<ProjectTreeHandle>;
}

interface GitBadgeProps {
	info?: GitInfo;
	onOpenRemote?: () => void;
}

interface StatusPillProps {
	state: WorkspaceState | undefined;
}

interface RowMetaProps {
	project: Project;
	rank?: ProjectRank;
	git?: GitInfo;
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
	onSelect: (p: Project) => void;
	onDoubleClick: (p: Project) => void;
	onTogglePin?: (p: Project) => void;
	onOpenRemote?: (p: Project) => void;
}

interface ActionButtonsProps {
	hasSelection: boolean;
	onAddWorkspace: () => void;
	onRemoveWorkspace: () => void;
	onVSCode: () => void;
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
