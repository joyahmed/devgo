import type { KeyboardEvent } from 'react';
import { prettyKeys, shortcutFor } from '../shortcuts';
import Button from './Button';
import Kbd from './Kbd';

// which key summons which box. the lane already says which box this is,
// so the id is derived here rather than passed in: a call site that could
// hand over a key is a call site that could hand over the wrong one, and
// the chip would then advertise a binding the handler does not have
const FOCUS_KEY: Record<SearchLane, ShortcutId> = {
	projects: 'focusSearch',
	github: 'focusGithubSearch',
	servers: 'focusServerSearch'
};

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
				// the chips float over the input's right end, so the padding has
				// to be the room they take. two of them at once is the one case
				// that needs more than the old reserve, and it can only happen
				// on an empty box: with text the focus chip is gone and the
				// clear x that replaces it is the narrower of the two
				className={`w-full py-2 pl-3.5 ${!value && enterHint ? 'pr-36' : 'pr-20'} bg-transparent outline-none text-15 text-text-primary placeholder:text-text-muted`}
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
				{/* the same chip every other shortcut hint wears */}
				{enterHint && <Kbd>Enter</Kbd>}
				{/* the key that summons this box, so the binding is discoverable
				    without opening settings. it goes once there is text: the hint
				    is for the box you are not in, and the clear x arrives on the
				    same keystroke, so the row was changing at that moment anyway.
				    clicking in changes nothing, which was the whole objection to
				    swapping it with enter on focus */}
				{!value && <Kbd>{prettyKeys(shortcutFor(FOCUS_KEY[lane]))}</Kbd>}
			</div>
		</div>
	);
};

export default SearchBox;
