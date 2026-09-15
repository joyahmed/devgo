import { prettyKeys, shortcutFor } from '../shortcuts';
import Button from './Button';
import Kbd from './Kbd';

// the palette's only visible door; without it the discovery surface is itself undiscoverable
const StatusBar = ({ onOpenPalette }: StatusBarProps) => (
	<footer className='flex items-center justify-end h-10 px-4 bg-bg-secondary border-t border-border shrink-0 text-[13px] select-none'>
		<Button
			variant='ghost'
			className='gap-1.5 text-[13px] hover:bg-transparent hover:text-accent'
			title='Open the command palette'
			onClick={onOpenPalette}
		>
			<Kbd>{prettyKeys(shortcutFor('commandPalette'))}</Kbd>
			<span className='text-text-secondary leading-none'>Commands</span>
		</Button>
	</footer>
);

export default StatusBar;
