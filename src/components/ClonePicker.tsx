import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';
import { relativeTime } from '../github';
import { fuzzyScore } from '../palette';
import { lastSegment, normalizePath } from '../paths';
import Button from './Button';
import Select from './Select';
import { pickTone } from './rowStyles';

// the last workspace used: a second batch usually goes where the first went
const WS_KEY = 'devgo.cloneWorkspace';
// the list's last entry: the os folder picker, which has its own new folder
const PICK = '__pick__';

// a path under one of the workspaces is scanned already; one outside
// needs adding to show up in a lane
const insideAny = (path: string, workspaces: string[]) => {
	const p = normalizePath(path).toLowerCase();
	return workspaces.some(w => {
		const n = normalizePath(w).toLowerCase();
		return p === n || p.startsWith(`${n}/`);
	});
};

const field =
	'w-full px-3 py-2 bg-bg-panel border border-border-strong rounded-control text-15 text-text-primary outline-none focus:border-accent placeholder:text-text-muted';

// "scan with github" (joy): the ScanPicker shape pointed the other way.
// tick the repositories you want on this disk, choose the workspace they
// land in, clone them one after another. rows already cloned here are
// listed and disabled rather than hidden, so the answer to "is it here?"
// is on the same screen as the button
const ClonePicker = ({
	repos,
	local,
	workspaces,
	preselect,
	onStart,
	onDone,
	mode = 'clone',
	groups = [],
	initialGroup,
	onGroup
}: ClonePickerProps) => {
	const grouping = mode === 'group';
	const [groupName, setGroupName] = useState(
		initialGroup ?? groups[0]?.name ?? ''
	);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState('');
	const [picked, setPicked] = useState<Set<string>>(
		() => new Set(preselect ? [preselect] : [])
	);
	const [workspace, setWorkspace] = useState<string>(() => {
		try {
			const saved = localStorage.getItem(WS_KEY);
			return saved && workspaces.includes(saved) ? saved : (workspaces[0] ?? '');
		} catch {
			return workspaces[0] ?? '';
		}
	});
	// a folder chosen through the os picker, listed as its own option
	const [chosen, setChosen] = useState<string | null>(null);
	const [addAsWorkspace, setAddAsWorkspace] = useState(true);
	const outside = chosen !== null && workspace === chosen && !insideAny(chosen, workspaces);

	const pickInto = (value: string) => {
		if (value !== PICK) return setWorkspace(value);
		openDialog({ directory: true, defaultPath: workspace || undefined })
			.then(picked => {
				if (typeof picked !== 'string') return;
				setChosen(picked);
				setWorkspace(picked);
			})
			.catch(e => setError(String(e)));
	};
	const folders = [
		...workspaces,
		...(chosen !== null && !workspaces.includes(chosen) ? [chosen] : [])
	];
	// a folder by its name, the path behind it, and last the door back to
	// the os picker
	const into: SelectOption[] = [
		...folders.map(w => ({ value: w, label: lastSegment(w), hint: w })),
		{ value: PICK, label: 'Choose a folder…' }
	];

	const q = query.trim();
	const visible = q
		? repos
				.map(r => ({ r, s: fuzzyScore(q, r.full_name) }))
				.filter((x): x is { r: GithubRepo; s: number } => x.s !== null)
				.sort((a, b) => b.s - a.s)
				.map(x => x.r)
		: repos;

	const toggle = (name: string) =>
		setPicked(prev => {
			const next = new Set(prev);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});

	// in group mode every row is a candidate: a clone that is here can be
	// grouped as well as one that is not
	const cloneable = grouping ? visible : visible.filter(r => !local[r.full_name]);
	const allOn =
		cloneable.length > 0 && cloneable.every(r => picked.has(r.full_name));
	const count = picked.size;

	const group = async () => {
		const chosen = repos.filter(r => picked.has(r.full_name));
		if (chosen.length === 0 || !groupName.trim() || !onGroup) return;
		setError(null);
		try {
			await onGroup(chosen, groupName);
			onDone();
		} catch (e) {
			setError(String(e));
		}
	};

	const start = () => {
		const chosen = repos.filter(r => picked.has(r.full_name));
		if (chosen.length === 0 || !workspace) return;
		try {
			localStorage.setItem(WS_KEY, workspace);
		} catch {
			// per-viewer convenience only
		}
		onStart(chosen, workspace, outside && addAsWorkspace);
		onDone();
	};

	return (
		<div className='text-left flex-1 min-h-0 flex flex-col'>
			<input
				type='text'
				autoFocus
				className={`${field} mb-3`}
				placeholder='Find a repo…'
				value={query}
				onChange={e => setQuery(e.target.value)}
			/>
			<div className='flex items-center justify-between mb-2'>
				<span className='text-13 text-text-muted'>
					{visible.length} of {repos.length}
					{count > 0 && ` · ${count} ticked`}
				</span>
				<Button
					variant='ghost'
					className='text-11 text-accent hover:bg-transparent'
					disabled={cloneable.length === 0}
					onClick={() =>
						setPicked(prev => {
							const next = new Set(prev);
							for (const r of cloneable) {
								if (allOn) next.delete(r.full_name);
								else next.add(r.full_name);
							}
							return next;
						})
					}
				>
					{allOn ? 'Untick shown' : 'Tick shown'}
				</Button>
			</div>
			<ul className='flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto'>
				{visible.map(r => {
					const here = grouping ? undefined : local[r.full_name];
					const on = Boolean(here) || picked.has(r.full_name);
					return (
						<li key={r.full_name}>
							<label
								className={`flex items-center gap-3 px-3 py-1.5 bg-bg-panel border rounded-control ${pickTone(Boolean(here), on)}`}
								title={here ? `Already here: ${here}` : r.url}
							>
								<input
									type='checkbox'
									className='accent-accent shrink-0'
									checked={on}
									disabled={Boolean(here)}
									onChange={() => toggle(r.full_name)}
								/>
								<span className='min-w-0 flex-1 font-mono text-13 text-text-primary truncate'>
									<span className='text-text-muted'>{r.owner}/</span>
									{r.name}
								</span>
								<span className='text-11 text-text-muted shrink-0'>
									{local[r.full_name] ? 'local' : relativeTime(r.updated_at)}
								</span>
							</label>
						</li>
					);
				})}
				{visible.length === 0 && (
					<li className='px-3 py-4 text-13 text-text-muted text-center'>
						No repository matches.
					</li>
				)}
			</ul>
			{error && <p className='text-13 text-danger mt-2'>{error}</p>}
			{grouping ? (
				<div className='flex items-center justify-between gap-3 mt-4'>
					<label className='flex items-center gap-2 min-w-0 flex-1 text-13 text-text-secondary'>
						<span className='shrink-0'>group</span>
						<input
							type='text'
							list='devgo-group-names'
							className={`${field} min-w-0 flex-1 px-2 py-1.5 text-13`}
							placeholder='a name, new or existing'
							value={groupName}
							onChange={e => setGroupName(e.target.value)}
						/>
						<datalist id='devgo-group-names'>
							{groups.map(g => (
								<option key={g.name} value={g.name} />
							))}
						</datalist>
					</label>
					<Button
						variant='primary'
						className='shrink-0'
						onClick={group}
						disabled={count === 0 || !groupName.trim()}
					>
						Add {count === 1 ? '1 repo' : `${count} repos`} to group
					</Button>
				</div>
			) : (
			<div className='flex items-center justify-between gap-3 mt-4'>
				<label className='flex items-center gap-2 min-w-0 flex-1 text-13 text-text-secondary'>
					<span className='shrink-0'>into</span>
					<Select
						value={workspace}
						options={into}
						onChange={pickInto}
						label='into'
						title={workspace}
					/>
				</label>
				{outside && (
					<label
						className='flex items-center gap-2 shrink-0 text-13 text-text-secondary'
						title='The folder is in no workspace. Add it so the clone shows in a lane'
					>
						<input
							type='checkbox'
							className='accent-accent'
							checked={addAsWorkspace}
							onChange={e => setAddAsWorkspace(e.target.checked)}
						/>
						Add as workspace
					</label>
				)}
				<Button
					variant='primary'
					className='shrink-0'
					onClick={start}
					disabled={count === 0 || !workspace}
				>
					Clone {count === 1 ? '1 repo' : `${count} repos`}
				</Button>
			</div>
			)}
		</div>
	);
};

export default ClonePicker;
