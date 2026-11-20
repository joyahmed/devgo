import { invoke } from '@tauri-apps/api/core';
import { stateOf } from '../stackFormat';
import { useStack } from './useStack';
import { useStackEditor } from './useStackEditor';

// the Stack tab's whole state: the list and its poll (with uptime and
// memory), the in-place editor, and the four header actions as data. the
// tab is only mounted while it is open, so the poll runs exactly then

export const useStackTab = () => {
	const stack = useStack({ active: true, detail: true });
	const editor = useStackEditor(stack);

	const allBusy = !!stack.busy['*'];
	const running = stack.apps.filter(a => stateOf(stack.status[a.name]) === 'running').length;
	const othersRunning = stack.apps.some(
		a => stack.status[a.name]?.running && !stack.status[a.name]?.isSelf
	);
	const canStart = stack.apps.some(a => {
		const s = stack.status[a.name];
		return s && !s.running && !s.missing && !s.isSelf;
	});

	const summary = stack.apps.length
		? `${stack.apps.length} ${stack.apps.length === 1 ? 'app' : 'apps'} · ${running} running · started in this order after you sign in`
		: 'The programs you open every day, started for you after sign-in.';

	const actions = [
		{
			id: 'start',
			label: 'Start all in order',
			variant: 'solid' as const,
			onClick: stack.startAll,
			disabled: allBusy || !canStart
		},
		{
			id: 'stop',
			label: 'Stop all except DevGo',
			variant: 'quiet' as const,
			onClick: stack.stopAll,
			disabled: allBusy || !othersRunning
		},
		{
			id: 'add',
			label: editor.picking ? 'Choosing…' : 'Add app',
			variant: 'quiet' as const,
			onClick: editor.startAdd,
			disabled: editor.picking
		},
		{
			id: 'pill',
			label: 'Show pill',
			variant: 'quiet' as const,
			onClick: () => invoke('stack_open_window').catch(e => stack.setError(String(e))),
			disabled: false
		}
	];

	const adding = editor.draft?.index === null;
	const editingIndex = editor.draft?.index ?? null;

	return { stack, editor, summary, actions, adding, editingIndex };
};

export type UseStackTab = ReturnType<typeof useStackTab>;
