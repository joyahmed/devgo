import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';

const STOPPED: WslState = { up: false, distros: [] };

// the chip's state from three sources that share one shape: get_wsl_state
// at mount and on every window focus, the watcher's devgo://wsl on every
// change of the vm's process, and refresh() for the paths that changed the
// answer themselves (the stop commands, the passes)
export const useWsl = () => {
	const [wsl, setWsl] = useState<WslState>(STOPPED);

	const refreshWsl = () => {
		invoke<WslState>('get_wsl_state').then(setWsl).catch(() => {});
	};

	useEffect(() => {
		refreshWsl();
		const unlistenEvent = listen<WslState>('devgo://wsl', e =>
			setWsl(e.payload)
		);
		// a second distro starting while the vm is already up is no
		// transition for the watcher; the next focus asks for the names
		const unlistenFocus = getCurrentWindow().onFocusChanged(
			({ payload: focused }) => {
				if (focused) refreshWsl();
			}
		);
		return () => {
			unlistenEvent.then(f => f()).catch(() => {});
			unlistenFocus.then(f => f()).catch(() => {});
		};
	}, []);

	return { wsl, refreshWsl };
};
