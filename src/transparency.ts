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

// whether the window was created see-through: decided once in setup from
// the stored knob, because transparent is a creation flag. on a window
// born opaque the ground alpha must stay 1: alpha in the page then
// composites over the webview's plain background, a dark tint, not
// see-through. the knob is stored for the next launch instead
export const launchedTransparent = () =>
	invoke<boolean>('window_launched_transparent').catch(() => false);

// on mount: the variable is set before anything shows
export const loadGroundAlpha = () =>
	Promise.all([
		invoke<number>('get_window_transparency'),
		launchedTransparent()
	])
		.then(([pct, born]) => applyGroundAlpha(born ? pct : 0))
		.catch(() => {});

// the window is the preview when it was born see-through: applied and
// persisted by one command, which hands back the clamped value the
// stepper then shows. born opaque, the value is stored only
export const setTransparency = (
	percent: number,
	born: boolean
): Promise<number> =>
	invoke<number>('set_window_transparency', { percent }).then(stored => {
		applyGroundAlpha(born ? stored : 0);
		return stored;
	});
