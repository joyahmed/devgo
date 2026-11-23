import StackAppIcon from './StackAppIcon';
import { STATE_WORD } from '../../stackFormat';
import type { PillDot } from '../../hooks/useStackPill';

// the state word wears its dot's colour, as on the tab
const STATE_TONE = {
	checking: 'text-text-muted',
	running: 'text-emerald-300',
	stopped: 'text-danger',
	missing: 'text-text-secondary'
};

// what a click on the dot does, in three words
const HINT = {
	checking: '',
	running: 'click to stop',
	stopped: 'click to start',
	missing: 'click to fix'
};

// the hovered dot, spelled out: icon, name, state. 40 px tall; the window
// grew 44 to hold it (useStackPill), below the bar or above it
const StackPillCard = ({ dot }: { dot: PillDot }) => (
	<div
		role='status'
		className='flex items-center gap-2 h-10 w-full shrink-0 px-2 rounded-panel border border-border-strong bg-bg-popover pointer-events-none'
	>
		<StackAppIcon name={dot.name} icon={dot.icon} small />
		<div className='min-w-0 flex flex-col'>
			<span className='truncate text-13 font-semibold text-text-primary'>{dot.name}</span>
			<span className='truncate text-11'>
				<span className={STATE_TONE[dot.state]}>{STATE_WORD[dot.state]}</span>
				<span className='text-text-muted'>
					{dot.isSelf ? ' · this app' : HINT[dot.state] && ` · ${HINT[dot.state]}`}
				</span>
			</span>
		</div>
	</div>
);

export default StackPillCard;
