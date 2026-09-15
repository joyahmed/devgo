import { getCurrentWindow } from '@tauri-apps/api/window';
import { type ReactNode } from 'react';
import TitleBarButton, { TITLE_BAR_BUTTONS } from './TitleBarButton';

const appWindow = getCurrentWindow();

interface TitleBarProps {
	children?: ReactNode;
}

const TitleBar = ({ children }: TitleBarProps) => (
	<header className='flex items-center justify-between h-12 px-4 bg-bg-secondary border-b border-border shrink-0 select-none'>
		<div
			className='flex flex-1 items-center gap-2 cursor-grab'
			onMouseDown={() => appWindow.startDragging()}
		>
			<span className='text-lg text-accent pointer-events-none'>
				&#10022;
			</span>
			<span className='text-base font-bold text-text-primary pointer-events-none'>
				DevGo
			</span>
			<span className='text-xs text-text-secondary ml-1 pointer-events-none'>
				Developer Workspace Launcher
			</span>
		</div>
		<div className='flex items-center gap-1 shrink-0'>
			{children}
			{TITLE_BAR_BUTTONS.map(({ id, ...button }) => (
				<TitleBarButton key={id} {...button} />
			))}
		</div>
	</header>
);

export default TitleBar;
