import { useEffect } from 'react';

// the one modal frame: backdrop, centred panel, Escape and backdrop click
// to close. ConfirmDialog was this frame with a message and two buttons
// baked in, fine while it was the only modal; the scan picker is the
// second, and two hand-rolled frames drift
const Modal = ({
	open,
	title,
	onClose,
	children,
	width = 'w-[min(460px,92vw)]'
}: ModalProps) => {
	// runs unconditionally (hooks cannot sit behind the early return) and
	// only wires the listener while open
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div
			className='fixed inset-0 bg-black/60 flex items-center justify-center z-50'
			onClick={onClose}
		>
			<div
				className={`bg-bg-secondary border border-border rounded-panel p-6 ${width} shadow-surface`}
				onClick={e => e.stopPropagation()}
			>
				<h3 className='text-18 font-bold mb-2'>{title}</h3>
				{children}
			</div>
		</div>
	);
};

export default Modal;
