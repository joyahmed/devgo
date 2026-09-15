// every colour is a --color-* variable, so a theme is an override on :root
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
	'border'
];

export const THEMES: Theme[] = [
	{
		id: 'neon',
		name: 'DevGo Neon',
		colors: {
			'bg-primary': '#080c12',
			'bg-secondary': '#0c121c',
			'bg-panel': '#0e1420',
			'bg-hover': '#1a2744',
			'bg-selected': '#1e3a5f',
			'text-primary': '#ffffff',
			'text-secondary': '#a0a0a0',
			'text-muted': '#767e8d',
			accent: '#3b82f6',
			'accent-hover': '#2563eb',
			danger: '#ef4444',
			border: '#1e293b'
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
			border: '#14331a'
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
			border: '#434c5e'
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
			border: '#44475a'
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
			border: '#1f1f1f'
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
