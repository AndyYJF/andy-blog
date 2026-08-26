export const profile = {
  name: "AndyYan",
  eyebrow: "PERSONAL LEDGER / 2026",
  role: "一个爱折腾网络和服务器的大一学生",
  intro:
    "从 VPS、BGP 到各种自托管服务，踩过的坑和解决问题的过程，都会慢慢记在这里。",
  email: "070127andy@gmail.com",
  focus: [
    {
      index: "01",
      title: "网络实践",
      description: "围绕 BGP、WireGuard 与 DN42，维护一套跨地区的实验网络。",
    },
    {
      index: "02",
      title: "基础设施",
      description: "关注 VPS、自托管服务、监控以及能够稳定复现的部署流程。",
    },
    {
      index: "03",
      title: "技术记录",
      description: "把踩坑、修复与取舍写下来，让一次问题变成可以复用的经验。",
    },
  ],
  projects: [
    {
      marker: "NETWORK",
      title: "AndyYan's DN42 Network",
      description:
        "ASN 4242422921，当前页面记录了洛杉矶、法兰克福、香港和东京四个节点。",
      href: "/dn42/",
      linkLabel: "查看网络信息",
    },
    {
      marker: "SITE",
      title: "AndyYan Blog",
      description:
        "以 Astro 生成静态页面，保留 Typecho 内容来源，并使用 Pagefind 提供按需加载的站内搜索。",
      href: "/category/astro/",
      linkLabel: "浏览相关文章",
    },
  ],
} as const;
