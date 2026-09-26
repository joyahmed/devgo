import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import Button from './Button';

// the panel's own copies of Settings' two text classes. importing them from
// Settings.tsx would be a cycle — Settings imports this file — and exporting
// them out of a third module for two strings is worse than four lines here
const heading = 'text-15 font-semibold text-text-primary mb-2';
const hint = 'text-13 text-text-muted max-w-[76ch]';

// the probe failing is not the same as there being no WSL, but the panel
// cannot sit on "Checking…" for the rest of the session. onError says what
// actually happened; this is the honest floor to render under it
const NO_WSL: RuntimeInfo = {
	runtime: 'windows',
	wsl_available: false,
	distros: [],
	default_distro: null,
	local_fs: ''
};

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

// binary units on purpose: every number here came out of /proc or out of
// GlobalMemoryStatusEx, and the kernel counts in pages of 4096
const bytes = (n: number | null) => {
	if (n === null) return '—';
	let v = n;
	let i = 0;
	while (v >= 1024 && i < UNITS.length - 1) {
		v /= 1024;
		i += 1;
	}
	return `${i === 0 ? v : v.toFixed(1)} ${UNITS[i]}`;
};

// ⭐ severity is carried by the WORD first and the glyph second, and only
// then by the hue. a row whose only difference from the row above it is
// rose-vs-white ink is a row that says nothing to anyone reading in
// greyscale, and the whole point of this panel is the one finding that is
// an error sitting in a list of nine that are not
const SEVERITY: Record<WslSeverity, { glyph: string; word: string; cls: string }> = {
	error: { glyph: '✕', word: 'Error', cls: 'text-danger border-danger' },
	warning: { glyph: '▲', word: 'Warning', cls: 'text-text-primary border-border-strong' },
	info: { glyph: '●', word: 'Info', cls: 'text-text-muted border-border' }
};

/// One finding: the line it read, what is wrong with it, what to do. Three
/// blocks rather than one sentence, because the quote wants monospace and
/// the advice does not.
const WslFindingRow = ({ finding }: WslFindingProps) => {
	const { glyph, word, cls } = SEVERITY[finding.severity];
	return (
		<li className='flex gap-3 px-3 py-2 bg-bg-panel rounded-control'>
			<span
				className={`shrink-0 self-start text-11 font-semibold rounded-control border px-1.5 py-0.5 ${cls}`}
			>
				<span aria-hidden='true'>{glyph}</span> {word}
			</span>
			<div className='min-w-0 flex flex-col gap-1'>
				{finding.text && (
					<code className='font-mono text-13 text-text-secondary break-all'>
						{finding.line !== null && (
							<span className='text-text-muted'>{finding.line}: </span>
						)}
						{finding.text}
					</code>
				)}
				<p className='text-13 text-text-primary'>{finding.problem}</p>
				<p className='text-13 text-text-muted'>{finding.fix}</p>
			</div>
		</li>
	);
};

/// A list of findings, or the sentence that says there were none. An empty
/// list is a result — it is the doctor saying it looked.
const WslFindings = ({ findings }: WslFindingsProps) =>
	findings.length === 0 ? (
		<p className={`${hint} italic`}>Nothing to report.</p>
	) : (
		<ul className='flex flex-col gap-1'>
			{findings.map((f, i) => (
				<WslFindingRow key={`${f.severity}-${f.line}-${i}`} {...{ finding: f }} />
			))}
		</ul>
	);

/// One zone's free lists. The chips are the buddy allocator itself: `4:0`
/// means no free run of sixteen contiguous pages is left in this zone,
/// which is the reading that says fragmented rather than out of memory.
const WslZoneRow = ({ zone }: WslZoneProps) => (
	<div className='px-3 py-2 bg-bg-panel rounded-control'>
		<div className='flex flex-wrap items-baseline justify-between gap-x-3'>
			<span className='text-13 text-text-primary'>
				node {zone.node} · {zone.name}
			</span>
			<span className='text-11 text-text-muted'>
				{bytes(zone.free_bytes)} free · {bytes(zone.high_order_bytes)} of it in
				runs of 64 KiB or more · largest run{' '}
				{zone.largest_free_order === null
					? 'none'
					: `2^${zone.largest_free_order} pages`}
			</span>
		</div>
		<div className='mt-1 flex flex-wrap gap-1 font-mono text-11'>
			{zone.free_blocks.map((count, order) => (
				<span
					key={order}
					title={`order ${order}: ${count} free runs of ${2 ** order} pages`}
					className='px-1 rounded-control border border-border text-text-secondary'
				>
					{order}:{count}
				</span>
			))}
		</div>
	</div>
);

const MEM_ROWS: { label: string; key: keyof WslMeminfo }[] = [
	{ label: 'Total', key: 'total_bytes' },
	{ label: 'Free', key: 'free_bytes' },
	{ label: 'Available', key: 'available_bytes' },
	{ label: 'Cached', key: 'cached_bytes' },
	{ label: 'Swap total', key: 'swap_total_bytes' },
	{ label: 'Swap free', key: 'swap_free_bytes' }
];

/// The WSL doctor, as a Settings panel.
///
/// ⭐ neither command it calls mutates anything and neither one rejects: a
/// mac gets a valid report that says there is nothing here, and a stopped
/// distro comes back as a stated `reason`. So there are no confirmations to
/// ask for and no error states to wait for — every "failure" arrives as
/// data and is rendered as a sentence.
///
/// ⛔ the two calls are NOT alike. `wsl_config_report` reads one text file
/// and spawns nothing, so it runs the moment the panel opens.
/// `wsl_fragmentation` runs a read-only bash probe inside the distro and
/// stalls for as long as a wedged WSLService takes to answer, so it runs
/// on a press and never on a clock.
const WslDoctor = ({ onError }: WslDoctorProps) => {
	// null until the machine has answered. three states, and the first one
	// matters: rendering "no WSL here" during the round trip would tell a
	// Windows user the opposite of the truth for a frame
	const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
	const [config, setConfig] = useState<WslConfigReport | null>(null);
	const [frag, setFrag] = useState<WslFragmentationReport | null>(null);
	const [probing, setProbing] = useState(false);

	// AppError serialises to a string, so anything that is not one is an IPC
	// fault and is worth seeing verbatim
	const fail = (e: unknown) => onError(typeof e === 'string' ? e : String(e));

	useEffect(() => {
		invoke<RuntimeInfo>('get_runtime_info')
			.then(setRuntime)
			.catch(e => {
				fail(e);
				setRuntime(NO_WSL);
			});
	}, []);

	const wsl = runtime?.wsl_available === true;

	useEffect(() => {
		if (!wsl) return;
		invoke<WslConfigReport>('wsl_config_report').then(setConfig).catch(fail);
	}, [wsl]);

	const probe = () => {
		setProbing(true);
		invoke<WslFragmentationReport>('wsl_fragmentation', { distro: null })
			.then(setFrag)
			.catch(fail)
			.finally(() => setProbing(false));
	};

	if (runtime === null)
		return <p className={hint}>Checking this machine for WSL…</p>;

	if (!wsl)
		return (
			<div>
				<h4 className={heading}>No WSL on this machine</h4>
				<p className={hint}>
					The doctor reads two things: the Windows file{' '}
					<code className='text-text-secondary'>.wslconfig</code>, and the
					kernel's free lists inside a running WSL distro. Neither exists here,
					so there is nothing to read and nothing is wrong. The panel comes
					back by itself on a machine that has WSL installed.
				</p>
			</div>
		);

	const configRows = (c: WslConfigReport) => [
		{ label: 'Path', value: c.path, mono: true },
		{
			label: 'File',
			value: c.exists ? 'present' : 'absent — WSL is on its defaults',
			mono: false
		},
		{ label: 'Host memory', value: bytes(c.host_memory_bytes), mono: false },
		{
			label: 'Host processors',
			value: c.host_processors === null ? '—' : String(c.host_processors),
			mono: false
		}
	];

	return (
		<div className='flex flex-col gap-6'>
			<section>
				<h4 className={heading}>.wslconfig</h4>
				<p className={`${hint} mb-3`}>
					The file, never the running VM. A key under the wrong heading leaves
					no trace in WSL's behaviour — it simply never applies, which is why
					it goes unnoticed for weeks. Read when this panel opened; nothing
					here is ever written.
				</p>
				{config === null ? (
					<p className={`${hint} italic`}>Reading…</p>
				) : (
					<div className='flex flex-col gap-3'>
						<dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-13'>
							{configRows(config).map(r => (
								<div key={r.label} className='contents'>
									<dt className='text-text-muted'>{r.label}</dt>
									<dd
										className={`min-w-0 break-all text-text-secondary ${
											r.mono ? 'font-mono' : ''
										}`}
									>
										{r.value}
									</dd>
								</div>
							))}
						</dl>
						<WslFindings {...{ findings: config.findings }} />
					</div>
				)}
			</section>

			<section>
				<h4 className={heading}>Memory fragmentation</h4>
				<p className={`${hint} mb-3`}>
					Free pages are not free <em>runs</em> of pages: an allocation that
					needs sixteen contiguous ones can fail while gigabytes sit free in
					single-page scraps, and it dies without a word from the OOM killer.
					This reads <code className='text-text-secondary'>/proc/buddyinfo</code>
					, <code className='text-text-secondary'>/proc/meminfo</code> and the
					kernel ring inside a distro that is <em>already</em> running —
					read-only, no sudo, and it will not start one to look.
				</p>
				<p className={`${hint} mb-3`}>
					It runs on this button and never on a clock: a wedged WSLService
					makes the call stall for as long as it takes to answer.
				</p>
				<Button
					variant='primary'
					className='self-start'
					disabled={probing}
					onClick={probe}
				>
					{probing ? 'Probing…' : frag === null ? 'Run the probe' : 'Probe again'}
				</Button>

				{frag === null ? (
					<p className={`${hint} italic mt-3`}>Not run yet.</p>
				) : frag.reason !== null ? (
					// a stated reason is the whole answer. rendering empty zone
					// tables under it would read as "healthy" when nothing was read
					<p className='text-13 text-text-primary mt-3 max-w-[76ch]'>
						{frag.reason}
					</p>
				) : (
					<div className='flex flex-col gap-4 mt-3'>
						<p className='text-13 text-text-secondary'>
							Read inside{' '}
							<span className='font-mono'>
								{frag.distro ?? 'the default distro'}
							</span>
							.
						</p>

						<div>
							<h5 className='text-13 font-semibold text-text-primary mb-1'>
								Memory
							</h5>
							<dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-13'>
								{MEM_ROWS.map(m => (
									<div key={m.key} className='contents'>
										<dt className='text-text-muted'>{m.label}</dt>
										<dd className='font-mono text-text-secondary'>
											{bytes(frag.readings.meminfo[m.key])}
										</dd>
									</div>
								))}
							</dl>
						</div>

						<div>
							<h5 className='text-13 font-semibold text-text-primary mb-1'>
								Free lists
							</h5>
							{frag.readings.zones.length === 0 ? (
								<p className={`${hint} italic`}>
									No zones came back from /proc/buddyinfo.
								</p>
							) : (
								<div className='flex flex-col gap-1'>
									{frag.readings.zones.map(z => (
										<WslZoneRow key={`${z.node}-${z.name}`} {...{ zone: z }} />
									))}
								</div>
							)}
						</div>

						{frag.readings.failures.length > 0 && (
							<div>
								<h5 className='text-13 font-semibold text-text-primary mb-1'>
									Allocation failures already in the kernel ring
								</h5>
								<p className={`${hint} mb-1`}>
									These are crashes that have happened, not a forecast.
								</p>
								<ul className='flex flex-col gap-1'>
									{frag.readings.failures.map((f, i) => (
										<li
											key={`${f.order}-${i}`}
											className='px-3 py-1.5 bg-bg-panel rounded-control'
										>
											<span className='text-11 font-semibold text-danger'>
												order {f.order}
											</span>{' '}
											<code className='font-mono text-11 text-text-secondary break-all'>
												{f.text}
											</code>
										</li>
									))}
								</ul>
							</div>
						)}

						<WslFindings {...{ findings: frag.findings }} />
					</div>
				)}
			</section>
		</div>
	);
};

export default WslDoctor;
