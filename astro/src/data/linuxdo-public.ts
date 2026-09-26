/**
 * LinuxDo invite UI talks to the off-box API (build2), not the site VPS.
 * Override with PUBLIC_LINUXDO_API_ORIGIN when needed.
 */
export const linuxdoPublic = {
  apiOrigin: (import.meta.env.PUBLIC_LINUXDO_API_ORIGIN || "https://build2.fei.cx").replace(/\/$/, ""),
  challengePath: "/linuxdo/challenge",
  claimPath: "/linuxdo/claim",
} as const;
