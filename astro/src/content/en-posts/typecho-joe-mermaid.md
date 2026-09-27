---
slug: typecho-joe-mermaid
kind: post
locale: en
title: A Solution for Mermaid Rendering Under Typecho + JOE Theme
legacyCid: 47
canonicalPath: /en/posts/typecho-joe-mermaid/
commentKey: /posts/typecho-joe-mermaid/
feedGuid: https://www.andy-y.cn/index.php/archives/47/#en
allowComment: false
allowFeed: true
pubDate: '2026-09-26T15:11:46.000Z'
updatedDate: '2026-09-26T15:11:46.000Z'
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
sourceCid: 47
sourceRevision: 1
sourcePublishedAt: '2026-04-05T12:04:00.000Z'
translationVersionId: 21
translationStatus: current
translationAvailableAt: '2026-09-26T15:11:46.000Z'
description: This article presents a robust solution for rendering Mermaid diagrams in Typecho with the JOE theme. By bypassing backend HTML regex replacement and handling rendering entirely on the frontend, it reliably resolves conflicts with custom code highlighting and PJAX page navigation.
cover: https://tc.andy-y.cn/i/2026/08/14/6a7f231013080.png
---

Note before reading: As the author currently **does not have much ability to write code or even scripts**, this article was **generated directly by AI** after AI and I solved this issue together. If you find this off-putting, you can **close this post** right now (~~I'm useless~~)

## 1. Problem Background

Using Mermaid in Typecho has never been particularly difficult, but once switched to the JOE theme, things start to get complicated:

* Written ` ```mermaid ` code blocks are treated as normal code and highlighted
* The plugin is clearly enabled, but charts do not render
* After page navigation (PJAX), Mermaid breaks completely

At first, I also tried conventional approaches (regex replacement of HTML), only to find:

👉 **It is completely unstable**

---

## 2. Essence of the Problem

The JOE theme introduces many "enhancements," including:

* Custom syntax highlighting (Prism / Highlight.js)
* Rewriting Markdown output structure
* Using PJAX (partial page updates)

This leads to a core problem:

> **The HTML you generate on the backend is very likely modified or even overwritten again on the frontend**

For example, what you expect is:

```html
<pre><code class="language-mermaid"></code></pre>
```

But in reality it might turn into:

```html
<pre class="language-mermaid"></pre>
```

Or even:

```html
<div class="joe_code">
  <pre>...</pre>
</div>
```

👉 **Unstable structure → regex will inevitably fail**

---

## 3. Why Do Traditional Approaches Fail?

Common plugin logic:

```text
Markdown → HTML → 正则替换 → <pre class="mermaid">
```

The problem lies in:

* Relying on HTML structure (unreliable)
* Easily overwritten by themes
* Does not re-execute after PJAX

Conclusion:

> **Modifying HTML on the backend is the wrong direction under an aggressive theme like JOE**

---

## 4. The Final Solution: Frontend Takeover

What I ended up adopting:

> ✅ **Completely bypass the backend and dynamically parse Mermaid on the frontend**

Core workflow:

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

## 5. Core Implementation Breakdown

### 1. Scanning Code Blocks

```js
const blocks = document.querySelectorAll(
    'pre code.language-mermaid, pre.language-mermaid'
);
```

Why write it this way?

👉 Compatible with both structures:

```html
<pre><code class="language-mermaid"></code></pre>
```

```html
<pre class="language-mermaid"></pre>
```

---

### 2. Extracting Raw Code

```js
let code = codeBlock.textContent;
```

👉 Get the text directly without relying on HTML structure

---

### 3. Rebuilding the DOM

```js
const container = document.createElement('div');
container.className = 'mermaid-container';

const mermaidDiv = document.createElement('div');
mermaidDiv.className = 'mermaid';
mermaidDiv.textContent = code;

container.appendChild(mermaidDiv);
```

Final structure:

```html
<div class="mermaid-container">
  <div class="mermaid">...</div>
</div>
```

---

### 4. Replacing the Original Code Block

```js
pre.replaceWith(container);
```

👉 Key points:

* Delete the original syntax highlighting DOM
* Prevent further interference from the theme

---

### 5. Rendering Mermaid

```js
mermaid.initialize({
    startOnLoad: false,
    theme: getTheme()
});

mermaid.init(undefined, document.querySelectorAll('.mermaid'));
```

Why not use autoloading?

👉 Because the DOM is dynamically generated

---

### 6. Preventing Duplicate Rendering

```js
if (codeBlock.dataset.mermaidDone) return;
```

👉 Prevents:

* Duplicate execution on PJAX
* Errors caused by multiple renders

---

### 7. Adapting to PJAX (Crucial)

```js
document.addEventListener('pjax:complete', run);
```

👉 Without this line:

❌ Mermaid fails completely after page navigation

---

## 6. Theme Adaptation (Dark Mode)

```js
function getTheme() {
    if (document.body.classList.contains('dark')) {
        return 'dark';
    }
    return 'default';
}
```

👉 Automatically follows theme switching

---

## 7. Why Is This Solution the Most Robust?

Comparison:

| Solution | Stability | Reason |
| -------------- | --- | -------- |
| Backend regex replacement | ❌ | Relies on HTML |
| Modifying Markdown parsing | ❌ | Overwritten by theme |
| Frontend takeover (this solution) | ✅ | Directly manipulates DOM |

---

## 8. Core Design Philosophy

This optimization is essentially an "architectural adjustment":

### 1️⃣ Don't fight the theme for control

JOE has already taken over the rendering pipeline:

👉 If you intervene further, it will only conflict

---

### 2️⃣ The frontend is the final execution layer

As long as the page contains:

```html
language-mermaid
```

👉 It can definitely be recognized

---

### 3️⃣ Idempotent Design

```js
data-mermaidDone
```

👉 Guarantees multiple executions will not cause issues

---

## 9. Final Results

* ✅ Supports all Mermaid diagrams
* ✅ Supports PJAX
* ✅ Unaffected by code highlighting
* ✅ Automatic dark mode
* ✅ Theme-agnostic (universal)

---

## 10. One-Sentence Summary

> Instead of trying to patch HTML mangled by the theme, bypass it entirely and rebuild the rendering pipeline on the frontend.

---

## 11. Attached Source Code



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



## 12. Instructions:
Place this file at:
```bash
/usr/plugins/Mermaid/Plugin.php
```
Go to Typecho Admin: `控制台 → 插件 → 启用 Mermaid`
When writing an article, to use Mermaid simply write directly in Markdown:
![](https://tc.andy-y.cn/i/2026/04/05/69d24faf4bde7.png)
Once published, it will automatically render into a diagram.
