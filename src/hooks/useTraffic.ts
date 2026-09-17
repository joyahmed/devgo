import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';

// a repo's 14-day traffic, read when its popover opens and never in a
// pass. the map is the session's: rust keeps the same answers keyed the
// same way, so a relaunch starts empty on both sides. a refusal (not
// the owner) closes the popover that asked and says so through onError
export const useTraffic = (onError: (e: unknown) => void): TrafficState => {
	const [byRepo, setByRepo] = useState<Map<string, Traffic>>(new Map());
	const [loading, setLoading] = useState<Set<string>>(new Set());
	const [popover, setPopover] = useState<TrafficAnchor | null>(null);

	const fetch = (repo: GithubRepo, force: boolean) => {
		const full = repo.full_name;
		setLoading(s => new Set(s).add(full));
		invoke<Traffic>('get_repo_traffic', { fullName: full, force })
			.then(t => setByRepo(m => new Map(m).set(full, t)))
			.catch(e => {
				onError(e);
				setPopover(p => (p?.repo.full_name === full ? null : p));
			})
			.finally(() =>
				setLoading(s => {
					const next = new Set(s);
					next.delete(full);
					return next;
				})
			);
	};

	// always through rust: inside the hour it answers from memory with
	// no gh spawn, and the popover shows the last numbers meanwhile
	const open = (repo: GithubRepo, x?: number, y?: number) => {
		setPopover({ repo, x: x ?? null, y: y ?? null });
		fetch(repo, false);
	};
	const refresh = () => {
		if (popover) fetch(popover.repo, true);
	};
	const close = () => setPopover(null);

	return { byRepo, loading, popover, open, refresh, close };
};
