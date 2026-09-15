// pure helpers for the github lane: no invoke, no react
import { fuzzyScore } from './palette';

// rows the lane shows with an empty search box. a few hundred repos is
// not a list, it is a search space: the default view is what you touched
// lately, and typing reaches everything
export const RECENT_LIMIT = 20;

// with a query, every repo the palette's matcher accepts, best first;
// without one, the newest RECENT_LIMIT. matched on full_name so org/ is
// searchable too, and the cache is already newest-first (rust sorts
// before it writes) so the no-query case is a slice, not a sort
export const visibleRepos = (
	repos: GithubRepo[],
	query: string
): GithubRepo[] => {
	const q = query.trim();
	if (!q) return repos.slice(0, RECENT_LIMIT);
	return repos
		.map(r => ({ r, s: fuzzyScore(q, r.full_name) }))
		.filter((x): x is { r: GithubRepo; s: number } => x.s !== null)
		.sort((a, b) => b.s - a.s || a.r.full_name.localeCompare(b.r.full_name))
		.map(x => x.r);
};

const UNITS: [number, string][] = [
	[60, 's'],
	[60, 'min'],
	[24, 'h'],
	[7, 'd'],
	[4.348, 'w'],
	[12, 'mo']
];

// a gone row is a GithubRepo built from its name, so every menu and key
// that works on a row works on it; the section's gone set says which it is
const goneRow = (full_name: string): GithubRepo => {
	const [owner = '', name = full_name] = full_name.split('/');
	return {
		full_name,
		name,
		owner,
		url: `https://github.com/${full_name}`,
		updated_at: '',
		private: false,
		archived: false,
		default_branch: null,
		added: false
	};
};

// the sections with no query: every group in order with all its rows,
// then the ungrouped tail, the newest RECENT_LIMIT of what is in no group.
// with a query, sectioning is off and visibleRepos is the answer
export const laneSections = (
	repos: GithubRepo[],
	groups: GithubGroup[]
): LaneSection[] => {
	const byName = new Map(repos.map(r => [r.full_name, r]));
	const grouped = new Set<string>();
	const sections: LaneSection[] = groups.map(g => {
		const gone = new Set<string>();
		const rows = g.repos.map(full => {
			grouped.add(full);
			const r = byName.get(full);
			if (r) return r;
			gone.add(full);
			return goneRow(full);
		});
		return { group: g.name, rows, gone, total: rows.length };
	});
	const rest = repos.filter(r => !grouped.has(r.full_name));
	sections.push({
		group: null,
		rows: rest.slice(0, RECENT_LIMIT),
		gone: new Set(),
		total: rest.length
	});
	return sections;
};

// 2026-09-11T18:48:35Z -> 3 h ago. coarse on purpose: a row is a glance,
// and "2 y ago" is exactly as useful as the date
export const relativeTime = (
	iso: string | number,
	now = Date.now()
): string => {
	const t = typeof iso === 'number' ? iso * 1000 : Date.parse(iso);
	if (Number.isNaN(t)) return '';
	let delta = Math.max(0, (now - t) / 1000);
	if (delta < 45) return 'just now';
	for (const [size, unit] of UNITS) {
		if (delta < size) return `${Math.round(delta)} ${unit} ago`;
		delta /= size;
	}
	return `${Math.round(delta)} y ago`;
};
