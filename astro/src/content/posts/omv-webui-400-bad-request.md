---
slug: omv-webui-400-bad-request
kind: post
title: 解决OMV登陆WebUI时400 Bad Request错误
legacyCid: 11
canonicalPath: /posts/omv-webui-400-bad-request/
commentKey: /posts/omv-webui-400-bad-request/
feedGuid: https://www.andy-y.cn/index.php/archives/11/
allowComment: true
allowFeed: true
pubDate: '2026-01-23T06:25:00.000Z'
updatedDate: '2026-07-02T07:35:43.000Z'
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
description: 今天在登陆OMV（Open Media Vault）的时候显示400 - Bad Request，但是我的密码都是自动填充的，不可能出错，而且我没有改过密码，折腾一段时间之后终于找到解决方法。
cover: https://tc.andy-y.cn/i/2026/08/14/6a7f22fc39304.png
---

# 前言#
今天在登陆OMV（Open Media Vault）的时候显示400 - Bad Request，但是我的密码都是自动填充的，不可能出错，而且我没有改过密码，折腾一段时间之后终于找到解决方法。
# 解决#
## 检查密码是否真的错误##
进入 `ssh` ，输入
```bash
omv-firstaid
```
进入omv的恢复界面之后选择4并重置密码


:::alert{type="info"}
若此时发现使用此密码无法登陆，则可以确定是omv从5.x到8.3的一个祖传bug
:::

## 解决bug##
非常简单，只需要
```bash
reboot
```
即可解决
# 问题溯源#
- 在OMV官方论坛上，我找到了 [这个](https://forum.openmediavault.org/index.php?thread/52367-400-bad-request-unable-to-login-to-web-ui-after-update-to-6-9-15/) 帖子，上面通过重置密码解决了
- 在贴吧，我找到了[这个](https://tieba.baidu.com/p/7785226421)帖子，上面说是系统盘满了导致的，我不认为是这个原因（我的系统盘占用不到一半）
- 有人提到了删除浏览器的cookies，尝试无效
- 而他们的解决方法都提到了 `reboot` ，所以我直接使用了万能重启法，成功解决
-  ~~经过AI分析~~ ，似乎是php-fpm / openmediavault-engined 异常而导致子进程卡死，而nginx 无法正确解析响应，所以返回了400




