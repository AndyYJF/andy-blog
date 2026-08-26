/**
 * Semantic two-tone category colors.
 *  - "accent" (amber, existing --accent): DN42 / 网络 / 运维类
 *  - "cyan": AI / 开源项目 / Astro 类
 * Unknown categories return null and keep the default muted style.
 */
const NETWORK_SLUGS = new Set([
  "dn42",
  "mnt",
  "refine",
  "cyber_safety",
  "cyber-safety",
  "nas",
]);
const PROJECT_SLUGS = new Set(["ai", "opensource", "astro"]);

export type CategoryTone = "accent" | "cyan";

export function categoryTone(slug?: string): CategoryTone | null {
  if (!slug) return null;
  const key = slug.trim().toLowerCase();
  if (NETWORK_SLUGS.has(key)) return "accent";
  if (PROJECT_SLUGS.has(key)) return "cyan";
  return null;
}
