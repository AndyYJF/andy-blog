---
slug: ios-lz4-extract
kind: post
locale: en
title: Extracting .lz4 Archives on iOS
legacyCid: 33
canonicalPath: /en/posts/ios-lz4-extract/
commentKey: /posts/ios-lz4-extract/
feedGuid: https://www.andy-y.cn/index.php/archives/33/#en
allowComment: true
allowFeed: true
pubDate: '2026-09-26T15:30:39.000Z'
updatedDate: '2026-09-26T15:30:39.000Z'
categories:
  - mid: 1
    name: 所有文章
    slug: default
  - mid: 11
    name: 开源项目
    slug: opensource
tags: []
sourceFormat: markdown
sourceCid: 33
sourceRevision: 1
sourcePublishedAt: '2026-03-13T12:27:00.000Z'
translationVersionId: 5
translationStatus: current
translationAvailableAt: '2026-09-26T15:30:39.000Z'
description: A step-by-step guide on how to decompress .lz4 archive files on iOS devices using the iSH terminal emulator.
cover: https://tc.andy-y.cn/i/2026/08/14/6a7f2305e0f16.png
---

## Preface

You might encounter archives in .lz4 format (often used for cloud drive resources to prevent users from ~~fiddling around and~~ extracting them online). While Android users can easily extract them using ZArchiver, iOS cannot. Here, I'm sharing an extraction guide based on iSH.

## Let's Get Started

#### 1. Download iSH
Here, we use a tool called iSH, an open-source terminal emulator for iOS devices that acts as a lightweight Linux environment.
Open the App Store directly, search for `iSH`, and download it.
 ![iSH download interface](https://tc.andy-y.cn/i/2026/03/13/69b400cadf490.png)

#### 2. Open iSH and install lz4

```bash
apk add lz4
```

#### 3. Import the .lz4 file into iSH (via "Files" App Share → iSH)

#### 4. Start extracting
```bash
lz4 -d <XXX.lz4> <输出文件名>  #注：自行替换尖括号里面的内容为实际名称
```




:::collapse{label="example"}
```bash
lz4 -d test.lz4 test.rar
```
:::



#### 5. Verify the extraction result
```bash
ls -a
```
