type Dispose = () => void;

const NOOP: Dispose = () => {};

const RAIL_BASE_WIDTH = 18;
const RAIL_ACTIVE_WIDTH = 34;
const RAIL_NEAR_WIDTH = 54;
const RAIL_PROXIMITY_RADIUS = 68;

const headingLabel = (heading: HTMLElement) =>
  (heading.textContent ?? "").replace(/#$/, "").trim();

/** Index of the h2 that owns this heading (itself if h2; nearest preceding h2 if h3). */
const owningH2Index = (heading: HTMLElement, h2s: HTMLElement[]) => {
  if (heading.tagName === "H2") return h2s.indexOf(heading);
  let owner = 0;
  for (let i = 0; i < h2s.length; i += 1) {
    // DOCUMENT_POSITION_FOLLOWING on h2→heading means heading comes after h2.
    if (h2s[i].compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING) {
      owner = i;
    }
  }
  return owner;
};

export function initReadingProgress(
  article: HTMLElement,
  rail: HTMLElement | null,
  toc: HTMLElement | null = null,
): Dispose {
  const h2s = Array.from(article.querySelectorAll<HTMLElement>("h2[id]"));
  if (h2s.length < 2) return NOOP;

  const tocHeadings = Array.from(article.querySelectorAll<HTMLElement>("h2[id], h3[id]"));

  // Same heading source as the desktop TOC, with a native disclosure on narrow screens.
  const mobileToc = document.createElement("details");
  mobileToc.className = "mobile-toc";
  const summary = document.createElement("summary");
  summary.textContent = `本文目录 · ${tocHeadings.length} 节`;
  const mobileNav = document.createElement("nav");
  mobileNav.setAttribute("aria-label", "本文目录");
  const mobileLinks = tocHeadings.map((heading) => {
    const link = document.createElement("a");
    link.href = `#${heading.id}`;
    link.textContent = headingLabel(heading);
    if (heading.tagName === "H3") link.classList.add("is-h3");
    return link;
  });
  mobileNav.append(...mobileLinks);
  mobileToc.append(summary, mobileNav);
  const header = article.querySelector(".entry-header");
  if (header) header.after(mobileToc);
  else article.prepend(mobileToc);

  const railLinks = h2s.map((heading) => {
    const link = document.createElement("a");
    link.href = `#${heading.id}`;
    const label = headingLabel(heading);
    link.title = label;
    link.setAttribute("aria-label", label);
    link.dataset.label = label;
    return link;
  });

  const tocLinks =
    toc == null
      ? []
      : tocHeadings.map((heading) => {
          const link = document.createElement("a");
          link.href = `#${heading.id}`;
          const label = headingLabel(heading);
          link.textContent = label;
          link.title = label;
          if (heading.tagName === "H3") link.classList.add("is-h3");
          return link;
        });

  const h2IndexByToc = tocHeadings.map((heading) => owningH2Index(heading, h2s));

  if (rail) {
    rail.replaceChildren(...railLinks);
    rail.setAttribute("data-ready", "");
  }
  if (toc && tocLinks.length > 0) {
    const title = document.createElement("span");
    title.className = "article-toc-title";
    title.textContent = "文章目录";
    toc.replaceChildren(title, ...tocLinks);
    toc.setAttribute("data-ready", "");
  }

  let activeToc = -1;
  let activeRail = -1;
  let pointerY: number | null = null;
  /** Ignore scroll-driven recompute while a TOC/rail click is settling. */
  let lockUntil = 0;

  const updateRailProximity = () => {
    for (const link of railLinks) {
      if (pointerY == null) {
        link.style.removeProperty("--guide-width");
        continue;
      }

      const rect = link.getBoundingClientRect();
      const distance = Math.abs(pointerY - (rect.top + rect.height / 2));
      const proximity = Math.max(0, 1 - distance / RAIL_PROXIMITY_RADIUS);
      const eased = proximity * proximity * (3 - 2 * proximity);
      const base = link.getAttribute("aria-current") === "true"
        ? RAIL_ACTIVE_WIDTH
        : RAIL_BASE_WIDTH;
      const width = base + (RAIL_NEAR_WIDTH - base) * eased;
      link.style.setProperty("--guide-width", `${width.toFixed(1)}px`);
    }
  };

  const onRailPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    pointerY = event.clientY;
    updateRailProximity();
  };

  const onRailPointerLeave = () => {
    pointerY = null;
    updateRailProximity();
  };

  rail?.addEventListener("pointermove", onRailPointerMove);
  rail?.addEventListener("pointerleave", onRailPointerLeave);

  const setActive = (tocIndex: number) => {
    if (tocIndex === activeToc) return;
    tocLinks[activeToc]?.removeAttribute("aria-current");
    tocLinks[tocIndex]?.setAttribute("aria-current", "true");
    mobileLinks[activeToc]?.removeAttribute("aria-current");
    mobileLinks[tocIndex]?.setAttribute("aria-current", "true");
    activeToc = tocIndex;

    const railIndex = h2IndexByToc[tocIndex] ?? 0;
    if (railIndex !== activeRail) {
      railLinks[activeRail]?.removeAttribute("aria-current");
      railLinks[railIndex]?.setAttribute("aria-current", "true");
      activeRail = railIndex;
      updateRailProximity();
    }
  };

  const bindJump = (links: HTMLAnchorElement[], indexOf: (i: number) => number) => {
    const cleanups: Dispose[] = [];
    links.forEach((link, i) => {
      const onClick = () => {
        // Highlight the clicked section immediately; short sections would
        // otherwise lose to the next heading under the scroll probe.
        setActive(indexOf(i));
        lockUntil = performance.now() + 900;
      };
      link.addEventListener("click", onClick);
      cleanups.push(() => link.removeEventListener("click", onClick));
    });
    return () => {
      for (const dispose of cleanups) dispose();
    };
  };

  const unbindToc = bindJump(tocLinks, (i) => i);
  const unbindMobile = bindJump(mobileLinks, (i) => i);
  const unbindRail = bindJump(railLinks, (i) => {
    // Rail is h2-only: activate the first toc heading owned by that h2.
    const railIndex = i;
    const tocIndex = h2IndexByToc.findIndex((owner) => owner === railIndex);
    return tocIndex >= 0 ? tocIndex : 0;
  });

  const recompute = () => {
    if (performance.now() < lockUntil) return;

    // Just below sticky header / scroll-margin so short sections don't
    // steal highlight from the heading you jumped to.
    const anchorLine = Math.min(innerHeight * 0.12, 104);
    let next = 0;
    for (let i = 0; i < tocHeadings.length; i += 1) {
      if (tocHeadings[i].getBoundingClientRect().top <= anchorLine) next = i;
    }
    setActive(next);
  };

  let recomputeFrame = 0;
  const scheduleRecompute = () => {
    if (recomputeFrame !== 0) return;
    recomputeFrame = requestAnimationFrame(() => {
      recomputeFrame = 0;
      recompute();
    });
  };

  const observer = new IntersectionObserver(scheduleRecompute, {
    rootMargin: "-12% 0px -80% 0px",
    threshold: [0, 1],
  });
  for (const heading of tocHeadings) observer.observe(heading);
  addEventListener("scroll", scheduleRecompute, { passive: true });
  addEventListener("scrollend", scheduleRecompute);
  addEventListener("hashchange", scheduleRecompute);
  addEventListener("resize", scheduleRecompute);
  recompute();

  return () => {
    unbindToc();
    unbindMobile();
    unbindRail();
    mobileToc.remove();
    observer.disconnect();
    removeEventListener("scroll", scheduleRecompute);
    removeEventListener("scrollend", scheduleRecompute);
    removeEventListener("hashchange", scheduleRecompute);
    removeEventListener("resize", scheduleRecompute);
    if (recomputeFrame !== 0) cancelAnimationFrame(recomputeFrame);
    rail?.removeEventListener("pointermove", onRailPointerMove);
    rail?.removeEventListener("pointerleave", onRailPointerLeave);
    rail?.removeAttribute("data-ready");
    rail?.replaceChildren();
    toc?.removeAttribute("data-ready");
    toc?.replaceChildren();
  };
}
