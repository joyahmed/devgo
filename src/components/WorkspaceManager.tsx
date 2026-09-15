import { open } from '@tauri-apps/plugin-dialog';
import { lastSegment } from '../paths';
import Button from './Button';

const WorkspaceManager = ({
	workspaces,
	onAdd,
	onRemove
}: WorkspaceManagerProps) => {
	const handleAdd = async () => {
		const selected = await open({ directory: true });
		if (selected) onAdd(selected);
	};

	return (
		<div>
			<h3 className='text-base font-bold mb-4'>Workspaces</h3>

			{workspaces.length === 0 ? (
				<p className='text-[13px] text-text-muted mb-4'>
					No workspaces added yet.
				</p>
			) : (
				<ul className='list-none flex flex-col gap-1.5 mb-4'>
					{workspaces.map((ws, i) => (
						<li
							key={ws}
							className='flex items-center justify-between px-3 py-2 bg-bg-panel rounded-md font-mono text-xs break-all'
						>
							<span className='flex-1 min-w-0'>
								<span className='block text-text-primary truncate'>
									{lastSegment(ws)}
								</span>
								<span className='block text-text-muted truncate'>{ws}</span>
							</span>
							<Button
								variant='ghost'
								className='px-2 hover:text-danger hover:bg-danger/10'
								onClick={() => onRemove(i)}
							>
								&#10005;
							</Button>
						</li>
					))}
				</ul>
			)}

			<Button variant='primary' onClick={handleAdd}>
				Add Folder
			</Button>
		</div>
	);
};

export default WorkspaceManager;
