const DURATION = 250;
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
const VIEWPORT_PADDING = 48;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const DRAG_THRESHOLD_PX = 6;

type Dispose = () => void;

function prefersReducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function fitRect(naturalWidth: number, naturalHeight: number): DOMRect {
  const maxWidth = innerWidth - VIEWPORT_PADDING * 2;
  const bottomSpace = 128; // Keep the fitted image above the zoom toolbar.
  const maxHeight = Math.max(1, innerHeight - VIEWPORT_PADDING - bottomSpace);
  // Allow upscaling so small mermaid/images actually enlarge in the lightbox.
  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
  const width = Math.max(1, naturalWidth * scale);
  const height = Math.max(1, naturalHeight * scale);
  return new DOMRect((innerWidth - width) / 2, VIEWPORT_PADDING + (maxHeight - height) / 2, width, height);
}

function targetRect(source: HTMLImageElement): DOMRect {
  return fitRect(
    source.naturalWidth || source.clientWidth || 1,
    source.naturalHeight || source.clientHeight || 1,
  );
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
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement : sources[startIndex];
    let index = Math.max(0, Math.min(startIndex, sources.length - 1));
    const reduce = prefersReducedMotion();
    let zoom = MIN_ZOOM;
    let fit = new DOMRect(0, 0, 1, 1);
    let panX = 0;
    let panY = 0;
    let drag:
      | {
          pointerId: number;
          startX: number;
          startY: number;
          originPanX: number;
          originPanY: number;
          moved: boolean;
        }
      | null = null;
    let suppressClick = false;

    const backdrop = document.createElement("div");
    backdrop.className = "lightbox-backdrop";
    const dialog = document.createElement("div");
    dialog.className = "lightbox-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "图片查看器");
    const clone = document.createElement("img");
    clone.className = "lightbox-image";
    clone.decoding = "sync";
    clone.draggable = false;

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

    const tools = document.createElement("div");
    tools.className = "lightbox-tools";
    const controls = document.createElement("div");
    const zoomOut = document.createElement("button");
    const zoomIn = document.createElement("button");
    const reset = document.createElement("button");
    for (const button of [zoomOut, zoomIn, reset]) button.type = "button";
    zoomOut.textContent = "−";
    zoomOut.setAttribute("aria-label", "缩小图片");
    zoomIn.textContent = "+";
    zoomIn.setAttribute("aria-label", "放大图片");
    reset.textContent = "适应窗口";
    const hint = document.createElement("span");
    hint.textContent = "点击图片切换缩放 · 放大后可拖动";
    controls.append(zoomOut, zoomIn, reset);
    tools.append(controls, hint);
    const syncControls = () => {
      zoomOut.disabled = zoom <= MIN_ZOOM;
      zoomIn.disabled = zoom >= MAX_ZOOM;
    };

    const cursorForZoom = () => {
      if (zoom <= MIN_ZOOM) return "zoom-in";
      return drag ? "grabbing" : "grab";
    };

    const applyView = ({ animate = false } = {}) => {
      syncControls();
      const width = fit.width * zoom;
      const height = fit.height * zoom;
      const left = (innerWidth - width) / 2 + panX;
      const top = fit.top + (fit.height - height) / 2 + panY;
      if (!animate) clone.style.transition = "none";
      clone.style.left = `${left}px`;
      clone.style.top = `${top}px`;
      clone.style.width = `${width}px`;
      clone.style.height = `${height}px`;
      clone.style.transform = "none";
      clone.style.cursor = cursorForZoom();
      if (animate && !reduce) {
        void clone.offsetWidth;
        clone.style.transition = `left ${DURATION}ms ${EASE}, top ${DURATION}ms ${EASE}, width ${DURATION}ms ${EASE}, height ${DURATION}ms ${EASE}`;
      }
    };

    const clampPan = () => {
      const width = fit.width * zoom;
      const height = fit.height * zoom;
      const maxPanX = Math.max(0, (width - innerWidth) / 2 + VIEWPORT_PADDING);
      const maxPanY = Math.max(0, (height - innerHeight) / 2 + VIEWPORT_PADDING);
      panX = Math.min(maxPanX, Math.max(-maxPanX, panX));
      panY = Math.min(maxPanY, Math.max(-maxPanY, panY));
    };

    const show = (nextIndex: number, animateFrom?: HTMLImageElement) => {
      index = (nextIndex + sources.length) % sources.length;
      const source = sources[index];
      sources.forEach((img) => img.style.removeProperty("visibility"));
      source.style.visibility = "hidden";
      clone.src = source.currentSrc || source.src;
      clone.alt = source.alt;
      zoom = MIN_ZOOM;
      panX = 0;
      panY = 0;
      drag = null;
      fit = targetRect(source);
      const to = fit;
      if (animateFrom && !reduce) {
        clone.style.transition = "none";
        clone.style.left = `${to.left}px`;
        clone.style.top = `${to.top}px`;
        clone.style.width = `${to.width}px`;
        clone.style.height = `${to.height}px`;
        clone.style.transform = flipTransform(animateFrom.getBoundingClientRect(), to);
        clone.style.cursor = "zoom-in";
        requestAnimationFrame(() => {
          if (closed) return;
          clone.style.transition = `transform ${DURATION}ms ${EASE}`;
          clone.style.transform = "none";
        });
      } else {
        applyView();
      }
      counter.textContent = sources.length > 1 ? `${index + 1} / ${sources.length}` : "";
      prevBtn.hidden = sources.length <= 1;
      nextBtn.hidden = sources.length <= 1;
      syncControls();
    };

    const background = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !element.inert);
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    background.forEach((element) => { element.inert = true; });
    dialog.append(backdrop, clone, closeBtn, tools);
    if (sources.length > 1) dialog.append(counter, prevBtn, nextBtn);
    document.body.append(dialog);
    requestAnimationFrame(() => {
      if (closed) return;
      backdrop.setAttribute("data-open", "");
      closeBtn.focus();
    });
    show(index, sources[index]);

    let closed = false;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const buttons = [closeBtn, zoomOut, zoomIn, reset, prevBtn, nextBtn]
          .filter((button) => button.isConnected && !button.disabled && !button.hidden);
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        event.preventDefault();
        buttons[next].focus();
      }
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "ArrowLeft" && sources.length > 1) { event.preventDefault(); show(index - 1); }
      if (event.key === "ArrowRight" && sources.length > 1) { event.preventDefault(); show(index + 1); }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
      if (next === zoom) return;
      zoom = next;
      if (zoom === MIN_ZOOM) {
        panX = 0;
        panY = 0;
      } else {
        clampPan();
      }
      applyView();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (zoom <= MIN_ZOOM) return;
      event.preventDefault();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originPanX: panX,
        originPanY: panY,
        moved: false,
      };
      clone.setPointerCapture(event.pointerId);
      clone.style.cursor = "grabbing";
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        drag.moved = true;
      }
      panX = drag.originPanX + dx;
      panY = drag.originPanY + dy;
      clampPan();
      applyView();
    };
    const endDrag = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const wasDrag = drag.moved;
      try {
        clone.releasePointerCapture(event.pointerId);
      } catch {
        // pointer may already be released
      }
      drag = null;
      clone.style.cursor = cursorForZoom();
      if (wasDrag) {
        // Swallow the click that browsers fire after a drag.
        suppressClick = true;
      }
    };
    const onCloneClick = (event: MouseEvent) => {
      event.stopPropagation();
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (zoom > MIN_ZOOM) {
        zoom = MIN_ZOOM;
        panX = 0;
        panY = 0;
        applyView();
        return;
      }
      zoom = Math.min(MAX_ZOOM, 2);
      clampPan();
      applyView({ animate: true });
    };
    const closeEvent = () => close();
    const onResize = () => {
      fit = targetRect(sources[index]);
      clampPan();
      applyView();
    };
    const removeListeners = () => {
      backdrop.removeEventListener("click", closeEvent);
      clone.removeEventListener("click", onCloneClick);
      clone.removeEventListener("wheel", onWheel);
      clone.removeEventListener("pointerdown", onPointerDown);
      clone.removeEventListener("pointermove", onPointerMove);
      clone.removeEventListener("pointerup", endDrag);
      clone.removeEventListener("pointercancel", endDrag);
      document.removeEventListener("keydown", onKeydown);
      removeEventListener("resize", onResize);
      closeBtn.onclick = null;
      prevBtn.onclick = null;
      nextBtn.onclick = null;
      zoomOut.onclick = null;
      zoomIn.onclick = null;
      reset.onclick = null;
    };
    const close = (immediate = false) => {
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
        tools.remove();
        dialog.remove();
        sources.forEach((img) => img.style.removeProperty("visibility"));
        background.forEach((element) => { element.inert = false; });
        document.documentElement.style.overflow = previousOverflow;
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      };
      if (reduce || immediate) {
        finish();
        return;
      }
      const current = clone.getBoundingClientRect();
      clone.style.left = `${current.left}px`;
      clone.style.top = `${current.top}px`;
      clone.style.width = `${current.width}px`;
      clone.style.height = `${current.height}px`;
      clone.style.transition = `transform ${DURATION}ms ${EASE}`;
      clone.style.transform = flipTransform(source.getBoundingClientRect(), current);
      setTimeout(finish, DURATION);
    };

    backdrop.addEventListener("click", closeEvent);
    clone.addEventListener("click", onCloneClick);
    clone.addEventListener("wheel", onWheel, { passive: false });
    clone.addEventListener("pointerdown", onPointerDown);
    clone.addEventListener("pointermove", onPointerMove);
    clone.addEventListener("pointerup", endDrag);
    clone.addEventListener("pointercancel", endDrag);
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
    const changeZoom = (next: number) => {
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      clampPan();
      applyView();
    };
    zoomOut.onclick = () => changeZoom(zoom / 1.5);
    zoomIn.onclick = () => changeZoom(zoom * 1.5);
    reset.onclick = () => {
      panX = 0;
      panY = 0;
      changeZoom(MIN_ZOOM);
    };
    document.addEventListener("keydown", onKeydown);
    addEventListener("resize", onResize);
    closeActive = () => close(true);
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

  const keyboardImages = Array.from(root.querySelectorAll<HTMLImageElement>("img"))
    .filter((image) => !image.closest("a, button, [data-moment-gallery]") && !image.hasAttribute("tabindex"));
  keyboardImages.forEach((image) => { image.tabIndex = 0; });
  const onImageKeydown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLImageElement && keyboardImages.includes(event.target)
      && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openGallery([event.target], 0);
    }
  };
  root.addEventListener("keydown", onImageKeydown);

  const hints = Array.from(root.querySelectorAll<HTMLElement>(".beoe")).map((figure) => {
    const hint = document.createElement("span");
    hint.className = "image-view-hint";
    hint.textContent = "点击图表查看大图，可继续放大与拖动";
    figure.after(hint);
    return hint;
  });

  return () => {
    hints.forEach((hint) => hint.remove());
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onImageKeydown);
    keyboardImages.forEach((image) => image.removeAttribute("tabindex"));
    closeActive?.();
  };
}
