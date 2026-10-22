//! File commands: native dialogs, attachments, imported maps, exports and
//! backup bundles. Writes go only to the app's data folder or to a path the
//! player picked in a native dialog.

use crate::{data_dir, Db};
use codex_core::paths::{is_image, safe_join, sanitize_name};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const KEEP_SNAPSHOTS: usize = 20;

#[derive(Deserialize)]
pub struct Filter {
    name: String,
    extensions: Vec<String>,
}

fn stamp() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    // yyyymmdd-hhmmss in UTC without extra crates.
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}{m:02}{d:02}-{:02}{:02}{:02}", rem / 3600, (rem % 3600) / 60, rem % 60)
}

/// Days since 1970-01-01 -> (year, month, day). Howard Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn unique_name(original: &Path) -> String {
    let ext = original
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| e.chars().all(|c| c.is_ascii_alphanumeric()) && e.len() <= 5)
        .unwrap_or_else(|| "bin".into());
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{}-{:x}.{ext}", stamp(), nanos % 0xFFFF_FFFF)
}

#[tauri::command]
pub async fn pick_file(app: AppHandle, title: String, filters: Option<Vec<Filter>>, directory: Option<bool>) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut d = app.dialog().file().set_title(&title);
        for f in filters.unwrap_or_default() {
            let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            d = d.add_filter(f.name.clone(), &exts);
        }
        let picked = if directory.unwrap_or(false) { d.blocking_pick_folder() } else { d.blocking_pick_file() };
        picked.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pick_save(app: AppHandle, title: String, default_name: String, filters: Option<Vec<Filter>>) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut d = app.dialog().file().set_title(&title).set_file_name(&default_name);
        for f in filters.unwrap_or_default() {
            let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            d = d.add_filter(f.name.clone(), &exts);
        }
        d.blocking_save_file().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())
}

/// Reads a text file the player picked in a native dialog (max 64 MB).
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    if meta.len() > 64 * 1024 * 1024 {
        return Err("That file is too large.".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    Ok(codex_core::text::decode_game_text(&bytes))
}

/// Writes a text file to a path the player picked in a native dialog.
#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Could not write {path}: {e}"))
}

/// Copies an image into the data folder. Returns its path relative to the data folder.
fn import_into(app: &AppHandle, sub: &str, src: &str) -> Result<String, String> {
    let src_path = PathBuf::from(src);
    let name = src_path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if !is_image(&name) {
        return Err("Only image files (PNG, JPG, BMP, GIF, WebP) can be attached.".into());
    }
    let meta = std::fs::metadata(&src_path).map_err(|e| format!("Could not read {src}: {e}"))?;
    if meta.len() > 100 * 1024 * 1024 {
        return Err("That image is larger than 100 MB.".into());
    }
    let dir = data_dir(app)?.join(sub);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = unique_name(&src_path);
    std::fs::copy(&src_path, dir.join(&file)).map_err(|e| format!("Could not copy the image: {e}"))?;
    Ok(format!("{sub}/{file}"))
}

#[tauri::command]
pub async fn import_attachment(app: AppHandle, src: String) -> Result<String, String> {
    import_into(&app, "attachments", &src)
}

#[tauri::command]
pub async fn import_map_image(app: AppHandle, src: String) -> Result<String, String> {
    import_into(&app, "maps", &src)
}

/// Saves image bytes (e.g. pasted from the clipboard) as an attachment.
#[tauri::command]
pub async fn save_attachment_bytes(app: AppHandle, ext: String, bytes: Vec<u8>) -> Result<String, String> {
    let ext = sanitize_name(&ext.to_lowercase());
    if !is_image(&format!("x.{ext}")) {
        return Err("Unsupported image type.".into());
    }
    if bytes.len() > 50 * 1024 * 1024 {
        return Err("That image is larger than 50 MB.".into());
    }
    let dir = data_dir(&app)?.join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = unique_name(Path::new(&format!("pasted.{ext}")));
    std::fs::write(dir.join(&file), bytes).map_err(|e| e.to_string())?;
    Ok(format!("attachments/{file}"))
}

/// Raw bytes of an attachment or imported map (shown in the UI as a blob URL).
#[tauri::command]
pub async fn read_data_file(app: AppHandle, rel: String) -> Result<tauri::ipc::Response, String> {
    let root = data_dir(&app)?;
    let p = safe_join(&root, &rel).ok_or("Invalid path.")?;
    if !(rel.starts_with("attachments/") || rel.starts_with("maps/")) {
        return Err("Only attachments and imported maps can be read.".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| format!("Could not read {rel}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Raw bytes of an image the player picked (preview before importing).
#[tauri::command]
pub async fn read_image_file(path: String) -> Result<tauri::ipc::Response, String> {
    let name = Path::new(&path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if !is_image(&name) {
        return Err("Not an image file.".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Absolute path of a file inside the data folder.
#[tauri::command]
pub async fn data_path(app: AppHandle, rel: String) -> Result<String, String> {
    let root = data_dir(&app)?;
    safe_join(&root, &rel).map(|p| p.to_string_lossy().into_owned()).ok_or_else(|| "Invalid path.".into())
}

#[tauri::command]
pub async fn delete_data_file(app: AppHandle, rel: String) -> Result<(), String> {
    let root = data_dir(&app)?;
    let p = safe_join(&root, &rel).ok_or("Invalid path.")?;
    if !(rel.starts_with("attachments/") || rel.starts_with("maps/")) {
        return Err("Only attachments and imported maps can be deleted.".into());
    }
    match std::fs::remove_file(&p) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundFile {
    path: String,
    modified_ms: u64,
}

/// The most recent image in any of the given folders (non-recursive).
#[tauri::command]
pub async fn newest_screenshot(dirs: Vec<String>) -> Result<Option<FoundFile>, String> {
    let mut best: Option<(SystemTime, PathBuf)> = None;
    for d in dirs {
        let Ok(entries) = std::fs::read_dir(&d) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if !p.is_file() || !is_image(&name) {
                continue;
            }
            if let Ok(m) = e.metadata().and_then(|m| m.modified()) {
                if best.as_ref().map(|b| m > b.0).unwrap_or(true) {
                    best = Some((m, p));
                }
            }
        }
    }
    Ok(best.map(|(m, p)| FoundFile {
        path: p.to_string_lossy().into_owned(),
        modified_ms: m.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
    }))
}

/// Writes an exported Markdown journal and copies its images next to it.
#[tauri::command]
pub async fn export_markdown(app: AppHandle, path: String, markdown: String, files: Vec<String>) -> Result<usize, String> {
    let dest = PathBuf::from(&path);
    std::fs::write(&dest, markdown).map_err(|e| format!("Could not write {path}: {e}"))?;
    let root = data_dir(&app)?;
    let parent = dest.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let att_dir = parent.join("attachments");
    let mut copied = 0;
    for rel in files {
        let Some(src) = safe_join(&root, &rel) else { continue };
        let Some(name) = src.file_name() else { continue };
        if std::fs::create_dir_all(&att_dir).is_ok() && std::fs::copy(&src, att_dir.join(name)).is_ok() {
            copied += 1;
        }
    }
    Ok(copied)
}

/// Writes a full backup: codex-backup.json plus the attachments and imported maps.
#[tauri::command]
pub async fn write_backup_bundle(app: AppHandle, folder: String, json: String, files: Vec<String>) -> Result<String, String> {
    let dest = PathBuf::from(&folder).join(format!("CODEX backup {}", stamp()));
    std::fs::create_dir_all(dest.join("files")).map_err(|e| e.to_string())?;
    std::fs::write(dest.join("codex-backup.json"), json).map_err(|e| e.to_string())?;
    let root = data_dir(&app)?;
    for rel in files {
        let (Some(src), Some(to)) = (safe_join(&root, &rel), safe_join(&dest.join("files"), &rel)) else { continue };
        if let Some(parent) = to.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::copy(src, to);
    }
    Ok(dest.to_string_lossy().into_owned())
}

/// Reads codex-backup.json from a backup folder and copies its images back
/// into the data folder (images only, never outside the data folder).
#[tauri::command]
pub async fn read_backup_bundle(app: AppHandle, folder: String) -> Result<String, String> {
    let dir = PathBuf::from(&folder);
    let json_path = dir.join("codex-backup.json");
    let json = std::fs::read_to_string(&json_path).map_err(|_| "This folder has no codex-backup.json.".to_string())?;
    let root = data_dir(&app)?;
    for sub in ["attachments", "maps"] {
        let Ok(entries) = std::fs::read_dir(dir.join("files").join(sub)) else { continue };
        let target = root.join(sub);
        let _ = std::fs::create_dir_all(&target);
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if e.path().is_file() && is_image(&name) && name == sanitize_name(&name) {
                let _ = std::fs::copy(e.path(), target.join(&name));
            }
        }
    }
    Ok(json)
}

// ------------------------------------------------------------ DB snapshots

fn snapshots_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = data_dir(app)?.join("backups");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn prune(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        let mut files: Vec<(SystemTime, PathBuf)> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("sqlite3"))
            .filter_map(|p| std::fs::metadata(&p).and_then(|m| m.modified()).ok().map(|t| (t, p)))
            .collect();
        files.sort_by(|a, b| b.0.cmp(&a.0));
        for (_, old) in files.into_iter().skip(KEEP_SNAPSHOTS) {
            let _ = std::fs::remove_file(old);
        }
    }
}

/// Saves a full copy of the database in <data>/backups (keeps the newest 20).
#[tauri::command]
pub async fn snapshot_db(app: AppHandle, reason: String) -> Result<String, String> {
    let dir = snapshots_dir(&app)?;
    let name = format!("codex-{}-{}.sqlite3", stamp(), sanitize_name(&reason).replace(' ', "-"));
    let dest = dir.join(name);
    let db = app.state::<Db>();
    crate::db::snapshot(&db, &dest)?;
    prune(&dir);
    Ok(dest.to_string_lossy().into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    path: String,
    name: String,
    bytes: u64,
    modified_ms: u64,
}

#[tauri::command]
pub async fn list_db_snapshots(app: AppHandle) -> Result<Vec<SnapshotInfo>, String> {
    let dir = snapshots_dir(&app)?;
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("sqlite3") {
                continue;
            }
            let meta = e.metadata().map_err(|e| e.to_string())?;
            out.push(SnapshotInfo {
                path: p.to_string_lossy().into_owned(),
                name: e.file_name().to_string_lossy().into_owned(),
                bytes: meta.len(),
                modified_ms: meta.modified().ok().and_then(|m| m.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0),
            });
        }
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

/// Restores a database snapshot. A safety snapshot of the current data is taken first.
#[tauri::command]
pub async fn restore_db_snapshot(app: AppHandle, path: String) -> Result<String, String> {
    let dir = snapshots_dir(&app)?;
    let safety = dir.join(format!("codex-{}-before-restore.sqlite3", stamp()));
    let db = app.state::<Db>();
    crate::db::snapshot(&db, &safety)?;
    crate::db::replace_with(&db, Path::new(&path))?;
    Ok(safety.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::civil_from_days;
    #[test]
    fn dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_746), (2026, 10, 20));
    }
}
