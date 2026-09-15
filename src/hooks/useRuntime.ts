import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

export const useRuntime = () => {
	const [info, setInfo] = useState<RuntimeInfo | null>(null);

	useEffect(() => {
		invoke<RuntimeInfo>('get_runtime_info').then(setInfo);
	}, []);

	return info;
};
