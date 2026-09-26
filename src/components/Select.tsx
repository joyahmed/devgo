import { useEffect, useId, useRef, useState } from 'react';

// as tall as the list grows before it scrolls, and the room it wants
// below the trigger before it opens upwards instead
const MAX = 240;
// how long a typed prefix stays live, the way a native select holds one
const TYPE_MS = 800;

const trigger =
	'w-full flex items-center gap-2 px-2 py-1.5 bg-bg-panel border border-border-strong rounded-control text-13 text-text-primary text-left cursor-pointer outline-none focus:border-accent';

// a dropdown the page draws, not the platform. a native <select> is
// painted by gtk under webkitgtk: the closed box came out in gtk's own
// light fill with our near-white ink on it, white on white, and nothing
// in a stylesheet reaches the popup gtk opens either. so this is the
// ContextMenu surface with the palette's keys, the same control on all
// three platforms
const Select = ({ value, options, onChange, label, title }: SelectProps) => {
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const [up, setUp] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const btn = useRef<HTMLButtonElement>(null);
	const row = useRef<HTMLDivElement>(null);
	const id = useId();

	// a value no option carries — no workspace added yet — shows the first,
	// which is what the native control did with it
	const at = options.findIndex(o => o.value === value);
	const current = options[at] ?? options[0];

	// a click anywhere else shuts it, as the menus do
	useEffect(() => {
		if (!open) return;
		const away = (e: MouseEvent) => {
			if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
		};
		window.addEventListener('mousedown', away);
		return () => window.removeEventListener('mousedown', away);
	}, [open]);

	useEffect(() => {
		if (open) row.current?.scrollIntoView({ block: 'nearest' });
	}, [open, active]);

	const show = () => {
		// the one caller sits on the last row of a drawer: measure rather
		// than assume, so a list with room below still drops down
		const r = box.current?.getBoundingClientRect();
		setUp(r ? window.innerHeight - r.bottom < MAX + 8 : false);
		setActive(at < 0 ? 0 : at);
		setOpen(true);
	};

	const pick = (i: number) => {
		setOpen(false);
		btn.current?.focus();
		const o = options[i];
		if (o) onChange(o.value);
	};

	// first letters jump: while the list is open they move the highlight,
	// while it is shut they choose, as they do on a native select. the
	// buffer expires by timestamp, so there is no timer to clear.
	// one letter is a cycle, not a longer prefix: "ww" matched no label and
	// the highlight stuck on the first w, so ws2 was unreachable from the
	// keyboard. a single letter — pressed again inside the window, OR
	// pressed fresh after it has lapsed — searches from one past where we
	// are and wraps, so holding 0 walks 01_tauri → 02_next → 03_ai and back
	// round at whatever speed it is pressed; waiting out the buffer used to
	// restart from the top and re-pick the row already under the cursor,
	// which reads as the key doing nothing. only two DIFFERENT letters make
	// a prefix, and that searches from the top, so "ws2" still lands directly
	const typed = useRef({ text: '', at: 0 });
	const jump = (key: string) => {
		const now = Date.now();
		const letter = key.toLowerCase();
		const text =
			(now - typed.current.at < TYPE_MS ? typed.current.text : '') + letter;
		typed.current = { text, at: now };
		const cycling = [...text].every(c => c === letter);
		const prefix = cycling ? letter : text;
		const from = cycling ? (open ? active : at) + 1 : 0;
		const n = options.length;
		const i = options
			.map((_, j) => (from + j) % n)
			.find(j => options[j].label.toLowerCase().startsWith(prefix));
		if (i === undefined) return;
		if (open) setActive(i);
		else pick(i);
	};

	const step = (d: number) =>
		setActive(i => Math.max(0, Math.min(i + d, options.length - 1)));

	const keys: Record<string, () => void> = {
		ArrowDown: () => (open ? step(1) : show()),
		ArrowUp: () => (open ? step(-1) : show()),
		Home: () => (open ? setActive(0) : show()),
		End: () => (open ? setActive(options.length - 1) : show()),
		Enter: () => (open ? pick(active) : show()),
		' ': () => (open ? pick(active) : show()),
		Escape: () => setOpen(false)
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		const action = keys[e.key];
		if (action) {
			// escape is the drawer's once the list is shut; while it is open
			// it belongs here and goes no further
			if (e.key === 'Escape' && !open) return;
			e.preventDefault();
			e.stopPropagation();
			action();
			return;
		}
		// tab leaves the control, so the list goes with it
		if (e.key === 'Tab') return setOpen(false);
		if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
			e.preventDefault();
			jump(e.key);
		}
	};

	return (
		<div ref={box} className='relative min-w-0 flex-1'>
			<button
				ref={btn}
				type='button'
				role='combobox'
				aria-expanded={open}
				aria-controls={id}
				aria-activedescendant={open ? `${id}-${active}` : undefined}
				aria-label={label}
				className={trigger}
				title={title}
				onClick={() => (open ? setOpen(false) : show())}
				onKeyDown={handleKeyDown}
			>
				<span className='min-w-0 flex-1 truncate'>
					{current?.label}
					{current?.hint && (
						<span className='text-text-muted'> · {current.hint}</span>
					)}
				</span>
				<svg
					width='10'
					height='10'
					viewBox='0 0 10 10'
					className='shrink-0 text-text-muted'
					aria-hidden='true'
				>
					<path
						d='M2 4 5 7 8 4'
						fill='none'
						stroke='currentColor'
						strokeWidth='1.5'
						strokeLinecap='round'
						strokeLinejoin='round'
					/>
				</svg>
			</button>
			{open && (
				<div
					id={id}
					role='listbox'
					aria-label={label}
					// bg-popover: the open list covers the fields under it, and a
					// see-through one showed their labels through its options
					className={`absolute inset-x-0 z-50 overflow-y-auto bg-bg-popover border border-border rounded-panel shadow-surface py-1 ${
						up ? 'bottom-full mb-1' : 'top-full mt-1'
					}`}
					style={{ maxHeight: MAX }}
				>
					{options.map((o, i) => (
						<div
							key={o.value}
							id={`${id}-${i}`}
							ref={i === active ? row : undefined}
							role='option'
							aria-selected={i === at}
							className={`flex items-baseline gap-2 px-3 py-1.5 text-13 cursor-pointer ${
								i === active ? 'bg-bg-hover' : i === at ? 'bg-bg-selected' : ''
							}`}
							onMouseMove={() => setActive(i)}
							onClick={() => pick(i)}
						>
							<span className='shrink-0 text-text-primary'>{o.label}</span>
							{o.hint && (
								<span className='min-w-0 truncate text-text-muted'>
									{o.hint}
								</span>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
};

export default Select;
