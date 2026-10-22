//! Minimal reader for TES3 content files (.esm, .esp, .omwaddon).
//!
//! Layout (all little-endian):
//!   record    = tag[4] size:u32 header1:u32 flags:u32 data[size]
//!   subrecord = tag[4] size:u32 data[size]
//! Records are read-only views into the file buffer; nothing is ever written
//! back to a game file.

pub const RECORD_HEADER: usize = 16;
pub const SUB_HEADER: usize = 8;
/// Record flag marking a deleted record.
pub const FLAG_DELETED: u32 = 0x20;

#[derive(Debug, Clone, Copy)]
pub struct Record<'a> {
    pub tag: [u8; 4],
    pub flags: u32,
    pub data: &'a [u8],
    pub offset: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct Sub<'a> {
    pub tag: [u8; 4],
    pub data: &'a [u8],
}

pub fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

pub fn i32_at(b: &[u8], at: usize) -> Option<i32> {
    u32_at(b, at).map(|v| v as i32)
}

pub fn f32_at(b: &[u8], at: usize) -> Option<f32> {
    u32_at(b, at).map(f32::from_bits)
}

pub struct Records<'a> {
    buf: &'a [u8],
    pos: usize,
    failed: bool,
}

/// Iterates the top-level records of a file. Stops with an error on truncation.
pub fn records(buf: &[u8]) -> Records<'_> {
    Records { buf, pos: 0, failed: false }
}

impl<'a> Iterator for Records<'a> {
    type Item = Result<Record<'a>, String>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.failed || self.pos >= self.buf.len() {
            return None;
        }
        let at = self.pos;
        if at + RECORD_HEADER > self.buf.len() {
            self.failed = true;
            return Some(Err(format!("truncated record header at byte {at}")));
        }
        let tag = [self.buf[at], self.buf[at + 1], self.buf[at + 2], self.buf[at + 3]];
        let size = u32_at(self.buf, at + 4).unwrap_or(0) as usize;
        let flags = u32_at(self.buf, at + 12).unwrap_or(0);
        let start = at + RECORD_HEADER;
        let end = match start.checked_add(size) {
            Some(e) if e <= self.buf.len() => e,
            _ => {
                self.failed = true;
                return Some(Err(format!("record {} at byte {at} runs past the end of the file", tag_str(&tag))));
            }
        };
        self.pos = end;
        Some(Ok(Record { tag, flags, data: &self.buf[start..end], offset: at }))
    }
}

pub struct Subs<'a> {
    data: &'a [u8],
    pos: usize,
    failed: bool,
}

/// Iterates the subrecords inside one record.
pub fn subrecords(data: &[u8]) -> Subs<'_> {
    Subs { data, pos: 0, failed: false }
}

impl<'a> Iterator for Subs<'a> {
    type Item = Result<Sub<'a>, String>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.failed || self.pos >= self.data.len() {
            return None;
        }
        let at = self.pos;
        if at + SUB_HEADER > self.data.len() {
            self.failed = true;
            return Some(Err("truncated subrecord header".into()));
        }
        let tag = [self.data[at], self.data[at + 1], self.data[at + 2], self.data[at + 3]];
        let size = u32_at(self.data, at + 4).unwrap_or(0) as usize;
        let start = at + SUB_HEADER;
        let end = match start.checked_add(size) {
            Some(e) if e <= self.data.len() => e,
            _ => {
                self.failed = true;
                return Some(Err(format!("subrecord {} runs past its record", tag_str(&tag))));
            }
        };
        self.pos = end;
        Some(Ok(Sub { tag, data: &self.data[start..end] }))
    }
}

pub fn tag_str(t: &[u8; 4]) -> String {
    t.iter().map(|&b| if b.is_ascii_graphic() { b as char } else { '?' }).collect()
}

/// True when the buffer starts with a TES3 header record.
pub fn is_tes3(buf: &[u8]) -> bool {
    buf.len() >= 4 && &buf[0..4] == b"TES3"
}

/// Decodes a LAND VHGT subrecord into 65x65 heights (game units / 8),
/// row 0 = southern edge, column 0 = western edge.
pub fn decode_vhgt(data: &[u8]) -> Option<Vec<i32>> {
    const N: usize = 65;
    if data.len() < 4 + N * N {
        return None;
    }
    let offset = f32_at(data, 0)?;
    if !offset.is_finite() {
        return None;
    }
    let deltas = &data[4..4 + N * N];
    let mut out = vec![0i32; N * N];
    let mut row = offset.round() as i32;
    for y in 0..N {
        row += deltas[y * N] as i8 as i32;
        let mut h = row;
        out[y * N] = h;
        for x in 1..N {
            h += deltas[y * N + x] as i8 as i32;
            out[y * N + x] = h;
        }
    }
    Some(out)
}

/// Writer used by tests to build synthetic content files.
pub mod build {
    pub fn sub(tag: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut v = Vec::with_capacity(8 + data.len());
        v.extend_from_slice(tag);
        v.extend_from_slice(&(data.len() as u32).to_le_bytes());
        v.extend_from_slice(data);
        v
    }

    pub fn zstr(s: &str) -> Vec<u8> {
        let mut v = s.as_bytes().to_vec();
        v.push(0);
        v
    }

    pub fn record(tag: &[u8; 4], flags: u32, subs: &[Vec<u8>]) -> Vec<u8> {
        let body: Vec<u8> = subs.concat();
        let mut v = Vec::with_capacity(16 + body.len());
        v.extend_from_slice(tag);
        v.extend_from_slice(&(body.len() as u32).to_le_bytes());
        v.extend_from_slice(&0u32.to_le_bytes());
        v.extend_from_slice(&flags.to_le_bytes());
        v.extend_from_slice(&body);
        v
    }

    pub fn floats(f: &[f32]) -> Vec<u8> {
        f.iter().flat_map(|x| x.to_le_bytes()).collect()
    }

    pub fn ints(i: &[i32]) -> Vec<u8> {
        i.iter().flat_map(|x| x.to_le_bytes()).collect()
    }

    pub fn header() -> Vec<u8> {
        let mut hedr = vec![0u8; 300];
        hedr[0..4].copy_from_slice(&1.3f32.to_le_bytes());
        record(b"TES3", 0, &[sub(b"HEDR", &hedr)])
    }

    /// VHGT whose heights equal `f(x, y)` (in units / 8).
    pub fn vhgt(f: impl Fn(usize, usize) -> i32) -> Vec<u8> {
        const N: usize = 65;
        let mut deltas = vec![0u8; N * N];
        let base = f(0, 0);
        let mut prev_row = base;
        for y in 0..N {
            let first = f(0, y);
            deltas[y * N] = (first - prev_row) as i8 as u8;
            prev_row = first;
            let mut prev = first;
            for x in 1..N {
                let h = f(x, y);
                deltas[y * N + x] = (h - prev) as i8 as u8;
                prev = h;
            }
        }
        let mut v = (base as f32).to_le_bytes().to_vec();
        v.extend_from_slice(&deltas);
        v.extend_from_slice(&[0, 0, 0]);
        v
    }
}

#[cfg(test)]
mod tests {
    use super::build::*;
    use super::*;

    #[test]
    fn iterates_records_and_subrecords() {
        let mut file = header();
        file.extend(record(b"REGN", 0, &[sub(b"NAME", &zstr("ascadian isles region")), sub(b"FNAM", &zstr("Ascadian Isles Region"))]));
        assert!(is_tes3(&file));
        let recs: Vec<_> = records(&file).collect::<Result<_, _>>().unwrap();
        assert_eq!(recs.len(), 2);
        assert_eq!(&recs[1].tag, b"REGN");
        let subs: Vec<_> = subrecords(recs[1].data).collect::<Result<_, _>>().unwrap();
        assert_eq!(subs.len(), 2);
        assert_eq!(crate::text::zstring(subs[1].data), "Ascadian Isles Region");
    }

    #[test]
    fn truncation_is_an_error_not_a_panic() {
        let mut file = header();
        file.extend(record(b"REGN", 0, &[sub(b"NAME", &zstr("x"))]));
        let cut = &file[..file.len() - 3];
        let results: Vec<_> = records(cut).collect();
        assert!(results.last().unwrap().is_err());
        let bad_sub = record(b"CELL", 0, &[]);
        let mut broken = bad_sub.clone();
        broken.extend_from_slice(b"NAME\xff\xff\x00\x00");
        let r = records(&broken).next().unwrap().unwrap();
        assert!(subrecords(r.data).next().is_none());
        assert!(records(b"TES").next().unwrap().is_err());
    }

    #[test]
    fn vhgt_round_trip() {
        let data = vhgt(|x, y| (x as i32) - (y as i32) * 2 + 10);
        let h = decode_vhgt(&data).unwrap();
        assert_eq!(h[0], 10);
        assert_eq!(h[64], 74);
        assert_eq!(h[65 * 64], 10 - 128);
        assert_eq!(h[65 * 64 + 64], 74 - 128);
        assert!(decode_vhgt(&data[..100]).is_none());
    }
}
