import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';
import Button from './Button';

const KIND_TONE: Record<DiscoveredRoot['kind'], string> = {
	wsl: 'text-accent border-accent/30',
	windows: 'text-text-muted border-border'
};

// scanning is behind a button on purpose: it never touches a stopped distro,
// but it is still a thing the user asks for, not something an empty window does
const Onboarding = ({ onAdd, onAddMany, onError }: OnboardingProps) => {
	// null is "not scanned yet", [] is "scanned, found nothing"
	const [roots, setRoots] = useState<DiscoveredRoot[] | null>(null);
	const [scanning, setScanning] = useState(false);

	const pickFolder = async () => {
		try {
			const picked = await open({ directory: true });
			if (typeof picked === 'string') onAdd(picked);
		} catch (e) {
			onError(String(e));
		}
	};

	const scan = async () => {
		setScanning(true);
		try {
			setRoots(await invoke<DiscoveredRoot[]>('discover_roots'));
		} catch (e) {
			onError(String(e));
		} finally {
			setScanning(false);
		}
	};

	return (
		<div className='flex-1 flex items-center justify-center min-h-0 overflow-y-auto'>
			<div className='w-[min(560px,92%)] py-8 text-center'>
				<div className='text-4xl text-accent mb-3'>&#10022;</div>
				<h2 className='text-xl font-bold text-text-primary mb-1'>
					Welcome to DevGo
				</h2>
				<p className='text-sm text-text-secondary mb-6'>
					Add a folder that holds your projects — one level of subfolders
					becomes your launchable list.
				</p>

				<div className='flex items-center justify-center gap-2.5 mb-4'>
					<Button variant='primary' onClick={pickFolder}>
						Choose a folder…
					</Button>
					<Button onClick={scan} disabled={scanning}>
						{scanning ? 'Scanning…' : 'Scan for projects'}
					</Button>
				</div>

				{roots !== null && (
					<div className='text-left mt-6'>
						{roots.length === 0 ? (
							<p className='text-sm text-text-muted text-center'>
								No common project folders found. Choose one manually, or start
								a WSL distro and scan again.
							</p>
						) : (
							<>
								<div className='flex items-center justify-between mb-2'>
									<span className='text-[10px] font-bold uppercase tracking-wider text-text-muted'>
										Found {roots.length}
									</span>
									<Button
										variant='ghost'
										className='text-[11px] text-accent hover:bg-transparent'
										onClick={() => onAddMany(roots.map(r => r.path))}
									>
										Add all
									</Button>
								</div>
								<ul className='flex flex-col gap-1.5'>
									{roots.map(r => (
										<li
											key={r.path}
											className='flex items-center justify-between gap-3 px-3 py-2 bg-bg-panel border border-border rounded-md'
										>
											<span className='min-w-0'>
												<span className='block text-[13px] text-text-primary truncate'>
													{r.label}
												</span>
												<span className='block font-mono text-[10px] text-text-muted truncate'>
													{r.path}
												</span>
											</span>
											<span className='flex items-center gap-2 shrink-0'>
												<span
													className={`text-[9px] uppercase tracking-wider px-1 rounded border ${KIND_TONE[r.kind]}`}
												>
													{r.kind === 'wsl' ? 'WSL' : 'WIN'}
												</span>
												<Button
													variant='ghost'
													className='text-xs px-2'
													onClick={() => onAdd(r.path)}
												>
													Add
												</Button>
											</span>
										</li>
									))}
								</ul>
							</>
						)}
					</div>
				)}

				<p className='text-xs text-text-muted mt-6'>
					…or drag a folder onto the window.
				</p>
			</div>
		</div>
	);
};

export default Onboarding;
