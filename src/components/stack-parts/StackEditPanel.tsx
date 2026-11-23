import Button from '../Button';
import StackAppIcon from './StackAppIcon';
import { DRAFT_FIELDS, type UseStackEditor } from '../../hooks/useStackEditor';

const field =
	'w-full h-9 px-3 bg-bg-primary border border-border-strong rounded-control text-13 text-text-primary outline-none focus:border-accent placeholder:text-text-muted';

// the form, in place: under a row when it edits that row, at the top of the
// list when it adds one. three fields, mapped; the program field has its
// own Browse, which reads the new exe's name and icon again
const StackEditPanel = ({ editor }: { editor: UseStackEditor }) => {
	const { draft } = editor;
	if (!draft) return null;
	const isNew = draft.index === null;
	return (
		<form
			onSubmit={e => {
				e.preventDefault();
				editor.save();
			}}
			className='flex flex-col gap-4 p-4 border-t border-border'
		>
			{isNew && (
				<div className='flex items-center gap-3'>
					<StackAppIcon name={draft.name} icon={draft.icon} />
					<div className='min-w-0'>
						<p className='text-15 font-semibold text-text-primary truncate'>
							{draft.name || 'New app'}
						</p>
						<p className='text-13 text-text-secondary'>
							Name and icon read from the program. Change the name if you like.
						</p>
					</div>
				</div>
			)}
			<div className='grid gap-3 grid-cols-1 min-[760px]:grid-cols-[1fr_2fr_auto]'>
				{DRAFT_FIELDS.map(f => (
					<label key={f.key} className='flex flex-col gap-1 min-w-0'>
						<span className='text-11 font-semibold text-text-muted'>{f.label}</span>
						<span className='flex gap-2'>
							<input
								className={`${field} ${f.mono ? 'font-mono' : ''} ${f.key === 'delay' ? 'min-[760px]:w-28' : ''}`}
								value={draft[f.key]}
								placeholder={f.placeholder}
								inputMode={f.key === 'delay' ? 'numeric' : undefined}
								autoFocus={f.key === 'name'}
								onChange={e => editor.change(f.key, e.target.value)}
							/>
							{f.browse && (
								<Button variant='quiet' onClick={editor.browse} disabled={editor.picking}>
									Browse…
								</Button>
							)}
						</span>
					</label>
				))}
			</div>
			<div className='flex items-center justify-end gap-2'>
				{editor.error && (
					<p role='alert' className='mr-auto text-13 text-danger'>
						{editor.error}
					</p>
				)}
				<Button variant='quiet' onClick={editor.cancel}>
					Cancel
				</Button>
				<Button variant='solid' type='submit'>
					{isNew ? 'Add to stack' : 'Save'}
				</Button>
			</div>
		</form>
	);
};

export default StackEditPanel;
