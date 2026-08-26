(() => {
  const form = document.getElementById('login-form');
  const banner = document.getElementById('banner');
  const input = document.getElementById('password');

  function showError(text) {
    banner.hidden = !text;
    banner.textContent = text || '';
  }

  if (new URLSearchParams(location.search).get('e') === '1') {
    showError('密码错误');
  }

  if (!form || !input || !banner) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = input.value;
    if (!password) {
      showError('请输入密码');
      return;
    }
    try {
      const res = await fetch('/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        location.replace(location.pathname === '/history' ? '/history' : '/');
        return;
      }
      showError('密码错误');
    } catch {
      showError('无法连接');
    }
  });
})();
