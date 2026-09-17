import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';

// set up this box: the sheet's state and its two asks. open runs the probe
// (one ssh) and shows the plan; confirm writes the missing files (one ssh)
// and then refreshes the row, which is what lists the apps. a failure
// anywhere reaches onError and the sheet stays where it was
export const useServerSetup = (
	refresh: (id: string) => Promise<unknown>,
	onDone: (server: Server, installed: number) => void,
	onError: (e: unknown) => void
): ServerSetupState => {
	const [request, setRequest] = useState<SetupRequest | null>(null);
	const [busy, setBusy] = useState(false);

	const open = (server: Server) => {
		setRequest({ server, plan: null });
		setBusy(true);
		invoke<SetupPlan>('plan_server_setup', { id: server.id, dir: null })
			.then(plan =>
				setRequest(cur => (cur?.server.id === server.id ? { server, plan } : cur))
			)
			.catch(e => {
				setRequest(null);
				onError(e);
			})
			.finally(() => setBusy(false));
	};

	const confirm = async () => {
		if (!request?.plan || busy) return;
		const { server, plan } = request;
		const names = plan.files.filter(f => f.install).map(f => f.name);
		setBusy(true);
		try {
			const installed = await invoke<number>('apply_server_setup', {
				id: server.id,
				dir: null,
				names
			});
			setRequest(null);
			onDone(server, installed);
			await refresh(server.id);
		} catch (e) {
			onError(e);
		} finally {
			setBusy(false);
		}
	};

	const close = () => {
		if (!busy) setRequest(null);
	};

	return { request, busy, open, confirm, close };
};
