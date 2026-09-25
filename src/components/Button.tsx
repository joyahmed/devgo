// disabled in tokens, never opacity: a half-transparent label fails the
// first-paint contrast the gate holds every ink to
const base =
	'inline-flex items-center justify-center font-semibold rounded-control cursor-pointer transition-colors disabled:cursor-not-allowed';

const VARIANT: Record<ButtonVariant, string> = {
	primary:
		'px-5 py-2.5 text-13 border border-accent bg-accent text-bg-primary hover:not-disabled:bg-accent-hover disabled:bg-bg-panel disabled:border-border disabled:text-text-muted',
	secondary:
		'px-5 py-2 text-13 border border-border-strong bg-bg-panel text-text-secondary hover:not-disabled:bg-bg-hover hover:not-disabled:text-text-primary disabled:border-border disabled:text-text-muted',
	danger:
		'px-5 py-2 text-13 border border-danger bg-danger-bg text-white hover:not-disabled:bg-danger-bg/80 disabled:bg-bg-panel disabled:border-border disabled:text-text-muted',
	// no size of its own: a ghost is a glyph or a word inside something that
	// already has one, and a size here won every text-11 a caller passed
	ghost:
		'p-1 rounded-control bg-transparent border-none text-text-muted hover:not-disabled:text-text-primary hover:not-disabled:bg-bg-hover disabled:text-text-muted',
	pill: 'px-6 py-2.5 text-13 border border-border-strong rounded-full bg-bg-panel text-text-secondary hover:not-disabled:bg-bg-hover hover:not-disabled:text-text-primary hover:not-disabled:border-accent disabled:border-border disabled:text-text-muted',
	// A sidebar item; the selected one says so with aria-current="page".
	tab: 'justify-start px-3 py-1.5 text-15 font-medium rounded-control bg-transparent border-none text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary aria-[current=page]:bg-bg-selected aria-[current=page]:text-text-primary',
	// A title-bar status pill you can click. Its hue is the caller's, the
	// file system's; disabled means "nothing to act on", and the muted
	// colour says so.
	badge:
		'px-2.5 py-0.5 text-11 font-semibold rounded-full bg-bg-panel border border-border-strong hover:not-disabled:border-accent disabled:text-text-muted',
	// A choice among several; the chosen one says so with aria-pressed.
	card: 'flex-col items-stretch w-full p-3 text-left border border-border-strong bg-transparent text-text-primary hover:border-text-muted aria-[pressed=true]:border-accent aria-[pressed=true]:bg-bg-hover/40',
	// A launch target on the row; the default says so with aria-current.
	target:
		'gap-1.5 px-3 py-1.5 text-13 border border-border-strong bg-bg-panel text-text-secondary hover:not-disabled:text-text-primary hover:not-disabled:border-accent aria-[current=true]:border-accent aria-[current=true]:bg-bg-hover/40 aria-[current=true]:text-text-primary disabled:border-border disabled:text-text-muted',
	// The footer's launch buttons. a destination, not a choice among
	// values: every one that can run is full ink and the default is told
	// by its edge alone, so muted here means blocked and nothing else.
	// one height for the whole row — a button with a key chip in it was
	// 10px taller than one without, and the row read as broken teeth
	launch:
		'gap-1.5 h-9 px-3 text-13 border border-border-strong bg-bg-panel text-text-primary hover:not-disabled:border-accent aria-[current=true]:border-accent aria-[current=true]:bg-bg-hover/40 disabled:border-border disabled:text-text-muted',
	// a door on the command row: + Workspace, + Add repo, + Add server.
	// bordered, so it reads as a button and not a word
	add: 'gap-1.5 h-9 pl-2.5 pr-3 border border-border-strong bg-transparent text-text-secondary hover:text-text-primary hover:border-accent hover:bg-bg-hover',
	// one cell of a segmented control; the wrapper carries the border and
	// the chosen cell says so with aria-current
	segment:
		'px-3 h-full text-13 rounded-none bg-transparent border-none text-text-secondary hover:text-text-primary aria-[current=true]:text-text-primary aria-[current=true]:bg-bg-hover/40',
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
