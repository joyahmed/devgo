import type { KeyboardEvent } from 'react';
import Button from './Button';

// the input and nothing else. it carried a SEARCH PROJECTS label and a
// 10px sort: button; the placeholder names the scope now and the sort is
// a real control beside the box. from this chapter there are two of
// these, one over the projects and one over the github rows, so it is
// the same component twice rather than two components
const SearchBox = ({
	value,
	onChange,
	onEnter,
	onArrow,
	enterHint,
	placeholder = 'Search local projects…',
	lane = 'projects',
	className = '',
	ref
}: SearchBoxProps) => {
	const keys: Record<string, (() => void) | undefined> = {
		ArrowDown: () => onArrow?.(1),
		ArrowUp: () => onArrow?.(-1),
		Escape: () => onChange(''),
		Enter: onEnter
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		// Bare keys only. Ctrl+Enter, Shift+Enter and Alt+Enter are project
		// actions declared in the shortcut table and owned by App's handler; if
		// this forwarded them as a plain Enter, one chord would launch twice.
		if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
		const action = keys[e.key];
		if (!action) return;
		e.preventDefault();
		action();
	};

	return (
		<div
			className={`relative bg-bg-panel rounded-control border border-border-strong focus-within:border-accent focus-within:shadow-[var(--color-glow)] transition-colors ${className}`}
		>
			<input
				ref={ref}
				type='text'
				// the launcher's whole job is to be typed into the instant it
				// appears, and the project box is where that typing goes
				autoFocus={lane === 'projects'}
				data-lane-search={lane}
				className='w-full py-2 pl-3.5 pr-20 bg-transparent outline-none text-15 text-text-primary placeholder:text-text-muted'
				placeholder={placeholder}
				value={value}
				onChange={e => onChange(e.target.value)}
				onKeyDown={handleKeyDown}
			/>
			<div className='absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5'>
				{value && (
					<Button
						variant='ghost'
						className='text-15 text-text-secondary'
						title='Clear'
						onClick={() => onChange('')}
					>
						&#10005;
					</Button>
				)}
				{enterHint && (
					<span className='text-11 text-text-muted px-1.5 py-0.5 border border-border-strong rounded-control'>
						{enterHint}
					</span>
				)}
			</div>
		</div>
	);
};

export default SearchBox;
