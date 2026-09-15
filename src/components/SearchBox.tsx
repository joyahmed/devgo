import type { KeyboardEvent } from 'react';
import Button from './Button';

const SearchBox = ({
	value,
	onChange,
	onEnter,
	onArrow,
	enterHint
}: SearchBoxProps) => {
	const keys: Record<string, (() => void) | undefined> = {
		ArrowDown: () => onArrow?.(1),
		ArrowUp: () => onArrow?.(-1),
		Enter: onEnter
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		const action = keys[e.key];
		if (!action) return;
		e.preventDefault();
		action();
	};

	return (
		<div className='shrink-0'>
			<label className='block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-2'>
				Search Projects
			</label>
			<div className='relative bg-bg-panel rounded-lg border border-border focus-within:border-accent transition-colors'>
				<input
					type='text'
					className='w-full py-2.5 pl-3.5 pr-20 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-muted'
					placeholder='Type to filter...'
					value={value}
					onChange={e => onChange(e.target.value)}
					onKeyDown={handleKeyDown}
				/>
				<div className='absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5'>
					{value && (
						<Button
							variant='ghost'
							className='text-text-secondary'
							onClick={() => onChange('')}
						>
							&#10005;
						</Button>
					)}
					{enterHint && (
						<span className='text-[10px] text-text-muted px-1.5 py-0.5 border border-border rounded'>
							{enterHint}
						</span>
					)}
				</div>
			</div>
		</div>
	);
};

export default SearchBox;
