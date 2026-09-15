import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { applyTextScale, savedTextScale } from './textSize';
import { applyTheme, savedThemeId } from './themes';

// before the first paint, so a themed install never flashes the default;
// the saved text size, the webview zoom, for the same reason
applyTheme(savedThemeId());
const scale = savedTextScale();
if (scale !== 1) applyTextScale(scale).catch(() => {});

ReactDOM.createRoot(
	document.getElementById('root') as HTMLElement
).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>
);
