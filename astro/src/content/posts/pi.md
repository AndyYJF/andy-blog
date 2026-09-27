---
slug: pi
kind: post
title: 我的Pi使用技巧
legacyCid: 90
canonicalPath: /posts/pi/
commentKey: /posts/pi/
feedGuid: urn:andy-y:post:90
allowComment: true
allowFeed: true
pubDate: '2026-08-25T13:24:00.000Z'
updatedDate: '2026-08-26T12:48:22.000Z'
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
description: There are many agent harnesses, but this one is yours. ---
cover: https://tc.andy-y.cn/i/2026/08/25/6a8d97866e3c2.png
---

> There are many agent harnesses, but this one is yours.
---

这是我打开 [Pi](https://pi.dev/) 看到的第一句话。
而这即是Pi的核心哲学：本体清量，依靠插件和拓展进行强化和功能延伸、

# 介绍

 [Pi](https://pi.dev/) 是一个极简的Agent框架，和其他闭源Agent不同，你可以像俄罗斯方块一样自己搭建和完善他，这使得Pi在极省Token（原版系统提示词不足1000Token）的情况下仍然有很好的个性化特性。

 默认下Pi只有四个动作：read / write / edit / bash，他的其余能力靠两层叠加：Skill和Extension。

 关于Skill我就不多介绍了，毕竟所有Agent都有，但是 **Extension** 则是Pi的灵魂所在，其本质是一个 **TypeScript** 模块，启动Pi时即加载，通过 **注册工具、命令、快捷键、拦截事件** 来增强Pi的功能。

 Pi还有一个优点，如果你买了Coding Plan，你可以使用Pi的 `/login` 命令轻松登录你的Coding Plan账户，现已支持的包括如下几个：
  ![login支持](https://tc.andy-y.cn/i/2026/08/25/6a8d910eca0fd.png)

# 安装

推荐使用npm安装：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

# 登录

对于上述Pi已支持的Coding Plan，你可以直接使用 `/login` 直接登录。

而对于纯api和其他Plan，我推荐使用 [这个项目](https://github.com/Qihuanxishini/pi-model-manager) 进行配置：

我推荐从npm安装：
```bash
pi install npm:pi-model-manager
```
1. 启动 Pi TUI。
2. 执行：
```bash
/model-manager
```
3. 在主面板中管理接入：

| 按键 | 操作 |
| --- | --- |
| `Enter` | 进入所选接入并管理模型 |
| `N` | 新建接入及其第一个模型 |
| `D` | 删除所选接入 |
| `H` | 管理可复用请求头 |
| `L` | 切换界面语言（简体中文 / English），选择后立即生效并持久保存 |
| `/` | 搜索当前列表；`Tab` 退出输入但保留过滤，`Esc` 清空 |
| `Esc` | 返回或退出 |

---

保存会更新并启用模型，但不会强制切换当前会话正在使用的模型。

# 启动：
 ```bash
   pi          # 新会话
   pi -c       # 继续最近一次会话
   pi -r       # 从历史里选择
 ```

 ---

# 扩展推荐

接下来就是重头戏了，Pi的拓展！

## 本地扩展

这些**不是**npm包，不能 `pi install`。文件放到 `~/.pi/agent/extensions/` 即加载。官方样板在 `@earendil-works/pi-coding-agent` 的 `examples/extensions/`。

| 扩展 | 功能 | 安装 |
|------|--------|------|
| `confirm-destructive.ts` | `/new`、`/resume`、`/fork` 前弹确认，避免误清会话或误分叉。 | 复制到 `~/.pi/agent/extensions/confirm-destructive.ts` |
| `dirty-repo-guard.ts` | 工作区有未提交改动时，阻止切会话 / 新建 / fork，除非你明确继续。 | 复制到 `~/.pi/agent/extensions/dirty-repo-guard.ts` |
| `windows-bash-path.ts` | 检查 Git Bash 是否存在且 `settings.json` 的 `shellPath` 有效，并在状态栏显示路径；不抢注 `bash` 工具。 | 复制到 `~/.pi/agent/extensions/windows-bash-path.ts`（本机自写） |
| `tools.ts` | 提供 `/tools`，交互开关模型可用工具，选择写入当前会话分支。 | 复制到 `~/.pi/agent/extensions/tools.ts` |
| `structured-output.ts` | 注册 `structured_output`：需要机器可读摘要时作为最后一步调用并结束本轮。 | 复制到 `~/.pi/agent/extensions/structured-output.ts` |

---

## 推荐的安装包

### 界面

| 包 | 功能 | 入口 | 安装 |
|----|--------|------|------|
| `pi-cc-extensions` | 类 Claude Code 的工具卡片、diff、思考块，以及 `/context` 上下文检查。 | `/ccstyle` `/context` `/theme` | `pi install npm:pi-cc-extensions` |
| `pi-open-tui` | 页眉页脚、Git 状态、TPS/TTFT 等终端装饰与设置。 | `/open-tui` | `pi install npm:pi-open-tui` |
| `pi-tool-display` | 把 `read`/`edit`/`write`/`bash` 等工具输出收成紧凑卡片，并加强 diff。 | 自动生效 | `pi install npm:pi-tool-display` |
| `@firstpick/pi-themes-bundle` | 一批现成亮暗主题（Catppuccin、Dracula、Tokyo Night、Nord 等）。 | `/settings` 或 `/theme` | `pi install npm:@firstpick/pi-themes-bundle` |
| `@m64/pi-remembra-theme` | Remembra 风格的深紫蓝暗色主题。 | `/theme` | `pi install npm:@m64/pi-remembra-theme` |

我比较喜欢的主题是：`cc-dark`（来自 `pi-cc-extensions`）。TUI 模式：`regular`。界面风格和 Claude Code 很像

### 编码与审查

| 包 | 功能 | 入口 | 安装 |
|----|--------|------|------|
| `@juicesharp/rpiv-todo` | 给模型一份钉在输入框上方的任务清单，重载和压缩后仍在。 | `todo` `/todos` `Ctrl+Shift+T` | `pi install npm:@juicesharp/rpiv-todo` |
| `@juicesharp/rpiv-ask-user-question` | 有分歧时弹最多 4 题的 TUI 问卷，避免模型擅自做选择。 | `ask_user_question` | `pi install npm:@juicesharp/rpiv-ask-user-question` |
| `@gotgenes/pi-subagents` | 在同一进程里拉起隔离的子代理，可前台、后台、中途转向。 | `subagent` `/subagents:sessions` | `pi install npm:@gotgenes/pi-subagents` |
| `pi-simplify` | 只审已改行，让代码更清楚，不改外部行为。 | `/simplify` `[--staged]` | `pi install npm:pi-simplify` |
| `pi-slopchop` | 终端里批注 diff（FIX / DISCUSS），回填到编辑器，不自动发送。 | `/slopchop` `/diff` | `pi install npm:pi-slopchop` |
| `pi-workspace-history` | 聊天树和工作区文件一起回退，相当于工作区时间机器。 | `/undo` `/redo` `/checkpoint` | `pi install npm:pi-workspace-history` |
| `pi-rtk-optimizer` | 压缩嘈杂的 bash/read/grep 输出，必要时把命令改写成 `rtk`。 | `/rtk` | `pi install npm:pi-rtk-optimizer` |

### 搜索与外部世界

| 包 | 功能 | 入口 | 安装 |
|----|--------|------|------|
| `@ff-labs/pi-fff` | 用 FFF 替换内置 find/grep：模糊匹配、按使用频率排序、无子进程。 | `fffind` `ffgrep` `@` 补全 | `pi install npm:@ff-labs/pi-fff` |
| `@firstpick/pi-extension-brave-search` | 用 Brave Search API 搜当前网页，适合要原始结果列表时。 | `/brave-search-setup` | `pi install npm:@firstpick/pi-extension-brave-search` |
| `pi-mcp-adapter` | 按需发现和调用 MCP，不把全部工具定义灌进上下文。 | `/mcp` `mcp` `mcpScript` | `pi install npm:pi-mcp-adapter` |

我已接入的 MCP：`chrome-devtools`（控浏览器）、`searchcode`（搜公开仓库代码）。

### 长任务与记忆 {#long-running}

| 包 | 功能 | 入口 | 安装 |
|----|--------|------|------|
| `pi-until-done` | 把一句话目标变成锁死契约 + 任务清单，做到法官模型点头才算完。 | `/until-done` | `pi install npm:pi-until-done` |
| `pi-autoresearch` | 在 git 分支上自动试想法、测指标、好的留下、差的回滚。 | `/autoresearch` | `pi install npm:pi-autoresearch` |
| `pi-observational-memory` | 同一会话内记住决策和约束，减轻压缩失忆；**换会话不会带走**。 | `/om:status` `/om:view` | `pi install npm:pi-observational-memory` |
| `@pi-unipi/notify` | 长任务结束或关键错误时发桌面 / Gotify / Telegram / ntfy 通知。 | `notify_user` | `pi install npm:@pi-unipi/notify` |
| `@narumitw/pi-btw` | 开一条旁路问答，默认不进主对话，需要时再摘回主线。 | `/btw` | `pi install npm:@narumitw/pi-btw` |

---

## 一次装齐我推荐的包

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

装完无需重启 Pi，只要 `/reload`。

---

## 相关命令

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

# 小提示

如果是使用 Pi + Windows Terminal 的用户，可能会遇到窗口滚动条忽然跳到顶部的 bug。
Pi 社区说是 Windows Terminal 的渲染问题，不会做特殊处理，要等 Windows Terminal 修复。

# 最终效果

 ![效果图](https://tc.andy-y.cn/i/2026/08/25/6a8d96808a89d.png)

# 参考文献：
1.  [Pi Agent 快速上手教程以及扩展推荐](https://linux.do/t/topic/2637702)
2.   [pi-model-manager-README.md](https://github.com/Qihuanxishini/pi-model-manager/blob/main/README.md)  
