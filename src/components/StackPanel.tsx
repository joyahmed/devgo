import Button from './Button';
import StackAddForm from './stack-parts/StackAddForm';
import StackRow from './stack-parts/StackRow';
import { useStack } from '../hooks/useStack';

// the "My stack" window: frameless, always on top, ~300px wide. the header is
// the drag handle; the list is stack.json, shared with the sign-in script
const StackPanel = () => {
	const stack = useStack();
	const header = [
		{ label: 'Start all', onClick: stack.startAll, disabled: !!stack.busy['*'] || stack.editing },
		{ label: stack.editing ? 'Done' : 'Edit', onClick: () => stack.setEditing(e => !e), disabled: false }
	];

	return (
		<main className='flex flex-col h-screen bg-bg-primary text-text-primary border border-border-strong select-none'>
			<header
				data-tauri-drag-region
				className='flex items-center gap-1.5 h-10 shrink-0 pl-3 pr-1.5 border-b border-border-strong bg-bg-secondary'
			>
				<h1 data-tauri-drag-region className='flex-1 text-13 font-semibold'>
					My stack
				</h1>
				{header.map(b => (
					<Button key={b.label} variant='mini' onClick={b.onClick} disabled={b.disabled}>
						{b.label}
					</Button>
				))}
				<Button variant='ghost' aria-label='Close' title='Close' onClick={stack.close} className='w-7 h-7 text-13'>
					✕
				</Button>
			</header>
			<div className='flex-1 overflow-y-auto'>
				{stack.apps.length === 0 && !stack.editing && (
					<p className='p-3 text-13 text-text-secondary'>
						No apps yet. Press Edit to add the apps you start every day.
					</p>
				)}
				<ul>
					{stack.apps.map((a, i) => (
						<StackRow
							key={a.name}
							{...{ name: a.name, index: i, last: i === stack.apps.length - 1, status: stack.status[a.name], stack }}
						/>
					))}
				</ul>
				{stack.editing && <StackAddForm stack={stack} />}
			</div>
			{stack.error && (
				<p role='alert' className='shrink-0 px-3 py-1.5 text-11 text-danger border-t border-border-strong'>
					{stack.error}
				</p>
			)}
		</main>
	);
};

export default StackPanel;
