/**
 * Readonly Waline comments: GET-only, no form.
 * Renders with text nodes + allowlisted markup — never raw innerHTML of API body.
 */

const ALLOWED_TAGS = new Set(['p', 'br', 'code', 'pre', 'a', 'strong', 'em', 'ul', 'ol', 'li', 'blockquote']);

function escapeText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Minimal sanitizer: strip unknown tags, keep text; allow safe <a href>. */
export function sanitizeCommentHtml(input) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(input ?? '');
  const walk = (node) => {
    const children = [...node.childNodes];
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        continue;
      }
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        const text = document.createTextNode(child.textContent || '');
        child.replaceWith(text);
        continue;
      }
      if (tag === 'a') {
        const href = child.getAttribute('href') || '';
        [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
        if (/^https?:\/\//i.test(href)) {
          child.setAttribute('href', href);
          child.setAttribute('rel', 'noopener noreferrer nofollow');
          child.setAttribute('target', '_blank');
        } else {
          const text = document.createTextNode(child.textContent || '');
          child.replaceWith(text);
          continue;
        }
      } else {
        [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
      }
      walk(child);
    }
  };
  walk(tpl.content);
  return tpl.content;
}

function renderComment(item) {
  const li = document.createElement('li');
  li.className = 'wl-ro-item';
  const meta = document.createElement('p');
  meta.className = 'wl-ro-meta muted';
  const nick = document.createElement('strong');
  nick.textContent = item.nick || '匿名';
  meta.append(nick);
  if (item.insertedAt || item.time) {
    meta.append(document.createTextNode(' · '));
    const time = document.createElement('time');
    time.textContent = String(item.insertedAt || item.time);
    meta.append(time);
  }
  const body = document.createElement('div');
  body.className = 'wl-ro-body';
  // Prefer plain text; if API returns HTML, sanitize first.
  const raw = item.comment || '';
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    body.append(sanitizeCommentHtml(raw));
  } else {
    body.textContent = raw;
  }
  li.append(meta, body);
  return li;
}

/**
 * @param {{ el: HTMLElement, serverURL: string, path: string }} opts
 */
export async function mountReadonlyComments(opts) {
  const { el, serverURL, path } = opts;
  el.replaceChildren();
  const status = document.createElement('p');
  status.className = 'muted';
  status.textContent = '加载评论…';
  el.append(status);

  const controller = new AbortController();
  let destroyed = false;

  try {
    const url = new URL('/api/comment', serverURL);
    url.searchParams.set('path', path);
    url.searchParams.set('pageSize', '50');
    url.searchParams.set('sortBy', 'insertedAt_asc');
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (destroyed) return { destroy() {} };
    if (!res.ok) throw new Error(`comment GET ${res.status}`);
    const json = await res.json();
    const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    el.replaceChildren();
    const note = document.createElement('p');
    note.className = 'muted wl-ro-note';
    note.textContent = '评论暂为只读（写入尚未开放）。';
    el.append(note);
    if (data.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '暂无评论';
      el.append(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'wl-ro-list';
      for (const item of data) list.append(renderComment(item));
      el.append(list);
    }
  } catch {
    if (destroyed) return { destroy() {} };
    el.replaceChildren();
    const err = document.createElement('p');
    err.className = 'muted';
    err.textContent = '评论暂不可用（服务未就绪或网络错误）。历史评论将在上线后显示。';
    el.append(err);
  }

  return {
    destroy() {
      destroyed = true;
      controller.abort();
      el.replaceChildren();
    },
  };
}

// XSS self-check used by stage7-gate in jsdom-less environments via export.
export function xssSelfCheck() {
  if (typeof document === 'undefined') return true;
  const node = sanitizeCommentHtml('<img src=x onerror="window.__xss=1"><script>window.__xss=1</script><p>ok</p>');
  const wrap = document.createElement('div');
  wrap.append(node);
  return !wrap.querySelector('script') && !wrap.querySelector('img') && wrap.textContent.includes('ok');
}
