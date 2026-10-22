// Everything that talks to Rust lives here. The rest of the UI only sees
// plain async functions. The desktop app exposes window.__TAURI__ (Tauri's
// global API); the screenshot/preview harness provides a stand-in.
import type { SqlDriver, SqlValue, Statement } from "../db/driver.ts";

interface TauriGlobal {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void> };
}

function tauri(): TauriGlobal | null {
  return (globalThis as unknown as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null;
}

export function isDesktop(): boolean {
  return tauri() !== null;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = tauri();
  if (!t) throw new Error("This action needs the CODEX.EXE desktop app.");
  return t.core.invoke<T>(cmd, args);
}

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  const t = tauri();
  if (!t) return () => {};
  return t.event.listen<T>(event, (e) => handler(e.payload));
}

export const tauriDriver: SqlDriver = {
  select: (sql, params) => invoke("db_select", { sql, params: params ?? [] }),
  execute: (sql, params) => invoke("db_execute", { sql, params: params ?? [] }),
  batch: (statements: Statement[]) =>
    invoke("db_batch", { statements: statements.map((s) => ({ sql: s.sql, params: (s.params ?? []) as SqlValue[] })) }),
};

export interface AppInfo {
  version: string;
  dataDir: string;
  dbPath: string;
  backupsDir: string;
  portable: boolean;
}

export const appInfo = () => invoke<AppInfo>("app_info");

export interface FileFilter {
  name: string;
  extensions: string[];
}

export const pickFile = (title: string, filters: FileFilter[] = []) => invoke<string | null>("pick_file", { title, filters, directory: false });
export const pickFolder = (title: string) => invoke<string | null>("pick_file", { title, filters: [], directory: true });
export const pickSave = (title: string, defaultName: string, filters: FileFilter[] = []) => invoke<string | null>("pick_save", { title, defaultName, filters });
export const readTextFile = (path: string) => invoke<string>("read_text_file", { path });
export const writeTextFile = (path: string, contents: string) => invoke<void>("write_text_file", { path, contents });
export const importAttachment = (src: string) => invoke<string>("import_attachment", { src });
export const importMapImage = (src: string) => invoke<string>("import_map_image", { src });
export const saveAttachmentBytes = (ext: string, bytes: number[]) => invoke<string>("save_attachment_bytes", { ext, bytes });
export const deleteDataFile = (rel: string) => invoke<void>("delete_data_file", { rel });
export const newestScreenshot = (dirs: string[]) => invoke<{ path: string; modifiedMs: number } | null>("newest_screenshot", { dirs });
export const exportMarkdownFile = (path: string, markdown: string, files: string[]) => invoke<number>("export_markdown", { path, markdown, files });
export const writeBackupBundle = (folder: string, json: string, files: string[]) => invoke<string>("write_backup_bundle", { folder, json, files });
export const readBackupBundle = (folder: string) => invoke<string>("read_backup_bundle", { folder });
export const snapshotDb = (reason: string) => invoke<string>("snapshot_db", { reason });
export const listDbSnapshots = () => invoke<{ path: string; name: string; bytes: number; modifiedMs: number }[]>("list_db_snapshots");
export const restoreDbSnapshot = (path: string) => invoke<string>("restore_db_snapshot", { path });
export const setAlwaysOnTop = (on: boolean) => invoke<void>("set_always_on_top", { on });
export const setWindowSize = (width: number, height: number) => invoke<void>("set_window_size", { width, height });
export const focusWindow = () => invoke<void>("focus_window");
export const openExternal = (url: string) => invoke<void>("open_external", { url });
export const revealPath = (path: string) => invoke<void>("reveal_path", { path });
export const pathExists = (path: string) => invoke<boolean>("path_exists", { path });
export const bridgeSetSources = (sources: { engine: string; path: string }[]) => invoke<void>("bridge_set_sources", { sources });
export const setWatchedExecutables = (names: string[]) => invoke<string[]>("set_watched_executables", { names });
export const detectInstalls = (folders: string[]) => invoke<{ folder: string; path: string; source: string }[]>("detect_installs", { folders });

export interface UserDirs {
  documents: string;
  openmwUser: string;
  openmwCfg: string;
  openmwLog: string;
  openmwScreenshots: string;
}
export const userDirs = () => invoke<UserDirs>("user_dirs");

export interface MwseStatus {
  gameDirOk: boolean;
  mwseInstalled: boolean;
  bridgeInstalled: boolean;
  bridgeCurrent: boolean;
  statusFile: string;
  scriptPath: string;
  morrowindIni: string;
}
export const mwseStatus = (gameDir: string) => invoke<MwseStatus>("mwse_status", { gameDir });
export const installMwseBridge = (gameDir: string) => invoke<string[]>("install_mwse_bridge", { gameDir });
export const uninstallMwseBridge = (gameDir: string) => invoke<string[]>("uninstall_mwse_bridge", { gameDir });
export const openmwStatus = (cfgPath: string, bridgeDir: string) => invoke<[boolean, boolean, boolean]>("openmw_status", { cfgPath, bridgeDir });
export const installOpenmwBridge = (bridgeDir: string, cfgPath: string, editCfg: boolean) =>
  invoke<{ written: string[]; cfgUpdated: boolean; cfgBackup: string | null }>("install_openmw_bridge", { bridgeDir, cfgPath, editCfg });
export const uninstallOpenmwBridge = (bridgeDir: string, cfgPath: string) => invoke<string[]>("uninstall_openmw_bridge", { bridgeDir, cfgPath });

export interface OrderItem {
  name: string;
  path: string | null;
  bytes: number;
}
export const loadOrder = (engine: string, gameDir: string, cfgPath: string, userDir: string) =>
  invoke<OrderItem[]>("load_order", { engine, gameDir, cfgPath, userDir });
export const buildAtlas = (gameId: string, files: string[]) =>
  invoke<{ json: string; heightsPath: string }>("build_atlas", { gameId, files, builtAt: new Date().toISOString() });
export const readAtlas = (gameId: string) => invoke<{ json: string; heightsPath: string } | null>("read_atlas", { gameId });
export const readAtlasHeights = (gameId: string) => invoke<ArrayBuffer>("read_atlas_heights", { gameId });
export const deleteAtlas = (gameId: string) => invoke<void>("delete_atlas", { gameId });

export interface HotkeyResult {
  action: string;
  combo: string;
  ok: boolean;
  error: string | null;
}
export const setHotkeys = (bindings: { action: string; combo: string }[]) => invoke<HotkeyResult[]>("set_hotkeys", { bindings });

// ---------------------------------------------------------------- images

const urlCache = new Map<string, Promise<string>>();

function mimeFor(name: string): string {
  const l = name.toLowerCase();
  if (l.endsWith(".png")) return "image/png";
  if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
  if (l.endsWith(".bmp")) return "image/bmp";
  if (l.endsWith(".gif")) return "image/gif";
  if (l.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function toBlobUrl(buf: ArrayBuffer | number[], name: string): string {
  const data = buf instanceof ArrayBuffer ? buf : new Uint8Array(buf).buffer;
  return URL.createObjectURL(new Blob([data], { type: mimeFor(name) }));
}

/** Blob URL for an attachment or imported map stored in the data folder. */
export function dataImageUrl(rel: string): Promise<string> {
  let p = urlCache.get(rel);
  if (!p) {
    p = invoke<ArrayBuffer | number[]>("read_data_file", { rel }).then((b) => toBlobUrl(b, rel));
    p.catch(() => urlCache.delete(rel));
    urlCache.set(rel, p);
  }
  return p;
}

/** Blob URL for an image anywhere on disk (preview before importing). */
export async function fileImageUrl(path: string): Promise<string> {
  const b = await invoke<ArrayBuffer | number[]>("read_image_file", { path });
  return toBlobUrl(b, path);
}

export function forgetImage(rel: string): void {
  const p = urlCache.get(rel);
  urlCache.delete(rel);
  p?.then((u) => URL.revokeObjectURL(u)).catch(() => {});
}
