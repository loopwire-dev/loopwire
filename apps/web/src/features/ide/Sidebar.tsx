import type { ReactNode } from "react";

export function Sidebar({ children }: { children: ReactNode }) {
	return (
		<div className="h-full flex flex-col bg-surface">
			<div className="flex-1 overflow-hidden">{children}</div>
		</div>
	);
}
