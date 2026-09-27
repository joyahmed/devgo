import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useClone } from './useClone';

// the same seam every other hook test here uses: one stub over the rust
// boundary, answering per command name
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

// clone_repo returns as soon as its thread starts, so the two events ARE the
// hook's state machine. the mock keeps the names it subscribed to (a rust
// contract tsc cannot see) and hands each test a way to emit one
const subscribed: string[] = [];
const unlisten = vi.fn();
const handlers = new Map<string, (p: unknown) => void>();
vi.mock('@tauri-apps/api/event', () => ({
	listen: (name: string, handler: (e: { payload: unknown }) => void) => {
		subscribed.push(name);
		handlers.set(name, p => handler({ payload: p }));
		return Promise.resolve(unlisten);
	}
}));

// ⛔ the microtask drain INSIDE the act is the point, and it is why these are
// async: the clone-done handler starts the next job, and clone_repo's answer
// lands its `.then(setJobs)` a microtask later. a synchronous `act(() => …)`
// has already exited by then, so that setState was an update outside act — the
// warning src/test-setup.ts arms. same shape as `push` below
const progress = async (p: CloneProgress) => {
	await act(async () => {
		handlers.get('devgo://clone-progress')?.(p);
		await Promise.resolve();
	});
};
const finished = async (p: CloneDone) => {
	await act(async () => {
		handlers.get('devgo://clone-done')?.(p);
		await Promise.resolve();
	});
};

const repo = (full_name: string): GithubRepo => ({
	full_name,
	name: full_name.split('/')[1] ?? full_name,
	owner: full_name.split('/')[0] ?? '',
	url: `https://github.com/${full_name}`,
	updated_at: '2026-09-01T00:00:00Z',
	private: false,
	archived: false,
	default_branch: 'main',
	added: false,
	stars: null
});

const started = (full_name: string, dest: string): CloneStarted => ({
	full_name,
	dest,
	protocol: 'ssh'
});

const onDone = vi.fn();

// the listeners subscribe in an effect, so nothing is emittable until the two
// listen promises have been handed back
const mounted = async () => {
	const h = renderHook(() => useClone(onDone));
	await waitFor(() => expect(subscribed).toHaveLength(2));
	await act(async () => {
		await new Promise(r => setTimeout(r, 0));
	});
	return h;
};

const cloneCalls = () =>
	invoke.mock.calls.filter(c => c[0] === 'clone_repo') as [
		string,
		{ fullName: string; workspace: string; name: null }
	][];

const job = (h: { result: { current: CloneState } }, full_name: string) =>
	h.result.current.jobs.get(full_name);

type Mounted = { result: { current: CloneState } };

// enqueue, then let clone_repo's answer land. rust answers before it emits a
// single event, so a test that fires clone-done first is testing an ordering
// that cannot happen - and the last test in this file says what it would do
const push = async (h: Mounted, repos: GithubRepo[], workspace = 'C:/dev') => {
	await act(async () => {
		h.result.current.enqueue(repos, workspace);
		await Promise.resolve();
	});
};

beforeEach(() => {
	invoke.mockReset();
	invoke.mockResolvedValue(started('x', 'C:/dev/x'));
	onDone.mockReset();
	unlisten.mockReset();
	subscribed.length = 0;
	handlers.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('useClone — the queue runs one job at a time', () => {
	// ⛔ the whole reason this hook exists. clone_repo returns the moment its
	// thread starts, so N calls in a loop would be N concurrent git clones
	// against the same disk — and against the same distro on a wsl workspace
	it('starts only the first of a batch and queues the rest', async () => {
		const h = await mounted();

		await push(h, [repo('a/one'), repo('a/two'), repo('a/three')]);

		expect(cloneCalls()).toHaveLength(1);
		expect(cloneCalls()[0][1].fullName).toBe('a/one');
		expect(job(h, 'a/one')?.status).toBe('running');
		expect(job(h, 'a/two')?.status).toBe('queued');
		expect(job(h, 'a/three')?.status).toBe('queued');
	});

	// a second selection while one is running joins the same queue rather
	// than starting beside it
	it('does not start a job enqueued while another is running', async () => {
		const h = await mounted();

		await push(h, [repo('a/one')]);
		await push(h, [repo('a/two')]);

		expect(cloneCalls()).toHaveLength(1);
		expect(job(h, 'a/two')?.status).toBe('queued');
	});

	// every row shows a phase from the first frame; "Queued" then "Starting"
	// is what the user reads as the queue draining
	it('rows start as Queued and the running one says Starting', async () => {
		const h = await mounted();

		await push(h, [repo('a/one'), repo('a/two')]);

		expect(job(h, 'a/one')?.phase).toBe('Starting');
		expect(job(h, 'a/one')?.percent).toBeNull();
		expect(job(h, 'a/two')?.phase).toBe('Queued');
	});

	it('an empty batch starts nothing', async () => {
		const h = await mounted();

		await push(h, []);

		expect(cloneCalls()).toHaveLength(0);
		expect(h.result.current.jobs.size).toBe(0);
	});

	// ⛔ the wire contract: the job field is full_name, the rust argument is
	// fullName, and `name: null` is how "let rust pick the folder" is spelled.
	// none of the three is visible to tsc
	it('spells the payload fullName / workspace / name:null', async () => {
		const h = await mounted();

		await push(h, [repo('joy/devgo')], 'D:/work');

		expect(cloneCalls()[0][1]).toEqual({
			fullName: 'joy/devgo',
			workspace: 'D:/work',
			name: null
		});
	});

	// the destination is rust's to decide (it de-duplicates a name that is
	// already on disk), so the row takes the answer rather than guessing
	it('takes the destination clone_repo answered with', async () => {
		invoke.mockResolvedValue(started('joy/devgo', 'D:/work/devgo-2'));
		const h = await mounted();

		await push(h, [repo('joy/devgo')], 'D:/work');
		await waitFor(() => expect(job(h, 'joy/devgo')?.dest).toBe('D:/work/devgo-2'));
		// and it is still running: the dest arriving is not the clone ending
		expect(job(h, 'joy/devgo')?.status).toBe('running');
	});
});

describe('useClone — the events it listens on', () => {
	it('subscribes to the two devgo clone events by name', async () => {
		await mounted();
		expect(subscribed).toEqual(['devgo://clone-progress', 'devgo://clone-done']);
	});

	it('gives both listeners back on unmount', async () => {
		const h = await mounted();
		h.unmount();
		await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(2));
	});

	it('moves phase and percent onto the named row only', async () => {
		const h = await mounted();
		await push(h, [repo('a/one'), repo('a/two')]);

		await progress({ full_name: 'a/one', phase: 'Receiving objects', percent: 42 });

		expect(job(h, 'a/one')?.phase).toBe('Receiving objects');
		expect(job(h, 'a/one')?.percent).toBe(42);
		// still running: progress is not an ending
		expect(job(h, 'a/one')?.status).toBe('running');
		expect(job(h, 'a/two')?.phase).toBe('Queued');
	});

	// ⛔ the `if (cur)` guard in update(). rust emits per clone, and an event
	// for a full_name this hook never enqueued must not conjure a row with
	// nothing but a phase on it — the picker renders every key in the map
	it('ignores an event for a repo it never enqueued', async () => {
		const h = await mounted();
		await push(h, [repo('a/one')]);

		await progress({ full_name: 'ghost/repo', phase: 'Receiving objects', percent: 9 });
		await finished({
			full_name: 'ghost/repo',
			ok: true,
			dest: 'C:/dev/repo',
			error: null
		});

		expect([...h.result.current.jobs.keys()]).toEqual(['a/one']);
	});
});

describe('useClone — how a job ends', () => {
	it('marks a finished job done, at 100, at the destination rust reports', async () => {
		const h = await mounted();
		await push(h, [repo('a/one')]);

		await finished({
			full_name: 'a/one',
			ok: true,
			dest: 'C:/dev/one',
			error: null
		});

		expect(job(h, 'a/one')).toMatchObject({
			status: 'done',
			percent: 100,
			dest: 'C:/dev/one',
			error: null
		});
	});

	// ⛔ a failed clone must NOT be left showing whatever percent it reached:
	// a red row at 63% reads as still working
	it('marks a failed job failed, clears the percent and keeps the reason', async () => {
		const h = await mounted();
		await push(h, [repo('a/one')]);
		await progress({ full_name: 'a/one', phase: 'Receiving objects', percent: 63 });

		await finished({
			full_name: 'a/one',
			ok: false,
			dest: 'C:/dev/one',
			error: 'authentication failed'
		});

		expect(job(h, 'a/one')).toMatchObject({
			status: 'failed',
			percent: null,
			error: 'authentication failed'
		});
	});

	// "every ending, the refusals too, reaches onDone" — the caller adds the
	// cloned folder to a workspace off the back of this
	it.each([true, false])('reports the ending to the caller (ok=%s)', async ok => {
		const h = await mounted();
		await push(h, [repo('a/one')]);
		const payload: CloneDone = {
			full_name: 'a/one',
			ok,
			dest: 'C:/dev/one',
			error: ok ? null : 'boom'
		};

		await finished(payload);

		expect(onDone).toHaveBeenCalledTimes(1);
		expect(onDone).toHaveBeenCalledWith(payload);
	});

	// ⛔ ONE ENDING PER JOB. the caller adds the cloned folder to a workspace
	// off the back of onDone, so a second report is a second add of the same
	// folder. the `running.current === payload.full_name` guard below stops a
	// repeated event pulling the next job forward, but it sits AFTER the
	// report and never guarded the report itself
	it('reports a repeated ending for the same job only once', async () => {
		const h = await mounted();
		await push(h, [repo('a/one')]);
		const ending: CloneDone = {
			full_name: 'a/one',
			ok: true,
			dest: 'C:/dev/one',
			error: null
		};

		await finished(ending);
		await finished(ending);

		expect(onDone).toHaveBeenCalledTimes(1);
	});

	// per JOB, not per repo forever: picking the same repo again is a new job
	// and its ending is the caller's to hear
	it('reports the ending again for a repo enqueued a second time', async () => {
		const h = await mounted();
		await push(h, [repo('a/one')]);
		await finished({ full_name: 'a/one', ok: true, dest: 'C:/dev/one', error: null });

		await push(h, [repo('a/one')]);
		await finished({ full_name: 'a/one', ok: true, dest: 'C:/dev/one-2', error: null });

		expect(onDone).toHaveBeenCalledTimes(2);
		expect(job(h, 'a/one')?.dest).toBe('C:/dev/one-2');
	});

	// ⛔ the queue draining is the whole contract: a batch of five that stops
	// after one is the failure this sequencing exists to avoid
	it('starts the next queued job when the current one ends', async () => {
		const h = await mounted();
		await push(h, [repo('a/one'), repo('a/two')]);

		await finished({ full_name: 'a/one', ok: true, dest: 'C:/dev/one', error: null });

		expect(cloneCalls()).toHaveLength(2);
		expect(cloneCalls()[1][1].fullName).toBe('a/two');
		expect(job(h, 'a/two')?.status).toBe('running');
	});

	it('drains the whole batch, in the order it was enqueued', async () => {
		const h = await mounted();
		await push(h, [repo('a/one'), repo('a/two'), repo('a/three')]);

		for (const n of ['a/one', 'a/two', 'a/three'])
			await finished({ full_name: n, ok: true, dest: `C:/dev/${n}`, error: null });

		expect(cloneCalls().map(c => c[1].fullName)).toEqual([
			'a/one',
			'a/two',
			'a/three'
		]);
	});

	// "the queue moves on" past a refusal: one bad repo in a selection of
	// twenty must not strand the other nineteen
	it('moves past a failed job to the next one', async () => {
		const h = await mounted();
		await push(h, [repo('a/one'), repo('a/two')]);

		await finished({
			full_name: 'a/one',
			ok: false,
			dest: 'C:/dev/one',
			error: 'destination exists'
		});

		expect(cloneCalls()).toHaveLength(2);
		expect(cloneCalls()[1][1].fullName).toBe('a/two');
	});

	// ⛔ the `running.current === payload.full_name` guard. a late event for a
	// job that already ended would otherwise pull the next job forward while
	// the current one is mid-clone, which is two git processes again
	it('does not pull the next job forward on an event for a job not running', async () => {
		const h = await mounted();
		await push(h, [repo('a/one'), repo('a/two'), repo('a/three')]);
		await finished({ full_name: 'a/one', ok: true, dest: 'C:/dev/one', error: null });
		expect(cloneCalls()).toHaveLength(2);

		// a/one is done and a/two is running, with a/three still queued: a
		// repeat of a/one's ending must not start a/three beside a/two
		await finished({ full_name: 'a/one', ok: true, dest: 'C:/dev/one', error: null });

		expect(cloneCalls()).toHaveLength(2);
		expect(job(h, 'a/two')?.status).toBe('running');
		expect(job(h, 'a/three')?.status).toBe('queued');
	});

	// nothing left in the queue: the last ending must not start a phantom job
	it('starts nothing once the queue is empty', async () => {
		const h = await mounted();
		await push(h, [repo('a/one')]);

		await finished({ full_name: 'a/one', ok: true, dest: 'C:/dev/one', error: null });

		expect(cloneCalls()).toHaveLength(1);
	});

	// the callback is held in a ref updated every render, so a parent that
	// re-renders with a fresh closure (the usual case — it captures the
	// workspace list) is heard, and a stale one is not
	it('reports to the latest callback, not the one from mount', async () => {
		const first = vi.fn();
		const second = vi.fn();
		const h = renderHook(({ cb }: { cb: (d: CloneDone) => void }) => useClone(cb), {
			initialProps: { cb: first }
		});
		await waitFor(() => expect(subscribed).toHaveLength(2));
		await push(h, [repo('a/one')]);

		h.rerender({ cb: second });
		await finished({ full_name: 'a/one', ok: true, dest: 'C:/dev/one', error: null });

		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});
});

// the refusal that never becomes an event: rust rejects clone_repo before a
// thread exists (destination exists, distro stopped), so this path has to
// finish the job by hand — and it is the only path that does
describe('useClone — a clone rust refused outright', () => {
	const refuse = (bad: string) =>
		invoke.mockImplementation((_cmd: string, args?: unknown) => {
			const a = args as { fullName: string; workspace: string };
			return a.fullName === bad
				? Promise.reject(new Error('destination already exists'))
				: Promise.resolve(started(a.fullName, `${a.workspace}/x`));
		});

	it('fails that job with the reason rust gave', async () => {
		refuse('a/one');
		const h = await mounted();

		await push(h, [repo('a/one')]);

		await waitFor(() => expect(job(h, 'a/one')?.status).toBe('failed'));
		expect(job(h, 'a/one')?.error).toBe('Error: destination already exists');
	});

	// ⛔ ok:false has to reach onDone here too, or a refused clone is silent:
	// no event is coming, so this is the only report the caller ever gets
	it('reports the refusal to the caller with the workspace as the dest', async () => {
		refuse('a/one');
		const h = await mounted();

		await push(h, [repo('a/one')]);

		await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
		expect(onDone).toHaveBeenCalledWith({
			full_name: 'a/one',
			ok: false,
			// there is no clone, so there is no destination: the workspace
			// stands in for it rather than an empty string
			dest: 'C:/dev',
			error: 'Error: destination already exists'
		});
	});

	it('releases the queue and starts the next job at once', async () => {
		refuse('a/one');
		const h = await mounted();

		await push(h, [repo('a/one'), repo('a/two')]);

		await waitFor(() => expect(cloneCalls()).toHaveLength(2));
		expect(cloneCalls()[1][1].fullName).toBe('a/two');
		expect(job(h, 'a/two')?.status).toBe('running');
	});

	// ⛔ the refusal IS the ending. rust rejecting clone_repo means no thread
	// started, so no clone-done can follow — but this is the one path where two
	// writers reach onDone for a single job, and an event arriving after it used
	// to be reported as a second ending AND flip the row to done while the
	// caller had already been told it failed. the first ending is the ending,
	// on the row as well as in the report
	it('does not report a refused job again if an event arrives for it', async () => {
		refuse('a/one');
		const h = await mounted();
		await push(h, [repo('a/one')]);
		await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

		await finished({ full_name: 'a/one', ok: true, dest: 'C:/dev/one', error: null });

		expect(onDone).toHaveBeenCalledTimes(1);
		expect(job(h, 'a/one')?.status).toBe('failed');
	});

});

// ⛔ clone_repo's answer is PROVISIONAL — rust picks the folder before the
// clone runs, and clone-done carries the destination the clone actually landed
// in. so the answer is only worth writing while the start it belongs to is
// still the current one; landing later it would point the row at a folder the
// clone did not use. rust answers before it emits anything, so a slow answer
// is what reproduces this, and the guard is what makes the order not matter
describe('useClone — a clone_repo answer that lands too late', () => {
	// each start gets its own resolver, so a test can answer attempt one after
	// attempt two has begun
	const slowly = () => {
		const answers: ((s: CloneStarted) => void)[] = [];
		invoke.mockImplementation(
			() => new Promise<CloneStarted>(r => void answers.push(r))
		);
		return answers;
	};

	// enqueue WITHOUT draining: clone_repo has not answered yet
	const pushUnanswered = async (h: Mounted, repos: GithubRepo[]) => {
		await act(async () => {
			h.result.current.enqueue(repos, 'C:/dev');
		});
	};

	it('keeps the destination the ending reported', async () => {
		const answers = slowly();
		const h = await mounted();
		await pushUnanswered(h, [repo('a/one')]);

		await finished({ full_name: 'a/one', ok: true, dest: 'C:/dev/one', error: null });
		expect(job(h, 'a/one')?.dest).toBe('C:/dev/one');

		await act(async () => {
			answers[0]?.(started('a/one', 'C:/dev/provisional'));
			await Promise.resolve();
		});

		expect(job(h, 'a/one')?.dest).toBe('C:/dev/one');
		expect(job(h, 'a/one')?.status).toBe('done');
	});

	// ⭐ why the guard cannot be "is this repo the running one": a retry makes
	// the same full_name running again, so attempt one's answer would be
	// written onto attempt two's row. the ticket is per START, not per repo
	it('keeps an earlier attempt at the same repo off the retry row', async () => {
		const answers = slowly();
		const h = await mounted();
		await pushUnanswered(h, [repo('a/one')]);

		// attempt one ends, then the user picks the same repo again
		await finished({
			full_name: 'a/one',
			ok: false,
			dest: 'C:/dev',
			error: 'destination exists'
		});
		await pushUnanswered(h, [repo('a/one')]);
		expect(cloneCalls()).toHaveLength(2);
		expect(job(h, 'a/one')?.status).toBe('running');

		await act(async () => {
			answers[0]?.(started('a/one', 'C:/dev/stale'));
			await Promise.resolve();
		});

		expect(job(h, 'a/one')?.dest).toBeNull();

		// and attempt two's own answer is still taken
		await act(async () => {
			answers[1]?.(started('a/one', 'C:/dev/one-2'));
			await Promise.resolve();
		});
		expect(job(h, 'a/one')?.dest).toBe('C:/dev/one-2');
	});
});
