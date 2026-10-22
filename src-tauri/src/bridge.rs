//! Installs and removes the optional Morrowind bridges.
//!
//! The scripts are compiled into the app (from ../bridge) and copied only to:
//!  - <Morrowind>\Data Files\MWSE\mods\codex\bridge\main.lua   (MWSE)
//!  - a folder the player chooses, plus two lines in openmw.cfg (OpenMW),
//!    with a backup of openmw.cfg saved first.
//! Uninstalling removes exactly those files and lines. Save games are never
//! opened, read or written.

use codex_core::bridgefiles as bf;
use codex_core::paths::safe_join;
use serde::Serialize;
use std::path::{Path, PathBuf};

const MWSE_SCRIPT: &str = include_str!("../../bridge/mwse/codex/bridge/main.lua");
const OPENMW_SCRIPTS: &str = include_str!("../../bridge/openmw/codex_bridge.omwscripts");
const OPENMW_PLAYER: &str = include_str!("../../bridge/openmw/scripts/codex_bridge/player.lua");

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MwseStatus {
    game_dir_ok: bool,
    mwse_installed: bool,
    bridge_installed: bool,
    bridge_current: bool,
    status_file: String,
    script_path: String,
    morrowind_ini: String,
}

fn rel(game_dir: &str, r: &str) -> Result<PathBuf, String> {
    safe_join(Path::new(game_dir), r).ok_or_else(|| "Invalid game folder.".to_string())
}

#[tauri::command]
pub async fn mwse_status(game_dir: String) -> Result<MwseStatus, String> {
    let root = PathBuf::from(&game_dir);
    let script = rel(&game_dir, bf::MWSE_SCRIPT_REL)?;
    let installed = script.is_file();
    let current = installed && std::fs::read_to_string(&script).map(|s| s == MWSE_SCRIPT).unwrap_or(false);
    Ok(MwseStatus {
        game_dir_ok: root.join("Data Files").is_dir(),
        mwse_installed: rel(&game_dir, bf::MWSE_DIR_REL)?.is_dir(),
        bridge_installed: installed,
        bridge_current: current,
        status_file: rel(&game_dir, bf::MWSE_STATUS_REL)?.to_string_lossy().into_owned(),
        script_path: script.to_string_lossy().into_owned(),
        morrowind_ini: root.join("Morrowind.ini").to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn install_mwse_bridge(game_dir: String) -> Result<Vec<String>, String> {
    if !Path::new(&game_dir).join("Data Files").is_dir() {
        return Err("That folder does not contain \"Data Files\". Choose the Morrowind install folder.".into());
    }
    if !rel(&game_dir, bf::MWSE_DIR_REL)?.is_dir() {
        return Err("MWSE does not appear to be installed (no Data Files\\MWSE folder). Install MWSE first, or use manual mode.".into());
    }
    let script = rel(&game_dir, bf::MWSE_SCRIPT_REL)?;
    if let Some(parent) = script.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    }
    std::fs::write(&script, MWSE_SCRIPT).map_err(|e| format!("Could not write {}: {e}", script.display()))?;
    Ok(vec![script.to_string_lossy().into_owned()])
}

#[tauri::command]
pub async fn uninstall_mwse_bridge(game_dir: String) -> Result<Vec<String>, String> {
    let mut removed = Vec::new();
    let dir = rel(&game_dir, bf::MWSE_MOD_DIR_REL)?;
    let script = dir.join("main.lua");
    if script.is_file() {
        std::fs::remove_file(&script).map_err(|e| e.to_string())?;
        removed.push(script.to_string_lossy().into_owned());
    }
    // Remove our now-empty folders only (bridge, then codex).
    let _ = std::fs::remove_dir(&dir);
    if let Some(parent) = dir.parent() {
        let _ = std::fs::remove_dir(parent);
    }
    let status = rel(&game_dir, bf::MWSE_STATUS_REL)?;
    if status.is_file() {
        std::fs::remove_file(&status).map_err(|e| e.to_string())?;
        removed.push(status.to_string_lossy().into_owned());
    }
    Ok(removed)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenMwInstall {
    written: Vec<String>,
    cfg_updated: bool,
    cfg_backup: Option<String>,
}

fn backup_cfg(cfg: &Path) -> Result<Option<String>, String> {
    if !cfg.is_file() {
        return Ok(None);
    }
    let backup = cfg.with_extension("cfg.codex-backup");
    std::fs::copy(cfg, &backup).map_err(|e| format!("Could not back up openmw.cfg: {e}"))?;
    Ok(Some(backup.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn openmw_status(cfg_path: String, bridge_dir: String) -> Result<(bool, bool, bool), String> {
    let cfg_text = std::fs::read_to_string(&cfg_path).unwrap_or_default();
    let installed = Path::new(&bridge_dir).join(bf::OPENMW_SCRIPTS_FILE).is_file();
    let current = std::fs::read_to_string(Path::new(&bridge_dir).join(bf::OPENMW_SCRIPT_REL)).map(|s| s == OPENMW_PLAYER).unwrap_or(false);
    Ok((installed, current, bf::openmw_cfg_has_bridge(&cfg_text)))
}

#[tauri::command]
pub async fn install_openmw_bridge(bridge_dir: String, cfg_path: String, edit_cfg: bool) -> Result<OpenMwInstall, String> {
    let root = PathBuf::from(&bridge_dir);
    std::fs::create_dir_all(&root).map_err(|e| format!("Could not create {}: {e}", root.display()))?;
    let scripts = root.join(bf::OPENMW_SCRIPTS_FILE);
    let player = safe_join(&root, bf::OPENMW_SCRIPT_REL).ok_or("Invalid folder.")?;
    if let Some(parent) = player.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&scripts, OPENMW_SCRIPTS).map_err(|e| e.to_string())?;
    std::fs::write(&player, OPENMW_PLAYER).map_err(|e| e.to_string())?;
    let mut result = OpenMwInstall { written: vec![scripts.to_string_lossy().into_owned(), player.to_string_lossy().into_owned()], cfg_updated: false, cfg_backup: None };
    if edit_cfg {
        let cfg = PathBuf::from(&cfg_path);
        let text = std::fs::read_to_string(&cfg).map_err(|e| format!("Could not read openmw.cfg ({e}). Run OpenMW once so it creates its settings, then try again."))?;
        let updated = bf::add_to_openmw_cfg(&text, &bridge_dir.replace('\\', "/"));
        if updated != text {
            result.cfg_backup = backup_cfg(&cfg)?;
            std::fs::write(&cfg, updated).map_err(|e| format!("Could not update openmw.cfg: {e}"))?;
            result.cfg_updated = true;
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn uninstall_openmw_bridge(bridge_dir: String, cfg_path: String) -> Result<Vec<String>, String> {
    let mut removed = Vec::new();
    let cfg = PathBuf::from(&cfg_path);
    if let Ok(text) = std::fs::read_to_string(&cfg) {
        let cleaned = bf::remove_from_openmw_cfg(&text, &bridge_dir.replace('\\', "/"));
        if cleaned != text {
            backup_cfg(&cfg)?;
            std::fs::write(&cfg, cleaned).map_err(|e| e.to_string())?;
            removed.push(format!("{} (bridge lines)", cfg.display()));
        }
    }
    let root = PathBuf::from(&bridge_dir);
    for r in [bf::OPENMW_SCRIPTS_FILE, bf::OPENMW_SCRIPT_REL] {
        if let Some(p) = safe_join(&root, r) {
            if p.is_file() && std::fs::remove_file(&p).is_ok() {
                removed.push(p.to_string_lossy().into_owned());
            }
        }
    }
    if let Some(dir) = safe_join(&root, "scripts/codex_bridge") {
        let _ = std::fs::remove_dir(&dir);
        if let Some(parent) = dir.parent() {
            let _ = std::fs::remove_dir(parent);
        }
    }
    let _ = std::fs::remove_dir(&root);
    Ok(removed)
}
