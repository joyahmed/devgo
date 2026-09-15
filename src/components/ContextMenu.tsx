import { useEffect, useRef } from 'react';
import Button from './Button';

const ROW_H = 30;
const WIDTH = 256;

// renders what it is given and owns none of it; the actions live in App
const ContextMenu = ({ x, y, items, onClose }: ContextMenuProps) => {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const away = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		};
		const esc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('mousedown', away);
		window.addEventListener('keydown', esc);
		return () => {
			window.removeEventListener('mousedown', away);
			window.removeEventListener('keydown', esc);
		};
	}, [onClose]);

	// keep the whole menu on screen
	const style: React.CSSProperties = {
		top: Math.max(
			8,
			Math.min(y, window.innerHeight - 8 - items.length * ROW_H)
		),
		left: Math.max(8, Math.min(x, window.innerWidth - 8 - WIDTH))
	};

	return (
		<div
			ref={ref}
			className='fixed z-50 w-64 bg-bg-secondary border border-border rounded-panel shadow-surface py-1 text-15 overflow-hidden'
			style={style}
			onContextMenu={e => e.preventDefault()}
		>
			{items.map((item, i) =>
				item === 'separator' ? (
					<div key={`sep-${i}`} className='my-1 border-b border-border' />
				) : (
					<Button
						key={item.label}
						variant='ghost'
						className={`w-full rounded-none px-3 py-1.5 text-15 ${
							item.danger ? 'hover:bg-danger/10' : ''
						}`}
						disabled={item.disabled}
						onClick={() => {
							item.onClick();
							onClose();
						}}
					>
						<span
							className={`flex w-full items-center justify-between gap-6 ${
								item.danger ? 'text-danger' : ''
							}`}
						>
							<span className='truncate'>{item.label}</span>
							{item.hint && (
								<span className='font-mono text-11 text-text-muted shrink-0'>
									{item.hint}
								</span>
							)}
						</span>
					</Button>
				)
			)}
		</div>
	);
};

export default ContextMenu;
