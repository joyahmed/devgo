import { invoke } from '@tauri-apps/api/core';

export const useLaunchActions = (
	selected: Project | null,
	refreshProjects: () => void
) => {
	const addWorkspace = async (path: string) => {
		await invoke('add_workspace', { path });
		refreshProjects();
	};

	const removeWorkspace = async (index: number) => {
		await invoke('remove_workspace', { index });
		refreshProjects();
	};

	// buttons and shortcuts act on the selection, a context menu on its own
	// row. targetId has been on these commands since chapter 13 and nothing
	// ever sent one; omitted still means the default, resolved on the Rust
	// side so the fallback chain lives in one place
	const openEditor = (project?: Project, targetId?: string) => {
		const p = project ?? selected;
		if (!p) return Promise.resolve();
		return invoke('open_editor', { project: p, targetId: targetId ?? null });
	};

	const openTerminal = (project?: Project, targetId?: string) => {
		const p = project ?? selected;
		if (!p) return Promise.resolve();
		return invoke('open_terminal', { project: p, targetId: targetId ?? null });
	};

	// a coding agent, in the default terminal, in the project directory
	const openAgent = (project?: Project, targetId?: string) => {
		const p = project ?? selected;
		if (!p) return Promise.resolve();
		return invoke('open_agent', { project: p, targetId: targetId ?? null });
	};

	const openBoth = (project?: Project, editorId?: string, terminalId?: string) => {
		const p = project ?? selected;
		if (!p) return Promise.resolve();
		return invoke('open_both', {
			project: p,
			editorId: editorId ?? null,
			terminalId: terminalId ?? null
		});
	};

	return {
		addWorkspace,
		removeWorkspace,
		openEditor,
		openTerminal,
		openAgent,
		openBoth
	};
};
