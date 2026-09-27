---
slug: silly-tavern-linux
kind: post
locale: en
title: Setting Up and Beautifying SillyTavern Cloud AI on Linux (Practically for Beginners?)
legacyCid: 34
canonicalPath: /en/posts/silly-tavern-linux/
commentKey: /posts/silly-tavern-linux/
feedGuid: https://www.andy-y.cn/index.php/archives/34/#en
allowComment: true
allowFeed: true
pubDate: '2026-09-26T15:11:48.000Z'
updatedDate: '2026-09-26T15:11:48.000Z'
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
sourceCid: 34
sourceRevision: 1
sourcePublishedAt: '2026-03-13T15:09:00.000Z'
translationVersionId: 20
translationStatus: current
translationAvailableAt: '2026-09-26T15:11:48.000Z'
description: A beginner-friendly guide to setting up and customizing SillyTavern Cloud AI on a Linux server using Docker. It covers initial environment setup, configuration tweaks, UI beautification, and recommended plugins for an enhanced role-playing experience.
cover: https://tc.andy-y.cn/i/2026/08/14/6a7f2309e05ec.png
---


:::alert{type="info"}
Thanks to McD for the guidance
:::



# Preface
SillyTavern Chat (Cloud Tavern) is a powerful AI Role Play web interface that relies on vast community resources to achieve diverse character interactions. It supports various domestic and international AI models and features a relatively intuitive ~~yet not at all good-looking~~ user interface.
In fact, Tavern AI can be directly deployed on many devices (Android, Windows), but it is not convenient for multi-device synchronization and other needs. Deploying Tavern to the cloud allows you to conveniently access it from any device via its WebUI. Below is a tutorial for deploying SillyTavern to the cloud from scratch.
## Prerequisites
- [x] A cloud server with at least 1 core and 2 GB RAM (JP region recommended)
- [x] A local SSH client (I use Termius)
- [x] Basic Linux command-line skills
- [x] Some prior familiarity with SillyTavern
- [x] Preferably joined the [类脑ΟΔΥΣΣΕΙΑ](https://discord.gg/odysseia) community (still open as of 2026/03/12)
# Starting Deployment
## 0. Connecting via SSH
#### 0.1 Open Termius (taking the desktop version as an example)
 ![ ](https://tc.andy-y.cn/i/2026/03/13/69b40dcb357c3.png)
#### 0.2 Click `NEW HOST` and fill in the information provided by your hosting provider in the red box
![](https://tc.andy-y.cn/i/2026/03/13/69b40eb6ec83e.png)
(`Lable` is simply the name you give to your VPS)
#### 0.3 Click `Connect` to connect
### 1. Installing the 1Panel Dashboard
To make subsequent configurations like reverse proxy easier for beginners, it is recommended to install 1Panel first.
Run the following command and follow the prompts (press Enter when prompted whether to install Docker):
```bash
bash -c "$(curl -sSL https://resource.fit2cloud.com/1panel/package/v2/quick_start.sh)"
```


:::alert{type="warning"}
Make sure to remember the access URL and port number after installation!
:::


### 2. Fetching the Project
#### 2.1 Install Git first
```bash
sudo apt update  ##一行一行执行
sudo apt install git
```
#### 2.2 Clone the project from GitHub
```bash
git clone https://github.com/SillyTavern/SillyTavern
```
Wait a moment for the clone to complete

### 3. Starting the Container and Adjusting Parameters
#### 3.1 Start the container
```bash
cd SillyTavern/docker
docker compose up -d
```
#### 3.2 Edit the configuration file
```bash
sudo nano config/config.yaml
```
You are now in your `config` configuration file
Scroll down until you see `whitelistMode`
![](https://tc.andy-y.cn/i/2026/03/13/69b412548e526.png)
Change the subsequent `true` to `false`
Scroll further down to find basicAuthMode
![](https://tc.andy-y.cn/i/2026/03/13/69b4136a1aa0b.png)
Change false to true
Finally, set your username and password below
![](https://tc.andy-y.cn/i/2026/03/13/69b412b439d5c.png)
Press `ctrl+O`, then press `enter`
Then press `ctrl+X` to save and exit the nano editor

#### 3.3 Restart the container for changes to take effect
```bash
docker compose restart sillytavern
```
Congratulations, your Tavern AI setup is now complete. Open your browser and enter `http://<你的ip>:8000` to access the interface
## 4. Basic Parameter Settings
Open the WebUI and follow the on-screen prompts; details are omitted here.
## 5. Beautification
First, here is a preview
![](https://tc.andy-y.cn/i/2026/03/13/69b41a5ea9044.png)
I am using the beautification theme shared by [this](https://discordapp.com/channels/1134557553011998840/1312585645167738931) user in the 类脑 channel
![](https://tc.andy-y.cn/i/2026/03/13/69b4168d19497.png)
A very important feature of this theme is that it is mobile-friendly: scrolling through `正则` won't accidentally trigger reordering
For those not in the channel, here is the [download link](https://drive.andy-y.cn/Light_sky_2.0.json)
The modification method is as follows:
![](https://tc.andy-y.cn/i/2026/03/13/69b41bba81cb2.png)
### 6. Optimization and Enhancements
You can install extensions from the third icon from the right on the top bar to enhance the Tavern experience
Mainly the following:
#### 6.1 Tavern Helper
Here is the [project address](https://github.com/n0vi028/JS-Slash-Runner)
#### 6.2 Prompt Template
Here is the [project address](https://github.com/zonde306/ST-Prompt-Template)
#### 6.3 Text-to-Image Plugin
Here is the [project address](https://github.com/shaochami/chami_tavern-scene-plugin.git)
### 7. Domain Reverse Proxy
 - [ ] To be completed
