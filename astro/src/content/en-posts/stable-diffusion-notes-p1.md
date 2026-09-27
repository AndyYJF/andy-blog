---
slug: stable-diffusion-notes-p1
kind: post
locale: en
title: StableDiffusion Study Notes_P1
legacyCid: 62
canonicalPath: /en/posts/stable-diffusion-notes-p1/
commentKey: /posts/stable-diffusion-notes-p1/
feedGuid: https://www.andy-y.cn/index.php/archives/62/#en
allowComment: true
allowFeed: true
pubDate: '2026-09-26T15:11:44.000Z'
updatedDate: '2026-09-26T15:11:44.000Z'
categories:
  - mid: 1
    name: 所有文章
    slug: default
  - mid: 12
    name: AI
    slug: AI
tags: []
sourceFormat: markdown
sourceCid: 62
sourceRevision: 1
sourcePublishedAt: '2026-06-20T07:58:00.000Z'
translationVersionId: 22
translationStatus: current
translationAvailableAt: '2026-09-26T15:11:44.000Z'
description: A beginner's guide to deploying ComfyUI via StabilityMatrix and setting up a foundational text-to-image workflow in Stable Diffusion.
cover: https://tc.andy-y.cn/i/2026/08/14/6a7f2319480b4.png
---

# Introduction
I've always wanted to try StableDiffusion, but I never had a suitable graphics card. After finishing the Gaokao, I finally bought a laptop with an RTX 5080 and decided it was time to dive in~
# Preliminary Understanding
Given that StableDiffusion's webui hasn't been updated in a while, I chose ComfyUI as the visual interface—it is more modern and offers greater extensibility.
# Let's Get Started
## 1 Deploying ComfyUI
For beginners, deploying ComfyUI using StabilityMatrix is a great choice.
#### 1.1 Create a dedicated directory
On a drive with plenty of space, create a new folder to store subsequent files, for example:
```txt
D:\AI
```
#### 1.2 Download and Install StabilityMatrix
Head over to GitHub and download the latest release [here](https://github.com/LykosAI/StabilityMatrix/releases)
Install to:

```txt
D:\AI\StabilityMatrix
```


:::alert{type="warning"}
Note: The downloaded archive must be extracted before running, otherwise the installer will face restrictions.
:::


When launching Stability Matrix for the first time, it usually asks you to set a Data Directory / Library path.
Enter:

```txt
D:\AI\AIData
```
Models, packages, and caches will all be stored in this directory going forward.
#### 1.3 Install ComfyUI
After opening Stability Matrix, locate the Packages / Install section.
- Find ComfyUI
- Install the latest version
- Keep all other settings at default
- Once installed, click Launch



:::alert{type="warning"}
Note: The download process pulls releases from GitHub. If you are using a proxy, please enable TUN mode.
:::


If everything is normal, this prompt should appear:
```bash
[INFO] To see the GUI go to: http://127.0.0.1:8188
```
Just navigate to that address.

## 2. Add Models and Create a Workflow

#### 2.1 Obtaining Models
Beginners can directly use the resources I found online. ~~Apologies for only having a Baidu Netdisk link~~


:::cloud{title="SD" url="https://pan.baidu.com/s/1v2g_4hKDafaS9tcYEouYxA?pwd=1ajk"}
:::



Alternatively, visit [Civitai](https://civitai.com/) to find models.



:::collapse{label="附C站Content Moderation设置指南"}
1. Access https://civitai.red/ using a **proxy**
2. Log into your account
3. Click your profile avatar in the upper right corner and select the gear icon at the bottom to enter account settings
4. Locate Content Moderation
5. Adjust settings
Note: You must use a proxy, and do not access the .com domain.
:::



#### 2.2 Model Identification
Model identification is crucial; pairing an incompatible model with a LoRA will result in errors.
First is the **Model File Type**
It is recommended to identify them directly by their file extensions:
1. `.safetensors / .ckpt`
These are Checkpoints (the base model core) and can generate images independently.
Model generation identification:
- sd15 / 1-5 / v1-5 → SD1.5
- sd21 / 2-1 → SD2.1
- xl / SDXL → SDXL

2. `.safetensors`
These are LoRAs (style/character add-ons) and cannot generate images alone; they must be paired with a base model.
3. `.vae.safetensors`
This is a VAE, used to improve colors and contrast.
4. `.pt / .bin`
These are Embeddings / Textual Inversion, used to trigger specific keywords.

#### 2.3 Creating a Workflow
Open ComfyUI, and you should see a blank canvas.
1. Double-click the left mouse button, search for `Load Checkpoint`, and add the node.
2. Double-click the left mouse button, search for `CLIP Text Encode`, and add the node (add two of them, used for positive and negative prompt inputs).
3. Double-click the left mouse button, search for `KSampler`, and add the node.
4. Double-click the left mouse button, search for `VAE Decode`, and add the node.
5. Double-click the left mouse button, search for `Save Image`, and add the node.
6. Wiring rules:
 **From Load Checkpoint (Simple):**
- model → KSampler's model
- CLIP → clip on both CLIP Text Encode nodes
- VAE → VAE Decode's vae
 **Text Nodes:**
- Positive CLIP Text Encode → KSampler's positive
- Negative CLIP Text Encode → KSampler's negative
 **Empty Latent Image:**
- Output → KSampler's latent_image
 **KSampler:**
- Output → VAE Decode's samples
 **VAE Decode:**
- Output → Save Image's images
 ![Node Graph](https://tc.andy-y.cn/i/2026/06/20/6a3648a34d580.png)
## 3. Start Generating
#### 3.1 Fill in Prompts
 **Positive Prompt**
Fill into the first CLIP Text Encode node:
```txt
masterpiece, best quality, ultra detailed, 1girl, portrait, soft lighting, detailed eyes
```
 **Negative Prompt**
Fill into the second CLIP Text Encode node:
```txt
low quality, blurry, bad anatomy, extra fingers, deformed hands, watermark, text
```
 **Empty Latent Image**
 Settings:
```txt
width: 1024
height: 1024
batch_size: 1
```
 **KSampler**
 Settings:
 ```txt
steps: 28
cfg: 6
sampler_name: dpmpp_2m  //自行选择，推荐这个
scheduler: karras
```
 **Finally, click `运行` **
 Resulting image:
  ![sample](https://tc.andy-y.cn/i/2026/06/20/6a3648ba8c6ac.png)
