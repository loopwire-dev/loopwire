import logoParadox from "../../../assets/images/logo.svg";

export function LoopwireLogo({
	size = 24,
	className = "",
	mode = "auto",
}: {
	size?: number;
	className?: string;
	mode?: "auto" | "light" | "dark";
}) {
	const modeClass =
		mode === "dark" ? "invert" : mode === "auto" ? "dark:invert" : "";

	return (
		<img
			src={logoParadox}
			alt="Loopwire"
			width={size}
			height={size}
			className={`inline-block align-middle ${modeClass} ${className}`.trim()}
		/>
	);
}
