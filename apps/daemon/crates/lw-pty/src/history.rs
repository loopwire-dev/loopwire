use std::collections::VecDeque;

pub(crate) const OUTPUT_HISTORY_MAX_BYTES: usize = 8 * 1024 * 1024;

pub(crate) struct OutputSlice {
    pub(crate) data: Vec<u8>,
    pub(crate) start_offset: usize,
    pub(crate) end_offset: usize,
    pub(crate) has_more: bool,
}

pub(crate) struct OutputHistory {
    chunks: VecDeque<Vec<u8>>,
    total_bytes: usize,
    max_bytes: usize,
    start_offset: usize,
    end_offset: usize,
}

impl OutputHistory {
    pub(crate) fn new(max_bytes: usize) -> Self {
        Self {
            chunks: VecDeque::new(),
            total_bytes: 0,
            max_bytes,
            start_offset: 0,
            end_offset: 0,
        }
    }

    pub(crate) fn push(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }

        let chunk = data.to_vec();
        self.total_bytes = self.total_bytes.saturating_add(chunk.len());
        self.end_offset = self.end_offset.saturating_add(chunk.len());
        self.chunks.push_back(chunk);

        while self.total_bytes > self.max_bytes {
            if let Some(removed) = self.chunks.pop_front() {
                self.total_bytes = self.total_bytes.saturating_sub(removed.len());
                self.start_offset = self.start_offset.saturating_add(removed.len());
            } else {
                break;
            }
        }
    }

    pub(crate) fn snapshot(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.total_bytes);
        for chunk in &self.chunks {
            out.extend_from_slice(chunk);
        }
        out
    }

    pub(crate) fn snapshot_chunked(&self, max_chunk_bytes: usize) -> Vec<Vec<u8>> {
        if max_chunk_bytes == 0 || self.total_bytes == 0 {
            return Vec::new();
        }

        let mut chunks: Vec<Vec<u8>> = Vec::new();
        let mut current = Vec::with_capacity(max_chunk_bytes.min(self.total_bytes));

        for chunk in &self.chunks {
            let mut offset = 0usize;
            while offset < chunk.len() {
                if current.len() == max_chunk_bytes {
                    chunks.push(current);
                    current = Vec::with_capacity(max_chunk_bytes);
                }

                let remaining = max_chunk_bytes - current.len();
                let take = remaining.min(chunk.len() - offset);
                current.extend_from_slice(&chunk[offset..offset + take]);
                offset += take;
            }
        }

        if !current.is_empty() {
            chunks.push(current);
        }

        chunks
    }

    pub(crate) fn slice_before(
        &self,
        before_offset: Option<usize>,
        max_bytes: usize,
    ) -> OutputSlice {
        let retained_start = self.start_offset;
        let retained_end = self.end_offset;

        if self.total_bytes == 0 || max_bytes == 0 || retained_start >= retained_end {
            return OutputSlice {
                data: Vec::new(),
                start_offset: retained_start,
                end_offset: retained_start,
                has_more: false,
            };
        }

        let clamped_end = before_offset
            .unwrap_or(retained_end)
            .min(retained_end)
            .max(retained_start);

        if clamped_end <= retained_start {
            return OutputSlice {
                data: Vec::new(),
                start_offset: retained_start,
                end_offset: retained_start,
                has_more: false,
            };
        }

        let available = clamped_end - retained_start;
        let take = available.min(max_bytes);
        let start = clamped_end - take;
        let end = clamped_end;

        let mut out = Vec::with_capacity(take);
        let mut cursor = retained_start;
        for chunk in &self.chunks {
            let chunk_start = cursor;
            let chunk_end = chunk_start.saturating_add(chunk.len());
            cursor = chunk_end;

            if chunk_end <= start {
                continue;
            }
            if chunk_start >= end {
                break;
            }

            let from = start.saturating_sub(chunk_start);
            let to = (end.min(chunk_end)).saturating_sub(chunk_start);
            if from < to && to <= chunk.len() {
                out.extend_from_slice(&chunk[from..to]);
            }
        }

        OutputSlice {
            data: out,
            start_offset: start,
            end_offset: end,
            has_more: start > retained_start,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_and_snapshot_basic() {
        let mut history = OutputHistory::new(1024);
        history.push(b"hello ");
        history.push(b"world");
        assert_eq!(history.snapshot(), b"hello world");
    }

    #[test]
    fn push_empty_is_noop() {
        let mut history = OutputHistory::new(1024);
        history.push(b"data");
        history.push(b"");
        assert_eq!(history.snapshot(), b"data");
        assert_eq!(history.chunks.len(), 1);
    }

    #[test]
    fn evicts_oldest_when_over_max() {
        let mut history = OutputHistory::new(10);
        history.push(b"aaaa"); // 4 bytes
        history.push(b"bbbb"); // 8 bytes total
        history.push(b"cccc"); // 12 bytes -> evict "aaaa" -> 8 bytes
        let snap = history.snapshot();
        assert_eq!(snap, b"bbbbcccc");
        assert!(history.total_bytes <= 10);
        assert_eq!(history.start_offset, 4);
        assert_eq!(history.end_offset, 12);
    }

    #[test]
    fn single_chunk_larger_than_max() {
        let mut history = OutputHistory::new(4);
        history.push(b"this is way too long");
        // The chunk is added, then eviction removes it since it exceeds max
        // After eviction the buffer should be empty since the single chunk > max
        // Actually: push adds it (total=20), then while loop pops it (total=0)
        assert_eq!(history.snapshot(), b"");
        assert_eq!(history.total_bytes, 0);
    }

    #[test]
    fn snapshot_chunked_roundtrips() {
        let mut history = OutputHistory::new(1024);
        history.push(b"hello ");
        history.push(b"world!");
        history.push(b" more bytes");

        let chunks = history.snapshot_chunked(4);
        assert_eq!(chunks.len(), 6);

        let joined: Vec<u8> = chunks.into_iter().flatten().collect();
        assert_eq!(joined, b"hello world! more bytes");
    }

    #[test]
    fn slice_before_defaults_to_tail() {
        let mut history = OutputHistory::new(1024);
        history.push(b"hello ");
        history.push(b"world");

        let slice = history.slice_before(None, 5);
        assert_eq!(slice.data, b"world");
        assert_eq!(slice.start_offset, 6);
        assert_eq!(slice.end_offset, 11);
        assert!(slice.has_more);
    }

    #[test]
    fn slice_before_respects_before_offset() {
        let mut history = OutputHistory::new(1024);
        history.push(b"abcdefghij");

        let slice = history.slice_before(Some(7), 3);
        assert_eq!(slice.data, b"efg");
        assert_eq!(slice.start_offset, 4);
        assert_eq!(slice.end_offset, 7);
        assert!(slice.has_more);
    }

    #[test]
    fn slice_before_with_evicted_prefix_has_no_more_at_retained_start() {
        let mut history = OutputHistory::new(8);
        history.push(b"aaaa");
        history.push(b"bbbb");
        history.push(b"cccc"); // retained = "bbbbcccc", start_offset = 4

        let slice = history.slice_before(Some(8), 4);
        assert_eq!(slice.data, b"bbbb");
        assert_eq!(slice.start_offset, 4);
        assert_eq!(slice.end_offset, 8);
        assert!(!slice.has_more);
    }

    #[test]
    fn snapshot_chunked_returns_empty_when_max_chunk_bytes_is_zero() {
        let mut history = OutputHistory::new(1024);
        history.push(b"data");
        let chunks = history.snapshot_chunked(0);
        assert!(chunks.is_empty());
    }

    #[test]
    fn snapshot_chunked_returns_empty_when_history_is_empty() {
        let history = OutputHistory::new(1024);
        let chunks = history.snapshot_chunked(16);
        assert!(chunks.is_empty());
    }

    #[test]
    fn slice_before_returns_empty_when_max_bytes_is_zero() {
        let mut history = OutputHistory::new(1024);
        history.push(b"hello");
        let slice = history.slice_before(None, 0);
        assert!(slice.data.is_empty());
        assert!(!slice.has_more);
    }

    #[test]
    fn slice_before_returns_empty_when_history_is_empty() {
        let history = OutputHistory::new(1024);
        let slice = history.slice_before(None, 100);
        assert!(slice.data.is_empty());
        assert!(!slice.has_more);
    }

    #[test]
    fn slice_before_offset_before_retained_window_returns_empty() {
        // Push enough data to cause eviction so retained_start > 0.
        let mut history = OutputHistory::new(8);
        history.push(b"aaaa"); // 4 bytes
        history.push(b"bbbb"); // 8 total
        history.push(b"cccc"); // 12 > 8 → evict "aaaa", retain "bbbbcccc", start=4

        // Request data before the retained window (before_offset=2 < retained_start=4)
        let slice = history.slice_before(Some(2), 4);
        assert!(slice.data.is_empty());
        assert!(!slice.has_more);
    }
}
