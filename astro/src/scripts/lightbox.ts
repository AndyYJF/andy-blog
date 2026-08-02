const DURATION = 250;
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
const VIEWPORT_PADDING = 48;

type Dispose = () => void;

function prefersReducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function targetRect(source: HTMLImageElement): DOMRect {
  const natural = {
    width: source.naturalWidth || source.clientWidth,
    height: source.naturalHeight || source.clientHeight,
  };
  const maxWidth = innerWidth - VIEWPORT_PADDING * 2;
  const maxHeight = innerHeight - VIEWPORT_PADDING * 2;
  const scale = Math.min(maxWidth / natural.width, maxHeight / natural.height, 1);
  const width = natural.width * scale;
  const height = natural.height * scale;
  return new DOMRect((innerWidth - width) / 2, (innerHeight - height) / 2, width, height);
}

function flipTransform(from: DOMRect, to: DOMRect): string {
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const sx = to.width === 0 ? 1 : from.width / to.width;
  const sy = to.height === 0 ? 1 : from.height / to.height;
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

export function initLightbox(root: HTMLElement): Dispose {
  let closeActive: Dispose | null = null;

  const open = (source: HTMLImageElement) => {
    closeActive?.();

    const reduce = prefersReducedMotion();
    const backdrop = document.createElement("div");
    backdrop.className = "lightbox-backdrop";

    const clone = document.createElement("img");
    clone.className = "lightbox-image";
    clone.src = source.currentSrc || source.src;
    clone.alt = source.alt;
    clone.decoding = "sync";

    const to = targetRect(source);
    clone.style.left = `${to.left}px`;
    clone.style.top = `${to.top}px`;
    clone.style.width = `${to.width}px`;
    clone.style.height = `${to.height}px`;
    clone.style.transform = reduce ? "none" : flipTransform(source.getBoundingClientRect(), to);

    document.body.append(backdrop, clone);
    source.style.visibility = "hidden";

    requestAnimationFrame(() => {
      backdrop.setAttribute("data-open", "");
      if (reduce) return;
      clone.style.transition = `transform ${DURATION}ms ${EASE}`;
      clone.style.transform = "none";
    });

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      closeActive = null;
      removeListeners();
      backdrop.removeAttribute("data-open");

      const finish = () => {
        clone.remove();
        backdrop.remove();
        source.style.removeProperty("visibility");
      };

      if (reduce) {
        finish();
        return;
      }

      const current = clone.getBoundingClientRect();
      clone.style.left = `${current.left}px`;
      clone.style.top = `${current.top}px`;
      clone.style.transition = `transform ${DURATION}ms ${EASE}`;
      clone.style.transform = flipTransform(source.getBoundingClientRect(), current);
      setTimeout(finish, DURATION);
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    const removeListeners = () => {
      backdrop.removeEventListener("click", close);
      clone.removeEventListener("click", close);
      document.removeEventListener("keydown", onKeydown);
      removeEventListener("scroll", close);
      removeEventListener("resize", close);
    };

    backdrop.addEventListener("click", close);
    clone.addEventListener("click", close);
    document.addEventListener("keydown", onKeydown);
    addEventListener("scroll", close, { passive: true });
    addEventListener("resize", close);

    closeActive = close;
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    if (target.closest("a")) return;
    if (target.classList.contains("beoe-light") || target.classList.contains("beoe-dark")) return;
    open(target);
  };

  root.addEventListener("click", onClick);

  return () => {
    root.removeEventListener("click", onClick);
    closeActive?.();
  };
}
