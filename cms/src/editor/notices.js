import { readStoredCsrf } from '../lib/editor-auth.js';

export async function showAuthNotices(win = window) {
  const slot = win.document.getElementById('notices');
  if (!slot) return;
  const csrf = readStoredCsrf(win.sessionStorage);
  if (!csrf) return;
  const response = await win.fetch('/api/auth/notices', {
    credentials: 'same-origin',
    headers: { 'x-csrf-token': csrf },
  });
  if (!response.ok) return;
  const body = await response.json();
  const latest = body.notices?.[0];
  if (!latest) return;
  const when = new Date(latest.createdAt * 1000).toISOString();
  slot.textContent = `最近一次恢复记录在 ${when}。没有发邮件。`;
}
