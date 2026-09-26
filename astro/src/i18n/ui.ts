/**
 * UI string dictionary (P3). Components pull strings through ui(lang) instead
 * of hardcoding Chinese. en nav drops moments/listening (zh-only sections).
 */
export type UiLang = 'zh' | 'en';

export function toUiLang(lang?: string): UiLang {
  return lang && lang.startsWith('en') ? 'en' : 'zh';
}

const zh = {
  description: 'AndyYan 的技术博客',
  home: '主页',
  homeAria: '个人主页',
  homeHref: '/',
  skipLink: '跳到正文',
  navAria: '主要导航',
  menu: '菜单',
  menuOpen: '打开导航菜单',
  menuClose: '关闭导航菜单',
  themeToggle: '切换主题',
  toTop: '返回顶部',
  spineAria: '页面章节',
  tocAria: '文章目录',
  progressAria: '章节导航',
  footerNavAria: '页脚导航',
  uptime: '本站已运行',
  nodes: '4 节点 · FULL-MESH',
  about: '关于',
  aboutHref: '/about/',
  paginationAria: '分页',
  prevPage: '上一页',
  nextPage: '下一页',
  comments: '评论',
  allPosts: '全部文章',
  allPostsHref: '/posts/',
  continueReading: '继续阅读',
  prevOlder: '← 上一篇 · 更早',
  nextNewer: '下一篇 · 较新 →',
  adjacentAria: '相邻文章',
  related: '相近主题',
  categoryAria: '文章分类',
  emptyPosts: '暂无文章',
  sharedTopics: (names: string) => `共同主题：${names}`,
  minutes: (n: number) => `预计 ${n} 分钟`,
  chars: (formatted: string) => `${formatted} 字`,
  updatedOn: (day: string) => `更新于 ${day}`,
  nav: [
    { href: '/posts/', label: '文章' },
    { href: '/moments/', label: '闲话' },
    { href: '/archive/', label: '归档' },
    { href: '/friends/', label: '友链' },
    { href: '/dn42/', label: 'DN42' },
    { href: '/listening/', label: '在听' },
    { href: '/about/', label: '关于' },
  ],
};

const en: typeof zh = {
  description: "AndyYan's tech blog",
  home: 'Home',
  homeAria: 'Home',
  homeHref: '/en/',
  skipLink: 'Skip to content',
  navAria: 'Primary navigation',
  menu: 'Menu',
  menuOpen: 'Open navigation menu',
  menuClose: 'Close navigation menu',
  themeToggle: 'Toggle theme',
  toTop: 'Back to top',
  spineAria: 'Page sections',
  tocAria: 'Table of contents',
  progressAria: 'Section navigation',
  footerNavAria: 'Footer navigation',
  uptime: 'Online for',
  nodes: '4 NODES · FULL-MESH',
  about: 'About',
  aboutHref: '/en/about/',
  paginationAria: 'Pagination',
  prevPage: 'Previous',
  nextPage: 'Next',
  comments: 'Comments',
  allPosts: 'All posts',
  allPostsHref: '/en/posts/',
  continueReading: 'Continue reading',
  prevOlder: '← Previous · older',
  nextNewer: 'Next · newer →',
  adjacentAria: 'Adjacent posts',
  related: 'Related topics',
  categoryAria: 'Categories',
  emptyPosts: 'No posts yet',
  sharedTopics: (names: string) => `Shared topics: ${names}`,
  minutes: (n: number) => `${n} min read`,
  chars: (formatted: string) => `${formatted} chars`,
  updatedOn: (day: string) => `Updated ${day}`,
  nav: [
    { href: '/en/posts/', label: 'Posts' },
    { href: '/en/archive/', label: 'Archive' },
    { href: '/en/friends/', label: 'Friends' },
    { href: '/dn42/', label: 'DN42' },
    { href: '/en/about/', label: 'About' },
  ],
};

export type UiStrings = typeof zh;

export function ui(lang?: string): UiStrings {
  return toUiLang(lang) === 'en' ? en : zh;
}
