import type * as Monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { type DiffFile, fetchGitDiffFiles, getCachedDiffFiles } from "./diffUtils";
import { DiffPeekWidget } from "./DiffPeekWidget";

const POLL_INTERVAL_MS = 5000;

type GutterKind = "added" | "modified" | "deleted";

export interface ChangeRegionContent {
	oldLines: string[];
	newLines: string[];
}

export interface GutterRange {
	kind: GutterKind;
	startLine: number;
	endLine: number;
	content: ChangeRegionContent;
}

function computeGutterRanges(file: DiffFile): GutterRange[] {
	const ranges: GutterRange[] = [];

	for (const hunk of file.hunks) {
		const { lines } = hunk;
		let i = 0;
		while (i < lines.length) {
			const line = lines[i]!;

			// Collect consecutive deletions
			if (line.type === "deletion") {
				const deletionStart = i;
				while (i < lines.length && lines[i]!.type === "deletion") {
					i++;
				}
				const deletionCount = i - deletionStart;
				const deletedContents = lines
					.slice(deletionStart, deletionStart + deletionCount)
					.map((l) => l.content.slice(1));

				// Check if additions follow (modified lines)
				if (i < lines.length && lines[i]!.type === "addition") {
					const addStart = i;
					while (i < lines.length && lines[i]!.type === "addition") {
						i++;
					}
					const addCount = i - addStart;
					const addedContents = lines
						.slice(addStart, addStart + addCount)
						.map((l) => l.content.slice(1));
					const firstAddLine = lines[addStart]!.newLine;
					const lastAddLine = lines[i - 1]!.newLine;
					if (firstAddLine !== null && lastAddLine !== null) {
						const modifiedEnd = Math.min(deletionCount, addCount);
						if (modifiedEnd > 0) {
							ranges.push({
								kind: "modified",
								startLine: firstAddLine,
								endLine: firstAddLine + modifiedEnd - 1,
								content: {
									oldLines: deletedContents.slice(0, modifiedEnd),
									newLines: addedContents.slice(0, modifiedEnd),
								},
							});
						}
						// Extra additions beyond the replaced count
						if (addCount > deletionCount) {
							ranges.push({
								kind: "added",
								startLine: firstAddLine + modifiedEnd,
								endLine: lastAddLine,
								content: {
									oldLines: [],
									newLines: addedContents.slice(modifiedEnd),
								},
							});
						}
						// More deletions than additions
						if (deletionCount > addCount) {
							ranges.push({
								kind: "deleted",
								startLine: lastAddLine,
								endLine: lastAddLine,
								content: {
									oldLines: deletedContents.slice(modifiedEnd),
									newLines: [],
								},
							});
						}
					}
				} else {
					// Pure deletions with no following additions
					const anchorLine = lines[deletionStart]!.anchorNewLine;
					if (anchorLine !== null && anchorLine !== undefined) {
						const markerLine = Math.max(1, anchorLine);
						ranges.push({
							kind: "deleted",
							startLine: markerLine,
							endLine: markerLine,
							content: {
								oldLines: deletedContents,
								newLines: [],
							},
						});
					}
				}
				continue;
			}

			// Consecutive additions with no preceding deletions
			if (line.type === "addition") {
				const addStart = i;
				const firstLine = line.newLine;
				while (i < lines.length && lines[i]!.type === "addition") {
					i++;
				}
				const lastLine = lines[i - 1]!.newLine;
				if (firstLine !== null && lastLine !== null) {
					ranges.push({
						kind: "added",
						startLine: firstLine,
						endLine: lastLine,
						content: {
							oldLines: [],
							newLines: lines
								.slice(addStart, i)
								.map((l) => l.content.slice(1)),
						},
					});
				}
				continue;
			}

			// Context line — skip
			i++;
		}
	}

	return ranges;
}

const GUTTER_CLASS: Record<GutterKind, string> = {
	added: "gutter-added",
	modified: "gutter-modified",
	deleted: "gutter-deleted",
};

const OVERVIEW_RULER_COLORS: Record<GutterKind, string> = {
	added: "#73c991",
	modified: "#6c95cb",
	deleted: "#c74e39",
};

const HOVER_MESSAGES: Record<GutterKind, string> = {
	added: "Added lines \u2014 click to view",
	modified: "Changed lines \u2014 click to view",
	deleted: "Removed lines \u2014 click to view",
};

function serializeRanges(ranges: GutterRange[]): string {
	return ranges
		.map((r) => `${r.kind}:${r.startLine}-${r.endLine}`)
		.join("|");
}

export function useGitGutter(
	workspaceId: string | null,
	filePath: string | null,
	editorRef: React.RefObject<Monaco.editor.IStandaloneCodeEditor | null>,
	monacoRef: React.RefObject<typeof Monaco | null>,
	isDark: boolean,
	editorReady = false,
) {
	const collectionRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);

	useEffect(() => {
		if (!workspaceId || !filePath) return;

		let cancelled = false;
		let timerId: ReturnType<typeof setTimeout> | null = null;
		let currentRanges: GutterRange[] = [];
		let rangesKey = "";
		let peekWidget: DiffPeekWidget | null = null;
		let mouseDisposable: Monaco.IDisposable | null = null;

		const applyFromFiles = (files: DiffFile[]) => {
			const editor = editorRef.current;
			const monaco = monacoRef.current;
			if (!editor || !monaco || cancelled) return;

			const diffFile = files.find((f) => f.path === filePath);
			const model = editor.getModel();
			if (!model || cancelled) return;

			const ranges = diffFile ? computeGutterRanges(diffFile) : [];
			const newKey = serializeRanges(ranges);

			// If ranges changed while peek is open, close it
			if (newKey !== rangesKey && peekWidget) {
				peekWidget.close();
			}
			rangesKey = newKey;
			currentRanges = ranges;

			const newDecorations: Monaco.editor.IModelDeltaDecoration[] = ranges.map(
				(range) => ({
					range: {
						startLineNumber: range.startLine,
						startColumn: 1,
						endLineNumber: range.endLine,
						endColumn: 1,
					},
					options: {
						isWholeLine: true,
						linesDecorationsClassName: GUTTER_CLASS[range.kind],
						overviewRuler: {
							color: OVERVIEW_RULER_COLORS[range.kind],
							position: 1, // OverviewRulerLane.Left
						},
						minimap: {
							color: OVERVIEW_RULER_COLORS[range.kind],
							position: 1, // MinimapPosition.Inline
						},
						hoverMessage: { value: HOVER_MESSAGES[range.kind] },
					},
				}),
			);

			if (!collectionRef.current) {
				collectionRef.current = editor.createDecorationsCollection(newDecorations);
			} else {
				collectionRef.current.set(newDecorations);
			}

			// Set up click handler once
			if (!mouseDisposable) {
				peekWidget = new DiffPeekWidget(editor, isDark);

				mouseDisposable = editor.onMouseDown((e) => {
					if (
						e.target.type !==
						monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
					) {
						return;
					}

					const clickedLine = e.target.position?.lineNumber;
					if (clickedLine === undefined || clickedLine === null) return;
					if (currentRanges.length === 0) return;

					const rangeIndex = currentRanges.findIndex(
						(r) => clickedLine >= r.startLine && clickedLine <= r.endLine,
					);
					if (rangeIndex === -1) return;

					// Toggle: clicking same range closes, clicking different opens
					if (peekWidget!.openIndex === rangeIndex) {
						peekWidget!.close();
					} else {
						peekWidget!.open(currentRanges, rangeIndex);
					}
				});
			}
		};

		// Apply immediately from sync cache if available (no async delay)
		const cached = getCachedDiffFiles(workspaceId);
		if (cached) {
			applyFromFiles(cached);
		}

		const fetchAndApply = async () => {
			try {
				const files = await fetchGitDiffFiles(workspaceId);
				if (!cancelled) applyFromFiles(files);
			} catch {
				// Silently ignore fetch errors — the gutter is non-critical UI
			}
		};

		const poll = () => {
			void fetchAndApply().then(() => {
				if (!cancelled) {
					timerId = setTimeout(poll, POLL_INTERVAL_MS);
				}
			});
		};

		// If we already applied from cache, delay the first poll;
		// otherwise fetch immediately.
		if (cached) {
			timerId = setTimeout(poll, POLL_INTERVAL_MS);
		} else {
			poll();
		}

		return () => {
			cancelled = true;
			if (timerId !== null) clearTimeout(timerId);

			if (mouseDisposable) {
				mouseDisposable.dispose();
				mouseDisposable = null;
			}

			if (peekWidget) {
				peekWidget.close();
				peekWidget = null;
			}

			if (collectionRef.current) {
				collectionRef.current.clear();
				collectionRef.current = null;
			}
		};
	}, [workspaceId, filePath, editorRef, monacoRef, isDark, editorReady]);
}
