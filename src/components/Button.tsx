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
	pill: 'px-6 py-2.5 text-[13px] border border-border rounded-[20px] bg-bg-panel text-text-secondary hover:not-disabled:bg-bg-hover hover:not-disabled:text-text-primary hover:not-disabled:border-accent'
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
