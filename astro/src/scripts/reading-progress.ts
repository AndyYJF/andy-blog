type Dispose = () => void;

const NOOP: Dispose = () => {};

export function initReadingProgress(article: HTMLElement, rail: HTMLElement | null): Dispose {
  if (!rail) return NOOP;

  const headings = Array.from(article.querySelectorAll<HTMLElement>("h2[id]"));
  if (headings.length < 2) return NOOP;

  const links = headings.map((heading) => {
    const link = document.createElement("a");
    link.href = `#${heading.id}`;
    const label = (heading.textContent ?? "").replace(/#$/, "").trim();
    link.title = label;
    link.setAttribute("aria-label", label);
    return link;
  });
  rail.replaceChildren(...links);
  rail.setAttribute("data-ready", "");

  let active = -1;
  const setActive = (index: number) => {
    if (index === active) return;
    links[active]?.removeAttribute("aria-current");
    links[index]?.setAttribute("aria-current", "true");
    active = index;
  };

  const recompute = () => {
    const anchorLine = innerHeight * 0.25;
    let next = 0;
    for (let i = 0; i < headings.length; i += 1) {
      if (headings[i].getBoundingClientRect().top <= anchorLine) next = i;
    }
    setActive(next);
  };

  const observer = new IntersectionObserver(recompute, {
    rootMargin: "-25% 0px -70% 0px",
    threshold: [0, 1],
  });
  for (const heading of headings) observer.observe(heading);
  recompute();

  return () => {
    observer.disconnect();
    rail.removeAttribute("data-ready");
    rail.replaceChildren();
  };
}
