---
slug: screen-tmux-ssh-background
kind: post
title: 使用screen/tmux命令实现SSH中任务后台运行
legacyCid: 41
canonicalPath: /posts/screen-tmux-ssh-background/
commentKey: /posts/screen-tmux-ssh-background/
feedGuid: https://www.andy-y.cn/index.php/archives/41/
allowComment: true
allowFeed: true
pubDate: '2026-04-05T11:29:00.000Z'
updatedDate: '2026-07-02T07:34:07.000Z'
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
description: 在我们使用ssh的时候正常情况下，如果我们退出ssh，进程会被杀掉，导致一些需要运行较长时间（比如 rsync/cp ）的命令中断，十分的难受，这里提供两种解决办法：
cover: https://tc.andy-y.cn/i/2026/08/14/6a7f230d01aac.png
---

## 前言：
在我们使用ssh的时候正常情况下，如果我们退出ssh，进程会被杀掉，导致一些需要运行较长时间（比如 `rsync/cp` ）的命令中断，十分的难受，这里提供两种解决办法：
### 1.使用screen
#### 1.1开启 screen：
```bash
screen -S upload
```
#### 1.2执行命令
```bash
##举例
rsync -avh --progress /data/myfolder/ /mnt/myfolder/
```
#### 1.3退出SSH保持后台运行：
```bash
按：Ctrl + A 然后按 D
```
#### 1.4重新连接后恢复
```bash
screen -r upload
```
## 2.使用tmux
#### 2.1启动tmux
```bash
tmux new -s upload
```
#### 2.2执行命令后，退出保持后台
```bash
Ctrl + B 然后按 D
```
#### 2.3重新连接后恢复
```bash
tmux attach -t upload
```

