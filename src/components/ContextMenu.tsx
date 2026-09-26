import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Button from './Button';

const ROW_H = 30;
// 256 while Enter was ⏎; spelling the key out ate four characters of
// every label beside one
const WIDTH = 288;

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

	// keep the whole menu on screen. an app row's menu is thirty entries
	// with headings, taller than most windows: cap the height at the
	// viewport and scroll, and clamp top with the menu's measured height
	// once it has mounted. a row count times a row height was wrong in
	// both directions (rows 30, headings 26, separators 9) and left the
	// last rows under the footer
	const [top, setTop] = useState(() =>
		Math.max(8, Math.min(y, window.innerHeight - 8 - ROW_H))
	);
	useLayoutEffect(() => {
		const h = ref.current?.getBoundingClientRect().height ?? 0;
		setTop(Math.max(8, Math.min(y, window.innerHeight - 8 - h)));
	}, [y, items.length]);
	const style: React.CSSProperties = {
		top,
		left: Math.max(8, Math.min(x, window.innerWidth - 8 - WIDTH)),
		maxHeight: window.innerHeight - 16
	};

	return (
		<div
			ref={ref}
			className='fixed z-50 w-72 bg-bg-secondary border border-border rounded-panel shadow-surface py-1 text-15 overflow-y-auto overflow-x-hidden'
			style={style}
			onContextMenu={e => e.preventDefault()}
		>
			{items.map((item, i) =>
				item === 'separator' ? (
					<div key={`sep-${i}`} className='my-1 border-b border-border' />
				) : 'heading' in item ? (
					// a section label in the muted ink: not focusable, not clickable
					<div
						key={`h-${i}`}
						className='px-3 pt-2 pb-0.5 text-11 font-semibold uppercase tracking-wider text-text-muted select-none'
					>
						{item.heading}
					</div>
				) : (
					<Button
						key={item.label}
						variant='ghost'
						className={`w-full rounded-none px-3 py-1.5 text-15 ${
							item.danger ? 'hover:bg-danger/10' : ''
						}`}
						disabled={item.disabled}
						onClick={() => {
							// a dead entry swallows the click and leaves the menu
							// standing, so the hint saying why stays on screen to be
							// read. chrome already drops every mouse event on a
							// disabled <button>, but the guard is written here because
							// the day this stops being one — aria-disabled for the
							// screen readers a disabled button hides the hint from, a
							// div, a tooltip wrapper — the click lands again, and a
							// menu that dismisses is the exact feedback a successful
							// pick gives: the trap that had a tester reporting "one
							// click straight through it and the drawer never opened"
							if (item.disabled) return;
							item.onClick();
							onClose();
						}}
					>
						{/* enabled is the full ink, disabled is the muted one — the
						    pair the launch and target buttons already use, where
						    muted means blocked and nothing else. it goes on this
						    span and not on the button because ghost's own ink is
						    muted, and two `text-` utilities on one element are
						    settled by tailwind's output order, not by the class
						    string. dead beats dangerous: red on a row that cannot
						    run promises an action there is none of */}
						<span
							className={`flex w-full items-center justify-between gap-6 ${
								item.disabled
									? 'text-text-muted'
									: item.danger
										? 'text-danger'
										: 'text-text-primary'
							}`}
						>
							<span className='truncate'>{item.label}</span>
							{item.hint && (
								<span className='font-mono text-11 uppercase text-text-muted shrink-0'>
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
