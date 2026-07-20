//! Comment re-anchoring after a live file change — GitHub semantics: exact
//! match near the old position first, then normalized fuzzy match, else the
//! comment is flagged `outdated` and left at its last-known lines. The
//! matching (find_block) is pure; reanchor_file_comments applies the results
//! to the store (which persists on every update) with the server's store
//! lock held.

use crate::pathsafe::is_safe_path;
use crate::store::{CommentStore, UpdateFields};
use crate::types::ReviewComment;
use std::path::Path;

/// Lines searched on either side of the last-known position before falling
/// back to a whole-file scan — a nearby match is far more likely to be the
/// right one than an identical line somewhere else.
const SEARCH_WINDOW: i64 = 25;

fn normalize_line(line: &str) -> String {
    line.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 1-based start line of `block` inside `file_lines`, window around `hint`
/// first, then the rest. `normalize` toggles exact vs fuzzy comparison.
fn find_block(file_lines: &[&str], block: &[&str], hint: u32, normalize: bool) -> Option<u32> {
    if block.is_empty() || block.len() > file_lines.len() {
        return None;
    }
    let eq = |a: &str, b: &str| {
        if normalize {
            normalize_line(a) == normalize_line(b)
        } else {
            a == b
        }
    };
    let matches_at = |start: usize| (0..block.len()).all(|i| eq(file_lines[start + i], block[i]));

    let max_start = (file_lines.len() - block.len()) as i64;
    let hint_idx = ((hint as i64) - 1).clamp(0, max_start);
    let lo = (hint_idx - SEARCH_WINDOW).max(0);
    let hi = (hint_idx + SEARCH_WINDOW).min(max_start);
    for start in lo..=hi {
        if matches_at(start as usize) {
            return Some(start as u32 + 1);
        }
    }
    for start in 0..=max_start {
        if start >= lo && start <= hi {
            continue;
        }
        if matches_at(start as usize) {
            return Some(start as u32 + 1);
        }
    }
    None
}

/// Remaps every non-resolved, additions-side comment on `file_path` to its
/// new position after a working-tree change. Deletion-side comments are left
/// alone (their content no longer exists by definition); drafts ARE
/// re-anchored but it's the caller's job not to broadcast them. Returns only
/// the comments that actually changed.
pub fn reanchor_file_comments(
    file_path: &str,
    store: &mut CommentStore,
    repo_root: &Path,
) -> Vec<ReviewComment> {
    if !is_safe_path(file_path) {
        return Vec::new();
    }
    // Deleted or unreadable — no lines to match, everything on the file
    // falls through to outdated. Lossy decode (matching read_side and the
    // edit paths): a stray invalid-UTF-8 byte must not blank the whole file
    // and spuriously outdate every comment on it.
    let content = std::fs::read(repo_root.join(file_path))
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default();
    let file_lines: Vec<&str> = if content.is_empty() {
        Vec::new()
    } else {
        content.split('\n').collect()
    };

    let targets: Vec<ReviewComment> = store
        .get_all()
        .into_iter()
        .filter(|c| c.file_path == file_path && c.status != "resolved" && c.side == "additions")
        .collect();
    let mut changed = Vec::new();

    for comment in targets {
        let block: Vec<&str> = comment.line_content.split('\n').collect();
        let start = find_block(&file_lines, &block, comment.line_number, false)
            .or_else(|| find_block(&file_lines, &block, comment.line_number, true));

        match start {
            None => {
                if comment.outdated == Some(true) {
                    continue;
                }
                if let Some(updated) = store.update(
                    &comment.id,
                    UpdateFields {
                        outdated: Some(true),
                        ..Default::default()
                    },
                ) {
                    changed.push(updated);
                }
            }
            Some(start) => {
                let end_line = comment.end_line_or_start();
                let new_end = start + (end_line - comment.line_number);
                if start == comment.line_number
                    && new_end == end_line
                    && comment.outdated != Some(true)
                {
                    continue;
                }
                if let Some(updated) = store.update(
                    &comment.id,
                    UpdateFields {
                        line_number: Some(start),
                        end_line: Some(new_end),
                        outdated: Some(false),
                        ..Default::default()
                    },
                ) {
                    changed.push(updated);
                }
            }
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &[&str] = &[
        "fn main() {",
        "    let a = 1;",
        "    let b = 2;",
        "    let a = 1;",
        "}",
    ];

    #[test]
    fn exact_match_prefers_window_around_hint() {
        // "let a = 1;" appears at lines 2 and 4; the hint decides which wins.
        assert_eq!(find_block(FILE, &["    let a = 1;"], 2, false), Some(2));
        assert_eq!(find_block(FILE, &["    let a = 1;"], 4, false), Some(2)); // window scan is low-to-high
        assert_eq!(find_block(FILE, &["    let b = 2;"], 1, false), Some(3));
    }

    #[test]
    fn fuzzy_match_normalizes_whitespace() {
        assert_eq!(find_block(FILE, &["let  b   =  2;"], 3, false), None);
        assert_eq!(find_block(FILE, &["let  b   =  2;"], 3, true), Some(3));
    }

    #[test]
    fn multi_line_blocks_and_misses() {
        assert_eq!(
            find_block(FILE, &["    let a = 1;", "    let b = 2;"], 1, false),
            Some(2)
        );
        assert_eq!(find_block(FILE, &["gone"], 1, true), None);
        assert_eq!(find_block(FILE, &[], 1, false), None);
        assert_eq!(find_block(&[], &["x"], 1, false), None);
    }
}
