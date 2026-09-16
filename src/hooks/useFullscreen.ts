import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';

// native full screen on a mac hides the traffic lights, and the title bar
// insets its brand to clear them; entering and leaving both arrive as
// resizes, the same signal useMaximized reads
export const useFullscreen = () => {
	const [fullscreen, setFullscreen] = useState(false);

	useEffect(() => {
		const win = getCurrentWindow();
		let alive = true;
		const sync = () => {
			win
				.isFullscreen()
				.then(v => {
					if (alive) setFullscreen(v);
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

	return fullscreen;
};
