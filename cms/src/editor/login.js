import { forgetCsrf, rememberCsrf } from '../lib/editor-auth.js';

function bytesToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function credentialJson(credential) {
  if (typeof credential.toJSON === 'function') return credential.toJSON();
  const response = credential.response;
  const body = { clientDataJSON: bytesToBase64url(response.clientDataJSON) };
  if (response.attestationObject) {
    body.attestationObject = bytesToBase64url(response.attestationObject);
    body.transports = response.getTransports?.() || [];
  } else {
    body.authenticatorData = bytesToBase64url(response.authenticatorData);
    body.signature = bytesToBase64url(response.signature);
    if (response.userHandle) body.userHandle = bytesToBase64url(response.userHandle);
  }
  return {
    id: credential.id,
    rawId: credential.id,
    type: credential.type,
    response: body,
  };
}

export async function startLogin(win = window) {
  const status = win.document.getElementById('status');
  if (!win.PublicKeyCredential || !win.navigator.credentials) {
    status.textContent = '这个浏览器不能使用 passkey。';
    return;
  }
  status.textContent = '正在向本地服务请求登录。';
  const begin = await win.fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step: 'begin' }),
  });
  const started = await begin.json();
  if (!begin.ok) {
    status.textContent = started.error || '登录没有开始';
    return;
  }
  const publicKey = win.PublicKeyCredential.parseRequestOptionsFromJSON(started.options);
  const credential = await win.navigator.credentials.get({ publicKey });
  const finish = await win.fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step: 'finish', response: credentialJson(credential) }),
  });
  const logged = await finish.json();
  if (!finish.ok || !rememberCsrf(win.sessionStorage, logged.csrfToken)) {
    status.textContent = logged.error || '登录没有完成';
    return;
  }
  win.location.assign('/');
}

export async function startRegister(win = window) {
  const status = win.document.getElementById('status');
  const secretInput = win.document.getElementById('secret');
  const secret = secretInput?.value || '';
  status.textContent = '正在核对初始化 secret。';
  const begin = await win.fetch('/api/auth/register', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step: 'begin', secret }),
  });
  const started = await begin.json();
  if (!begin.ok) {
    status.textContent = started.error || '初始化没有开始';
    return;
  }
  if (!win.PublicKeyCredential || !win.navigator.credentials) {
    status.textContent = '这个浏览器不能使用 passkey。';
    return;
  }
  const publicKey = win.PublicKeyCredential.parseCreationOptionsFromJSON(started.options);
  const credential = await win.navigator.credentials.create({ publicKey });
  const finish = await win.fetch('/api/auth/register', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step: 'finish', secret, response: credentialJson(credential) }),
  });
  const registered = await finish.json();
  if (secretInput) secretInput.value = '';
  status.textContent = finish.ok
    ? '初始化请求已提交。还没有浏览器 passkey 的完成记录，请再登录。'
    : (registered.error || '初始化没有完成');
}

export async function loadNotices(win = window) {
  const slot = win.document.getElementById('notices');
  if (!slot) return;
  const response = await win.fetch('/api/auth/notices', { credentials: 'same-origin' });
  const payload = await response.json();
  if (!response.ok) {
    slot.textContent = '恢复通知没有读到。没有发邮件。';
    return;
  }
  if (!payload.notices?.length) {
    slot.textContent = '没有本地恢复通知。没有发邮件。';
    return;
  }
  slot.textContent = `${payload.notices.map((notice) => `${notice.action} ${notice.createdAt}`).join('；')}。这是本地记录，没有发邮件。`;
}

export async function startLogout(win = window) {
  const status = win.document.getElementById('status');
  const csrf = win.sessionStorage.getItem('cms-csrf') || '';
  const response = await win.fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: '{}',
  });
  forgetCsrf(win.sessionStorage);
  status.textContent = response.ok ? '已退出。' : '退出没有完成。本地保存凭据已清掉。';
}
