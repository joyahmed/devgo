# Appendix — Rust Concepts Reference

This is not a full Rust tutorial. It explains the specific Rust concepts used throughout the DevGo codebase, with real examples from the project.

---

## Structs

```rust
// A struct is a custom data type with named fields.
// Think: TypeScript interface or C# class with only properties.
pub struct Project {
    pub name: String,        // pub = visible outside this module
    pub full_path: String,   // String = heap-allocated, growable text
    pub workspace: String,   // which workspace this project came from
    pub file_system: String, // "Windows" or "WSL"
}
```

### Why not `&str`?

`&str` is a borrowed string slice — it references someone else's data. That means you need a lifetime parameter (`<'a>`). For data we own and store, `String` is simpler. Use `&str` for function params, `String` for struct fields.

```rust
// Good: borrow for read-only function
fn print_label(name: &str) { println!("{}", name); }

// Good: own for storage
struct Project { name: String }
```

---

## impl blocks

```rust
impl Project {
    // Constructor convention: fn new() -> Self
    pub fn new(name: String, full_path: String, workspace: String, file_system: String) -> Self {
        Self { name, full_path, workspace, file_system } // Self = Project
    }

    // A method would take &self (borrows, doesn't consume). DevGo's Project has
    // no methods beyond `new`, but this is the shape:
    // pub fn display_name(&self) -> String {
    //     format!("{} ({})", self.name, self.full_path)
    // }
}
```

Three self types:
- `&self` — borrow (read-only method, most common)
- `&mut self` — mutable borrow (method that changes fields)
- `self` — consumes the struct (method that takes ownership, rare)

---

## Enums

```rust
// An enum is one-of-many. Like a discriminated union.
// #[serde(rename_all = "lowercase")] makes it serialize as "windows"/"wsl"
// so the TypeScript side reads runtime: "windows" | "wsl".
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Runtime {
    Windows,
    Wsl,
}

// `match` is exhaustive — the compiler forces you to handle every variant.
// (DevGo labels runtimes in the React layer, but this is how match works.)
fn label(runtime: &Runtime) -> &str {
    match runtime {
        Runtime::Windows => "Windows",
        Runtime::Wsl => "WSL",
    }
}
```

### Enums with data (used in error types)

```rust
pub enum AppError {
    Io(std::io::Error),           // wraps an IO error
    Serde(serde_json::Error),     // wraps a JSON error
    WorkspaceNotFound(String),    // carries a string
}
```

---

## Traits

A trait defines shared behavior. Think: "interface" in C#/TypeScript.

```rust
// serde provides Serialize — "this type can become JSON"
#[derive(Serialize)]  // derive macro auto-generates the impl
pub struct Project {
    pub name: String,
    pub full_path: String,
    pub workspace: String,
    pub file_system: String,
}
```

Without the derive, you'd write:

```rust
impl Serialize for Project {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // ... manually serialize each field ...
    }
}
```

`#[derive]` is a procedural macro that writes this boilerplate for you.

### Key traits we use:
| Trait | Purpose | Derive? |
|-------|---------|---------|
| `Serialize` | Rust → JSON | Yes |
| `Deserialize` | JSON → Rust | Yes |
| `Clone` | Make a copy (explicit `.clone()`) | Yes |
| `Debug` | `{:?}` formatting for println | Yes |
| `Error` | Integrates with `thiserror` / `?` | Manual via thiserror |

---

## Result<T, E>

Rust has no exceptions. Functions return `Result`:

```rust
fn read_file(path: &str) -> Result<String, std::io::Error> {
    std::fs::read_to_string(path)  // Returns Ok(content) or Err(e)
}

// The ? operator: "if Err, return it early; if Ok, unwrap the value"
fn load_config() -> Result<Config, AppError> {
    let json = read_file("config.json")?; // <-- ? here
    let config: Config = serde_json::from_str(&json)?;
    Ok(config)
}
```

Think of `?` as: `match result { Ok(v) => v, Err(e) => return Err(e.into()) }`

---

## thiserror — Custom Error Types

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Workspace not found: {0}")]
    WorkspaceNotFound(String),

    #[error("WSL not available")]
    WslNotAvailable,
}
```

`#[from]` auto-implements `From<std::io::Error> for AppError`, so `?` converts automatically.

`{0}` in error messages refers to the first field of the variant.

**Serialize gotcha (Tauri):** Tauri sends command errors to the frontend as JSON, so `AppError` must be `Serialize`. But `std::io::Error` and `serde_json::Error` (wrapped by the `#[from]` variants) are *not* `Serialize`, so `#[derive(Serialize)]` won't compile. DevGo implements `Serialize` by hand to emit the `Display` string instead:

```rust
impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
```

---

## Ownership & Borrowing Quick Rules

| Pattern | When |
|---------|------|
| Pass `&T` | Function only reads, doesn't store |
| Pass `T` | Function takes ownership (stores it) |
| Pass `&mut T` | Function modifies, doesn't store |
| `.clone()` | Need an independent copy (costs allocation) |
| `Arc<T>` | Multiple owners across threads (Tauri state) |

---

## Tauri-Specific Patterns

### #[tauri::command]

A function annotated with `#[tauri::command]` becomes callable from the frontend via `invoke()`.

```rust
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}!")
}
```

```typescript
// Frontend
import { invoke } from '@tauri-apps/api/core';
const msg = await invoke<string>('greet', { name: 'you' });
```

Rules:
- Arguments and return types must implement `Serialize` / `Deserialize`
- Commands are async by default (they run on a thread pool)
- `Result<T, E>` return types: `Ok(val)` becomes JSON value, `Err(e)` becomes Tauri error

### AppState

```rust
struct AppState {
    config_path: PathBuf,
}
// In main:
app.manage(AppState { config_path });

// In command:
#[tauri::command]
fn get_state(state: tauri::State<'_, AppState>) -> Result<String, String> {
    Ok(state.config_path.to_string_lossy().to_string())
}
```

`tauri::State<'_, T>` is injected automatically. It's like dependency injection for commands.

---

## Process Spawning

```rust
use std::process::Command;

let output = Command::new("git")
    .args(["rev-parse", "--abbrev-ref", "HEAD"])
    .output()?;  // Blocks until process exits

// output.stdout is Vec<u8>, convert to string:
let text = String::from_utf8_lossy(&output.stdout);
```

`?` works because `Command::output()` returns `Result<Output, io::Error>`, and we have `#[from]` on the Io variant.

> **`from_utf8_lossy` is not a universal decoder.** It is correct here because `git` emits UTF-8.
> `wsl.exe` emits **UTF-16LE**, and decoding that with `from_utf8_lossy` produces a string with a NUL
> after every character — which then survives `trim` and registers as a phantom distro. See
> [04 — WSL](../04-wsl.md) §4.2 for the decoder DevGo actually uses. Check what a
> process writes before you decide how to read it.

---

## PathBuf vs Path vs &str

| Type | What | Use |
|------|------|-----|
| `&str` | Borrowed string | Function params for reading |
| `String` | Owned string | Struct fields, return values |
| `Path` | Borrowed path | Like `&str` but OS-aware |
| `PathBuf` | Owned path | Like `String` but OS-aware |

```rust
let p: PathBuf = PathBuf::from("C:\\projects\\hrm");
let s: &Path = p.as_path();     // borrow
let display: &str = s.to_str().unwrap(); // risky: only works for UTF-8
let safe: String = p.to_string_lossy().to_string(); // always works
```
