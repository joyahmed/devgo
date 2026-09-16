// the contrast contract from the top of src/themes.ts, run over every
// palette and the @theme block in index.css (the one that ships before a
// theme is picked), plus the lane hues in rowStyles.ts. no runner, no
// dependency: the palettes are plain data
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

// hue angle in degrees, for the separation rule
const hue = hex => {
	const h = hex.replace('#', '');
	const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
	const [mx, mn] = [Math.max(r, g, b), Math.min(r, g, b)];
	const d = mx - mn;
	if (!d) return 0;
	const raw =
		mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return (raw * 60 + 360) % 360;
};

const hueGap = (a, b) => {
	const d = Math.abs(hue(a) - hue(b)) % 360;
	return d > 180 ? 360 - d : d;
};

// every surface a token can land on. a list that named only the quiet
// three passed while muted text ran under 4:1 on a hovered row
const SURFACES = ['bg-primary', 'bg-secondary', 'bg-panel', 'bg-hover', 'bg-selected'];

// border is absent on purpose: it is the divider, not the edge of a control.
// bg-raised is absent under border-strong on purpose too: a chip with a
// fill wears the quiet hairline, and nothing puts border-strong on it
const RULES = [
	{ token: 'text-muted', on: SURFACES, min: 4.5 },
	{ token: 'text-secondary', on: SURFACES, min: 4.5 },
	{ token: 'text-primary', on: [...SURFACES, 'bg-raised'], min: 4.5 },
	{ token: 'border-strong', on: SURFACES, min: 3 },
	{ token: 'accent', on: ['bg-primary', 'bg-secondary'], min: 3 },
	// the filled button carries the ground as ink: white on electric cyan
	// was 1.8:1, and on the old blue 3.7:1, never checked
	{ token: 'bg-primary', on: ['accent'], min: 4.5 }
];

// the one rule about two backgrounds: the surface a control sits on has
// to be a step you can see over its host, 1.6 over the panel and a
// smaller one over hover, which is already a lift
const STEPS = [
	{ token: 'bg-raised', over: 'bg-panel', min: 1.6 },
	{ token: 'bg-raised', over: 'bg-hover', min: 1.35 }
];

// the lane hues are fixed tailwind colours, not tokens: a file system is
// a fact about the machine, not a theme accent. read out of rowStyles
// rather than retyped, so the gate can never check a hue the app does
// not use. two lanes' hues must also be told apart from each other at
// label size: sixty degrees, and two keys on one hex are an alias
const TAILWIND = {
	'sky-300': '#7dd3fc',
	'orange-300': '#fdba74',
	'fuchsia-300': '#f0abfc',
	'amber-400': '#fbbf24',
	'emerald-300': '#6ee7b7'
};
const LITERAL_MIN = 4.5;
const MIN_HUE_GAP = 60;

const parseFsTone = src => {
	const block = src.match(/const FS_TONE[^{]*\{([\s\S]*?)\n\};/);
	if (!block) {
		console.error('check-contrast: FS_TONE not found, the file shape changed');
		process.exit(1);
	}
	const out = {};
	for (const [, key, cls] of block[1].matchAll(/(\w+):\s*'text-([a-z]+-\d+)'/g)) {
		if (!TAILWIND[cls]) {
			console.error(`check-contrast: fs ${key} uses text-${cls}, add its hex to TAILWIND`);
			process.exit(1);
		}
		out[`fs ${key}`] = TAILWIND[cls];
	}
	return out;
};

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
const literals = parseFsTone(read('../src/components/rowStyles.ts'));

if (palettes.length < 2) {
	console.error('check-contrast: parsed no palettes, the file shape changed');
	process.exit(1);
}

const failures = [];
const seen = Object.entries(literals);
for (const [nameA, a] of seen) {
	for (const [nameB, b] of seen) {
		if (nameA >= nameB || a === b) continue;
		const gap = hueGap(a, b);
		if (gap < MIN_HUE_GAP) {
			failures.push(`${nameA} (${a}) and ${nameB} (${b}) are ${gap.toFixed(0)} degrees apart, needs ${MIN_HUE_GAP}`);
		}
	}
}

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
	for (const { token, over, min } of STEPS) {
		const [a, b] = [colors[token], colors[over]];
		if (!a || !b) {
			failures.push(`${id}: missing token "${!a ? token : over}"`);
			continue;
		}
		const r = ratio(a, b);
		if (r < min) {
			failures.push(`${id}: ${token} (${a}) over ${over} (${b}) is ${r.toFixed(2)}:1, needs ${min}:1`);
		}
	}
	for (const [name, fg] of seen) {
		for (const bgName of SURFACES) {
			const bg = colors[bgName];
			if (!bg) continue;
			const r = ratio(fg, bg);
			if (r < LITERAL_MIN) {
				failures.push(`${id}: ${name} (${fg}) on ${bgName} (${bg}) is ${r.toFixed(2)}:1, needs ${LITERAL_MIN}:1`);
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

console.log(
	`contrast ok: ${palettes.length} palettes x ${RULES.length + STEPS.length} rules, ${seen.length} lane hues`
);
