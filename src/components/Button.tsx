const base =
	'inline-flex items-center justify-center font-semibold rounded-control cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const VARIANT: Record<ButtonVariant, string> = {
	primary:
		'px-5 py-2.5 text-13 border border-accent bg-accent text-text-primary hover:bg-accent-hover',
	secondary:
		'px-5 py-2 text-13 border border-border-strong bg-bg-panel text-text-secondary hover:bg-bg-hover hover:text-text-primary',
	danger:
		'px-5 py-2 text-13 border border-danger bg-danger text-white hover:bg-danger/80',
	// no size of its own: a ghost is a glyph or a word inside something that
	// already has one, and a size here won every text-11 a caller passed
	ghost:
		'p-1 rounded-control bg-transparent border-none text-text-muted hover:text-text-primary hover:bg-bg-hover',
	pill: 'px-6 py-2.5 text-13 border border-border-strong rounded-full bg-bg-panel text-text-secondary hover:not-disabled:bg-bg-hover hover:not-disabled:text-text-primary hover:not-disabled:border-accent',
	// A sidebar item; the selected one says so with aria-current="page".
	tab: 'justify-start px-3 py-1.5 text-15 font-medium rounded-control bg-transparent border-none text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary aria-[current=page]:bg-bg-selected aria-[current=page]:text-text-primary',
	// A title-bar status pill you can click. Disabled means "nothing to act on",
	// and the muted colour says so; the base opacity dims it further.
	badge:
		'px-2.5 py-0.5 text-11 font-semibold rounded-full bg-bg-panel border border-border-strong text-accent hover:not-disabled:border-accent disabled:text-text-muted',
	// A choice among several; the chosen one says so with aria-pressed.
	card: 'flex-col items-stretch w-full p-3 text-left border border-border-strong bg-transparent text-text-primary hover:border-text-muted aria-[pressed=true]:border-accent aria-[pressed=true]:bg-bg-hover/40',
	// A launch target on the row; the default says so with aria-current.
	target:
		'gap-1.5 px-3 py-1.5 text-13 border border-border-strong bg-bg-panel text-text-secondary hover:not-disabled:text-text-primary hover:not-disabled:border-accent aria-[current=true]:border-accent aria-[current=true]:bg-bg-hover/40 aria-[current=true]:text-text-primary',
	// One of a small fixed set, like a number; the chosen one is aria-pressed.
	choice:
		'w-9 h-9 text-15 rounded-control border border-border-strong bg-bg-panel text-text-secondary hover:text-text-primary hover:border-text-muted aria-[pressed=true]:border-accent aria-[pressed=true]:bg-bg-hover/40 aria-[pressed=true]:text-text-primary'
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
