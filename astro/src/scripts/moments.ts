type Dispose = () => void;

export function initMomentExpand(root: ParentNode = document): Dispose {
  const buttons: HTMLButtonElement[] = [];
  root.querySelectorAll<HTMLElement>("[data-moment-body].moment-body-clamp").forEach((body) => {
    const button = body.parentElement?.querySelector<HTMLButtonElement>("[data-moment-expand]");
    if (!button) return;
    const overflows = body.scrollHeight > body.clientHeight + 4;
    button.hidden = !overflows;
    if (!overflows) return;
    const onClick = () => {
      body.classList.remove("moment-body-clamp");
      button.hidden = true;
    };
    button.addEventListener("click", onClick);
    buttons.push(button);
    (button as HTMLButtonElement & { __momentExpand?: () => void }).__momentExpand = onClick;
  });

  return () => {
    for (const button of buttons) {
      const onClick = (button as HTMLButtonElement & { __momentExpand?: () => void }).__momentExpand;
      if (onClick) button.removeEventListener("click", onClick);
    }
  };
}

export function initCopyLinks(root: ParentNode = document): Dispose {
  const cleanups: Dispose[] = [];
  root.querySelectorAll<HTMLButtonElement>("[data-copy-link]").forEach((button) => {
    const onClick = async () => {
      const path = button.dataset.copyUrl || window.location.pathname;
      const url = new URL(path, window.location.origin).href;
      try {
        await navigator.clipboard.writeText(url);
        button.textContent = "已复制";
        setTimeout(() => {
          button.textContent = "复制链接";
        }, 1500);
      } catch {
        button.textContent = "复制失败";
      }
    };
    button.addEventListener("click", onClick);
    cleanups.push(() => button.removeEventListener("click", onClick));
  });
  return () => {
    for (const dispose of cleanups) dispose();
  };
}
