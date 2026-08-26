(() => {
  const STATUS_LABEL = {
    idle: '空闲',
    queued: '排队',
    running: '构建中',
    success: '成功',
    failed: '失败',
  };
  const STATE_LABEL = {
    pending: '等待',
    running: '进行中',
    done: '完成',
    failed: '失败',
  };

  const banner = document.getElementById('banner');
  const stepsEl = document.getElementById('steps');
  const tailEl = document.getElementById('tail');
  const logFollow = document.getElementById('logFollow');
  let stickToBottom = true;

  function setFollowLabel() {
    if (!logFollow) return;
    logFollow.textContent = stickToBottom ? '跟随' : '已暂停';
    logFollow.dataset.paused = stickToBottom ? '0' : '1';
  }

  function nearBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  }

  function renderLogs(lines) {
    const next = lines.length ? lines.join('\n') : '暂无日志';
    const changed = tailEl.textContent !== next;
    if (changed) tailEl.textContent = next;
    if (stickToBottom) {
      tailEl.scrollTop = tailEl.scrollHeight;
    }
  }

  tailEl.addEventListener(
    'scroll',
    () => {
      stickToBottom = nearBottom(tailEl);
      setFollowLabel();
    },
    { passive: true },
  );

  if (logFollow) {
    logFollow.style.cursor = 'pointer';
    logFollow.addEventListener('click', () => {
      stickToBottom = true;
      setFollowLabel();
      tailEl.scrollTop = tailEl.scrollHeight;
    });
  }
  setFollowLabel();

  function setText(id, value, kind) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value == null || value === '' ? '—' : String(value);
    if (kind !== undefined) el.dataset.kind = kind;
    else delete el.dataset.kind;
  }

  function flagText(value) {
    return value ? '是' : '否';
  }

  function showBanner(text) {
    banner.hidden = !text;
    banner.textContent = text || '';
  }

  function renderSteps(steps) {
    stepsEl.replaceChildren();
    if (!Array.isArray(steps) || steps.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '暂无步骤';
      stepsEl.append(empty);
      return;
    }
    for (const step of steps) {
      const li = document.createElement('li');
      li.dataset.state = step.state || 'pending';
      const label = document.createElement('span');
      label.className = 'step-label';
      label.textContent = step.label || step.id || '—';
      const state = document.createElement('span');
      state.className = 'step-state';
      state.textContent = STATE_LABEL[step.state] || step.state || '—';
      li.append(label, state);
      stepsEl.append(li);
    }
  }

  function renderOutcome(outcome) {
    if (!outcome) {
      setText('lastOutcome', '—');
      return;
    }
    const label = outcome.status === 'success' ? '成功' : '失败';
    const bits = [
      label,
      outcome.finishedAt,
      outcome.releaseId,
      outcome.phase ? `阶段 ${outcome.phase}` : null,
    ].filter(Boolean);
    setText('lastOutcome', bits.join(' · ') || '—', outcome.status);
  }

  function renderFailure(failure) {
    if (!failure) {
      setText('lastFailure', '—');
      return;
    }
    const bits = [
      failure.failedAt,
      failure.phase ? `阶段 ${failure.phase}` : null,
      failure.rc == null ? null : `rc=${failure.rc}`,
    ].filter(Boolean);
    setText('lastFailure', bits.join(' · ') || '—');
  }

  function render(data) {
    showBanner('');
    const status = data.status || 'idle';
    setText('status', STATUS_LABEL[status] || status, status);
    setText('phase', data.phase);
    setText('builder', data.builder);
    setText('releaseId', data.releaseId);
    setText('current', data.current);
    setText('previous', data.previous);
    setText('startedAt', data.startedAt);
    setText('updatedAt', data.updatedAt);
    setText('queued', flagText(Boolean(data.queued)));
    setText('building', flagText(Boolean(data.building)));
    setText('dirty', flagText(Boolean(data.dirty)));
    setText('error', data.error);
    renderOutcome(data.lastOutcome);
    renderFailure(data.lastFailure);
    const retryCount = Number(data.retryCount) || 0;
    const retryMax = Number(data.retryMax) || 3;
    setText('retry', data.retryExhausted ? `${retryCount}/${retryMax} 已用尽` : `${retryCount}/${retryMax}`);
    renderSteps(data.steps);
    const lines = Array.isArray(data.tail) ? data.tail : [];
    renderLogs(lines);
  }

  async function poll() {
    try {
      const res = await fetch('/api/status', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (res.status === 401) {
        location.replace('/');
        return;
      }
      if (!res.ok) {
        showBanner('状态读取失败');
        return;
      }
      render(await res.json());
    } catch {
      showBanner('无法连接');
    }
  }

  poll();
  setInterval(poll, 2000);
})();
