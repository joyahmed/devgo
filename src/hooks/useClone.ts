import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';

// the clone queue. jobs run one at a time: the rust command returns as
// soon as its thread starts, so sequencing is this hook's job, and it
// starts the next queued job when devgo://clone-done arrives for the
// current one. a refusal (destination exists, distro stopped) fails that
// job at once and the queue moves on; nothing is retried on its own.
// every ending, the refusals too, reaches onDone — exactly once per job
export const useClone = (onDone: (done: CloneDone) => void): CloneState => {
	const [jobs, setJobs] = useState<Map<string, CloneJob>>(new Map());
	// refs, so the listeners below see the live queue without resubscribing
	const queue = useRef<CloneJob[]>([]);
	const running = useRef<string | null>(null);
	const onDoneRef = useRef(onDone);
	useEffect(() => {
		onDoneRef.current = onDone;
	});
	// ⛔ THE STALENESS GUARD. clone_repo's answer is provisional — rust picks
	// the folder before the clone runs and clone-done carries the one it landed
	// in — so an answer is only worth applying while the start it belongs to is
	// still the current one. every start takes a ticket; an ending or a restart
	// takes it away, and an answer holding a spent ticket is dropped. keyed by
	// full_name is NOT enough on its own: a retry makes the same repo current
	// again, and attempt one's answer would land on attempt two's row
	const ticket = useRef<Map<string, number>>(new Map());
	const issued = useRef(0);
	// ⛔ ONE ENDING PER JOB. the caller adds the cloned folder to a workspace
	// off the back of onDone, so a second report is a second add of the same
	// folder. two writers can reach it for one job — the .catch below, where
	// rust refused clone_repo outright and no event is ever coming, and the
	// clone-done listener, which a repeated event reaches twice on its own.
	// the FIRST ending is the ending, on the row as well as in the report.
	// cleared in enqueue: picking the same repo again is a new job
	const ended = useRef<Set<string>>(new Set());

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
		const mine = ++issued.current;
		ticket.current.set(job.full_name, mine);
		// this start is still the one the job is waiting on
		const current = () => ticket.current.get(job.full_name) === mine;
		update(job.full_name, { status: 'running', phase: 'Starting', percent: null });
		invoke<CloneStarted>('clone_repo', {
			fullName: job.full_name,
			workspace: job.workspace,
			name: null
		})
			.then(started => {
				if (!current()) return;
				update(job.full_name, { dest: started.dest });
			})
			.catch(e => {
				// a refusal is stale the same way an answer is: a job that has
				// already ended must not be re-failed, and must not release the
				// queue a second time — that is two git processes at once
				if (!current()) return;
				const error = String(e);
				update(job.full_name, { status: 'failed', error });
				ended.current.add(job.full_name);
				onDoneRef.current({
					full_name: job.full_name,
					ok: false,
					dest: job.workspace,
					error
				});
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
		// a fresh job for a repo that already ended gets its own ending
		for (const j of fresh) ended.current.delete(j.full_name);
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
			// the ending takes the ticket: whatever clone_repo still owes this
			// job is stale from here on
			ticket.current.delete(payload.full_name);
			// this job has already ended: a repeat is not a second ending
			if (ended.current.has(payload.full_name)) return;
			ended.current.add(payload.full_name);
			update(payload.full_name, {
				status: payload.ok ? 'done' : 'failed',
				dest: payload.dest,
				error: payload.error,
				percent: payload.ok ? 100 : null
			});
			onDoneRef.current(payload);
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
