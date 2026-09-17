import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { PANE_KEYS, matches, shortcutFor } from '../shortcuts';

const cssVar = (name: string) =>
	getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// the pane's colours from the palette tokens, read when it opens: the
// inks and the accent as they are, the ground transparent so the pane's
// own surface (bg-panel, which follows the knob) shows through
const theme = () => ({
	background: 'rgba(0, 0, 0, 0)',
	foreground: cssVar('--color-text-primary'),
	cursor: cssVar('--color-accent'),
	cursorAccent: cssVar('--solid-bg-panel'),
	selectionBackground: cssVar('--solid-bg-selected'),
	selectionForeground: cssVar('--color-text-primary')
});

// xterm rides its own chunk: a launcher that never attaches never loads it
const loadXterm = () =>
	Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);

// the attach view: one pane, a terminal in it, and the pty behind it.
// the effect owns the pty's whole life: it opens it once the terminal
// knows its size, and its cleanup closes it, so replacing the pane or
// dropping it are the same detach. the exit event is the other way out,
// and the pane stays on screen saying so
export const useAttach = (onError: (e: unknown) => void): AttachState => {
	const [pane, setPane] = useState<AttachPane | null>(null);
	const host = useRef<HTMLDivElement>(null);
	const seq = useRef(0);

	const open = (target: AttachTarget, title: string) => {
		seq.current += 1;
		setPane({
			seq: seq.current,
			target,
			title,
			id: null,
			session: null,
			place: null,
			line: null,
			status: 'opening',
			code: null
		});
	};

	const detach = () => setPane(null);

	useEffect(() => {
		const el = host.current;
		if (!pane || !el) return;
		const mine = pane.seq;
		const patch = (next: Partial<AttachPane>) =>
			setPane(cur => (cur?.seq === mine ? { ...cur, ...next } : cur));
		const fail = (e: unknown) => {
			setPane(null);
			onError(e);
		};

		let gone = false;
		let cleanup: (() => void) | null = null;
		loadXterm()
			.then(([{ Terminal }, { FitAddon }]) => {
				if (gone) return;
				const term = new Terminal({
					theme: theme(),
					fontFamily: cssVar('--font-mono'),
					fontSize: 13,
					cursorBlink: true,
					allowTransparency: true,
					scrollback: 2000
				});
				const fit = new FitAddon();
				term.loadAddon(fit);
				term.open(el);
				fit.fit();
				term.focus();
				// the palette and the attach key stay the app's; the rest is
				// the shell's, escape included
				term.attachCustomKeyEventHandler(
					e => !PANE_KEYS.some(id => matches(e, shortcutFor(id)))
				);

				let id: string | null = null;
				// an exit that lands before pty_open has answered with the id
				const exits = new Map<string, number>();
				const ended = (code: number) => {
					id = null;
					term.write(`\r\n\x1b[2m[detached · exit ${code}]\x1b[0m`);
					patch({ status: 'ended', code });
				};

				const channel = new Channel<ArrayBuffer>();
				channel.onmessage = buf => term.write(new Uint8Array(buf));
				const data = term.onData(d => {
					if (id) invoke('pty_write', { id, data: d }).catch(() => {});
				});
				const resized = term.onResize(({ cols, rows }) => {
					if (id) invoke('pty_resize', { id, cols, rows }).catch(() => {});
				});
				const observer = new ResizeObserver(() => fit.fit());
				observer.observe(el);

				// the listener first, then the spawn: a client that dies at
				// once must not end before anyone is listening
				const unlisten = listen<PtyExit>('devgo://pty-exit', e => {
					if (id === e.payload.id) ended(e.payload.code);
					else exits.set(e.payload.id, e.payload.code);
				}).then(stop => {
					if (gone) return stop;
					invoke<AttachOpened>('pty_open', {
						target: pane.target,
						cols: term.cols,
						rows: term.rows,
						onData: channel
					})
						.then(opened => {
							if (gone) {
								invoke('pty_close', { id: opened.id }).catch(() => {});
								return;
							}
							id = opened.id;
							patch({ ...opened, status: 'attached' });
							const early = exits.get(opened.id);
							if (early !== undefined) ended(early);
						})
						.catch(fail);
					return stop;
				});

				cleanup = () => {
					unlisten.then(stop => stop()).catch(() => {});
					observer.disconnect();
					data.dispose();
					resized.dispose();
					if (id) invoke('pty_close', { id }).catch(() => {});
					term.dispose();
				};
			})
			.catch(fail);

		return () => {
			gone = true;
			cleanup?.();
		};
	}, [pane?.seq]);

	return { pane, host, open, detach };
};
