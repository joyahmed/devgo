import { initialOf } from '../../stackFormat';

type StackAppIconProps = { name: string; icon?: string | null };

// the exe's own icon, read by Rust; a letter tile when the exe has none (or
// is not installed). one size: 40 px, the 48 px PNG scaled down a touch
const StackAppIcon = ({ name, icon }: StackAppIconProps) =>
	icon ? (
		<img src={icon} alt='' className='size-10 shrink-0 object-contain' draggable={false} />
	) : (
		<span
			aria-hidden='true'
			className='size-10 shrink-0 flex items-center justify-center rounded-control bg-bg-raised text-18 font-bold text-text-primary'
		>
			{initialOf(name)}
		</span>
	);

export default StackAppIcon;
