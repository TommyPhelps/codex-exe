//! Where the optional bridges live, and the reversible openmw.cfg edit.

/// MWSE bridge script, relative to the Morrowind install folder.
pub const MWSE_SCRIPT_REL: &str = "Data Files/MWSE/mods/codex/bridge/main.lua";
/// Folder removed on uninstall (only our own folder).
pub const MWSE_MOD_DIR_REL: &str = "Data Files/MWSE/mods/codex/bridge";
/// Status file written by the MWSE bridge.
pub const MWSE_STATUS_REL: &str = "Data Files/MWSE/codex_live.json";
/// Presence of this folder means MWSE is installed.
pub const MWSE_DIR_REL: &str = "Data Files/MWSE";

pub const OPENMW_SCRIPTS_FILE: &str = "codex_bridge.omwscripts";
pub const OPENMW_SCRIPT_REL: &str = "scripts/codex_bridge/player.lua";
pub const CFG_MARKER: &str = "# CODEX.EXE bridge (safe to remove)";

fn quote_openmw(path: &str) -> String {
    // OpenMW escapes " and & inside quoted paths with &.
    let mut s = String::from("\"");
    for c in path.chars() {
        if c == '"' || c == '&' {
            s.push('&');
        }
        s.push(c);
    }
    s.push('"');
    s
}

fn newline_of(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

/// True when openmw.cfg already enables the bridge content file.
pub fn openmw_cfg_has_bridge(text: &str) -> bool {
    text.lines().any(|l| {
        let t = l.trim();
        t.starts_with("content=") && t["content=".len()..].trim().eq_ignore_ascii_case(OPENMW_SCRIPTS_FILE)
    })
}

/// Adds the bridge data folder and content line. Idempotent. Keeps every
/// existing line untouched and uses the file's own line endings.
pub fn add_to_openmw_cfg(text: &str, bridge_dir: &str) -> String {
    if openmw_cfg_has_bridge(text) {
        return text.to_string();
    }
    let nl = newline_of(text);
    let mut out = text.to_string();
    if !out.is_empty() && !out.ends_with('\n') {
        out.push_str(nl);
    }
    out.push_str(CFG_MARKER);
    out.push_str(nl);
    out.push_str("data=");
    out.push_str(&quote_openmw(bridge_dir));
    out.push_str(nl);
    out.push_str("content=");
    out.push_str(OPENMW_SCRIPTS_FILE);
    out.push_str(nl);
    out
}

/// Removes exactly what `add_to_openmw_cfg` added (marker, our data line,
/// our content line). Other lines are kept byte for byte.
pub fn remove_from_openmw_cfg(text: &str, bridge_dir: &str) -> String {
    let our_data = format!("data={}", quote_openmw(bridge_dir));
    let nl = newline_of(text);
    let mut kept: Vec<&str> = Vec::new();
    for line in text.split('\n') {
        let t = line.trim_end_matches('\r').trim();
        let is_content = t.starts_with("content=") && t["content=".len()..].trim().eq_ignore_ascii_case(OPENMW_SCRIPTS_FILE);
        if t == CFG_MARKER || t == our_data || is_content {
            continue;
        }
        kept.push(line.trim_end_matches('\r'));
    }
    let mut out = kept.join(nl);
    if text.ends_with('\n') && !out.ends_with('\n') && !out.is_empty() {
        out.push_str(nl);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_and_remove_are_reversible() {
        let original = "data=\"C:/Games/Morrowind/Data Files\"\r\ncontent=Morrowind.esm\r\n";
        let dir = "C:/Users/Tommy/Documents/My Games/OpenMW/CODEX Bridge";
        let added = add_to_openmw_cfg(original, dir);
        assert!(openmw_cfg_has_bridge(&added));
        assert!(added.contains("data=\"C:/Users/Tommy/Documents/My Games/OpenMW/CODEX Bridge\"\r\n"));
        assert!(added.ends_with("content=codex_bridge.omwscripts\r\n"));
        assert_eq!(add_to_openmw_cfg(&added, dir), added);
        assert_eq!(remove_from_openmw_cfg(&added, dir), original);
    }

    #[test]
    fn handles_files_without_trailing_newline_and_special_chars() {
        let original = "content=Morrowind.esm";
        let dir = "D:/Mods & More/\"x\"";
        let added = add_to_openmw_cfg(original, dir);
        assert!(added.contains("data=\"D:/Mods && More/&\"x&\"\"\n"));
        assert_eq!(remove_from_openmw_cfg(&added, dir), "content=Morrowind.esm\n");
        // A user's own unrelated lines are never removed.
        let mixed = format!("{added}data=\"E:/Other\"\ncontent=Other.esp\n");
        let cleaned = remove_from_openmw_cfg(&mixed, dir);
        assert!(cleaned.contains("data=\"E:/Other\""));
        assert!(cleaned.contains("content=Other.esp"));
        assert!(!openmw_cfg_has_bridge(&cleaned));
    }
}
