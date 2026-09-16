import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

// whether the card is open, remembered like the github one
const OPEN_KEY = 'devgo.serversOpen';

const loadOpen = (): boolean => {
	try {
		return localStorage.getItem(OPEN_KEY) !== '0';
	} catch {
		return true;
	}
};

// the servers card's state: the rows from servers.json, whether there is
// an ssh client to run (no client, no card), and the edits. nothing here
// touches the network; a row is an alias, and the network happens when
// enter runs ssh in a terminal
export const useServers = (): ServersState => {
	const [servers, setServers] = useState<Server[]>([]);
	const [hasSsh, setHasSsh] = useState(false);
	const [isOpen, setOpen] = useState<boolean>(loadOpen);

	const reload = () =>
		invoke<Server[]>('get_servers')
			.then(setServers)
			.catch(() => {});

	useEffect(() => {
		reload();
		invoke<boolean>('has_ssh')
			.then(setHasSsh)
			.catch(() => {});
	}, []);

	const toggleOpen = () => {
		try {
			localStorage.setItem(OPEN_KEY, isOpen ? '0' : '1');
		} catch {
			// per-viewer convenience only
		}
		setOpen(!isOpen);
	};

	const add = async (server: ServerDraft) => {
		const added = await invoke<Server>('add_server', {
			server: { ...server, id: '' }
		});
		await reload();
		return added;
	};
	const update = async (server: Server) => {
		await invoke('update_server', { server });
		await reload();
	};
	const remove = async (id: string) => {
		await invoke('remove_server', { id });
		await reload();
	};
	const importSshConfig = async () => {
		const [added, updated] =
			await invoke<[number, number]>('import_ssh_config');
		await reload();
		return { added, updated };
	};

	return {
		servers,
		hasSsh,
		isOpen,
		toggleOpen,
		reload,
		add,
		update,
		remove,
		importSshConfig
	};
};
