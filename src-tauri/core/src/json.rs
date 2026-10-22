//! A tiny JSON writer (the core crate has no dependencies).

pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c == '\u{2028}' || c == '\u{2029}' => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Finite numbers with at most one decimal; non-finite becomes 0.
pub fn num(v: f64) -> String {
    if !v.is_finite() {
        return "0".into();
    }
    let r = (v * 10.0).round() / 10.0;
    if r == r.trunc() && r.abs() < 1e15 {
        format!("{}", r as i64)
    } else {
        format!("{:.1}", r)
    }
}

/// Builds a JSON object field by field.
pub struct Obj {
    parts: Vec<String>,
}

impl Obj {
    pub fn new() -> Self {
        Obj { parts: Vec::new() }
    }
    pub fn str(mut self, k: &str, v: &str) -> Self {
        self.parts.push(format!("{}:{}", escape(k), escape(v)));
        self
    }
    pub fn num(mut self, k: &str, v: f64) -> Self {
        self.parts.push(format!("{}:{}", escape(k), num(v)));
        self
    }
    pub fn int(mut self, k: &str, v: i64) -> Self {
        self.parts.push(format!("{}:{}", escape(k), v));
        self
    }
    pub fn bool(mut self, k: &str, v: bool) -> Self {
        self.parts.push(format!("{}:{}", escape(k), v));
        self
    }
    pub fn raw(mut self, k: &str, json: String) -> Self {
        self.parts.push(format!("{}:{}", escape(k), json));
        self
    }
    pub fn build(self) -> String {
        format!("{{{}}}", self.parts.join(","))
    }
}

impl Default for Obj {
    fn default() -> Self {
        Self::new()
    }
}

pub fn array(items: Vec<String>) -> String {
    format!("[{}]", items.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_and_numbers() {
        assert_eq!(escape("a\"b\\c\nd\u{1}"), "\"a\\\"b\\\\c\\nd\\u0001\"");
        assert_eq!(num(12.0), "12");
        assert_eq!(num(-3.14159), "-3.1");
        assert_eq!(num(f64::NAN), "0");
        let o = Obj::new().str("name", "Ald'ruhn").int("n", -2).bool("ok", true).raw("list", array(vec!["1".into(), "2".into()])).build();
        assert_eq!(o, "{\"name\":\"Ald'ruhn\",\"n\":-2,\"ok\":true,\"list\":[1,2]}");
    }
}
