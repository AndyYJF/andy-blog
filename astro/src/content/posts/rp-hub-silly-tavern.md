---
slug: rp-hub-silly-tavern
kind: post
title: RP Hub——更适合新手的类Silly Tavern项目
legacyCid: 66
canonicalPath: /posts/rp-hub-silly-tavern/
commentKey: /posts/rp-hub-silly-tavern/
feedGuid: https://www.andy-y.cn/index.php/archives/66/
allowComment: true
allowFeed: true
pubDate: '2026-06-26T13:06:00.000Z'
updatedDate: '2026-07-02T07:33:24.000Z'
categories:
  - mid: 1
    name: 所有文章
    slug: default
  - mid: 11
    name: 开源项目
    slug: opensource
tags: []
sourceFormat: markdown
description: 众所周知，原版的Silly Tavern，动画是 没有 的，界面是 臃肿 的，对新手是 地狱 的。我一直想找到一个易用且现代的类Silly Tavern项目，某次偶然在B站看到了这个视频：
cover: https://tc.andy-y.cn/i/2026/08/14/6a7f231a443cf.png
---

**声明：此项目二改自 [RP-Hub](https://github.com/STA1N156/RP-Hub) ，根据原项目作者要求，本人已得到原作者关于二改的授权。二改过程中使用了AI，若您对此反对可停止阅读**
# 前言
众所周知，原版的Silly Tavern，动画是 **没有** 的，界面是 **臃肿** 的，对新手是 **地狱** 的。我一直想找到一个易用且现代的类Silly Tavern项目，某次偶然在B站看到了这个视频：


:::bilibili{bvid="BV1yKSSBKERq"}
:::


可谓是正中下怀啊！
但是仔细看了看项目发现，由于偏向仅前端开发，项目没有原版Silly Tavern的多用户功能，也没有多端同步能力，和我的预期相差较多，于是 ~~秉承着Plus订阅不用白不用的态度~~ 我决定手搓出多用户和同步功能。
# 博弈
于是我便把项目克隆，打开了Codex，开始了和AI博弈的两天。
过程就不多说了，本次二改项目使用了GLM-5.2、GPT-5.5，Claude-Opus-4.6模型共同开发，由GPT主写代码，GLM进行代码审批， ~~Claude负责摸鱼~~ 。
跌跌撞撞花了不少token，反正是做出来了。
 ![CC-Switch统计](https://tc.andy-y.cn/i/2026/06/26/6a3e764fa806c.png)
# 成果
 **二改项目我已经放在了 [Github](https://github.com/AndyYJF/RP-Hub) **
 在原纯前端项目基础上，新增了以下功能（详见 [DEPLOY.md](https://github.com/AndyYJF/RP-Hub/blob/main/DEPLOY.md)）：

### 多用户体系
- JWT 认证（用户名 + 密码 + 刷新令牌轮转）
- 用户数据云端同步（基于时间戳的智能合并，非整体覆盖）
- 本地模式 / 服务端模式可切换（未登录时与原项目完全一致）

### 公共角色库（自建）
- 用户提交角色卡 → 管理员审核 → 公共展示 → 其他用户下载
- 与原作者的「万相广场」并存，侧边栏明确区分

### 后台管理（`admin.html`）
- 系统统计（用户/角色卡/登录趋势）
- 用户管理（增删改查、封禁/解封、API Key 绑定、配额）
- 角色卡审核（预览、通过、拒绝带理由、下架）
- 公告管理（创建/编辑/置顶，前端主页自动展示）
- API 用量统计、审计日志

### 站点公告系统
- 管理员发布公告 → 前端主页弹窗展示（区别于原版本更新日志）

