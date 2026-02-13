import { useTerminal } from "./useTerminal";
import { useTheme } from "next-themes";

interface TerminalProps {
  sessionId: string;
}

export function Terminal({ sessionId }: TerminalProps) {
  const { resolvedTheme } = useTheme();
  const { ref, isLoading } = useTerminal(
    sessionId,
    resolvedTheme === "dark" ? "dark" : "light",
  );

  return (
    <div className="h-full w-full relative">
      {isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface/70">
          <div
            className="h-5 w-5 rounded-full border-2 border-border border-t-accent animate-spin"
            aria-label="Loading terminal"
          />
          <p className="text-xs text-muted">Getting things ready...</p>
        </div>
      )}
      <div ref={ref} className="h-full w-full" />
    </div>
  );
}
