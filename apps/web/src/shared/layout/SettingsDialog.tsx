import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { LucideIcon } from "lucide-react";
import {
	Check,
	Copy,
	LogOut,
	Monitor,
	Moon,
	Play,
	Settings,
	Square,
	Sun,
	UserCircle,
	X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Theme } from "../lib/theme";
import { useAppStore } from "../stores/app-store";
import { Dialog } from "../ui/Dialog";
import { LoopwireSpinner } from "../ui/LoopwireSpinner";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type SectionId = "general" | "account";

interface NavItem {
	id: SectionId;
	label: string;
	icon: LucideIcon;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const navItems: NavItem[] = [
	{ id: "general", label: "General", icon: Settings },
	{ id: "account", label: "Account", icon: UserCircle },
];

const themes: { value: Theme; label: string; icon: LucideIcon }[] = [
	{ value: "system", label: "System", icon: Monitor },
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
];

const providerLabels: Record<string, string> = {
	cloudflared: "Cloudflare Tunnel",
	localhost_run: "localhost.run",
};

function providerLabel(provider: string): string {
	return providerLabels[provider] ?? provider;
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

function SectionTitle({ children }: { children: ReactNode }) {
	return (
		<div className="pb-4 border-b border-border">
			<h3 className="text-lg font-semibold text-foreground">{children}</h3>
		</div>
	);
}

function SettingRow({
	label,
	description,
	children,
	last,
}: {
	label: string;
	description?: string;
	children: ReactNode;
	last?: boolean;
}) {
	return (
		<div className={`py-5 ${last ? "" : "border-b border-border"}`}>
			<div className="flex items-center justify-between gap-6">
				<div className="text-sm font-medium text-foreground">{label}</div>
				<div className="shrink-0">{children}</div>
			</div>
			{description && <p className="text-xs text-muted mt-1">{description}</p>}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/*  Section content components                                         */
/* ------------------------------------------------------------------ */

function GeneralSection() {
	const { theme, setTheme } = useTheme();

	const [sharePin, setSharePin] = useState("");
	const [shareBusy, setShareBusy] = useState(false);
	const [shareError, setShareError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [shareStatus, setShareStatus] = useState<{
		active: boolean;
		connect_url: string | null;
		expires_at: string | null;
		pin_required: boolean;
		provider: string | null;
	} | null>(null);

	const isActive = !!shareStatus?.active;

	useEffect(() => {
		void refreshShareStatus();
	}, []);

	async function refreshShareStatus() {
		try {
			const status = await api.get<{
				active: boolean;
				connect_url: string | null;
				expires_at: string | null;
				pin_required: boolean;
				provider: string | null;
			}>("/remote/share/status");
			setShareStatus(status);
		} catch {
			setShareStatus(null);
		}
	}

	async function startShare() {
		setShareBusy(true);
		setShareError(null);
		try {
			const res = await api.post<{
				connect_url: string;
				expires_at: string;
				pin_required: boolean;
				provider: string;
			}>("/remote/share/start", {
				pin: sharePin.trim() || undefined,
			});
			setShareStatus({
				active: true,
				connect_url: res.connect_url,
				expires_at: res.expires_at,
				pin_required: res.pin_required,
				provider: res.provider,
			});
		} catch (err) {
			setShareError(
				err instanceof Error ? err.message : "Failed to start share",
			);
		} finally {
			setShareBusy(false);
		}
	}

	async function stopShare() {
		setShareBusy(true);
		setShareError(null);
		try {
			await api.post("/remote/share/stop");
			setShareStatus({
				active: false,
				connect_url: null,
				expires_at: null,
				pin_required: false,
				provider: null,
			});
			setSharePin("");
		} catch (err) {
			setShareError(
				err instanceof Error ? err.message : "Failed to stop share",
			);
		} finally {
			setShareBusy(false);
		}
	}

	function copyLink() {
		if (!shareStatus?.connect_url) return;
		void navigator.clipboard.writeText(shareStatus.connect_url);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	return (
		<div>
			<SectionTitle>General</SectionTitle>

			{/* Theme */}
			<SettingRow label="Theme">
				<div className="flex gap-1 rounded-lg border border-border bg-surface-raised dark:bg-[#323232] dark:border-[#555555] p-0.5">
					{themes.map((t) => {
						const Icon = t.icon;
						const active = (theme ?? "system") === t.value;
						return (
							<button
								key={t.value}
								type="button"
								onClick={() => setTheme(t.value)}
								className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors border ${
									active
										? "bg-surface dark:bg-[#454545] text-foreground shadow-sm border-border dark:border-[#696969]"
										: "border-transparent text-muted hover:text-foreground hover:bg-surface dark:hover:bg-[#3d3d3d]"
								}`}
							>
								<Icon size={14} />
								{t.label}
							</button>
						);
					})}
				</div>
			</SettingRow>

			{/* Remote Access */}
			{isActive ? (
				<div className="py-5">
					<div className="flex items-start justify-between gap-6 mb-4">
						<div>
							<div className="text-sm font-medium text-foreground flex items-center gap-2">
								Remote Access
								<span className="inline-flex items-center gap-1.5 text-xs font-normal text-emerald-600 dark:text-emerald-400">
									<span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
									Active
								</span>
							</div>
							<div className="flex items-center gap-3 mt-1 text-xs text-muted">
								{shareStatus?.provider && (
									<span>via {providerLabel(shareStatus.provider)}</span>
								)}
								{shareStatus?.expires_at && (
									<span>
										Expires{" "}
										{new Date(shareStatus.expires_at).toLocaleString(
											undefined,
											{
												month: "short",
												day: "numeric",
												hour: "numeric",
												minute: "2-digit",
											},
										)}
									</span>
								)}
								<span>PIN {shareStatus?.pin_required ? "on" : "off"}</span>
							</div>
						</div>
						<button
							type="button"
							onClick={() => void stopShare()}
							disabled={shareBusy}
							className="shrink-0 rounded-lg p-2 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-60"
						>
							<Square size={14} />
						</button>
					</div>

					{shareStatus?.connect_url && (
						<div className="flex items-center gap-2">
							<input
								type="text"
								readOnly
								value={shareStatus.connect_url}
								className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-border bg-surface text-foreground text-xs font-mono select-all focus:outline-2 focus:outline-accent"
								onFocus={(e) => e.target.select()}
							/>
							<button
								type="button"
								onClick={copyLink}
								className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium border border-border dark:border-[#696969] bg-surface dark:bg-[#3f3f3f] text-foreground hover:bg-surface-overlay dark:hover:bg-[#4b4b4b] transition-colors"
							>
								{copied ? (
									<Check size={14} className="text-emerald-500" />
								) : (
									<Copy size={14} />
								)}
								{copied ? "Copied" : "Copy"}
							</button>
						</div>
					)}
				</div>
			) : (
				<SettingRow
					label="Remote Access"
					description={
						shareError
							? shareError
							: "Create a temporary link to connect from any device."
					}
					last
				>
					<div className="flex items-center gap-2">
						<input
							type="password"
							value={sharePin}
							onChange={(e) => setSharePin(e.target.value)}
							placeholder="PIN"
							className="w-24 px-3 py-1.5 rounded-lg border border-border bg-surface text-foreground placeholder:text-muted text-sm focus:outline-2 focus:outline-accent"
						/>
						<button
							type="button"
							onClick={() => void startShare()}
							disabled={shareBusy}
							className="rounded-lg p-2 bg-accent text-accent-foreground hover:bg-accent-hover disabled:opacity-60 disabled:hover:bg-accent transition-colors"
						>
							{shareBusy ? (
								<LoopwireSpinner size={14} decorative />
							) : (
								<Play size={14} />
							)}
						</button>
					</div>
				</SettingRow>
			)}
		</div>
	);
}

interface MachineInfo {
	version: string;
	hostname: string;
	os: string;
	arch: string;
	uptime_secs: number;
}

function formatUptime(secs: number): string {
	const d = Math.floor(secs / 86400);
	const h = Math.floor((secs % 86400) / 3600);
	const m = Math.floor((secs % 3600) / 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

function AccountSection() {
	const logout = useAppStore((s) => s.logout);
	const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
	const [machine, setMachine] = useState<MachineInfo | null>(null);

	useEffect(() => {
		void api
			.get<MachineInfo>("/health")
			.then(setMachine)
			.catch(() => {});
	}, []);

	return (
		<div className="flex flex-col flex-1">
			<SectionTitle>Account</SectionTitle>

			{machine && (
				<>
					<SettingRow label="Hostname">
						<span className="text-sm text-foreground">
							{machine.hostname || "—"}
						</span>
					</SettingRow>
					<SettingRow label="OS / Architecture">
						<span className="text-sm text-foreground">
							{machine.os} / {machine.arch}
						</span>
					</SettingRow>
					<SettingRow label="Daemon version">
						<span className="text-sm text-foreground">{machine.version}</span>
					</SettingRow>
					<SettingRow label="Uptime" last>
						<span className="text-sm text-foreground">
							{formatUptime(machine.uptime_secs)}
						</span>
					</SettingRow>
				</>
			)}

			<div className="flex-1" />
			<div className="flex justify-end pt-4">
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
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/*  Section registry                                                   */
/* ------------------------------------------------------------------ */

const sectionComponents: Record<SectionId, () => ReactNode> = {
	general: GeneralSection,
	account: AccountSection,
};

/* ------------------------------------------------------------------ */
/*  Main dialog                                                        */
/* ------------------------------------------------------------------ */

export function SettingsDialog() {
	const open = useAppStore((s) => s.settingsOpen);
	const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
	const [activeSection, setActiveSection] = useState<SectionId>("general");

	const ActiveComponent = sectionComponents[activeSection];

	return (
		<Dialog
			open={open}
			onOpenChange={setSettingsOpen}
			title="Settings"
			contentClassName="max-w-3xl"
			showHeader={false}
		>
			<div className="flex min-h-[520px]">
				{/* Sidebar */}
				<nav className="w-48 shrink-0 border-r border-border bg-surface-raised/50 dark:bg-[#1e1e1e] rounded-l-xl flex flex-col">
					<p className="px-4 pt-4 pb-3 text-xs font-medium text-muted uppercase tracking-wider">
						Settings
					</p>
					<ul className="space-y-0.5 px-2 flex-1">
						{navItems.map((item) => {
							const Icon = item.icon;
							const active = activeSection === item.id;
							return (
								<li key={item.id}>
									<button
										type="button"
										onClick={() => setActiveSection(item.id)}
										className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
											active
												? "bg-accent/10 text-accent font-medium"
												: "text-muted hover:text-foreground hover:bg-surface-overlay dark:hover:bg-[#2d2d2d]"
										}`}
									>
										<Icon size={16} />
										{item.label}
									</button>
								</li>
							);
						})}
					</ul>
				</nav>

				{/* Main content */}
				<div className="flex-1 flex flex-col min-w-0">
					<div className="flex justify-end px-4 pt-4">
						<DialogPrimitive.Close className="rounded-lg p-1.5 text-muted hover:text-foreground hover:bg-surface-raised transition-colors">
							<X size={16} />
						</DialogPrimitive.Close>
					</div>
					<div className="flex-1 flex flex-col px-8 pt-1 pb-8 overflow-y-auto">
						<ActiveComponent />
					</div>
				</div>
			</div>
		</Dialog>
	);
}
