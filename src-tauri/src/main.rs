// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `bun run smoke` asks the build questions through this, windowless
    if let Some(code) = devgo_lib::smoke_probe() {
        std::process::exit(code);
    }
    devgo_lib::run()
}
