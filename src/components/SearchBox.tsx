import type { KeyboardEvent } from 'react';
import { escapeCleared } from '../searchKeys';
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

// how narrow a box may get before its summon chip goes, per lane. the
// query is asked of the box's CONTENT box, 10px inside the box itself (a
// 1px border each side and the pr-2 the chips sit in), and the number is
// the narrowest content in which that lane's placeholder still reads
// beside its chips. measured, not judged — every box rendered at 1px
// steps with BOTH chips up (Enter and the summon key, which is the worst
// case) and the placeholder's own width compared with what the input is
// left:
//   projects  294.4  "Search local projects…"     + ENTER + CTRL+K
//   github    295.1  "Search GitHub repos…"       + ENTER + CTRL+G
//   servers   318.6  "Search servers & folders…"  + ENTER + CTRL+H
// so 18.5rem = 296 for the two short placeholders, and the servers box
// keeps 20rem = 320 because its placeholder is 24px longer and clips
// under 318.6. one number for all three would have to be the servers
// floor, and that is why joy's mac showed no CTRL+G: three lanes at 1686
// leave the github box 300.4px of content, 19.6 short of 20rem, while
// the servers box beside it has 402 — the boxes differ, so their floors
// do. macos pays for its longer placeholders out of a shorter chip
// (CMD+G, one mono advance narrower than CTRL+G), which is why one pair
// of numbers holds on both.
//
// ⛔ do not lower these by eye. 474bfac exists because a fixed 144px
// chip reserve on a 230px box rendered the projects placeholder as
// "Search lo"; these floors are the only thing between that bug and the
// next narrow window
const GATE: Record<SearchLane, string> = {
	projects: '@max-[18.5rem]:hidden',
	github: '@max-[18.5rem]:hidden',
	servers: '@max-[20rem]:hidden'
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
	placeholder = 'Search local projects…',
	lane = 'projects',
	className = '',
	ref
}: SearchBoxProps) => {
	const keys: Record<string, (() => void) | undefined> = {
		ArrowDown: () => onArrow?.(1),
		ArrowUp: () => onArrow?.(-1),
		Enter: onEnter
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		// Bare keys only. Ctrl+Enter, Shift+Enter and Alt+Enter are project
		// actions declared in the shortcut table and owned by App's handler; if
		// this forwarded them as a plain Enter, one chord would launch twice.
		if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
		// Escape is not in the table above because it has two answers, not
		// one: it clears a box with text in it and stops there, and it is
		// left alone on an empty box so whatever is around the box can
		// close on it. escapeCleared holds that rule for every search box
		if (escapeCleared(e, value, () => onChange(''))) return;
		const action = keys[e.key];
		if (!action) return;
		e.preventDefault();
		action();
	};

	// the chips used to float over the input's right end on a fixed
	// padding reserve, and a reserve is a number that goes stale: the day
	// a second chip arrived, 144px of it was reserved on a box that can be
	// 230px wide and the placeholder read "Search lo". the row is a flex
	// row now, so the input is given what the chips do not take and the
	// reserve cannot drift from what is drawn.
	//
	// a box's width is not a function of the window — four lanes on a 4k
	// screen give a 230px github box — so the one thing that still has to
	// be asked is asked of the box itself, with a container query rather
	// than a breakpoint
	return (
		<div
			className={`@container flex items-center gap-1.5 pr-2 bg-bg-panel rounded-control border border-border-strong focus-within:border-accent focus-within:shadow-[var(--color-glow)] transition-colors ${className}`}
		>
			<input
				ref={ref}
				type='text'
				// the launcher's whole job is to be typed into the instant it
				// appears, and the project box is where that typing goes
				autoFocus={lane === 'projects'}
				data-lane-search={lane}
				// min-w-0 or the input refuses to shrink below its own intrinsic
				// width and pushes the chips out of the box
				className='flex-1 min-w-0 py-2 pl-3.5 bg-transparent outline-none text-15 text-text-primary placeholder:text-text-muted'
				placeholder={placeholder}
				value={value}
				onChange={e => onChange(e.target.value)}
				onKeyDown={handleKeyDown}
			/>
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
			{/* the same chip every other shortcut hint wears. any input at all
			    is the whole condition (joy: "ENTER should appear on any search
			    bar when it has any input"), and it is derived from value here
			    for the same reason the summon key above is derived from lane: it
			    was a prop, and three of the five call sites forgot to pass it
			    until a fix on 2026-09-26, so the chip was simply missing on
			    three boxes. the component already owns value, so it owns the
			    answer — do not turn this back into a prop */}
			{value && <Kbd>Enter</Kbd>}
			{/* the key that summons this box, so the binding is discoverable
			    without opening settings. it goes once there is text: the hint
			    is for the box you are not in, and the clear x arrives on the
			    same keystroke, so the row was changing at that moment anyway.
			    clicking in changes nothing, which was the whole objection to
			    swapping it with enter on focus. it also goes on a box too
			    narrow to hold it beside the placeholder — GATE, above, per
			    lane — for the same reason and in the same order the footer
			    drops its hints: a key for somewhere you are not is worth less
			    than the words saying what this box searches. Enter stays —
			    it names the key of the box you are in */}
			{!value && (
				<span className={`flex ${GATE[lane]}`}>
					<Kbd>{prettyKeys(shortcutFor(FOCUS_KEY[lane]))}</Kbd>
				</span>
			)}
		</div>
	);
};

export default SearchBox;
