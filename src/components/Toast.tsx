import { createContext, useContext, useState } from 'react';
import Button from './Button';

const ToastContext = createContext<ToastContextType>({
	toasts: [],
	toast: () => {}
});

let toastId = 0;

const VARIANT: Record<ToastType, string> = {
	error: 'border-danger/40 text-red-300',
	success: 'border-emerald-500/40 text-emerald-300',
	info: 'border-border text-text-secondary'
};

const ToastProvider = ({ children }: ToastProviderProps) => {
	const [toasts, setToasts] = useState<Toast[]>([]);

	const dismiss = (id: number) =>
		setToasts(prev => prev.filter(t => t.id !== id));

	// one with an action stays twice as long: there is something to click
	const toast = (
		message: string,
		type: ToastType = 'error',
		action?: ToastAction
	) => {
		const id = ++toastId;
		setToasts(prev => [...prev, { id, message, type, action }]);
		setTimeout(() => dismiss(id), action ? 8000 : 4000);
	};

	return (
		<ToastContext.Provider value={{ toasts, toast }}>
			{children}
			<div className='fixed bottom-4 right-4 z-50 flex flex-col gap-2'>
				{toasts.map(t => (
					<div
						key={t.id}
						className={`flex items-center gap-3 px-4 py-3 bg-bg-secondary border rounded-panel text-15 shadow-surface animate-fade-in ${VARIANT[t.type]}`}
					>
						<span>{t.message}</span>
						{t.action && (
							<Button
								variant='ghost'
								className='text-13 text-accent shrink-0'
								onClick={() => {
									t.action?.onClick();
									dismiss(t.id);
								}}
							>
								{t.action.label}
							</Button>
						)}
					</div>
				))}
			</div>
		</ToastContext.Provider>
	);
};

export default ToastProvider;

export const useToast = () => useContext(ToastContext);
