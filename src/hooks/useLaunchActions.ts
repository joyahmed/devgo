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

	const openEditor = () => {
		if (!selected) return Promise.resolve();
		// targetId omitted means "use the default", resolved on the Rust side so
		// the fallback chain lives in one place.
		return invoke('open_editor', { project: selected, targetId: null });
	};

	const openTerminal = () => {
		if (!selected) return Promise.resolve();
		return invoke('open_terminal', { project: selected });
	};

	const openBoth = (project?: Project) => {
		const p = project ?? selected;
		if (!p) return Promise.resolve();
		return invoke('open_both', { project: p });
	};

	return {
		addWorkspace,
		removeWorkspace,
		openEditor,
		openTerminal,
		openBoth
	};
};
