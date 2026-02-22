import { WorkspaceView } from "../../features/ide/WorkspaceView";
import { AppSidebar } from "../../features/sidebar/AppSidebar";
import { NewWorkspaceView } from "../../features/workspace/NewWorkspaceView";
import { useDaemon } from "../hooks/useDaemon";
import { useAppStore } from "../stores/app-store";

export function AppLayout() {
	useDaemon();
	const browsingForWorkspace = useAppStore((s) => s.browsingForWorkspace);
	const workspacePath = useAppStore((s) => s.workspacePath);

	return (
		<div className="h-full flex overflow-hidden">
			<AppSidebar />
			<main className="flex-1 overflow-hidden">
				{workspacePath && !browsingForWorkspace ? (
					<WorkspaceView />
				) : (
					<NewWorkspaceView />
				)}
			</main>
		</div>
	);
}
