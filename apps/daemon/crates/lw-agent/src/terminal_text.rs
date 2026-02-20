enum EscapeState {
    None,
    Esc,
    EscConsumeOne,
    Csi(Vec<u8>),
    Osc { esc_seen: bool },
}

/// Incremental converter from raw terminal bytes to readable text.
/// Keeps destructive/control sequences out of the output.
pub struct TerminalTextNormalizer {
    line: Vec<char>,
    cursor: usize,
    saved_cursor: Option<usize>,
    pending_utf8: Vec<u8>,
    escape_state: EscapeState,
}

impl Default for TerminalTextNormalizer {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalTextNormalizer {
    pub fn new() -> Self {
        Self {
            line: Vec::new(),
            cursor: 0,
            saved_cursor: None,
            pending_utf8: Vec::new(),
            escape_state: EscapeState::None,
        }
    }

    pub fn ingest(&mut self, bytes: &[u8]) -> String {
        let mut emitted = String::new();
        for byte in bytes {
            self.process_byte(*byte, &mut emitted);
        }
        self.flush_pending_utf8();
        emitted
    }

    pub fn finish(mut self) -> String {
        self.flush_pending_utf8();
        let mut line: String = self.line.iter().collect();
        while line.ends_with(' ') {
            line.pop();
        }
        line
    }

    fn process_byte(&mut self, byte: u8, emitted: &mut String) {
        let state = std::mem::replace(&mut self.escape_state, EscapeState::None);
        match state {
            EscapeState::None => {
                if byte == 0x1b {
                    self.flush_pending_utf8();
                    self.escape_state = EscapeState::Esc;
                    return;
                }
                if byte < 0x20 || byte == 0x7f {
                    self.flush_pending_utf8();
                    self.handle_control(byte, emitted);
                    return;
                }
                self.pending_utf8.push(byte);
            }
            EscapeState::Esc => match byte {
                b'[' => self.escape_state = EscapeState::Csi(Vec::new()),
                b']' => self.escape_state = EscapeState::Osc { esc_seen: false },
                b'(' | b')' | b'*' | b'+' => self.escape_state = EscapeState::EscConsumeOne,
                _ => {}
            },
            EscapeState::EscConsumeOne => {}
            EscapeState::Csi(mut params) => {
                if (0x40..=0x7e).contains(&byte) {
                    self.apply_csi(byte, &params);
                } else if params.len() < 128 {
                    params.push(byte);
                    self.escape_state = EscapeState::Csi(params);
                }
            }
            EscapeState::Osc { mut esc_seen } => {
                if esc_seen {
                    if byte == b'\\' {
                        return;
                    }
                    esc_seen = false;
                    self.escape_state = EscapeState::Osc { esc_seen };
                    return;
                }
                if byte == 0x07 {
                    return;
                }
                if byte == 0x1b {
                    esc_seen = true;
                }
                self.escape_state = EscapeState::Osc { esc_seen };
            }
        }
    }

    fn flush_pending_utf8(&mut self) {
        while !self.pending_utf8.is_empty() {
            match std::str::from_utf8(&self.pending_utf8) {
                Ok(valid) => {
                    let owned = valid.to_owned();
                    for ch in owned.chars() {
                        self.write_char(ch);
                    }
                    self.pending_utf8.clear();
                }
                Err(err) => {
                    let valid_up_to = err.valid_up_to();
                    if valid_up_to > 0 {
                        if let Ok(prefix) = std::str::from_utf8(&self.pending_utf8[..valid_up_to]) {
                            let owned = prefix.to_owned();
                            for ch in owned.chars() {
                                self.write_char(ch);
                            }
                        }
                        self.pending_utf8.drain(..valid_up_to);
                        continue;
                    }

                    if err.error_len().is_some() {
                        self.pending_utf8.drain(..1);
                        self.write_char('\u{fffd}');
                    } else {
                        break;
                    }
                }
            }
        }
    }

    fn handle_control(&mut self, byte: u8, emitted: &mut String) {
        match byte {
            b'\n' => self.flush_line(emitted),
            b'\r' => self.cursor = 0,
            0x08 => self.cursor = self.cursor.saturating_sub(1),
            b'\t' => {
                let spaces = 8 - (self.cursor % 8);
                for _ in 0..spaces {
                    self.write_char(' ');
                }
            }
            _ => {}
        }
    }

    fn flush_line(&mut self, emitted: &mut String) {
        self.flush_pending_utf8();
        let mut line: String = self.line.iter().collect();
        while line.ends_with(' ') {
            line.pop();
        }
        emitted.push_str(&line);
        emitted.push('\n');
        self.line.clear();
        self.cursor = 0;
    }

    fn ensure_line_len(&mut self, len: usize) {
        while self.line.len() < len {
            self.line.push(' ');
        }
    }

    fn write_char(&mut self, ch: char) {
        if self.cursor < self.line.len() {
            self.line[self.cursor] = ch;
        } else {
            self.ensure_line_len(self.cursor);
            self.line.push(ch);
        }
        self.cursor = self.cursor.saturating_add(1);
    }

    fn csi_param(params: &[Option<usize>], index: usize, default: usize) -> usize {
        params.get(index).and_then(|v| *v).unwrap_or(default)
    }

    fn parse_csi_params(raw: &[u8]) -> Vec<Option<usize>> {
        let mut params = Vec::new();
        let mut current: Option<usize> = None;
        let mut saw_digit = false;

        for byte in raw {
            match byte {
                b'0'..=b'9' => {
                    saw_digit = true;
                    current = Some(
                        current
                            .unwrap_or(0)
                            .saturating_mul(10)
                            .saturating_add((byte - b'0') as usize),
                    );
                }
                b';' => {
                    params.push(if saw_digit { current } else { None });
                    current = None;
                    saw_digit = false;
                }
                _ => {}
            }
        }

        if saw_digit {
            params.push(current);
        } else if raw.last() == Some(&b';') {
            params.push(None);
        }
        if params.is_empty() {
            params.push(None);
        }

        params
    }

    fn apply_csi(&mut self, final_byte: u8, raw_params: &[u8]) {
        let params = Self::parse_csi_params(raw_params);
        match final_byte {
            b'C' => {
                let amount = Self::csi_param(&params, 0, 1);
                self.cursor = self.cursor.saturating_add(amount.max(1));
            }
            b'D' => {
                let amount = Self::csi_param(&params, 0, 1);
                self.cursor = self.cursor.saturating_sub(amount.max(1));
            }
            b'G' | b'`' => {
                let col = Self::csi_param(&params, 0, 1);
                self.cursor = col.saturating_sub(1);
            }
            b'H' | b'f' => {
                let row = Self::csi_param(&params, 0, 1);
                let col = Self::csi_param(&params, 1, 1);
                if row == 1 {
                    self.cursor = col.saturating_sub(1);
                }
            }
            b'K' => {
                let mode = Self::csi_param(&params, 0, 0);
                match mode {
                    0 => {
                        if self.cursor < self.line.len() {
                            self.line.truncate(self.cursor);
                        }
                    }
                    1 => {
                        let end = self.cursor.min(self.line.len());
                        for idx in 0..end {
                            self.line[idx] = ' ';
                        }
                    }
                    2 => {
                        self.line.clear();
                        self.cursor = 0;
                    }
                    _ => {}
                }
            }
            b'P' => {
                let amount = Self::csi_param(&params, 0, 1).max(1);
                if self.cursor < self.line.len() {
                    let end = self.cursor.saturating_add(amount).min(self.line.len());
                    self.line.drain(self.cursor..end);
                }
            }
            b'@' => {
                let amount = Self::csi_param(&params, 0, 1).max(1);
                self.ensure_line_len(self.cursor);
                for _ in 0..amount {
                    self.line.insert(self.cursor, ' ');
                }
            }
            b'X' => {
                let amount = Self::csi_param(&params, 0, 1).max(1);
                let end = self.cursor.saturating_add(amount);
                self.ensure_line_len(end);
                for idx in self.cursor..end {
                    self.line[idx] = ' ';
                }
            }
            b'J' => {
                let mode = Self::csi_param(&params, 0, 0);
                if mode == 2 || mode == 3 {
                    self.line.clear();
                    self.cursor = 0;
                }
            }
            b's' => self.saved_cursor = Some(self.cursor),
            b'u' => {
                if let Some(saved) = self.saved_cursor {
                    self.cursor = saved;
                }
            }
            _ => {}
        }
    }
}

pub fn normalize_terminal_bytes_for_analysis(bytes: &[u8]) -> String {
    let mut normalizer = TerminalTextNormalizer::new();
    let mut out = normalizer.ingest(bytes);
    let remainder = normalizer.finish();
    if !remainder.is_empty() {
        out.push_str(&remainder);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_overwrite_with_clear_line() {
        let mut normalizer = TerminalTextNormalizer::new();
        let mut out = normalizer.ingest(b"progress 10%");
        out.push_str(&normalizer.ingest(b"\r\x1b[2Kprogress 11%\n"));
        assert_eq!(out, "progress 11%\n");
    }

    #[test]
    fn handles_backspaces() {
        let mut normalizer = TerminalTextNormalizer::new();
        let out = normalizer.ingest(b"abc\x08\x08XY\n");
        assert_eq!(out, "aXY\n");
    }

    #[test]
    fn strips_sgr_and_osc() {
        let out =
            normalize_terminal_bytes_for_analysis(b"\x1b[31mred\x1b[0m\n\x1b]0;title\x07plain\n");
        assert_eq!(out, "red\nplain\n");
    }

    #[test]
    fn supports_cursor_horizontal_movement() {
        let mut normalizer = TerminalTextNormalizer::new();
        let out = normalizer.ingest(b"hello\r\x1b[3C!\n");
        assert_eq!(out, "hel!o\n");
    }
}
