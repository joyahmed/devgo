import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { STATE_WORD, stateOf, type StackState } from '../stackFormat';
import { logLine } from '../uiLog';
import { useStack } from './useStack';

// the floating pill: one dot per app, for glancing and one-click start/stop.
// managing lives in the main window's Stack tab; the pill only hands off to
// it. the window is sized by Rust (stack_pill_fit, stack_pill_hover); this
// hook measures the bar and asks

// the hover card's room: a 40 px card and a 4 px gap
export const PILL_CARD_EXTRA = 44;
// a card narrower than this truncates most names; the window widens while
// the card is up and shrinks back to the bar after
export const CARD_MIN_WIDTH = 160;
// a press that moves further than this is a drag, not a click
export const DRAG_PX = 3;

export type PillDot = {
	name: string;
	state: StackState;
	isSelf: boolean;
	icon?: string | null;
	busy: boolean;
	label: string;
};

export type CardSide = 'below' | 'above';

// what a click on the dot will do, said to a screen reader and the tooltip
const dotLabel = (name: string, state: StackState, isSelf: boolean) => {
	if (isSelf) return `${name}: ${STATE_WORD[state]} (this app)`;
	if (state === 'running') return `${name}: Running. Click to stop`;
	if (state === 'stopped') return `${name}: Stopped. Click to start`;
	if (state === 'missing') return `${name}: Not installed. Click to open the Stack tab`;
	return `${name}: ${STATE_WORD[state]}`;
};

const useDocumentVisible = () => {
	const [visible, setVisible] = useState(document.visibilityState === 'visible');
	useEffect(() => {
		const on = () => setVisible(document.visibilityState === 'visible');
		document.addEventListener('visibilitychange', on);
		return () => document.removeEventListener('visibilitychange', on);
	}, []);
	return visible;
};

type Press = { x: number; y: number } | null;
type PointerLike = { button: number; buttons: number; screenX: number; screenY: number };

export const useStackPill = () => {
	const visible = useDocumentVisible();
	const stack = useStack({ active: visible, detail: false });

	const dots: PillDot[] = stack.apps.map(a => {
		const s = stack.status[a.name];
		const state = stateOf(s);
		const isSelf = !!s?.isSelf;
		return {
			name: a.name,
			state,
			isSelf,
			icon: stack.icons[a.path],
			busy: !!(stack.busy[a.name] || stack.busy['*']),
			label: dotLabel(a.name, state, isSelf)
		};
	});

	// the window calls, one at a time: an open still in flight when the
	// pointer leaves must land before the close that undoes it
	const queue = useRef<Promise<unknown>>(Promise.resolve());
	const enqueue = (job: () => Promise<unknown>) => {
		queue.current = queue.current.then(job).catch(() => {});
		return queue.current;
	};

	// the bar's own width, as rendered; the window follows it
	const barWidth = useRef(0);
	const cardOpen = useRef(false);
	const bar = useRef<HTMLDivElement | null>(null);
	const fit = () => {
		const w = Math.ceil(bar.current?.getBoundingClientRect().width ?? 0);
		if (!w || w === barWidth.current) return;
		barWidth.current = w;
		if (!cardOpen.current) enqueue(() => invoke('stack_pill_fit', { width: w }));
	};
	const names = dots.map(d => d.name).join('|');
	useLayoutEffect(fit, [names]);
	useEffect(() => {
		if (!bar.current || typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(fit);
		ro.observe(bar.current);
		return () => ro.disconnect();
	}, []);

	const [hovered, setHovered] = useState<string | null>(null);
	const [side, setSide] = useState<CardSide>('below');
	const hover = (name: string | null) => {
		setHovered(name);
		if (name && !cardOpen.current) {
			cardOpen.current = true;
			return enqueue(async () => {
				if (barWidth.current < CARD_MIN_WIDTH)
					await invoke('stack_pill_fit', { width: CARD_MIN_WIDTH });
				const s = await invoke<CardSide>('stack_pill_hover', { open: true, extra: PILL_CARD_EXTRA });
				setSide(s === 'above' ? 'above' : 'below');
			});
		}
		if (!name && cardOpen.current) {
			cardOpen.current = false;
			return enqueue(async () => {
				await invoke('stack_pill_hover', { open: false, extra: PILL_CARD_EXTRA });
				if (barWidth.current) await invoke('stack_pill_fit', { width: barWidth.current });
				setSide('below');
			});
		}
		return queue.current;
	};

	// press, then move past DRAG_PX = the OS moves the window. a drag that
	// began on a dot must not also click it
	const press = useRef<Press>(null);
	const dragged = useRef(false);
	const onPointerDown = (e: PointerLike) => {
		if (e.button !== 0) return;
		press.current = { x: e.screenX, y: e.screenY };
		dragged.current = false;
	};
	const onPointerMove = (e: PointerLike) => {
		const p = press.current;
		if (!p || !(e.buttons & 1)) return;
		if (Math.hypot(e.screenX - p.x, e.screenY - p.y) <= DRAG_PX) return;
		press.current = null;
		dragged.current = true;
		hover(null);
		return getCurrentWindow().startDragging();
	};
	const onPointerUp = () => {
		press.current = null;
	};
	// the click that ends a drag is not a click
	const swallowDrag = () => {
		if (!dragged.current) return false;
		dragged.current = false;
		return true;
	};

	// the body: the main window, on the Stack tab
	const openTab = () => {
		if (swallowDrag()) return;
		return invoke('stack_show_tab').catch(() => {});
	};

	// a dot: start a stopped app, stop a running one. DevGo's own dot does
	// neither (stopping it would close this pill); a not-installed one has
	// nothing to start, so it opens the tab, where the path can be fixed
	const clickDot = (dot: PillDot) => (e?: { stopPropagation: () => void }) => {
		e?.stopPropagation();
		if (swallowDrag() || dot.isSelf || dot.busy) return;
		if (dot.state === 'missing') return invoke('stack_show_tab').catch(() => {});
		if (dot.state === 'running') return stack.act(dot.name, 'stop');
		if (dot.state === 'stopped') return stack.act(dot.name, 'start');
	};

	// ✕ destroys the window; its webview and poll go with it. the log line
	// tells this close apart from one sent from outside
	const close = (e?: { stopPropagation: () => void }) => {
		e?.stopPropagation();
		logLine('stack: close pressed');
		return getCurrentWindow().close();
	};

	return {
		dots,
		bar,
		hovered: dots.find(d => d.name === hovered) ?? null,
		side,
		error: stack.error,
		hover,
		clickDot,
		openTab,
		close,
		onPointerDown,
		onPointerMove,
		onPointerUp
	};
};

export type UseStackPill = ReturnType<typeof useStackPill>;
