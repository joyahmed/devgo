import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

// before the first answer: no chip at all rather than a wrong name
const UNKNOWN: RuntimeInfo = {
	runtime: 'windows',
	wsl_available: false,
	distros: [],
	default_distro: null,
	local_fs: ''
};

// the machine's cached probe: read at mount, and again by the app after
// every pass, since the forced refresh is the one thing that re-probes it
export const useRuntime = () => {
	const [runtime, setRuntime] = useState<RuntimeInfo>(UNKNOWN);

	const refreshRuntime = () => {
		invoke<RuntimeInfo>('get_runtime_info').then(setRuntime).catch(() => {});
	};

	useEffect(refreshRuntime, []);

	return { runtime, refreshRuntime };
};
