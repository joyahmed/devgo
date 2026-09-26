import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

// the panel's own copies of Settings' two text classes. importing them from
// Settings.tsx would be a cycle — Settings imports this file — and exporting
// them out of a third module for two strings is worse than four lines here
const heading = 'text-15 font-semibold text-text-primary mb-2';
const hint = 'text-13 text-text-muted max-w-[76ch]';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

// decimal, not binary: every number here came out of `du -sb`, and the
// backup script's own LATEST_STATUS writes 3.3M for the same bytes
const bytes = (n: number | null) => {
	if (n === null) return '—';
	let v = n;
	let i = 0;
	while (v >= 1000 && i < UNITS.length - 1) {
		v /= 1000;
		i += 1;
	}
	return `${i === 0 ? v : v.toFixed(1)} ${UNITS[i]}`;
};

// ServersLane's, verbatim: the servers card and this panel read the same
// listed_at out of the same cache, and two spellings of "4 h ago" between
// two surfaces reading one number is how a user stops trusting either
const ago = (secs: number) => {
	const d = Math.max(0, Math.floor(Date.now() / 1000) - secs);
	if (d < 60) return 'just now';
	if (d < 3600) return `${Math.floor(d / 60)} min ago`;
	if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
	return `${Math.floor(d / 86400)} d ago`;
};

// ⭐ severity is carried by the WORD first and the glyph second, and only
// then by the hue — WslDoctor's rule, and this panel needs it more, not
// less: the one job with no copy off the box sits in a list of jobs that
// are fine, and a row whose only difference is rose-vs-white ink says
// nothing at all to anyone reading in greyscale
type OffsiteState = 'present' | 'none' | 'unknown';

const OFFSITE: Record<
	OffsiteState,
	{ glyph: string; word: string; cls: string }
> = {
	present: {
		glyph: '●',
		word: 'Off-site',
		cls: 'text-text-secondary border-border'
	},
	none: {
		glyph: '▲',
		word: 'No off-site copy',
		cls: 'text-danger border-danger'
	},
	unknown: {
		glyph: '○',
		word: 'Off-site not reported',
		cls: 'text-text-muted border-border'
	}
};

// ⛔ the mapping that is the whole point: null is NOT false. null means
// nothing on that box said either way — no log to read and a tool that
// could have made a copy — and calling that "no off-site copy" is the
// same lie one level up as calling a missing backups key one
const offsiteState = (job: ServerBackupJob): OffsiteState =>
	job.offsite === true ? 'present' : job.offsite === false ? 'none' : 'unknown';

// the dot: ServersLane's three, and they land on the same three readings.
// hollow = never asked / nothing said, emerald = up, bg-danger = down
const STATUS_DOT: Record<string, string> = {
	success: 'bg-emerald-400',
	failed: 'bg-danger'
};
const statusDot = (s: string) => STATUS_DOT[s] ?? 'border border-text-muted';

/// One directory of kept copies: when it last filled, how big, how many
/// are kept, and whether anything leaves the box.
const BackupJobRow = ({ job }: BackupJobProps) => {
	const state = offsiteState(job);
	const { glyph, word, cls } = OFFSITE[state];
	return (
		<li className='flex flex-col gap-1 px-3 py-2 bg-bg-panel rounded-control'>
			<div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
				<span
					aria-hidden='true'
					className={`shrink-0 self-center size-2 rounded-full ${statusDot(job.last_status)}`}
					title={`Last run ${job.last_status}`}
				/>
				<span className='text-13 text-text-primary'>{job.name}</span>
				<span className='font-mono text-11 text-text-muted break-all'>
					{job.dir}
				</span>
				<span
					className={`ml-auto shrink-0 text-11 font-semibold rounded-control border px-1.5 py-0.5 ${cls}`}
				>
					<span aria-hidden='true'>{glyph}</span> {word}
				</span>
			</div>
			<p className='text-11 text-text-muted'>
				{job.last_run === null ? 'never run' : `last run ${ago(job.last_run)}`} ·{' '}
				{bytes(job.size_bytes)} · {job.retained} kept · {job.last_status}
				{state === 'present' && (
					<>
						{' · '}
						{job.offsite_target ?? 'a remote'}
						{job.offsite_last !== null && ` ${ago(job.offsite_last)}`}
					</>
				)}
			</p>
			{state === 'none' && (
				<p className='text-11 text-text-primary'>
					The box's own log for this job records nothing leaving it. Everything
					here dies with the disk.
				</p>
			)}
			{state === 'unknown' && (
				<p className='text-11 text-text-muted'>
					Nothing on the box said either way — this job keeps no log the
					contract could read. Not a finding.
				</p>
			)}
		</li>
	);
};

/// One server. ⭐ Three readings, and the first two must never be drawn
/// alike: a box whose contract has no `backups` key has not been asked,
/// and telling its owner their backups are unprotected — when the only
/// thing that happened is that they customised their own script — is
/// worse than saying nothing, because after the second false alarm the
/// true one is not read either.
const BackupServer = ({ server, listing }: BackupServerProps) => {
	const b = listing?.inventory?.backups;
	const reported = b?.known === true;
	const warn = reported
		? b.jobs.filter(j => j.offsite === false).length
		: 0;

	return (
		<section>
			<div className='flex flex-wrap items-baseline gap-x-3'>
				<h5 className='text-13 font-semibold text-text-primary'>
					{server.name}
				</h5>
				<span className='text-11 text-text-muted'>
					{server.user ? `${server.user}@` : ''}
					{server.host}
				</span>
				{listing && (
					<span className='text-11 text-text-muted'>
						listed {ago(listing.listed_at)}
					</span>
				)}
				{warn > 0 && (
					<span className='ml-auto text-11 font-semibold text-danger'>
						<span aria-hidden='true'>▲</span> {warn} without an off-site copy
					</span>
				)}
			</div>

			{!listing ? (
				<p className={`${hint} italic mt-1`}>
					Not listed yet. Expand this server in the Servers lane and its
					contract is read on the same ssh.
				</p>
			) : !reported ? (
				// ⛔ NEUTRAL, deliberately. no warning colour, no glyph, no
				// count. the contract on this box does not carry the key, so
				// this panel knows nothing about its backups — which is not
				// the same finding as knowing there are none
				<p className={`${hint} mt-1`}>
					This box's <code className='text-text-secondary'>
						~/scripts/devgo-inventory.sh
					</code>{' '}
					does not report backups. It is an older copy, or one edited here —
					devgo never overwrites an edited script. Nothing is wrong; devgo
					simply has not been told. Copy{' '}
					<code className='text-text-secondary'>server/devgo-inventory.sh</code>{' '}
					from this repo onto the box to have it answer.
				</p>
			) : b.jobs.length === 0 ? (
				<p className={`${hint} italic mt-1`}>
					The contract looked and found nothing kept on this box.
				</p>
			) : (
				<ul className='flex flex-col gap-1 mt-1'>
					{b.jobs.map(j => (
						<BackupJobRow key={`${j.dir}-${j.name}`} {...{ job: j }} />
					))}
				</ul>
			)}
		</section>
	);
};

/// What each server already backs up, as a Settings panel.
///
/// ⭐ read-only, and it opens no connection of its own: both commands it
/// calls are cache reads, and the backups section itself rides the one
/// ssh the Servers lane already makes. Nothing here runs, verifies or
/// restores a backup, and nothing here mutates anything on any box.
///
/// ⚠️ per server, never a single verdict. Two boxes have opposite gaps —
/// one keeps copies and sends them off-site, the other keeps copies and
/// sends nothing — and one green "Backups: OK" over the pair is a lie
/// about both.
const Backups = ({ onError }: BackupsProps) => {
	// null until the cache has answered. rendering "no servers" during the
	// round trip would tell the opposite of the truth for a frame
	const [servers, setServers] = useState<Server[] | null>(null);
	const [listings, setListings] = useState<Record<string, ServerListing>>({});

	// AppError serialises to a string, so anything that is not one is an
	// IPC fault and is worth seeing verbatim
	const fail = (e: unknown) => onError(typeof e === 'string' ? e : String(e));

	useEffect(() => {
		invoke<Server[]>('get_servers')
			.then(setServers)
			.catch(e => {
				fail(e);
				setServers([]);
			});
		invoke<Record<string, ServerListing>>('get_server_listings')
			.then(setListings)
			.catch(fail);
	}, []);

	if (servers === null) return <p className={hint}>Reading the cache…</p>;

	return (
		<div className='flex flex-col gap-5'>
			<section>
				<h4 className={heading}>Backups</h4>
				<p className={hint}>
					What each box says it keeps, read out of the inventory contract on
					the same ssh the Servers lane already makes — a stat, an ls and a
					tail of a log that is already on that disk. Nothing here asks a
					remote anything, and nothing here runs, verifies or restores a
					backup.
				</p>
			</section>

			{servers.length === 0 ? (
				<p className={`${hint} italic`}>No servers yet.</p>
			) : (
				<div className='flex flex-col gap-5'>
					{servers.map(s => (
						<BackupServer
							key={s.id}
							{...{ server: s, listing: listings[s.id] }}
						/>
					))}
				</div>
			)}
		</div>
	);
};

export default Backups;
