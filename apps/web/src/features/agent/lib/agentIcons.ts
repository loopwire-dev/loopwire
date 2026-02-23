import claudeCodeIcon from "../../../assets/images/agent-claude-code.svg";
import codexIcon from "../../../assets/images/agent-codex.svg";
import geminiIcon from "../../../assets/images/agent-gemini.svg";

const AGENT_ICONS: Record<string, string> = {
	claude_code: claudeCodeIcon,
	codex: codexIcon,
	gemini: geminiIcon,
};

export function getAgentIcon(agentType: string): string | null {
	return AGENT_ICONS[agentType] ?? null;
}
