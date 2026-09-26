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

// every drawer that is open right now, in the order they opened. the
// keyboard belongs to the LAST one and to no other: the command palette
// is itself a drawer and opens over the picker that summoned it, and one
// Escape has to close the palette, not both of them.
//
// before this the point looked moot for a reason that was itself the bug.
// every listener here was torn down and re-registered on each render (see
// the deps below), so when the first drawer's handler closed its drawer,
// React flushed that update inside the key dispatch and removed the other
// drawer's listener before the browser reached it - a listener removed
// mid-dispatch is never called. one drawer closed, the other silently ate
// the key, and which one it was depended on mount order
const openDrawers: object[] = [];

// spelled out rather than built with a template, so tailwind's scanner
// can see all three. 40 is a working surface (settings), 50 is a sheet
// that opens over one (a confirm, the clone picker), 60 is the command
// palette, which is summoned from anywhere and must be on top of whatever
// it was summoned from - it used to share 50 with the clone drawer and
// lost the tie to source order, opening UNDER it and behind its backdrop
const LAYER: Record<NonNullable<DrawerProps['z']>, string> = {
	40: 'z-40',
	50: 'z-50',
	60: 'z-60'
};

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
	// onClose is in the same boat and for a worse reason: every call site
	// passes a fresh arrow, so naming it in the deps of the key effect
	// below re-registered that effect on every render of App - which is
	// what stole focus back from the palette and what lost the other
	// drawer's Escape. read through a ref, the effect can depend on `open`
	// alone and stay put for as long as the drawer is up
	const close = useRef(onClose);
	// this drawer's place in the stack above: an identity, nothing more
	const me = useRef({});
	// what to give the focus back to, read in RENDER on the pass that
	// opens the drawer and not in the effect below. by the time any effect
	// runs, an autoFocus input in the body (the palette's command box, the
	// clone picker's "Find a repo…") has already taken the focus during
	// the commit — so an effect records the drawer's OWN input as "what
	// had it before", and on close it calls focus() on a node that has
	// just been detached, which does nothing and leaves the caret on
	// <body>. this was invisible while the effect re-ran on every render
	// and simply re-focused the drawer each time
	const wasOpen = useRef(false);
	if (open && !wasOpen.current) returnTo.current = document.activeElement;
	wasOpen.current = open;
	useEffect(() => {
		detail.current = logDetail;
		close.current = onClose;
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
		const token = me.current;
		openDrawers.push(token);
		const el = panel.current;
		// the first control in the body, Cancel on a confirm and the input on
		// a name box, not the header's ✕, which is first in dom order
		const first = el?.querySelector<HTMLElement>(
			`[data-drawer-body] :is(${FOCUSABLE})`
		);
		(first ?? el)?.focus({ preventScroll: true });

		const handler = (e: KeyboardEvent) => {
			// a drawer with another drawer on top of it is scenery: the one
			// on top owns Escape and owns the tab cycle, and this one waits
			// its turn
			if (openDrawers[openDrawers.length - 1] !== token) return;
			if (e.key === 'Escape') {
				e.stopPropagation();
				reason.current = 'Escape';
				close.current();
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
			const at = openDrawers.indexOf(token);
			if (at >= 0) openDrawers.splice(at, 1);
			const back = returnTo.current;
			if (back instanceof HTMLElement) back.focus({ preventScroll: true });
		};
		// `open` alone, deliberately: see the close ref above. onClose in
		// here re-ran this effect on every render of App, which re-focused
		// the first control of a drawer the user had already moved off
	}, [open]);

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
			className={`fixed inset-x-0 bottom-0 top-12 bg-black/40 ${LAYER[z]}`}
			onClick={closeFromBackdrop}
		>
			<div
				ref={panel}
				tabIndex={-1}
				role='dialog'
				aria-modal='true'
				aria-label={title}
				// bg-popover, not bg-secondary, and the backdrop below is why it
				// had to change: bg-black/40 dims the lanes, it does not hide
				// them, so with the transparency knob at 10 the panel's own
				// alpha 0.9 let a 60%-bright lane through its prose. (the
				// knob's DEFAULT is 0 and the window ships opaque - see
				// preferences.rs, which owns that number; this comment used to
				// say the default was 10 and it was never true.) 71fc000 fixed this
				// for menus and reasoned the drawer was covered by that
				// backdrop; it is not - the WSL doctor's paragraphs were read
				// with /var/www, ~20 repo names, hostnames and ports legible
				// straight through them, in every panel, in nord and neon
				// alike. same hex, same look at knob zero, same contrast gate
				className={`${place} flex flex-col bg-bg-popover border-border shadow-surface outline-none`}
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
