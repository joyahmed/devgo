import { lazy, Suspense, useState } from 'react';
import ConfirmDialog from './components/ConfirmDialog';
import TitleBar from './components/TitleBar';
import ToastProvider, { useToast } from './components/Toast';
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
	const { toast } = useToast();
	const [removeIndex, setRemoveIndex] = useState<number | null>(null);

	const handleRemove = async (index: number) => {
		try {
			await removeWorkspace(index);
		} catch (e) {
			toast(showError(e));
		}
	};

	return (
		<div className='flex flex-col h-screen w-screen rounded-xl overflow-hidden'>
			<TitleBar />

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
