//! Text decoding for game data.
//!
//! TES3 content files store strings in a Windows code page (Windows-1252 for
//! English releases). MWSE writes its JSON with the same bytes. OpenMW logs are
//! UTF-8. `decode_game_text` accepts UTF-8 when valid, otherwise Windows-1252.

const CP1252_HIGH: [char; 32] = [
    '\u{20AC}', '\u{FFFD}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}', '\u{2021}',
    '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{FFFD}', '\u{017D}', '\u{FFFD}',
    '\u{FFFD}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}', '\u{2022}', '\u{2013}', '\u{2014}',
    '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}', '\u{0153}', '\u{FFFD}', '\u{017E}', '\u{0178}',
];

/// Decodes Windows-1252 bytes to a String.
pub fn cp1252(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|&b| match b {
            0x80..=0x9F => CP1252_HIGH[(b - 0x80) as usize],
            _ => b as char,
        })
        .collect()
}

/// UTF-8 if valid, otherwise Windows-1252.
pub fn decode_game_text(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => cp1252(bytes),
    }
}

/// A zero-terminated (or not) string field from a TES3 subrecord.
pub fn zstring(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    cp1252(&bytes[..end]).trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_cp1252_specials() {
        assert_eq!(cp1252(b"caf\xe9 \x93hi\x94 \x80"), "caf\u{e9} \u{201C}hi\u{201D} \u{20AC}");
        assert_eq!(decode_game_text("Ald'ruhn \u{e9}".as_bytes()), "Ald'ruhn \u{e9}");
        assert_eq!(decode_game_text(b"\xe9t\xe9"), "\u{e9}t\u{e9}");
    }

    #[test]
    fn zstrings_stop_at_nul_and_trim() {
        assert_eq!(zstring(b"Balmora\0garbage"), "Balmora");
        assert_eq!(zstring(b"  spaced \0"), "spaced");
        assert_eq!(zstring(b""), "");
    }
}
