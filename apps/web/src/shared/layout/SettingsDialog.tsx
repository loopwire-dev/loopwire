import type { LucideIcon } from "lucide-react";
import { Monitor, Moon, Sun, LogOut } from "lucide-react";
import { useTheme } from "next-themes";
import type { Theme } from "../lib/theme";
import { useAppStore } from "../stores/app-store";
import { Dialog } from "../ui/Dialog";

const themes: { value: Theme; label: string; icon: LucideIcon }[] = [
	{ value: "system", label: "System", icon: Monitor },
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
];

export function SettingsDialog() {
	const open = useAppStore((s) => s.settingsOpen);
	const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
	const daemonConnected = useAppStore((s) => s.daemonConnected);
	const logout = useAppStore((s) => s.logout);
	const { theme, setTheme } = useTheme();

	return (
		<Dialog open={open} onOpenChange={setSettingsOpen} title="Settings">
			<div className="space-y-6">
				{/* Appearance */}
				<section>
					<p className="text-xs font-medium text-muted uppercase tracking-wider mb-3">
						Appearance
					</p>
					<div className="flex gap-1 rounded-lg bg-black/10 dark:bg-white/5 p-1">
						{themes.map((t) => {
							const Icon = t.icon;
							const active = (theme ?? "system") === t.value;
							return (
								<button
									key={t.value}
									type="button"
									onClick={() => setTheme(t.value)}
									className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
										active
											? "bg-black/10 dark:bg-white/10 text-foreground shadow-sm"
											: "text-muted hover:text-foreground"
									}`}
								>
									<Icon size={14} />
									{t.label}
								</button>
							);
						})}
					</div>
				</section>

				{/* Daemon */}
				<section>
					<p className="text-xs font-medium text-muted uppercase tracking-wider mb-3">
						Daemon
					</p>
					<div className="flex items-center gap-2.5 rounded-lg bg-black/10 dark:bg-white/5 px-3.5 py-3">
						<span
							className={`w-2 h-2 rounded-full shrink-0 ${
								daemonConnected ? "bg-emerald-500" : "bg-zinc-400"
							}`}
						/>
						<span className="text-sm">
							{daemonConnected ? "Connected" : "Disconnected"}
						</span>
					</div>
				</section>

				{/* Account */}
				<section>
					<p className="text-xs font-medium text-muted uppercase tracking-wider mb-3">
						Account
					</p>
					<button
						type="button"
						onClick={() => {
							logout();
							setSettingsOpen(false);
						}}
						className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm text-muted hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors"
					>
						<LogOut size={14} />
						Log out
					</button>
				</section>
			</div>
		</Dialog>
	);
}
