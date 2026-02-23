import Editor, { type OnMount } from "@monaco-editor/react";
import { Code, Eye, X } from "lucide-react";
import type * as Monaco from "monaco-editor";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAppStore } from "../../../shared/stores/app-store";
import { useEditor } from "../hooks/useEditor";
import { useGitGutter } from "../hooks/useGitGutter";

function getMonacoLanguage(filePath: string, ext: string): string {
	const normalizedExt = ext.toLowerCase();
	const lowerPath = filePath.toLowerCase();
	const fileName = lowerPath.split("/").pop() ?? "";

	switch (fileName) {
		case "dockerfile":
			return "dockerfile";
		case "makefile":
			return "makefile";
		case ".gitignore":
			return "plaintext";
		case ".env":
			return "shell";
		default:
			break;
	}

	switch (normalizedExt) {
		case "js":
		case "jsx":
			return "javascript";
		case "ts":
		case "tsx":
			return "typescript";
		case "json":
			return "json";
		case "jsonc":
			return "json";
		case "yml":
		case "yaml":
			return "yaml";
		case "xml":
			return "xml";
		case "svg":
			return "xml";
		case "py":
			return "python";
		case "rs":
			return "rust";
		case "go":
			return "go";
		case "java":
			return "java";
		case "kt":
		case "kts":
			return "kotlin";
		case "c":
			return "c";
		case "h":
			return "c";
		case "cc":
		case "cpp":
		case "cxx":
		case "hpp":
			return "cpp";
		case "cs":
			return "csharp";
		case "php":
			return "php";
		case "rb":
			return "ruby";
		case "swift":
			return "swift";
		case "lua":
			return "lua";
		case "css":
		case "scss":
			return "css";
		case "less":
			return "less";
		case "html":
		case "htm":
			return "html";
		case "vue":
			return "html";
		case "svelte":
			return "html";
		case "md":
		case "mdx":
			return "markdown";
		case "sh":
		case "bash":
		case "zsh":
			return "shell";
		case "sql":
			return "sql";
		case "graphql":
		case "gql":
			return "graphql";
		case "ini":
		case "cfg":
		case "conf":
			return "ini";
		case "toml":
			return "ini";
		default:
			return "plaintext";
	}
}

export function CodeEditor() {
	const { filePath, content, imageSrc, extension, close } = useEditor();
	const { resolvedTheme } = useTheme();
	const workspaceId = useAppStore((s) => s.workspaceId);
	const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
	const monacoRef = useRef<typeof Monaco | null>(null);
	const [previewMode, setPreviewMode] = useState(false);

	const isMarkdown = /^(md|mdx)$/i.test(extension);

	useEffect(() => {
		if (!filePath) return;
		setPreviewMode(false);
	}, [filePath]);

	const handleEditorMount: OnMount = useCallback((editor, monaco) => {
		editorRef.current = editor;
		monacoRef.current = monaco;
	}, []);

	const isDark = resolvedTheme === "dark";
	const gutterFilePath = imageSrc ? null : filePath;

	useGitGutter(workspaceId, gutterFilePath, editorRef, monacoRef, isDark);

	if (!filePath) return null;

	const language = getMonacoLanguage(filePath, extension);

	return (
		<div className="h-full flex flex-col">
			<div className="flex items-center justify-between border-b border-border bg-surface-raised px-4 py-3">
				<p className="text-sm font-mono">
					<span className="text-muted">
						{filePath.substring(0, filePath.lastIndexOf("/") + 1)}
					</span>
					<span className="font-semibold">{filePath.split("/").pop()}</span>
				</p>
				<div className="flex items-center gap-2">
					{isMarkdown && (
						<button
							type="button"
							onClick={() => setPreviewMode((p) => !p)}
							className="inline-flex items-center rounded-md border border-border bg-surface p-1.5 text-xs font-medium text-muted hover:bg-surface-overlay"
							aria-label={previewMode ? "Show source" : "Show preview"}
						>
							{previewMode ? (
								<Code aria-hidden="true" size={14} />
							) : (
								<Eye aria-hidden="true" size={14} />
							)}
						</button>
					)}
					<button
						type="button"
						onClick={close}
						className="inline-flex items-center rounded-md border border-border bg-surface p-1.5 text-xs font-medium text-muted hover:bg-surface-overlay"
						aria-label="Close file"
					>
						<X aria-hidden="true" size={14} />
					</button>
				</div>
			</div>
			<div className="flex-1 overflow-hidden">
				{imageSrc ? (
					<div className="h-full overflow-auto p-4 bg-surface">
						<div className="h-full flex items-center justify-center">
							<img
								src={imageSrc}
								alt={filePath.split("/").pop() ?? "Image preview"}
								className="max-w-full max-h-full object-contain rounded border border-border bg-surface-raised"
							/>
						</div>
					</div>
				) : previewMode && isMarkdown && content ? (
					<div
						className={`h-full overflow-auto p-6 ${isDark ? "bg-surface text-foreground" : "bg-white text-gray-900"}`}
					>
						<div className="max-w-3xl mx-auto [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:mt-6 [&_h1]:pb-2 [&_h1]:border-b [&_h1]:border-border [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:mb-3 [&_h2]:mt-5 [&_h2]:pb-1 [&_h2]:border-b [&_h2]:border-border [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h4]:text-lg [&_h4]:font-semibold [&_h4]:mb-2 [&_h4]:mt-3 [&_p]:mb-4 [&_p]:leading-7 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-4 [&_li]:mb-1 [&_li]:leading-7 [&_a]:text-blue-500 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted [&_blockquote]:mb-4 [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm [&_code]:bg-surface-raised [&_pre]:rounded-md [&_pre]:p-4 [&_pre]:mb-4 [&_pre]:overflow-x-auto [&_pre]:bg-surface-raised [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:w-full [&_table]:border-collapse [&_table]:mb-4 [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:bg-surface-raised [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_hr]:border-border [&_hr]:my-6 [&_img]:max-w-full [&_img]:rounded [&_del]:line-through [&_input[type=checkbox]]:mr-2">
							<ReactMarkdown remarkPlugins={[remarkGfm]}>
								{content}
							</ReactMarkdown>
						</div>
					</div>
				) : content === null ? null : (
					<Editor
						value={content}
						language={language}
						path={filePath}
						theme={isDark ? "vs-dark" : "light"}
						options={{
							readOnly: true,
							minimap: { enabled: false },
							scrollBeyondLastLine: false,
							automaticLayout: true,
							scrollbar: {
								verticalScrollbarSize: 8,
								horizontalScrollbarSize: 8,
							},
						}}
						onMount={handleEditorMount}
						height="100%"
					/>
				)}
			</div>
		</div>
	);
}
