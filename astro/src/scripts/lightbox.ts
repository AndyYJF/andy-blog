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

  const openGallery = (sources: HTMLImageElement[], startIndex: number) => {
    closeActive?.();
    let index = Math.max(0, Math.min(startIndex, sources.length - 1));
    const reduce = prefersReducedMotion();

    const backdrop = document.createElement("div");
    backdrop.className = "lightbox-backdrop";
    const clone = document.createElement("img");
    clone.className = "lightbox-image";
    clone.decoding = "sync";

    const counter = document.createElement("div");
    counter.className = "lightbox-counter";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "lightbox-close";
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.textContent = "×";
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "lightbox-nav lightbox-prev";
    prevBtn.setAttribute("aria-label", "上一张");
    prevBtn.textContent = "‹";
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "lightbox-nav lightbox-next";
    nextBtn.setAttribute("aria-label", "下一张");
    nextBtn.textContent = "›";

    const show = (nextIndex: number, animateFrom?: HTMLImageElement) => {
      index = (nextIndex + sources.length) % sources.length;
      const source = sources[index];
      sources.forEach((img) => img.style.removeProperty("visibility"));
      source.style.visibility = "hidden";
      clone.src = source.currentSrc || source.src;
      clone.alt = source.alt;
      const to = targetRect(source);
      clone.style.left = `${to.left}px`;
      clone.style.top = `${to.top}px`;
      clone.style.width = `${to.width}px`;
      clone.style.height = `${to.height}px`;
      if (animateFrom && !reduce) {
        clone.style.transition = "none";
        clone.style.transform = flipTransform(animateFrom.getBoundingClientRect(), to);
        requestAnimationFrame(() => {
          clone.style.transition = `transform ${DURATION}ms ${EASE}`;
          clone.style.transform = "none";
        });
      } else {
        clone.style.transform = "none";
      }
      counter.textContent = sources.length > 1 ? `${index + 1} / ${sources.length}` : "";
      prevBtn.hidden = sources.length <= 1;
      nextBtn.hidden = sources.length <= 1;
    };

    document.body.append(backdrop, clone, closeBtn);
    if (sources.length > 1) document.body.append(counter, prevBtn, nextBtn);
    requestAnimationFrame(() => {
      backdrop.setAttribute("data-open", "");
      closeBtn.focus();
    });
    show(index, sources[index]);

    let closed = false;
    const stopCloneClick = (event: MouseEvent) => event.stopPropagation();
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft" && sources.length > 1) show(index - 1);
      if (event.key === "ArrowRight" && sources.length > 1) show(index + 1);
    };
    const removeListeners = () => {
      backdrop.removeEventListener("click", close);
      clone.removeEventListener("click", stopCloneClick);
      document.removeEventListener("keydown", onKeydown);
      removeEventListener("scroll", close);
      removeEventListener("resize", close);
      closeBtn.onclick = null;
      prevBtn.onclick = null;
      nextBtn.onclick = null;
    };
    const close = () => {
      if (closed) return;
      closed = true;
      closeActive = null;
      removeListeners();
      backdrop.removeAttribute("data-open");
      const source = sources[index];
      const finish = () => {
        clone.remove();
        backdrop.remove();
        counter.remove();
        closeBtn.remove();
        prevBtn.remove();
        nextBtn.remove();
        sources.forEach((img) => img.style.removeProperty("visibility"));
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

    backdrop.addEventListener("click", close);
    clone.addEventListener("click", stopCloneClick);
    closeBtn.onclick = (event) => {
      event.stopPropagation();
      close();
    };
    prevBtn.onclick = (event) => {
      event.stopPropagation();
      show(index - 1);
    };
    nextBtn.onclick = (event) => {
      event.stopPropagation();
      show(index + 1);
    };
    document.addEventListener("keydown", onKeydown);
    addEventListener("scroll", close, { passive: true });
    addEventListener("resize", close);
    closeActive = close;
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const gallery = target.closest<HTMLElement>("[data-moment-gallery]");
    if (gallery) {
      event.preventDefault();
      const images = [...gallery.querySelectorAll<HTMLImageElement>("img")];
      if (images.length === 0) return;
      const thumb = target.closest<HTMLElement>("[data-gallery-index]");
      let start = 0;
      if (thumb?.dataset.galleryIndex != null) {
        start = Number(thumb.dataset.galleryIndex) || 0;
      } else {
        const hit = target instanceof HTMLImageElement ? target : target.closest("img");
        start = hit ? images.indexOf(hit) : 0;
      }
      openGallery(images, start < 0 ? 0 : start);
      return;
    }
    if (!(target instanceof HTMLImageElement)) return;
    if (target.closest("a")) return;
    openGallery([target], 0);
  };

  root.addEventListener("click", onClick);

  return () => {
    root.removeEventListener("click", onClick);
    closeActive?.();
  };
}
