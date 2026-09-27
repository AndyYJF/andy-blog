---
slug: rp-hub-silly-tavern
kind: post
locale: en
title: 'RP Hub: A More Beginner-Friendly SillyTavern-Like Project'
legacyCid: 66
canonicalPath: /en/posts/rp-hub-silly-tavern/
commentKey: /posts/rp-hub-silly-tavern/
feedGuid: https://www.andy-y.cn/index.php/archives/66/#en
allowComment: true
allowFeed: true
pubDate: '2026-09-26T15:30:40.000Z'
updatedDate: '2026-09-26T15:30:40.000Z'
categories:
  - mid: 1
    name: 所有文章
    slug: default
  - mid: 11
    name: 开源项目
    slug: opensource
tags: []
sourceFormat: markdown
sourceCid: 66
sourceRevision: 1
sourcePublishedAt: '2026-06-26T13:06:00.000Z'
translationVersionId: 8
translationStatus: current
translationAvailableAt: '2026-09-26T15:30:40.000Z'
description: The author introduces their fork of RP-Hub, an easy-to-use alternative to SillyTavern. Enhanced with AI assistance, this modified version introduces multi-user support, cloud synchronization, a self-hosted character library, and an admin panel.
cover: https://tc.andy-y.cn/i/2026/08/14/6a7f231a443cf.png
---

**Disclaimer: This project is a modification of [RP-Hub](https://github.com/STA1N156/RP-Hub). Per the original author's requirements, I have obtained authorization for this secondary development. AI was used during the modification process; if you object to this, feel free to stop reading here.**
# Preface
As we all know, original SillyTavern has **no** animations, a **bloated** UI, and is absolute **hell** for beginners. I had always been looking for an easy-to-use, modern SillyTavern-like project. By chance, I came across this video on Bilibili:


:::bilibili{bvid="BV1yKSSBKERq"}
:::


It was exactly what I had been hoping for!
However, looking closely at the project, I noticed that because it leaned toward pure front-end development, it lacked the multi-user functionality of the original SillyTavern and had no multi-device sync capability, which fell quite short of my expectations. So, ~~in the spirit of not letting my Plus subscription go to waste,~~ I decided to handcraft the multi-user and synchronization features myself.
# The Battle
So I cloned the repository, opened Codex, and started a two-day battle with AI.
I won't dwell on the process. This modification was co-developed using the GLM-5.2, GPT-5.5, and Claude-Opus-4.6 models—with GPT writing the bulk of the code, GLM conducting code reviews, and ~~Claude slacking off~~.
After stumbling along and burning quite a few tokens, I managed to finish it anyway.
 ![CC-Switch Statistics](https://tc.andy-y.cn/i/2026/06/26/6a3e764fa806c.png)
# Results
 **I have published the modified project on [GitHub](https://github.com/AndyYJF/RP-Hub)**
 On top of the original pure front-end project, the following features have been added (see [DEPLOY.md](https://github.com/AndyYJF/RP-Hub/blob/main/DEPLOY.md) for details):

### Multi-User System
- JWT authentication (username + password + refresh token rotation)
- User data cloud sync (smart timestamp-based merge, not a full overwrite)
- Switchable local mode / server mode (completely identical to the original project when logged out)

### Public Character Library (self-hosted)
- User submits character card → Admin review → Public display → Other users download
- Coexists with the original author's "Wanxiang Plaza", clearly separated in the sidebar

### Admin Panel (`admin.html`)
- System statistics (users / character cards / login trends)
- User management (CRUD, ban/unban, API Key binding, quotas)
- Character card review (preview, approve, reject with reason, delist)
- Announcement management (create/edit/pin, automatically displayed on the front-end homepage)
- API usage statistics, audit logs

### Site Announcement System
- Admin publishes announcement → Front-end homepage popup display (distinguished from the original version changelog)

