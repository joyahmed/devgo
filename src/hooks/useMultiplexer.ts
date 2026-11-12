import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

// where an agent opens: a window per launch (none) or a tab in a running
// zorkyn. read on mount; rust hands back what it stored, so the buttons show
// what prefs.json says. null until the read lands, which disables them
export const useMultiplexer = (onError: (message: string) => void) => {
	const [multiplexer, setValue] = useState<Multiplexer | null>(null);

	useEffect(() => {
		invoke<Multiplexer>('get_multiplexer')
			.then(setValue)
			.catch(e => {
				onError(String(e));
				setValue('none');
			});
	}, []);

	const setMultiplexer = async (m: Multiplexer) => {
		setValue(await invoke<Multiplexer>('set_multiplexer', { multiplexer: m }));
	};

	return { multiplexer, setMultiplexer };
};
