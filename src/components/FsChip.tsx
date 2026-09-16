import { useEffect, useRef, useState } from 'react';
import Button from './Button';
import { fsTone } from './rowStyles';

// one file system in the title bar: the name in its hue, the rows' 7 px
// light when it has one, and its menu under it when it has one. a chip
// with no menu is a fact, not a button: no hand, nothing to open
const FsChip = ({
	fs,
	label = fs,
	title,
	light,
	disabled,
	menu
}: FsChipProps) => {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const away = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node))
				setOpen(false);
		};
		const esc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setOpen(false);
		};
		window.addEventListener('mousedown', away);
		window.addEventListener('keydown', esc);
		return () => {
			window.removeEventListener('mousedown', away);
			window.removeEventListener('keydown', esc);
		};
	}, [open]);

	return (
		<div className='relative' ref={ref}>
			<Button
				variant='badge'
				className={`gap-1.5 ${fsTone(fs)} ${menu ? '' : 'cursor-default!'}`}
				title={title}
				disabled={disabled}
				onClick={menu ? () => setOpen(v => !v) : undefined}
			>
				{light !== undefined && (
					<span
						className={`size-[7px] rounded-full shrink-0 ${
							light
								? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
								: 'border border-text-muted'
						}`}
						aria-hidden='true'
					/>
				)}
				{label}
			</Button>
			{open && menu?.(() => setOpen(false))}
		</div>
	);
};

export default FsChip;
