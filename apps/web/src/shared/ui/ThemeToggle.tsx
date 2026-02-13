import { useTheme } from "next-themes";
import { Sun } from "lucide-react";
import { getNextTheme, type Theme } from "../lib/theme";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const cycleTheme = () => {
    setTheme(getNextTheme((theme ?? "system") as Theme));
  };

  return (
    <button
      onClick={cycleTheme}
      className="p-2 rounded-lg text-muted hover:bg-surface-raised transition-colors"
      title={`Theme: ${theme}`}
    >
      <Sun size={16} aria-hidden="true" />
    </button>
  );
}
