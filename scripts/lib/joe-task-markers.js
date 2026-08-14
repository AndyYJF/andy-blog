/**
 * Joe theme compatibility: a source line beginning with `{x}` is a checked
 * task and `{ }` is an unchecked task. Normalize only whole lines outside
 * fenced code blocks so prose,
 * inline code, and examples are not rewritten accidentally.
 */
export function normalizeJoeTaskMarkers(input, { sourceFormat = 'markdown' } = {}) {
  const source = String(input);
  if (sourceFormat !== 'markdown') {
    return { text: source, count: 0 };
  }

  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/u);
  let fence = null;
  let htmlBlock = null;
  let count = 0;

  const text = lines.map((line) => {
    if (htmlBlock) {
      if (new RegExp(`</${htmlBlock}\\s*>`, 'iu').test(line)) htmlBlock = null;
      return line;
    }

    const htmlOpening = line.match(/^ {0,3}<(pre|code|script|style|textarea)(?:\s|>)/iu)?.[1];
    if (htmlOpening) {
      if (!new RegExp(`</${htmlOpening}\\s*>`, 'iu').test(line)) htmlBlock = htmlOpening;
      return line;
    }

    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/u)?.[1];
      if (closing && closing[0] === fence.char && closing.length >= fence.length) {
        fence = null;
      }
      return line;
    }

    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
    if (opening) {
      fence = { char: opening[0], length: opening.length };
      return line;
    }

    const task = line.match(/^( {0,3})(?:(?:[-+*])\s+)?\{([xX ])\}[\t ]+(\S(?:.*\S)?)\s*$/u);
    if (!task) return line;
    count += 1;
    const state = task[2] === ' ' ? ' ' : 'x';
    return `${task[1]}- [${state}] ${task[3]}`;
  }).join(newline);

  return { text, count };
}
