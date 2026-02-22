export function isEmojiShortcode(value: string): boolean {
	return /^:[a-z0-9_+-]{1,64}:$/i.test(value.trim());
}
