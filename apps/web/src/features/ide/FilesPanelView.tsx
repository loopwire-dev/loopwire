import { useAppStore } from "../../shared/stores/app-store";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { FileTree } from "../workspace/FileTree";
import { CodeEditor } from "../editor/CodeEditor";

export function FilesPanelView() {
	const openFilePath = useAppStore((s) => s.openFilePath);

	return (
		<div className="h-full flex flex-col bg-surface">
			<PanelGroup
				direction="horizontal"
				className="flex-1 min-h-0"
				autoSaveId="files-panel-layout"
			>
				<Panel defaultSize={22} minSize={14} maxSize={35}>
					<aside className="h-full min-h-0 overflow-hidden border-r border-border">
						<FileTree />
					</aside>
				</Panel>
				<PanelResizeHandle className="w-px bg-border/80 hover:bg-accent/40 transition-colors data-[resize-handle-state=drag]:bg-accent/50" />
				<Panel minSize={30}>
					<div className="h-full min-h-0 overflow-hidden">
						{openFilePath ? (
							<CodeEditor />
						) : (
							<div className="h-full flex items-center justify-center text-sm text-muted">
								Select a file to preview
							</div>
						)}
					</div>
				</Panel>
			</PanelGroup>
		</div>
	);
}
