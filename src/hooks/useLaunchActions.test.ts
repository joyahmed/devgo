import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaunchActions } from './useLaunchActions';

// the same one-import seam every other test in this tree uses. here it is the
// whole point: this hook is the launch lane and it holds no state at all, so
// the ONLY thing it can get wrong is the payload it puts on the wire — the
// command name, the key spellings, and whether it fires at all. the v1.2.1
// PATH bug shipped because nothing on either side of this boundary asserted
// on the shape crossing it
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

const proj = (name: string): Project => ({
	name,
	full_path: `C:/dev/${name}`,
	workspace: 'C:/dev',
	file_system: 'windows'
});

const server = (id: string, over: Partial<Server> = {}): Server => ({
	id,
	name: id,
	alias: null,
	host: `${id}.example`,
	user: null,
	port: null,
	identity: null,
	default_path: null,
	tmux: false,
	session: null,
	tunnel: false,
	source: 'manual',
	roots: [],
	...over
});

const refresh = vi.fn();

// the hook takes the selection as an argument, so a test that cares about the
// selection changing re-renders with new props rather than calling a setter
const mounted = (selected: Project | null = null) =>
	renderHook(({ sel }: { sel: Project | null }) => useLaunchActions(sel, refresh), {
		initialProps: { sel: selected }
	});

const calls = () => invoke.mock.calls as [string, Record<string, unknown>][];
const only = () => {
	expect(calls()).toHaveLength(1);
	return calls()[0];
};

beforeEach(() => {
	invoke.mockReset();
	invoke.mockResolvedValue(null);
	refresh.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('useLaunchActions — the workspace writes', () => {
	it('names the path and re-reads the projects after the write landed', async () => {
		const { result } = mounted();
		let seen: number[] = [];
		refresh.mockImplementation(() => seen.push(calls().length));

		await act(async () => {
			await result.current.addWorkspace('D:/work');
		});

		expect(only()).toEqual(['add_workspace', { path: 'D:/work' }]);
		// the refresh is awaited behind the write, not fired beside it: a
		// rescan that starts before the root is registered scans the old list
		expect(seen).toEqual([1]);
	});

	// the row's position, not its path: the store owns the ordering and the ui
	// must not re-derive a path it would then have to keep in step
	it('removes a workspace by index and re-reads after', async () => {
		const { result } = mounted();

		await act(async () => {
			await result.current.removeWorkspace(2);
		});

		expect(only()).toEqual(['remove_workspace', { index: 2 }]);
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	// ⛔ a refused write must not be followed by a refresh: a rescan that finds
	// nothing changed renders as "it worked", which is the worst reading of a
	// rejected add
	it('lets a refused write reach the caller and does not re-read', async () => {
		invoke.mockRejectedValue(new Error('not a directory'));
		const { result } = mounted();

		await expect(result.current.addWorkspace('D:/nope')).rejects.toThrow(
			'not a directory'
		);
		expect(refresh).not.toHaveBeenCalled();
	});
});

describe('useLaunchActions — which project a launch acts on', () => {
	// "buttons and shortcuts act on the selection, a context menu on its own
	// row": the argument is the row, and it wins
	it('sends the row it was handed, not the selection', () => {
		const { result } = mounted(proj('selected'));

		result.current.openEditor(proj('right-clicked'));

		expect(only()[1]).toEqual({
			project: proj('right-clicked'),
			targetId: null
		});
	});

	it('falls back to the selection when handed nothing', () => {
		const { result } = mounted(proj('selected'));

		result.current.openEditor();

		expect((only()[1] as { project: Project }).project.name).toBe('selected');
	});

	// ⛔ the guard that stops a launch with no subject. every one of these is
	// reachable by keyboard before anything is selected, and rust's handler
	// would be handed `project: null`
	it('launches nothing at all when there is no row and no selection', async () => {
		const { result } = mounted(null);

		await act(async () => {
			await Promise.all([
				result.current.openEditor(),
				result.current.openTerminal(),
				result.current.openAgent(),
				result.current.openBoth()
			]);
		});

		expect(invoke).not.toHaveBeenCalled();
	});

	// the callers await these, so the empty case has to be awaitable too
	it('still answers a promise when it launched nothing', async () => {
		const { result } = mounted(null);
		await expect(result.current.openTerminal()).resolves.toBeUndefined();
	});

	it('follows the selection when it changes under the same hook', () => {
		const { result, rerender } = mounted(proj('first'));

		rerender({ sel: proj('second') });
		result.current.openTerminal();

		expect((only()[1] as { project: Project }).project.name).toBe('second');
	});

	// a launch is not a write: nothing on screen changed, and a rescan on
	// every keypress would spawn wsl.exe per launch
	it('does not re-read the projects on a launch', () => {
		const { result } = mounted(proj('a'));

		result.current.openEditor();
		result.current.openTerminal();
		result.current.openAgent();

		expect(refresh).not.toHaveBeenCalled();
	});
});

// ⛔ the contract tsc cannot see and cargo test never saw: the command name
// and the exact keys. a renamed key arrives in rust as a missing field, and
// the fallback chain quietly picks the default target instead of the one the
// user clicked
describe('useLaunchActions — the payload on the wire', () => {
	const p = proj('app');

	it.each([
		['openEditor', 'open_editor'],
		['openTerminal', 'open_terminal'],
		['openAgent', 'open_agent']
	] as const)('%s sends %s with the project and a null targetId', (fn, cmd) => {
		const { result } = mounted(p);

		(result.current[fn] as (project?: Project) => unknown)();

		expect(only()).toEqual([cmd, { project: p, targetId: null }]);
	});

	// omitted means "the default, resolved in rust". null is how that is
	// spelled on the wire — NOT an absent key, and never a guessed id
	it.each([
		['openEditor', 'open_editor'],
		['openTerminal', 'open_terminal'],
		['openAgent', 'open_agent']
	] as const)('%s passes an explicit target id through untouched', (fn, cmd) => {
		const { result } = mounted(p);

		(result.current[fn] as (project?: Project, targetId?: string) => unknown)(
			undefined,
			'path:wt'
		);

		expect(only()).toEqual([cmd, { project: p, targetId: 'path:wt' }]);
	});

	// ⛔ openBoth is the odd one: two ids, and NEITHER of them is spelled
	// targetId. sending targetId here would resolve both halves to the default
	it('openBoth sends editorId and terminalId, not targetId', () => {
		const { result } = mounted(p);

		result.current.openBoth(undefined, 'code', 'path:wt');

		expect(only()).toEqual([
			'open_both',
			{ project: p, editorId: 'code', terminalId: 'path:wt' }
		]);
	});

	it('openBoth nulls each half independently', () => {
		const { result } = mounted(p);

		result.current.openBoth(undefined, undefined, 'path:wt');

		expect(only()[1]).toEqual({
			project: p,
			editorId: null,
			terminalId: 'path:wt'
		});
	});

	// ⛔ the asymmetry that no type error would ever catch: a project launch
	// sends the whole record, a server launch sends the id ALONE. rust reads
	// the server out of the store, so posting the record back would let a
	// stale row in the ui launch against details the store has since changed
	it('openServer sends the id only, never the server record', async () => {
		const { result } = mounted(null);
		invoke.mockResolvedValue('ssh box.example');

		await result.current.openServer(server('srv-1', { host: 'stale.example' }));

		expect(only()).toEqual([
			'open_server',
			{ id: 'srv-1', targetId: null, via: null, preview: false }
		]);
	});

	// preview is the read-only door: the same command answers with the line
	// and must not launch. defaulting it to true would make every click a
	// no-op; defaulting it to false is what the launch depends on
	it('openServer defaults preview to false and returns the line rust built', async () => {
		const { result } = mounted(null);
		invoke.mockResolvedValue('ssh -p 2222 joy@box.example');

		const line = await result.current.openServer(server('srv-1'));

		expect(line).toBe('ssh -p 2222 joy@box.example');
		expect((only()[1] as { preview: boolean }).preview).toBe(false);
	});

	it('openServer asks for a preview without launching when told to', async () => {
		const { result } = mounted(null);
		invoke.mockResolvedValue('ssh box.example');

		await result.current.openServer(server('srv-1'), undefined, true);

		expect((only()[1] as { preview: boolean }).preview).toBe(true);
	});

	// via picks psmux or wsl through the chosen terminal; both ride the same
	// host object and both have to arrive, or the line runs in the wrong place
	it('openServer carries the host’s target id and via together', async () => {
		const { result } = mounted(null);
		invoke.mockResolvedValue('');

		await result.current.openServer(server('srv-1'), {
			id: 'path:wt',
			name: 'Windows Terminal',
			targetId: 'path:wt',
			via: 'psmux'
		});

		expect(only()[1]).toEqual({
			id: 'srv-1',
			targetId: 'path:wt',
			via: 'psmux',
			preview: false
		});
	});

	// a host with neither set is the plain terminal case, and it must spell
	// both absences null rather than leaving the keys off
	it('openServer nulls the target id and via when the host names neither', async () => {
		const { result } = mounted(null);
		invoke.mockResolvedValue('');

		await result.current.openServer(server('srv-1'), {
			id: 'terminal',
			name: 'Windows Terminal'
		});

		expect(only()[1]).toEqual({
			id: 'srv-1',
			targetId: null,
			via: null,
			preview: false
		});
	});

	// ⛔ there is no selection guard on this one, by design: a server row is
	// always its own subject. it must launch with no project selected at all
	it('openServer needs no selected project', async () => {
		const { result } = mounted(null);
		invoke.mockResolvedValue('');

		await result.current.openServer(server('srv-1'));

		expect(calls()).toHaveLength(1);
	});
});

describe('useLaunchActions — a launch that rust refused', () => {
	// the footer shows the error; swallowing it here would render a failed
	// launch as a successful one
	it('hands the rejection to the caller', async () => {
		invoke.mockRejectedValue('no editor configured');
		const { result } = mounted(proj('app'));

		await expect(result.current.openEditor()).rejects.toBe(
			'no editor configured'
		);
	});
});
