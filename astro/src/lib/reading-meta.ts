/** Chinese technical reading speed used for the article header estimate. */
export const CHARACTERS_PER_MINUTE = 400;

/** Drop markup so the count follows what a reader actually sees. */
export function articlePlainText(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/```[\w-]*\n?([\s\S]*?)```/g, " $1 ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*([-+*]|\d+\.)\s+/gm, "")
    .replace(/[*_~|]/g, "");
}

export function countCharacters(source: string): number {
  return articlePlainText(source).replace(/\s/g, "").length;
}

export function readingMinutes(characters: number): number {
  if (characters <= 0) return 1;
  return Math.max(1, Math.ceil(characters / CHARACTERS_PER_MINUTE));
}

export function formatCount(characters: number): string {
  return String(characters).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Same calendar day as the existing UTC date shown in the header. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function showUpdatedDate(published: Date, updated: Date): boolean {
  return dayKey(updated) !== dayKey(published);
}
