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
