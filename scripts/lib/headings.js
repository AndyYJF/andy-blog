/**
 * Typecho's Markdown parser accepts ATX headings without a space after the hashes
 * (`#写在前面`); CommonMark does not, so those lines would degrade to paragraphs.
 * Production renders them as headings, so normalise them at sync time.
 *
 * Lines inside fenced code blocks are left alone — shell comments start with `#` too.
 */
const FENCE = /^(\s{0,3})(`{3,}|~{3,})/;
const TIGHT_HEADING = /^(#{1,6})([^#\s!].*)$/;

/**
 * @param {string} text
 * @returns {{ text: string, count: number }}
 */
export function normalizeHeadings(text) {
  const lines = text.split('\n');
  let fence = null;
  let count = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = FENCE.exec(line);

    if (fence) {
      if (fenceMatch && fenceMatch[2].startsWith(fence[0]) && fenceMatch[2].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[2];
      continue;
    }

    const heading = TIGHT_HEADING.exec(line);
    if (!heading) continue;
    lines[i] = `${heading[1]} ${heading[2].trim()}`;
    count += 1;
  }

  return { text: lines.join('\n'), count };
}
