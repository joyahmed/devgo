import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WslDoctor from './WslDoctor';

// the panel's whole contract is WHICH of two rust commands it calls and
// WHEN, so the mock answers per command name and every test asserts on the
// call log rather than on a promise it handed in
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

const RUNTIME = (wsl_available: boolean): RuntimeInfo => ({
	runtime: 'windows',
	wsl_available,
	distros: wsl_available ? ['Ubuntu'] : [],
	default_distro: wsl_available ? 'Ubuntu' : null,
	local_fs: 'C:'
});

const CONFIG: WslConfigReport = {
	path: 'C:\\Users\\joy\\.wslconfig',
	exists: true,
	reason: null,
	host_memory_bytes: 34359738368,
	host_processors: 16,
	findings: []
};

const EMPTY_READINGS: WslReadings = {
	zones: [],
	meminfo: {
		total_bytes: null,
		free_bytes: null,
		available_bytes: null,
		cached_bytes: null,
		swap_total_bytes: null,
		swap_free_bytes: null
	},
	failures: []
};

// one place that decides what each command answers, so a test changes the
// one report it cares about and inherits the rest
const wire = (over: {
	runtime?: RuntimeInfo;
	config?: WslConfigReport;
	frag?: WslFragmentationReport;
}) =>
	invoke.mockImplementation((cmd: string) => {
		if (cmd === 'get_runtime_info') return Promise.resolve(over.runtime ?? RUNTIME(true));
		if (cmd === 'wsl_config_report') return Promise.resolve(over.config ?? CONFIG);
		if (cmd === 'wsl_fragmentation')
			return Promise.resolve(
				over.frag ?? {
					distro: 'Ubuntu',
					reason: null,
					readings: EMPTY_READINGS,
					findings: []
				}
			);
		return Promise.resolve(null);
	});

const called = (cmd: string) =>
	invoke.mock.calls.filter(c => (c as unknown[])[0] === cmd).length;

afterEach(cleanup);
beforeEach(() => invoke.mockReset());

describe('WslDoctor — which probe runs when', () => {
	// ⛔ the rule the rust module's own header states: the fragmentation
	// probe spawns wsl.exe and stalls on a wedged WSLService. a panel that
	// fires it on open hangs the settings drawer on exactly the machine the
	// panel exists to diagnose
	it('never calls wsl_fragmentation on mount, and reads .wslconfig there instead', async () => {
		wire({});
		render(<WslDoctor onError={() => {}} />);

		await screen.findByText('Run the probe');
		expect(called('wsl_config_report')).toBe(1);
		expect(called('wsl_fragmentation')).toBe(0);
	});

	it('calls wsl_fragmentation with a null distro when the button is pressed', async () => {
		const user = userEvent.setup();
		wire({});
		render(<WslDoctor onError={() => {}} />);

		await user.click(await screen.findByText('Run the probe'));
		await waitFor(() => expect(called('wsl_fragmentation')).toBe(1));
		expect(
			invoke.mock.calls.find(c => (c as unknown[])[0] === 'wsl_fragmentation')?.[1]
		).toEqual({ distro: null });
	});
});

describe('WslDoctor — the machine has no WSL', () => {
	// the commands return valid, empty, degraded reports on a mac rather
	// than failing, so nothing downstream would ever tell the user why the
	// panel is blank. the gate is wsl_available, not an error
	it('says so and reads no report at all', async () => {
		wire({ runtime: RUNTIME(false) });
		render(<WslDoctor onError={() => {}} />);

		expect(await screen.findByText('No WSL on this machine')).not.toBeNull();
		expect(called('wsl_config_report')).toBe(0);
		expect(called('wsl_fragmentation')).toBe(0);
	});
});

describe('WslDoctor — a probe that read nothing', () => {
	// `reason` is the rust side saying "there was nothing to look at and I
	// did not start a distro to make some". showing zone tables of zeros
	// under it would read as a healthy machine
	it('shows the stated reason instead of empty readings', async () => {
		const user = userEvent.setup();
		wire({
			frag: {
				distro: null,
				reason: 'No distro is running, and DevGo will not start one to look.',
				readings: EMPTY_READINGS,
				findings: []
			}
		});
		render(<WslDoctor onError={() => {}} />);

		await user.click(await screen.findByText('Run the probe'));
		expect(
			await screen.findByText(
				'No distro is running, and DevGo will not start one to look.'
			)
		).not.toBeNull();
		expect(screen.queryByText('Free lists')).toBeNull();
		expect(screen.queryByText('Memory')).toBeNull();
	});

	it('renders the readings when there is no reason', async () => {
		const user = userEvent.setup();
		wire({
			frag: {
				distro: 'Ubuntu',
				reason: null,
				readings: {
					...EMPTY_READINGS,
					zones: [
						{
							node: '0',
							name: 'Normal',
							free_blocks: [512, 64, 8, 2, 0, 0],
							free_bytes: 3221225472,
							largest_free_order: 3,
							high_order_bytes: 0
						}
					]
				},
				findings: []
			}
		});
		render(<WslDoctor onError={() => {}} />);

		await user.click(await screen.findByText('Run the probe'));
		expect(await screen.findByText('Free lists')).not.toBeNull();
		// the order-4 column at zero is the whole diagnosis: pages free,
		// no 64 KiB run left
		expect(screen.getByTitle('order 4: 0 free runs of 16 pages')).not.toBeNull();
	});
});

describe('WslDoctor — .wslconfig has three states, never two', () => {
	// ⭐ THE distinction. "the file is not there" and "I could not look" are
	// different sentences about the machine, and the panel used to print the
	// first one for both. inside WSL that made it assert a healthy default
	// configuration for C:\Users\<you>\.wslconfig, which it never opened
	it('shows the stated reason and makes no claim about the defaults', async () => {
		wire({
			config: {
				path: '',
				exists: false,
				reason:
					'DevGo is not running on Windows, so it cannot reach %USERPROFILE%\\.wslconfig.',
				host_memory_bytes: null,
				host_processors: null,
				findings: []
			}
		});
		render(<WslDoctor onError={() => {}} />);

		expect(
			await screen.findByText(
				'DevGo is not running on Windows, so it cannot reach %USERPROFILE%\\.wslconfig.'
			)
		).not.toBeNull();
		expect(screen.queryByText('absent — WSL is on its defaults')).toBeNull();
		// no File/Host grid either — a column of dashes reads as a reading
		expect(screen.queryByText('Host memory')).toBeNull();
		expect(screen.queryByText('What the file says')).toBeNull();
	});

	// and the other half of the distinction: a Windows box that really has
	// no .wslconfig still gets told so. a reason-less report is a read one
	it('still says the file is absent when the path was actually looked at', async () => {
		wire({
			config: {
				...CONFIG,
				exists: false,
				reason: null,
				findings: [
					{
						severity: 'info',
						line: null,
						text: 'no .wslconfig',
						problem: 'there is no file here, so WSL is running on its defaults',
						fix: 'half this machine’s memory and every logical processor'
					}
				]
			}
		});
		render(<WslDoctor onError={() => {}} />);

		expect(
			await screen.findByText('absent — WSL is on its defaults')
		).not.toBeNull();
		expect(screen.getByText('Host memory')).not.toBeNull();
	});
});

describe('WslDoctor — severity is readable without colour', () => {
	const findings: WslFinding[] = [
		{
			severity: 'error',
			line: 7,
			text: 'memory=8GB',
			problem: 'This key is under [experimental] and never applies.',
			fix: 'Move it under [wsl2].'
		},
		{
			severity: 'warning',
			line: null,
			text: '',
			problem: 'No .wslconfig, so WSL takes half the host memory.',
			fix: 'Write one if that is not what you want.'
		},
		{
			severity: 'info',
			line: null,
			text: '',
			problem: 'Host has 32 GiB.',
			fix: 'Nothing to do.'
		}
	];

	// ⭐ hue alone is not a distinction — greyscale, and the two most
	// common kinds of colour blindness, both collapse rose against white.
	// each row has to NAME its severity
	it('names each severity in words, not only in ink', async () => {
		wire({ config: { ...CONFIG, findings } });
		render(<WslDoctor onError={() => {}} />);

		expect(await screen.findByText('Error')).not.toBeNull();
		expect(screen.getByText('Warning')).not.toBeNull();
		expect(screen.getByText('Info')).not.toBeNull();
	});

	it('puts the .wslconfig line number beside the line it quotes', async () => {
		wire({ config: { ...CONFIG, findings } });
		render(<WslDoctor onError={() => {}} />);

		expect(await screen.findByText('memory=8GB')).not.toBeNull();
		expect(screen.getByText('7:')).not.toBeNull();
	});

	// an empty findings array is a result, not a missing one
	it('says nothing to report rather than showing a blank list', async () => {
		wire({});
		render(<WslDoctor onError={() => {}} />);

		expect(await screen.findByText('Nothing to report.')).not.toBeNull();
	});
});
