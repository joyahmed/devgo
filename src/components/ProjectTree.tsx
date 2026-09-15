import { useEffect, useImperativeHandle, useState } from 'react';

const col = 'grid grid-cols-[1fr_1fr_80px_52px] items-center text-sm';

const COLUMNS = [
	{ label: 'Workspace', className: '' },
	{ label: 'Location', className: '' },
	{ label: 'File System', className: '' },
	{ label: 'Count', className: 'text-right' }
];

const lastSegment = (path: string) =>
	path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;

const ProjectTree = ({
	projects,
	selected,
	onSelect,
	onDoubleClick,
	onLaunch,
	loading,
	ref
}: ProjectTreeProps) => {
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

	const grouped = new Map<string, Project[]>();
	for (const p of projects) {
		const existing = grouped.get(p.workspace) ?? [];
		existing.push(p);
		grouped.set(p.workspace, existing);
	}

	const visible: Project[] = [];
	for (const [ws, wsProjects] of grouped) {
		if (!collapsed.has(ws)) visible.push(...wsProjects);
	}

	const navigate = (dir: 1 | -1) => {
		const idx = visible.findIndex(p => p.full_path === selected?.full_path);
		const next = idx === -1 ? visible[0] : visible[idx + dir];
		if (next) onSelect(next);
	};

	useImperativeHandle(ref, () => ({ navigate }));

	useEffect(() => {
		const launch = () => {
			if (selected) onLaunch(selected);
			else if (visible.length > 0) onLaunch(visible[0]);
		};
		const keys: Record<string, () => void> = {
			ArrowDown: () => navigate(1),
			ArrowUp: () => navigate(-1),
			Enter: launch
		};
		const handler = (e: globalThis.KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement) return;
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			const action = keys[e.key];
			if (!action) return;
			e.preventDefault();
			action();
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [selected, visible, navigate, onLaunch]);

	const toggle = (ws: string) => {
		setCollapsed(prev => {
			const next = new Set(prev);
			if (next.has(ws)) next.delete(ws);
			else next.add(ws);
			return next;
		});
	};

	if (loading) {
		return (
			<div className='flex-1 flex items-center justify-center text-sm text-text-muted'>
				<span className='animate-spin text-lg mr-2'>&#9696;</span>
				Scanning workspaces...
			</div>
		);
	}

	if (projects.length === 0) {
		return (
			<div className='flex-1 flex items-center justify-center text-sm text-text-muted'>
				No projects found. Add a workspace to begin.
			</div>
		);
	}

	const workspaces = [...grouped.entries()];

	return (
		<div className='flex-1 flex flex-col min-h-0'>
			<div
				className={`${col} px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-text-primary bg-bg-hover/30 rounded-t-md shrink-0 border-b border-border`}
			>
				{COLUMNS.map(({ label, className }) => (
					<div key={label} className={className}>
						{label}
					</div>
				))}
			</div>

			<div className='flex-1 overflow-y-auto'>
				{workspaces.map(([ws, wsProjects]) => {
					const isOpen = !collapsed.has(ws);
					const count = wsProjects.length;
					const fs = wsProjects[0]?.file_system ?? 'Windows';

					return (
						<div key={ws}>
							<div
								className={`${col} px-3 py-2 cursor-pointer hover:bg-bg-hover/50 select-none`}
								onClick={() => toggle(ws)}
								title={ws}
							>
								<div className='flex items-center gap-2 text-text-secondary min-w-0'>
									<span
										className={`text-xs shrink-0 ${isOpen ? 'text-accent' : 'text-text-muted'}`}
									>
										{isOpen ? '▼' : '▶'}
									</span>
									<span className='truncate font-semibold text-text-primary'>
										{lastSegment(ws)}
									</span>
								</div>
								<div className='text-text-muted truncate' title={ws}>
									{ws}
								</div>
								<div
									className={`font-medium ${fs === 'WSL' ? 'text-accent' : 'text-text-muted'}`}
								>
									{fs}
								</div>
								<div className='text-right text-text-muted font-mono'>
									{count}
								</div>
							</div>

							{isOpen &&
								wsProjects.map(project => {
									const isSelected =
										selected?.full_path === project.full_path;
									return (
										<div
											key={project.full_path}
											className={`${col} ml-6 px-3 py-1.5 cursor-pointer select-none transition-colors border-l border-border ${
												isSelected
													? 'bg-bg-selected text-text-primary border-l-accent'
													: 'text-text-secondary hover:bg-bg-hover/50 border-l-transparent'
											}`}
											onClick={() => onSelect(project)}
											onDoubleClick={() => onDoubleClick(project)}
										>
											<div
												className='truncate text-text-muted'
												title={project.workspace}
											>
												{lastSegment(project.workspace)}
											</div>
											<div
												className={`font-medium font-mono truncate ${isSelected ? 'text-text-primary' : ''}`}
											>
												{project.name}
											</div>
											<div
												className={
													project.file_system === 'WSL'
														? 'text-accent'
														: 'text-text-muted'
												}
											>
												{project.file_system}
											</div>
											<div />
										</div>
									);
								})}
						</div>
					);
				})}
			</div>
		</div>
	);
};

export default ProjectTree;
