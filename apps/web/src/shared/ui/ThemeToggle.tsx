import { Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { type Theme, getNextTheme } from "../lib/runtime/theme";

export function ThemeToggle() {
	const { theme, setTheme } = useTheme();

	const cycleTheme = () => {
		setTheme(getNextTheme((theme ?? "system") as Theme));
	};

	return (
		<button
			type="button"
			onClick={cycleTheme}
			className="p-2 rounded-lg text-muted hover:bg-surface-raised transition-colors"
			title={`Theme: ${theme}`}
		>
			<Sun size={16} aria-hidden="true" />
		</button>
	);
}
