import { useEffect, useRef, useState } from "react";
import { Bot, ExternalLink } from "lucide-react";
import claudeCodeIcon from "../../assets/images/agent-claude-code.svg";
import codexIcon from "../../assets/images/agent-codex.svg";
import geminiIcon from "../../assets/images/agent-gemini.svg";
import { useAppStore } from "../../shared/stores/app-store";
import { Button } from "../../shared/ui/Button";
import { useAgent } from "./useAgent";

const agentIcons: Record<string, string> = {
	claude_code: claudeCodeIcon,
	codex: codexIcon,
	gemini: geminiIcon,
};

const installLinks: Record<string, string> = {
	claude_code: "https://docs.anthropic.com/en/docs/claude-code/setup",
	codex: "https://github.com/openai/codex#installation",
	gemini: "https://github.com/google-gemini/gemini-cli#quickstart",
};

export function InlineAgentPicker() {
	const { agents, loading, fetchAgents, startSession } = useAgent();
	const [selectedAgent, setSelectedAgent] = useState("");
	const [customName, setCustomName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [starting, setStarting] = useState(false);
	const workspacePath = useAppStore((s) => s.workspacePath);
	
	const didFetchAgents = useRef(false);
	useEffect(() => {
		if (didFetchAgents.current) return;
		didFetchAgents.current = true;
		fetchAgents().catch((err) => {
			setError(err instanceof Error ? err.message : "Failed to load agents");
		});
	}, [fetchAgents]);

	const handleStart = async () => {
		if (!selectedAgent || !workspacePath || starting) return;
		setError(null);
		setStarting(true);
		try {
			const trimmedName = customName.trim();
			await startSession(
				selectedAgent,
				workspacePath,
				trimmedName.length > 0 ? trimmedName : undefined,
			);
			setCustomName("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to start session");
		} finally {
			setStarting(false);
		}
	};

	return (
		<div className="flex items-center justify-center h-full bg-surface">
			<div className="w-full max-w-sm px-6 py-8 text-center">
				<p className="text-sm text-muted mb-4">
					Select an agent to start a session.
				</p>

				{error && (
					<p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
				)}

				{agents.length === 0 && !loading && (
					<p className="text-sm text-muted py-4">
						No agents detected. Make sure Claude Code, Codex, or Gemini is installed.
					</p>
				)}

				{agents.length > 0 && (
					<div className="space-y-3">
						<div className="flex flex-col gap-2">
							{agents.map((a, index) => (
								<button
									key={`${a.agent_type}:${a.name}:${a.version ?? "unknown"}:${index}`}
									type="button"
									disabled={!a.installed && a.agent_type !== "gemini"}
									onClick={() => {
										if (a.installed) {
											setSelectedAgent(a.agent_type);
											return;
										}
										if (a.agent_type === "gemini") {
											window.open(installLinks.gemini, "_blank", "noopener,noreferrer");
										}
									}}
									className={`flex items-center gap-3 w-full rounded-lg border px-4 py-3 text-sm text-left transition-colors ${
										!a.installed && a.agent_type !== "gemini"
											? "cursor-not-allowed opacity-60 border-border bg-surface-raised/60"
											: ""
									} ${
										selectedAgent === a.agent_type
											? "border-accent bg-accent/5"
											: "border-border hover:bg-surface-raised"
									}`}
								>
										<span className="shrink-0">
											{agentIcons[a.agent_type] ? (
												<img
													src={agentIcons[a.agent_type]}
													alt=""
													aria-hidden="true"
													className="h-5 w-5"
												/>
											) : (
												<Bot aria-hidden="true" size={20} />
											)}
										</span>
											<span>
												<span className="font-medium">{a.name}</span>
											{a.version && (
												<span className="ml-1.5 text-muted text-xs">
													v{a.version}
												</span>
											)}
												{!a.installed && (
													<span className="ml-1.5 text-muted text-xs">
														Not installed
													</span>
												)}
											</span>
										{!a.installed && a.agent_type === "gemini" && (
											<span className="ml-auto text-muted" aria-hidden="true">
												<ExternalLink size={16} />
											</span>
										)}
								</button>
							))}
						</div>
						<div className="text-left">
							<label
								htmlFor="agent-custom-name"
								className="block text-xs font-medium text-muted mb-1.5"
							>
								Session name (optional)
							</label>
							<input
								id="agent-custom-name"
								type="text"
								value={customName}
								onChange={(event) => setCustomName(event.target.value)}
								placeholder="e.g. Refactor pass"
								maxLength={80}
								className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
							/>
						</div>
						<Button
							onClick={handleStart}
							disabled={!selectedAgent || starting || !agents.some((a) => a.agent_type === selectedAgent && a.installed)}
							className="w-full"
						>
							{starting ? "Starting..." : "Start Session"}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
