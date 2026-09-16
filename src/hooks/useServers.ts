import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

// whether the card is open, remembered like the github one
const OPEN_KEY = 'devgo.serversOpen';
// which servers show their folders, remembered like the tree's collapse set
const EXPANDED_KEY = 'devgo.serversExpanded';

const loadOpen = (): boolean => {
	try {
		return localStorage.getItem(OPEN_KEY) !== '0';
	} catch {
		return true;
	}
};

const loadExpanded = (): Set<string> => {
	try {
		const raw = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]');
		return new Set(Array.isArray(raw) ? (raw as string[]) : []);
	} catch {
		return new Set();
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
	// the folders on each server: the cache paints first; a listing is
	// asked for on expand or refresh, never on launch, focus or the badge pass
	const [listings, setListings] = useState<Record<string, ServerListing>>({});
	const [listing, setListing] = useState<Set<string>>(new Set());
	const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
	const [query, setQuery] = useState('');

	const reload = () =>
		invoke<Server[]>('get_servers')
			.then(setServers)
			.catch(() => {});

	useEffect(() => {
		reload();
		invoke<boolean>('has_ssh')
			.then(setHasSsh)
			.catch(() => {});
		invoke<Record<string, ServerListing>>('get_server_listings')
			.then(setListings)
			.catch(() => {});
	}, []);

	// the explicit ask: one ssh, off the main thread; the row shows a busy
	// mark while it runs. resolves with the listing, up or not
	const listFolders = async (id: string) => {
		setListing(prev => new Set(prev).add(id));
		try {
			const l = await invoke<ServerListing>('list_server_folders', { id });
			setListings(prev => ({ ...prev, [id]: l }));
			return l;
		} finally {
			setListing(prev => {
				const next = new Set(prev);
				next.delete(id);
				return next;
			});
		}
	};

	// the first expand is the ask; after that the cache paints and the
	// refresh re-asks
	const toggleExpanded = (id: string) => {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		try {
			localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
		} catch {
			// per-viewer convenience only
		}
		setExpanded(next);
		if (!expanded.has(id) && !listings[id]) listFolders(id).catch(() => {});
	};

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
		importSshConfig,
		listings,
		listing,
		expanded,
		toggleExpanded,
		listFolders,
		query,
		setQuery
	};
};
