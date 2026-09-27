---
slug: stable-diffusion-notes-p1
kind: post
title: StableDiffusion学习札记_P1
legacyCid: 62
canonicalPath: /posts/stable-diffusion-notes-p1/
commentKey: /posts/stable-diffusion-notes-p1/
feedGuid: https://www.andy-y.cn/index.php/archives/62/
allowComment: true
allowFeed: true
pubDate: '2026-06-20T07:58:00.000Z'
updatedDate: '2026-07-02T07:33:32.000Z'
categories:
  - mid: 1
    name: 所有文章
    slug: default
  - mid: 12
    name: AI
    slug: AI
tags: []
sourceFormat: markdown
description: 之前就一直想玩StableDiffusion奈何没有合适的显卡。高考完终于买了个5080的笔电想着是时候开玩了
cover: https://tc.andy-y.cn/i/2026/08/14/6a7f2319480b4.png
---

# 前言
之前就一直想玩StableDiffusion奈何没有合适的显卡。高考完终于买了个5080的笔电想着是时候开玩了~
# 初步了解
鉴于StableDiffusion的webui有段时间没更新了，我选择使用comfyUI作为可视化界面----更加现代化，并且拓展性更强
# 开整
## 1部署comfyUI
对于新手来说，使用StabilityMatrix部署comfyUI是个不错的选择
#### 1.1建一个固定目录
在一个空间比较大的盘，新建一个文件夹用于存放后续文件，比如：
```txt
D:\AI
```
#### 1.2下载StabilityMatrix与安装
前往github，在 [这里](https://github.com/LykosAI/StabilityMatrix/releases) 下载最新版release
安装到：

```txt
D:\AI\StabilityMatrix
```


:::alert{type="warning"}
注意：下载下来的压缩文件必须解压后运行，否则安装程序受限
:::


第一次打开 Stability Matrix，通常会让你设置一个数据目录 / Library 路径。
填写：

```txt
D:\AI\AIData
```
以后模型、包、缓存都存这个目录。
#### 1.3安装comfyUI
打开 Stability Matrix 后，找到它里面的包 / Packages / Install入口。
- 找到 ComfyUI
- 安装 最新版
- 其它设置都保持默认
- 装完后，点击 Launch / 启动



:::alert{type="warning"}
注意，下载过程需要从github拉取release，若使用代理，请开启tun模式。
:::


若一切正常，应该会出现这个提示：
```bash
[INFO] To see the GUI go to: http://127.0.0.1:8188
```
访问即可。

## 2.加入模型，创建工作流

#### 2.1模型获取
新手可以直接使用我在网上找到的资源。~~只有度盘链接还请见谅~~


:::cloud{title="SD" url="https://pan.baidu.com/s/1v2g_4hKDafaS9tcYEouYxA?pwd=1ajk"}
:::



或者前往 [C站](https://civitai.com/) 寻找模型



:::collapse{label="附C站Content Moderation设置指南"}
1.  **代理** 访问https://civitai.red/
2. 登录账号
3. 点击右上角个人图标，选择最下方的齿轮图标进入账户设置
4. 找到Content Moderation
5. 修改
注：一定要使用代理，也不要访问.com域名
:::



#### 2.2模型识别
模型的识别比较重要，使用错误的模型+Lora会导致报错
首先是 **模型文件类型**
建议直接识别后缀
1.`.safetensors / .ckpt`
这个属于Checkpoint（大模型主体），可以单独出图
模型代数识别：
- sd15 / 1-5 / v1-5 → SD1.5
- sd21 / 2-1 → SD2.1
- xl / SDXL → SDXL

2.`.safetensors`
这个属于LoRA（风格/角色插件）不能单独出图，必须 + base model
3.`.vae.safetensors`
这个是VAE，是用来改善颜色/对比度的
4.`.pt / .bin`
这个属于Embedding / Textual Inversion，是用于用于触发关键词的

#### 2.3创建工作流
打开ComfyUI，你应该能看见一个空白画布
1. 双击左键，搜索 `Load Checkpoint` ，添加节点
2. 双击左键，搜索 `CLIP Text Encode` ，添加节点（要添加两个，这是正向和反向提示词的输入处）
3. 双击左键，搜索 `KSampler` ，添加节点
4. 双击左键，搜索 `VAE Decode` ，添加节点
5. 双击左键，搜索 `Save Image` ，添加节点
6. 连线规则：
 **从 Checkpoint加载器（简易）连出去：**
- 模型 → KSampler 的 model
- CLIP → 两个 CLIP文本编码 节点的 clip
- VAE → VAE Decode 的 vae
 **文本节点：**
- 正向 CLIP文本编码 → KSampler 的 positive
- 负向 CLIP文本编码 → KSampler 的 negative
 **Empty Latent Image：**
- 输出 → KSampler 的 latent_image
 **KSampler：**
- 输出 → VAE Decode 的 samples
 **VAE Decode：**
- 输出 → Save Image 的 images
 ![节点图](https://tc.andy-y.cn/i/2026/06/20/6a3648a34d580.png)
## 3.开始作画
#### 3.1填入提示词
 **正向提示词**
填到第一个 CLIP 文本编码里：
```txt
masterpiece, best quality, ultra detailed, 1girl, portrait, soft lighting, detailed eyes
```
 **负向提示词**
填到第二个 CLIP 文本编码里：
```txt
low quality, blurry, bad anatomy, extra fingers, deformed hands, watermark, text
```
 **Empty Latent Image**
 设置：
```txt
width: 1024
height: 1024
batch_size: 1
```
 **KSampler**
 设置：
 ```txt
steps: 28
cfg: 6
sampler_name: dpmpp_2m  //自行选择，推荐这个
scheduler: karras
```
 **最后点击 `运行` **
 成图：
  ![sample](https://tc.andy-y.cn/i/2026/06/20/6a3648ba8c6ac.png)


