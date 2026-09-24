import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { isWindows } from '../platform';
import Button from './Button';
import { Code, HelpSection } from './HelpPanel';

const REPO = 'https://github.com/joyahmed/devgo';

// the links go through open_url, the same https-only door open_remote
// uses; the tutorial chapters land on the public branches as docs
// commits, so the repository is the one link until they do
const LINKS = [{ label: 'Repository', href: REPO }];

const AboutPanel = () => {
	// from tauri.conf.json through the api, so the number can never drift
	// from the installer's own
	const [version, setVersion] = useState('');
	useEffect(() => {
		getVersion().then(setVersion).catch(() => {});
	}, []);

	return (
		<div className='flex flex-col gap-5'>
			<div>
				<h4 className='flex items-center gap-2 text-18 font-bold text-text-primary mb-1'>
					<span className='text-accent leading-none' aria-hidden='true'>
						&#10022;
					</span>
					DevGo
					{version && (
						<span className='font-mono text-15 text-text-muted'>v{version}</span>
					)}
				</h4>
				<p className='text-13 text-text-secondary'>
					A cross-platform project launcher: Windows and WSL, macOS, and a
					Linux build that has not been run yet. Built by Joy Ahmed with
					Tauri, Rust and React.
				</p>
			</div>

			<HelpSection title='Source'>
				<p>
					The app is built in the open, chapter by chapter: each chapter is a
					branch you can check out and run.
				</p>
				<div className='flex items-center gap-4'>
					{LINKS.map(l => (
						<Button
							key={l.label}
							variant='ghost'
							className='p-0 text-13 text-accent hover:bg-transparent'
							onClick={() => invoke('open_url', { url: l.href }).catch(() => {})}
						>
							{l.label}
						</Button>
					))}
				</div>
			</HelpSection>

			<HelpSection title='Licence'>
				<p>MIT. Copyright Joy Ahmed. The LICENSE file in the repository is the text.</p>
			</HelpSection>

			<HelpSection title='Third-party'>
				<p>
					GitHub CLI (<Code>gh</Code>): MIT, by GitHub. Not bundled: DevGo
					runs the copy you installed, and it holds your login.{' '}
					{isWindows ? 'psmux: by its author' : 'tmux: by its authors'}, not
					bundled. JetBrains Mono, bundled, under the SIL Open Font Licence. Tauri,
					React and Tailwind under their own licences.
				</p>
			</HelpSection>
		</div>
	);
};

export default AboutPanel;
