//! Everything git: krit shells out to the real `git` binary rather than
//! linking a git library — exact diff semantics (rename detection, diff
//! algorithms, textconv) for free, and it's the approach v1 proved.

use crate::pathsafe::is_safe_path;
use std::path::Path;
use std::process::Command;

/// Sentinels for the two non-ref content sources served alongside named git
/// refs for hunk expansion.
pub const WORKING_TREE_REF: &str = "WORKING_TREE";
pub const INDEX_REF: &str = "INDEX";

// Force standard unified diff regardless of user's git config
// (diff.external = difftastic, color.ui = always, etc).
const DIFF_FLAGS: [&str; 2] = ["--no-ext-diff", "--no-color"];

/// Error carries git's own stderr — the diff paths surface it to the client
/// so a typo'd ref reads as an error, not as an empty "no changes" review.
fn git_output(args: &[&str]) -> Result<Vec<u8>, String> {
    match Command::new("git").args(args).output() {
        Ok(out) if out.status.success() => Ok(out.stdout),
        Ok(out) => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
        Err(err) => Err(format!("failed to run git: {err}")),
    }
}

fn git_stdout(args: &[&str]) -> Option<Vec<u8>> {
    git_output(args).ok()
}

fn git_string(args: &[&str]) -> Option<String> {
    git_stdout(args).map(|b| String::from_utf8_lossy(&b).into_owned())
}

pub fn is_git_repo() -> bool {
    git_string(&["rev-parse", "--is-inside-work-tree"]).is_some()
}

pub fn repo_root() -> Option<String> {
    git_string(&["rev-parse", "--show-toplevel"]).map(|s| s.trim().to_string())
}

pub fn repo_name() -> String {
    repo_root()
        .as_deref()
        .and_then(|r| Path::new(r).file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub fn branch_name() -> String {
    git_string(&["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

pub fn custom_git_diff(args: &[String]) -> Result<String, String> {
    let mut cmd_args: Vec<&str> = vec!["diff"];
    cmd_args.extend(DIFF_FLAGS);
    cmd_args.extend(args.iter().map(|s| s.as_str()));
    git_output(&cmd_args).map(|b| String::from_utf8_lossy(&b).into_owned())
}

pub fn git_diff(staged: bool, untracked: bool, root: &Path) -> Result<String, String> {
    let mut parts: Vec<String> = Vec::new();

    let unstaged = git_output(&["diff", DIFF_FLAGS[0], DIFF_FLAGS[1]])
        .map(|b| String::from_utf8_lossy(&b).into_owned())?;
    if !unstaged.is_empty() {
        parts.push(unstaged);
    }
    if staged {
        let s = git_output(&["diff", DIFF_FLAGS[0], DIFF_FLAGS[1], "--staged"])
            .map(|b| String::from_utf8_lossy(&b).into_owned())?;
        if !s.is_empty() {
            parts.push(s);
        }
    }
    if untracked {
        let u = untracked_files_diff(root);
        if !u.is_empty() {
            parts.push(u);
        }
    }
    Ok(parts.join("\n"))
}

pub fn untracked_file_paths(root: &Path) -> Vec<String> {
    // Run from the repo root so paths come back root-relative regardless of
    // the server's launch cwd — from a subdir, cwd-relative output silently
    // dropped or mis-pathed untracked files (a bug v1 shared).
    let Ok(out) = Command::new("git")
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(root)
        .output()
    else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .lines()
        .map(|l| l.to_string())
        .collect()
}

/// NUL byte in the first 8KB — git's own text/binary heuristic.
pub fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8192).any(|&b| b == 0)
}

/// One untracked file's synthesized new-file patch. Byte shape (headers,
/// sentinel index line, `@@` count, `+`-prefixed body) matches v1 exactly —
/// the UI parses this, so it's the frozen contract. `unreadable` files render
/// as the binary placeholder (v1's isBinaryFile reported true on read error).
fn synthesize_untracked_patch(file: &str, bytes: &[u8], unreadable: bool) -> String {
    if unreadable || looks_binary(bytes) {
        return format!(
            "diff --git a/{file} b/{file}\nnew file mode 100644\nindex 0000000..0000001\nBinary files /dev/null and b/{file} differ"
        );
    }
    let content = String::from_utf8_lossy(bytes);
    let lines: Vec<&str> = content.split('\n').collect();
    let mut patch = format!(
        "diff --git a/{file} b/{file}\nnew file mode 100644\nindex 0000000..0000001\n--- /dev/null\n+++ b/{file}\n@@ -0,0 +1,{} @@",
        lines.len()
    );
    for l in &lines {
        patch.push('\n');
        patch.push('+');
        patch.push_str(l);
    }
    patch
}

// Untracked files have no git diff; synthesize a new-file patch per file so
// they render like any other addition. The whole block gets a leading '\n'
// so it joins onto the tracked-diff parts — matches v1 byte-for-byte.
fn untracked_files_diff(root: &Path) -> String {
    let files = untracked_file_paths(root);
    if files.is_empty() {
        return String::new();
    }
    let mut patches: Vec<String> = Vec::new();
    for file in files {
        // An unreadable file must not vanish from the patch while still
        // listed in untrackedFiles — it renders as the binary placeholder.
        let (bytes, unreadable) = match std::fs::read(root.join(&file)) {
            Ok(b) => (b, false),
            Err(_) => (Vec::new(), true),
        };
        patches.push(synthesize_untracked_patch(&file, &bytes, unreadable));
    }
    if patches.is_empty() {
        String::new()
    } else {
        format!("\n{}", patches.join("\n"))
    }
}

/// File contents at a ref/sentinel, for hunk-context expansion. No size cap
/// here — v1's 50MB maxBuffer was Node exec plumbing, not policy; the 5MB
/// text cap that protects the /api/diff payload lives in server.rs.
pub fn file_content_at_ref(root: &Path, file_path: &str, git_ref: &str) -> Option<Vec<u8>> {
    if !is_safe_path(file_path) {
        return None;
    }
    if git_ref == WORKING_TREE_REF {
        return std::fs::read(root.join(file_path)).ok();
    }
    let spec = if git_ref == INDEX_REF {
        format!(":{file_path}")
    } else {
        format!("{git_ref}:{file_path}")
    };
    git_stdout(&["show", &spec])
}

/// Legacy two-version content fetch for GET /api/file-content:
/// new = working tree, old = HEAD.
pub fn file_content(root: &Path, file_path: &str, version: &str) -> Option<Vec<u8>> {
    if !is_safe_path(file_path) {
        return None;
    }
    if version == "new" {
        return std::fs::read(root.join(file_path)).ok();
    }
    git_stdout(&["show", &format!("HEAD:{file_path}")])
}

pub fn write_working_tree_file(root: &Path, file_path: &str, contents: &str) -> bool {
    if !is_safe_path(file_path) {
        return false;
    }
    std::fs::write(root.join(file_path), contents).is_ok()
}

/// Resolve a krit invocation to the (old, new) refs its patch was computed
/// against, mirroring `git diff`'s own semantics for each arg shape — see the
/// table in v1's git.ts. Wrong answers degrade to "no hunk expansion", not
/// corruption.
pub fn resolve_diff_refs(custom_args: Option<&[String]>) -> (String, String) {
    let args = custom_args.unwrap_or(&[]);
    let mut positionals: Vec<&str> = Vec::new();
    let mut staged = false;
    let mut past_dash_dash = false;
    for a in args {
        if past_dash_dash {
            continue; // pathspecs, not refs
        }
        if a == "--" {
            past_dash_dash = true;
            continue;
        }
        if a == "--staged" || a == "--cached" {
            staged = true;
            continue;
        }
        if a.starts_with('-') {
            continue; // other git-diff flags
        }
        positionals.push(a);
    }
    if staged {
        return ("HEAD".into(), INDEX_REF.into());
    }
    match positionals.len() {
        0 => ("HEAD".into(), WORKING_TREE_REF.into()),
        1 => {
            let a = positionals[0];
            if let Some((x, y)) = a.split_once("...") {
                let head = if y.is_empty() { "HEAD" } else { y };
                let merge_base = git_string(&["merge-base", x, head])
                    .map(|s| s.trim().to_string())
                    .unwrap_or_else(|| x.to_string());
                (merge_base, head.to_string())
            } else if let Some((x, y)) = a.split_once("..") {
                let head = if y.is_empty() { "HEAD" } else { y };
                (x.to_string(), head.to_string())
            } else {
                (a.to_string(), WORKING_TREE_REF.into())
            }
        }
        // 2+ positionals: first two are the refs (git's own behavior; extras
        // would be pathspecs).
        _ => (positionals[0].to_string(), positionals[1].to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refs(args: &[&str]) -> (String, String) {
        let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        resolve_diff_refs(Some(&owned))
    }

    // Pins the arg-shape → refs table (minus the `...` merge-base row, which
    // shells out). Matches v1's git.ts table.
    #[test]
    fn resolve_refs_table() {
        assert_eq!(
            resolve_diff_refs(None),
            ("HEAD".into(), WORKING_TREE_REF.into())
        );
        assert_eq!(refs(&[]), ("HEAD".into(), WORKING_TREE_REF.into()));
        assert_eq!(refs(&["--staged"]), ("HEAD".into(), INDEX_REF.into()));
        assert_eq!(refs(&["--cached"]), ("HEAD".into(), INDEX_REF.into()));
        assert_eq!(
            refs(&["HEAD~3"]),
            ("HEAD~3".into(), WORKING_TREE_REF.into())
        );
        assert_eq!(refs(&["main..feature"]), ("main".into(), "feature".into()));
        assert_eq!(refs(&["main.."]), ("main".into(), "HEAD".into()));
        assert_eq!(refs(&["a", "b"]), ("a".into(), "b".into()));
        assert_eq!(refs(&["a", "b", "path/spec"]), ("a".into(), "b".into()));
        // Flags are skipped; everything after `--` is pathspec, not refs.
        assert_eq!(
            refs(&["-M", "HEAD~1"]),
            ("HEAD~1".into(), WORKING_TREE_REF.into())
        );
        assert_eq!(
            refs(&["--", "src/"]),
            ("HEAD".into(), WORKING_TREE_REF.into())
        );
        assert_eq!(
            refs(&["HEAD~2", "--", "src/"]),
            ("HEAD~2".into(), WORKING_TREE_REF.into())
        );
    }

    #[test]
    fn binary_heuristic() {
        assert!(!looks_binary(b"plain text\n"));
        assert!(looks_binary(b"has\0nul"));
        assert!(!looks_binary(&[]));
    }

    // Golden byte-shape for the synthesized untracked-file patch — this is the
    // frozen v1 wire contract the UI parses. A whitespace or header change
    // here breaks rendering with no other test failing.
    #[test]
    fn untracked_patch_text_golden() {
        assert_eq!(
            synthesize_untracked_patch("src/new.rs", b"line1\nline2", false),
            "diff --git a/src/new.rs b/src/new.rs\n\
             new file mode 100644\n\
             index 0000000..0000001\n\
             --- /dev/null\n\
             +++ b/src/new.rs\n\
             @@ -0,0 +1,2 @@\n\
             +line1\n\
             +line2"
        );
    }

    #[test]
    fn untracked_patch_trailing_newline_counts_as_line() {
        // "a\n" splits into ["a", ""] → 2 lines, matching git/v1.
        assert_eq!(
            synthesize_untracked_patch("f", b"a\n", false),
            "diff --git a/f b/f\n\
             new file mode 100644\n\
             index 0000000..0000001\n\
             --- /dev/null\n\
             +++ b/f\n\
             @@ -0,0 +1,2 @@\n\
             +a\n\
             +"
        );
    }

    #[test]
    fn untracked_patch_binary_and_unreadable_use_placeholder() {
        let expected = "diff --git a/x b/x\n\
             new file mode 100644\n\
             index 0000000..0000001\n\
             Binary files /dev/null and b/x differ";
        assert_eq!(synthesize_untracked_patch("x", b"\0\x01", false), expected);
        // Unreadable (empty bytes + flag) still renders, doesn't vanish.
        assert_eq!(synthesize_untracked_patch("x", b"", true), expected);
    }
}
