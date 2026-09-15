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

/* Component props */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

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
	loading?: boolean;
	ref?: React.Ref<ProjectTreeHandle>;
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
