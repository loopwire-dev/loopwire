import {
	ChevronDown,
	ChevronRight,
	ChevronsDownUp,
	ChevronsUpDown,
	RefreshCw,
	Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fsReadMany, isNotGitRepoError } from "../../../shared/lib/daemon/rest";
import { useAppStore } from "../../../shared/stores/app-store";
import {
	type DiffFile,
	type DiffLine,
	fetchGitDiff,
	parseUnifiedPatch,
} from "../../editor/lib/diffUtils";
import {
	type UnifiedLine,
	buildUnifiedLines,
	lineBackground,
	splitLineMarker,
	stripMarker,
} from "../lib/gitDiffUnifiedLines";

type DiffViewMode = "split" | "unified";

interface SplitHunksProps {
	file: DiffFile;
	fileKey: string;
	collapsedHunkKeys: Record<string, boolean>;
	onToggleHunk: (hunkKey: string) => void;
}

interface UnifiedVirtualizedLinesProps {
	lines: UnifiedLine[];
	rowKeyPrefix: string;
}

interface SplitVirtualizedLinesProps {
	lines: DiffLine[];
	rowKeyPrefix: string;
}

const ALL_FILES_KEY = "__all__";
const UNIFIED_LOADING = "__loading__" as const;
const UNIFIED_FILE_CLIENT_CACHE_TTL_MS = 15000;
const UNIFIED_ROW_HEIGHT_PX = 24;
const UNIFIED_OVERSCAN_ROWS = 40;
const SPLIT_ROW_HEIGHT_PX = 24;
const SPLIT_OVERSCAN_ROWS = 20;
const SPLIT_VIRTUALIZE_THRESHOLD = 80;

interface CachedUnifiedFile {
	content: string | null;
	expiresAt: number;
}

interface UnifiedLinesCacheEntry {
	token: string;
	lines: UnifiedLine[];
}

const unifiedFileClientCache = new Map<string, CachedUnifiedFile>();
const unifiedFileClientInFlight = new Map<string, Promise<string | null>>();

function clearUnifiedWorkspaceCaches(workspaceId: string): void {
	const prefix = `${workspaceId}::`;
	for (const key of unifiedFileClientCache.keys()) {
		if (key.startsWith(prefix)) {
			unifiedFileClientCache.delete(key);
		}
	}
	for (const key of unifiedFileClientInFlight.keys()) {
		if (key.startsWith(prefix)) {
			unifiedFileClientInFlight.delete(key);
		}
	}
}

function unifiedFileCacheKey(
	workspaceId: string,
	relativePath: string,
): string {
	return `${workspaceId}::${relativePath}`;
}

async function fetchUnifiedFilesBatch(
	workspaceId: string,
	relativePaths: string[],
	force = false,
): Promise<Record<string, string | null>> {
	const uniquePaths = [...new Set(relativePaths)];
	const result: Record<string, string | null> = {};
	const waiting: Array<[string, Promise<string | null>]> = [];
	const toFetch: string[] = [];

	for (const relativePath of uniquePaths) {
		const key = unifiedFileCacheKey(workspaceId, relativePath);
		if (!force) {
			const cached = unifiedFileClientCache.get(key);
			if (cached && cached.expiresAt > Date.now()) {
				result[relativePath] = cached.content;
				continue;
			}
			const inFlight = unifiedFileClientInFlight.get(key);
			if (inFlight) {
				waiting.push([relativePath, inFlight]);
				continue;
			}
		}
		toFetch.push(relativePath);
	}

	if (toFetch.length > 0) {
		const batchPromise = fsReadMany(workspaceId, toFetch)
			.then((response) => {
				const files = response.files ?? {};
				const loaded: Record<string, string | null> = {};
				for (const path of toFetch) {
					const file = files[path];
					loaded[path] = file && !file.is_binary ? file.content : null;
				}
				return loaded;
			})
			.catch(() => {
				const failed: Record<string, string | null> = {};
				for (const path of toFetch) {
					failed[path] = null;
				}
				return failed;
			});

		for (const path of toFetch) {
			const key = unifiedFileCacheKey(workspaceId, path);
			const filePromise = batchPromise
				.then((loaded) => loaded[path] ?? null)
				.finally(() => {
					unifiedFileClientInFlight.delete(key);
				});
			unifiedFileClientInFlight.set(key, filePromise);
		}

		const loaded = await batchPromise;
		for (const [path, content] of Object.entries(loaded)) {
			result[path] = content;
			unifiedFileClientCache.set(unifiedFileCacheKey(workspaceId, path), {
				content,
				expiresAt: Date.now() + UNIFIED_FILE_CLIENT_CACHE_TTL_MS,
			});
		}
	}

	if (waiting.length > 0) {
		const awaited = await Promise.all(
			waiting.map(async ([path, promise]) => [path, await promise] as const),
		);
		for (const [path, content] of awaited) {
			result[path] = content;
		}
	}

	return result;
}

function fileEntryKey(path: string, index: number): string {
	return `${path}::${index}`;
}

function SplitLineRow({
	line,
}: {
	line: DiffLine;
}): JSX.Element {
	const { marker, markerClass } = splitLineMarker(line.type);

	return (
		<div
			className={`grid h-6 grid-cols-[3.5rem_3.5rem_1.5rem_minmax(0,1fr)] ${lineBackground(line.type)}`}
		>
			<span className="border-r border-border/80 px-2 py-0.5 text-right text-[10px] text-muted">
				{line.oldLine ?? ""}
			</span>
			<span className="border-r border-border/80 px-2 py-0.5 text-right text-[10px] text-muted">
				{line.newLine ?? ""}
			</span>
			<span
				className={`flex h-full items-center justify-center border-r border-border/80 text-center text-[11px] font-semibold leading-none ${markerClass}`}
			>
				{marker}
			</span>
			<pre className="m-0 whitespace-pre px-2 py-0.5 leading-5">
				{stripMarker(line.content)}
			</pre>
		</div>
	);
}

function SplitVirtualizedLines({
	lines,
	rowKeyPrefix,
}: SplitVirtualizedLinesProps): JSX.Element {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(320);

	useEffect(() => {
		const element = containerRef.current;
		if (!element) return;

		const updateHeight = () => {
			setViewportHeight(element.clientHeight || 320);
		};
		updateHeight();

		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", updateHeight);
			return () => window.removeEventListener("resize", updateHeight);
		}

		const observer = new ResizeObserver(updateHeight);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const element = containerRef.current;
		if (!element) return;
		void rowKeyPrefix;
		void lines.length;
		element.scrollTop = 0;
		setScrollTop(0);
	}, [rowKeyPrefix, lines.length]);

	const totalHeight = lines.length * SPLIT_ROW_HEIGHT_PX;
	const startIndex = Math.max(
		0,
		Math.floor(scrollTop / SPLIT_ROW_HEIGHT_PX) - SPLIT_OVERSCAN_ROWS,
	);
	const visibleCount =
		Math.ceil(viewportHeight / SPLIT_ROW_HEIGHT_PX) + SPLIT_OVERSCAN_ROWS * 2;
	const endIndex = Math.min(lines.length, startIndex + visibleCount);
	const visibleLines = lines.slice(startIndex, endIndex);

	return (
		<div
			ref={containerRef}
			onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
			className="max-h-[55vh] overflow-auto font-mono text-xs"
		>
			<div
				style={{
					height: totalHeight,
					position: "relative",
					minWidth: "100%",
				}}
			>
				<div
					style={{
						transform: `translateY(${startIndex * SPLIT_ROW_HEIGHT_PX}px)`,
					}}
				>
					{visibleLines.map((line, offset) => {
						const index = startIndex + offset;
						return (
							<SplitLineRow
								key={`${rowKeyPrefix}-virtual-line-${index}`}
								line={line}
							/>
						);
					})}
				</div>
			</div>
		</div>
	);
}

function renderSplitHunks({
	file,
	fileKey,
	collapsedHunkKeys,
	onToggleHunk,
}: SplitHunksProps): JSX.Element {
	if (file.hunks.length === 0) {
		return (
			<div className="px-3 py-2 font-mono text-xs text-muted">
				Binary or mode-only change.
			</div>
		);
	}

	return (
		<>
			{file.hunks.map((hunk) => {
				const firstLine = hunk.lines[0];
				const hunkIdentity = `${hunk.header}::${firstLine?.oldLine ?? "n"}::${firstLine?.newLine ?? "n"}`;
				const hunkKey = `${fileKey}::${hunkIdentity}`;
				const hunkCollapsed = Boolean(collapsedHunkKeys[hunkKey]);
				return (
					<div
						key={hunkKey}
						className="border-b border-border last:border-b-0 [content-visibility:auto] [contain-intrinsic-size:280px]"
					>
						<div className="flex items-center justify-between border-b border-border bg-surface-overlay/70 px-3 py-1.5 font-mono text-[11px] text-muted">
							<span>{hunk.header}</span>
							<button
								type="button"
								onClick={() => onToggleHunk(hunkKey)}
								className="inline-flex items-center rounded border border-border px-1 py-0.5 text-[10px] hover:bg-surface-overlay"
								title={hunkCollapsed ? "Expand hunk" : "Collapse hunk"}
							>
								{hunkCollapsed ? (
									<ChevronRight className="h-3 w-3" />
								) : (
									<ChevronDown className="h-3 w-3" />
								)}
							</button>
						</div>
						{!hunkCollapsed &&
							(hunk.lines.length > SPLIT_VIRTUALIZE_THRESHOLD ? (
								<SplitVirtualizedLines
									lines={hunk.lines}
									rowKeyPrefix={hunkKey}
								/>
							) : (
								<div className="font-mono text-xs">
									{hunk.lines.map((line) => (
										<SplitLineRow
											key={`${hunkKey}-${line.oldLine ?? "n"}-${line.newLine ?? "n"}-${line.content}`}
											line={line}
										/>
									))}
								</div>
							))}
					</div>
				);
			})}
		</>
	);
}

function UnifiedVirtualizedLines({
	lines,
	rowKeyPrefix,
}: UnifiedVirtualizedLinesProps): JSX.Element {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(360);

	useEffect(() => {
		const element = containerRef.current;
		if (!element) return;

		const updateHeight = () => {
			setViewportHeight(element.clientHeight || 360);
		};
		updateHeight();

		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", updateHeight);
			return () => window.removeEventListener("resize", updateHeight);
		}

		const observer = new ResizeObserver(updateHeight);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const element = containerRef.current;
		if (!element) return;
		void rowKeyPrefix;
		void lines.length;
		element.scrollTop = 0;
		setScrollTop(0);
	}, [rowKeyPrefix, lines.length]);

	const totalHeight = lines.length * UNIFIED_ROW_HEIGHT_PX;
	const startIndex = Math.max(
		0,
		Math.floor(scrollTop / UNIFIED_ROW_HEIGHT_PX) - UNIFIED_OVERSCAN_ROWS,
	);
	const visibleCount =
		Math.ceil(viewportHeight / UNIFIED_ROW_HEIGHT_PX) +
		UNIFIED_OVERSCAN_ROWS * 2;
	const endIndex = Math.min(lines.length, startIndex + visibleCount);
	const visibleLines = lines.slice(startIndex, endIndex);

	return (
		<div
			ref={containerRef}
			onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
			className="max-h-[65vh] overflow-auto font-mono text-xs"
		>
			<div
				style={{
					height: totalHeight,
					position: "relative",
					minWidth: "100%",
				}}
			>
				<div
					style={{
						transform: `translateY(${startIndex * UNIFIED_ROW_HEIGHT_PX}px)`,
					}}
				>
					{visibleLines.map((line, offset) => {
						const index = startIndex + offset;
						const marker =
							line.type === "addition"
								? "+"
								: line.type === "deletion"
									? "-"
									: "";
						const markerClass =
							line.type === "addition"
								? "text-green-700 dark:text-green-400"
								: line.type === "deletion"
									? "text-red-700 dark:text-red-400"
									: "text-muted";
						return (
							<div
								key={`${rowKeyPrefix}-unified-line-${index}`}
								className={`grid h-6 grid-cols-[4.5rem_1.5rem_minmax(0,1fr)] ${lineBackground(line.type)}`}
							>
								<span className="border-r border-border/80 px-2 py-0.5 text-right text-[10px] text-muted">
									{line.type === "deletion"
										? (line.oldLine ?? "")
										: (line.lineNumber ?? "")}
								</span>
								<span
									className={`flex h-full items-center justify-center border-r border-border/80 text-center text-[11px] font-semibold leading-none ${markerClass}`}
								>
									{marker}
								</span>
								<pre className="m-0 whitespace-pre px-2 py-0.5 leading-5">
									{line.content}
								</pre>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

export function GitPanelView() {
	const workspaceId = useAppStore((s) => s.workspaceId);
	const initialDiffLoadRef = useRef<string | null>(null);
	const unifiedLinesCacheRef = useRef<Map<string, UnifiedLinesCacheEntry>>(
		new Map(),
	);
	const [files, setFiles] = useState<DiffFile[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [updatedAt, setUpdatedAt] = useState<string | null>(null);
	const [selectedFileKey, setSelectedFileKey] = useState<string>(ALL_FILES_KEY);
	const [collapsedFileKeys, setCollapsedFileKeys] = useState<
		Record<string, boolean>
	>({});
	const [collapsedHunkKeys, setCollapsedHunkKeys] = useState<
		Record<string, boolean>
	>({});
	const [viewMode, setViewMode] = useState<DiffViewMode>("split");
	const [fileFilter, setFileFilter] = useState("");
	const [unifiedContentByPath, setUnifiedContentByPath] = useState<
		Record<string, string | null | typeof UNIFIED_LOADING>
	>({});

	const filesWithKeys = useMemo(
		() =>
			files.map((file, index) => ({
				file,
				key: fileEntryKey(file.path, index),
			})),
		[files],
	);

	const filteredFilesWithKeys = useMemo(() => {
		if (!fileFilter) return filesWithKeys;
		const lower = fileFilter.toLowerCase();
		return filesWithKeys.filter(({ file }) =>
			file.path.toLowerCase().includes(lower),
		);
	}, [filesWithKeys, fileFilter]);

	useEffect(() => {
		if (selectedFileKey === ALL_FILES_KEY) return;
		const stillExists = filesWithKeys.some(
			(entry) => entry.key === selectedFileKey,
		);
		if (!stillExists) {
			setSelectedFileKey(ALL_FILES_KEY);
		}
	}, [filesWithKeys, selectedFileKey]);

	const visibleFiles = useMemo(() => {
		if (selectedFileKey === ALL_FILES_KEY) return filesWithKeys;
		return filesWithKeys.filter((entry) => entry.key === selectedFileKey);
	}, [filesWithKeys, selectedFileKey]);
	const visibleFileKeys = useMemo(
		() => visibleFiles.map((entry) => entry.key),
		[visibleFiles],
	);
	const areAllVisibleFilesCollapsed = useMemo(() => {
		if (visibleFileKeys.length === 0) return false;
		return visibleFileKeys.every((key) => Boolean(collapsedFileKeys[key]));
	}, [visibleFileKeys, collapsedFileKeys]);

	const toggleFileCollapsed = (key: string) => {
		setCollapsedFileKeys((prev) => ({
			...prev,
			[key]: !prev[key],
		}));
	};

	const toggleHunkCollapsed = (key: string) => {
		setCollapsedHunkKeys((prev) => ({
			...prev,
			[key]: !prev[key],
		}));
	};
	const setAllVisibleCollapsed = (collapse: boolean) => {
		setCollapsedFileKeys((prev) => {
			const next = { ...prev };
			for (const key of visibleFileKeys) {
				next[key] = collapse;
			}
			return next;
		});
	};

	const getUnifiedLinesForFile = useCallback(
		(file: DiffFile, fileKey: string, content: string): UnifiedLine[] => {
			const token = `${file.path}|${file.additions}|${file.deletions}|${file.hunks.length}|${content.length}`;
			const cached = unifiedLinesCacheRef.current.get(fileKey);
			if (cached && cached.token === token) {
				return cached.lines;
			}
			const lines = buildUnifiedLines(file, content);
			unifiedLinesCacheRef.current.set(fileKey, { token, lines });
			return lines;
		},
		[],
	);

	const loadDiff = useCallback(
		async (options?: { force?: boolean }) => {
			if (!workspaceId) {
				setFiles([]);
				setError("Workspace is not registered yet.");
				return;
			}

			setLoading(true);
			setError(null);
			try {
				const response = await fetchGitDiff(
					workspaceId,
					options?.force ?? false,
				);
				clearUnifiedWorkspaceCaches(workspaceId);
				setUnifiedContentByPath({});
				unifiedLinesCacheRef.current.clear();
				setFiles(parseUnifiedPatch(response.patch));
				setUpdatedAt(new Date().toLocaleTimeString());
			} catch (err) {
				if (isNotGitRepoError(err)) {
					setError("This workspace is not a Git repository.");
				} else if (err instanceof Error) {
					setError(err.message);
				} else {
					setError("Failed to load Git diff.");
				}
			} finally {
				setLoading(false);
			}
		},
		[workspaceId],
	);

	useEffect(() => {
		if (!workspaceId) return;
		if (initialDiffLoadRef.current === workspaceId) return;
		initialDiffLoadRef.current = workspaceId;
		void loadDiff();
	}, [workspaceId, loadDiff]);

	useEffect(() => {
		if (!workspaceId || filesWithKeys.length === 0) return;
		const targetPaths = filesWithKeys
			.map(({ file }) => file)
			.filter((file) => file.status !== "deleted")
			.map((file) => file.path);
		const uniquePaths = [...new Set(targetPaths)];
		if (uniquePaths.length === 0) return;

		let cancelled = false;
		const timer = window.setTimeout(() => {
			void (async () => {
				const loaded = await fetchUnifiedFilesBatch(workspaceId, uniquePaths);
				if (cancelled) return;
				setUnifiedContentByPath((prev) => {
					let changed = false;
					const next = { ...prev };
					for (const [path, content] of Object.entries(loaded)) {
						if (next[path] !== content) {
							next[path] = content;
							changed = true;
						}
					}
					return changed ? next : prev;
				});
				if (cancelled) return;
				for (const { file, key } of filesWithKeys) {
					const content = loaded[file.path];
					if (typeof content === "string") {
						void getUnifiedLinesForFile(file, key, content);
					}
				}
			})();
		}, 120);

		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [workspaceId, filesWithKeys, getUnifiedLinesForFile]);

	const loadUnifiedVisibleFiles = useCallback(async () => {
		if (!workspaceId) return;
		const targetPaths = visibleFiles
			.map(({ file }) => file)
			.filter((file) => file.status !== "deleted")
			.map((file) => file.path);
		const uniquePaths = [...new Set(targetPaths)];
		const missingPaths = uniquePaths.filter(
			(path) => !(path in unifiedContentByPath),
		);
		if (missingPaths.length === 0) return;

		setUnifiedContentByPath((prev) => {
			const next = { ...prev };
			for (const path of missingPaths) {
				if (!(path in next)) {
					next[path] = UNIFIED_LOADING;
				}
			}
			return next;
		});

		const loaded = await fetchUnifiedFilesBatch(workspaceId, missingPaths);
		setUnifiedContentByPath((prev) => {
			const next = { ...prev };
			for (const [path, content] of Object.entries(loaded)) {
				next[path] = content;
			}
			return next;
		});
	}, [workspaceId, visibleFiles, unifiedContentByPath]);

	useEffect(() => {
		if (viewMode !== "unified") return;
		void loadUnifiedVisibleFiles();
	}, [viewMode, loadUnifiedVisibleFiles]);

	return (
		<div className="h-full flex flex-col bg-surface">
			<div className="flex items-center justify-between border-b border-border bg-surface-raised px-4 py-3">
				<div>
					<p className="text-sm font-semibold">Git Diff</p>
					<p className="text-xs text-muted">
						{filesWithKeys.length} changed file
						{filesWithKeys.length === 1 ? "" : "s"}
						{updatedAt ? ` • updated ${updatedAt}` : ""}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<div className="inline-flex rounded-md border border-border bg-surface p-0.5 gap-0.5 text-xs">
						<button
							type="button"
							onClick={() => setViewMode("split")}
							className={`rounded px-2 py-1 transition-colors ${
								viewMode === "split"
									? "bg-accent text-accent-foreground"
									: "text-muted hover:bg-surface-overlay"
							}`}
						>
							Split
						</button>
						<button
							type="button"
							onClick={() => setViewMode("unified")}
							className={`rounded px-2 py-1 transition-colors ${
								viewMode === "unified"
									? "bg-accent text-accent-foreground"
									: "text-muted hover:bg-surface-overlay"
							}`}
						>
							Unified
						</button>
					</div>
					<button
						type="button"
						onClick={() => setAllVisibleCollapsed(!areAllVisibleFilesCollapsed)}
						disabled={visibleFileKeys.length === 0}
						className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-overlay disabled:opacity-50 disabled:pointer-events-none"
						title={areAllVisibleFilesCollapsed ? "Expand all" : "Collapse all"}
						aria-label={
							areAllVisibleFilesCollapsed ? "Expand all" : "Collapse all"
						}
					>
						{areAllVisibleFilesCollapsed ? (
							<ChevronsUpDown className="h-3.5 w-3.5" />
						) : (
							<ChevronsDownUp className="h-3.5 w-3.5" />
						)}
					</button>
					<button
						type="button"
						onClick={() => void loadDiff({ force: true })}
						disabled={loading}
						className="inline-flex items-center rounded-md border border-border bg-surface p-1.5 text-xs font-medium text-muted hover:bg-surface-overlay disabled:opacity-50 disabled:pointer-events-none"
						title="Refresh"
						aria-label="Refresh"
					>
						<RefreshCw
							className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
						/>
					</button>
				</div>
			</div>

			<div className="grid flex-1 min-h-0 grid-cols-1 md:grid-cols-[250px_minmax(0,1fr)]">
				<aside className="min-h-0 bg-surface-raised/40">
					<div className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
						Changed Files
					</div>
					<div className="relative mx-2 mb-1">
						<Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
						<input
							type="text"
							value={fileFilter}
							onChange={(e) => setFileFilter(e.target.value)}
							placeholder="Filter files…"
							className="w-full rounded-md border border-border bg-surface py-1 pl-6 pr-2 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
						/>
					</div>
					<div className="max-h-40 overflow-auto p-2 pt-1 md:max-h-none md:h-[calc(100%-4.375rem)]">
						<button
							type="button"
							onClick={() => setSelectedFileKey(ALL_FILES_KEY)}
							className={`mb-1 w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
								selectedFileKey === ALL_FILES_KEY
									? "bg-accent text-accent-foreground"
									: "text-muted hover:bg-surface-overlay"
							}`}
						>
							All files ({filesWithKeys.length})
						</button>

						{filteredFilesWithKeys.map(({ file, key }) => (
							<button
								key={key}
								type="button"
								onClick={() => setSelectedFileKey(key)}
								className={`mb-1 w-full rounded-md border px-2 py-1.5 text-left transition-colors ${
									selectedFileKey === key
										? "border-accent bg-accent/10"
										: "border-transparent hover:border-border hover:bg-surface-overlay/70"
								}`}
							>
								<p className="font-mono text-[11px] leading-4 whitespace-normal break-all">
									{file.path}
								</p>
								<div className="mt-1 flex items-center justify-between text-[10px]">
									<span className="uppercase tracking-[0.06em] text-muted">
										{file.status}
									</span>
									<span className="font-mono">
										<span className="text-green-700 dark:text-green-400">
											+{file.additions}
										</span>{" "}
										<span className="text-red-700 dark:text-red-400">
											-{file.deletions}
										</span>
									</span>
								</div>
							</button>
						))}

						{filesWithKeys.length === 0 && (
							<div className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-muted">
								No changed files.
							</div>
						)}
					</div>
				</aside>

				<div className="min-h-0 overflow-auto p-3">
					{loading && filesWithKeys.length === 0 && (
						<div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-muted">
							Loading current diff...
						</div>
					)}

					{!loading && error && (
						<div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-muted">
							{error}
						</div>
					)}

					{!loading && !error && filesWithKeys.length === 0 && (
						<div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-muted">
							No local changes.
						</div>
					)}

					{!error &&
						visibleFiles.map(({ file, key }) => {
							const fileCollapsed = Boolean(collapsedFileKeys[key]);
							const unifiedState = unifiedContentByPath[file.path];
							const unifiedLines =
								viewMode === "unified" && typeof unifiedState === "string"
									? getUnifiedLinesForFile(file, key, unifiedState)
									: [];

							return (
								<section
									key={key}
									className="mb-3 overflow-hidden rounded-lg border border-border bg-surface [content-visibility:auto] [contain-intrinsic-size:720px]"
								>
									<header className="flex items-center justify-between gap-3 border-b border-border bg-surface-raised px-3 py-2">
										<div className="min-w-0 flex items-center gap-2">
											<button
												type="button"
												onClick={() => toggleFileCollapsed(key)}
												className="inline-flex shrink-0 items-center rounded border border-border px-1.5 py-1 text-[11px] text-muted hover:bg-surface-overlay"
												title={
													fileCollapsed
														? "Expand file diff"
														: "Collapse file diff"
												}
											>
												{fileCollapsed ? (
													<ChevronRight className="h-3.5 w-3.5" />
												) : (
													<ChevronDown className="h-3.5 w-3.5" />
												)}
											</button>
											<div className="min-w-0">
												<p className="truncate font-mono text-xs">
													{file.path}
												</p>
												{file.status === "renamed" &&
													file.oldPath &&
													file.oldPath !== file.path && (
														<p className="truncate text-[11px] text-muted">
															from {file.oldPath}
														</p>
													)}
											</div>
										</div>
										<div className="flex shrink-0 items-center gap-2 font-mono text-xs">
											<span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted">
												{file.status}
											</span>
											<span className="text-green-700 dark:text-green-400">
												+{file.additions}
											</span>
											<span className="text-red-700 dark:text-red-400">
												-{file.deletions}
											</span>
										</div>
									</header>

									{!fileCollapsed && (
										<div className="overflow-x-auto">
											{viewMode === "split" &&
												renderSplitHunks({
													file,
													fileKey: key,
													collapsedHunkKeys,
													onToggleHunk: toggleHunkCollapsed,
												})}

											{viewMode === "unified" && file.status === "deleted" && (
												<>
													<div className="border-b border-border px-3 py-2 text-xs text-muted">
														Deleted file. Showing patch sections.
													</div>
													{renderSplitHunks({
														file,
														fileKey: key,
														collapsedHunkKeys,
														onToggleHunk: toggleHunkCollapsed,
													})}
												</>
											)}

											{viewMode === "unified" && file.status !== "deleted" && (
												<>
													{(unifiedState === undefined ||
														unifiedState === UNIFIED_LOADING) && (
														<div className="px-3 py-2 text-xs text-muted">
															Loading file content...
														</div>
													)}
													{unifiedState === null && (
														<div className="px-3 py-2 text-xs text-muted">
															Unable to render unified view for this file.
														</div>
													)}
													{typeof unifiedState === "string" && (
														<UnifiedVirtualizedLines
															lines={unifiedLines}
															rowKeyPrefix={key}
														/>
													)}
												</>
											)}
										</div>
									)}
								</section>
							);
						})}
				</div>
			</div>
		</div>
	);
}
