/**
 * Map typo / informal fence languages to Expressive Code–friendly ids.
 * Applied at sync so fixture typos don't wipe on every rebuild.
 */
const FENCE_LANG_ALIASES = {
  commend: 'bash',
  cmd: 'bash',
  content: 'txt',
  context: 'txt',
  file: 'txt',
};

/**
 * @param {string} body
 * @returns {{ text: string, remaps: { from: string, to: string }[] }}
 */
export function remapFenceLangs(body) {
  const remaps = [];
  const text = body.replace(/^[ \t]*```([^\s`]+)/gm, (full, lang) => {
    const key = String(lang).trim().toLowerCase();
    const to = FENCE_LANG_ALIASES[key];
    if (!to) return full;
    remaps.push({ from: key, to });
    return full.replace(/```[^\s`]+/, `\`\`\`${to}`);
  });
  return { text, remaps };
}
