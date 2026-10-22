mod atlascmd;
mod bridge;
mod db;
mod detect;
mod files;
mod telemetry;

use db::Db;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const DB_FILE: &str = "codex.sqlite3";

/// Data folder. A portable copy (exe name containing "portable", or a
/// `portable.txt` next to the exe) keeps its data in `CODEX-data` beside it.
pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = portable_dir() {
        return Ok(dir);
    }
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn portable_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.to_path_buf();
    let name = exe.file_name()?.to_string_lossy().to_lowercase();
    if name.contains("portable") || dir.join("portable.txt").is_file() {
        Some(dir.join("CODEX-data"))
    } else {
        None
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    data_dir: String,
    db_path: String,
    backups_dir: String,
    portable: bool,
}

#[tauri::command]
async fn app_info(app: AppHandle) -> Result<AppInfo, String> {
    let dir = data_dir(&app)?;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        db_path: dir.join(DB_FILE).to_string_lossy().into_owned(),
        backups_dir: dir.join("backups").to_string_lossy().into_owned(),
        data_dir: dir.to_string_lossy().into_owned(),
        portable: portable_dir().is_some(),
    })
}

// ------------------------------------------------------------------ window

#[tauri::command]
async fn set_always_on_top(app: AppHandle, on: bool) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("no window")?;
    w.set_always_on_top(on).map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_window_size(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("no window")?;
    w.set_size(tauri::LogicalSize::new(width.clamp(420.0, 4000.0), height.clamp(480.0, 3000.0))).map_err(|e| e.to_string())
}

/// Brings the window forward. Only used when the player presses the quick-note hotkey.
#[tauri::command]
async fn focus_window(app: AppHandle) -> Result<(), String> {
    show_main(&app);
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
async fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only web links can be opened.".into());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn path_exists(path: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&path).exists())
}

// ----------------------------------------------------------------- hotkeys

#[derive(Default)]
struct HotkeyMap(Mutex<HashMap<u32, String>>);

#[derive(Deserialize)]
struct HotkeyBinding {
    action: String,
    combo: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HotkeyResult {
    action: String,
    combo: String,
    ok: bool,
    error: Option<String>,
}

#[tauri::command]
async fn set_hotkeys(app: AppHandle, state: tauri::State<'_, HotkeyMap>, bindings: Vec<HotkeyBinding>) -> Result<Vec<HotkeyResult>, String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut map = state.0.lock().map_err(|_| "unavailable".to_string())?;
    map.clear();
    let mut out = Vec::new();
    for b in bindings {
        if b.combo.trim().is_empty() {
            continue;
        }
        let parsed: Result<Shortcut, String> = b.combo.parse::<Shortcut>().map_err(|e| e.to_string());
        let res = parsed.and_then(|s| {
            gs.register(s).map_err(|e| e.to_string())?;
            Ok(s)
        });
        match res {
            Ok(s) => {
                map.insert(s.id(), b.action.clone());
                out.push(HotkeyResult { action: b.action, combo: b.combo, ok: true, error: None });
            }
            Err(e) => out.push(HotkeyResult { action: b.action, combo: b.combo, ok: false, error: Some(e) }),
        }
    }
    Ok(out)
}

// --------------------------------------------------------------------- run

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let watch = Arc::new(telemetry::WatchState::default());
    let procs = Arc::new(detect::ProcState::default());
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show_main(app)))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let action = app
                        .try_state::<HotkeyMap>()
                        .and_then(|m| m.0.lock().ok().and_then(|g| g.get(&shortcut.id()).cloned()));
                    if let Some(action) = action {
                        if action == "quickNote" {
                            show_main(app);
                        }
                        let _ = app.emit("hotkey", action);
                    }
                })
                .build(),
        )
        .manage(HotkeyMap::default())
        .manage(watch.clone())
        .manage(procs.clone())
        .setup(move |app| {
            let dir = data_dir(app.handle())?;
            std::fs::create_dir_all(&dir)?;
            let path = dir.join(DB_FILE);
            let conn = db::open(&path)?;
            app.manage(Db { conn: Mutex::new(Some(conn)), path });
            telemetry::spawn(app.handle().clone(), watch.clone());
            detect::spawn(app.handle().clone(), procs.clone(), watch.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::db_select,
            db::db_execute,
            db::db_batch,
            app_info,
            set_always_on_top,
            set_window_size,
            focus_window,
            open_external,
            reveal_path,
            path_exists,
            set_hotkeys,
            files::pick_file,
            files::pick_save,
            files::read_text_file,
            files::write_text_file,
            files::import_attachment,
            files::import_map_image,
            files::save_attachment_bytes,
            files::read_data_file,
            files::read_image_file,
            files::data_path,
            files::delete_data_file,
            files::newest_screenshot,
            files::export_markdown,
            files::write_backup_bundle,
            files::read_backup_bundle,
            files::snapshot_db,
            files::list_db_snapshots,
            files::restore_db_snapshot,
            telemetry::bridge_set_sources,
            detect::set_watched_executables,
            detect::detect_installs,
            detect::user_dirs,
            bridge::mwse_status,
            bridge::install_mwse_bridge,
            bridge::uninstall_mwse_bridge,
            bridge::openmw_status,
            bridge::install_openmw_bridge,
            bridge::uninstall_openmw_bridge,
            atlascmd::load_order,
            atlascmd::build_atlas,
            atlascmd::read_atlas,
            atlascmd::read_atlas_heights,
            atlascmd::delete_atlas
        ])
        .run(tauri::generate_context!())
        .expect("error while running CODEX.EXE");
}
