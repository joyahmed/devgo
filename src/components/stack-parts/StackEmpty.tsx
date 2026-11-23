import Button from '../Button';

const STEPS = [
	'Pick a program. Its name and icon come with it.',
	'Set when it starts after you sign in.',
	'Add the next one. The order here is the start order.'
];

// no apps yet: what the tab is for, and the one button that starts it
const StackEmpty = ({ onAdd, picking }: { onAdd: () => void; picking: boolean }) => (
	<div className='flex flex-col items-start gap-4 p-8 rounded-panel border border-dashed border-border-strong bg-bg-panel'>
		<h2 className='text-18 font-bold text-text-primary'>Your stack is empty</h2>
		<p className='max-w-[36rem] text-15 text-text-secondary'>
			Add the programs you open every morning. DevGo starts them one after another when you sign
			in, and this tab shows which are running.
		</p>
		<ol className='flex flex-col gap-2'>
			{STEPS.map((s, i) => (
				<li key={s} className='flex items-center gap-3 text-13 text-text-secondary'>
					<span className='size-6 shrink-0 flex items-center justify-center rounded-full bg-bg-raised font-mono text-11 font-semibold text-text-primary'>
						{i + 1}
					</span>
					{s}
				</li>
			))}
		</ol>
		<Button variant='solid' onClick={onAdd} disabled={picking}>
			{picking ? 'Choosing…' : 'Add your first app'}
		</Button>
	</div>
);

export default StackEmpty;
