import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { prettyKeys, shortcutFor } from '../shortcuts';
import Button from './Button';

// one help section: a heading and a paragraph. short, in-app, offline:
// the rules devgo lives by were code comments and tutorial chapters, and
// a user of the installed app sees neither
export const HelpSection = ({ title, children }: HelpSectionProps) => (
	<div>
		<h4 className='text-15 font-semibold text-text-primary mb-1'>{title}</h4>
		<div className='text-13 text-text-secondary flex flex-col gap-2'>
			{children}
		</div>
	</div>
);

export const Code = ({ children }: KbdProps) => (
	<code className='font-mono text-text-primary'>{children}</code>
);

const key = (id: ShortcutId) => prettyKeys(shortcutFor(id));

// the keys come from the table, so a rebinding shows up here without
// anyone remembering to edit prose
const SECTIONS: { title: string; body: React.ReactNode }[] = [
	{
		title: 'What DevGo is',
		body: (
			<p>
				A launcher for your projects. Point it at the folders that hold them,
				on a drive or inside a WSL distro, and it lists every project, finds
				one in a few keystrokes, and opens it in the editor and terminal you
				already use. It is not an editor, a terminal or a git client; it opens
				the door and gets out of the way.
			</p>
		)
	},
	{
		title: 'Workspaces and the scan',
		body: (
			<p>
				A workspace is a folder that holds projects. Add one with{' '}
				<Code>{key('addWorkspace')}</Code>, by scanning the usual roots, or by
				dropping a folder on the window. Depth 1 lists every immediate child;
				deeper, a folder is a project only when it carries a marker (
				<Code>package.json</Code>, <Code>Cargo.toml</Code>, <Code>.git</Code>,
				…), so a monorepo's apps become rows without every subfolder becoming
				one. The last good scan of every workspace is kept, so a drive that is
				not attached yet shows what it had.
			</p>
		)
	},
	{
		title: 'WSL: DevGo never starts a stopped distro',
		body: (
			<p>
				Reading a WSL workspace whose distro is off would boot the VM, so DevGo
				does not: the rows show the last list, marked{' '}
				<em>cached · WSL stopped</em>. Only Refresh (<Code>{key('refresh')}</Code>
				) and opening a project are allowed to start one, because you asked.
				The WSL chip in the title bar shows what is running and can stop a
				distro or shut WSL down.
			</p>
		)
	},
	{
		title: 'Editors and terminals are templates you own',
		body: (
			<p>
				A target is a program plus how to hand it a directory. DevGo detects
				the usual ones on this machine and inside each running distro; you can
				add your own in Settings › Editors &amp; Terminals with a template:{' '}
				<Code>{'{path}'}</Code>, <Code>{'{distro}'}</Code>,{' '}
				<Code>{'{linux_path}'}</Code>. A WSL project opens where it lives: VS
				Code via Remote-WSL, a terminal inside the distro in the project
				directory.
			</p>
		)
	},
	{
		title: 'tmux / psmux',
		body: (
			<p>
				With the multiplexer on, a terminal launch opens a named session with
				the windows you listed: tmux inside the distro for a WSL project, psmux
				for a Windows one. Close the terminal, close DevGo, come back: the
				session is still there, and launching again reattaches. psmux is
				installed separately: <Code>winget install marlocarlo.psmux</Code>.
				Off, a launch is one plain shell.
			</p>
		)
	},
	{
		title: 'GitHub',
		body: (
			<p>
				The GitHub rows under the workspaces list every repository you own
				through the GitHub CLI. It needs <Code>gh</Code> installed and logged
				in (<Code>gh auth login</Code>); DevGo stores no token of its own, and{' '}
				<Code>gh auth logout</Code> signs out everywhere. The list is fetched
				only when you ask, never on launch or focus, and never on the UI
				thread. Clone into a workspace, group repos, open any branch's page
				from its chip; the live search, off until you turn it on, is the one
				place a keystroke reaches the network.
			</p>
		)
	},
	{
		title: 'Servers',
		body: (
			<>
				<p>
					The Servers card lists the machines you SSH into. Import{' '}
					<Code>~/.ssh/config</Code> (every <Code>Host</Code> becomes a row; the
					file is never written) or add one by hand. Enter opens a terminal on
					it in a tmux session that survives, the same promise a WSL project
					gets. DevGo launches by alias so your config's key and options
					apply, and stores no password: an alias, a host, a key <em>path</em>.
				</p>
				<p>
					Expand a server (or ↻) and one <Code>ssh</Code> lists its folders
					and, when the box has <Code>~/scripts/devgo-inventory.sh</Code> from{' '}
					<Code>joyahmed/server</Code>, its <em>apps</em>: each{' '}
					<Code>/var/www</Code> folder shows its domain, a dot for its pm2
					processes and its ports. The server declares its own actions in{' '}
					<Code>devgo-actions.json</Code> beside that script; right-click the
					server or an app for them. An action is typed into a tmux window on
					the server and the terminal attaches to it. <Code>sudo</Code> asks
					there; DevGo never holds it, never runs a script itself and never
					reads what came back.
				</p>
			</>
		)
	},
	{
		title: 'Keyboard',
		body: (
			<p>
				Every key is listed once in Settings › Shortcuts, and the command
				palette (<Code>{key('commandPalette')}</Code>) can run anything DevGo
				can do. Text size: <Code>{key('textBigger')}</Code> /{' '}
				<Code>{key('textSmaller')}</Code> / <Code>{key('textReset')}</Code>.
			</p>
		)
	}
];

const HelpPanel = ({ onError }: HelpPanelProps) => {
	const [dataDir, setDataDir] = useState<string | null>(null);
	useEffect(() => {
		invoke<string>('get_app_data_dir').then(setDataDir).catch(() => {});
	}, []);

	return (
		<div className='flex flex-col gap-5'>
			{SECTIONS.map(s => (
				<HelpSection key={s.title} title={s.title}>
					{s.body}
				</HelpSection>
			))}
			{/* the one section with a live value and a button: the real folder,
			    the lock file's parent, where every json file lives */}
			<HelpSection title='Where your config lives'>
				<p>
					Workspaces, targets, preferences and the project cache are JSON
					files in {dataDir ? <Code>{dataDir}</Code> : 'the app-data folder'}.
					A file that cannot be parsed is backed up as <Code>.bak</Code>,
					never overwritten. Settings › Config exports and imports the lot.
				</p>
				<div>
					<Button
						variant='ghost'
						className='p-0 text-13 text-accent hover:bg-transparent'
						onClick={() =>
							invoke('reveal_app_data_dir').catch(e => onError(String(e)))
						}
					>
						Reveal in Explorer
					</Button>
				</div>
			</HelpSection>
		</div>
	);
};

export default HelpPanel;
