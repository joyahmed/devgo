const base =
	'inline-flex items-center justify-center font-semibold rounded-lg cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const VARIANT: Record<ButtonVariant, string> = {
	primary:
		'px-5 py-2.5 text-[13px] border border-accent bg-accent text-text-primary hover:bg-accent-hover',
	secondary:
		'px-5 py-2 text-[13px] border border-border bg-bg-panel text-text-secondary hover:bg-bg-hover hover:text-text-primary',
	danger:
		'px-5 py-2 text-[13px] border border-danger bg-danger text-white hover:bg-danger/80',
	ghost:
		'p-1 text-sm rounded bg-transparent border-none text-text-muted hover:text-text-primary hover:bg-bg-hover',
	pill: 'px-6 py-2.5 text-[13px] border border-border rounded-[20px] bg-bg-panel text-text-secondary hover:not-disabled:bg-bg-hover hover:not-disabled:text-text-primary hover:not-disabled:border-accent',
	// A sidebar item; the selected one says so with aria-current="page".
	tab: 'justify-start px-3 py-1.5 text-sm font-medium rounded bg-transparent border-none text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary aria-[current=page]:bg-bg-selected aria-[current=page]:text-text-primary',
	// A title-bar status pill you can click. Disabled means "nothing to act on",
	// and the muted colour says so; the base opacity dims it further.
	badge:
		'px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-bg-panel border border-border text-accent hover:not-disabled:border-accent disabled:text-text-muted',
	// A choice among several; the chosen one says so with aria-pressed.
	card: 'flex-col items-stretch w-full p-3 text-left border border-border bg-transparent text-text-primary hover:border-text-muted aria-[pressed=true]:border-accent aria-[pressed=true]:bg-bg-hover/40'
};

const Button = ({
	variant = 'secondary',
	className = '',
	type = 'button',
	children,
	...rest
}: ButtonProps) => (
	<button {...{ type, className: `${base} ${VARIANT[variant]} ${className}`, ...rest }}>
		{children}
	</button>
);

export default Button;
