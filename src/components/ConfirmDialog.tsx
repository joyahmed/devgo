import Button from './Button';
import Drawer from './Drawer';

const ConfirmDialog = ({
	open,
	title,
	message,
	confirmLabel = 'Confirm',
	onConfirm,
	onCancel
}: ConfirmDialogProps) => {
	const actions: { label: string; variant: ButtonVariant; onClick: () => void }[] = [
		{ label: 'Cancel', variant: 'secondary', onClick: onCancel },
		{ label: confirmLabel, variant: 'danger', onClick: onConfirm }
	];

	// a sentence and two buttons as a sheet under the title bar. the list
	// stays in view behind it: a confirm is a pause, not a place
	return (
		<Drawer {...{ open, side: 'top' as const, title, onClose: onCancel }}>
			<p className='text-15 text-text-secondary mb-6'>{message}</p>
			<div className='flex justify-end gap-3'>
				{actions.map(({ label, ...button }) => (
					<Button key={label} {...button}>
						{label}
					</Button>
				))}
			</div>
		</Drawer>
	);
};

export default ConfirmDialog;
