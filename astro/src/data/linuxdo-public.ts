/**
 * Public Turnstile site key only (safe to commit). Secret stays on the VPS.
 * Override with PUBLIC_TURNSTILE_SITE_KEY when needed.
 */
export const linuxdoPublic = {
  turnstileSiteKey: (import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAAFEH_jB_09a640-l").trim(),
  claimPath: "/linuxdo/claim",
} as const;
