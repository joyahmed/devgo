import Button from './Button';
import Modal from './Modal';

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

	return (
		<Modal {...{ open, title, onClose: onCancel }}>
			<p className='text-15 text-text-secondary mb-6'>{message}</p>
			<div className='flex justify-end gap-3'>
				{actions.map(({ label, ...button }) => (
					<Button key={label} {...button}>
						{label}
					</Button>
				))}
			</div>
		</Modal>
	);
};

export default ConfirmDialog;
