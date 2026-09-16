// the contrast contract from the top of src/themes.ts, run over every
// palette and the @theme block in index.css (the one that ships before a
// theme is picked). no runner, no dependency: the palettes are plain data
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

// WCAG 2.1 relative luminance
const luminance = hex => {
	const h = hex.replace('#', '');
	const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
	const lin = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const ratio = (a, b) => {
	const [x, y] = [luminance(a), luminance(b)];
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// border is absent on purpose: it is the divider, not the edge of a control
const RULES = [
	{ token: 'text-muted', on: ['bg-primary', 'bg-panel'], min: 4.5 },
	{ token: 'text-secondary', on: ['bg-primary', 'bg-secondary', 'bg-panel'], min: 4.5 },
	{ token: 'text-primary', on: ['bg-primary', 'bg-secondary', 'bg-panel'], min: 4.5 },
	{ token: 'border-strong', on: ['bg-primary', 'bg-secondary', 'bg-panel'], min: 3 },
	{ token: 'accent', on: ['bg-primary', 'bg-secondary'], min: 3 },
	// the filled button carries the ground as ink: white on electric cyan
	// was 1.8:1, and on the old blue 3.7:1, never checked
	{ token: 'bg-primary', on: ['accent'], min: 4.5 }
];

// parsed, not imported: themes.ts is TypeScript and this runs with no build
const parseThemes = src => {
	const themes = [];
	const re = /id:\s*'([^']+)'[\s\S]*?colors:\s*\{([^}]*)\}/g;
	for (const [, id, body] of src.matchAll(re)) {
		const colors = {};
		for (const [, k, v] of body.matchAll(/'?([a-z-]+)'?:\s*'(#[0-9a-fA-F]{6})'/g)) {
			colors[k] = v;
		}
		themes.push({ id, colors });
	}
	return themes;
};

const parseCssTheme = src => {
	const colors = {};
	for (const [, k, v] of src.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6});/g)) {
		colors[k] = v;
	}
	return { id: 'index.css @theme', colors };
};

const palettes = [parseCssTheme(read('../src/index.css')), ...parseThemes(read('../src/themes.ts'))];

if (palettes.length < 2) {
	console.error('check-contrast: parsed no palettes, the file shape changed');
	process.exit(1);
}

const failures = [];
for (const { id, colors } of palettes) {
	for (const { token, on, min } of RULES) {
		const fg = colors[token];
		if (!fg) {
			failures.push(`${id}: missing token "${token}"`);
			continue;
		}
		for (const bgName of on) {
			const bg = colors[bgName];
			if (!bg) continue;
			const r = ratio(fg, bg);
			if (r < min) {
				failures.push(`${id}: ${token} (${fg}) on ${bgName} (${bg}) is ${r.toFixed(2)}:1, needs ${min}:1`);
			}
		}
	}
}

if (failures.length) {
	console.error(`\ncontrast contract violated, ${failures.length} failing pair(s):\n`);
	for (const f of failures) console.error('  ' + f);
	console.error('\nthe rule lives at the top of src/themes.ts. raise the token, not the bar\n');
	process.exit(1);
}

console.log(`contrast ok: ${palettes.length} palettes x ${RULES.length} rules`);
