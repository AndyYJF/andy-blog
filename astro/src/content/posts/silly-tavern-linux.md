---
slug: silly-tavern-linux
kind: post
title: Linux环境下的Silly Tavern 云酒馆 AI 搭建与美化完善（几乎0基础？）
legacyCid: 34
canonicalPath: /posts/silly-tavern-linux/
commentKey: /posts/silly-tavern-linux/
feedGuid: https://www.andy-y.cn/index.php/archives/34/
allowComment: true
allowFeed: true
pubDate: '2026-03-13T15:09:00.000Z'
updatedDate: '2026-08-13T11:12:30.000Z'
categories:
  - mid: 1
    name: 所有文章
    slug: default
  - mid: 11
    name: 开源项目
    slug: opensource
  - mid: 12
    name: AI
    slug: AI
tags: []
sourceFormat: markdown
description: Silly Tavern Chat（云酒馆） 是一个强大的AI Role Play网站，依赖于庞大的社区资源，可以实现多样化的角色互动。 支持国内外多种AI模型，有着比较直观 但一点也不好看 的用户界面。…
cover: https://tc.andy-y.cn/i/2026/08/14/6a7f2309e05ec.png
---


:::alert{type="info"}
感谢McD大佬的指导
:::



# 前言
Silly Tavern Chat（云酒馆） 是一个强大的AI Role Play网站，依赖于庞大的社区资源，可以实现多样化的角色互动。 支持国内外多种AI模型，有着比较直观 ~~但一点也不好看~~ 的用户界面。
其实酒馆ai可以直接部署在很多设备上（安卓，Windows），但是不便于多端同步等等，将酒馆部署在云端可以使用WebUI方便的使用任何设备访问酒馆。下面是从0开始的云端Silly Tavern部署教程。
## 前期准备
- [x] 一台至少1核2G的云服务器（推荐JP区域）
- [x] 本地SSH工具（我使用的是termius）
- [x] 一点点linux基本使用技巧
- [x] 已对Silly Tavern有一定了解
- [x] 最好加入了[类脑ΟΔΥΣΣΕΙΑ](https://discord.gg/odysseia)社区，截至2026/03/12仍然是开放状态
# 开始部署
## 0.SSH的连接
#### 0.1打开Termius（这里以电脑版举例）
 ![ ](https://tc.andy-y.cn/i/2026/03/13/69b40dcb357c3.png)
#### 0.2点击 `NEW HOST`，在红框内填写IDC商家提供给你的信息
![](https://tc.andy-y.cn/i/2026/03/13/69b40eb6ec83e.png)
( `Lable` 就是你给vps起的名字)
#### 0.3点击 `Connect` 连接
### 1.安装1panel面板
为了方便萌新进行后续反代等等的搭建，建议先安装1p。
输入下方这串命令，按提示操作（提示是否安装docker时直接按enter键）
```bash
bash -c "$(curl -sSL https://resource.fit2cloud.com/1panel/package/v2/quick_start.sh)"
```


:::alert{type="warning"}
安装完之后一定要记住访问地址与端口号！
:::


### 2.获取项目
#### 2.1首先安装git
```bash
sudo apt update  ##一行一行执行
sudo apt install git
```
#### 2.2从github拉取项目
```bash
git clone https://github.com/SillyTavern/SillyTavern
```
等待一会拉取

### 3.启动容器，调整参数
#### 3.1启动容器
```bash
cd SillyTavern/docker
docker compose up -d
```
#### 3.2编辑配置文件
```bash
sudo nano config/config.yaml
```
此时进入到你 `config` 配置文件
点击向下，直到看到 `whitelistMode`
![](https://tc.andy-y.cn/i/2026/03/13/69b412548e526.png)
把后面的 `true` 改为 `false`
再往下找到basicAuthMode
![](https://tc.andy-y.cn/i/2026/03/13/69b4136a1aa0b.png)
把false改为true
最后在下方设置你的账号密码
![](https://tc.andy-y.cn/i/2026/03/13/69b412b439d5c.png)
按 `ctrl+O` ，再按 `enter`
接着按 `ctrl+X` 保存退出nano编辑器

#### 3.3重启容器，使改动生效
```bash
docker compose restart sillytavern
```
到此处恭喜你酒馆AI搭建已经完成。打开浏览器输入 `http://<你的ip>:8000` 访问界面
## 4.基础参数设置
打开WebUI跟随它的提示进行填写，这里不多提。
## 5.美化
先贴一张效果图
![](https://tc.andy-y.cn/i/2026/03/13/69b41a5ea9044.png)
我使用的是类脑频道里面[这位](https://discordapp.com/channels/1134557553011998840/1312585645167738931)大佬的美化方案
![](https://tc.andy-y.cn/i/2026/03/13/69b4168d19497.png)
这个美化很重要的一点就是对手机端非常友好:在滑动 `正则` 时不会误触改变顺序
没有进频道的我这里提供[下载链接](https://drive.andy-y.cn/Light_sky_2.0.json)
修改方式如下：
![](https://tc.andy-y.cn/i/2026/03/13/69b41bba81cb2.png)
### 6.优化与增强
在最上面一栏从右往左第三个里可以安装拓展，从而增强酒馆游玩的舒适度
主要是下面这几个：
#### 6.1酒馆助手
这是[项目地址](https://github.com/n0vi028/JS-Slash-Runner)
#### 6.2提示词模板
这是[项目地址](https://github.com/zonde306/ST-Prompt-Template)
#### 6.3文生图插件
这是[项目地址](https://github.com/shaochami/chami_tavern-scene-plugin.git)
### 7.域名反代
 - [ ] 待完成










