---
slug: pi
kind: post
locale: en
title: My Pi Usage Tips
legacyCid: 90
canonicalPath: /en/posts/pi/
commentKey: /posts/pi/
feedGuid: urn:andy-y:post:90#en
allowComment: true
allowFeed: true
pubDate: '2026-09-26T15:12:14.000Z'
updatedDate: '2026-09-26T15:12:14.000Z'
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
  - mid: 13
    name: 调优
    slug: refine
tags: []
sourceFormat: markdown
sourceCid: 90
sourceRevision: 1
sourcePublishedAt: '2026-08-25T13:24:00.000Z'
translationVersionId: 11
translationStatus: current
translationAvailableAt: '2026-09-26T15:12:14.000Z'
description: A practical guide to Pi, a minimalist and token-efficient AI agent framework. It covers installation, model management, and a curated set of local and package extensions to supercharge your terminal workflow.
cover: https://tc.andy-y.cn/i/2026/08/25/6a8d97866e3c2.png
---

> There are many agent harnesses, but this one is yours.
---

This was the first sentence I saw when I opened [Pi](https://pi.dev/).
And this is Pi's core philosophy: a lightweight core, relying on plugins and extensions for enhancement and feature expansion.

# Introduction

[Pi](https://pi.dev/) is a minimalist Agent framework. Unlike other closed-source Agents, you can build and refine it like Tetris blocks. This allows Pi to retain excellent personalization capabilities while being extremely token-efficient (the original system prompt is under 1,000 tokens).

By default, Pi only has four actions: read / write / edit / bash. The rest of its capabilities rely on two layers: Skills and Extensions.

I won't delve too much into Skills, as all Agents have them, but **Extensions** are where Pi's soul lies. An extension is essentially a **TypeScript** module loaded when Pi starts up, enhancing Pi's functionality by **registering tools, commands, keyboard shortcuts, and intercepting events**.

Pi has another advantage: if you purchased a Coding Plan, you can easily log into your Coding Plan account using Pi's `/login` command. The currently supported ones include:
  ![login support](https://tc.andy-y.cn/i/2026/08/25/6a8d910eca0fd.png)

# Installation

Recommended to install via npm:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

# Login

For the Coding Plans supported above, you can log in directly using `/login`.

As for pure APIs and other plans, I recommend configuring them with [this project](https://github.com/Qihuanxishini/pi-model-manager):

I recommend installing via npm:
```bash
pi install npm:pi-model-manager
```
1. Launch the Pi TUI.
2. Execute:
```bash
/model-manager
```
3. Manage providers in the main dashboard:

| Key | Action |
| --- | --- |
| `Enter` | Enter the selected provider and manage models |
| `N` | Create a new provider and its first model |
| `D` | Delete the selected provider |
| `H` | Manage reusable request headers |
| `L` | Toggle interface language (Simplified Chinese / English); takes effect immediately upon selection and persists |
| `/` | Search current list; `Tab` exits input while retaining filter, `Esc` clears |
| `Esc` | Back or exit |

---

Saving will update and enable the model, but will not force-switch the model currently in use by the active session.

# Launching:
 ```bash
   pi          # 新会话
   pi -c       # 继续最近一次会话
   pi -r       # 从历史里选择
 ```

 ---

# Recommended Extensions

Now for the main event: Pi's extensions!

## Local Extensions

These are **not** npm packages and cannot be installed via `pi install`. Files placed in `~/.pi/agent/extensions/` are loaded automatically. Official boilerplate examples can be found in `examples/extensions/` of `@earendil-works/pi-coding-agent`.

| Extension | Description | Installation |
|------|--------|------|
| `confirm-destructive.ts` | `/new`, `/resume`, `/fork` prompt for confirmation beforehand to avoid accidentally clearing a session or forking. | Copy to `~/.pi/agent/extensions/confirm-destructive.ts` |
| `dirty-repo-guard.ts` | Prevents switching sessions / creating new / forking when the workspace has uncommitted changes, unless explicitly continued. | Copy to `~/.pi/agent/extensions/dirty-repo-guard.ts` |
| `windows-bash-path.ts` | Checks if Git Bash exists and if `shellPath` in `settings.json` is valid, displaying the path in the status bar; does not override the `bash` tool. | Copy to `~/.pi/agent/extensions/windows-bash-path.ts` (written locally) |
| `tools.ts` | Provides `/tools` to interactively toggle available tools for the model, persisting choices to the current session branch. | Copy to `~/.pi/agent/extensions/tools.ts` |
| `structured-output.ts` | Registers `structured_output`: called as the final step and ends the current turn when a machine-readable summary is needed. | Copy to `~/.pi/agent/extensions/structured-output.ts` |

---

## Recommended Packages

### UI

| Package | Description | Entry Point | Installation |
|----|--------|------|------|
| `pi-cc-extensions` | Claude Code-like tool cards, diffs, thinking blocks, and `/context` inspection. | `/ccstyle` `/context` `/theme` | `pi install npm:pi-cc-extensions` |
| `pi-open-tui` | Header/footer, Git status, TPS/TTFT, and other terminal decorations and settings. | `/open-tui` | `pi install npm:pi-open-tui` |
| `pi-tool-display` | Collapses outputs from tools like `read`/`edit`/`write`/`bash` into compact cards and enhances diffs. | Active automatically | `pi install npm:pi-tool-display` |
| `@firstpick/pi-themes-bundle` | A bundle of ready-made light/dark themes (Catppuccin, Dracula, Tokyo Night, Nord, etc.). | `/settings` or `/theme` | `pi install npm:@firstpick/pi-themes-bundle` |
| `@m64/pi-remembra-theme` | Remembra-style deep purple-blue dark theme. | `/theme` | `pi install npm:@m64/pi-remembra-theme` |

My preferred theme is: `cc-dark` (from `pi-cc-extensions`). TUI mode: `regular`. The interface style is very similar to Claude Code.

### Coding & Review

| Package | Description | Entry Point | Installation |
|----|--------|------|------|
| `@juicesharp/rpiv-todo` | Gives the model a task list pinned above the input box, persisting across reloads and context compression. | `todo` `/todos` `Ctrl+Shift+T` | `pi install npm:@juicesharp/rpiv-todo` |
| `@juicesharp/rpiv-ask-user-question` | Pops up a TUI questionnaire of up to 4 questions when conflicts arise, preventing the model from making arbitrary choices. | `ask_user_question` | `pi install npm:@juicesharp/rpiv-ask-user-question` |
| `@gotgenes/pi-subagents` | Spawns isolated subagents within the same process, capable of foreground, background, or mid-task redirection. | `subagent` `/subagents:sessions` | `pi install npm:@gotgenes/pi-subagents` |
| `pi-simplify` | Reviews only modified lines to make code cleaner without altering external behavior. | `/simplify` `[--staged]` | `pi install npm:pi-simplify` |
| `pi-slopchop` | Annotates diffs in terminal (FIX / DISCUSS) and writes back to editor without auto-sending. | `/slopchop` `/diff` | `pi install npm:pi-slopchop` |
| `pi-workspace-history` | Rolls back chat trees and workspace files together, serving as a workspace time machine. | `/undo` `/redo` `/checkpoint` | `pi install npm:pi-workspace-history` |
| `pi-rtk-optimizer` | Compresses noisy bash/read/grep outputs, rewriting commands to `rtk` when necessary. | `/rtk` | `pi install npm:pi-rtk-optimizer` |

### Search & The Outside World

| Package | Description | Entry Point | Installation |
|----|--------|------|------|
| `@ff-labs/pi-fff` | Replaces built-in find/grep with FFF: fuzzy matching, sorted by frequency of use, no subprocesses. | `fffind` `ffgrep` `@` autocompletion | `pi install npm:@ff-labs/pi-fff` |
| `@firstpick/pi-extension-brave-search` | Searches the web using the Brave Search API, ideal when raw search results are needed. | `/brave-search-setup` | `pi install npm:@firstpick/pi-extension-brave-search` |
| `pi-mcp-adapter` | Discovers and invokes MCP on demand, without bloating context with all tool definitions. | `/mcp` `mcp` `mcpScript` | `pi install npm:pi-mcp-adapter` |

MCPs I have connected: `chrome-devtools` (browser control), `searchcode` (search public repository code).

### Long-running Tasks & Memory {#long-running}

| Package | Description | Entry Point | Installation |
|----|--------|------|------|
| `pi-until-done` | Turns a one-sentence goal into an airtight contract + checklist, looping until the judge model approves. | `/until-done` | `pi install npm:pi-until-done` |
| `pi-autoresearch` | Automatically tests ideas and evaluates metrics on a git branch—keeping what works, reverting what fails. | `/autoresearch` | `pi install npm:pi-autoresearch` |
| `pi-observational-memory` | Retains decisions and constraints within the same session to mitigate compression amnesia; **does not carry over across sessions**. | `/om:status` `/om:view` | `pi install npm:pi-observational-memory` |
| `@pi-unipi/notify` | Sends desktop / Gotify / Telegram / ntfy notifications upon long task completion or critical errors. | `notify_user` | `pi install npm:@pi-unipi/notify` |
| `@narumitw/pi-btw` | Opens a side channel for Q&A, kept out of the main conversation by default, merged back only when needed. | `/btw` | `pi install npm:@narumitw/pi-btw` |

---

## Install All Recommended Packages at Once

```text
pi install npm:pi-mcp-adapter
pi install npm:pi-open-tui
pi install npm:@firstpick/pi-themes-bundle
pi install npm:pi-workspace-history
pi install npm:@ff-labs/pi-fff
pi install npm:pi-tool-display
pi install npm:@firstpick/pi-extension-brave-search
pi install npm:pi-until-done
pi install npm:@juicesharp/rpiv-todo
pi install npm:pi-observational-memory
pi install npm:@m64/pi-remembra-theme
pi install npm:pi-simplify
pi install npm:pi-slopchop
pi install npm:pi-autoresearch
pi install npm:@gotgenes/pi-subagents
pi install npm:@narumitw/pi-btw
pi install npm:@pi-unipi/notify
pi install npm:@juicesharp/rpiv-ask-user-question
pi install npm:pi-cc-extensions
pi install npm:pi-rtk-optimizer
```

No need to restart Pi after installing; just run `/reload`.

---

## Related Commands

```text
/tools                         开关工具
/todos                         任务清单
/ccstyle                       Claude Code 风格
/open-tui                      页眉页脚
/context                       上下文占用
/theme                         换主题
/simplify [--staged] [文件]    简化已改代码
/slopchop  或  /diff           批注 diff
/undo  /redo  /checkpoint      工作区回退
/rtk                           输出压缩
/mcp                           MCP
/brave-search-setup            Brave API
/until-done <目标>             目标循环
/autoresearch                  实验仪表盘
/om:status  /om:view           会话记忆
/btw [问题]                    旁路问答
/subagents:sessions            子代理会话
```

---

# Tips

Users running Pi in Windows Terminal might encounter a bug where the window scrollbar suddenly jumps to the top.
The Pi community noted that this is a rendering issue with Windows Terminal and won't implement a special workaround; users will need to wait for Windows Terminal to fix it.

# Final Result

 ![Result preview](https://tc.andy-y.cn/i/2026/08/25/6a8d96808a89d.png)

# References:
1.  [Pi Agent Quick Start Guide and Extension Recommendations](https://linux.do/t/topic/2637702)
2.   [pi-model-manager-README.md](https://github.com/Qihuanxishini/pi-model-manager/blob/main/README.md)  
