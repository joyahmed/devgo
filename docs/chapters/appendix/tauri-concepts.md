# Appendix — Tauri + React Concepts Reference

## Core Architecture

```
┌──────────────────────────┐
│   React Frontend (Web)   │  ← TypeScript, Tailwind, runs in webview
├──────────────────────────┤
│   Tauri Bridge (IPC)     │  ← invoke() / events serialize via JSON
├──────────────────────────┤
│   Rust Backend (Native)  │  ← Commands, filesystem, process spawning
└──────────────────────────┘
```

The React app runs in a webview (Edge on Windows). It can't access the filesystem or run processes directly. It calls Rust commands via `invoke()`, which is IPC (inter-process communication) using JSON serialization.

---

## invoke() — Calling Rust from React

```typescript
import { invoke } from '@tauri-apps/api/core';

// Basic usage — always async, always returns a Promise
const workspaces = await invoke<string[]>('get_workspaces');

// With arguments
await invoke('add_workspace', { path: 'C:\\dev' });

// Handling errors
try {
  await invoke('open_terminal', { project }); // project: the Project object
} catch (e) {
  console.error('Failed:', e);
}
```

### Why `invoke<Type>(...)` ?

The generic `<string[]>` tells TypeScript the expected return type (workspaces are just paths). Tauri serializes the Rust return value to JSON, then deserializes it into the TypeScript type. If the types don't match at runtime, you get a deserialization error.

### invoke is ALWAYS async

Even if your Rust function is synchronous (no `async fn`), `invoke` returns a Promise because IPC is inherently async — it crosses process boundaries.

---

## Custom Hooks Pattern

The DevGo codebase uses a consistent hooks pattern:

```typescript
// hooks/useWorkspaces.ts
export const useWorkspaces = () => {
  const [workspaces, setWorkspaces] = useState<string[]>([]);

  // a plain function: the React Compiler memoises it for us
  const refresh = async () => {
    const data = await invoke<string[]>('get_workspaces');
    setWorkspaces(data);
  };

  // Load on mount
  useEffect(() => { refresh(); }, []);

  // Return: data + actions
  return { workspaces, refresh, add, remove };
};
```

**Why no `useCallback` or `useMemo`?** The scaffold turns the React Compiler on (`reactCompilerPreset()` in `vite.config.ts`), and the compiler memoises functions and derived values itself, so a hand-written `useCallback` or `useMemo` would only repeat what it already does — DevGo never uses either. Handlers are plain functions and derived data is a plain `const`:

```typescript
// useProjects.ts
const filteredProjects = !searchQuery
  ? projects
  : projects.filter(p =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
```

---

## State Lifting Pattern

In DevGo, `App.tsx` owns all state. Child components receive it as props:

```tsx
// App.tsx — owns the state, passes it down
function AppInner() {
  const runtime = useRuntime();
  const { filtered, query, setQuery, selected, setSelected, refresh } = useProjects();
  const { openVSCode, openTerminal, openBoth } = useLaunchActions(selected, refresh);

  return (
    <div>
      <TitleBar>
        <RuntimeIndicator runtime={runtime?.runtime ?? 'windows'} />
      </TitleBar>
      <SearchBox value={query} onChange={setQuery} />
      <ProjectTree projects={filtered} selected={selected} onSelect={setSelected} />
      <ActionButtons
        hasSelection={selected !== null}
        onVSCode={openVSCode}
        onTerminal={openTerminal}
        onBoth={openBoth}
      />
    </div>
  );
}
```

**Why?** Single source of truth. If two components need the same data (e.g., `selected` is used by both `ProjectTree` and `ActionButtons`), it lives in the parent and flows down.

---

## `{...{}}` — Prop spreading safety

You'll see this in DevGo's components:

```tsx
const BUTTON_CONFIG = [
  { key: 'vscode', label: 'VS Code', shortcut: 'C', action: 'open_vscode' },
  { key: 'terminal', label: 'Terminal', shortcut: 'T', action: 'open_terminal' },
] as const;

// In component:
{BUTTON_CONFIG.map(btn => (
  <ActionButton key={btn.key} {...{ btn, onClick, disabled }} />
))}
```

`{...{ btn, onClick, disabled }}` is equivalent to `btn={btn} onClick={onClick} disabled={disabled}`. It's concise prop spreading where the variable names match the prop names.

---

## Tauri Events (listen)

Tauri supports pushing events from Rust to the frontend:

```typescript
import { listen } from '@tauri-apps/api/event';

useEffect(() => {
  const unlisten = listen<ScanProgress>('scan-progress', (event) => {
    setProgress(event.payload.current / event.payload.total);
  });
  return () => { unlisten.then(fn => fn()); }; // cleanup: stop listening
}, []);
```

On the Rust side:
```rust
use tauri::Emitter;
app_handle.emit("scan-progress", ScanProgress { current: 3, total: 10 })?;
```

DevGo's events all carry the `devgo://` prefix: `devgo://clone-progress` and `devgo://clone-done` (a GitHub clone reporting its phase and percent, then its end — `useClone`), `devgo://github-updated` (the catalogue refresh finished — `useGithub`), `devgo://wsl` (the watcher saw the WSL VM appear or disappear — `useWsl`), `devgo://pty-exit` (the attached client ended — `useAttach`), and `devgo://summoned` (the global shortcut brought the window up — `App.tsx`).

---

## Tauri Plugins

Plugins give the webview access to native APIs:

| Plugin | What it does | How we use it |
|--------|-------------|---------------|
| `tauri-plugin-dialog` | Native file/folder picker | Adding workspaces (folder picker) |
| `tauri-plugin-shell` | Open URLs/files in OS default | Opening VS Code, terminal |

```typescript
// dialog plugin — open folder picker
import { open } from '@tauri-apps/plugin-dialog';
const folder = await open({ directory: true, multiple: false });
if (folder) {
  await invoke('add_workspace', { path: folder });
}
```

Permissions are in `src-tauri/capabilities/default.json`:
```json
{
  "permissions": [
    "core:default",
    "dialog:allow-open",
    "shell:allow-open"
  ]
}
```

---

## Frameless Window + Window Controls

DevGo uses a custom title bar (no OS decorations):

```json
// tauri.conf.json
{
  "app": {
    "windows": [{
      "decorations": false,  // no OS title bar
      "center": true
    }]
  }
}
```

The TitleBar component provides minimize/close buttons:

```typescript
import { getCurrentWindow } from '@tauri-apps/api/window';
const appWindow = getCurrentWindow();

function TitleBar() {
  return (
    <header>
      <div onMouseDown={() => appWindow.startDragging()}>  {/* drag handle */}
        <span>✦ DevGo</span>
      </div>
      <button onClick={() => appWindow.minimize()}>─</button>
      <button onClick={() => appWindow.toggleMaximize()}>▢</button>
      <button onClick={() => appWindow.close()}>✕</button>
    </header>
  );
}
```

Calling `appWindow.startDragging()` on `mousedown` makes that element the window's drag handle. (Tauri also offers a `data-tauri-drag-region` HTML attribute that does the same thing — both work. DevGo uses the API call for finer control over exactly which element drags.)

---

## Error Flow: Rust → React

```
Rust command returns Err(AppError::WslNotAvailable)
    ↓
Tauri serializes error → JSON { "error": "WSL not available" }
    ↓
invoke() Promise rejects
    ↓
React catch block → show Toast
```

```typescript
// The standard pattern used across all hooks:
try {
  const result = await invoke('some_command', args);
  // handle success
} catch (e) {
  toast(String(e)); // toast() defaults to the 'error' variant
}
```
