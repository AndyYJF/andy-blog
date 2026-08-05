type Dispose = () => void;

const NOOP: Dispose = () => {};

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

  const railLinks = h2s.map((heading) => {
    const link = document.createElement("a");
    link.href = `#${heading.id}`;
    const label = headingLabel(heading);
    link.title = label;
    link.setAttribute("aria-label", label);
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
    toc.replaceChildren(...tocLinks);
    toc.setAttribute("data-ready", "");
  }

  let activeToc = -1;
  let activeRail = -1;

  const setActive = (tocIndex: number) => {
    if (tocIndex === activeToc) return;
    tocLinks[activeToc]?.removeAttribute("aria-current");
    tocLinks[tocIndex]?.setAttribute("aria-current", "true");
    activeToc = tocIndex;

    const railIndex = h2IndexByToc[tocIndex] ?? 0;
    if (railIndex !== activeRail) {
      railLinks[activeRail]?.removeAttribute("aria-current");
      railLinks[railIndex]?.setAttribute("aria-current", "true");
      activeRail = railIndex;
    }
  };

  const recompute = () => {
    const anchorLine = innerHeight * 0.25;
    let next = 0;
    for (let i = 0; i < tocHeadings.length; i += 1) {
      if (tocHeadings[i].getBoundingClientRect().top <= anchorLine) next = i;
    }
    setActive(next);
  };

  const observer = new IntersectionObserver(recompute, {
    rootMargin: "-25% 0px -70% 0px",
    threshold: [0, 1],
  });
  for (const heading of tocHeadings) observer.observe(heading);
  recompute();

  return () => {
    observer.disconnect();
    rail?.removeAttribute("data-ready");
    rail?.replaceChildren();
    toc?.removeAttribute("data-ready");
    toc?.replaceChildren();
  };
}
