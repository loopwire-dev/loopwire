import type { DiffFile, DiffLineType } from "../../editor/lib/diffUtils";

export interface UnifiedLine {
	type: DiffLineType;
	lineNumber: number | null;
	oldLine: number | null;
	content: string;
}

export function lineBackground(type: DiffLineType): string {
	if (type === "addition") return "bg-green-500/12";
	if (type === "deletion") return "bg-red-500/12";
	return "bg-surface";
}

export function stripMarker(content: string): string {
	if (!content) return content;
	const marker = content[0];
	if (marker === "+" || marker === "-" || marker === " ") {
		return content.slice(1);
	}
	return content;
}

export function buildUnifiedLines(
	file: DiffFile,
	currentContent: string,
): UnifiedLine[] {
	const additionsByNewLine = new Set<number>();
	const deletionsByAnchor = new Map<
		number,
		{ content: string; oldLine: number | null }[]
	>();

	for (const hunk of file.hunks) {
		for (const line of hunk.lines) {
			if (line.type === "addition" && line.newLine !== null) {
				additionsByNewLine.add(line.newLine);
			}
			if (line.type === "deletion") {
				const anchor = line.anchorNewLine ?? line.newLine ?? 1;
				const existing = deletionsByAnchor.get(anchor) ?? [];
				existing.push({
					content: stripMarker(line.content),
					oldLine: line.oldLine,
				});
				deletionsByAnchor.set(anchor, existing);
			}
		}
	}

	const normalized = currentContent.replace(/\r\n/g, "\n");
	const contentLines = normalized.split("\n");
	if (contentLines[contentLines.length - 1] === "") {
		contentLines.pop();
	}

	const unifiedLines: UnifiedLine[] = [];
	const pushDeletions = (anchor: number) => {
		const deletions = deletionsByAnchor.get(anchor);
		if (!deletions) return;
		for (const deletion of deletions) {
			unifiedLines.push({
				type: "deletion",
				lineNumber: null,
				oldLine: deletion.oldLine,
				content: deletion.content,
			});
		}
	};

	for (let lineNumber = 1; lineNumber <= contentLines.length; lineNumber += 1) {
		pushDeletions(lineNumber);
		const content = contentLines[lineNumber - 1] ?? "";
		unifiedLines.push({
			type: additionsByNewLine.has(lineNumber) ? "addition" : "context",
			lineNumber,
			oldLine: null,
			content,
		});
	}

	pushDeletions(contentLines.length + 1);
	return unifiedLines;
}

export function splitLineMarker(type: DiffLineType): {
	marker: string;
	markerClass: string;
} {
	if (type === "addition") {
		return { marker: "+", markerClass: "text-green-700 dark:text-green-400" };
	}
	if (type === "deletion") {
		return { marker: "-", markerClass: "text-red-700 dark:text-red-400" };
	}
	return { marker: "", markerClass: "text-muted" };
}
