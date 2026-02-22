import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";

interface SelectOption {
	value: string;
	label: string;
}

interface SelectProps {
	value: string;
	onValueChange: (value: string) => void;
	options: SelectOption[];
	placeholder?: string;
}

export function Select({
	value,
	onValueChange,
	options,
	placeholder = "Select...",
}: SelectProps) {
	return (
		<SelectPrimitive.Root value={value} onValueChange={onValueChange}>
			<SelectPrimitive.Trigger className="inline-flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm w-full hover:bg-surface-raised focus:outline-2 focus:outline-accent">
				<SelectPrimitive.Value placeholder={placeholder} />
				<SelectPrimitive.Icon className="ml-2 text-muted">
					<ChevronDown size={16} aria-hidden="true" />
				</SelectPrimitive.Icon>
			</SelectPrimitive.Trigger>
			<SelectPrimitive.Portal>
				<SelectPrimitive.Content className="bg-surface rounded-lg border border-border shadow-lg overflow-hidden">
					<SelectPrimitive.Viewport className="p-1">
						{options.map((opt) => (
							<SelectPrimitive.Item
								key={opt.value}
								value={opt.value}
								className="relative flex items-center px-3 py-2 text-sm rounded-md cursor-pointer select-none hover:bg-surface-raised focus:bg-surface-raised outline-none"
							>
								<SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
							</SelectPrimitive.Item>
						))}
					</SelectPrimitive.Viewport>
				</SelectPrimitive.Content>
			</SelectPrimitive.Portal>
		</SelectPrimitive.Root>
	);
}
