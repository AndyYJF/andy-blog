---
slug: typesafejev
kind: post
title: TypeSafe新决策模型Jev试水与接入
legacyCid: 105
canonicalPath: /posts/typesafejev/
commentKey: /posts/typesafejev/
feedGuid: urn:andy-y:post:105
allowComment: true
allowFeed: true
pubDate: '2026-09-20T14:53:00.000Z'
updatedDate: '2026-09-22T06:55:13.000Z'
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
description: 最近在网上有个模型很火：TypeSafe家的模型 Jev 。这不是一个普通的对话式模型，是一个类似帮你“决策”的模型，官网对他的介绍是： System One Model（系统一模型），强调快速、聚焦的判断，而不是长时间推理和文字生成。 --- 什么意思呢？…
cover: https://tc.andy-y.cn/i/2026/09/20/6aaff359954b2.png
---

# 背景
最近在网上有个模型很火：TypeSafe家的模型 [Jev](https://docs.typesafe.ai/introduction) 。这不是一个普通的对话式模型，是一个类似帮你“决策”的模型，官网对他的介绍是：
> System One Model（系统一模型），强调快速、聚焦的判断，而不是长时间推理和文字生成。
---
什么意思呢？传统的llm一般是用户输入一段内容，LLM返回结果，而Jev则是 **输入当前状态 state → 提出几个定义好的问题 → 返回选项 / 分数 / 概率**  ，拿 `Noul` 类型调用举例，类似你输入：
```json
{
  "urgency": {
    "type": "noul",
    "instructions": "Does this message express urgency?"
  }
}
```
Jev则会在 **很短的时间** （真的很快！）输出这样的结构化结果：
```json
...
    "is_urgent": {
      "type": "noul",
      "noul": 1.0  //直接返回量化的可能性（概率）
    }
  },
...
```
或者是 `Choice` 型调用：
Input：
```json
{
  "state": "用户报告：付款成功后订单仍显示未支付。",
  "model": "jev-latest",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "这个问题应该由哪个团队处理？",
      "criteria": {
        "billing": "支付、扣款、退款或账单问题",
        "technical": "软件错误或系统故障",
        "sales": "购买咨询、价格或套餐问题"
      }
    }
  }
}
```
Output
```json
{
  "model": "jev-1.13.0",
  "answers": {
    "department": {
      "type": "choice",
      "choice": "billing",
      "confidence": 0.91,
      "probabilities": {
        "billing": 0.94,
        "technical": 0.06,
        "sales": 0.0
      }
    }
  },
  "usage": {
    "input_tokens": 173,
    "output_tokens": 34
  }
}
```
或者是 `Score` 类型调用：
Input
```json
{
  "state": "导出按钮无法使用，但用户仍然可以通过复制数据手动完成导出。",
  "model": "jev-latest",
  "questions": {
    "severity": {
      "type": "score",
      "instructions": "评估这个软件问题的严重程度。",
      "criteria": [
        "轻微问题，不影响正常使用",
        "部分功能不可用，但存在替代方案",
        "关键功能不可用，并且没有替代方案"
      ]
    }
  }
}
```
Output
```json
{
  "model": "jev-1.13.0",
  "answers": {
    "severity": {
      "type": "score",
      "score": 1.08,
      "confidence": 0.84,
      "legend": {
        "0": "轻微问题，不影响正常使用",
        "1": "部分功能不可用，但存在替代方案",
        "2": "关键功能不可用，并且没有替代方案"
      },
      "probabilities": {
        "0": 0.0,
        "1": 0.92,
        "2": 0.08
      }
    }
  },
  "usage": {
    "input_tokens": 182,
    "output_tokens": 42
  }
}
```

# 优势与边界

这个模型和其他LLM不同的有三点：

1.  **固定格式** ：其返回的结果是 **固定结构化** 的，所以这个模型非常适合来做一些自动化任务，你当然使用system prompt让普通LLM也进行这种结构化输出，但是这就要讲到jev的下一个优势了。
2.  **及时响应** ：为什么要强调即时呢？这是因为，一般的LLM响应最快也在秒级，而Jev可以做到毫秒级：在我于中国大陆网络环境下测试也平均在约 **300ms** 时得到答案。
3.  **价格便宜** ：输入价格目前为 $0.042 / 100 万 tokens，输出 **不另外计费**
4.  ~~话说大模型厂商不会用类似的技术进行路由操作吧~~

目前边界也很明确
1. 这里要提到其官网上的一个说辞：

> Zero hallucinations

我个人认为这并不是意味着所谓“0幻觉”，而是说不会输出schema以外的东西，而最终决断的结果，也就是那串数字或者于Choice方式调用返回的选择也可能会出错，我建议在替换现有结构之前先拿旧的数据跑一遍对照，找找 **阈值** （后面会提到我个人的小小实践）

2. 目前这个模型还在开发初期，并不支持图片输入，只支持纯文本

3. 对于需要输出可读性文本的任务，jev显然无法胜任

# 项目实践与接入

我在一个我自己的真实项目里测试了一下，这是一个 [校园事务总结插件](https://github.com/AndyYJF/astrbot_plugin_campus_inbox) ，项目里面有个门控是监控QQ消息，并判断是属于闲聊等噪声还是通知类信息，这就来到了Jev的优势区间了。

## 可靠性测试

我让ai拿着我过去的数据和决断结果进行了可靠性测试，结果如下：

```txt
 验证结果（837 条真实消息，0 调用失败）

 推荐配置：阈值 0.3 + [图片]占位消息直通 LLM
 - 误杀通知：0 条（召回率 100%，门卫的核心指标）
 - LLM 提取调用量 降 37%（527/837 送提取）
 - Jev 自身成本：837 条共 $0.014，延迟 p50=304ms、p95=784ms

 ┌─────────────┬────────┬──────┬─────────────┐
 │ 阈值         │ 召回率 │ 误杀 │ 省 LLM 调用  │
 ├─────────────┼────────┼──────┼─────────────┤
 │ 0.3（推荐）  │ 100%   │ 0    │ 37%         │
 ├─────────────┼────────┼──────┼─────────────┤
 │ 0.4         │ 99.1%  │ 2    │ 43%         │
 ├─────────────┼────────┼──────┼─────────────┤
 │ 0.5         │ 96.2%  │ 8    │ 47%         │
 └─────────────┴────────┴──────┴─────────────┘
```

可见，对于我这个项目，在判断是否为事务类消息时，jev有着极高的效率和可接受的精准度， ~~可惜模型目前不接受图片输入，在判断图片类消息时我还是走的VLM~~

## 接入

接入点选在 **LLM 提取之前**：通过一个消息防抖机制攒一批新消息，逐条过Jev，调用noul 方法打分，低于阈值的就直接归档，只有真正的事务消息才送给大模型提取。

我这样做问法设计：

```python
_INSTRUCTIONS = (
    "这条大学校园群消息是否包含与学业或校园事务相关的信息？"
    "算1的包括：正式通知、作业布置、截止日期、活动安排、官方公告，"
    "以及对这类事项的补充说明、要求提醒、更正（即使语气随意像聊天）。"
    "完全无关的纯闲聊、表情包、寒暄、灌水、晒图才算0。"
   )
```

核心逻辑如下：

```python
def split(self, messages):
    """返回 (送 LLM 的消息, 被拦截的消息)"""
    passed, dropped = [], []
    for msg in messages:
        if msg["parse_state"] != "text":
            passed.append(msg)            # 含图/文件：直通走 VLM
            continue
        score = self._score(msg["text"])  # 调用失败返回 1.0
        (passed if score >= 0.3 else dropped).append(msg)
    return passed, dropped
```

然后我让AI在容器里做了生产环境的真实API冒烟：闲聊消息0.04分（拦截）、真正事务0.99分（放行），根据和我原来用的gemini-3.8-flash的价格对比，每批群消息平均省下三分之一多的提取调用，成本每天不到 1 美分。

开源仓库可供 [查看](https://github.com/AndyYJF/astrbot_plugin_campus_inbox)

# 写在最后
 ![用量](https://tc.andy-y.cn/i/2026/09/20/6aaff104abbab.png)
用下来我的感受是：Jev这类"决策模型"不是来替代LLM的，而是补上了LLM管道里最不划算的一环——**高频、需求低延迟、答案结构固定的判断**。

大家可以访问 [这里](https://awesomejev.com/) 找到更多基于Jev构建的项目~

最后，这是AI给我的建议：

> 不用急着重构什么，先找到你系统里那个"大材小用"的判断节点，拿历史数据跑一次对照评测（像我上面那样扫一遍阈值），数字好看再切。决策模型给出的毕竟是概率，**阈值选在哪
 、fail-open 还是 fail-close，比模型本身更决定线上体验**。

---

# 参考文献：
1. [TypeSafe官方文档](https://docs.typesafe.ai/introduction)



