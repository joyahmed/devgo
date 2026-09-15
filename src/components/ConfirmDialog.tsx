import { useEffect } from 'react';
import Button from './Button';

const ConfirmDialog = ({
	open,
	title,
	message,
	onConfirm,
	onCancel
}: ConfirmDialogProps) => {
	// Close on Escape. The effect runs unconditionally (hooks must not sit behind
	// an early return); it only wires the listener while the dialog is open.
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onCancel();
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [open, onCancel]);

	if (!open) return null;

	const actions: { label: string; variant: ButtonVariant; onClick: () => void }[] = [
		{ label: 'Cancel', variant: 'secondary', onClick: onCancel },
		{ label: 'Remove', variant: 'danger', onClick: onConfirm }
	];

	return (
		<div
			className='fixed inset-0 bg-black/60 flex items-center justify-center z-50'
			onClick={onCancel}
		>
			<div
				className='bg-bg-secondary border border-border rounded-xl p-6 max-w-sm w-90 shadow-2xl'
				onClick={e => e.stopPropagation()}
			>
				<h3 className='text-base font-bold mb-2'>{title}</h3>
				<p className='text-sm text-text-secondary mb-6'>{message}</p>
				<div className='flex justify-end gap-3'>
					{actions.map(({ label, ...button }) => (
						<Button key={label} {...button}>
							{label}
						</Button>
					))}
				</div>
			</div>
		</div>
	);
};

export default ConfirmDialog;
