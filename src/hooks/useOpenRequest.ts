import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { projectForPath } from '../paths';

// what to do with a folder named on the command line, once it is known
export type OpenOutcome<T> =
	| { kind: 'select'; project: T }
	| { kind: 'refused'; message: string }
	| { kind: 'unknown'; message: string };

export const openOutcome = <T extends { full_path: string }>(
	req: OpenRequest,
	projects: T[]
): OpenOutcome<T> => {
	if (req.error) return { kind: 'refused', message: req.error };
	const project = projectForPath(projects, req.path);
	if (project) return { kind: 'select', project };
	return {
		kind: 'unknown',
		message: `${req.path} is not a project DevGo knows. Add the folder it is in as a workspace to see it here`
	};
};

// `devgo <folder>`: the backend holds the folder a launch named until it
// is asked for - this window's own on mount, a second launch's after
// devgo://open-request - and it waits here until the project list has
// loaded, so it is matched against rows and not an empty list. take is a
// take: a remount never acts on the same folder twice
export const useOpenRequest = <T extends { full_path: string }>(
	projects: T[],
	loading: boolean,
	onOutcome: (o: OpenOutcome<T>) => void
) => {
	const [ask, setAsk] = useState<OpenRequest | null>(null);

	useEffect(() => {
		const take = () =>
			invoke<OpenRequest | null>('take_open_request')
				.then(r => {
					if (r) setAsk(r);
				})
				.catch(() => {});
		take();
		const unlisten = listen('devgo://open-request', take);
		return () => {
			unlisten.then(f => f()).catch(() => {});
		};
	}, []);

	useEffect(() => {
		if (!ask || loading) return;
		setAsk(null);
		onOutcome(openOutcome(ask, projects));
	}, [ask, loading, projects]);
};
