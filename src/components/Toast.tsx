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
		action?: ToastAction,
		detail?: string
	) => {
		const id = ++toastId;
		setToasts(prev => [...prev, { id, message, type, action, detail }]);
		setTimeout(() => dismiss(id), action ? 8000 : 4000);
	};

	return (
		<ToastContext.Provider value={{ toasts, toast }}>
			{children}
			{/* top centre, under the h-12 title bar: the bottom right corner is
			    where Joy's eyes are not, and a toast that is never read is a
			    message that was never sent. pointer-events stay off the column
			    so a toast floating over the tree cannot swallow a click. */}
			<div className='fixed top-16 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none'>
				{toasts.map(t => (
					<div
						key={t.id}
						title={t.detail}
						// max-w is structural: however long a message grows, the toast
						// stays a toast instead of stretching into a full width strip.
						// bg-popover because a toast floats over the lanes with no
						// backdrop under it: a message nobody can read against the row
						// text behind it is a message that was never sent either
						className={`flex items-center gap-3 px-5 py-3 max-w-[min(34rem,90vw)] bg-bg-popover border rounded-panel text-18 shadow-surface animate-fade-in pointer-events-auto ${VARIANT[t.type]}`}
					>
						<span>{t.message}</span>
						{t.action && (
							<Button
								variant='ghost'
								className='text-15 text-accent shrink-0'
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
