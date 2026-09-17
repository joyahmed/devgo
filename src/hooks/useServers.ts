import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { curate } from '../etcCuration';
import { appForFolder } from '../serverApps';
import { useServerDetails } from './useServerDetails';

// whether the card is open, remembered like the github one
const OPEN_KEY = 'devgo.serversOpen';
// which servers show their folders, remembered like the tree's collapse set
const EXPANDED_KEY = 'devgo.serversExpanded';
// which root groups are folded shut, the same way
const FOLDED_KEY = 'devgo.serversFoldedRoots';

const DEFAULT_ROOTS = ['~', '~/projects', '/var/www', '/srv'];

const loadOpen = (): boolean => {
	try {
		return localStorage.getItem(OPEN_KEY) !== '0';
	} catch {
		return true;
	}
};

const loadSet = (key: string): Set<string> => {
	try {
		const raw = JSON.parse(localStorage.getItem(key) ?? '[]');
		return new Set(Array.isArray(raw) ? (raw as string[]) : []);
	} catch {
		return new Set();
	}
};
const loadExpanded = () => loadSet(EXPANDED_KEY);
const loadFolded = () => loadSet(FOLDED_KEY);

// the servers card's state: the rows from servers.json, whether there is
// an ssh client to run (no client, no card), and the edits. nothing here
// touches the network; a row is an alias, and the network happens when
// enter runs ssh in a terminal
// onError hears a failed ask (a folder drill on a box that is down)
export const useServers = (onError?: (e: unknown) => void): ServersState => {
	const [servers, setServers] = useState<Server[]>([]);
	const [hasSsh, setHasSsh] = useState(false);
	const [isOpen, setOpen] = useState<boolean>(loadOpen);
	// the folders on each server: the cache paints first; a listing is
	// asked for on expand or refresh, never on launch, focus or the badge pass
	const [listings, setListings] = useState<Record<string, ServerListing>>({});
	const [listing, setListing] = useState<Set<string>>(new Set());
	const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
	const [query, setQuery] = useState('');
	const { showDetails, setShowDetails } = useServerDetails();

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

	// folders drilled into, and the asks in flight, `${id}:${path}`. their
	// children sit on the listing under subdirs; the first open is the ask
	const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
	const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
	// root groups folded shut, remembered
	const [foldedRoots, setFoldedRoots] = useState<Set<string>>(loadFolded);
	// parents whose curated view was opened up to all, `${id}:${path}`: a
	// session choice, not remembered, so the default stays clean
	const [showAllIn, setShowAllIn] = useState<Set<string>>(new Set());
	const toggleShowAll = (id: string, path: string) => {
		const key = `${id}:${path}`;
		const next = new Set(showAllIn);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		setShowAllIn(next);
	};

	const listDir = async (id: string, path: string) => {
		const key = `${id}:${path}`;
		setLoadingDirs(prev => new Set(prev).add(key));
		try {
			const kids = await invoke<RemoteFolder[]>('list_server_dir', {
				id,
				path
			});
			setListings(prev => {
				const cur = prev[id] ?? {
					folders: [],
					subdirs: {},
					listed_at: 0,
					up: true,
					error: null
				};
				return {
					...prev,
					[id]: { ...cur, subdirs: { ...cur.subdirs, [path]: kids } }
				};
			});
			return kids;
		} finally {
			setLoadingDirs(prev => {
				const next = new Set(prev);
				next.delete(key);
				return next;
			});
		}
	};

	const toggleDir = (id: string, path: string) => {
		const key = `${id}:${path}`;
		const next = new Set(openDirs);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		setOpenDirs(next);
		if (openDirs.has(key) || listings[id]?.subdirs?.[path]) return;
		// the ask failed: the arrow closes again and onError says why, or a
		// box that is down shows an open folder with nothing under it
		listDir(id, path).catch(e => {
			setOpenDirs(prev => {
				const n = new Set(prev);
				n.delete(key);
				return n;
			});
			onError?.(e);
		});
	};

	const toggleRoot = (id: string, root: string) => {
		const key = `${id}:${root}`;
		const next = new Set(foldedRoots);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		try {
			localStorage.setItem(FOLDED_KEY, JSON.stringify([...next]));
		} catch {
			// per-viewer convenience only
		}
		setFoldedRoots(next);
	};

	// what the card shows and the arrows walk, one list for both: a server
	// by name, alias, host or user; a folder by name or path. a folder hit
	// keeps its server, and a query shows the hits under every server that
	// has one, expanded or not. groups come in the roots' order, not ls's
	// (ls -d sorts every matched path together, so /etc/* came out above
	// /home/user/* the moment /etc was a root); under a folder that is open
	// its children follow, one step deeper each level
	const q = query.trim().toLowerCase();
	const visible = servers.flatMap((server): VisibleServer[] => {
		const listing = listings[server.id];
		const all = listing?.folders ?? [];
		// an app's domain is a name too
		const hit = (f: RemoteFolder) =>
			f.name.toLowerCase().includes(q) ||
			f.path.toLowerCase().includes(q) ||
			!!appForFolder(listing, f.path)?.site?.domains.some(d =>
				d.toLowerCase().includes(q)
			);
		const hits = q ? all.filter(hit) : all;
		const matches =
			!q ||
			[server.name, server.alias ?? '', server.host, server.user ?? ''].some(
				t => t.toLowerCase().includes(q)
			);
		if (!matches && hits.length === 0) return [];
		const open = expanded.has(server.id) || (q.length > 0 && hits.length > 0);
		const none: VisibleRoot[] = [];
		if (!open) return [{ server, open, groups: none }];

		// /etc shows its developer folders until asked, and a search lifts
		// the curation (a hit is a hit)
		const shown = (parent: string, list: RemoteFolder[]) =>
			curate(
				parent,
				list,
				showAllIn.has(`${server.id}:${parent}`) || q.length > 0
			);
		const walk = (folder: RemoteFolder, depth: number): VisibleFolder[] => {
			const key = `${server.id}:${folder.path}`;
			const kids = listing?.subdirs?.[folder.path];
			const isOpen = openDirs.has(key);
			const [kept, hidden] = shown(folder.path, kids ?? []);
			const row: VisibleFolder = {
				folder,
				depth,
				open: isOpen,
				busy: loadingDirs.has(key),
				inside: kids?.length,
				app: appForFolder(listing, folder.path),
				hidden: isOpen && kids ? hidden : undefined
			};
			return isOpen && kids
				? [row, ...kept.flatMap(k => walk(k, depth + 1))]
				: [row];
		};
		const order = server.roots.length ? server.roots : DEFAULT_ROOTS;
		const byRoot = new Map<string, RemoteFolder[]>();
		for (const f of hits) {
			const key = f.root || '/';
			byRoot.set(key, [...(byRoot.get(key) ?? []), f]);
		}
		const rank = (r: string) => {
			const i = order.indexOf(r);
			return i === -1 ? order.length : i;
		};
		const groups: VisibleRoot[] = [...byRoot.entries()]
			.sort(([a], [b]) => rank(a) - rank(b))
			.map(([root, folders]) => {
				const folded = foldedRoots.has(`${server.id}:${root}`);
				const [kept, hidden] = shown(root, folders);
				return {
					root,
					folded,
					count: folders.length,
					hidden: folded ? 0 : hidden,
					rows: folded ? [] : kept.flatMap(f => walk(f, 0))
				};
			});
		return [{ server, open, groups }];
	});

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
		showDetails,
		setShowDetails,
		listings,
		listing,
		expanded,
		toggleExpanded,
		listFolders,
		query,
		setQuery,
		openDirs,
		loadingDirs,
		toggleDir,
		listDir,
		foldedRoots,
		toggleRoot,
		showAllIn,
		toggleShowAll,
		visible
	};
};
