/// Subsequence score, or null when `query` is not a subsequence of `text`.
/// Contiguous runs and word starts score extra, so `ote` ranks "Open TErminal"
/// above a scattering of the same letters.
export const fuzzyScore = (query: string, text: string): number | null => {
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	if (!q) return 0;

	let qi = 0;
	let score = 0;
	let streak = 0;
	let prev = -2;

	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] !== q[qi]) continue;

		let bonus = 1;
		if (prev === ti - 1) {
			streak += 1;
			bonus += streak * 2;
		} else {
			streak = 0;
		}
		// start of a word: the letter you'd type first
		if (ti === 0 || /[\s\-_/.:]/.test(t[ti - 1])) bonus += 4;

		score += bonus;
		prev = ti;
		qi += 1;
	}

	return qi === q.length ? score : null;
};

/// Best score across title and aliases. A keyword hit is worth a hair less
/// than the same hit on the title, so titles float up but an alias still wins.
export const scoreCommand = (
	query: string,
	cmd: PaletteCommand
): number | null => {
	if (!query.trim()) return 0;

	let best: number | null = fuzzyScore(query, cmd.title);
	for (const kw of cmd.keywords ?? []) {
		const s = fuzzyScore(query, kw);
		if (s !== null) {
			const weighted = s * 0.9;
			best = best === null ? weighted : Math.max(best, weighted);
		}
	}
	return best;
};
