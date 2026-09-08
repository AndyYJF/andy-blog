export const MOMENT_PAGE_SIZE = 15;

export function sortMoments(moments) {
  return [...moments].sort(
    (a, b) =>
      b.data.pubDate.valueOf() - a.data.pubDate.valueOf() ||
      b.data.legacyCid - a.data.legacyCid,
  );
}

export function paginateMoments(moments, pageSize = MOMENT_PAGE_SIZE) {
  const sorted = sortMoments(moments);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  return { sorted, totalPages, pageSize };
}

export function momentPageSlice(moments, page, pageSize = MOMENT_PAGE_SIZE) {
  const { sorted, totalPages } = paginateMoments(moments, pageSize);
  const safe = Math.min(Math.max(1, page), totalPages);
  const start = (safe - 1) * pageSize;
  return {
    moments: sorted.slice(start, start + pageSize),
    current: safe,
    totalPages,
    pageSize,
  };
}

/** Asia/Shanghai wall time for moment cards. */
export function formatMomentTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const nowYear = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).format(new Date());
  const prefix = year === nowYear ? `${month} 月 ${day} 日` : `${year} 年 ${month} 月 ${day} 日`;
  return `${prefix} · ${hour}:${minute}`;
}
