export type Theme = "light" | "dark" | "system";

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
