import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AboutPanel from './AboutPanel';

// the panel's whole new contract is one line of text: v<version> and, when
// the build carried one, the git revision beside it. so both seams are
// mocked per test and every assertion is on the rendered string — a sha
// that is missing, empty or 'unknown' must leave the version alone, with no
// dangling separator and no "undefined"
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

const getVersion = vi.fn();
vi.mock('@tauri-apps/api/app', () => ({
	getVersion: () => getVersion()
}));

// the name heading holds the mark, the name and the version span; its
// textContent is what a reader sees, whitespace collapsed. by name, not by
// level: HelpSection's titles are h4 too, so a bare heading query is
// ambiguous
const line = () =>
	screen
		.getByRole('heading', { name: /DevGo/ })
		.textContent?.replace(/\s+/g, ' ');

beforeEach(() => {
	invoke.mockReset();
	getVersion.mockReset();
	getVersion.mockResolvedValue('1.2.2');
});

describe('AboutPanel version line', () => {
	it('renders the git sha next to the version', async () => {
		invoke.mockResolvedValue('d3ba24c');
		render(<AboutPanel />);
		expect(await screen.findByText(/d3ba24c/)).toBeTruthy();
		expect(line()).toContain('v1.2.2 · d3ba24c');
		expect(invoke).toHaveBeenCalledWith('get_git_sha');
	});

	it('shows the version alone when the sha command fails', async () => {
		invoke.mockRejectedValue(new Error('no such command'));
		render(<AboutPanel />);
		expect(await screen.findByText(/v1\.2\.2/)).toBeTruthy();
		expect(line()).toContain('v1.2.2');
		expect(line()).not.toContain('·');
		expect(line()).not.toContain('undefined');
	});

	it.each(['', '   ', 'unknown'])(
		'shows the version alone when the sha is %j',
		async answer => {
			invoke.mockResolvedValue(answer);
			render(<AboutPanel />);
			expect(await screen.findByText(/v1\.2\.2/)).toBeTruthy();
			expect(line()).not.toContain('·');
			expect(line()).not.toContain('unknown');
			expect(line()).not.toContain('undefined');
		}
	);
});
