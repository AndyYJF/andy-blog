export const PAGE_SIZE = 10;

export function sortPosts(posts) {
  return [...posts].sort(
    (a, b) =>
      b.data.pubDate.valueOf() - a.data.pubDate.valueOf() ||
      b.data.legacyCid - a.data.legacyCid,
  );
}

export function paginate(posts, pageSize = PAGE_SIZE) {
  const sorted = sortPosts(posts);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  return { sorted, totalPages, pageSize };
}

export function pageSlice(posts, page, pageSize = PAGE_SIZE) {
  const { sorted, totalPages } = paginate(posts, pageSize);
  const safe = Math.min(Math.max(1, page), totalPages);
  const start = (safe - 1) * pageSize;
  return {
    posts: sorted.slice(start, start + pageSize),
    current: safe,
    totalPages,
    pageSize,
  };
}
