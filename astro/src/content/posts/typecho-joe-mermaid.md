---
slug: typecho-joe-mermaid
kind: post
title: Typecho + JOE 主题下 Mermaid 渲染的解决方案
legacyCid: 47
canonicalPath: /posts/typecho-joe-mermaid/
commentKey: /posts/typecho-joe-mermaid/
feedGuid: https://www.andy-y.cn/index.php/archives/47/
allowComment: false
allowFeed: true
pubDate: '2026-04-05T12:04:00.000Z'
updatedDate: '2026-07-02T07:34:00.000Z'
categories:
  - mid: 1
    name: 所有文章
    slug: default
  - mid: 11
    name: 开源项目
    slug: opensource
  - mid: 13
    name: 调优
    slug: refine
tags: []
sourceFormat: markdown
description: 在 Typecho 中使用 Mermaid 一直不算难，但一旦换成 JOE 主题，问题就开始变得复杂：
cover: https://tc.andy-y.cn/i/2026/06/11/6a2aadbe6645d.png
---

阅前须知：由于博主现在 **并没有太多自己写代码甚至脚本的能力** ，本篇文章在我和AI共同解决了这个问题之后 **直接由AI生成** ，若你对此感到反感，可以现在 **关闭该帖** （ ~~我是废物~~ ）

## 一、问题背景

在 Typecho 中使用 Mermaid 一直不算难，但一旦换成 JOE 主题，问题就开始变得复杂：

* 写好的 ` ```mermaid ` 代码块被当成普通代码高亮
* 插件明明启用了，但图表不渲染
* 翻页（PJAX）后 Mermaid 直接失效

我一开始也尝试用常规方案（正则替换 HTML），结果发现：

👉 **根本不稳定**

---

## 二、问题的本质

JOE 主题做了很多“增强”，包括：

* 自定义代码高亮（Prism / Highlight.js）
* 改写 Markdown 输出结构
* 使用 PJAX（局部刷新页面）

这导致一个核心问题：

> **你在后端生成的 HTML，很可能在前端被再次修改甚至覆盖**

例如你期望的是：

```html
<pre><code class="language-mermaid"></code></pre>
```

但实际可能变成：

```html
<pre class="language-mermaid"></pre>
```

甚至：

```html
<div class="joe_code">
  <pre>...</pre>
</div>
```

👉 **结构不稳定 → 正则必炸**

---

## 三、传统方案为什么不行？

常见插件思路：

```text
Markdown → HTML → 正则替换 → <pre class="mermaid">
```

问题在于：

* 依赖 HTML 结构（不可靠）
* 容易被主题覆盖
* PJAX 后不会重新执行

结论：

> **后端改 HTML，在 JOE 这种强主题下是错误方向**

---

## 四、最终解决方案：前端接管

我最后采用的是：

> ✅ **完全绕过后端，前端动态解析 Mermaid**

核心流程：

```text
页面加载
↓
扫描所有 language-mermaid 代码块
↓
替换为 .mermaid DOM
↓
调用 Mermaid 渲染
```

---

## 五、核心实现解析

### 1. 扫描代码块

```js
const blocks = document.querySelectorAll(
    'pre code.language-mermaid, pre.language-mermaid'
);
```

为什么这样写？

👉 兼容两种结构：

```html
<pre><code class="language-mermaid"></code></pre>
```

```html
<pre class="language-mermaid"></pre>
```

---

### 2. 提取原始代码

```js
let code = codeBlock.textContent;
```

👉 直接拿文本，不依赖 HTML 结构

---

### 3. 重建 DOM

```js
const container = document.createElement('div');
container.className = 'mermaid-container';

const mermaidDiv = document.createElement('div');
mermaidDiv.className = 'mermaid';
mermaidDiv.textContent = code;

container.appendChild(mermaidDiv);
```

最终结构：

```html
<div class="mermaid-container">
  <div class="mermaid">...</div>
</div>
```

---

### 4. 替换原代码块

```js
pre.replaceWith(container);
```

👉 关键点：

* 删除原代码高亮 DOM
* 避免主题再次干扰

---

### 5. 渲染 Mermaid

```js
mermaid.initialize({
    startOnLoad: false,
    theme: getTheme()
});

mermaid.init(undefined, document.querySelectorAll('.mermaid'));
```

为什么不用自动加载？

👉 因为 DOM 是动态生成的

---

### 6. 防止重复渲染

```js
if (codeBlock.dataset.mermaidDone) return;
```

👉 防止：

* PJAX 重复执行
* 多次渲染报错

---

### 7. 适配 PJAX（关键）

```js
document.addEventListener('pjax:complete', run);
```

👉 没有这行：

❌ 翻页后 Mermaid 全部失效

---

## 六、主题适配（暗黑模式）

```js
function getTheme() {
    if (document.body.classList.contains('dark')) {
        return 'dark';
    }
    return 'default';
}
```

👉 自动跟随主题切换

---

## 七、为什么这个方案最稳？

对比一下：

| 方案             | 稳定性 | 原因       |
| -------------- | --- | -------- |
| 后端正则替换         | ❌   | 依赖 HTML  |
| 修改 Markdown 解析 | ❌   | 被主题覆盖    |
| 前端接管（本方案）      | ✅   | 直接操作 DOM |

---

## 八、核心设计思想

这次优化本质上是一次“架构调整”：

### 1️⃣ 不和主题抢控制权

JOE 已经接管了渲染链：

👉 你再插手，只会冲突

---

### 2️⃣ 前端才是最终执行层

只要页面上存在：

```html
language-mermaid
```

👉 就一定能识别

---

### 3️⃣ 幂等设计

```js
data-mermaidDone
```

👉 保证多次执行不会出问题

---

## 九、最终效果

* ✅ 支持所有 Mermaid 图
* ✅ 支持 PJAX
* ✅ 不受代码高亮影响
* ✅ 自动暗黑模式
* ✅ 主题无关（通用）

---

## 十、一句话总结

> 与其试图修补被主题打乱的 HTML，不如直接绕过它，在前端重建渲染链。

---

## 十一、源码附上



:::collapse{label="过长，已折叠，点击查看"}
```js
<?php
if (!defined('__TYPECHO_ROOT_DIR__')) exit;

/**
 * Mermaid 插件（JOE终极兼容版 / 前端解析）
 *
 * @package MermaidUltimate
 * @version 2.0.0
 */
class Mermaid_Plugin implements Typecho_Plugin_Interface
{
    public static function activate()
    {
        Typecho_Plugin::factory('Widget_Archive')->header = array('Mermaid_Plugin', 'header');
        Typecho_Plugin::factory('Widget_Archive')->footer = array('Mermaid_Plugin', 'footer');
    }

    public static function deactivate() {}

    public static function config(Typecho_Widget_Helper_Form $form)
    {
        $cdn = new Typecho_Widget_Helper_Form_Element_Text(
            'cdn',
            null,
            'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js',
            _t('Mermaid CDN'),
            _t('推荐 jsdelivr 或 npmmirror')
        );
        $form->addInput($cdn);

        $theme = new Typecho_Widget_Helper_Form_Element_Select(
            'theme',
            array(
                'default' => 'Default',
                'dark'    => 'Dark',
                'forest'  => 'Forest',
                'neutral' => 'Neutral',
            ),
            'default',
            _t('主题'),
            _t('Mermaid 渲染主题')
        );
        $form->addInput($theme);

        $autoDark = new Typecho_Widget_Helper_Form_Element_Radio(
            'autoDark',
            array(
                '1' => '开启',
                '0' => '关闭'
            ),
            '1',
            _t('自动暗黑模式'),
            _t('根据 JOE 主题自动切换')
        );
        $form->addInput($autoDark);
    }

    public static function personalConfig(Typecho_Widget_Helper_Form $form) {}

    public static function header()
    {
        echo '<style>
        .mermaid-container {
            text-align: center;
            margin: 1em 0;
        }
        </style>';
    }

    public static function footer()
    {
        $options  = Helper::options()->plugin('Mermaid');
        $cdn      = $options->cdn ?: 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
        $theme    = $options->theme ?: 'default';
        $autoDark = $options->autoDark;

        echo <<<HTML
<script src="{$cdn}"></script>
<script>
(function () {

    function getTheme() {
        if ({$autoDark} == 1) {
            if (document.documentElement.classList.contains('dark') ||
                document.body.classList.contains('dark')) {
                return 'dark';
            }
        }
        return '{$theme}';
    }

    function convertMermaid() {
        // 找到所有 mermaid 代码块
        const blocks = document.querySelectorAll(
            'pre code.language-mermaid, pre.language-mermaid'
        );

        blocks.forEach(function(codeBlock) {

            // 防重复处理
            if (codeBlock.dataset.mermaidDone) return;
            codeBlock.dataset.mermaidDone = "1";

            let code = codeBlock.textContent;

            // 创建容器
            const container = document.createElement('div');
            container.className = 'mermaid-container';

            const mermaidDiv = document.createElement('div');
            mermaidDiv.className = 'mermaid';
            mermaidDiv.textContent = code;

            container.appendChild(mermaidDiv);

            // 替换整个 pre
            let pre = codeBlock.closest('pre');
            if (pre) {
                pre.replaceWith(container);
            } else {
                codeBlock.replaceWith(container);
            }
        });
    }

    function renderMermaid() {
        if (typeof mermaid === 'undefined') {
            console.warn('Mermaid not loaded');
            return;
        }

        try {
            mermaid.initialize({
                startOnLoad: false,
                theme: getTheme()
            });

            mermaid.init(undefined, document.querySelectorAll('.mermaid'));

        } catch (e) {
            console.error('Mermaid error:', e);
        }
    }

    function run() {
        convertMermaid();
        renderMermaid();
    }

    // 首次加载
    document.addEventListener('DOMContentLoaded', run);

    // JOE PJAX
    document.addEventListener('pjax:complete', function () {
        run();
    });

})();
</script>
HTML;
    }
}
```
:::



## 十二、使用方法：
把这个文件放到：
```bash
/usr/plugins/Mermaid/Plugin.php
```
进入 Typecho 后台： `控制台 → 插件 → 启用 Mermaid` 
写文章时使用 Mermaid就直接在 Markdown 里写：
![](https://tc.andy-y.cn/i/2026/04/05/69d24faf4bde7.png)
发布后就会自动渲染成图。



