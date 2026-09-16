# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## macOS

`bun run tauri build` gives `src-tauri/target/release/bundle/macos/devgo.app` and a `.dmg` beside it. The app is unsigned: on macOS 15+ open it once, then System Settings › Privacy & Security › *Open Anyway*; older, right-click › Open; if it says "is damaged": `xattr -cr /Applications/devgo.app`. Copied straight out of the build tree it needs none of that on the machine that built it.
