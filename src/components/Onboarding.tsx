import { open } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';
import Button from './Button';
import ScanPicker from './ScanPicker';

// scanning is behind a button on purpose: it never touches a stopped distro,
// but it is still a thing the user asks for, not something an empty window does
const Onboarding = ({ onAdd, onAddMany, onError }: OnboardingProps) => {
	// the picker scans when it mounts, so the button is the decision to
	// mount it: the same component the + menu opens once there is a
	// workspace, so the two never drift
	const [showScan, setShowScan] = useState(false);

	const pickFolder = async () => {
		try {
			const picked = await open({ directory: true });
			if (typeof picked === 'string') onAdd(picked);
		} catch (e) {
			onError(String(e));
		}
	};

	return (
		<div className='flex-1 flex items-center justify-center min-h-0 overflow-y-auto'>
			<div className='w-[min(720px,92%)] py-8 text-center'>
				<h2 className='flex items-center justify-center gap-3 text-24 font-bold text-text-primary mb-1'>
					<span className='text-accent leading-none' aria-hidden='true'>
						&#10022;
					</span>
					Welcome to DevGo
				</h2>
				<p className='text-15 text-text-secondary mb-6'>
					Add a folder that holds your projects — one level of subfolders
					becomes your launchable list.
				</p>

				{/* the footer's own buttons, the default one and the plain one, so
				    the first screen and every screen after it press the same */}
				<div className='flex items-center justify-center gap-2.5 mb-4'>
					<Button variant='target' aria-current='true' onClick={pickFolder}>
						Choose a folder…
					</Button>
					<Button
						variant='target'
						onClick={() => setShowScan(true)}
						disabled={showScan}
					>
						Scan for projects
					</Button>
				</div>

				{showScan && (
					<div className='mt-6'>
						<ScanPicker {...{ existing: [], onAddMany, onError }} />
					</div>
				)}

				<p className='text-13 text-text-muted mt-6'>
					…or drag a folder onto the window.
				</p>
			</div>
		</div>
	);
};

export default Onboarding;
