import { DOT_CLASS, delayLabel, type StackState } from '../../stackFormat';

type StackRailProps = { delay: number; state: StackState; last: boolean };

// the left column of a row: when the app starts after sign-in, and a node on
// the line that runs down the whole list. the line IS the start order; the
// node is the app's state dot (green running, red stopped, grey ring not
// installed). the node sits on a ground-coloured disc so a hollow ring does
// not show the line through it
const StackRail = ({ delay, state, last }: StackRailProps) => (
	<div className='relative w-24 shrink-0 flex items-center justify-end gap-3 pr-1'>
		<span className='flex flex-col items-end leading-none'>
			<span className='text-11 text-text-muted'>starts at</span>
			<span className='font-mono text-13 font-semibold text-text-primary'>{delayLabel(delay)}</span>
		</span>
		<span
			aria-hidden='true'
			className={`absolute right-[13px] top-0 w-0.5 bg-border-strong ${last ? 'h-1/2' : 'bottom-0'}`}
		/>
		<span aria-hidden='true' className='relative flex p-1 rounded-full bg-bg-primary'>
			<span className={`size-3 rounded-full ${DOT_CLASS[state]}`} />
		</span>
	</div>
);

export default StackRail;
