import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';
import type { NewStackEntry, StackEntry } from './useStack';

// adding and editing a stack app, in place. "Add app" starts at the file
// picker: a person knows WHICH program, not what its exe calls itself, so
// the name, the process and the icon come from the exe (stack_describe)
// and the form only asks to confirm them and pick a delay.

export type Described = { name: string; process: string; icon: string | null };

export type StackDraft = {
	// the row being edited, or null for a new app
	index: number | null;
	name: string;
	path: string;
	process: string;
	delay: string;
	icon: string | null;
};

export type DraftField = 'name' | 'path' | 'delay';

export const DRAFT_FIELDS: {
	key: DraftField;
	label: string;
	placeholder: string;
	mono?: boolean;
	browse?: boolean;
}[] = [
	{ key: 'name', label: 'Name', placeholder: 'Voice' },
	{ key: 'path', label: 'Program', placeholder: '%LOCALAPPDATA%\\App\\app.exe', mono: true, browse: true },
	{ key: 'delay', label: 'Start after sign-in (seconds)', placeholder: '0', mono: true }
];

type Stack = {
	apps: StackEntry[];
	add: (e: NewStackEntry) => Promise<boolean>;
	update: (index: number, patch: Partial<StackEntry>) => Promise<boolean>;
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// a new app starts 10 s after the last one: the order on the rail is the
// start order, and a gap keeps sign-in from launching everything at once
export const nextDelay = (apps: StackEntry[]) =>
	apps.length ? Math.max(...apps.map(a => a.delay)) + 10 : 0;

export const useStackEditor = (stack: Stack) => {
	const [draft, setDraft] = useState<StackDraft | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [picking, setPicking] = useState(false);

	// the native picker, then what the exe says about itself. null when the
	// person cancelled
	const pick = async (): Promise<(Described & { path: string }) | null> => {
		setPicking(true);
		try {
			const path = await open({
				multiple: false,
				directory: false,
				filters: [{ name: 'Programs', extensions: ['exe'] }]
			});
			if (typeof path !== 'string') return null;
			const d = await invoke<Described>('stack_describe', { path });
			return { ...d, path };
		} catch (e) {
			setError(errorText(e));
			return null;
		} finally {
			setPicking(false);
		}
	};

	const startAdd = async () => {
		setError(null);
		const d = await pick();
		if (!d) return;
		setDraft({
			index: null,
			name: d.name,
			path: d.path,
			process: d.process,
			delay: String(nextDelay(stack.apps)),
			icon: d.icon
		});
	};

	const startEdit = (index: number) => {
		const a = stack.apps[index];
		if (!a) return;
		setError(null);
		setDraft({ index, name: a.name, path: a.path, process: a.process, delay: String(a.delay), icon: null });
	};

	// Browse inside the form: a new exe brings its own process and icon; the
	// name follows only while it still is the old exe's name
	const browse = async () => {
		const d = await pick();
		if (!d) return;
		setDraft(v =>
			v && {
				...v,
				path: d.path,
				process: d.process,
				icon: d.icon,
				name: v.index === null || !v.name.trim() ? d.name : v.name
			}
		);
	};

	// a path typed by hand drops the described process: the save derives it
	// from the new path instead of keeping the old exe's
	const change = (key: DraftField, value: string) =>
		setDraft(v => v && { ...v, [key]: value, ...(key === 'path' ? { process: '' } : {}) });

	const cancel = () => {
		setDraft(null);
		setError(null);
	};

	const save = async () => {
		if (!draft) return false;
		const name = draft.name.trim();
		const path = draft.path.trim();
		const delay = Number(draft.delay.trim() || '0');
		if (!name || !path) return setError('A name and a program, please.'), false;
		if (!Number.isInteger(delay) || delay < 0)
			return setError('The delay is whole seconds, 0 or more.'), false;
		// the name is how a row is found (start, stop, status): it must be one
		if (stack.apps.some((a, i) => i !== draft.index && a.name.toLowerCase() === name.toLowerCase()))
			return setError(`${name} is already in the stack.`), false;
		setError(null);
		const ok =
			draft.index === null
				? await stack.add({ name, path, delay, process: draft.process })
				: await stack.update(draft.index, {
						name,
						path,
						delay,
						...(path !== stack.apps[draft.index]?.path && draft.process ? { process: draft.process } : {})
					});
		if (ok) setDraft(null);
		return ok;
	};

	return { draft, error, picking, startAdd, startEdit, browse, change, cancel, save };
};

export type UseStackEditor = ReturnType<typeof useStackEditor>;
