import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

export const useWorkspaces = () => {
	const [workspaces, setWorkspaces] = useState<string[]>([]);

	const refresh = async () => {
		const ws = await invoke<string[]>('get_workspaces');
		setWorkspaces(ws);
	};

	useEffect(() => {
		refresh();
	}, []);

	const add = async (path: string) => {
		const ws = await invoke<string[]>('add_workspace', { path });
		setWorkspaces(ws);
	};

	const remove = async (index: number) => {
		const ws = await invoke<string[]>('remove_workspace', { index });
		setWorkspaces(ws);
	};

	return { workspaces, add, remove, refresh };
};
