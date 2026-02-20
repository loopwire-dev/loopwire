const MASK_FLAG = ";lw-mask=none";
const MASK_FLAG_REGEX = /;lw-mask=(none|theme)/gi;

function splitDataUrl(url: string): { header: string; body: string } | null {
	const commaIndex = url.indexOf(",");
	if (commaIndex === -1) return null;
	return {
		header: url.slice(0, commaIndex),
		body: url.slice(commaIndex + 1),
	};
}

export function isDataImageUrl(value: string | null | undefined): value is string {
	return typeof value === "string" && /^data:image\//i.test(value);
}

export function isThemeMaskDisabled(icon: string | null | undefined): boolean {
	if (!isDataImageUrl(icon)) return false;
	const parts = splitDataUrl(icon);
	if (!parts) return false;
	return /;lw-mask=none(?:;|$)/i.test(parts.header);
}

export function stripMaskMetadata(icon: string): string {
	if (!isDataImageUrl(icon)) return icon;
	const parts = splitDataUrl(icon);
	if (!parts) return icon;
	const cleanedHeader = parts.header.replace(MASK_FLAG_REGEX, "");
	return `${cleanedHeader},${parts.body}`;
}

export function withThemeMask(icon: string, enabled: boolean): string {
	if (!isDataImageUrl(icon)) return icon;
	const parts = splitDataUrl(icon);
	if (!parts) return icon;
	const cleanedHeader = parts.header.replace(MASK_FLAG_REGEX, "");
	if (enabled) {
		return `${cleanedHeader},${parts.body}`;
	}
	const base64Index = cleanedHeader.indexOf(";base64");
	if (base64Index !== -1) {
		return `${cleanedHeader.slice(0, base64Index)}${MASK_FLAG}${cleanedHeader.slice(base64Index)},${parts.body}`;
	}
	return `${cleanedHeader}${MASK_FLAG},${parts.body}`;
}
