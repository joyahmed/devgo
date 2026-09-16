// every colour is a --color-* variable, so a theme is an override on :root
//
// the contract a palette has to meet (scripts/check-contrast.mjs runs it):
// - text-muted >= 4.5:1 on bg-primary and bg-panel: it carries real
//   information (badges, hints, timestamps), so the body-text bar applies
// - border-strong >= 3:1 on every surface: the edge of a control you operate
// - border is held to nothing on purpose: it is the quiet divider between
//   rows and panels, and a control-grade ratio would draw every hairline
const KEYS: ThemeKey[] = [
	'bg-primary',
	'bg-secondary',
	'bg-panel',
	'bg-hover',
	'bg-selected',
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
			'text-primary': '#d6ffd6',
			'text-secondary': '#4ade80',
			'text-muted': '#4d8861',
			accent: '#22c55e',
			'accent-hover': '#16a34a',
			danger: '#ef4444',
			border: '#14331a',
			'border-strong': '#2b6d37',
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
			'bg-selected': '#4c566a',
			'text-primary': '#eceff4',
			'text-secondary': '#d8dee9',
			'text-muted': '#a4aec1',
			accent: '#88c0d0',
			'accent-hover': '#81a1c1',
			danger: '#bf616a',
			border: '#434c5e',
			'border-strong': '#818da5',
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
			'text-primary': '#f8f8f2',
			'text-secondary': '#bcc2cd',
			'text-muted': '#95a0c1',
			accent: '#bd93f9',
			'accent-hover': '#a679f0',
			danger: '#ff5555',
			border: '#44475a',
			'border-strong': '#7b7f9b',
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
			'text-primary': '#ffffff',
			'text-secondary': '#b0b0b0',
			'text-muted': '#797979',
			accent: '#3b82f6',
			'accent-hover': '#2563eb',
			danger: '#ef4444',
			border: '#1f1f1f',
			'border-strong': '#5d5d5d',
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
	for (const key of KEYS) {
		root.style.setProperty(`--color-${key}`, theme.colors[key]);
	}
};

// the variables are live: the whole window recolours as they change
export const setTheme = (id: string) => {
	localStorage.setItem(THEME_KEY, id);
	applyTheme(id);
};
