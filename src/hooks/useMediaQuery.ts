import { useEffect, useState } from 'react';

// whether a media query matches, kept current as the window resizes. for
// a component that must be mounted in one of two places: a css hidden
// cannot move a focused input between two parents
export const useMediaQuery = (query: string) => {
	const [matches, setMatches] = useState(
		() => window.matchMedia(query).matches
	);

	useEffect(() => {
		const mql = window.matchMedia(query);
		const onChange = () => setMatches(mql.matches);
		mql.addEventListener('change', onChange);
		return () => mql.removeEventListener('change', onChange);
	}, [query]);

	return matches;
};
