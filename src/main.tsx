import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { applyTheme, savedThemeId } from './themes';

// before the first paint, so a themed install never flashes the default
applyTheme(savedThemeId());

ReactDOM.createRoot(
	document.getElementById('root') as HTMLElement
).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>
);
