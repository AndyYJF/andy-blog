import { initLightbox } from "./lightbox";
import { initReadingProgress } from "./reading-progress";

type Dispose = () => void;

export function initArticle(article: HTMLElement, rail: HTMLElement | null): Dispose {
  const disposers: Dispose[] = [initLightbox(article), initReadingProgress(article, rail)];
  return () => {
    while (disposers.length > 0) disposers.pop()?.();
  };
}
