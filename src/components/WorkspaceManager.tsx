import { open } from '@tauri-apps/plugin-dialog';

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
							<span className='text-text-secondary flex-1'>{ws}</span>
							<button
								type='button'
								className='bg-transparent border-none text-text-muted cursor-pointer py-1 px-2 text-sm rounded hover:text-danger hover:bg-danger/10'
								onClick={() => onRemove(i)}
							>
								&#10005;
							</button>
						</li>
					))}
				</ul>
			)}

			<button
				type='button'
				className='px-5 py-2.5 text-[13px] font-semibold border border-accent rounded-lg bg-accent text-text-primary cursor-pointer hover:bg-accent-hover'
				onClick={handleAdd}
			>
				Add Folder
			</button>
		</div>
	);
};

export default WorkspaceManager;
