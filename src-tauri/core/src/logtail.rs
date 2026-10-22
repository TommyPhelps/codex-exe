//! Follows the end of a growing log file (openmw.log) and returns the lines
//! that carry bridge documents. Handles the log being recreated when the game
//! restarts (the file gets shorter).

pub const PREFIX: &str = "CODEXBRIDGE1 ";
/// A single line longer than this is dropped (protects memory).
pub const MAX_LINE: usize = 4 * 1024 * 1024;

#[derive(Debug, Default)]
pub struct LogTail {
    pub offset: u64,
    carry: Vec<u8>,
    skipping: bool,
}

impl LogTail {
    pub fn new() -> Self {
        Self::default()
    }

    /// Tells the tail the file's current size. Returns true if the file was
    /// truncated or replaced, in which case reading restarts at 0.
    pub fn observe_size(&mut self, size: u64) -> bool {
        if size < self.offset {
            self.offset = 0;
            self.carry.clear();
            self.skipping = false;
            return true;
        }
        false
    }

    /// Feeds bytes read from `offset`. Returns complete lines containing the
    /// bridge prefix. Partial trailing lines are kept for the next call.
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<String> {
        self.offset += chunk.len() as u64;
        let mut out = Vec::new();
        let mut start = 0;
        for (i, &b) in chunk.iter().enumerate() {
            if b == b'\n' {
                self.take_line(&chunk[start..i], &mut out);
                start = i + 1;
            }
        }
        let rest = &chunk[start..];
        if !self.skipping {
            if self.carry.len() + rest.len() > MAX_LINE {
                self.carry.clear();
                self.skipping = true;
            } else {
                self.carry.extend_from_slice(rest);
            }
        }
        out
    }

    fn take_line(&mut self, tail: &[u8], out: &mut Vec<String>) {
        if self.skipping {
            self.skipping = false;
            self.carry.clear();
            return;
        }
        let mut line = std::mem::take(&mut self.carry);
        line.extend_from_slice(tail);
        if line.last() == Some(&b'\r') {
            line.pop();
        }
        if line.len() > MAX_LINE {
            return;
        }
        let text = String::from_utf8_lossy(&line);
        if text.contains(PREFIX) {
            out.push(text.into_owned());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_only_complete_bridge_lines() {
        let mut t = LogTail::new();
        let first: &[u8] = b"[12:00 I] Loading\r\n[12:00 I] x.lua:\tCODEXBRIDGE1 {\"seq\":1}\n[12:00 I] x.lua:\tCODEXBRI";
        let second: &[u8] = b"DGE1 {\"seq\":2}\nnoise\n";
        let a = t.feed(first);
        assert_eq!(a, vec!["[12:00 I] x.lua:\tCODEXBRIDGE1 {\"seq\":1}".to_string()]);
        let b = t.feed(second);
        assert_eq!(b, vec!["[12:00 I] x.lua:\tCODEXBRIDGE1 {\"seq\":2}".to_string()]);
        assert_eq!(t.offset, (first.len() + second.len()) as u64);
    }

    #[test]
    fn restarts_after_truncation() {
        let mut t = LogTail::new();
        t.feed(b"CODEXBRIDGE1 {}\npartial");
        assert!(!t.observe_size(30));
        assert!(t.observe_size(5));
        assert_eq!(t.offset, 0);
        assert_eq!(t.feed(b"CODEXBRIDGE1 {\"new\":1}\n"), vec!["CODEXBRIDGE1 {\"new\":1}".to_string()]);
    }

    #[test]
    fn oversized_lines_are_dropped() {
        let mut t = LogTail::new();
        let big = vec![b'x'; MAX_LINE + 10];
        assert!(t.feed(&big).is_empty());
        assert!(t.feed(b"more CODEXBRIDGE1 tail\nCODEXBRIDGE1 ok\n") == vec!["CODEXBRIDGE1 ok".to_string()]);
    }
}
