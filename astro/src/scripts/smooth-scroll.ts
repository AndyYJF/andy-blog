import Lenis from "lenis";
import "lenis/dist/lenis.css";

type Dispose = () => void;

let lenis: Lenis | null = null;

const prefersReducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Touch / narrow viewports keep native scroll (pre-Lenis feel). */
const prefersNativeScroll = () =>
  matchMedia("(pointer: coarse), (hover: none), (max-width: 768px)").matches;

/** Extra offset beyond CSS scroll-margin (Lenis already applies scroll-margin). */
export const ANCHOR_OFFSET = 0;

/** Desktop programmatic / anchor duration (seconds). Keep short so it stays subtle. */
const SCROLL_DURATION = 0.45;

/**
 * Smooth scroll helper used by back-to-top / spine / TOC.
 * Falls back to native scroll when Lenis is off (mobile / reduced motion / teardown).
 */
export function scrollToTarget(
  target: number | string | HTMLElement,
  options: { immediate?: boolean; offset?: number } = {},
): void {
  const immediate = options.immediate ?? prefersReducedMotion();
  const offset = options.offset ?? (typeof target === "number" ? 0 : ANCHOR_OFFSET);

  if (lenis) {
    lenis.scrollTo(target, {
      immediate,
      offset,
      duration: immediate ? undefined : SCROLL_DURATION,
    });
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
 * Desktop-only mild wheel inertia (Lenis).
 * Mobile / touch / narrow screens: no Lenis, native CSS smooth + scroll-margin.
 */
export function initSmoothScroll(): Dispose {
  lenis?.destroy();
  lenis = null;

  if (prefersReducedMotion() || prefersNativeScroll()) return () => {};

  const instance = new Lenis({
    autoRaf: true,
    smoothWheel: true,
    syncTouch: false,
    wheelMultiplier: 1,
    // Higher lerp = snappier follow, less floaty lag.
    lerp: 0.22,
    duration: SCROLL_DURATION,
    easing: (t) => 1 - Math.pow(1 - t, 2.5),
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

  // Capture so native hash jump never races Lenis / progress recompute (desktop only).
  document.addEventListener("click", onClick, true);

  return () => {
    document.removeEventListener("click", onClick, true);
    if (lenis === instance) lenis = null;
    instance.destroy();
  };
}
