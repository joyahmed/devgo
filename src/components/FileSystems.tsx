import FsChip from './FsChip';
import WslMenu from './WslMenu';

// the wsl chip: the light is the vm's process, the label the detail. the
// menu needs names to act on; a vm that is up with none listed yet has
// nothing to stop by name (shut down all is still in the palette)
const wslChip = (
	wsl: WslState,
	menu: FsChipProps['menu']
): FsChipProps => {
	const { up, distros } = wsl;
	const running = distros.length > 0;
	const label = running ? `${distros.length} running` : up ? 'starting' : 'stopped';
	const title = running
		? `WSL running: ${distros.join(', ')}`
		: up
			? 'The WSL VM is up; no distro has registered yet'
			: 'WSL is not running';
	return {
		fs: 'WSL',
		label: `WSL · ${label}`,
		title,
		light: up,
		disabled: !running,
		menu
	};
};

// every file system devgo scans, as chips in the title bar: the machine's
// own first, then wsl with its light and control where there is a wsl.
// the chips stay up here, not in the rows: they have to be there when the
// table shows no wsl workspace, which is exactly when a distro wedges
const FileSystems = ({ runtime, wsl, ...hands }: FileSystemsProps) => {
	const { local_fs, wsl_available } = runtime;
	const chips: FsChipProps[] = [
		...(local_fs
			? [
					{
						fs: local_fs,
						title: `${local_fs}: this machine's own disk, always up`,
						// the same light as wsl's, and it never goes out
						light: true
					}
				]
			: []),
		...(wsl_available
			? [wslChip(wsl, close => <WslMenu {...{ wsl, close, ...hands }} />)]
			: [])
	];

	return (
		<div className='flex items-center gap-2'>
			{chips.map(c => (
				<FsChip key={c.fs} {...c} />
			))}
		</div>
	);
};

export default FileSystems;
