/**
 * LinuxDo invite UI: Turnstile site key (public) + off-box API origin.
 * Secret stays only on the build2 invite env file.
 */
export const linuxdoPublic = {
  apiOrigin: (import.meta.env.PUBLIC_LINUXDO_API_ORIGIN || "https://build2.fei.cx").replace(/\/$/, ""),
  turnstileSiteKey: (import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAAFEH_jB_09a640-l").trim(),
  challengePath: "/linuxdo/challenge",
  claimPath: "/linuxdo/claim",
} as const;
