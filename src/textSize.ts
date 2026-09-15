import { getCurrentWebview } from '@tauri-apps/api/webview';

// the text-size steps a user can walk with ctrl+= / ctrl+- or in
// settings. the webview's own zoom, not a second type scale: the five
// text tokens, the spacing and the chips grow together, so a 120% devgo
// is the same design at 120%. saved per machine, like the theme
export const TEXT_STEPS = [0.85, 0.9, 1, 1.1, 1.2, 1.35, 1.5] as const;
type TextStep = (typeof TEXT_STEPS)[number];
const KEY = 'devgo.textScale';

export const savedTextScale = (): number => {
	const n = Number(localStorage.getItem(KEY));
	return TEXT_STEPS.includes(n as TextStep) ? n : 1;
};

export const applyTextScale = async (scale: number): Promise<number> => {
	localStorage.setItem(KEY, String(scale));
	await getCurrentWebview().setZoom(scale);
	// the settings panel shows the number; a shortcut must move it too
	window.dispatchEvent(new Event('devgo:textscale'));
	return scale;
};

// one step up or down from the saved scale, clamped to the table
export const stepTextScale = (dir: 1 | -1): Promise<number> => {
	const i = TEXT_STEPS.indexOf(savedTextScale() as TextStep);
	const next =
		TEXT_STEPS[Math.min(TEXT_STEPS.length - 1, Math.max(0, i + dir))];
	return applyTextScale(next);
};
