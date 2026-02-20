import { useCallback, useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { useScrollback } from "./useScrollback";
import { binaryStringToBytes } from "./TerminalPagingController";

const THEMES = {
  dark: {
    background: "#242424",
    foreground: "#d4d4d4",
    cursor: "#aeafad",
    selectionBackground: "#264f78",
  },
  light: {
    background: "#ffffff",
    foreground: "#333333",
    cursor: "#000000",
    selectionBackground: "#add6ff",
  },
} as const;

interface ScrollbackOverlayProps {
  sessionId: string;
  theme: "dark" | "light";
  onDismiss: () => void;
}

export function ScrollbackOverlay({ sessionId, theme, onDismiss }: ScrollbackOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const topWheelLatchRef = useRef(false);
  const { pages, loading, hasMore, error, fetchInitial, fetchMore, reset } = useScrollback();
  const canLoadOlder = hasMore && pages.length > 0 && pages[0]?.has_more === true;

  // Fetch initial scrollback on mount
  useEffect(() => {
    fetchInitial(sessionId);
    return () => reset();
  }, [sessionId, fetchInitial, reset]);

  // Create xterm instance
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new XTerm({
      allowProposedApi: true,
      disableStdin: true,
      cursorBlink: false,
      fontFamily: 'Monaco, Menlo, "Courier New", monospace',
      fontSize: 14,
      scrollback: 200_000,
      theme: THEMES[theme],
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // fallback
    }

    term.open(container);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(container);

    return () => {
      observer.disconnect();
      termRef.current = null;
      fitRef.current = null;
      setTimeout(() => {
        try { term.dispose(); } catch { /* no-op */ }
      }, 0);
    };
  }, [theme]);

  // Write raw PTY bytes when pages change
  useEffect(() => {
    const term = termRef.current;
    if (!term || pages.length === 0) return;

    term.reset();
    for (const page of pages) {
      term.write(binaryStringToBytes(atob(page.data)));
    }
    // Keep overlay anchored to top of the loaded scrollback window.
    requestAnimationFrame(() => term.scrollToTop());
  }, [pages]);

  // Handle Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onDismiss]);

  // Handle scroll-to-top to load more
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      const term = termRef.current;
      if (!term) return;

      const vp = term.element?.querySelector<HTMLElement>(".xterm-viewport");
      if (!vp) return;

      // Reset latch only on deliberate downward scrolling, not on
      // transient viewport changes during re-render/pagination.
      if (e.deltaY > 0) {
        topWheelLatchRef.current = false;
        requestAnimationFrame(() => {
          const viewport =
            termRef.current?.element?.querySelector<HTMLElement>(".xterm-viewport");
          if (!viewport) return;
          const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
          if (maxScrollTop > 0 && viewport.scrollTop >= maxScrollTop - 2) {
            onDismiss();
          }
        });
        return;
      }

      if (!hasMore || loading) return;
      if (vp.scrollTop === 0 && e.deltaY < 0 && !topWheelLatchRef.current) {
        topWheelLatchRef.current = true;
        fetchMore();
      }
    },
    [hasMore, loading, fetchMore, onDismiss],
  );

  return (
    <div
      className="absolute inset-0 z-40 flex flex-col"
      style={{ background: THEMES[theme].background }}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>Scrollback history</span>
          {loading && (
            <div
              className="h-3 w-3 rounded-full border border-border border-t-accent animate-spin"
              aria-label="Loading"
            />
          )}
          {canLoadOlder && !loading && (
            <button
              onClick={fetchMore}
              className="text-xs text-accent hover:underline"
            >
              Load older
            </button>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-xs px-2 py-0.5 rounded border border-border hover:bg-surface-hover text-muted"
        >
          Back to live (Esc)
        </button>
      </div>
      {error && (
        <div className="px-3 py-1.5 text-xs text-red-500">{error}</div>
      )}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 p-2"
        onWheel={handleWheel}
      />
    </div>
  );
}
