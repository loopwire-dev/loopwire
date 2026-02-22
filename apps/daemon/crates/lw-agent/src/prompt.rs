pub(crate) fn has_prompt_hint(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }

    let text = String::from_utf8_lossy(bytes);
    let cleaned = strip_ansi_sequences(&text);
    let Some(last_line) = cleaned
        .lines()
        .rev()
        .map(str::trim_end)
        .find(|line| !line.trim().is_empty())
    else {
        return false;
    };

    let line = last_line.trim();
    if line.len() > 200 {
        return false;
    }

    let lower = line.to_ascii_lowercase();
    if lower.contains("press enter")
        || lower.contains("continue?")
        || lower.contains("y/n")
        || lower.ends_with("?>")
    {
        return true;
    }

    let prompt_markers = ["$", "$ ", "%", "% ", "#", "# ", ">", "> "];
    prompt_markers.iter().any(|marker| line.ends_with(marker))
}

pub(crate) fn strip_ansi_sequences(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\u{1b}' {
            out.push(ch);
            continue;
        }

        if chars.peek().copied() == Some('[') {
            chars.next();
            for next in chars.by_ref() {
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
        } else if chars.peek().copied() == Some(']') {
            chars.next();
            for next in chars.by_ref() {
                if next == '\u{7}' {
                    break;
                }
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_hint_shell_prompts() {
        assert!(has_prompt_hint(b"$ "));
        assert!(has_prompt_hint(b"> "));
        assert!(has_prompt_hint(b"% "));
        assert!(has_prompt_hint(b"# "));
        assert!(has_prompt_hint(b"$"));
        assert!(has_prompt_hint(b">"));
        assert!(has_prompt_hint(b"press enter to continue"));
        assert!(has_prompt_hint(b"continue?"));
        assert!(has_prompt_hint(b"proceed? y/n"));
    }

    #[test]
    fn prompt_hint_question_arrow() {
        assert!(has_prompt_hint(b"Select option?>"));
    }

    #[test]
    fn prompt_hint_with_ansi_codes() {
        assert!(has_prompt_hint(b"\x1b[32m$ \x1b[0m"));
    }

    #[test]
    fn prompt_hint_multiline_uses_last_nonempty() {
        assert!(has_prompt_hint(b"output line\n$ "));
        assert!(!has_prompt_hint(b"output line\n"));
    }

    #[test]
    fn prompt_hint_whitespace_only_lines() {
        assert!(!has_prompt_hint(b"   \n   \n   "));
    }

    #[test]
    fn prompt_hint_negative_cases() {
        let long = "x".repeat(201);
        assert!(!has_prompt_hint(long.as_bytes()));
        assert!(!has_prompt_hint(b""));
        assert!(!has_prompt_hint(b"compiling main.rs..."));
    }

    #[test]
    fn prompt_hint_exactly_200_chars() {
        let line = "x".repeat(199) + "$";
        assert!(has_prompt_hint(line.as_bytes()));
    }

    #[test]
    fn strip_ansi_csi() {
        assert_eq!(strip_ansi_sequences("\x1b[31mhello\x1b[0m"), "hello");
    }

    #[test]
    fn strip_ansi_osc() {
        assert_eq!(strip_ansi_sequences("\x1b]0;title\x07text"), "text");
    }

    #[test]
    fn strip_ansi_plain() {
        assert_eq!(strip_ansi_sequences("plain text"), "plain text");
    }

    #[test]
    fn strip_ansi_bare_escape() {
        // Bare escape (not followed by [ or ]) is consumed but the next char is kept
        assert_eq!(strip_ansi_sequences("\x1bXhello"), "Xhello");
    }

    #[test]
    fn strip_ansi_multiple_sequences() {
        assert_eq!(
            strip_ansi_sequences("\x1b[1m\x1b[31mbold red\x1b[0m"),
            "bold red"
        );
    }
}
