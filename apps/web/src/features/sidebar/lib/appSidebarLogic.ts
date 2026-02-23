const MENU_CONTAINER_SELECTOR = "[data-workspace-menu-container='true']";
const MENU_SELECTOR = "[data-workspace-menu='true']";

export const COMPACT_SIDEBAR_INTERACTIVE_SELECTOR =
	"button, [role='button'], a[href], input, textarea, select, summary, label[for], [role='link'], [role='menuitem'], [tabindex]:not([tabindex='-1']), [data-workspace-menu-container='true'], [data-workspace-menu='true']";

type ClosestCapable = {
	closest: (selector: string) => unknown;
};

function getClosestCapableTarget(
	target: EventTarget | null,
): ClosestCapable | null {
	if (target && typeof target === "object") {
		const candidate = target as { closest?: unknown; parentElement?: unknown };
		if (typeof candidate.closest === "function") {
			return candidate as ClosestCapable;
		}
		const parent = candidate.parentElement as { closest?: unknown } | undefined;
		if (parent && typeof parent.closest === "function") {
			return parent as ClosestCapable;
		}
	}
	return null;
}

export function shouldCloseWorkspaceMenu(target: EventTarget | null): boolean {
	const element = getClosestCapableTarget(target);
	if (!element) return true;
	return (
		!element.closest(MENU_CONTAINER_SELECTOR) && !element.closest(MENU_SELECTOR)
	);
}

export function isInteractiveSidebarTarget(
	target: EventTarget | null,
	selector = COMPACT_SIDEBAR_INTERACTIVE_SELECTOR,
): boolean {
	const element = getClosestCapableTarget(target);
	if (!element) return false;
	return element.closest(selector) !== null;
}

export function getSingleSessionId(
	existing: Array<{ sessionId?: string | null }>,
): string | null {
	if (existing.length !== 1) return null;
	return existing[0]?.sessionId ?? null;
}
