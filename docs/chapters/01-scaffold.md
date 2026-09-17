# 01 — Project Scaffold (Phase 1)

**Branch:** `01.scaffold` — `git checkout 01.scaffold` gives you this chapter's finished app; there is no earlier stage to diff against, so `git ls-tree -r --name-only 01.scaffold` is exactly what this chapter creates.

**Starting from:** Empty folder. Nothing installed but the prerequisites.

**Goal:** A Tauri window that opens, with a React app running inside it, styled with Tailwind CSS, frameless — and the one component a frameless window cannot do without: its own title bar.

> **What a stage is.** Every chapter of this book is a branch. Check it out and you have the app as it stands at the end of the chapter, nothing more; diff it against the previous branch and you have the chapter's whole contribution. That is the rule the rest of the book is written to: **every line the tutorial tells you to write exists in the final repo, and nothing is written and then deleted.** Code gains fields, callers and parameters as the chapters go on. It is never thrown away.

> **How the frontend is written.** Four rules, applied from the first component on:
> 1. **Default exports.** A component file exports its component as `export default`, and is imported as `import TitleBar from './components/TitleBar'`. Less to type, no braces to mismatch.
> 2. **Never repeat an element — map it.** Three window buttons are one `TitleBarButton` and an array of three entries, not three pasted `<button>`s.
> 3. **Hooks hold reactivity, components hold markup.** A component with no state and no effect gets no hook. The title bar in this chapter is exactly that: markup only.
> 4. **No `useMemo`, no `useCallback`, no `memo()`, no `forwardRef`.** The React Compiler (§1.2) memoizes at build time, and React 19 passes `ref` as an ordinary prop. Derived values are plain `const`s; handlers are plain functions.

---

## 1.1 — Create the Tauri project

We use `create-tauri-app` which scaffolds both the Rust backend and a Vite + React frontend in one command.

```powershell
mkdir G:\01_tauri
cd G:\01_tauri
bun create tauri-app
```

You'll be prompted:
- **Project name:** `devgo`
- **Identifier:** `app.zetta.devgo`
- **Frontend:** `React` → `TypeScript`
- **Package manager:** `bun`
- **UI template:** `None` (Tailwind is added by hand in §1.2)

> **Wait — what just happened?** `create-tauri-app` generated:
> - `src/` — Vite + React TypeScript frontend, with `vite-env.d.ts` (the one line that gives `import.meta.env` its types)
> - `src-tauri/` — Rust backend with `Cargo.toml`, `Cargo.lock`, `build.rs`, `src/main.rs`, `src/lib.rs`, and its own `.gitignore` for `target/` and the generated schemas
> - `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `.gitignore`
> - `README.md` (the template's own; left as is) and `.vscode/extensions.json`, which recommends the Tauri and rust-analyzer extensions
> - Everything wired together via `tauri.conf.json`

Test it works:

```powershell
cd devgo
bun tauri dev
```

You should see a window with "Welcome to Tauri!" text.

The identifier matters more than it looks: it names the app-data folder every later chapter writes into (`%APPDATA%\app.zetta.devgo`). Pick it once — on the branch it was corrected in the commit right after the root, before anything had been written under it (§1.7).

`package.json` is what the scaffold wrote plus the packages the next sections add. The versions are floors — `bun install` resolves each to the newest release that satisfies it, and `bun.lock` records what that was:

```json
{
  "name": "devgo",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@tauri-apps/api": "^2.11.1",
    "@tauri-apps/plugin-dialog": "~2.7.3",
    "@tauri-apps/plugin-opener": "^2.5.5",
    "@tauri-apps/plugin-shell": "~2.3.6",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "tailwindcss": "^4.3.3"
  },
  "devDependencies": {
    "@babel/core": "^8.0.5",
    "@rolldown/plugin-babel": "^0.2.4",
    "@tauri-apps/cli": "^2.11.4",
    "@types/babel__core": "^7.20.5",
    "@types/node": "^26.5.1",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.1",
    "babel-plugin-react-compiler": "^1.0.0",
    "typescript": "~6.0.3",
    "vite": "^8.3.0"
  }
}
```

`@tauri-apps/plugin-opener` is the scaffold's; it is still listed here and in `Cargo.toml` at the end of this chapter, and chapter 02 removes it (§1.4).

---

## 1.2 — Set up Tailwind CSS v4

Tailwind v4 uses a Vite plugin approach (no `tailwind.config.js` needed).

```powershell
bun add tailwindcss @tailwindcss/vite
bun add -d @types/node
bun add -d @rolldown/plugin-babel @babel/core babel-plugin-react-compiler @types/babel__core
```

The second dev line is the **React Compiler**. It rewrites every component and hook at build time so that values and functions are cached exactly where a hand-written `useMemo`/`useCallback` would have cached them — which is why this book never writes either. `@vitejs/plugin-react` ships a `reactCompilerPreset` for it; the compiler itself runs as a Babel preset through `@rolldown/plugin-babel`. (The plugin also offers `react({ compiler: true })` backed by a Rust port; it is marked experimental, so the book uses the Babel plugin.)

`@types/node` is for `vite.config.ts` itself: the file reads `process.env`, and without Node's types the scaffold papers over that with a `// @ts-expect-error` and an `import process from 'node:process'`. With the types installed, both lines go and `process` is simply a global.

`vite.config.ts` is where the plugin goes. The rest of the file is what `create-tauri-app` wrote for Tauri — a fixed port, no clearing of the terminal, and a watcher that ignores `src-tauri/` so a Rust rebuild does not trigger a frontend reload:

```ts
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
	plugins: [
		react(),
		babel({ presets: [reactCompilerPreset()] }),
		tailwindcss()
	],

	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent Vite from obscuring rust errors
	clearScreen: false,
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: 'ws',
					host,
					port: 1421
				}
			: undefined,
		watch: {
			// 3. tell Vite to ignore watching `src-tauri`
			ignored: ['**/src-tauri/**']
		}
	}
}));
```

The only lines that are ours are the three entries in `plugins`. Port `1420` is the scaffold's choice and `tauri.conf.json` (§1.3) points its `devUrl` at the same number — change one, change both.

In `src/index.css`, replace everything with:

```css
@import 'tailwindcss';

@theme {
	--color-bg-primary: #080c12;
	--color-bg-secondary: #0c121c;
	--color-bg-panel: #0e1420;
	--color-bg-hover: #1a2744;
	--color-bg-selected: #1e3a5f;
	--color-text-primary: #ffffff;
	--color-text-secondary: #a0a0a0;
	--color-text-muted: #6b7280;
	--color-accent: #3b82f6;
	--color-accent-hover: #2563eb;
	--color-danger: #ef4444;
	--color-border: #1e293b;
	--font-sans: 'Segoe UI', system-ui, sans-serif;
	--font-mono: 'Cascadia Code', 'Consolas', monospace;
	--radius-panel: 12px;
}

html,
body,
#root {
	height: 100%;
	width: 100%;
	overflow: hidden;
}

body {
	font-family: var(--font-sans);
	background: var(--color-bg-primary);
	color: var(--color-text-primary);
	-webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar {
	width: 6px;
}
::-webkit-scrollbar-track {
	background: transparent;
}
::-webkit-scrollbar-thumb {
	background: var(--color-border);
	border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
	background: var(--color-text-muted);
}
```

> **What's happening:** The `@import "tailwindcss"` directive is processed by the Vite plugin at build time. It injects Tailwind's utility classes into your CSS.

### `@theme` — the palette is a set of variables, and every variable is a utility

Tailwind v4 reads the `@theme` block and mints a utility for every variable in it: `--color-bg-panel` becomes `bg-bg-panel`, `border-bg-panel` and `text-bg-panel`; `--color-text-muted` becomes `text-text-muted`. Every component from here to the end of the book is styled with these tokens and never with a raw hex value. If a class like `bg-bg-panel` looks unfamiliar later, it's a theme token, not a Tailwind default — and the whole reason for the discipline shows up in chapter 19, where a theme becomes nothing more than a different set of values for the same names.

The `body` rule paints the window dark before React has rendered a single element, and `overflow: hidden` on `html`, `body` and `#root` keeps the frameless window from ever growing a scrollbar of its own. The scrollbar rules are the only place the browser's default chrome shows through in a frameless app, so we restyle it once here.

`index.html` is the scaffold's with two changes — the favicon is ours (`public/favicon.svg`, alongside `public/icons.svg` for later chapters; the scaffold's `vite.svg` and `tauri.svg` are deleted), and the `<body>` carries the same dark ground as a class, so the very first frame — before `index.css` has loaded — is not white:

```html
<!doctype html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DevGo</title>
</head>

<body class="bg-[#080C12] text-white font-mono overflow-hidden">
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>

</html>
```

---

## 1.3 — Frameless window config

Edit `src-tauri/tauri.conf.json`:

```json
{
	"$schema": "https://schema.tauri.app/config/2",
	"productName": "devgo",
	"version": "0.1.0",
	"identifier": "app.zetta.devgo",
	"build": {
		"beforeDevCommand": "bun run dev",
		"devUrl": "http://localhost:1420",
		"beforeBuildCommand": "bun run build",
		"frontendDist": "../dist"
	},
	"app": {
		"windows": [
			{
				"title": "devgo",
				"width": 900,
				"height": 720,
				"resizable": true,
				"decorations": false,
				"center": true,
				"visible": true
			}
		],
		"security": {
			"csp": null
		}
	},
	"bundle": {
		"active": true,
		"targets": "all",
		"icon": [
			"icons/32x32.png",
			"icons/128x128.png",
			"icons/128x128@2x.png",
			"icons/icon.icns",
			"icons/icon.ico"
		],
		"windows": {
			"nsis": {
				"installerIcon": "icons/icon.ico",
				"uninstallerIcon": "icons/icon.ico"
			}
		}
	}
}
```

Key settings:
- `decorations: false` — removes the OS title bar. We'll build our own in React, in §1.6.
- `center: true` — window appears in the center of the screen.
- `visible: true` — the window shows as soon as it's created. (In [07 — One Instance, in the Tray](./07-single-instance.md) we flip this to `false` and show it from React after mount, to kill a startup white flash — but that optimization only makes sense once there's UI to render.)
- `csp: null` — disables Content Security Policy (needed for inline styles in dev).
- the `bundle` block is covered in §1.5, once the icons it names exist.

---

## 1.4 — Add Tauri plugins for later use

We need `dialog` (folder picker, chapter 02) and `shell` (opening VS Code / terminal, chapter 05). Run these from the **project root**, not from `src-tauri/` — the CLI looks for `package.json`:

```powershell
bun tauri add dialog
bun tauri add shell
```

Each command does four edits at once: the crate in `Cargo.toml`, the `.plugin(...)` line in `lib.rs`, a permission in `capabilities/default.json`, and the matching `@tauri-apps/plugin-*` npm package.

The scaffold also ships `tauri-plugin-opener`, which does a subset of what `shell` does. Its `.plugin(...)` line in `lib.rs` and its `opener:default` permission in `capabilities/default.json` go now; the crate and the npm package stay listed until chapter 02, which drops them from `Cargo.toml`, `package.json` and both lock files in one commit (`✅CHORE: drop tauri-plugin-opener — shell covers it`) so the app does not carry two plugins for one job.

Here is `src-tauri/Cargo.toml` at the end of this chapter — the scaffold's, plus the two plugins. `serde` and `serde_json` are the scaffold's too, and every JSON file the app will keep goes through them; the error crate chapter 02 needs is added there, with `cargo add`:

```toml
[package]
name = "devgo"
version = "0.1.0"
description = "A Tauri App"
authors = ["you"]
edition = "2021"

# See more keys and their definitions at https://doc.rust-lang.org/cargo/reference/manifest.html

[lib]
# The `_lib` suffix may seem redundant but it is necessary
# to make the lib name unique and wouldn't conflict with the bin name.
# This seems to be only an issue on Windows, see https://github.com/rust-lang/cargo/issues/8519
name = "devgo_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri-plugin-dialog = "2"
tauri-plugin-shell = "2"


# Read the optimization guideline for more details: https://tauri.app/concept/size/#cargo-configuration
[profile.release]
codegen-units = 1
lto = true
opt-level = 3
panic = "abort"
strip = true
```

`tauri = { version = "2", features = [] }` stays empty for now: the feature flags a system tray needs are switched on in chapter 07, the moment the tray exists. The `[lib]` block and `[profile.release]` are the scaffold's — the first names the library crate so it cannot collide with the binary on Windows, the second is Tauri's recommended release build (`strip = true` drops the symbols from the shipped binary).

`src-tauri/src/lib.rs` is the whole backend for now — the builder, the two plugins, and `run`. The scaffold's `greet` command and its `invoke_handler` go; there is nothing to greet, and chapter 02 brings `invoke_handler` back with real commands:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

The `#[cfg_attr(mobile, …)]` line is the scaffold's mobile entry point. It costs nothing on desktop; chapter 02 removes it, since this app never builds for a phone.

And `src-tauri/src/main.rs` calls it:

```rust
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    devgo_lib::run()
}
```

**Rust note:** `main.rs` just calls `run()`. `lib.rs` creates the Tauri app, registers plugins, and calls `app.run()`; from chapter 02 it also sets up state and registers commands. This separation is a Tauri convention — `lib.rs` is the "app builder", `main.rs` is the "launcher". The `windows_subsystem = "windows"` attribute is what stops a release build from opening a console window next to the app.

The capabilities file, `src-tauri/capabilities/default.json`, is the permission list for the webview. Tauri v2 blocks frontend window APIs unless allowed, so every window control the title bar in §1.6 calls is granted here, alongside the two plugins:

```json
{
	"$schema": "../gen/schemas/desktop-schema.json",
	"identifier": "default",
	"description": "Capability for the main window",
	"windows": ["main"],
	"permissions": [
		"core:default",
		"core:window:allow-minimize",
		"core:window:allow-maximize",
		"core:window:allow-toggle-maximize",
		"core:window:allow-unmaximize",
		"core:window:allow-close",
		"core:window:allow-start-dragging",
		"shell:allow-open",
		"dialog:allow-open",
		"dialog:allow-save"
	]
}
```

Every line here has a caller in this chapter's title bar except the plugin ones, which chapters 02 and 05 call. Nothing is granted ahead of its use: chapter 07, where a hidden window is shown from React, adds `core:window:allow-show` at that moment.

---

## 1.5 — Generate App Icons

Tauri needs icons for the app window, taskbar, and installers. The standard convention is:

1. Place a **square PNG** (at least 1024x1024 recommended, 512x512 minimum) named `app-icon.png` in `src-tauri/`
2. Run the Tauri CLI icon generator, pointing it at that file

```powershell
# From the project root — the CLI is already installed as @tauri-apps/cli
bun tauri icon src-tauri/app-icon.png
```

The path argument matters: without it, `tauri icon` looks for `./app-icon.png` in the directory you run it from (the project root), not in `src-tauri/`, and fails with "failed to read and decode source image ./app-icon.png".

> **What happens:** The command reads `src-tauri/app-icon.png` and generates all platform-specific icons into `src-tauri/icons/`:
> - `icon.ico` — Windows app icon (multi-resolution)
> - `icon.icns` — macOS icon
> - `icon.png` — 512x512 fallback
> - `32x32.png`, `128x128.png`, `128x128@2x.png` — for bundle config
> - `Square*.png`, `StoreLogo.png` — Windows Store / MSI branding
> - `ios/AppIcon*.png` — iOS app icons
> - `android/ic_launcher*.png` — Android icons

**Icon requirements:**
- Must be **square** (equal width and height)
- PNG format with transparency (RGBA)
- Minimum 512x512, ideally 1024x1024
- The logo should have some padding inside the canvas (not touching edges)
- Only one `app-icon.png` needed — the generator handles all formats/sizes

**Bundle config** already points at the generated files in `tauri.conf.json` — the block from §1.3, once more:

```json
	"bundle": {
		"active": true,
		"targets": "all",
		"icon": [
			"icons/32x32.png",
			"icons/128x128.png",
			"icons/128x128@2x.png",
			"icons/icon.icns",
			"icons/icon.ico"
		],
		"windows": {
			"nsis": {
				"installerIcon": "icons/icon.ico",
				"uninstallerIcon": "icons/icon.ico"
			}
		}
	}
```

The `installerIcon` / `uninstallerIcon` fields are important — without them, the NSIS installer shows a generic exe icon instead of your logo.

---

## 1.6 — TitleBar

A frameless window (`decorations: false`) has no OS chrome, so we build our own: a drag region, the app name, a slot for whatever a later chapter wants to show beside it, and window controls. It is two files in `src/components/` — the button together with its three entries, and the bar that renders them.

### The button and its entries — `TitleBarButton.tsx`

One small button, styled once, and below it the three entries the title bar maps over. The component is the default export; the entries are a named one. They live in one file because the entries are nothing without the button, and the button has no other caller.

```tsx
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

interface TitleBarButtonProps {
	className?: string;
	onClick: () => void;
	children: React.ReactNode;
}

const buttonClass =
	'flex items-center justify-center w-8 h-7 bg-transparent border-none text-text-secondary cursor-pointer text-sm rounded hover:bg-bg-hover hover:text-text-primary transition-colors';

const TitleBarButton = ({
	className = '',
	onClick,
	children
}: TitleBarButtonProps) => (
	<button
		type='button'
		{...{ onClick, className: `${buttonClass} ${className}` }}
	>
		{children}
	</button>
);

export default TitleBarButton;

export const TITLE_BAR_BUTTONS = [
	{
		id: 'minimize',
		className: '',
		onClick: () => appWindow.minimize(),
		children: (
			<svg width='12' height='12' viewBox='0 0 12 12'>
				<rect y='5' width='12' height='2' fill='currentColor' />
			</svg>
		)
	},
	{
		id: 'maximize',
		className: '',
		onClick: () => appWindow.toggleMaximize(),
		children: (
			<svg width='12' height='12' viewBox='0 0 12 12'>
				<rect
					x='1.5'
					y='1.5'
					width='9'
					height='9'
					fill='none'
					stroke='currentColor'
					strokeWidth='1.5'
				/>
			</svg>
		)
	},
	{
		id: 'close',
		className: 'hover:bg-danger hover:text-white',
		onClick: () => appWindow.close(),
		children: (
			<svg width='12' height='12' viewBox='0 0 12 12'>
				<line
					x1='2'
					y1='2'
					x2='10'
					y2='10'
					stroke='currentColor'
					strokeWidth='1.5'
				/>
				<line
					x1='10'
					y1='2'
					x2='2'
					y2='10'
					stroke='currentColor'
					strokeWidth='1.5'
				/>
			</svg>
		)
	}
];
```

`className` is the caller's *extra* classes, appended after the base — the close button uses it to turn red. The default `''` keeps the template literal from printing `undefined` into the class list. `type='button'` is habit: a button without it submits the nearest form, and one day a title bar will sit inside one.

The entries are three of one shape. Each has an `id` for React's `key`, the extra `className`, the window call, and the icon. The keys are named `className` / `onClick` / `children` on purpose — they are the props of `TitleBarButton`, so an entry spreads straight onto it. Each of the three window calls is one of the `core:window:allow-*` permissions granted in §1.4.

### The bar — `TitleBar.tsx`

Pure markup: a drag region on the left, the buttons on the right, and a `children` slot between them.

```tsx
import { getCurrentWindow } from '@tauri-apps/api/window';
import { type ReactNode } from 'react';
import TitleBarButton, { TITLE_BAR_BUTTONS } from './TitleBarButton';

const appWindow = getCurrentWindow();

interface TitleBarProps {
	children?: ReactNode;
}

const TitleBar = ({ children }: TitleBarProps) => (
	<header className='flex items-center justify-between h-12 px-4 bg-bg-secondary border-b border-border shrink-0 select-none'>
		<div
			className='flex flex-1 items-center gap-2 cursor-grab'
			onMouseDown={() => appWindow.startDragging()}
		>
			<span className='text-lg text-accent pointer-events-none'>
				&#10022;
			</span>
			<span className='text-base font-bold text-text-primary pointer-events-none'>
				DevGo
			</span>
			<span className='text-xs text-text-secondary ml-1 pointer-events-none'>
				Developer Workspace Launcher
			</span>
		</div>
		<div className='flex items-center gap-1 shrink-0'>
			{children}
			{TITLE_BAR_BUTTONS.map(({ id, ...button }) => (
				<TitleBarButton key={id} {...button} />
			))}
		</div>
	</header>
);

export default TitleBar;
```

### Dragging via `startDragging()`

We make the left area draggable with `onMouseDown={() => appWindow.startDragging()}` rather than the `data-tauri-drag-region` HTML attribute. Calling the API directly gives us precise control over exactly which element drags, and plays nicely with the `pointer-events-none` children (so text doesn't swallow the drag). Without this handler the `cursor-grab` is a lie — the window cannot be moved.

### `getCurrentWindow()` at module scope

```tsx
const appWindow = getCurrentWindow();
```

It returns the same window object every time, so we grab it once at module level instead of re-fetching on every render. Both files call it — `TitleBar.tsx` for dragging and `TitleBarButton.tsx` for the entries — and both get the same object.

### The `children` slot

`TitleBar` takes `children` and drops them just left of the window buttons. Nothing fills it yet. Chapter 04 puts a runtime badge there — the title bar doesn't need to know what the badge is, it just gives it a home.

### Props — beside the component for now

`TitleBarProps` and `TitleBarButtonProps` are declared in the file that uses them, and `src/types.d.ts` sits empty. Chapter 02 is where the app's one-file-for-every-type rule begins: the first Rust wire type lands in `types.d.ts`, and these two interfaces move there with it. They start here because a chapter with one component and no backend has nothing to gather yet.

### Mount it

`src/main.tsx` is the scaffold's, with our stylesheet imported:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(
	document.getElementById('root') as HTMLElement
).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>
);
```

And `src/App.tsx` renders the title bar and nothing else:

```tsx
import TitleBar from './components/TitleBar';

const App = () => (
	<div className='flex flex-col h-screen w-screen rounded-xl overflow-hidden'>
		<TitleBar />
	</div>
);

export default App;
```

The root `div` is the one element every later chapter renders inside: a full-window column, corners rounded to read as a floating panel, overflow clipped so the rounding is real. Chapter 23 has something to say about that `rounded-xl` when the window learns to maximize.

---

## 1.7 — Verify

```powershell
bun tauri dev
```

You should see:
1. Vite dev server starts (http://localhost:1420)
2. Cargo compiles the Rust backend (~1 min first time)
3. A frameless 900x720 dark window opens, with a title bar you can drag by and three buttons that work

If it compiles and the window appears → Phase 1 done.

### The files `tsc` leaves behind

`bun run build` runs `tsc` before Vite. `tsconfig.json` lists `tsconfig.node.json` as a project it depends on, which makes that file a *composite* project (it has to be, to be listed there), and a composite project must emit — so whenever that project is built (`tsc -b`, or an editor's build step) it drops `vite.config.js`, `vite.config.d.ts` and `.tsbuildinfo` files into the project root. Two lines keep them out of the tree:

```jsonc
// tsconfig.node.json — inside compilerOptions
"emitDeclarationOnly": true,
"outDir": "node_modules/.tmp",
```

and in `.gitignore`, under `node_modules`:

```
*.tsbuildinfo
```

> **Commit checkpoint** — you now have a working Tauri + React skeleton ready for the Rust backend. Each chapter is a branch off `main`; finish the chapter on it, merge it back, and start the next branch from `main`.
>
> ```powershell
> git init
> git checkout -b 01.scaffold
> git add -A
> git commit -m "✅STAGE: 01 scaffold"
> git branch main
> git checkout main
> ```
>
> (`main` is created *after* the first commit because an unborn branch has nothing to point at; from chapter 02 on it is `git checkout main && git merge 02.workspaces`.)
>
> This is the one chapter where the `✅STAGE:` commit is the *root* of the branch, not its last commit. The tree you have typed is the branch's tip, but the branch got there in five steps — the scaffold as first committed, then four corrections, each of which this chapter has already folded into its text. In order:
>
> ```
> ✅STAGE: 01 scaffold
> ✅SCAFFOLD: drop the template greet command; identifier is app.zetta.devgo
> ✅SCAFFOLD: one TitleBarButton file — the component and its three entries together
> ✅SCAFFOLD: @types/node so vite.config.ts needs no process import
> ✅SCAFFOLD: React Compiler on — no manual useMemo/useCallback anywhere in the book
> ```
>
> - the first correction deletes the scaffold's `greet` command from `lib.rs` (§1.4) and changes `identifier` in `tauri.conf.json` from the template's `com.devgo.app` to `app.zetta.devgo` (§1.1, §1.3);
> - the second folds a separate `titleBarButtons.tsx` into `TitleBarButton.tsx` as the `TITLE_BAR_BUTTONS` export, and `TitleBar.tsx` imports both from the one file (§1.6);
> - the third adds `@types/node` and drops the `// @ts-expect-error` + `import process from 'node:process'` pair from `vite.config.ts` (§1.2);
> - the fourth adds `@babel/core`, `@rolldown/plugin-babel`, `@types/babel__core` and `babel-plugin-react-compiler`, and puts `babel({ presets: [reactCompilerPreset()] })` in the `plugins` list (§1.2).
>
> `git diff a09b524 01.scaffold` shows all four together; from chapter 02 on, every branch ends with its `✅STAGE:` commit.

---

## 1.8 — What you just built

```
devgo/
├── .gitignore              ← scaffold's, plus *.tsbuildinfo
├── .vscode/extensions.json ← scaffold: recommended extensions
├── README.md               ← scaffold's template readme
├── index.html              ← entry point, dark ground on <body>
├── package.json            ← bun scripts, dependencies
├── bun.lock
├── vite.config.ts          ← Vite + React + Tailwind config
├── tsconfig.json
├── tsconfig.node.json
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── src/
│   ├── main.tsx            ← React mount point
│   ├── App.tsx             ← root component (a title bar, for now)
│   ├── index.css           ← Tailwind import + the theme tokens
│   ├── types.d.ts          ← ambient types shared across files (empty until chapter 02)
│   ├── vite-env.d.ts       ← scaffold: Vite's client types
│   └── components/
│       ├── TitleBar.tsx         ← drag region + the buttons, mapped
│       └── TitleBarButton.tsx   ← one window button + the three entries
├── src-tauri/
│   ├── .gitignore           ← scaffold: target/, gen/schemas
│   ├── app-icon.png         ← source icon (square PNG)
│   ├── Cargo.toml           ← Rust dependencies
│   ├── Cargo.lock
│   ├── build.rs             ← Tauri build script
│   ├── tauri.conf.json      ← Window config, bundle config
│   ├── capabilities/
│   │   └── default.json     ← Plugin + window permissions
│   ├── icons/               ← generated by `bun tauri icon`
│   │   ├── icon.ico
│   │   ├── icon.icns
│   │   ├── icon.png
│   │   ├── 32x32.png, 128x128.png, ...
│   │   ├── android/
│   │   └── ios/
│   └── src/
│       ├── main.rs          ← Rust entry point
│       └── lib.rs           ← Tauri builder + plugin registration
```

→ Next: [02 — Workspaces](./02-workspaces.md)

→ Appendix: [Rust Concepts](./appendix/rust-concepts.md)
