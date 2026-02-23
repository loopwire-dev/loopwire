/**
 * Supported theme modes for the web app.
 */
export type Theme = "light" | "dark" | "system";

/**
 * Cycles the theme order between system, light, and dark.
 */
export function getNextTheme(current: Theme): Theme {
	switch (current) {
		case "system":
			return "light";
		case "light":
			return "dark";
		case "dark":
			return "system";
	}
}
