import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTargets } from './useTargets';

// same boundary the component tests stub: one import, no wrapper layer. this
// hook is nothing BUT that boundary — every write ends in a reload — so every
// test here asserts on the call log and on what came back through it
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

const target = (
	id: string,
	kind: TargetKind,
	over: Partial<LaunchTarget> = {}
): LaunchTarget => ({
	id,
	name: id,
	kind,
	executable: `${id}.exe`,
	args_template: '{path}',
	wsl_executable: null,
	wsl_args_template: null,
	run_args_template: null,
	wsl_run_args_template: null,
	reveal_args_template: null,
	...over
});

// one place that decides what each command answers; a test changes the list
// or the defaults it cares about and inherits the rest. `then` is the second
// answer get_targets gives, which is how a reload-after-write is observed
const wire = (over: {
	targets?: LaunchTarget[];
	then?: LaunchTarget[];
	defaults?: [string, string][];
	fail?: string[];
} = {}) => {
	let reads = 0;
	invoke.mockImplementation((cmd: string) => {
		if (over.fail?.includes(cmd)) return Promise.reject(new Error(cmd));
		if (cmd === 'get_targets') {
			reads += 1;
			const list =
				reads > 1 && over.then ? over.then : (over.targets ?? []);
			return Promise.resolve(list);
		}
		if (cmd === 'get_default_targets') return Promise.resolve(over.defaults ?? []);
		if (cmd === 'detect_targets') return Promise.resolve([]);
		return Promise.resolve(null);
	});
};

const called = (cmd: string) =>
	invoke.mock.calls.filter(c => (c as unknown[])[0] === cmd).length;

const argsOf = (cmd: string) =>
	invoke.mock.calls.find(c => (c as unknown[])[0] === cmd)?.[1];

// a macrotask inside act: the mount reload is a Promise.all of two invokes
// followed by two setStates, and only a turn of the event loop is guaranteed
// to have drained that chain
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

// the registry is read on mount, so no test starts until that landed
const mounted = async () => {
	const h = renderHook(() => useTargets());
	await waitFor(() => expect(called('get_default_targets')).toBe(1));
	await settle();
	return h;
};

afterEach(() => vi.restoreAllMocks());
beforeEach(() => invoke.mockReset());

describe('useTargets — what it reads on mount', () => {
	it('reads the registry and the resolved defaults, once each', async () => {
		wire({ targets: [target('code', 'editor')] });
		const { result } = await mounted();

		expect(called('get_targets')).toBe(1);
		expect(called('get_default_targets')).toBe(1);
		expect(result.current.editors.map(t => t.id)).toEqual(['code']);
	});

	// the header comment's reason for get_default_targets existing at all: a
	// default can name a target the user has since deleted, and the fallback
	// chain lives in rust. the hook must NOT second-guess the answer, or there
	// are two chains
	it('trusts the default rust resolved even when the id is not in the list', async () => {
		wire({ targets: [target('code', 'editor')], defaults: [['editor', 'nvim']] });
		const { result } = await mounted();

		expect(result.current.defaults.editor).toBe('nvim');
	});

	it('splits the registry by kind, and spells the file manager file_manager', async () => {
		wire({
			targets: [
				target('code', 'editor'),
				target('wt', 'terminal'),
				target('claude', 'agent'),
				target('explorer', 'file_manager')
			]
		});
		const { result } = await mounted();

		expect(result.current.editors.map(t => t.id)).toEqual(['code']);
		expect(result.current.terminals.map(t => t.id)).toEqual(['wt']);
		expect(result.current.agents.map(t => t.id)).toEqual(['claude']);
		expect(result.current.fileManagers.map(t => t.id)).toEqual(['explorer']);
	});

	// swallowed on purpose: `reload().catch(() => {})`. an empty registry is a
	// rendering the panels already handle, an unhandled rejection is not
	it('leaves the lists empty when the registry read fails', async () => {
		wire({ fail: ['get_targets'] });
		const { result } = renderHook(() => useTargets());

		await waitFor(() => expect(called('get_targets')).toBe(1));
		expect(result.current.editors).toEqual([]);
		expect(result.current.defaults).toEqual({});
	});
});

// otherAgent is what the alt key launches, so getting it wrong sends the
// second agent shortcut to the same program as the first
describe('useTargets — the alt key’s agent', () => {
	it('is the first agent that is not the default', async () => {
		wire({
			targets: [target('claude', 'agent'), target('codex', 'agent')],
			defaults: [['agent', 'claude']]
		});
		const { result } = await mounted();

		expect(result.current.otherAgent?.id).toBe('codex');
	});

	it('is nothing at all when the only agent is the default', async () => {
		wire({ targets: [target('claude', 'agent')], defaults: [['agent', 'claude']] });
		const { result } = await mounted();

		expect(result.current.otherAgent).toBeUndefined();
	});

	// no default set yet: every id differs from undefined, so the first agent
	// is both the default launch and the alt launch. current behaviour, and
	// the panel's job to not offer alt until a default exists
	it('falls back to the first agent when no default has been chosen', async () => {
		wire({ targets: [target('claude', 'agent'), target('codex', 'agent')] });
		const { result } = await mounted();

		expect(result.current.otherAgent?.id).toBe('claude');
	});
});

describe('useTargets — adding a target by hand', () => {
	// the id the form cannot know: the store mints it. an empty string is the
	// agreed placeholder, and sending anything else would let the ui pick ids
	it('posts an empty id and lets the store mint the real one', async () => {
		wire({ targets: [] });
		const { result } = await mounted();

		await act(async () => {
			await result.current.addTarget({
				name: 'Zed',
				kind: 'editor',
				executable: 'zed.exe',
				args_template: '{path}',
				wsl_executable: null,
				wsl_args_template: null,
				run_args_template: null,
				wsl_run_args_template: null,
				reveal_args_template: null
			});
		});

		expect(argsOf('add_target')).toEqual({
			target: {
				id: '',
				name: 'Zed',
				kind: 'editor',
				executable: 'zed.exe',
				args_template: '{path}',
				wsl_executable: null,
				wsl_args_template: null,
				run_args_template: null,
				wsl_run_args_template: null,
				reveal_args_template: null
			}
		});
	});

	// "every write ends in a reload rather than patching local state" — so the
	// list on screen is the store's, including whatever the store did to it
	it('re-reads the registry instead of patching the list it holds', async () => {
		wire({ targets: [], then: [target('zed', 'editor', { name: 'Zed' })] });
		const { result } = await mounted();

		expect(result.current.editors).toEqual([]);
		await act(async () => {
			await result.current.addTarget({
				name: 'Zed',
				kind: 'editor',
				executable: 'zed.exe',
				args_template: '{path}',
				wsl_executable: null,
				wsl_args_template: null,
				run_args_template: null,
				wsl_run_args_template: null,
				reveal_args_template: null
			});
		});

		expect(called('get_targets')).toBe(2);
		expect(result.current.editors.map(t => t.id)).toEqual(['zed']);
	});

	// the await is before the reload, so a refused write must reach the caller
	// (the form shows it) and must NOT be followed by a reload that would make
	// the failure look like a no-op
	it('lets a refused add reach the caller and does not re-read', async () => {
		wire({ targets: [], fail: ['add_target'] });
		const { result } = await mounted();

		await expect(
			result.current.addTarget({
				name: 'Zed',
				kind: 'editor',
				executable: '',
				args_template: '{path}',
				wsl_executable: null,
				wsl_args_template: null,
				run_args_template: null,
				wsl_run_args_template: null,
				reveal_args_template: null
			})
		).rejects.toThrow('add_target');
		expect(called('get_targets')).toBe(1);
	});
});

describe('useTargets — detection', () => {
	// "proposes only: nothing is written until addDetected is called". a detect
	// that reloaded would imply something changed, and a detect that wrote
	// would register every program on the machine
	it('writes nothing and re-reads nothing', async () => {
		wire({ targets: [target('code', 'editor')] });
		const { result } = await mounted();

		await act(async () => {
			await result.current.detect();
		});

		expect(called('detect_targets')).toBe(1);
		expect(called('get_targets')).toBe(1);
		expect(called('add_target')).toBe(0);
		expect(called('add_detected_target')).toBe(0);
	});

	// ⛔ the whole reason DetectedTarget is not posted back: LaunchTarget
	// carries no run templates for a detected terminal, so a round trip would
	// strip them and the target's first run_script would fail. by id only
	it('adds a detected target by id, never by posting the target back', async () => {
		wire({ targets: [], then: [target('wt', 'terminal')] });
		const { result } = await mounted();

		await act(async () => {
			await result.current.addDetected('path:wt');
		});

		expect(argsOf('add_detected_target')).toEqual({ id: 'path:wt' });
		expect(called('add_target')).toBe(0);
		expect(called('get_targets')).toBe(2);
		expect(result.current.terminals.map(t => t.id)).toEqual(['wt']);
	});
});

describe('useTargets — removing and defaulting', () => {
	it('names the id it removes and re-reads what survived', async () => {
		wire({
			targets: [target('code', 'editor'), target('zed', 'editor')],
			then: [target('code', 'editor')]
		});
		const { result } = await mounted();

		await act(async () => {
			await result.current.removeTarget('zed');
		});

		expect(argsOf('remove_target')).toEqual({ id: 'zed' });
		expect(result.current.editors.map(t => t.id)).toEqual(['code']);
	});

	// the store may refuse a removal (the last editor, say); the refusal has
	// to surface rather than being swallowed into a reload
	it('lets a refused removal reach the caller and does not re-read', async () => {
		wire({ targets: [target('code', 'editor')], fail: ['remove_target'] });
		const { result } = await mounted();

		await expect(result.current.removeTarget('code')).rejects.toThrow(
			'remove_target'
		);
		expect(called('get_targets')).toBe(1);
	});

	it('names the kind and the id it defaults, and the alt agent follows', async () => {
		let defaults: [string, string][] = [['agent', 'claude']];
		invoke.mockImplementation((cmd: string, args?: unknown) => {
			if (cmd === 'get_targets')
				return Promise.resolve([target('claude', 'agent'), target('codex', 'agent')]);
			if (cmd === 'get_default_targets') return Promise.resolve(defaults);
			if (cmd === 'set_default_target') {
				const a = args as { kind: TargetKind; id: string };
				defaults = [[a.kind, a.id]];
				return Promise.resolve(null);
			}
			return Promise.resolve(null);
		});
		const { result } = await mounted();

		expect(result.current.otherAgent?.id).toBe('codex');
		await act(async () => {
			await result.current.setDefaultTarget('agent', 'codex');
		});

		expect(argsOf('set_default_target')).toEqual({ kind: 'agent', id: 'codex' });
		expect(result.current.defaults.agent).toBe('codex');
		expect(result.current.otherAgent?.id).toBe('claude');
	});
});
