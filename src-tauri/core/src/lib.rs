//! Dependency-free core logic for CODEX.EXE.
//!
//! Everything here uses only the Rust standard library so it can be unit
//! tested anywhere (`cargo test` in this folder) without the Tauri toolchain.

pub mod atlas;
pub mod bridgefiles;
pub mod json;
pub mod loadorder;
pub mod logtail;
pub mod paths;
pub mod procs;
pub mod steam;
pub mod tes3;
pub mod text;
