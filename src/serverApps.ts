// which app a folder row is, and which of the server's app actions that
// app can fill. the rust side fills the line for real when an action
// runs; this mirror only decides what the menu shows, by the contract's
// rule: an action whose placeholder is null for a row is hidden on that
// row. keep placeholders in step with server_apps::placeholders

export const appForFolder = (
	listing: ServerListing | undefined,
	path: string
): ServerApp | undefined => {
	const p = path.replace(/\/+$/, '');
	return listing?.inventory?.apps.find(a => a.dir.replace(/\/+$/, '') === p);
};

const endsWithAny = (s: string | null | undefined, suffixes: string[]) =>
	!!s && suffixes.some(x => s.replace(/\/+$/, '').endsWith(x));

export const placeholders = (app: ServerApp): Record<string, string | null> => {
	const named = app.processes.filter(p => p.pm2);
	const find = (suffixes: string[]) =>
		app.processes.find(
			p => endsWithAny(p.pm2, suffixes) || endsWithAny(p.cwd, suffixes)
		)?.pm2 ?? null;
	const web = find(['web', 'frontend']) ?? named[0]?.pm2 ?? null;
	const api = find(['api', 'backend']) ?? named[1]?.pm2 ?? null;
	const site = app.site;
	return {
		dir: app.dir,
		name: app.name,
		pm2: web,
		pm2_web: web,
		pm2_api: api,
		site: site?.file || null,
		domain: site?.domains[0] ?? null,
		web_port: site?.web_port != null ? String(site.web_port) : null,
		api_port: site?.api_port != null ? String(site.api_port) : null,
		db: app.database?.name ?? null,
		repo: app.git?.repo ?? null
	};
};

// true when every {word} the line uses is filled for this app. a word the
// contract does not define is left alone (a later schema's, not a gap).
// [a-z0-9_]: {pm2} has a digit
export const canFill = (
	command: string,
	values: Record<string, string | null>
) => {
	for (const m of command.matchAll(/\{([a-z0-9_]+)\}/g)) {
		const key = m[1];
		if (key in values && values[key] === null) return false;
	}
	return true;
};

// the dot: online only when every process is; a stopped api beside a
// running web is trouble, not running; none when nothing runs at all
export const appStatus = (app: ServerApp): 'online' | 'trouble' | 'none' => {
	if (app.processes.length === 0) return 'none';
	return app.processes.every(p => p.status === 'online') ? 'online' : 'trouble';
};
