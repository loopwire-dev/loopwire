import {
	DEFAULT_FILE,
	getIconForFile,
	getIconForFolder,
	getIconForOpenFolder,
} from "vscode-icons-js";

const ICON_BASE_URL =
	"https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons/icons";

export function getFileIconSrc(fileName: string): string {
	const iconName = getIconForFile(fileName) ?? DEFAULT_FILE;
	return `${ICON_BASE_URL}/${iconName}`;
}

export function getFolderIconSrc(
	folderName: string,
	expanded: boolean,
): string {
	const iconName = expanded
		? getIconForOpenFolder(folderName)
		: getIconForFolder(folderName);
	return `${ICON_BASE_URL}/${iconName}`;
}
