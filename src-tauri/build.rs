// the git revision a binary was built from, compiled in as an env var.
// the version in tauri.conf.json is the only identity a built DevGo
// carried, and it is a hand-edited number that stays put across dozens of
// commits - so an installed copy could not be traced back to a revision.
//
// no crate for it: `git rev-parse` through Command is the whole job, and a
// build-dependency that shells out to the same binary is a dependency for
// nothing. an absent git, or a source tarball with no .git, is not a build
// failure - it yields "unknown", because a tarball build is a legitimate
// build and the sha is a convenience, not a requirement.
//
// HEAD covers a commit and a branch switch (it is rewritten by both);
// refs is the packed/loose ref whose *content* moves under a HEAD that
// does not, which is what a commit on the current branch looks like.
fn git_sha() -> String {
    std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

fn main() {
    println!("cargo:rustc-env=DEVGO_GIT_SHA={}", git_sha());
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs");
    tauri_build::build()
}
