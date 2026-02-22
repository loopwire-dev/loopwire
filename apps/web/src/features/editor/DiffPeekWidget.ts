import type * as Monaco from "monaco-editor";
import type { GutterRange } from "./useGitGutter";

function svgIcon(path: string, size = 16): HTMLSpanElement {
	const span = document.createElement("span");
	span.style.display = "inline-flex";
	span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
	return span;
}

// Lucide icon paths
const ICON_CHEVRON_UP = "m18 15-6-6-6 6";
const ICON_CHEVRON_DOWN = "m6 9 6 6 6-6";
const ICON_X = "M18 6 6 18M6 6l12 12";

const LABEL: Record<string, string> = {
	added: "Added",
	modified: "Modified",
	deleted: "Removed",
};

export class DiffPeekWidget {
	private editor: Monaco.editor.IStandaloneCodeEditor;
	private zoneId: string | null = null;
	private currentIndex: number | null = null;
	private disposables: Monaco.IDisposable[] = [];
	private overlayNode: HTMLElement | null = null;
	private totalHeight = 0;
	private afterLine = 0;

	constructor(editor: Monaco.editor.IStandaloneCodeEditor, _isDark: boolean) {
		this.editor = editor;
	}

	get openIndex(): number | null {
		return this.currentIndex;
	}

	open(ranges: GutterRange[], index: number): void {
		this.close();

		const range = ranges[index];
		if (!range) return;

		this.currentIndex = index;
		this.afterLine = range.endLine;

		// --- Build the overlay UI (appended to overflow-guard, ABOVE all Monaco layers) ---
		const overlay = document.createElement("div");
		overlay.className = "diff-peek-widget";
		this.overlayNode = overlay;

		// --- header ---
		const header = document.createElement("div");
		header.className = "diff-peek-header";

		const label = document.createElement("span");
		label.className = "diff-peek-label";
		label.textContent = `${LABEL[range.kind] ?? range.kind} \u2014 ${index + 1} of ${ranges.length} changes`;
		header.appendChild(label);

		const nav = document.createElement("span");
		nav.className = "diff-peek-nav";

		const prevBtn = document.createElement("button");
		prevBtn.className = "diff-peek-btn";
		prevBtn.appendChild(svgIcon(ICON_CHEVRON_UP));
		prevBtn.title = "Previous change";
		prevBtn.disabled = index === 0;
		prevBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.navigate(ranges, index - 1);
		});

		const counter = document.createElement("span");
		counter.className = "diff-peek-counter";
		counter.textContent = `${index + 1}/${ranges.length}`;

		const nextBtn = document.createElement("button");
		nextBtn.className = "diff-peek-btn";
		nextBtn.appendChild(svgIcon(ICON_CHEVRON_DOWN));
		nextBtn.title = "Next change";
		nextBtn.disabled = index === ranges.length - 1;
		nextBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.navigate(ranges, index + 1);
		});

		const closeBtn = document.createElement("button");
		closeBtn.className = "diff-peek-btn diff-peek-close";
		closeBtn.appendChild(svgIcon(ICON_X));
		closeBtn.title = "Close";
		closeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.close();
		});

		nav.appendChild(prevBtn);
		nav.appendChild(counter);
		nav.appendChild(nextBtn);
		nav.appendChild(closeBtn);
		header.appendChild(nav);
		overlay.appendChild(header);

		// --- body ---
		const body = document.createElement("div");
		body.className = "diff-peek-body";

		for (const line of range.content.oldLines) {
			const row = document.createElement("div");
			row.className = "diff-peek-line diff-peek-del";
			const marker = document.createElement("span");
			marker.className = "diff-peek-marker diff-peek-marker-del";
			marker.textContent = "-";
			row.appendChild(marker);
			row.appendChild(document.createTextNode(` ${line}`));
			body.appendChild(row);
		}

		for (const line of range.content.newLines) {
			const row = document.createElement("div");
			row.className = "diff-peek-line diff-peek-add";
			const marker = document.createElement("span");
			marker.className = "diff-peek-marker diff-peek-marker-add";
			marker.textContent = "+";
			row.appendChild(marker);
			row.appendChild(document.createTextNode(` ${line}`));
			body.appendChild(row);
		}

		if (
			range.content.oldLines.length === 0 &&
			range.content.newLines.length === 0
		) {
			const empty = document.createElement("div");
			empty.className = "diff-peek-line";
			empty.textContent = "  (no content)";
			body.appendChild(empty);
		}

		overlay.appendChild(body);

		// Compute height: header 30px + body lines capped at 300px
		const lineCount =
			range.content.oldLines.length + range.content.newLines.length;
		const bodyHeight = Math.min(Math.max(lineCount, 1) * 20, 300);
		this.totalHeight = 30 + bodyHeight + 2; // 2px for borders

		// Append overlay to the editor's overflow-guard (above all Monaco layers)
		const editorDom = this.editor.getDomNode();
		const overflowGuard = editorDom?.querySelector(
			".overflow-guard",
		) as HTMLElement | null;
		if (overflowGuard) {
			overflowGuard.appendChild(overlay);
		}

		// Create a minimal view zone just for space reservation
		const spacer = document.createElement("div");
		this.editor.changeViewZones((accessor) => {
			this.zoneId = accessor.addZone({
				afterLineNumber: range.endLine,
				heightInPx: this.totalHeight,
				domNode: spacer,
			});
		});

		// Position the overlay and keep it in sync
		this.syncPosition();
		this.disposables.push(
			this.editor.onDidScrollChange(() => this.syncPosition()),
			this.editor.onDidLayoutChange(() => this.syncPosition()),
		);

		this.editor.revealLineInCenter(range.startLine);
	}

	close(): void {
		for (const d of this.disposables) d.dispose();
		this.disposables = [];

		if (this.overlayNode?.parentElement) {
			this.overlayNode.parentElement.removeChild(this.overlayNode);
		}
		this.overlayNode = null;

		if (this.zoneId !== null) {
			const id = this.zoneId;
			this.editor.changeViewZones((accessor) => {
				accessor.removeZone(id);
			});
			this.zoneId = null;
		}
		this.currentIndex = null;
	}

	private syncPosition(): void {
		if (!this.overlayNode) return;

		const layout = this.editor.getLayoutInfo();
		// Top position: get the pixel position of the line AFTER the change,
		// then the view zone sits right after it.
		const topForLine = this.editor.getTopForLineNumber(this.afterLine + 1);
		const scrollTop = this.editor.getScrollTop();
		// The overlay top relative to the overflow-guard.
		// topForLine is the top of the line AFTER the view zone,
		// so subtract totalHeight to get the top of the view zone itself.
		const top = topForLine - scrollTop - this.totalHeight;
		// Shift 2ch left so the "- "/"+ " markers sit in the gutter area
		// and the actual code text stays aligned with the editor content.
		const left = layout.contentLeft;
		const width = layout.contentWidth - layout.verticalScrollbarWidth;

		this.overlayNode.style.position = "absolute";
		this.overlayNode.style.top = `${top}px`;
		this.overlayNode.style.left = `calc(${left}px - 2ch - 4px)`;
		this.overlayNode.style.width = `calc(${width}px + 2ch + 4px)`;
		this.overlayNode.style.height = `${this.totalHeight}px`;
		this.overlayNode.style.zIndex = "5";
	}

	private navigate(ranges: GutterRange[], newIndex: number): void {
		if (newIndex < 0 || newIndex >= ranges.length) return;
		this.open(ranges, newIndex);
	}
}
