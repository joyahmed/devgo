import { useEffect, useRef } from 'react';
import { logLine, takeReason } from '../uiLog';
import Button from './Button';

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// what the close line says when the drawer went away and none of the
// three exits was taken. spelled out rather than "unknown", because the
// person reading it is reading a bug report and the sentence has to
// survive being quoted on its own
const UNEXPLAINED =
	'UNEXPLAINED - not Escape, not the backdrop, not the ✕, and no caller said why';

// the one secondary surface: a panel that slides in from an edge over a
// dimmed backdrop and leaves the list visible beside it. right for
// anything you work inside, top for a sentence and two buttons. this
// replaced Modal, the web's centred card, and Settings, which was a second
// copy of that card with its own Escape handler. escape and backdrop
// click close it; focus moves in when it opens, tab cycles inside it, and
// focus returns to whatever had it when it closes.
//
// it also says in devgo.log why it closed, but only when it was given a
// logAs: the clone drawer went away once on its own, with no input and
// no explanation in this file, and the word UNEXPLAINED is only worth
// anything if it is rare - which it would not be if every drawer a
// caller closes from outside logged it
const Drawer = ({
	open,
	side,
	title,
	onClose,
	children,
	width = 'w-[min(560px,92vw)]',
	z = 50,
	logAs,
	logDetail
}: DrawerProps) => {
	const panel = useRef<HTMLDivElement>(null);
	const returnTo = useRef<Element | null>(null);
	// set by each of the three exits on its way out, read once by the
	// cleanup below, and null the rest of the time. null at close time is
	// the whole point of this: it means the drawer went away through a
	// path that is not in this file
	const reason = useRef<string | null>(null);
	const openedAt = useRef(0);
	// the context line, kept in a ref and refreshed every render, because
	// logDetail is a fresh arrow on each one: putting it in the deps below
	// would tear that effect down and back up on every render of App and
	// log a close that never happened. declared before that effect, so on
	// the commit that opens the drawer this body runs first
	const detail = useRef<(() => string) | undefined>(undefined);
	useEffect(() => {
		detail.current = logDetail;
	});

	// the observation, and nothing but: this effect opens no door and
	// closes none. deps are [open, logAs], both stable, so it runs exactly
	// when the drawer appears and its cleanup exactly when the drawer
	// goes - whether that is `open` going false or this element being
	// unmounted out from under it. what it cannot see is a webview reload,
	// which runs no cleanup at all; main.tsx logs a line per document load
	// so that case is still named. (in `tauri dev` a fast refresh re-runs
	// effects and can log a spurious pair; a release build has none)
	useEffect(() => {
		if (!open || !logAs) return;
		reason.current = null;
		openedAt.current = Date.now();
		logLine(`drawer "${logAs}" opened`);
		return () => {
			const why = reason.current ?? takeReason(logAs) ?? UNEXPLAINED;
			const held = ((Date.now() - openedAt.current) / 1000).toFixed(1);
			const extra = detail.current?.() ?? '';
			logLine(
				`drawer "${logAs}" closed: ${why} · open ${held}s${extra ? ` · ${extra}` : ''}`
			);
			reason.current = null;
		};
	}, [open, logAs]);

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
				reason.current = 'Escape';
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

	// the same two calls as before, each with a note of who made it. no
	// new way out, no old one prevented: the only change is that the
	// reason is written down before onClose runs
	const closeFromBackdrop = () => {
		reason.current = 'backdrop click';
		onClose();
	};
	const closeFromButton = () => {
		reason.current = 'the ✕ button';
		onClose();
	};

	const place =
		side === 'right'
			? `absolute inset-y-0 right-0 h-full ${width} border-l rounded-l-panel animate-slide-left`
			: `absolute top-0 left-1/2 -translate-x-1/2 max-h-[calc(100vh-3rem-24px)] ${width} border border-t-0 rounded-b-panel animate-slide-down`;

	return (
		// under the title bar (top-12), so the window's own chrome is never
		// covered; settings sits at 40 so a confirm sheet (50) opens over it
		<div
			className={`fixed inset-x-0 bottom-0 top-12 bg-black/40 ${z === 40 ? 'z-40' : 'z-50'}`}
			onClick={closeFromBackdrop}
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
							onClick={closeFromButton}
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
