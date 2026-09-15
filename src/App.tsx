import { lazy, Suspense, useRef, useState } from 'react';
import ConfirmDialog from './components/ConfirmDialog';
import ProjectTree from './components/ProjectTree';
import RuntimeIndicator from './components/RuntimeIndicator';
import SearchBox from './components/SearchBox';
import TitleBar from './components/TitleBar';
import ToastProvider, { useToast } from './components/Toast';
import { useProjects } from './hooks/useProjects';
import { useRuntime } from './hooks/useRuntime';
import { useWorkspaces } from './hooks/useWorkspaces';

const WorkspaceManager = lazy(() => import('./components/WorkspaceManager'));

const showError = (e: unknown): string => {
	if (typeof e === 'string') return e;
	if (e && typeof e === 'object') {
		const obj = e as Record<string, unknown>;
		for (const key of Object.keys(obj)) {
			const val = obj[key];
			if (typeof val === 'string') return val;
			if (val && typeof val === 'object') return showError(val);
		}
	}
	return 'Something went wrong';
};

const AppInner = () => {
	const {
		workspaces,
		add: addWorkspace,
		remove: removeWorkspace
	} = useWorkspaces();
	const { filtered, query, setQuery, selected, setSelected, loading } =
		useProjects();
	const { toast } = useToast();
	const runtime = useRuntime();
	const [removeIndex, setRemoveIndex] = useState<number | null>(null);

	const treeRef = useRef<ProjectTreeHandle>(null);
	const handleArrow = (dir: 1 | -1) => treeRef.current?.navigate(dir);

	const handleSelect = (p: Project) => setSelected(p);

	const handleRemove = async (index: number) => {
		try {
			await removeWorkspace(index);
		} catch (e) {
			toast(showError(e));
		}
	};

	return (
		<div className='flex flex-col h-screen w-screen rounded-xl overflow-hidden'>
			<TitleBar>
				<RuntimeIndicator runtime={runtime?.runtime ?? 'windows'} />
			</TitleBar>

			<ConfirmDialog
				{...{
					open: removeIndex !== null,
					title: 'Remove Workspace',
					message:
						'Are you sure you want to remove this workspace folder? Your files will not be deleted.',
					onConfirm: () => {
						if (removeIndex !== null) handleRemove(removeIndex);
						setRemoveIndex(null);
					},
					onCancel: () => setRemoveIndex(null)
				}}
			/>

			<div className='flex-1 flex flex-col p-5 gap-4 overflow-hidden'>
				<Suspense>
					<WorkspaceManager
						{...{
							workspaces,
							onAdd: addWorkspace,
							onRemove: (i: number) => setRemoveIndex(i)
						}}
					/>
				</Suspense>
				<SearchBox
					{...{
						value: query,
						onChange: setQuery,
						onArrow: handleArrow
					}}
				/>
				<ProjectTree
					{...{
						ref: treeRef,
						projects: filtered,
						selected,
						onSelect: handleSelect,
						loading
					}}
				/>
			</div>
		</div>
	);
};

const App = () => (
	<ToastProvider>
		<AppInner />
	</ToastProvider>
);

export default App;
