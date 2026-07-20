//! Direct-manipulation edits: splice a character range out of (or back into)
//! a working-tree file. 1-based lines, 0-based columns, end_column exclusive
//! — the same convention as the schema v3 comment fields.

use crate::git::write_working_tree_file;
use crate::pathsafe::is_safe_path;
use std::path::Path;

pub struct DeleteRange {
    pub file_path: String,
    pub start_line: u32,
    pub start_column: u32,
    pub end_line: u32,
    pub end_column: u32,
}

/// Byte offset for a JS UTF-16 code-unit column into `line`. Columns arrive
/// from the browser, whose string indexing (and v1's String.slice) counts
/// UTF-16 units — byte-slicing with them panics or corrupts on any non-ASCII
/// text before the position. None when the column is past the end or splits
/// a surrogate pair; callers treat that as "range no longer matches".
fn utf16_col_to_byte(line: &str, col: usize) -> Option<usize> {
    let mut units = 0;
    for (byte_idx, ch) in line.char_indices() {
        if units == col {
            return Some(byte_idx);
        }
        units += ch.len_utf16();
        if units > col {
            return None;
        }
    }
    (units == col).then_some(line.len())
}

/// Read as lossy UTF-8, matching what the server serves the browser — offsets
/// computed against the lossily-decoded text must splice the same text.
fn read_lossy(path: &Path) -> Option<String> {
    std::fs::read(path)
        .ok()
        .map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// Removes the range and writes the file back. Returns the deleted text (for
/// the undo buffer / user-edit event), or None if the path is unsafe, the
/// file is unreadable, or the range no longer fits the file on disk — the
/// range was computed against whatever the browser last rendered, which may
/// have drifted by the time the request lands.
pub fn splice_delete_range(repo_root: &Path, range: &DeleteRange) -> Option<String> {
    if !is_safe_path(&range.file_path) {
        return None;
    }
    let content = read_lossy(&repo_root.join(&range.file_path))?;
    let mut lines: Vec<String> = content.split('\n').map(|s| s.to_string()).collect();

    let start_idx = range.start_line.checked_sub(1)? as usize;
    let end_idx = range.end_line.checked_sub(1)? as usize;
    if end_idx >= lines.len() || start_idx > end_idx {
        return None;
    }
    let first_line = lines[start_idx].clone();
    let last_line = lines[end_idx].clone();
    let sc = utf16_col_to_byte(&first_line, range.start_column as usize)?;
    let ec = utf16_col_to_byte(&last_line, range.end_column as usize)?;
    if start_idx == end_idx && sc > ec {
        return None;
    }

    let (deleted, merged) = if start_idx == end_idx {
        (
            first_line[sc..ec].to_string(),
            format!("{}{}", &first_line[..sc], &first_line[ec..]),
        )
    } else {
        let mut deleted = vec![first_line[sc..].to_string()];
        deleted.extend(lines[start_idx + 1..end_idx].iter().cloned());
        deleted.push(last_line[..ec].to_string());
        (
            deleted.join("\n"),
            format!("{}{}", &first_line[..sc], &last_line[ec..]),
        )
    };

    lines.splice(start_idx..=end_idx, [merged]);
    if !write_working_tree_file(repo_root, &range.file_path, &lines.join("\n")) {
        return None;
    }
    Some(deleted)
}

/// Inverse of splice_delete_range: re-inserts `text` at its removal point.
/// Only correct if nothing else touched that position since — accepted
/// tradeoff for a simple undo buffer (no OT reconciliation).
pub fn splice_insert_text(
    repo_root: &Path,
    file_path: &str,
    start_line: u32,
    start_column: u32,
    text: &str,
) -> bool {
    if !is_safe_path(file_path) {
        return false;
    }
    let Some(content) = read_lossy(&repo_root.join(file_path)) else {
        return false;
    };
    let mut lines: Vec<String> = content.split('\n').map(|s| s.to_string()).collect();
    let Some(idx) = start_line.checked_sub(1).map(|n| n as usize) else {
        return false;
    };
    if idx >= lines.len() {
        return false;
    }
    let line = lines[idx].clone();
    let Some(col) = utf16_col_to_byte(&line, start_column as usize) else {
        return false;
    };

    let inserted: Vec<&str> = text.split('\n').collect();
    if inserted.len() == 1 {
        lines[idx] = format!("{}{}{}", &line[..col], text, &line[col..]);
    } else {
        let mut new_lines: Vec<String> = inserted.iter().map(|s| s.to_string()).collect();
        new_lines[0] = format!("{}{}", &line[..col], new_lines[0]);
        let last = new_lines.len() - 1;
        new_lines[last] = format!("{}{}", new_lines[last], &line[col..]);
        lines.splice(idx..=idx, new_lines);
    }
    write_working_tree_file(repo_root, file_path, &lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_cols_match_ascii_bytes() {
        assert_eq!(utf16_col_to_byte("hello", 0), Some(0));
        assert_eq!(utf16_col_to_byte("hello", 3), Some(3));
        assert_eq!(utf16_col_to_byte("hello", 5), Some(5));
        assert_eq!(utf16_col_to_byte("hello", 6), None);
        assert_eq!(utf16_col_to_byte("", 0), Some(0));
    }

    #[test]
    fn utf16_cols_diverge_from_bytes_on_multibyte() {
        // "café-menu": é is 1 UTF-16 unit but 2 UTF-8 bytes.
        let line = "café-menu";
        assert_eq!(utf16_col_to_byte(line, 4), Some(5)); // the '-' after é
        assert_eq!(&line[utf16_col_to_byte(line, 4).unwrap()..], "-menu");
        // 💚 is 2 UTF-16 units (surrogate pair), 4 UTF-8 bytes.
        let emoji = "a💚b";
        assert_eq!(utf16_col_to_byte(emoji, 1), Some(1));
        assert_eq!(utf16_col_to_byte(emoji, 3), Some(5));
        assert_eq!(utf16_col_to_byte(emoji, 2), None); // splits the pair
        assert_eq!(utf16_col_to_byte(emoji, 4), Some(6));
    }

    fn temp_repo(name: &str, contents: &str) -> (std::path::PathBuf, String) {
        let dir = std::env::temp_dir().join(format!("krit-edits-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), contents).unwrap();
        (dir, name.to_string())
    }

    #[test]
    fn delete_range_with_non_ascii_prefix() {
        // Regression: UTF-16 columns from the browser used to be treated as
        // byte offsets, panicking or corrupting on lines like this one.
        let (root, file) = temp_repo("non-ascii.txt", "let s = \"café-menu\";\nnext");
        // Delete `menu` — UTF-16 cols 14..18 on line 1.
        let deleted = splice_delete_range(
            &root,
            &DeleteRange {
                file_path: file.clone(),
                start_line: 1,
                start_column: 14,
                end_line: 1,
                end_column: 18,
            },
        );
        assert_eq!(deleted.as_deref(), Some("menu"));
        let after = std::fs::read_to_string(root.join(&file)).unwrap();
        assert_eq!(after, "let s = \"café-\";\nnext");
        // Undo restores byte-exactly.
        assert!(splice_insert_text(&root, &file, 1, 14, "menu"));
        let restored = std::fs::read_to_string(root.join(&file)).unwrap();
        assert_eq!(restored, "let s = \"café-menu\";\nnext");
    }

    #[test]
    fn delete_across_multiple_lines() {
        // Delete from mid-line 1 through mid-line 3, stitching the ends.
        let (root, file) = temp_repo("multi-del.txt", "aaXbb\ncccc\ndYeee\nkeep");
        let deleted = splice_delete_range(
            &root,
            &DeleteRange {
                file_path: file.clone(),
                start_line: 1,
                start_column: 2, // after "aa"
                end_line: 3,
                end_column: 1, // before "Yeee"
            },
        );
        assert_eq!(deleted.as_deref(), Some("Xbb\ncccc\nd"));
        let after = std::fs::read_to_string(root.join(&file)).unwrap();
        assert_eq!(after, "aaYeee\nkeep");
    }

    #[test]
    fn insert_multiline_text_stitches_ends() {
        let (root, file) = temp_repo("multi-ins.txt", "aabb\nkeep");
        // Insert "X\nY\nZ" between "aa" and "bb" on line 1.
        assert!(splice_insert_text(&root, &file, 1, 2, "X\nY\nZ"));
        let after = std::fs::read_to_string(root.join(&file)).unwrap();
        assert_eq!(after, "aaX\nY\nZbb\nkeep");
    }

    #[test]
    fn delete_then_undo_round_trips_multiline() {
        let (root, file) = temp_repo("roundtrip.txt", "one\ntwo\nthree");
        let deleted = splice_delete_range(
            &root,
            &DeleteRange {
                file_path: file.clone(),
                start_line: 1,
                start_column: 3,
                end_line: 3,
                end_column: 0,
            },
        )
        .unwrap();
        assert_eq!(deleted, "\ntwo\n");
        assert_eq!(
            std::fs::read_to_string(root.join(&file)).unwrap(),
            "onethree"
        );
        assert!(splice_insert_text(&root, &file, 1, 3, &deleted));
        assert_eq!(
            std::fs::read_to_string(root.join(&file)).unwrap(),
            "one\ntwo\nthree"
        );
    }

    #[test]
    fn out_of_range_columns_refuse_rather_than_panic() {
        let (root, file) = temp_repo("short.txt", "ab");
        let result = splice_delete_range(
            &root,
            &DeleteRange {
                file_path: file,
                start_line: 1,
                start_column: 1,
                end_line: 1,
                end_column: 99,
            },
        );
        assert!(result.is_none());
    }
}
