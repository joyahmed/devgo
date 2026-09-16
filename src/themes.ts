// every colour is a --color-* variable, so a theme is an override on :root
//
// the contract a palette has to meet (scripts/check-contrast.mjs runs it):
// - text-muted >= 4.5:1 on bg-primary and bg-panel: it carries real
//   information (badges, hints, timestamps), so the body-text bar applies
// - border-strong >= 3:1 on every surface: the edge of a control you operate
// - the three inks and border-strong hold their bars on every surface a
//   row can wear, hover and selected included: those are on screen all
//   the time, and a gate that only named the quiet surfaces passed for
//   months while muted text ran under 4:1 on a hovered row
// - bg-raised, the surface a control sits on, is a visible step over
//   bg-panel (1.6:1) and bg-hover (1.35:1): every other surface is within
//   1.3:1 of every other, which is how a kbd chip filled with bg-panel
//   inside a button filled with bg-panel rendered at 1.00:1
// - border is held to nothing on purpose: it is the quiet divider between
//   rows and panels, and a control-grade ratio would draw every hairline
const KEYS: ThemeKey[] = [
	'bg-primary',
	'bg-secondary',
	'bg-panel',
	'bg-hover',
	'bg-selected',
	'bg-raised',
	'text-primary',
	'text-secondary',
	'text-muted',
	'accent',
	'accent-hover',
	'danger',
	'border',
	'border-strong',
	// neon's halo on the selected row and the focused box; the other
	// palettes set it to none. the contrast gate reads hex values only,
	// so it skips this key by construction
	'glow'
];

export const THEMES: Theme[] = [
	{
		id: 'neon',
		name: 'DevGo Neon',
		// redone (joy: "neon theme is dead"): it was tailwind blue-500 on
		// slate, the palette that shipped before anyone chose one. a
		// near-black blue ground, electric cyan, ink with a cold cast
		colors: {
			'bg-primary': '#05070d',
			'bg-secondary': '#090e19',
			'bg-panel': '#0c1322',
			'bg-hover': '#131f38',
			'bg-selected': '#0f2f57',
			'bg-raised': '#243c66',
			'text-primary': '#f4f8ff',
			'text-secondary': '#b9c6de',
			'text-muted': '#8f9dba',
			accent: '#22d3ee',
			'accent-hover': '#67e8f9',
			danger: '#fb7185',
			border: '#161f33',
			'border-strong': '#5f7fb5',
			glow: '0 0 0 1px rgb(34 211 238 / 0.45), 0 0 18px rgb(34 211 238 / 0.25)'
		}
	},
	{
		id: 'matrix',
		name: 'Matrix',
		colors: {
			'bg-primary': '#000000',
			'bg-secondary': '#050805',
			'bg-panel': '#0a120a',
			'bg-hover': '#0f2010',
			'bg-selected': '#14401a',
			'bg-raised': '#1a3f20',
			'text-primary': '#d6ffd6',
			'text-secondary': '#7bea9e',
			'text-muted': '#9ac4a4',
			accent: '#22c55e',
			'accent-hover': '#16a34a',
			danger: '#ef4444',
			border: '#14331a',
			'border-strong': '#588c61',
			glow: 'none'
		}
	},
	{
		id: 'nord',
		name: 'Nord',
		colors: {
			'bg-primary': '#2e3440',
			'bg-secondary': '#2b303b',
			'bg-panel': '#3b4252',
			'bg-hover': '#434c5e',
			// a saturated blue, not a lightness step: the old #4c566a was
			// lighter than this palette's own hover, so a selected row read
			// as weaker than a hovered one
			'bg-selected': '#2f4a66',
			'bg-raised': '#586174',
			'text-primary': '#eceff4',
			'text-secondary': '#dfe4ed',
			'text-muted': '#d0d6e0',
			accent: '#88c0d0',
			'accent-hover': '#81a1c1',
			danger: '#bf616a',
			border: '#434c5e',
			'border-strong': '#9ca6b8',
			glow: 'none'
		}
	},
	{
		id: 'dracula',
		name: 'Dracula',
		colors: {
			'bg-primary': '#282a36',
			'bg-secondary': '#21222c',
			'bg-panel': '#343746',
			'bg-hover': '#44475a',
			'bg-selected': '#44475a',
			'bg-raised': '#575a70',
			'text-primary': '#f8f8f2',
			'text-secondary': '#d1d5da',
			'text-muted': '#c4cad9',
			accent: '#bd93f9',
			'accent-hover': '#a679f0',
			danger: '#ff5555',
			border: '#44475a',
			'border-strong': '#8f93ab',
			glow: 'none'
		}
	},
	{
		id: 'black',
		name: 'Pure Black',
		colors: {
			'bg-primary': '#000000',
			'bg-secondary': '#000000',
			'bg-panel': '#0a0a0a',
			'bg-hover': '#1a1a1a',
			'bg-selected': '#242424',
			'bg-raised': '#353535',
			'text-primary': '#ffffff',
			'text-secondary': '#cccccc',
			'text-muted': '#aeaeae',
			accent: '#3b82f6',
			'accent-hover': '#2563eb',
			danger: '#ef4444',
			border: '#1f1f1f',
			'border-strong': '#6d6d6d',
			glow: 'none'
		}
	}
];

const THEME_KEY = 'devgo.theme';
const DEFAULT = 'neon';

export const savedThemeId = () => localStorage.getItem(THEME_KEY) ?? DEFAULT;

export const applyTheme = (id: string) => {
	const theme = THEMES.find(t => t.id === id) ?? THEMES[0];
	const root = document.documentElement;
	// the surfaces are set as --solid-bg-*: index.css derives --color-bg-*
	// from them and the transparency knob. setting --color-bg-* inline here
	// would override that
	for (const key of KEYS) {
		const name = key.startsWith('bg-') ? `--solid-${key}` : `--color-${key}`;
		root.style.setProperty(name, theme.colors[key]);
	}
};

// the variables are live: the whole window recolours as they change
export const setTheme = (id: string) => {
	localStorage.setItem(THEME_KEY, id);
	applyTheme(id);
};
