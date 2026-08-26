(() => {
  const root = document.getElementById('andy-rebuild-status');
  if (!root) return;

  const toggle = root.querySelector('.andy-rebuild-toggle');
  const panel = root.querySelector('.andy-rebuild-panel');
  const meta = root.querySelector('.andy-rebuild-meta');
  const steps = root.querySelector('.andy-rebuild-steps');
  const log = root.querySelector('.andy-rebuild-log');
  const url = root.getAttribute('data-url');
  const token = root.getAttribute('data-token');
  const labels = {
    idle: '空闲',
    queued: '排队中',
    running: '构建中',
    success: '已完成',
    failed: '失败',
  };

  const render = (data) => {
    const status = data && data.status ? data.status : 'idle';
    root.hidden = false;
    root.dataset.state = status;
    const phase = data.phase && data.phase !== 'idle' ? ` · ${data.phase}` : '';
    const builder = data.builder ? ` · ${data.builder}` : '';
    toggle.textContent = `构建 ${labels[status] || status}${phase}${builder}`;
    const release = data.releaseId || data.current || '—';
    meta.textContent = `release ${release}${data.dirty ? ' · 构建中又有新发布' : ''}`;
    steps.replaceChildren();
    (data.steps || []).forEach((step) => {
      const item = document.createElement('li');
      item.dataset.state = step.state || 'pending';
      item.textContent = `${step.label || step.id} (${step.state || 'pending'})`;
      steps.appendChild(item);
    });
    log.textContent = (data.tail || []).join('\n') || '暂无日志';
  };

  const poll = async () => {
    try {
      const body = new URLSearchParams();
      body.set('_', token);
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body,
      });
      if (!response.ok) throw new Error(String(response.status));
      render(await response.json());
    } catch (error) {
      root.hidden = false;
      root.dataset.state = 'failed';
      toggle.textContent = '构建 无法读取进度';
      meta.textContent = String(error && error.message ? error.message : error);
    }
  };

  toggle.addEventListener('click', () => {
    const open = panel.hasAttribute('hidden');
    if (open) panel.removeAttribute('hidden');
    else panel.setAttribute('hidden', '');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  poll();
  window.setInterval(poll, 3000);
})();
