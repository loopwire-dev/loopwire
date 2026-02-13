import { useAppStore } from "../../shared/stores/app-store";

export function useEditor() {
  const openFilePath = useAppStore((s) => s.openFilePath);
  const openFileContent = useAppStore((s) => s.openFileContent);
  const clearOpenFile = useAppStore((s) => s.clearOpenFile);

  const extension = openFilePath?.split(".").pop() ?? "";

  return {
    filePath: openFilePath,
    content: openFileContent,
    extension,
    close: clearOpenFile,
  };
}
