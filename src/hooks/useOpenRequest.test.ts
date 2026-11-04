import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openOutcome, useOpenRequest } from './useOpenRequest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

let onOpen: (() => Promise<void> | void) | null = null;
const unlisten = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
	listen: (name: string, cb: () => Promise<void> | void) => {
		if (name === 'devgo://open-request') onOpen = cb;
		return Promise.resolve(unlisten);
	}
}));

const rows = [{ full_path: '/home/alex/projects/devgo' }];

beforeEach(() => {
	invoke.mockReset();
	onOpen = null;
	unlisten.mockReset();
});

describe('openOutcome', () => {
	it('selects the row the folder names', () => {
		expect(openOutcome({ path: '/home/alex/projects/devgo/src', error: null }, rows)).toEqual({
			kind: 'select',
			project: rows[0]
		});
	});

	it('passes a refusal through as written', () => {
		expect(openOutcome({ path: 'x', error: 'x does not exist' }, rows)).toEqual({
			kind: 'refused',
			message: 'x does not exist'
		});
	});

	it('says plainly that a folder is not a known project', () => {
		const o = openOutcome({ path: '/home/alex/elsewhere', error: null }, rows);
		expect(o.kind).toBe('unknown');
		expect(o.kind === 'unknown' && o.message).toContain('/home/alex/elsewhere is not a project');
	});
});

describe('useOpenRequest', () => {
	it('acts on the first launch folder once the list has loaded, not before', async () => {
		invoke.mockResolvedValueOnce({ path: '/home/alex/projects/devgo', error: null });
		const seen = vi.fn();
		const { rerender } = renderHook(
			({ loading }) => useOpenRequest(rows, loading, seen),
			{ initialProps: { loading: true } }
		);
		await waitFor(() => expect(invoke).toHaveBeenCalledWith('take_open_request'));
		expect(seen).not.toHaveBeenCalled();
		rerender({ loading: false });
		await waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
		expect(seen.mock.calls[0][0]).toEqual({ kind: 'select', project: rows[0] });
	});

	it('does nothing on a plain launch', async () => {
		invoke.mockResolvedValue(null);
		const seen = vi.fn();
		renderHook(() => useOpenRequest(rows, false, seen));
		await waitFor(() => expect(invoke).toHaveBeenCalled());
		expect(seen).not.toHaveBeenCalled();
	});

	it('takes a second launch folder when the event fires', async () => {
		invoke.mockResolvedValueOnce(null);
		const seen = vi.fn();
		renderHook(() => useOpenRequest(rows, false, seen));
		await waitFor(() => expect(onOpen).not.toBeNull());
		invoke.mockResolvedValueOnce({ path: '/nope', error: '/nope does not exist' });
		await act(async () => {
			await onOpen?.();
		});
		await waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
		expect(seen.mock.calls[0][0]).toEqual({ kind: 'refused', message: '/nope does not exist' });
		expect(invoke).toHaveBeenCalledTimes(2);
	});

	it('stops listening on unmount', async () => {
		invoke.mockResolvedValue(null);
		const { unmount } = renderHook(() => useOpenRequest(rows, false, vi.fn()));
		await waitFor(() => expect(onOpen).not.toBeNull());
		unmount();
		await waitFor(() => expect(unlisten).toHaveBeenCalled());
	});
});
