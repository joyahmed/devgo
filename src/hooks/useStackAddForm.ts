import { useState } from 'react';
import type { StackEntry } from './useStack';

// the add-an-app form under the list. process name is derived from the path,
// so the form asks only what a person knows: a name, the exe, the delay

type Values = { name: string; path: string; delay: string };
const EMPTY: Values = { name: '', path: '', delay: '0' };

export const ADD_FIELDS: {
	key: keyof Values;
	label: string;
	placeholder: string;
}[] = [
	{ key: 'name', label: 'Name', placeholder: 'Voice' },
	{ key: 'path', label: 'Path', placeholder: '%LOCALAPPDATA%\\App\\app.exe' },
	{ key: 'delay', label: 'Start after sign-in (s)', placeholder: '0' }
];

export const useStackAddForm = (
	add: (e: Omit<StackEntry, 'process' | 'args'>) => Promise<boolean>
) => {
	const [values, setValues] = useState<Values>(EMPTY);
	const [error, setError] = useState<string | null>(null);

	const change = (key: keyof Values, value: string) =>
		setValues(v => ({ ...v, [key]: value }));

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		const name = values.name.trim();
		const path = values.path.trim();
		const delay = Number(values.delay);
		if (!name || !path) return setError('a name and a path, please');
		if (!Number.isInteger(delay) || delay < 0)
			return setError('the delay is whole seconds, 0 or more');
		setError(null);
		if (await add({ name, path, delay })) setValues(EMPTY);
	};

	return { values, error, change, submit };
};
