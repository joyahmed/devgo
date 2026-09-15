import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

const buttonClass =
	'flex items-center justify-center w-8 h-7 bg-transparent border-none text-text-secondary cursor-pointer text-15 rounded-control hover:bg-bg-hover hover:text-text-primary transition-colors';

const TitleBarButton = ({
	className = '',
	onClick,
	children
}: TitleBarButtonProps) => (
	<button
		type='button'
		{...{ onClick, className: `${buttonClass} ${className}` }}
	>
		{children}
	</button>
);

export default TitleBarButton;

export const TITLE_BAR_BUTTONS = [
	{
		id: 'minimize',
		className: '',
		onClick: () => appWindow.minimize(),
		children: (
			<svg width='12' height='12' viewBox='0 0 12 12'>
				<rect y='5' width='12' height='2' fill='currentColor' />
			</svg>
		)
	},
	{
		id: 'maximize',
		className: '',
		onClick: () => appWindow.toggleMaximize(),
		children: (
			<svg width='12' height='12' viewBox='0 0 12 12'>
				<rect
					x='1.5'
					y='1.5'
					width='9'
					height='9'
					fill='none'
					stroke='currentColor'
					strokeWidth='1.5'
				/>
			</svg>
		)
	},
	{
		id: 'close',
		className: 'hover:bg-danger hover:text-white',
		onClick: () => appWindow.close(),
		children: (
			<svg width='12' height='12' viewBox='0 0 12 12'>
				<line
					x1='2'
					y1='2'
					x2='10'
					y2='10'
					stroke='currentColor'
					strokeWidth='1.5'
				/>
				<line
					x1='10'
					y1='2'
					x2='2'
					y2='10'
					stroke='currentColor'
					strokeWidth='1.5'
				/>
			</svg>
		)
	}
];
