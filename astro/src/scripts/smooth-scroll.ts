import Lenis from "lenis";
import "lenis/dist/lenis.css";

type Dispose = () => void;

let lenis: Lenis | null = null;

const prefersReducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Extra offset beyond CSS scroll-margin (Lenis already applies scroll-margin). */
export const ANCHOR_OFFSET = 0;

/**
 * Smooth scroll helper used by back-to-top / spine / TOC.
 * Falls back to native scroll when Lenis is off (reduced motion / teardown).
 */
export function scrollToTarget(
  target: number | string | HTMLElement,
  options: { immediate?: boolean; offset?: number } = {},
): void {
  const immediate = options.immediate ?? prefersReducedMotion();
  const offset = options.offset ?? (typeof target === "number" ? 0 : ANCHOR_OFFSET);

  if (lenis) {
    lenis.scrollTo(target, { immediate, offset, duration: immediate ? undefined : 0.7 });
    return;
  }

  if (typeof target === "number") {
    window.scrollTo({ top: target, behavior: immediate ? "auto" : "smooth" });
    return;
  }

  const el =
    typeof target === "string"
      ? document.querySelector<HTMLElement>(
          target.startsWith("#") ? target : `#${CSS.escape(target)}`,
        )
      : target;
  if (!el) return;
  // Native path: scroll-margin-top on headings clears the sticky header.
  el.scrollIntoView({ behavior: immediate ? "auto" : "smooth", block: "start" });
}

function samePageHashLink(anchor: HTMLAnchorElement): string | null {
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  let url: URL;
  try {
    url = new URL(anchor.href, location.href);
  } catch {
    return null;
  }
  if (url.origin !== location.origin) return null;
  if (url.pathname !== location.pathname) return null;
  if (!url.hash || url.hash === "#") return null;
  return decodeURIComponent(url.hash);
}

/**
 * Full-page inertia (Lenis) + anchor smoothing.
 * Custom hash clicks (not Lenis anchors) so we can preventDefault and avoid
 * native jump fighting the smooth scroll / progress probe.
 */
export function initSmoothScroll(): Dispose {
  lenis?.destroy();
  lenis = null;

  if (prefersReducedMotion()) return () => {};

  const coarse = matchMedia("(pointer: coarse)").matches;

  const instance = new Lenis({
    autoRaf: true,
    // Mild inertia: higher lerp = quicker catch-up, less float.
    smoothWheel: true,
    syncTouch: coarse,
    syncTouchLerp: 0.12,
    touchMultiplier: 1.1,
    wheelMultiplier: 1,
    lerp: 0.16,
    duration: 0.7,
    easing: (t) => 1 - Math.pow(1 - t, 3),
    anchors: false,
    stopInertiaOnNavigate: true,
    respectReducedMotion: true,
  });

  lenis = instance;

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const hash = samePageHashLink(anchor);
    if (!hash) return;

    const target = document.getElementById(hash.slice(1));
    if (!target) return;

    event.preventDefault();
    scrollToTarget(target);
    if (location.hash !== hash) {
      history.pushState(null, "", hash);
    }
  };

  // Capture so native hash jump never races Lenis / progress recompute.
  document.addEventListener("click", onClick, true);

  return () => {
    document.removeEventListener("click", onClick, true);
    if (lenis === instance) lenis = null;
    instance.destroy();
  };
}
