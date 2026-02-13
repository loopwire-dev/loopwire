import Editor from "@monaco-editor/react";
import { X } from "lucide-react";
import { useTheme } from "next-themes";
import { useEditor } from "./useEditor";

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
  const { filePath, content, extension, close } = useEditor();
  const { resolvedTheme } = useTheme();

  if (!filePath || content === null) return null;

  const language = getMonacoLanguage(filePath, extension);
  const isDark = resolvedTheme === "dark";

  return (
    <div className="h-full flex flex-col">
      <div className="h-[26.5px] flex items-center justify-between px-3 border-b border-border bg-surface-raised text-sm">
        <span className="font-mono text-xs truncate">{filePath}</span>
        <button
          onClick={close}
          className="text-muted hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          aria-label="Close file"
        >
          <X aria-hidden="true" size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
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
          height="100%"
        />
      </div>
    </div>
  );
}
