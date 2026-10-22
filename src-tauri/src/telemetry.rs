//! Watches the bridge outputs and forwards new data to the UI.
//!
//!  - MWSE: re-reads Data Files\MWSE\codex_live.json when its size or
//!    modification time changes.
//!  - OpenMW: follows openmw.log from where it last read.
//!
//! Only file metadata is checked on each tick (once a second while a game is
//! running, every few seconds otherwise), so the game is not slowed down.
//! Validation of the JSON happens in the UI (src/core/protocol.ts).

use codex_core::logtail::LogTail;
use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const MAX_DOC: u64 = 2 * 1024 * 1024;
const MAX_LOG_CHUNK: u64 = 8 * 1024 * 1024;

#[derive(Clone, Deserialize, Debug, PartialEq)]
pub struct Source {
    /// "mwse" or "openmw"
    pub engine: String,
    pub path: String,
}

#[derive(Default)]
pub struct WatchState {
    pub sources: Mutex<Vec<Source>>,
    pub changed: AtomicBool,
    pub game_running: AtomicBool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DocEvent {
    engine: String,
    text: String,
    mtime_ms: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LinesEvent {
    engine: String,
    lines: Vec<String>,
    mtime_ms: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusEvent {
    engine: String,
    path: String,
    exists: bool,
    message: String,
}

fn mtime_ms(m: &std::fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

struct FileWatch {
    source: Source,
    last: Option<(u64, u64)>, // (len, mtime)
    tail: LogTail,
    reported_missing: bool,
}

pub fn spawn(app: AppHandle, state: Arc<WatchState>) {
    std::thread::Builder::new()
        .name("codex-telemetry".into())
        .spawn(move || {
            let mut watches: Vec<FileWatch> = Vec::new();
            loop {
                if state.changed.swap(false, Ordering::SeqCst) {
                    let sources = state.sources.lock().map(|s| s.clone()).unwrap_or_default();
                    watches = sources
                        .into_iter()
                        .map(|source| FileWatch { source, last: None, tail: LogTail::new(), reported_missing: false })
                        .collect();
                }
                for w in watches.iter_mut() {
                    poll(&app, w);
                }
                let fast = state.game_running.load(Ordering::Relaxed);
                std::thread::sleep(if fast { Duration::from_millis(1000) } else { Duration::from_millis(3000) });
            }
        })
        .expect("telemetry thread");
}

fn poll(app: &AppHandle, w: &mut FileWatch) {
    let path = PathBuf::from(&w.source.path);
    let meta = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(_) => {
            if !w.reported_missing {
                w.reported_missing = true;
                let _ = app.emit(
                    "bridge-status",
                    StatusEvent { engine: w.source.engine.clone(), path: w.source.path.clone(), exists: false, message: "Waiting for the bridge file to appear.".into() },
                );
            }
            return;
        }
    };
    if w.reported_missing {
        w.reported_missing = false;
        let _ = app.emit("bridge-status", StatusEvent { engine: w.source.engine.clone(), path: w.source.path.clone(), exists: true, message: "Bridge file found.".into() });
    }
    let sig = (meta.len(), mtime_ms(&meta));
    if w.last == Some(sig) {
        return;
    }
    w.last = Some(sig);
    match w.source.engine.as_str() {
        "mwse" => {
            if meta.len() > MAX_DOC {
                return;
            }
            if let Ok(bytes) = std::fs::read(&path) {
                let text = codex_core::text::decode_game_text(&bytes);
                let _ = app.emit("bridge-doc", DocEvent { engine: "mwse".into(), text, mtime_ms: sig.1 });
            }
        }
        "openmw" => {
            w.tail.observe_size(meta.len());
            let Ok(mut f) = std::fs::File::open(&path) else { return };
            if f.seek(SeekFrom::Start(w.tail.offset)).is_err() {
                return;
            }
            let mut buf = Vec::new();
            let _ = f.take(MAX_LOG_CHUNK).read_to_end(&mut buf);
            let lines = w.tail.feed(&buf);
            if !lines.is_empty() {
                let _ = app.emit("bridge-lines", LinesEvent { engine: "openmw".into(), lines, mtime_ms: sig.1 });
            }
            if buf.len() as u64 >= MAX_LOG_CHUNK {
                w.last = None; // more to read next tick
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub async fn bridge_set_sources(state: tauri::State<'_, Arc<WatchState>>, sources: Vec<Source>) -> Result<(), String> {
    let clean: Vec<Source> = sources.into_iter().filter(|s| (s.engine == "mwse" || s.engine == "openmw") && !s.path.trim().is_empty()).collect();
    let mut cur = state.sources.lock().map_err(|_| "watcher unavailable".to_string())?;
    if *cur != clean {
        *cur = clean;
        state.changed.store(true, Ordering::SeqCst);
    }
    Ok(())
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}
