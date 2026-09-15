import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';

// onResized rather than a maximize event: maximize, restore, snap and drag
// all arrive as resizes, and the answer can change under any of them
export const useMaximized = () => {
	const [maximized, setMaximized] = useState(false);

	useEffect(() => {
		const win = getCurrentWindow();
		let alive = true;
		const sync = () => {
			win
				.isMaximized()
				.then(v => {
					if (alive) setMaximized(v);
				})
				.catch(() => {});
		};
		sync();
		const unlisten = win.onResized(sync);
		return () => {
			alive = false;
			unlisten.then(f => f()).catch(() => {});
		};
	}, []);

	return maximized;
};
