import { invoke } from '@tauri-apps/api/core';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { applyTextScale, savedTextScale } from './textSize';
import { applyTheme, savedThemeId } from './themes';
import { logSessionStart } from './uiLog';

// before the first paint, so a themed install never flashes the default;
// the saved text size, the webview zoom, for the same reason
applyTheme(savedThemeId());
const scale = savedTextScale();
if (scale !== 1) applyTextScale(scale).catch(() => {});

invoke('mark_startup', { stage: 'js-start' }).catch(() => {});
// once per document, not once per process: a second one of these under
// the same backend start header is a webview reload, which no react
// cleanup below can report
logSessionStart();
ReactDOM.createRoot(
	document.getElementById('root') as HTMLElement
).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>
);
