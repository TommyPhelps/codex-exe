//! Steam library discovery from libraryfolders.vdf (read-only).

/// Library folder paths listed in libraryfolders.vdf.
pub fn library_paths(vdf: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in vdf.lines() {
        let t = line.trim();
        let mut parts = t.split('"').filter(|s| !s.trim().is_empty());
        let (Some(k), Some(v)) = (parts.next(), parts.next()) else { continue };
        if k.eq_ignore_ascii_case("path") {
            let p = v.replace("\\\\", "\\");
            if !out.contains(&p) {
                out.push(p);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_library_paths() {
        let vdf = r#""libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"label"		""
		"apps" { "22320" "123" }
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}"#;
        assert_eq!(library_paths(vdf), vec!["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]);
    }
}
