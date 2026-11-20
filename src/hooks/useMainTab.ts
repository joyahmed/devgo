import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

// the main window's two faces: the project lanes, and the Stack tab. Rust's
// stack_show_tab (the pill's body click, the tray) raises the window and
// sends `devgo://stack-tab`; this is where that lands

export type MainTab = 'projects' | 'stack';

export const MAIN_TABS: { id: MainTab; label: string }[] = [
	{ id: 'projects', label: 'Projects' },
	{ id: 'stack', label: 'Stack' }
];

export const STACK_TAB_EVENT = 'devgo://stack-tab';

export const useMainTab = () => {
	const [tab, setTab] = useState<MainTab>('projects');

	useEffect(() => {
		const off = listen(STACK_TAB_EVENT, () => setTab('stack'));
		return () => {
			off.then(f => f());
		};
	}, []);

	return { tab, setTab };
};
