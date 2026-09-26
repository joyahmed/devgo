// the comparison the workspace store makes before refusing a duplicate
// (paths::normalize): forward slashes, no trailing separator, case kept.
// a root the store would refuse has to read as already added, or the
// picker offers something the add then rejects
export const normalizePath = (path: string) =>
	path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';

// the last path segment, either separator, trailing slashes ignored
export const lastSegment = (path: string) =>
	path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;

// the folder a path sits in, either separator
export const parentOf = (path: string) =>
	path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '') || path;

/// a list of workspace roots as one glanceable phrase. Joy recognises a
/// workspace by its folder name, not by \\wsl.localhost\Ubuntu-26.04\home\…,
/// and a toast gets one glance: name at most two and count the rest. Eight
/// full paths joined with ', ' is what stretched the toast to the window's
/// width and turned it into a strip along the bottom edge.
export const namesOf = (paths: string[]) => {
	const names = paths.map(lastSegment);
	if (names.length < 2) return names[0] ?? '';
	if (names.length === 2) return `${names[0]} and ${names[1]}`;
	return `${names[0]}, ${names[1]} +${names.length - 2} more`;
};
