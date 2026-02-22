import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

interface TooltipProps {
	content: string;
	children: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
	if (!content.trim()) {
		return children;
	}

	return (
		<TooltipPrimitive.Provider>
			<TooltipPrimitive.Root>
				<TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
				<TooltipPrimitive.Portal>
					<TooltipPrimitive.Content
						className="bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs px-2 py-1 rounded shadow-lg"
						sideOffset={5}
					>
						{content}
						<TooltipPrimitive.Arrow className="fill-zinc-900 dark:fill-zinc-100" />
					</TooltipPrimitive.Content>
				</TooltipPrimitive.Portal>
			</TooltipPrimitive.Root>
		</TooltipPrimitive.Provider>
	);
}
