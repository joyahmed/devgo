import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { normalizePath } from '../paths';
import Button from './Button';
import { pickTone } from './rowStyles';

const KIND_TONE: Record<DiscoveredRoot['kind'], string> = {
	wsl: 'text-accent border-accent/30',
	windows: 'text-text-muted border-border'
};

// the list that lived inside Onboarding with an Add button per root. it
// moved out because discovery was reachable from exactly one screen, the
// empty one, so from the first workspace on the scan was dead code. the
// empty screen and the + menu now render this, and picking is checkboxes
// with one Add, because "add these four" is the real ask.
// scanning starts on mount: mounting is the request, the user pressed the
// button or chose the entry that mounts this, so nothing scans on launch
const ScanPicker = ({
	existing,
	onAddMany,
	onError,
	onDone
}: ScanPickerProps) => {
	const [roots, setRoots] = useState<DiscoveredRoot[] | null>(null);
	// true from the first frame: "found 0" before the scan has run is a lie
	const [scanning, setScanning] = useState(true);
	const [picked, setPicked] = useState<Set<string>>(new Set());

	const have = new Set(existing.map(normalizePath));
	const isAdded = (r: DiscoveredRoot) => have.has(normalizePath(r.path));

	// the one place a finished scan touches state, shared by the mount scan
	// and Rescan so the two cannot disagree about what "found" means
	const applyFound = (found: DiscoveredRoot[]) => {
		setRoots(found);
		// everything new starts checked: after a scan the answer is usually
		// "yes, all of those", and unchecking two beats checking six
		setPicked(new Set(found.filter(r => !isAdded(r)).map(r => r.path)));
	};

	const request = () =>
		invoke<DiscoveredRoot[]>('discover_roots')
			.then(applyFound)
			.catch(e => {
				onError(String(e));
				setRoots([]);
			})
			.finally(() => setScanning(false));

	// the effect body is the request and nothing else; scanning is already
	// true, so no state is written synchronously in here
	useEffect(() => {
		request();
	}, []);

	const rescan = () => {
		setScanning(true);
		request();
	};

	const toggle = (path: string) =>
		setPicked(prev => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});

	const add = () => {
		if (picked.size === 0) return;
		onAddMany([...picked]);
		onDone?.();
	};

	if (scanning || roots === null) {
		return <p className='text-sm text-text-muted py-4 text-center'>Scanning…</p>;
	}

	if (roots.length === 0) {
		return (
			<p className='text-sm text-text-muted py-4 text-center'>
				No common project folders found. Choose one manually, or start a WSL
				distro and scan again.
			</p>
		);
	}

	const addable = roots.filter(r => !isAdded(r));
	const allOn = addable.length > 0 && picked.size === addable.length;
	const count = picked.size === 1 ? '1 folder' : `${picked.size} folders`;

	return (
		<div className='text-left'>
			<div className='flex items-center justify-between mb-2'>
				<span className='text-[10px] font-bold uppercase tracking-wider text-text-muted'>
					Found {roots.length}
					{addable.length < roots.length &&
						` · ${roots.length - addable.length} already added`}
				</span>
				<Button
					variant='ghost'
					className='text-[11px] text-accent hover:bg-transparent'
					disabled={addable.length === 0}
					onClick={() =>
						setPicked(allOn ? new Set() : new Set(addable.map(r => r.path)))
					}
				>
					{allOn ? 'Uncheck all' : 'Check all'}
				</Button>
			</div>
			<ul className='flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto'>
				{roots.map(r => {
					const added = isAdded(r);
					const on = added || picked.has(r.path);
					return (
						<li key={r.path}>
							<label
								className={`flex items-center gap-3 px-3 py-2 bg-bg-panel border rounded-md ${pickTone(added, on)}`}
							>
								<input
									type='checkbox'
									className='accent-accent shrink-0'
									checked={on}
									disabled={added}
									onChange={() => toggle(r.path)}
								/>
								<span className='min-w-0 flex-1'>
									<span className='block text-[13px] text-text-primary truncate'>
										{r.label}
									</span>
									<span className='block font-mono text-[10px] text-text-muted truncate'>
										{r.path}
									</span>
								</span>
								<span
									className={`text-[9px] uppercase tracking-wider px-1 rounded border shrink-0 ${KIND_TONE[r.kind]}`}
								>
									{added ? 'added' : r.kind === 'wsl' ? 'WSL' : 'WIN'}
								</span>
							</label>
						</li>
					);
				})}
			</ul>
			{/* a real button, not a muted link: starting a distro and scanning
			    again is the second most likely thing to do here */}
			<div className='flex items-center justify-between gap-3 mt-4'>
				<Button onClick={rescan}>Rescan</Button>
				<Button variant='primary' onClick={add} disabled={picked.size === 0}>
					Add {count}
				</Button>
			</div>
		</div>
	);
};

export default ScanPicker;
