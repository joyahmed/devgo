import { useEffect, useRef } from 'react';
import Button from './Button';

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// the one secondary surface: a panel that slides in from an edge over a
// dimmed backdrop and leaves the list visible beside it. right for
// anything you work inside, top for a sentence and two buttons. this
// replaced Modal, the web's centred card, and Settings, which was a second
// copy of that card with its own Escape handler. escape and backdrop
// click close it; focus moves in when it opens, tab cycles inside it, and
// focus returns to whatever had it when it closes
const Drawer = ({
	open,
	side,
	title,
	onClose,
	children,
	width = 'w-[min(560px,92vw)]',
	z = 50
}: DrawerProps) => {
	const panel = useRef<HTMLDivElement>(null);
	const returnTo = useRef<Element | null>(null);

	// one effect, wired only while open: hooks cannot sit behind the early
	// return below
	useEffect(() => {
		if (!open) return;
		returnTo.current = document.activeElement;
		const el = panel.current;
		// the first control in the body, Cancel on a confirm and the input on
		// a name box, not the header's ✕, which is first in dom order
		const first = el?.querySelector<HTMLElement>(
			`[data-drawer-body] :is(${FOCUSABLE})`
		);
		(first ?? el)?.focus({ preventScroll: true });

		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				onClose();
				return;
			}
			if (e.key !== 'Tab' || !el) return;
			const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
			if (items.length === 0) return;
			const head = items[0];
			const tail = items[items.length - 1];
			if (e.shiftKey && document.activeElement === head) {
				e.preventDefault();
				tail.focus();
			} else if (!e.shiftKey && document.activeElement === tail) {
				e.preventDefault();
				head.focus();
			}
		};
		window.addEventListener('keydown', handler);
		return () => {
			window.removeEventListener('keydown', handler);
			const back = returnTo.current;
			if (back instanceof HTMLElement) back.focus({ preventScroll: true });
		};
	}, [open, onClose]);

	if (!open) return null;

	const place =
		side === 'right'
			? `absolute inset-y-0 right-0 h-full ${width} border-l rounded-l-panel animate-slide-left`
			: `absolute top-0 left-1/2 -translate-x-1/2 max-h-[calc(100vh-3rem-24px)] ${width} border border-t-0 rounded-b-panel animate-slide-down`;

	return (
		// under the title bar (top-12), so the window's own chrome is never
		// covered; settings sits at 40 so a confirm sheet (50) opens over it
		<div
			className={`fixed inset-x-0 bottom-0 top-12 bg-black/40 ${z === 40 ? 'z-40' : 'z-50'}`}
			onClick={onClose}
		>
			<div
				ref={panel}
				tabIndex={-1}
				role='dialog'
				aria-modal='true'
				aria-label={title}
				className={`${place} flex flex-col bg-bg-secondary border-border shadow-surface outline-none`}
				onClick={e => e.stopPropagation()}
			>
				{title && (
					<div className='flex items-center justify-between gap-4 px-6 pt-5 pb-3 shrink-0'>
						<h3 className='text-18 font-bold text-text-primary truncate'>
							{title}
						</h3>
						<Button
							variant='ghost'
							className='w-8 h-7 text-15 text-text-secondary'
							onClick={onClose}
							title='Close (Esc)'
							aria-label='Close'
						>
							✕
						</Button>
					</div>
				)}
				<div
					data-drawer-body
					className={`flex-1 min-h-0 flex flex-col ${title ? 'px-6 pb-6' : ''}`}
				>
					{children}
				</div>
			</div>
		</div>
	);
};

export default Drawer;
