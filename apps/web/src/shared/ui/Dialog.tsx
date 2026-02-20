import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  contentClassName?: string;
  showHeader?: boolean;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  contentClassName = "",
  showHeader = true,
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          forceMount
          className="lw-dialog-overlay fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"
        />
        <DialogPrimitive.Content
          forceMount
          className={`lw-dialog-content fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface rounded-xl shadow-xl border border-border w-full ${showHeader ? "p-6" : "p-0"} ${contentClassName || "max-w-md"}`}
        >
          {showHeader ? (
            <div className="flex items-center justify-between mb-4">
              <DialogPrimitive.Title className="text-lg font-semibold">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close className="rounded-lg p-1.5 text-muted hover:text-foreground hover:bg-surface-raised transition-colors">
                <X size={16} />
              </DialogPrimitive.Close>
            </div>
          ) : (
            <DialogPrimitive.Title className="sr-only">
              {title}
            </DialogPrimitive.Title>
          )}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
