import Button from './Button';
import StackPillCard from './stack-parts/StackPillCard';
import { useStackPill } from '../hooks/useStackPill';
import { DOT_CLASS } from '../stackFormat';

// the floating "My stack" pill: a grip, one dot per app, a ✕. transparent
// window, so the bar's rounded ends are the window's shape. press and move
// to drag; click the bar for the Stack tab; click a dot to start or stop it
const StackPill = () => {
	const pill = useStackPill();

	return (
		<main
			className={`flex gap-1 h-screen w-screen select-none ${pill.side === 'above' ? 'flex-col-reverse' : 'flex-col'}`}
		>
			<div
				ref={pill.bar}
				title='Open the Stack tab'
				onClick={pill.openTab}
				onPointerDown={pill.onPointerDown}
				onPointerMove={pill.onPointerMove}
				onPointerUp={pill.onPointerUp}
				className='flex items-center gap-0.5 h-10 w-max shrink-0 pl-1 pr-1 rounded-full border border-border-strong bg-bg-secondary cursor-default'
			>
				<button
					type='button'
					aria-label='Open the Stack tab'
					className='flex items-center justify-center w-5 h-7 rounded-full text-text-muted hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-accent'
				>
					<svg width='6' height='14' viewBox='0 0 6 14' fill='currentColor' aria-hidden='true'>
						{[1, 7, 13].flatMap(y => [1, 5].map(x => <circle key={`${x}${y}`} cx={x} cy={y} r='1' />))}
					</svg>
				</button>
				{pill.dots.length === 0 && <span className='px-1 text-11 text-text-secondary'>No apps yet</span>}
				{pill.dots.map(d => (
					<button
						key={d.name}
						type='button'
						aria-label={d.label}
						aria-busy={d.busy || undefined}
						onClick={pill.clickDot(d)}
						onMouseEnter={() => pill.hover(d.name)}
						onMouseLeave={() => pill.hover(null)}
						onFocus={() => pill.hover(d.name)}
						onBlur={() => pill.hover(null)}
						className={`flex items-center justify-center size-7 rounded-full hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent ${d.isSelf ? 'cursor-default' : 'cursor-pointer'}`}
					>
						<span className={`size-2.5 rounded-full ${DOT_CLASS[d.state]} ${d.busy ? 'animate-pulse' : ''}`} />
					</button>
				))}
				<span aria-hidden='true' className='w-px h-4 mx-0.5 bg-border-strong' />
				<Button
					variant='ghost'
					aria-label='Close the pill'
					title='Close'
					onClick={pill.close}
					className='size-7 rounded-full text-11'
				>
					✕
				</Button>
			</div>
			{pill.hovered && <StackPillCard dot={pill.hovered} />}
		</main>
	);
};

export default StackPill;
