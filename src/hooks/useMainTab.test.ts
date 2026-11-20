import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { STACK_TAB_EVENT, useMainTab } from './useMainTab';

const handlers = new Map<string, () => void>();
const unlisten = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
	listen: (name: string, cb: () => void) => {
		handlers.set(name, cb);
		return Promise.resolve(unlisten);
	}
}));

describe('useMainTab', () => {
	it('opens on Projects, switches, and the stack-tab event lands on Stack', async () => {
		const { result, unmount } = renderHook(() => useMainTab());
		expect(result.current.tab).toBe('projects');
		await waitFor(() => expect(handlers.has(STACK_TAB_EVENT)).toBe(true));
		act(() => handlers.get(STACK_TAB_EVENT)!());
		expect(result.current.tab).toBe('stack');
		act(() => result.current.setTab('projects'));
		expect(result.current.tab).toBe('projects');
		unmount();
		await waitFor(() => expect(unlisten).toHaveBeenCalled());
	});
});
