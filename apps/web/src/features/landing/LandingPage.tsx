import { Check, CheckCircle2, Copy, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Button } from "../../shared/ui/Button";
import { LoopwireSpinner } from "../../shared/ui/LoopwireSpinner";
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
}

export function LandingPage({
	discoveryEnabled,
	onEnableDiscovery,
}: LandingPageProps) {
	const { resolvedTheme, setTheme } = useTheme();

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
							<div className="p-5 sm:p-6 border-b border-border">
								<div className="flex items-center gap-3 mb-4">
									<div className="w-6 h-6 rounded-full bg-surface-overlay text-muted flex items-center justify-center text-[11px] font-bold border border-border shrink-0">
										1
									</div>
									<h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-foreground">
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
							<div className="p-5 sm:p-6">
								<div className="flex items-center gap-3 mb-5">
									<div className="w-6 h-6 rounded-full bg-surface-overlay text-muted flex items-center justify-center text-[11px] font-bold border border-border shrink-0">
										2
									</div>
									<h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-foreground">
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
			<footer className="text-center text-sm text-muted pb-6 pt-2">
				<p>Made by 🤖 and 🧑 with 🦾</p>
				<a
					href="mailto:info@loopwire.dev"
					className="text-muted hover:text-foreground transition-colors"
				>
					info@loopwire.dev
				</a>
			</footer>
		</div>
	);
}
