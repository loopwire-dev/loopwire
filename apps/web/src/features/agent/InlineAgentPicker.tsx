import { Bot, ExternalLink, Play } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../../shared/stores/app-store";
import { getAgentIcon } from "./agent-icons";
import { useAgent } from "./useAgent";

const installLinks: Record<string, string> = {
	claude_code: "https://docs.anthropic.com/en/docs/claude-code/setup",
	codex: "https://github.com/openai/codex#installation",
	gemini: "https://github.com/google-gemini/gemini-cli#quickstart",
};

export function InlineAgentPicker() {
	const { startSession } = useAgent();
	const agents = useAppStore((s) => s.availableAgents);
	const [selectedAgent, setSelectedAgent] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [starting, setStarting] = useState(false);
	const workspacePath = useAppStore((s) => s.workspacePath);

	const handleStart = async (agentType: string) => {
		if (!workspacePath || starting) return;
		setError(null);
		setStarting(true);
		try {
			await startSession(agentType, workspacePath);
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
					Select an agent, then click it again to start a session.
				</p>

				{error && (
					<p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
				)}

				{agents.length === 0 && (
					<p className="text-sm text-muted py-4">
						No agents detected. Make sure Claude Code, Codex, or Gemini is
						installed.
					</p>
				)}

				{agents.length > 0 && (
					<div className="space-y-3">
						<div className="flex flex-col gap-2">
							{agents.map((a, index) => {
								const iconSrc = getAgentIcon(a.agent_type);
								return (
									<button
										key={`${a.agent_type}:${a.name}:${a.version ?? "unknown"}:${index}`}
										type="button"
										disabled={
											starting ||
											(!a.installed && a.agent_type !== "gemini")
										}
										onClick={() => {
											if (a.installed) {
												if (selectedAgent === a.agent_type) {
													void handleStart(a.agent_type);
													return;
												}
												setSelectedAgent(a.agent_type);
												return;
											}
											if (a.agent_type === "gemini") {
												window.open(
													installLinks.gemini,
													"_blank",
													"noopener,noreferrer",
												);
											}
										}}
										className={`flex items-center gap-2.5 w-full max-w-[18rem] mx-auto rounded-md border px-3 py-2 text-sm text-left transition-colors ${
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
											{iconSrc ? (
												<img
													src={iconSrc}
													alt=""
													aria-hidden="true"
													className="h-4 w-4"
												/>
											) : (
												<Bot aria-hidden="true" size={18} />
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
												<ExternalLink size={14} />
											</span>
										)}
										{a.installed && selectedAgent === a.agent_type && (
											<span className="ml-auto text-accent" aria-hidden="true">
												<Play size={14} fill="currentColor" />
											</span>
										)}
									</button>
								);
							})}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
