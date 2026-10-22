//! Load-order discovery and the world-atlas build. Game files are only read.

use crate::data_dir;
use codex_core::atlas;
use codex_core::loadorder as lo;
use codex_core::paths::sanitize_name;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderItem {
    name: String,
    path: Option<String>,
    bytes: u64,
}

fn item(name: String, path: Option<PathBuf>) -> OrderItem {
    let bytes = path.as_ref().and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len()).unwrap_or(0);
    OrderItem { name, path: path.map(|p| p.to_string_lossy().into_owned()), bytes }
}

fn mtime(p: &Path) -> u64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

/// Original engine: Morrowind.ini [Game Files], ordered like the engine does.
fn original_order(game_dir: &str) -> Result<Vec<OrderItem>, String> {
    let root = PathBuf::from(game_dir);
    let data = root.join("Data Files");
    if !data.is_dir() {
        return Err("That folder has no \"Data Files\" folder. Choose the Morrowind install folder.".into());
    }
    let ini = std::fs::read(root.join("Morrowind.ini")).map(|b| codex_core::text::decode_game_text(&b)).unwrap_or_default();
    let mut names = lo::parse_morrowind_ini(&ini);
    if names.is_empty() {
        names.push("Morrowind.esm".into());
    }
    let mut found: Vec<(String, u64)> = Vec::new();
    let mut paths = std::collections::HashMap::new();
    let mut missing = Vec::new();
    for n in names {
        match lo::find_case_insensitive(&data, &n) {
            Some(p) => {
                found.push((n.clone(), mtime(&p)));
                paths.insert(n, p);
            }
            None => missing.push(n),
        }
    }
    let mut out: Vec<OrderItem> = lo::order_original(found).into_iter().map(|n| {
        let p = paths.remove(&n);
        item(n, p)
    }).collect();
    out.extend(missing.into_iter().map(|n| item(n, None)));
    Ok(out)
}

/// OpenMW: content= order from openmw.cfg, located through its data= folders.
fn openmw_order(cfg_path: &str, user_dir: &str, install_dir: &str) -> Result<Vec<OrderItem>, String> {
    let mut cfg = lo::OpenMwCfg::default();
    let install = PathBuf::from(install_dir);
    // The global openmw.cfg next to openmw.exe, then the user's (which wins).
    if !install_dir.is_empty() {
        if let Ok(t) = std::fs::read_to_string(install.join("openmw.cfg")) {
            cfg = lo::parse_openmw_cfg(&t, cfg);
        }
    }
    let user_text = std::fs::read_to_string(cfg_path).map_err(|e| format!("Could not read {cfg_path}: {e}"))?;
    cfg = lo::parse_openmw_cfg(&user_text, cfg);
    let user = PathBuf::from(user_dir);
    let dirs: Vec<PathBuf> = cfg.data.iter().map(|d| lo::resolve_token(d, &user, &install, &install)).collect();
    Ok(lo::locate_content(&cfg, &dirs)
        .into_iter()
        .filter(|(n, _)| lo::is_tes3_content(n))
        .map(|(n, p)| item(n, p))
        .collect())
}

#[tauri::command]
pub async fn load_order(engine: String, game_dir: String, cfg_path: String, user_dir: String) -> Result<Vec<OrderItem>, String> {
    match engine.as_str() {
        "openmw" => openmw_order(&cfg_path, &user_dir, &game_dir),
        _ => original_order(&game_dir),
    }
}

fn atlas_dir(app: &AppHandle, game_id: &str) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("atlas").join(sanitize_name(game_id)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AtlasFiles {
    json: String,
    heights_path: String,
}

#[tauri::command]
pub async fn build_atlas(app: AppHandle, game_id: String, files: Vec<String>, built_at: String) -> Result<AtlasFiles, String> {
    let dir = atlas_dir(&app, &game_id)?;
    let paths: Vec<PathBuf> = files.iter().map(PathBuf::from).collect();
    let gid = game_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || atlas::build_from_files(&paths, &gid, &built_at, atlas::DEFAULT_MAX_DIM))
        .await
        .map_err(|e| e.to_string())??;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let bin = dir.join("atlas.bin");
    std::fs::write(&bin, &result.heights).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("atlas.json"), &result.json).map_err(|e| e.to_string())?;
    Ok(AtlasFiles { json: result.json, heights_path: bin.to_string_lossy().into_owned() })
}

#[tauri::command]
pub async fn read_atlas(app: AppHandle, game_id: String) -> Result<Option<AtlasFiles>, String> {
    let dir = atlas_dir(&app, &game_id)?;
    let bin = dir.join("atlas.bin");
    match std::fs::read_to_string(dir.join("atlas.json")) {
        Ok(json) if bin.is_file() => Ok(Some(AtlasFiles { json, heights_path: bin.to_string_lossy().into_owned() })),
        _ => Ok(None),
    }
}

/// Reads the height image as raw bytes (fallback when the asset protocol is unavailable).
#[tauri::command]
pub async fn read_atlas_heights(app: AppHandle, game_id: String) -> Result<tauri::ipc::Response, String> {
    let bin = atlas_dir(&app, &game_id)?.join("atlas.bin");
    let bytes = std::fs::read(bin).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn delete_atlas(app: AppHandle, game_id: String) -> Result<(), String> {
    let dir = atlas_dir(&app, &game_id)?;
    for f in ["atlas.json", "atlas.bin"] {
        let _ = std::fs::remove_file(dir.join(f));
    }
    let _ = std::fs::remove_dir(&dir);
    Ok(())
}
