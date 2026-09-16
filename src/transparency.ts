import { invoke } from '@tauri-apps/api/core';

// the frontend half of the transparency setting: the os effect is rust's,
// the ground's alpha is one css variable from the same percentage. the
// cap is rust's too (preferences.rs clamps); this one only ends the slider
export const MAX_TRANSPARENCY = 60;

export const applyGroundAlpha = (percent: number) => {
	const pct = Math.max(0, Math.min(MAX_TRANSPARENCY, percent));
	document.documentElement.style.setProperty(
		'--ground-alpha',
		String(1 - pct / 100)
	);
};

// on mount: the variable is set before anything shows
export const loadGroundAlpha = () =>
	invoke<number>('get_window_transparency')
		.then(applyGroundAlpha)
		.catch(() => {});

// the window is the preview: applied and persisted by one command, which
// hands back the clamped value the slider then shows
export const setTransparency = (percent: number): Promise<number> =>
	invoke<number>('set_window_transparency', { percent }).then(stored => {
		applyGroundAlpha(stored);
		return stored;
	});
