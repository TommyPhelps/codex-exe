//! Parses `tasklist /FO CSV /NH` output into lower-case executable names.

pub fn parse_tasklist_csv(out: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for line in out.lines() {
        let line = line.trim();
        if !line.starts_with('"') {
            continue;
        }
        if let Some(end) = line[1..].find('"') {
            let name = line[1..1 + end].trim().to_lowercase();
            if !name.is_empty() && !names.contains(&name) {
                names.push(name);
            }
        }
    }
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_names() {
        let out = "\"System Idle Process\",\"0\",\"Services\",\"0\",\"8 K\"\r\n\"Morrowind.exe\",\"4242\",\"Console\",\"1\",\"512,000 K\"\r\n\"openmw.exe\",\"1\",\"Console\",\"1\",\"1 K\"\r\n\"MORROWIND.EXE\",\"9\",\"Console\",\"1\",\"1 K\"\r\nINFO: No tasks\r\n";
        assert_eq!(parse_tasklist_csv(out), vec!["system idle process", "morrowind.exe", "openmw.exe"]);
    }
}
