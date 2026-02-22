import type { CSSProperties } from "react";

interface LoopwireSpinnerProps {
	size?: number;
	className?: string;
	label?: string;
	decorative?: boolean;
}

const LOGO_DOTS = [
	{ cx: 255.05, cy: 192.45, r: 14.3 },
	{ cx: 293.05, cy: 306.16, r: 15.72 },
	{ cx: 169.55, cy: 235.77, r: 16.91 },
	{ cx: 327.08, cy: 200.97, r: 17.97 },
	{ cx: 224.02, cy: 346.64, r: 18.92 },
	{ cx: 200.19, cy: 154.08, r: 19.79 },
	{ cx: 358.53, cy: 289.64, r: 20.61 },
	{ cx: 136.71, cy: 296.76, r: 21.37 },
	{ cx: 304.76, cy: 132.99, r: 22.09 },
	{ cx: 290.54, cy: 379.29, r: 22.78 },
	{ cx: 127.56, cy: 179.04, r: 23.44 },
	{ cx: 393.86, cy: 218.38, r: 24.07 },
	{ cx: 162.08, cy: 375.04, r: 24.68 },
	{ cx: 229.68, cy: 93.09, r: 25.26 },
	{ cx: 374.94, cy: 355.32, r: 25.83 },
	{ cx: 81.7, cy: 256.95, r: 26.38 },
	{ cx: 372.87, cy: 127.75, r: 26.91 },
	{ cx: 241.76, cy: 427.88, r: 27.43 },
	{ cx: 132.95, cy: 109.72, r: 27.93 },
	{ cx: 435.53, cy: 274.98, r: 28.42 },
	{ cx: 92.7, cy: 359.42, r: 28.9 },
	{ cx: 293.02, cy: 58.86, r: 29.37 },
	{ cx: 349.49, cy: 423.66, r: 29.83 },
	{ cx: 55.41, cy: 187.9, r: 30.28 },
	{ cx: 439.12, cy: 162.65, r: 30.72 },
	{ cx: 168.03, cy: 445.81, r: 31.16 },
	{ cx: 176.86, cy: 46.58, r: 31.58 },
	{ cx: 444.73, cy: 352.37, r: 32 },
] as const;

export function LoopwireSpinner({
	size = 20,
	className = "",
	label = "Loading",
	decorative = false,
}: LoopwireSpinnerProps) {
	return (
		<span
			className={`lw-spinner ${className}`.trim()}
			style={{ width: size, height: size }}
			role={decorative ? undefined : "status"}
			aria-label={decorative ? undefined : label}
			aria-hidden={decorative ? "true" : undefined}
		>
			{LOGO_DOTS.map((dot) => {
				const dx = ((dot.cx - 250) / 500) * size;
				const dy = ((dot.cy - 250) / 500) * size;
				const distanceFromCenter = Math.hypot(dot.cx - 250, dot.cy - 250);
				const dotSize = Math.max(((dot.r * 2) / 500) * size, 1.6);
				const delayMs = Math.round((distanceFromCenter / 250) * 520);
				return (
					<span
						key={`${dot.cx}-${dot.cy}`}
						className="lw-spinner__dot"
						style={
							{
								"--x": `${dx}px`,
								"--y": `${dy}px`,
								"--dot-size": `${dotSize}px`,
								"--delay": `${delayMs}ms`,
							} as CSSProperties
						}
						aria-hidden="true"
					/>
				);
			})}
		</span>
	);
}
