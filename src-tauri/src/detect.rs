//! Game detection: running executables (via `tasklist`, every few seconds,
//! only while the app has games to watch) and installed folders (Steam
//! libraries, GOG and common locations). Read-only.

use crate::telemetry::WatchState;
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct ProcState {
    pub watched: Mutex<BTreeSet<String>>,
    pub running: Mutex<Vec<String>>,
}

fn list_processes() -> Vec<String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        match std::process::Command::new("tasklist").args(["/FO", "CSV", "/NH"]).creation_flags(CREATE_NO_WINDOW).output() {
            Ok(out) => codex_core::procs::parse_tasklist_csv(&String::from_utf8_lossy(&out.stdout)),
            Err(_) => Vec::new(),
        }
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

pub fn spawn(app: AppHandle, procs: Arc<ProcState>, watch: Arc<WatchState>) {
    std::thread::Builder::new()
        .name("codex-detect".into())
        .spawn(move || loop {
            let watched: BTreeSet<String> = procs.watched.lock().map(|w| w.clone()).unwrap_or_default();
            if !watched.is_empty() {
                let mut running: Vec<String> = list_processes().into_iter().filter(|p| watched.contains(p)).collect();
                running.sort();
                let changed = {
                    let mut cur = procs.running.lock().unwrap_or_else(|e| e.into_inner());
                    if *cur != running {
                        *cur = running.clone();
                        true
                    } else {
                        false
                    }
                };
                watch.game_running.store(!running.is_empty(), Ordering::Relaxed);
                if changed {
                    let _ = app.emit("processes", running);
                }
            }
            std::thread::sleep(Duration::from_secs(4));
        })
        .expect("detect thread");
}

#[tauri::command]
pub async fn set_watched_executables(state: tauri::State<'_, Arc<ProcState>>, names: Vec<String>) -> Result<Vec<String>, String> {
    let set: BTreeSet<String> = names.into_iter().map(|n| n.trim().to_lowercase()).filter(|n| n.ends_with(".exe") && n.len() < 80).collect();
    *state.watched.lock().map_err(|_| "unavailable".to_string())? = set;
    Ok(state.running.lock().map(|r| r.clone()).unwrap_or_default())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundInstall {
    folder: String,
    path: String,
    source: String,
}

fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for base in [r"C:\Program Files (x86)\Steam", r"C:\Program Files\Steam"] {
        let p = PathBuf::from(base);
        if p.is_dir() {
            roots.push(p);
        }
    }
    let mut libs = Vec::new();
    for r in &roots {
        libs.push(r.clone());
        if let Ok(text) = std::fs::read_to_string(r.join("steamapps").join("libraryfolders.vdf")) {
            for p in codex_core::steam::library_paths(&text) {
                let pb = PathBuf::from(p);
                if !libs.contains(&pb) {
                    libs.push(pb);
                }
            }
        }
    }
    libs
}

/// Looks for known game folders in Steam libraries and common GOG/manual locations.
#[tauri::command]
pub async fn detect_installs(folders: Vec<String>) -> Result<Vec<FoundInstall>, String> {
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    let mut check = |base: &Path, source: &str, out: &mut Vec<FoundInstall>| {
        for f in &folders {
            let p = base.join(f);
            if p.is_dir() {
                let key = p.to_string_lossy().to_lowercase();
                if seen.insert(key) {
                    out.push(FoundInstall { folder: f.clone(), path: p.to_string_lossy().into_owned(), source: source.into() });
                }
            }
        }
    };
    for lib in steam_roots() {
        check(&lib.join("steamapps").join("common"), "Steam", &mut out);
    }
    for base in [r"C:\GOG Games", r"C:\Program Files (x86)\GOG Galaxy\Games", r"D:\GOG Games", r"C:\Games", r"D:\Games"] {
        check(Path::new(base), "Folder", &mut out);
    }
    for base in [r"C:\Program Files (x86)\Bethesda Softworks", r"C:\Program Files\Bethesda Softworks", r"C:\Program Files\OpenMW", r"C:\Program Files"] {
        check(Path::new(base), "Folder", &mut out);
    }
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserDirs {
    documents: String,
    openmw_user: String,
    openmw_cfg: String,
    openmw_log: String,
    openmw_screenshots: String,
}

/// Standard per-user OpenMW locations on Windows (Documents\My Games\OpenMW).
#[tauri::command]
pub async fn user_dirs(app: AppHandle) -> Result<UserDirs, String> {
    let docs = app.path().document_dir().map_err(|e| e.to_string())?;
    let omw = docs.join("My Games").join("OpenMW");
    Ok(UserDirs {
        documents: docs.to_string_lossy().into_owned(),
        openmw_cfg: omw.join("openmw.cfg").to_string_lossy().into_owned(),
        openmw_log: omw.join("openmw.log").to_string_lossy().into_owned(),
        openmw_screenshots: omw.join("screenshots").to_string_lossy().into_owned(),
        openmw_user: omw.to_string_lossy().into_owned(),
    })
}
