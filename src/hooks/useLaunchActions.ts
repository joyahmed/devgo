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

	const openVSCode = () => {
		if (!selected) return Promise.resolve();
		return invoke('open_vscode', { project: selected });
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
		openVSCode,
		openTerminal,
		openBoth
	};
};
