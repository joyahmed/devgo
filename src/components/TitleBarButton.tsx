interface TitleBarButtonProps {
	className?: string;
	onClick: () => void;
	children: React.ReactNode;
}

const buttonClass =
	'flex items-center justify-center w-8 h-7 bg-transparent border-none text-text-secondary cursor-pointer text-sm rounded hover:bg-bg-hover hover:text-text-primary transition-colors';

const TitleBarButton = ({
	className = '',
	onClick,
	children
}: TitleBarButtonProps) => (
	<button
		type='button'
		{...{ onClick, className: `${buttonClass} ${className}` }}
	>
		{children}
	</button>
);

export default TitleBarButton;
