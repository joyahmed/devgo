import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

// the one flag behind settings, the row menu and the palette: whether a
// server row prints user@host and the port. read on mount; rust hands
// back what it stored, so every door shows the same word
export const useServerDetails = () => {
	const [showDetails, setShow] = useState(false);

	useEffect(() => {
		invoke<boolean>('get_show_server_details')
			.then(setShow)
			.catch(() => {});
	}, []);

	const setShowDetails = async (on: boolean) => {
		const stored = await invoke<boolean>('set_show_server_details', { on });
		setShow(stored);
	};

	return { showDetails, setShowDetails };
};
