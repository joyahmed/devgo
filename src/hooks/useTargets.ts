import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

/// The registry of editors, terminals, agents and file managers, plus
/// which of each is default.
///
/// Defaults are resolved on the Rust side and returned here rather than being
/// read straight from prefs, because a default can point at a target the user
/// has since deleted. One fallback chain, in one place.
export const useTargets = (): TargetRegistry => {
	const [targets, setTargets] = useState<LaunchTarget[]>([]);
	const [defaults, setDefaults] = useState<Record<string, string>>({});

	const reload = async () => {
		const [list, pairs] = await Promise.all([
			invoke<LaunchTarget[]>('get_targets'),
			invoke<[string, string][]>('get_default_targets')
		]);
		setTargets(list);
		setDefaults(Object.fromEntries(pairs));
	};

	useEffect(() => {
		reload().catch(() => {});
	}, []);

	const editors = targets.filter(t => t.kind === 'editor');
	const terminals = targets.filter(t => t.kind === 'terminal');
	const agents = targets.filter(t => t.kind === 'agent');
	const fileManagers = targets.filter(t => t.kind === 'file_manager');
	// the alt key's agent: the first one that is not the default
	const otherAgent = agents.find(t => t.id !== defaults.agent);

	// Every write ends in a reload rather than patching local state: the list
	// is short, the calls are local, and the store's rules (what the id
	// becomes, whether a removal is allowed) stay in one place.
	const addTarget = async (target: Omit<LaunchTarget, 'id'>) => {
		await invoke<LaunchTarget>('add_target', { target: { ...target, id: '' } });
		await reload();
	};

	const removeTarget = async (id: string) => {
		await invoke('remove_target', { id });
		await reload();
	};

	// proposes only: nothing is written until addDetected is called for an id
	const detect = () => invoke<DetectedTarget[]>('detect_targets');

	const addDetected = async (id: string) => {
		await invoke<LaunchTarget>('add_detected_target', { id });
		await reload();
	};

	const setDefaultTarget = async (kind: TargetKind, id: string) => {
		await invoke('set_default_target', { kind, id });
		await reload();
	};

	return {
		editors,
		terminals,
		agents,
		fileManagers,
		defaults,
		otherAgent,
		addTarget,
		detect,
		addDetected,
		removeTarget,
		setDefaultTarget
	};
};
