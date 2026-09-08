(() => {
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));

  const routeIdRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const href = String(window.location.pathname || '');
  if (!/write-post/.test(href) && !document.querySelector('form[name="write_post"]')) return;
  if (document.querySelector('form[name="write_page"]')) return;

  const normalize = (raw) => {
    const compact = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/_/g, '-')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (!compact || !routeIdRe.test(compact) || /^\d+$/.test(compact)) return null;
    return compact;
  };

  const ensureField = () => {
    let input = document.querySelector('#andy-astro-path, input[name="fields[astroPath]"]');
    if (input) return input;

    const side = document.querySelector('#edit-secondary')
      || document.querySelector('.typecho-page-main .typecho-post-option')?.parentElement
      || document.querySelector('form');
    if (!side) return null;

    const section = document.createElement('section');
    section.className = 'typecho-post-option';
    section.id = 'andy-astro-path-option';
    section.innerHTML = [
      '<label for="andy-astro-path" class="typecho-label">公开路径（仅首次发布）</label>',
      '<p class="andy-astro-path-row">',
      '<span class="andy-astro-path-prefix">/posts/</span>',
      '<input type="text" id="andy-astro-path" name="fields[astroPath]" placeholder="pi-notes" spellcheck="false" autocomplete="off" />',
      '<span class="andy-astro-path-suffix">/</span>',
      '</p>',
      '<p class="description" id="andy-astro-path-help"></p>',
    ].join('');
    side.insertBefore(section, side.firstChild);
    return section.querySelector('#andy-astro-path');
  };

  const input = ensureField();
  if (!input) return;
  const help = document.querySelector('#andy-astro-path-help');

  const paint = () => {
    const manual = normalize(input.value);
    if (!help) return;
    if (manual) {
      help.innerHTML = `将生成 <code>/posts/${escapeHtml(manual)}/</code>。首次发布后锁定。`;
      return;
    }
    help.textContent = '小写英文和连字符。留空则按标题生成；中文标题会变成 item-文章ID。发布后改这里不会改线上地址。';
  };

  input.addEventListener('input', paint);
  paint();
})();
