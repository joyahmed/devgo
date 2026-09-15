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

	// the whole order, not a move: the store refuses one that is not a
	// permutation of what it holds, so a reorder from a stale list fails
	// loudly instead of dropping a workspace. the list comes back from the
	// store, so what renders is what was saved
	const reorder = async (order: string[]) => {
		const ws = await invoke<string[]>('reorder_workspaces', { order });
		setWorkspaces(ws);
	};

	return { workspaces, add, remove, refresh, reorder };
};
