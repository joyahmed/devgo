import Button from '../Button';
import { ADD_FIELDS, useStackAddForm } from '../../hooks/useStackAddForm';
import type { UseStack } from '../../hooks/useStack';

const StackAddForm = ({ stack }: { stack: UseStack }) => {
	const { values, error, change, submit } = useStackAddForm(stack.add);

	return (
		<form onSubmit={submit} className='flex flex-col gap-1.5 p-3 border-b border-border'>
			{ADD_FIELDS.map(f => (
				<label key={f.key} className='flex flex-col gap-0.5 text-11 text-text-muted'>
					{f.label}
					<input
						value={values[f.key]}
						placeholder={f.placeholder}
						onChange={e => change(f.key, e.target.value)}
						className='h-7 px-2 text-13 rounded-control border border-border-strong bg-bg-panel text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent'
					/>
				</label>
			))}
			{error && <p className='text-11 text-danger'>{error}</p>}
			<Button type='submit' variant='mini' className='self-end'>
				Add app
			</Button>
		</form>
	);
};

export default StackAddForm;
