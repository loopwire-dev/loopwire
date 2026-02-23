import { beforeEach, describe, expect, it, vi } from "vitest";

const { useStateMock, useAppStoreMock, startSessionMock, getAgentIconMock } =
	vi.hoisted(() => ({
		useStateMock: vi.fn(),
		useAppStoreMock: vi.fn(),
		startSessionMock: vi.fn(),
		getAgentIconMock: vi.fn(),
	}));

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useState: useStateMock,
	};
});

vi.mock("../../../shared/stores/app-store", () => ({
	useAppStore: (selector: (state: unknown) => unknown) =>
		useAppStoreMock(selector),
}));

vi.mock("../hooks/useAgent", () => ({
	useAgent: () => ({ startSession: startSessionMock }),
}));

vi.mock("../lib/agentIcons", () => ({
	getAgentIcon: getAgentIconMock,
}));

function visit(node: unknown, fn: (value: Record<string, unknown>) => void) {
	if (!node || typeof node !== "object") return;
	const value = node as Record<string, unknown>;
	fn(value);
	const props = value.props as Record<string, unknown> | undefined;
	const children = props?.children;
	if (Array.isArray(children)) {
		for (const child of children) visit(child, fn);
	} else {
		visit(children, fn);
	}
}

function textOf(node: unknown): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (!node || typeof node !== "object") return "";
	const props = (node as Record<string, unknown>).props as
		| Record<string, unknown>
		| undefined;
	const children = props?.children;
	if (Array.isArray(children)) return children.map(textOf).join("");
	return textOf(children);
}

function findButtonByText(
	tree: unknown,
	label: string,
): Record<string, unknown> | null {
	let found: Record<string, unknown> | null = null;
	visit(tree, (node) => {
		if (found || node.type !== "button") return;
		if (textOf(node).includes(label)) found = node;
	});
	return found;
}

describe("InlineAgentPicker", () => {
	beforeEach(() => {
		vi.resetModules();
		useStateMock.mockReset();
		useAppStoreMock.mockReset();
		startSessionMock.mockReset();
		getAgentIconMock.mockReset();

		getAgentIconMock.mockReturnValue(null);
	});

	it("shows empty state when no agents are detected", async () => {
		useStateMock
			.mockReturnValueOnce(["", vi.fn()])
			.mockReturnValueOnce([null, vi.fn()])
			.mockReturnValueOnce([false, vi.fn()]);
		const state = {
			availableAgents: [],
			workspacePath: "/repo",
		};
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);

		const { InlineAgentPicker } = await import(
			"../components/InlineAgentPicker"
		);
		const tree = InlineAgentPicker();
		expect(textOf(tree)).toContain("No agents detected.");
	});

	it("starts selected installed agent and opens gemini install link", async () => {
		const setError = vi.fn();
		useStateMock
			.mockReturnValueOnce(["codex", vi.fn()])
			.mockReturnValueOnce([null, setError])
			.mockReturnValueOnce([false, vi.fn()]);
		const state = {
			availableAgents: [
				{
					agent_type: "codex",
					name: "Codex",
					version: "1.0.0",
					installed: true,
				},
				{
					agent_type: "gemini",
					name: "Gemini",
					version: null,
					installed: false,
				},
			],
			workspacePath: "/repo",
		};
		useAppStoreMock.mockImplementation(
			(selector: (s: typeof state) => unknown) => selector(state),
		);
		startSessionMock.mockResolvedValue(undefined);
		const openSpy = vi.fn();
		Object.defineProperty(globalThis, "window", {
			value: { open: openSpy },
			configurable: true,
		});

		const { InlineAgentPicker } = await import(
			"../components/InlineAgentPicker"
		);
		const tree = InlineAgentPicker();
		const codexBtn = findButtonByText(tree, "Codex");
		const geminiBtn = findButtonByText(tree, "Gemini");
		if (!codexBtn || !geminiBtn) throw new Error("Expected agent buttons");

		await (codexBtn.props as { onClick: () => Promise<void> }).onClick();
		(geminiBtn.props as { onClick: () => void }).onClick();

		expect(startSessionMock).toHaveBeenCalledWith("codex", "/repo");
		expect(setError).toHaveBeenCalledWith(null);
		expect(openSpy).toHaveBeenCalledWith(
			"https://github.com/google-gemini/gemini-cli#quickstart",
			"_blank",
			"noopener,noreferrer",
		);
	});
});
