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

    // ── Constructor / finish ──────────────────────────────────────────

    #[test]
    fn new_produces_empty_output() {
        let n = TerminalTextNormalizer::new();
        assert_eq!(n.finish(), "");
    }

    #[test]
    fn default_same_as_new() {
        let n = TerminalTextNormalizer::default();
        assert_eq!(n.finish(), "");
    }

    #[test]
    fn finish_strips_trailing_spaces_from_partial_line() {
        let mut n = TerminalTextNormalizer::new();
        n.ingest(b"hello   "); // no newline — content sits in line buffer
        assert_eq!(n.finish(), "hello");
    }

    #[test]
    fn normalize_terminal_bytes_returns_remainder_without_trailing_newline() {
        // If the input doesn't end with '\n', finish() appends the last line.
        let out = normalize_terminal_bytes_for_analysis(b"line1\nline2");
        assert_eq!(out, "line1\nline2");
    }

    // ── Tab expansion ─────────────────────────────────────────────────

    #[test]
    fn tab_expands_to_next_8_column_boundary() {
        let mut n = TerminalTextNormalizer::new();
        // cursor at col 2 after "ab"; next tab stop is col 8 → 6 spaces
        let out = n.ingest(b"ab\t!\n");
        assert_eq!(out, "ab      !\n");
    }

    #[test]
    fn tab_at_column_zero_expands_to_8_spaces() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"\t!\n");
        assert_eq!(out, "        !\n");
    }

    // ── Cursor left (ESC[D) ───────────────────────────────────────────

    #[test]
    fn cursor_left_default_is_one_column() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"abc\x1b[Dx\n"); // ESC[D = move 1 left, overwrite 'c'
        assert_eq!(out, "abx\n");
    }

    #[test]
    fn cursor_left_with_explicit_count() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"abc\x1b[2Dx\n"); // move 2 left → overwrite 'b'
        assert_eq!(out, "axc\n");
    }

    #[test]
    fn cursor_left_clamps_at_column_zero() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"a\x1b[100Dx\n"); // move 100 left from col 1 → col 0
        assert_eq!(out, "x\n");
    }

    // ── Column absolute (ESC[G / ESC[`) ──────────────────────────────

    #[test]
    fn column_absolute_positions_cursor_1based() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[3Gx\n"); // col 3 → 0-based index 2
        assert_eq!(out, "hexlo\n");
    }

    #[test]
    fn column_absolute_backtick_variant() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[2`x\n"); // ESC[2` same as ESC[2G
        assert_eq!(out, "hxllo\n");
    }

    #[test]
    fn column_absolute_default_is_column_1() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[Gx\n"); // no param → col 1 → index 0
        assert_eq!(out, "xello\n");
    }

    // ── Cursor position (ESC[H / ESC[f) ──────────────────────────────

    #[test]
    fn cursor_position_row1_sets_column() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[1;3Hx\n"); // row 1, col 3
        assert_eq!(out, "hexlo\n");
    }

    #[test]
    fn cursor_position_row_gt1_is_noop_on_current_line() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[2;3Hx\n"); // row 2 → no cursor move
        assert_eq!(out, "hellox\n");
    }

    #[test]
    fn cursor_position_f_variant_same_as_h() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[1;2fx\n"); // ESC[1;2f same as ESC[1;2H
        assert_eq!(out, "hxllo\n");
    }

    // ── Erase in line (ESC[K) ─────────────────────────────────────────

    #[test]
    fn erase_line_mode0_truncates_from_cursor_to_end() {
        let mut n = TerminalTextNormalizer::new();
        // "hello" → go to col 3 → write 'X' (line="heXlo", cursor=3) → ESC[K truncates at 3
        let out = n.ingest(b"hello\x1b[3GX\x1b[K\n");
        assert_eq!(out, "heX\n");
    }

    #[test]
    fn erase_line_mode0_noop_when_cursor_at_end() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[K\n"); // cursor already at end → no truncation
        assert_eq!(out, "hello\n");
    }

    #[test]
    fn erase_line_mode1_fills_before_cursor_with_spaces() {
        let mut n = TerminalTextNormalizer::new();
        // "hello" → go to col 3 → ESC[1K fills [0..2] with spaces → write 'x' at 2
        let out = n.ingest(b"hello\x1b[3G\x1b[1Kx\n");
        assert_eq!(out, "  xlo\n");
    }

    #[test]
    fn erase_line_mode2_clears_entire_line() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[2Kworld\n");
        assert_eq!(out, "world\n");
    }

    // ── Delete / insert / erase characters ───────────────────────────

    #[test]
    fn delete_chars_removes_at_cursor() {
        let mut n = TerminalTextNormalizer::new();
        // "hello" → col 3 → delete 2 chars → removes chars at index 2 and 3
        let out = n.ingest(b"hello\x1b[3G\x1b[2P\n");
        assert_eq!(out, "heo\n");
    }

    #[test]
    fn delete_chars_default_is_one() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[3G\x1b[P\n"); // delete 1 char at index 2
        assert_eq!(out, "helo\n");
    }

    #[test]
    fn insert_chars_inserts_spaces_at_cursor() {
        let mut n = TerminalTextNormalizer::new();
        // "hello" → col 3 → insert 2 spaces → shifts right
        let out = n.ingest(b"hello\x1b[3G\x1b[2@\n");
        assert_eq!(out, "he  llo\n");
    }

    #[test]
    fn erase_chars_overwrites_with_spaces_without_moving_cursor() {
        let mut n = TerminalTextNormalizer::new();
        // "hello" → go to col 2 → ESC[3X fills [1..4] with spaces → write '!'
        let out = n.ingest(b"hello\x1b[2G\x1b[3X!\n");
        assert_eq!(out, "h!  o\n");
    }

    // ── Erase in display (ESC[J) ──────────────────────────────────────

    #[test]
    fn erase_display_mode2_clears_screen_buffer() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[2Jworld\n");
        assert_eq!(out, "world\n");
    }

    #[test]
    fn erase_display_mode3_also_clears_screen_buffer() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[3Jworld\n");
        assert_eq!(out, "world\n");
    }

    #[test]
    fn erase_display_mode0_is_ignored() {
        // Only modes 2 and 3 are handled; mode 0 is a no-op in this context.
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[0Jworld\n");
        assert_eq!(out, "helloworld\n");
    }

    // ── Cursor save / restore (ESC[s / ESC[u) ────────────────────────

    #[test]
    fn cursor_save_and_restore_roundtrip() {
        let mut n = TerminalTextNormalizer::new();
        // "hello" → save (col 5) → go to col 3 → write 'y' → restore (col 5) → write 'z'
        let out = n.ingest(b"hello\x1b[sX\x1b[3Gy\x1b[uz\n");
        assert_eq!(out, "heyloz\n");
    }

    #[test]
    fn cursor_restore_without_prior_save_is_noop() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"abc\x1b[ux\n"); // no ESC[s before → cursor unchanged
        assert_eq!(out, "abcx\n");
    }

    // ── EscConsumeOne (ESC( / ESC) / ESC* / ESC+) ────────────────────

    #[test]
    fn esc_consume_one_drops_following_byte() {
        let mut n = TerminalTextNormalizer::new();
        // ESC( introduces a character-set designation; next byte is the charset code
        let out = n.ingest(b"abc\x1b(Bxyz\n"); // 'B' is consumed silently
        assert_eq!(out, "abcxyz\n");
    }

    #[test]
    fn esc_paren_close_also_consumes_one_byte() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"ab\x1b)0cd\n"); // '0' consumed
        assert_eq!(out, "abcd\n");
    }

    // ── OSC with ESC-backslash terminator (ST) ────────────────────────

    #[test]
    fn osc_terminated_by_bel_is_fully_stripped() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"\x1b]2;window title\x07after\n");
        assert_eq!(out, "after\n");
    }

    #[test]
    fn osc_terminated_by_esc_backslash_is_fully_stripped() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"\x1b]0;title\x1b\\after\n");
        assert_eq!(out, "after\n");
    }

    // ── Unknown CSI final byte ────────────────────────────────────────

    #[test]
    fn csi_unknown_final_byte_is_silently_ignored() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"abc\x1b[99Zabc\n");
        assert_eq!(out, "abcabc\n");
    }

    // ── CSI parameter parsing edge cases ─────────────────────────────

    #[test]
    fn csi_multiple_params_parsed_correctly() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[1;1Hx\n"); // row 1 col 1 → cursor at 0
        assert_eq!(out, "xello\n");
    }

    // ── UTF-8 handling ────────────────────────────────────────────────

    #[test]
    fn multibyte_utf8_chars_pass_through_intact() {
        let out = normalize_terminal_bytes_for_analysis("héllo\n".as_bytes());
        assert_eq!(out, "héllo\n");
    }

    #[test]
    fn invalid_utf8_byte_replaced_with_replacement_char() {
        // 0xFF is never valid UTF-8
        let out = normalize_terminal_bytes_for_analysis(b"a\xffb\n");
        assert_eq!(out, "a\u{fffd}b\n");
    }

    #[test]
    fn truncated_utf8_sequence_at_eof_is_dropped() {
        // 0xC3 alone is an incomplete 2-byte sequence; pending flush at finish()
        // emits nothing for the partial sequence (no valid char).
        let mut n = TerminalTextNormalizer::new();
        n.ingest(b"a");
        n.ingest(b"\xC3"); // start of 'é' but no continuation byte
                           // finish() calls flush_pending_utf8 which hits the `break` for incomplete seqs
        let out = n.finish();
        assert_eq!(out, "a");
    }

    // ── ESC + unknown byte (EscapeState::Esc fallthrough) ────────────

    #[test]
    fn esc_followed_by_unknown_byte_is_silently_dropped() {
        // ESC followed by a byte that is not [, ], (, ), *, + → ignored
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"ab\x1bZcd\n"); // ESC Z — unknown; Z passes through as normal
                                            // After ESC the state is Esc; 'Z' doesn't match any arm → _ => {}
                                            // so both ESC and Z are dropped
        assert_eq!(out, "abcd\n");
    }

    // ── OSC: esc_seen=true followed by non-backslash resets esc_seen ─

    #[test]
    fn osc_esc_seen_followed_by_non_backslash_continues_osc() {
        // ESC inside OSC sets esc_seen=true; the next byte is not '\' so esc_seen
        // resets to false and OSC continues. The BEL then terminates it cleanly.
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"\x1b]0;ti\x1bXtle\x07after\n");
        assert_eq!(out, "after\n");
    }

    // ── Control byte catchall ─────────────────────────────────────────

    #[test]
    fn unrecognised_control_byte_is_silently_ignored() {
        // Bytes < 0x20 that are not \n \r 0x08 \t fall through to _ => {}
        let mut n = TerminalTextNormalizer::new();
        // 0x01 = Ctrl-A, 0x07 = BEL (outside OSC), 0x0E = Shift-Out
        let out = n.ingest(b"a\x01b\x07c\x0Ed\n");
        assert_eq!(out, "abcd\n");
    }

    // ── flush_line trims trailing spaces ──────────────────────────────

    #[test]
    fn flush_line_strips_trailing_spaces_on_newline() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello   \n"); // trailing spaces before \n
        assert_eq!(out, "hello\n");
    }

    // ── ensure_line_len pads with spaces when cursor beyond line end ──

    #[test]
    fn writing_past_line_end_pads_with_spaces() {
        let mut n = TerminalTextNormalizer::new();
        // Empty line; ESC[5G moves cursor to col 5 (index 4);
        // writing 'x' triggers ensure_line_len(4) → 4 spaces are inserted
        let out = n.ingest(b"\x1b[5Gx\n");
        assert_eq!(out, "    x\n");
    }

    // ── parse_csi_params: empty raw → single None param ──────────────

    #[test]
    fn csi_with_empty_params_uses_defaults() {
        // ESC[H with no params → parse_csi_params([]) → params=[None] → defaults 1,1
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[Hx\n"); // cursor to (1,1) → index 0
        assert_eq!(out, "xello\n");
    }

    // ── parse_csi_params: trailing semicolon → trailing None ─────────

    #[test]
    fn csi_trailing_semicolon_appends_none_param() {
        // ESC[1;H → raw=[b'1',b';'] → params=[Some(1), None] → row=1 col=default 1
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[1;Hx\n");
        assert_eq!(out, "xello\n");
    }

    // ── Erase line: unknown mode is a no-op ───────────────────────────

    #[test]
    fn erase_line_unknown_mode_is_noop() {
        let mut n = TerminalTextNormalizer::new();
        let out = n.ingest(b"hello\x1b[3Kworld\n"); // mode 3 → _ => {} catchall
        assert_eq!(out, "helloworld\n");
    }
}
