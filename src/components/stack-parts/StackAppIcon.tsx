import { initialOf } from '../../stackFormat';

type StackAppIconProps = { name: string; icon?: string | null; small?: boolean };

// the exe's own icon, read by Rust; a letter tile when the exe has none (or
// is not installed). 40 px on the tab (the 48 px PNG scaled down a touch),
// 28 px on the pill's hover card
const StackAppIcon = ({ name, icon, small }: StackAppIconProps) =>
	icon ? (
		<img
			src={icon}
			alt=''
			className={`${small ? 'size-7' : 'size-10'} shrink-0 object-contain`}
			draggable={false}
		/>
	) : (
		<span
			aria-hidden='true'
			className={`${small ? 'size-7 text-13' : 'size-10 text-18'} shrink-0 flex items-center justify-center rounded-control bg-bg-raised font-bold text-text-primary`}
		>
			{initialOf(name)}
		</span>
	);

export default StackAppIcon;
