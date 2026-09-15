import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';

// the clone queue. jobs run one at a time: the rust command returns as
// soon as its thread starts, so sequencing is this hook's job, and it
// starts the next queued job when devgo://clone-done arrives for the
// current one. a refusal (destination exists, distro stopped) fails that
// job at once and the queue moves on; nothing is retried on its own
export const useClone = (onCloned: (dest: string) => void): CloneState => {
	const [jobs, setJobs] = useState<Map<string, CloneJob>>(new Map());
	// refs, so the listeners below see the live queue without resubscribing
	const queue = useRef<CloneJob[]>([]);
	const running = useRef<string | null>(null);
	const onClonedRef = useRef(onCloned);
	useEffect(() => {
		onClonedRef.current = onCloned;
	});

	const update = (full_name: string, patch: Partial<CloneJob>) => {
		setJobs(prev => {
			const next = new Map(prev);
			const cur = next.get(full_name);
			if (cur) next.set(full_name, { ...cur, ...patch });
			return next;
		});
	};

	const startNext = () => {
		if (running.current) return;
		const job = queue.current.shift();
		if (!job) return;
		running.current = job.full_name;
		update(job.full_name, { status: 'running', phase: 'Starting', percent: null });
		invoke<CloneStarted>('clone_repo', {
			fullName: job.full_name,
			workspace: job.workspace,
			name: null
		})
			.then(started => update(job.full_name, { dest: started.dest }))
			.catch(e => {
				update(job.full_name, { status: 'failed', error: String(e) });
				running.current = null;
				startNext();
			});
	};

	const enqueue = (repos: GithubRepo[], workspace: string) => {
		const fresh: CloneJob[] = repos.map(r => ({
			full_name: r.full_name,
			workspace,
			status: 'queued',
			phase: 'Queued',
			percent: null,
			dest: null,
			error: null
		}));
		setJobs(prev => {
			const next = new Map(prev);
			for (const j of fresh) next.set(j.full_name, j);
			return next;
		});
		queue.current.push(...fresh);
		startNext();
	};

	useEffect(() => {
		const progress = listen<CloneProgress>(
			'devgo://clone-progress',
			({ payload }) =>
				update(payload.full_name, {
					phase: payload.phase,
					percent: payload.percent
				})
		);
		const done = listen<CloneDone>('devgo://clone-done', ({ payload }) => {
			update(payload.full_name, {
				status: payload.ok ? 'done' : 'failed',
				dest: payload.dest,
				error: payload.error,
				percent: payload.ok ? 100 : null
			});
			if (payload.ok) onClonedRef.current(payload.dest);
			if (running.current === payload.full_name) {
				running.current = null;
				startNext();
			}
		});
		return () => {
			progress.then(f => f()).catch(() => {});
			done.then(f => f()).catch(() => {});
		};
	}, []);

	return { jobs, enqueue };
};
