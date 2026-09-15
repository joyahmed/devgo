import { createContext, useContext, useState } from 'react';

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

	const toast = (message: string, type: ToastType = 'error') => {
		const id = ++toastId;
		setToasts(prev => [...prev, { id, message, type }]);
		setTimeout(() => {
			setToasts(prev => prev.filter(t => t.id !== id));
		}, 4000);
	};

	return (
		<ToastContext.Provider value={{ toasts, toast }}>
			{children}
			<div className='fixed bottom-4 right-4 z-50 flex flex-col gap-2'>
				{toasts.map(t => (
					<div
						key={t.id}
						className={`px-4 py-3 bg-bg-secondary border rounded-panel text-15 shadow-surface animate-fade-in ${VARIANT[t.type]}`}
					>
						{t.message}
					</div>
				))}
			</div>
		</ToastContext.Provider>
	);
};

export default ToastProvider;

export const useToast = () => useContext(ToastContext);
