// the last path segment, either separator, trailing slashes ignored
export const lastSegment = (path: string) =>
	path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
