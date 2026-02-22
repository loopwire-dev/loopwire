import { registerWorkspace } from "../../shared/lib/daemon/rest";
import { useAppStore } from "../../shared/stores/app-store";
import { FolderBrowser } from "./FolderBrowser";

export function NewWorkspaceView() {
	const browsingForWorkspace = useAppStore((s) => s.browsingForWorkspace);
	const addWorkspaceRoot = useAppStore((s) => s.addWorkspaceRoot);
	const setWorkspacePath = useAppStore((s) => s.setWorkspacePath);
	const setWorkspace = useAppStore((s) => s.setWorkspace);
	const setBrowsingForWorkspace = useAppStore((s) => s.setBrowsingForWorkspace);

	const handleSelect = async (path: string) => {
		addWorkspaceRoot(path);
		setWorkspacePath(path);
		setBrowsingForWorkspace(false);
		try {
			const res = await registerWorkspace(path);
			setWorkspace(path, res.workspace_id);
		} catch {
			// Workspace will work without ID, just no file tree
		}
	};

	const handleCancel = () => {
		setBrowsingForWorkspace(false);
	};

	return (
		<div className="flex items-center justify-center h-full bg-surface">
			<div className="w-full max-w-lg p-6">
				{browsingForWorkspace ? (
					<>
						<h2 className="text-xl font-semibold mb-4">Browse Folders</h2>
						<div className="border border-border rounded-xl overflow-hidden">
							<FolderBrowser onSelect={handleSelect} onCancel={handleCancel} />
						</div>
					</>
				) : (
					<div className="rounded-xl p-8 text-center bg-surface">
						<h2 className="text-xl font-semibold mb-4">Choose Workspace</h2>
						<button
							type="button"
							onClick={() => setBrowsingForWorkspace(true)}
							className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
						>
							Browse Folders
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
