---
slug: screen-tmux-ssh-background
kind: post
locale: en
title: Using screen/tmux to Run Tasks in the Background over SSH
legacyCid: 41
canonicalPath: /en/posts/screen-tmux-ssh-background/
commentKey: /posts/screen-tmux-ssh-background/
feedGuid: https://www.andy-y.cn/index.php/archives/41/#en
allowComment: true
allowFeed: true
pubDate: '2026-09-26T15:30:39.000Z'
updatedDate: '2026-09-26T15:30:39.000Z'
categories:
  - mid: 1
    name: 所有文章
    slug: default
  - mid: 13
    name: 调优
    slug: refine
  - mid: 14
    name: 运维
    slug: mnt
tags: []
sourceFormat: markdown
sourceCid: 41
sourceRevision: 1
sourcePublishedAt: '2026-04-05T11:29:00.000Z'
translationVersionId: 6
translationStatus: current
translationAvailableAt: '2026-09-26T15:30:39.000Z'
description: This guide explains how to use screen or tmux to keep long-running commands alive in the background after disconnecting from an SSH session.
cover: https://tc.andy-y.cn/i/2026/08/14/6a7f230d01aac.png
---

## Preface:
Normally, when we use SSH, exiting the session terminates active processes, which interrupts commands that take a long time to complete (such as `rsync/cp`). This can be very frustrating. Here are two solutions:
### 1. Using screen
#### 1.1 Start screen:
```bash
screen -S upload
```
#### 1.2 Execute the command
```bash
##举例
rsync -avh --progress /data/myfolder/ /mnt/myfolder/
```
#### 1.3 Detach and keep running in the background upon exiting SSH:
```bash
按：Ctrl + A 然后按 D
```
#### 1.4 Reattach after reconnecting
```bash
screen -r upload
```
## 2. Using tmux
#### 2.1 Start tmux
```bash
tmux new -s upload
```
#### 2.2 Detach and keep running in the background after executing the command
```bash
Ctrl + B 然后按 D
```
#### 2.3 Reattach after reconnecting
```bash
tmux attach -t upload
```

