import { getCurrentWindow } from '@tauri-apps/api/window';
import { useFullscreen } from '../hooks/useFullscreen';
import { isMac } from '../platform';
import TitleBarButton, { TITLE_BAR_BUTTONS } from './TitleBarButton';

const appWindow = getCurrentWindow();

// on a mac the window keeps its native traffic lights (titleBarStyle
// Overlay), drawn by the os over the top-left ~78×28 px of our content. so
// two things differ there and nothing else: the brand steps right of
// them, and our own three buttons do not render, a second set beside the
// real one is a title bar with six window controls. the drag region is
// unchanged; startDragging works under overlay. native full screen hides
// the lights, and the brand steps back: an inset with nothing to clear
// read as a stray gap next to the windows build
const TitleBar = ({ children }: TitleBarProps) => {
	const fullscreen = useFullscreen();
	const brandInset = isMac && !fullscreen ? 'pl-[84px]' : 'pl-4';
	return (
		<header
			className={`flex items-center justify-between h-12 ${brandInset} pr-4 ground-chrome border-b border-border shrink-0 select-none`}
		>
			<div
				className='flex flex-1 items-center gap-2 cursor-grab'
				onMouseDown={() => appWindow.startDragging()}
			>
				<span className='text-18 text-accent pointer-events-none'>
					&#10022;
				</span>
				{/* no tagline: a title bar is not a place for a subtitle */}
				<span className='text-18 font-bold text-text-primary pointer-events-none'>
					DevGo
				</span>
			</div>
			<div className='flex items-center gap-1 shrink-0'>
				{children}
				{!isMac &&
					TITLE_BAR_BUTTONS.map(({ id, ...button }) => (
						<TitleBarButton key={id} {...button} />
					))}
			</div>
		</header>
	);
};

export default TitleBar;
