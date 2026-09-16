// /etc on a box is a hundred-odd folders, a dozen of which a developer
// opens. show the developer-relevant set by default; the rest is one
// click away. only /etc itself is curated: inside /etc/nginx everything
// is the point. shared by the hook (what renders and what the keyboard
// walks come from the same list)
export const ETC_CURATED = [
	'nginx',
	'ssh',
	'systemd',
	'postgresql',
	'mysql',
	'mariadb',
	'redis',
	'docker',
	'cron.d',
	'supervisor',
	'letsencrypt',
	'ufw',
	'fail2ban',
	'pm2',
	'php',
	'apache2',
	'caddy'
];

export const isEtc = (path: string) => path.replace(/\/+$/, '') === '/etc';

// the curated subset and how many were left out: 0 when the parent is
// not /etc, or the user asked for all, or a search is on (a hit is a hit)
export const curate = (
	parent: string,
	folders: RemoteFolder[],
	showAll: boolean
): [RemoteFolder[], number] => {
	if (!isEtc(parent) || showAll) return [folders, 0];
	const kept = folders.filter(f => ETC_CURATED.includes(f.name));
	return [kept, folders.length - kept.length];
};
