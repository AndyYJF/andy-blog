---
slug: ios-lz4-extract
kind: post
title: IOS系统解压.lz4格式压缩包
legacyCid: 33
canonicalPath: /posts/ios-lz4-extract/
commentKey: /posts/ios-lz4-extract/
feedGuid: https://www.andy-y.cn/index.php/archives/33/
allowComment: true
allowFeed: true
pubDate: '2026-03-13T12:27:00.000Z'
updatedDate: '2026-07-02T07:34:40.000Z'
categories:
  - mid: 1
    name: 所有文章
    slug: default
  - mid: 11
    name: 开源项目
    slug: opensource
tags: []
sourceFormat: markdown
description: 大家可能会遇到lz4格式的压缩包（多见于防止用户 手贱 在线解压的网盘资源），这时安卓可以使用ZArchiver方便的解压，但是ios就不行了，这里分享一个基于iSH的解压教程。
cover: https://tc.andy-y.cn/i/2026/08/14/6a7f2305e0f16.png
---

## 前言
大家可能会遇到lz4格式的压缩包（多见于防止用户 ~~手贱~~ 在线解压的网盘资源），这时安卓可以使用ZArchiver方便的解压，但是ios就不行了，这里分享一个基于iSH的解压教程。

## 开整

#### 1.下载iSH
这里用到了一个叫做iSH的工具，这是一个适用于 iOS 设备的开源终端模拟器，相当于一个轻量化的linux环境。
直接打开AppStore搜索 `iSH` 下载
 ![iSH下载界面](https://tc.andy-y.cn/i/2026/03/13/69b400cadf490.png)

#### 2.打开 iSH，安装 lz4

```bash
apk add lz4
```

#### 3.把.lz4文件导入iSH通过“文件”App分享 → iSH）

#### 4.开始解压
```bash
lz4 -d <XXX.lz4> <输出文件名>  #注：自行替换尖括号里面的内容为实际名称
```




:::collapse{label="example"}
```bash
lz4 -d test.lz4 test.rar
```
:::



#### 5.验证解压结果
```bash
ls -a
```



