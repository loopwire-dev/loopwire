import { useEffect, useMemo } from "react";
import {
	type WorkspacePanel,
	useAppStore,
	workspaceStoreKeyForSelection,
} from "../../../shared/stores/app-store";
import { InlineAgentPicker } from "../../agent/components/InlineAgentPicker";
import { Terminal } from "../../terminal/components/Terminal";
import { FilesPanelView } from "./FilesPanelView";
import { GitPanelView } from "./GitPanelView";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

export function WorkspaceView() {
	const workspacePath = useAppStore((s) => s.workspacePath);
	const workspaceId = useAppStore((s) => s.workspaceId);
	const sessionsByWorkspacePath = useAppStore((s) => s.sessionsByWorkspacePath);
	const activePanelByWorkspacePath = useAppStore(
		(s) => s.activePanelByWorkspacePath,
	);
	const workspaceKey = useMemo(
		() => workspaceStoreKeyForSelection(workspaceId, workspacePath),
		[workspaceId, workspacePath],
	);

	const sessions = useMemo(() => {
		if (!workspaceKey) return [];
		return sessionsByWorkspacePath[workspaceKey] ?? [];
	}, [workspaceKey, sessionsByWorkspacePath]);
	const sessionsInDisplayOrder = useMemo(() => {
		const byOrder = (
			a: (typeof sessions)[number],
			b: (typeof sessions)[number],
		) => {
			const aHas = a.sortOrder != null;
			const bHas = b.sortOrder != null;
			if (aHas && bHas)
				return (a.sortOrder as number) - (b.sortOrder as number);
			if (aHas) return -1;
			if (bHas) return 1;
			return a.createdAt.localeCompare(b.createdAt);
		};
		const pinned = sessions.filter((session) => session.pinned).sort(byOrder);
		const unpinned = sessions
			.filter((session) => !session.pinned)
			.sort(byOrder);
		return [...pinned, ...unpinned];
	}, [sessions]);

	const setActivePanel = useAppStore((s) => s.setActivePanel);

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (!workspacePath) return;
			if (!(e.metaKey || e.ctrlKey)) return;
			const digit = Number(e.key);
			if (digit < 1 || digit > 9) return;
			const session = sessionsInDisplayOrder[digit - 1];
			if (!session) return;
			e.preventDefault();
			setActivePanel(workspacePath, {
				kind: "agent",
				sessionId: session.sessionId,
			});
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [workspacePath, sessionsInDisplayOrder, setActivePanel]);

	const activePanel: WorkspacePanel = useMemo(() => {
		if (!workspaceKey) return { kind: "panel", panel: "files" };
		const stored = activePanelByWorkspacePath[workspaceKey];
		if (!stored) return { kind: "panel", panel: "files" };
		// Validate that an agent panel still refers to an existing session
		if (stored.kind === "agent") {
			const exists = sessions.some((s) => s.sessionId === stored.sessionId);
			if (!exists) return { kind: "panel", panel: "files" };
		}
		return stored;
	}, [workspaceKey, activePanelByWorkspacePath, sessions]);

	const content = (() => {
		switch (activePanel.kind) {
			case "panel":
				return activePanel.panel === "git" ? (
					<GitPanelView />
				) : (
					<FilesPanelView />
				);
			case "agent":
				return (
					<Terminal
						key={activePanel.sessionId}
						sessionId={activePanel.sessionId}
					/>
				);
			case "new-agent":
				return <InlineAgentPicker />;
		}
	})();

	return (
		<div className="h-full flex">
			<WorkspaceSidebar sessions={sessions} activePanel={activePanel} />
			<div className="w-px bg-border shrink-0" />
			<div className="flex-1 min-w-0 overflow-hidden">{content}</div>
		</div>
	);
}
