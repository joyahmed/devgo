import { useEffect } from 'react';

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

	const actions = [
		{
			label: 'Cancel',
			className:
				'border-border bg-bg-panel text-text-secondary hover:bg-bg-hover hover:text-text-primary',
			onClick: onCancel
		},
		{
			label: 'Remove',
			className: 'border-danger bg-danger text-white hover:bg-danger/80',
			onClick: onConfirm
		}
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
					{actions.map(({ label, className, onClick }) => (
						<button
							key={label}
							type='button'
							className={`px-5 py-2 text-[13px] font-semibold border rounded-lg cursor-pointer ${className}`}
							onClick={onClick}
						>
							{label}
						</button>
					))}
				</div>
			</div>
		</div>
	);
};

export default ConfirmDialog;
