import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import StackPanel from './components/StackPanel';
import './index.css';
import { applyTextScale, savedTextScale } from './textSize';
import { applyTheme, savedThemeId } from './themes';
import { logSessionStart } from './uiLog';

// before the first paint, so a themed install never flashes the default;
// the saved text size, the webview zoom, for the same reason
applyTheme(savedThemeId());
const scale = savedTextScale();
if (scale !== 1) applyTextScale(scale).catch(() => {});

// the "My stack" window loads this same bundle; it renders its own panel
// and stays out of the main window's startup marks and session log
const isStack = getCurrentWindow().label === 'stack';
if (!isStack) {
	invoke('mark_startup', { stage: 'js-start' }).catch(() => {});
	// once per document, not once per process: a second one of these under
	// the same backend start header is a webview reload, which no react
	// cleanup below can report
	logSessionStart();
}
ReactDOM.createRoot(
	document.getElementById('root') as HTMLElement
).render(
	<React.StrictMode>
		{isStack ? <StackPanel /> : <App />}
	</React.StrictMode>
);
