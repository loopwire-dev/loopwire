import { Check, CheckCircle2, Copy, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const GITHUB_STAR_THRESHOLD = 10;

function useGitHubStars(repo: string): number | null {
	const [stars, setStars] = useState<number | null>(null);
	useEffect(() => {
		fetch(`https://api.github.com/repos/${repo}`)
			.then((r) => r.json())
			.then((data) => {
				if (typeof data.stargazers_count === "number") {
					setStars(data.stargazers_count);
				}
			})
			.catch(() => {});
	}, [repo]);
	return stars;
}
import { Button } from "../../../shared/ui/Button";
import { LoopwireSpinner } from "../../../shared/ui/LoopwireSpinner";
import { LoopwireLogo } from "./LoopwireLogo";

const INSTALL_COMMAND = "curl -fsSL https://loopwire.dev/install.sh | sh";

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const copy = () => {
		navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<>
			<button
				type="button"
				onClick={copy}
				aria-label={copied ? "Copied install command" : "Copy install command"}
				className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors focus:outline-2 focus:outline-accent"
				title="Copy to clipboard"
			>
				{copied ? <Check size={16} /> : <Copy size={16} />}
			</button>
			<span aria-live="polite" className="sr-only">
				{copied ? "Install command copied to clipboard." : ""}
			</span>
		</>
	);
}

interface LandingPageProps {
	discoveryEnabled: boolean;
	onEnableDiscovery: () => void;
	arrivedViaTokenLink?: boolean;
}

export function LandingPage({
	discoveryEnabled,
	onEnableDiscovery,
	arrivedViaTokenLink = false,
}: LandingPageProps) {
	const { resolvedTheme, setTheme } = useTheme();
	const githubStars = useGitHubStars("loopwire-dev/loopwire");
	const selectedStep = discoveryEnabled || arrivedViaTokenLink ? 2 : 1;
	const setupSelected = selectedStep === 1;
	const scanSelected = selectedStep === 2;

	const searchLabel = discoveryEnabled
		? "Scanning for machine..."
		: "Scan for machine";
	const isDark = resolvedTheme === "dark";
	const toggleTheme = () => setTheme(isDark ? "light" : "dark");
	const themeLabel = isDark ? "Switch to light mode" : "Switch to dark mode";

	return (
		<div className="relative h-full flex flex-col bg-surface overflow-auto">
			<button
				type="button"
				onClick={toggleTheme}
				aria-label={themeLabel}
				title={themeLabel}
				className="absolute top-4 right-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-raised/90 text-muted backdrop-blur hover:bg-surface-overlay hover:text-foreground transition-colors focus:outline-2 focus:outline-accent"
			>
				{isDark ? (
					<Sun size={18} aria-hidden="true" />
				) : (
					<Moon size={18} aria-hidden="true" />
				)}
			</button>

			<main className="flex-1">
				{/* Hero */}
				<div className="h-full flex flex-col items-center justify-center px-6 py-16 relative">
					{/* Subtle radial gradient background */}
					<div
						className="absolute inset-0 opacity-[0.04] dark:opacity-[0.07] pointer-events-none"
						style={{
							background:
								"radial-gradient(ellipse at 50% 40%, var(--color-accent) 0%, transparent 70%)",
						}}
					/>

					<div className="relative z-10 max-w-2xl w-full flex flex-col items-center text-center">
						{/* Logo / brand */}
						<div className="mb-8 flex items-center gap-3">
							<LoopwireLogo size={32} />
							<span className="text-2xl font-bold tracking-tight">
								Loopwire
							</span>
						</div>

						{/* Headline */}
						<h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight mb-4">
							<span className="block">Agents write the code.</span>
							<span className="block text-accent">You own the loop.</span>
						</h1>

						<p className="text-muted text-base sm:text-lg max-w-md mb-12 leading-relaxed">
							Run any coding agent on your machine. See every keystroke, every
							file change, every diff — live.
						</p>

						{/* Workflow card */}
						<div className="w-full max-w-lg rounded-2xl border border-border bg-surface-raised overflow-hidden text-left shadow-sm">
							{/* Step 1: Setup */}
							<div
								className={[
									"p-5 sm:p-6 border-b transition-colors",
									setupSelected
										? "border-accent/30 bg-accent/5"
										: "border-border",
								].join(" ")}
							>
								<div className="flex items-center gap-3 mb-4">
									<div
										className={[
											"w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold border shrink-0",
											setupSelected
												? "bg-accent text-accent-foreground border-accent"
												: "bg-surface-overlay text-muted border-border",
										].join(" ")}
									>
										1
									</div>
									<h2
										className={[
											"text-xs sm:text-sm font-bold uppercase tracking-wider",
											setupSelected ? "text-foreground" : "text-muted",
										].join(" ")}
									>
										Set up your machine
									</h2>
								</div>
								<p className="text-xs text-muted mb-4">
									Run this command in your terminal to install the Loopwire
									daemon:
								</p>
								<div className="flex items-center gap-2 rounded-xl bg-zinc-900 dark:bg-zinc-950 px-3 py-2.5 font-mono text-[13px] text-zinc-300 border border-white/5 shadow-inner">
									<span className="text-accent select-none shrink-0">$</span>
									<span className="flex-1 select-all overflow-x-auto whitespace-nowrap scrollbar-none">
										{INSTALL_COMMAND}
									</span>
									<CopyButton text={INSTALL_COMMAND} />
								</div>
							</div>

							{/* Step 2: Search */}
							<div
								className={[
									"p-5 sm:p-6 transition-colors",
									scanSelected ? "bg-accent/5" : "",
								].join(" ")}
							>
								<div className="flex items-center gap-3 mb-5">
									<div
										className={[
											"w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold border shrink-0",
											scanSelected
												? "bg-accent text-accent-foreground border-accent"
												: "bg-surface-overlay text-muted border-border",
										].join(" ")}
									>
										2
									</div>
									<h2
										className={[
											"text-xs sm:text-sm font-bold uppercase tracking-wider",
											scanSelected ? "text-foreground" : "text-muted",
										].join(" ")}
									>
										Find it on your network
									</h2>
								</div>
								<Button
									type="button"
									size="lg"
									variant={discoveryEnabled ? "secondary" : "primary"}
									className="h-12 w-full !rounded-full gap-3 text-sm font-bold transition-all shadow-sm"
									onClick={onEnableDiscovery}
									disabled={discoveryEnabled}
								>
									{discoveryEnabled ? (
										<LoopwireSpinner size={18} decorative />
									) : (
										<Search size={18} />
									)}
									{searchLabel}
								</Button>
							</div>
						</div>

						{/* What you get */}
						<div className="mt-16 w-full max-w-lg">
							<ul className="grid grid-cols-1 sm:grid-cols-3 gap-3">
								{[
									{
										text: "Your machine",
										sub: "Runs on your hardware",
									},
									{ text: "Any device", sub: "Phone, tablet, laptop" },
									{ text: "Any agent", sub: "Bring your own CLI" },
								].map(({ text, sub }) => (
									<li
										key={text}
										className="flex flex-col items-center gap-1 px-3 py-3 rounded-lg"
									>
										<CheckCircle2 size={16} className="text-accent mb-1" />
										<span className="text-sm font-medium">{text}</span>
										<span className="text-sm text-muted whitespace-nowrap">
											{sub}
										</span>
									</li>
								))}
							</ul>
						</div>
					</div>
				</div>
			</main>

			{/* Footer */}
			<footer className="text-center text-sm text-muted pb-6 pt-2 flex flex-col items-center gap-3">
				<div className="flex items-center gap-3">
					<a
						href="https://github.com/loopwire-dev/loopwire"
						target="_blank"
						rel="noopener noreferrer"
						aria-label="Star Loopwire on GitHub"
						className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:text-foreground hover:border-foreground/30 transition-colors"
					>
						<svg
							aria-hidden="true"
							width="13"
							height="13"
							viewBox="0 0 24 24"
							fill="currentColor"
						>
							<path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.929.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .322.216.694.825.576C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
						</svg>
						<svg
							aria-hidden="true"
							width="11"
							height="11"
							viewBox="0 0 24 24"
							fill="currentColor"
						>
							<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
						</svg>
						<span>Star</span>
						{githubStars !== null && githubStars > GITHUB_STAR_THRESHOLD && (
							<span className="text-xs tabular-nums">
								{githubStars.toLocaleString()}
							</span>
						)}
					</a>
					<a
						href="https://x.com/loopwiredev"
						target="_blank"
						rel="noopener noreferrer"
						aria-label="Follow @loopwiredev on X"
						className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:text-foreground hover:border-foreground/30 transition-colors"
					>
						<svg
							aria-hidden="true"
							width="11"
							height="11"
							viewBox="0 0 24 24"
							fill="currentColor"
						>
							<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
						</svg>
						<span>@loopwiredev</span>
					</a>
				</div>
				<p>Made by 🤖 and 🧑 with 🦾</p>
			</footer>
		</div>
	);
}
