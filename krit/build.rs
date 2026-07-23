//! Keep the embedded UI fresh. rust-embed bakes ../dist/client into release
//! binaries at compile time, and a stale dist/ is embedded silently — a
//! cargo install can ship week-old UI with no warning (it happened). This
//! script rebuilds the UI whenever any source under ../src/ui is newer than
//! the built output (or the output is missing), so `cargo install --path`
//! and `cargo build` are always self-contained.
//!
//! Escape hatch: KRIT_SKIP_UI_BUILD=1 skips everything (CI jobs that build
//! the UI separately, or environments without pnpm).

use std::path::Path;
use std::process::Command;
use std::time::SystemTime;

fn newest_mtime(dir: &Path) -> Option<SystemTime> {
    let mut newest: Option<SystemTime> = None;
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let candidate = if path.is_dir() {
            newest_mtime(&path)
        } else {
            entry.metadata().ok().and_then(|m| m.modified().ok())
        };
        if let Some(t) = candidate
            && newest.is_none_or(|n| t > n)
        {
            newest = Some(t);
        }
    }
    newest
}

fn main() {
    // Re-run on any UI-affecting change, not just build.rs edits.
    println!("cargo:rerun-if-changed=../src/ui");
    println!("cargo:rerun-if-changed=../vite.config.ts");
    println!("cargo:rerun-if-changed=../package.json");
    println!("cargo:rerun-if-env-changed=KRIT_SKIP_UI_BUILD");

    if std::env::var_os("KRIT_SKIP_UI_BUILD").is_some() {
        return;
    }

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let repo_root = Path::new(&manifest_dir)
        .parent()
        .expect("crate has a parent dir")
        .to_path_buf();
    let dist = repo_root.join("dist/client");
    let ui_src = repo_root.join("src/ui");

    let stale = match (newest_mtime(&ui_src), newest_mtime(&dist)) {
        (_, None) => true, // no dist at all — fresh clone
        (Some(src), Some(built)) => src > built,
        (None, Some(_)) => false, // no UI sources? nothing we can do
    };
    if !stale {
        return;
    }

    if !repo_root.join("node_modules").exists() {
        run(&repo_root, "pnpm", &["install", "--frozen-lockfile"]);
    }
    run(&repo_root, "pnpm", &["exec", "vite", "build"]);
}

fn run(cwd: &Path, cmd: &str, args: &[&str]) {
    let status = Command::new(cmd).args(args).current_dir(cwd).status();
    match status {
        Ok(s) if s.success() => {}
        Ok(s) => panic!(
            "`{cmd} {}` failed with {s} — the embedded UI would be stale. Set KRIT_SKIP_UI_BUILD=1 to build anyway.",
            args.join(" ")
        ),
        Err(e) => panic!(
            "could not run `{cmd}` ({e}) — is pnpm installed? The UI at dist/client is stale or missing. Build it with `pnpm exec vite build`, or set KRIT_SKIP_UI_BUILD=1 to embed what's there."
        ),
    }
}
