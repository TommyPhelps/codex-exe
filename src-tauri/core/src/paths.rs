//! Path safety helpers. CODEX.EXE only writes inside its own data folder and,
//! when the player installs a bridge, inside the specific bridge folders.

use std::path::{Component, Path, PathBuf};

/// Turns any string into a safe single file name.
pub fn sanitize_name(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect();
    s = s.trim().trim_matches('.').to_string();
    if s.is_empty() {
        s = "file".into();
    }
    let upper = s.to_ascii_uppercase();
    let stem = upper.split('.').next().unwrap_or("");
    if ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3"].contains(&stem) {
        s = format!("_{s}");
    }
    s.chars().take(120).collect()
}

/// Joins a relative path onto a root, refusing absolute paths and `..`.
pub fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel_path = Path::new(rel);
    let mut out = root.to_path_buf();
    for c in rel_path.components() {
        match c {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if out == root {
        return None;
    }
    Some(out)
}

/// Lower-case extension check for image files the app accepts.
pub fn is_image(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp"].iter().any(|e| l.ends_with(e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes() {
        assert_eq!(sanitize_name("a/b:c*?.png"), "a_b_c__.png");
        assert_eq!(sanitize_name("  ..  "), "file");
        assert_eq!(sanitize_name("con.txt"), "_con.txt");
        assert_eq!(sanitize_name(&"x".repeat(300)).len(), 120);
    }

    #[test]
    fn safe_join_refuses_escapes() {
        let root = Path::new("/data");
        assert_eq!(safe_join(root, "attachments/a.png"), Some(PathBuf::from("/data/attachments/a.png")));
        assert_eq!(safe_join(root, "../etc/passwd"), None);
        assert_eq!(safe_join(root, "/etc/passwd"), None);
        assert_eq!(safe_join(root, ""), None);
        assert_eq!(safe_join(root, "a/../../b"), None);
        assert!(is_image("Shot 1.BMP"));
        assert!(!is_image("evil.exe"));
    }
}
