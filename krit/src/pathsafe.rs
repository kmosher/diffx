//! Path traversal defense, shared by every handler that touches the repo
//! from a client-supplied relative path.

fn hex_val(b: u8) -> Option<u8> {
    (b as char).to_digit(16).map(|v| v as u8)
}

/// Percent-decode without pulling in a dep; invalid sequences pass through
/// verbatim (matching decodeURIComponent-with-fallback in v1). Works on raw
/// bytes throughout — slicing the &str here would panic on a multibyte
/// character right after a '%' (e.g. a file named `50%割引.txt`).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2]))
        {
            out.push(hi * 16 + lo);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// True when `relative_path` cannot escape `base`: no `..`, no NUL, not
/// absolute (unix or windows-drive), after percent-decoding and backslash
/// normalization. Purely lexical — the file need not exist.
pub fn is_safe_path(relative_path: &str) -> bool {
    let normalized = percent_decode(relative_path).replace('\\', "/");
    if normalized.contains("..") || normalized.contains('\0') {
        return false;
    }
    if normalized.starts_with('/') {
        return false;
    }
    // Windows drive letters ("C:/...") — not expected on this platform but
    // cheap to reject.
    let mut chars = normalized.chars();
    if let (Some(c), Some(':')) = (chars.next(), chars.next())
        && c.is_ascii_alphabetic()
    {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_valid_escapes() {
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("%2e%2e"), "..");
    }

    #[test]
    fn invalid_escapes_pass_through() {
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
        assert_eq!(percent_decode("%2"), "%2");
    }

    #[test]
    fn multibyte_after_percent_does_not_panic() {
        // Regression: byte-indexing the &str here used to panic mid-char.
        assert_eq!(percent_decode("50%割引.txt"), "50%割引.txt");
        assert_eq!(percent_decode("%é"), "%é");
        assert_eq!(percent_decode("%a漢"), "%a漢");
        assert!(is_safe_path("docs/50%割引.txt"));
    }

    #[test]
    fn rejects_traversal_and_absolute() {
        assert!(!is_safe_path("../etc/passwd"));
        assert!(!is_safe_path("a/../../b"));
        assert!(!is_safe_path("%2e%2e/secret"));
        assert!(!is_safe_path("/etc/passwd"));
        assert!(!is_safe_path("C:/windows"));
        assert!(!is_safe_path("a\\..\\b"));
        assert!(!is_safe_path("nul\0byte"));
    }

    #[test]
    fn accepts_ordinary_repo_paths() {
        assert!(is_safe_path("src/main.rs"));
        assert!(is_safe_path("a b/c-d_e.txt"));
        assert!(is_safe_path("docs/räksmörgås.md"));
    }
}
