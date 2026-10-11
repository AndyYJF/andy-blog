export const PREVIEW_LIMITS = {
  debounceMs: 300,
  maxBytes: 512 * 1024,
  maxConcurrent: 2,
  timeoutMs: 3000,
};

const ALLOWED_HOSTS = new Set(['music.163.com', 'music.126.net']);

export function assertPreviewFetchUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('preview fetch must be http(s)');
  }
  if (url.username || url.password) throw new Error('preview fetch rejects credentials');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!ALLOWED_HOSTS.has(host)) throw new Error(`preview fetch host is not allowlisted: ${host}`);
  return url;
}

export function createPreviewGate() {
  let active = 0;
  const queue = [];
  return {
    async run(work, timeoutMs = PREVIEW_LIMITS.timeoutMs) {
      if (active >= PREVIEW_LIMITS.maxConcurrent) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('preview wait timed out')), timeoutMs);
          queue.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      active += 1;
      try {
        return await Promise.race([
          work(),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('preview timed out')), timeoutMs);
          }),
        ]);
      } finally {
        active -= 1;
        const next = queue.shift();
        if (next) next();
      }
    },
  };
}

export function acceptPreviewMessage(event, { iframeWindow, flowId }) {
  if (!event || event.source !== iframeWindow) return false;
  const data = event.data;
  if (!data || (data.type !== 'cms-preview-ready' && data.type !== 'cms-preview-ack')) return false;
  return data.flowId === flowId;
}
