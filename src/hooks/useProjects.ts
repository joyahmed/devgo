import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

export const useProjects = () => {
	const [projects, setProjects] = useState<Project[]>([]);
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState<Project | null>(null);
	const [loading, setLoading] = useState(true);

	const refresh = async () => {
		setLoading(true);
		try {
			const p = await invoke<Project[]>('get_projects');
			setProjects(p);
			return p;
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		refresh();
	}, []);

	const q = query.trim().toLowerCase();
	const filtered = q
		? projects.filter(p => p.name.toLowerCase().includes(q))
		: projects;

	return {
		projects,
		filtered,
		query,
		setQuery,
		selected,
		setSelected,
		refresh,
		loading
	};
};
