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

/**
 * Neighbors in sortPosts order (newest first).
 * 上一篇 / prev = older (index + 1); 下一篇 / next = newer (index - 1).
 */
export function adjacentPosts(posts, currentId) {
  const sorted = sortPosts(posts);
  const index = sorted.findIndex((post) => post.id === currentId);
  if (index < 0) return { prev: undefined, next: undefined };
  return {
    prev: sorted[index + 1],
    next: sorted[index - 1],
  };
}

/** Tag/category mids for related scoring; mid===1 default category excluded. */
function topicMids(post) {
  const mids = new Set();
  for (const category of post.data.categories ?? []) {
    if (category.mid !== 1) mids.add(category.mid);
  }
  for (const tag of post.data.tags ?? []) {
    mids.add(tag.mid);
  }
  return mids;
}

/**
 * Related posts by shared tags/categories (excl. mid===1), then by date.
 * Excludes self; returns up to `limit` (default 3).
 */
export function relatedPosts(posts, current, limit = 3) {
  const currentTopics = topicMids(current);
  if (currentTopics.size === 0 || limit <= 0) return [];

  const scored = [];
  for (const post of posts) {
    if (post.id === current.id) continue;
    const topics = topicMids(post);
    let overlap = 0;
    for (const mid of topics) {
      if (currentTopics.has(mid)) overlap += 1;
    }
    if (overlap > 0) scored.push({ post, overlap });
  }

  scored.sort(
    (a, b) =>
      b.overlap - a.overlap ||
      b.post.data.pubDate.valueOf() - a.post.data.pubDate.valueOf() ||
      b.post.data.legacyCid - a.post.data.legacyCid,
  );

  return scored.slice(0, limit).map((entry) => entry.post);
}
