import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { ReactNode } from "react";

interface SplitPaneProps {
  sidebar: ReactNode;
  editor?: ReactNode;
  terminal: ReactNode;
  footer?: ReactNode;
}

export function SplitPane({
  sidebar,
  editor,
  terminal,
  footer,
}: SplitPaneProps) {
  const hasEditor = editor !== undefined && editor !== null;

  return (
    <PanelGroup direction="horizontal" className="h-full">
      <Panel defaultSize={20} minSize={15} maxSize={35}>
        <div className="h-full overflow-hidden">
          {sidebar}
        </div>
      </Panel>
      <PanelResizeHandle className="w-px bg-border hover:bg-accent transition-colors" />
      {hasEditor && (
        <>
          <Panel defaultSize={40} minSize={20}>
            <div className="h-full overflow-hidden">{editor}</div>
          </Panel>
          <PanelResizeHandle className="w-px bg-border hover:bg-accent transition-colors" />
        </>
      )}
      <Panel defaultSize={hasEditor ? 40 : 80} minSize={20}>
        <div className="h-full flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">{terminal}</div>
          {footer}
        </div>
      </Panel>
    </PanelGroup>
  );
}
