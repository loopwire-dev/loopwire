import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "primary" | "secondary" | "ghost" | "danger";
	size?: "sm" | "md" | "lg";
}

const variants = {
	primary: "bg-accent text-white hover:bg-accent-hover shadow-sm",
	secondary:
		"bg-surface-raised text-zinc-900 dark:text-zinc-100 hover:bg-surface-overlay border border-border",
	ghost: "text-zinc-600 dark:text-zinc-400 hover:bg-surface-raised",
	danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
};

const sizes = {
	sm: "px-2.5 py-1 text-sm",
	md: "px-4 py-2 text-sm",
	lg: "px-6 py-2.5 text-base",
};

export function Button({
	variant = "primary",
	size = "md",
	className = "",
	...props
}: ButtonProps) {
	return (
		<button
			className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none ${variants[variant]} ${sizes[size]} ${className}`}
			{...props}
		/>
	);
}
