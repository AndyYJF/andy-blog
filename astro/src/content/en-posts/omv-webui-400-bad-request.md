---
slug: omv-webui-400-bad-request
kind: post
locale: en
title: Resolving the 400 Bad Request Error When Logging into the OMV WebUI
legacyCid: 11
canonicalPath: /en/posts/omv-webui-400-bad-request/
commentKey: /posts/omv-webui-400-bad-request/
feedGuid: https://www.andy-y.cn/index.php/archives/11/#en
allowComment: true
allowFeed: true
pubDate: '2026-09-26T15:30:38.000Z'
updatedDate: '2026-09-26T15:30:38.000Z'
categories:
  - mid: 1
    name: 所有文章
    slug: default
  - mid: 6
    name: NAS
    slug: NAS
  - mid: 14
    name: 运维
    slug: mnt
tags: []
sourceFormat: markdown
sourceCid: 11
sourceRevision: 1
sourcePublishedAt: '2026-01-23T06:25:00.000Z'
translationVersionId: 2
translationStatus: current
translationAvailableAt: '2026-09-26T15:30:38.000Z'
description: This post explains how to resolve the 400 Bad Request error encountered when attempting to log into the OpenMediaVault (OMV) WebUI. It provides a simple fix and analyzes the potential root cause behind the issue.
cover: https://tc.andy-y.cn/i/2026/08/14/6a7f22fc39304.png
---

# Introduction#
Today, when logging into OMV (Open Media Vault), it displayed 400 - Bad Request. However, my passwords are all autofilled, so it couldn't have been wrong, and I hadn't changed my password. After troubleshooting for a while, I finally found a solution.
# Solution#
## Check if the password is truly incorrect##
Enter `ssh`, and run:
```bash
omv-firstaid
```
After entering the OMV recovery interface, select 4 and reset the password.


:::alert{type="info"}
若此时发现使用此密码无法登陆，则可以确定是omv从5.x到8.3的一个祖传bug
:::

## Fix the bug##
It is very simple, just run:
```bash
reboot
```
to resolve it.
# Tracing the Issue#
- On the official OMV forum, I found [this](https://forum.openmediavault.org/index.php?thread/52367-400-bad-request-unable-to-login-to-web-ui-after-update-to-6-9-15/) post, where the issue was resolved by resetting the password.
- On Tieba, I found [this](https://tieba.baidu.com/p/7785226421) post, which claimed it was caused by a full system disk; I do not believe this was the reason in my case (my system disk usage was under half).
- Some people suggested clearing browser cookies, but trying that did not work.
- However, their solutions all mentioned `reboot`, so I went straight for the universal reboot method and successfully resolved it.
-  ~~After AI analysis~~ , it seems an issue with php-fpm / openmediavault-engined caused child processes to freeze, leaving nginx unable to properly parse the response and returning a 400 error.




