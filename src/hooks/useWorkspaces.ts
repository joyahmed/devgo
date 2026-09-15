import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useState } from 'react';

export const useWorkspaces = () => {
	const [workspaces, setWorkspaces] = useState<string[]>([]);

	const refresh = useCallback(async () => {
		const ws = await invoke<string[]>('get_workspaces');
		setWorkspaces(ws);
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const add = useCallback(async (path: string) => {
		const ws = await invoke<string[]>('add_workspace', { path });
		setWorkspaces(ws);
	}, []);

	const remove = useCallback(async (index: number) => {
		const ws = await invoke<string[]>('remove_workspace', { index });
		setWorkspaces(ws);
	}, []);

	return { workspaces, add, remove, refresh };
};
