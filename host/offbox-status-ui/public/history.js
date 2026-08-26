(() => {
  const STATUS_LABEL = {
    success: '成功',
    failed: '失败',
  };
  const banner = document.getElementById('banner');
  const list = document.getElementById('history');

  function showBanner(text) {
    banner.hidden = !text;
    banner.textContent = text || '';
  }

  function field(label, value) {
    const wrap = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value == null || value === '' ? '—' : String(value);
    wrap.append(dt, dd);
    return wrap;
  }

  function render(items) {
    list.replaceChildren();
    if (!Array.isArray(items) || items.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'history-empty';
      empty.textContent = '暂无构建历史';
      list.append(empty);
      return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'history-item';
      li.dataset.kind = item.status || 'failed';
      const head = document.createElement('p');
      head.className = 'history-status';
      head.dataset.kind = item.status || 'failed';
      head.textContent = STATUS_LABEL[item.status] || item.status || '—';
      const dl = document.createElement('dl');
      dl.append(
        field('完成', item.finishedAt),
        field('开始', item.startedAt),
        field('阶段', item.phase),
        field('发布 ID', item.releaseId),
        field('构建机', item.builder),
        field('重试', item.retryExhausted ? `${item.retryCount ?? 0}/${item.retryMax ?? 3} 已用尽` : `${item.retryCount ?? 0}/${item.retryMax ?? 3}`),
      );
      if (item.error) {
        const err = field('错误', item.error);
        err.className = 'wide';
        dl.append(err);
      }
      li.append(head, dl);
      list.append(li);
    }
  }

  async function poll() {
    try {
      const res = await fetch('/api/history', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (res.status === 401) {
        location.replace('/history');
        return;
      }
      if (!res.ok) {
        showBanner('历史读取失败');
        return;
      }
      showBanner('');
      const body = await res.json();
      render(body.items);
    } catch {
      showBanner('无法连接');
    }
  }

  poll();
  setInterval(poll, 3000);
})();
