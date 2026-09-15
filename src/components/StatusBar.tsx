import { prettyKeys, shortcutFor } from '../shortcuts';
import Button from './Button';

// the palette's only visible door; without it the discovery surface is itself undiscoverable
const StatusBar = ({ onOpenPalette }: StatusBarProps) => (
	<footer className='flex items-center justify-end h-10 px-4 bg-bg-secondary border-t border-border shrink-0 text-[13px] select-none'>
		<Button
			variant='ghost'
			className='gap-1.5 text-[13px] hover:bg-transparent hover:text-accent'
			title='Open the command palette'
			onClick={onOpenPalette}
		>
			<kbd className='font-mono text-[11px] leading-none px-2 py-1 border border-border rounded bg-bg-panel text-text-primary'>
				{prettyKeys(shortcutFor('commandPalette'))}
			</kbd>
			<span className='text-text-secondary'>Commands</span>
		</Button>
	</footer>
);

export default StatusBar;
