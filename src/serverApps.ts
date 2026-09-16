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
		repo: app.git?.repo ?? null,
		pm: app.pm || null,
		eco: app.ecosystem || null,
		// the form's shape button for this app, mirroring the rust side
		site_type:
			app.kind === 'mono' ? 'turbo' : app.kind === 'node' ? 'node' : 'next'
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

// the values a form opens with: each field's prefill placeholder filled
// from the app (its default when the app lacks it)
export const prefillValues = (
	action: ServerAction,
	app: ServerApp | undefined
): Record<string, string> => {
	const values = app ? placeholders(app) : {};
	const out: Record<string, string> = {};
	for (const f of action.fields) {
		const key = f.prefill?.replace(/^\{|\}$/g, '');
		out[f.name] = (key && values[key]) || f.default || '';
	}
	return out;
};

// a when clause, type=turbo, against the current values
export const whenHolds = (
	when: string | null,
	values: Record<string, string>
) => {
	if (!when) return true;
	const [k, v] = when.split('=');
	return v === undefined
		? values[k.trim()] === 'true'
		: values[k.trim()] === v.trim();
};

// a label with its placeholders filled: Logs · {pm2_api} → Logs · erp-api.
// the menu shows nothing it cannot name, so canFill runs on the label too
export const fillLabel = (
	label: string,
	values: Record<string, string | null>
) =>
	label.replace(/\{([a-z0-9_]+)\}/g, (m, key: string) =>
		key in values ? (values[key] ?? m) : m
	);
