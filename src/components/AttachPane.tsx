import '@xterm/xterm/css/xterm.css';
import { prettyKeys, shortcutFor } from '../shortcuts';
import Button from './Button';
import Kbd from './Kbd';

const STATUS: Record<AttachStatus, string> = {
	opening: 'attaching…',
	attached: 'attached',
	ended: 'detached'
};

// the attach view: the row's session in a pane under the lanes, the
// list still in view above it. not a terminal of its own: what runs in
// it is the multiplexer client, and detach ends that while the session
// stays where it was. one pane, a fixed share of the window
const AttachPane = ({ attach }: AttachPaneProps) => {
	const { pane } = attach;
	if (!pane) return null;
	const live = pane.status === 'attached';
	const key = prettyKeys(shortcutFor('attach'));
	const where = [pane.session, pane.place].filter(Boolean).join(' · ');
	const status =
		pane.status === 'ended' && pane.code
			? `${STATUS.ended} · exit ${pane.code}`
			: STATUS[pane.status];
	return (
		<section
			data-attach
			aria-label='Attach view'
			className='h-[40%] shrink-0 flex flex-col border-t border-border bg-bg-panel'
		>
			<header className='flex items-center gap-3 h-9 px-3 shrink-0 border-b border-border text-13 select-none'>
				<span className='font-semibold text-text-primary truncate'>
					{pane.title}
				</span>
				<span
					className='text-text-muted truncate min-w-0'
					title={pane.line ?? undefined}
				>
					{where}
				</span>
				{/* the rows' light: lit while the client is attached */}
				<span
					className={`inline-flex items-center gap-1.5 text-11 shrink-0 ${
						live ? 'text-accent' : 'text-text-muted'
					}`}
				>
					<span
						aria-hidden='true'
						className={`size-[7px] rounded-full ${
							live
								? 'bg-accent shadow-[0_0_6px_var(--color-accent)]'
								: 'border border-text-muted'
						}`}
					/>
					{status}
				</span>
				<Button
					variant='ghost'
					className='ml-auto gap-1.5 text-13'
					onClick={attach.detach}
					title={
						pane.status === 'ended'
							? 'Close the pane'
							: 'End the client here; the session keeps running'
					}
				>
					<span className='leading-none'>
						{pane.status === 'ended' ? 'Close' : 'Detach'}
					</span>
					<Kbd>{key}</Kbd>
				</Button>
			</header>
			<div ref={attach.host} className='flex-1 min-h-0 px-2 py-1' />
		</section>
	);
};

export default AttachPane;
