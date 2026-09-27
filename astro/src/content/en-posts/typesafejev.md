---
slug: typesafejev
kind: post
locale: en
title: Testing and Integrating TypeSafe's New Decision Model Jev
legacyCid: 105
canonicalPath: /en/posts/typesafejev/
commentKey: /posts/typesafejev/
feedGuid: urn:andy-y:post:105#en
allowComment: true
allowFeed: true
pubDate: '2026-09-26T15:11:31.000Z'
updatedDate: '2026-09-26T15:11:31.000Z'
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
sourceCid: 105
sourceRevision: 1
sourcePublishedAt: '2026-09-20T14:53:00.000Z'
translationVersionId: 24
translationStatus: current
translationAvailableAt: '2026-09-26T15:11:31.000Z'
description: This post explores TypeSafe's decision model Jev, designed for fast, structured, low-latency judgments. The author tests its reliability, integrates it into a campus notification filtering plugin, and shares practical insights on threshold selection and cost optimization.
cover: https://tc.andy-y.cn/i/2026/09/20/6aaff359954b2.png
---

# Background
Recently, a model has been getting quite popular online: TypeSafe's model [Jev](https://docs.typesafe.ai/introduction). This is not an ordinary conversational model, but one designed to help you make "decisions." Its official website introduces it as:
> System One Model, emphasizing fast, focused judgment rather than long reasoning and text generation.
---
What does this mean? With traditional LLMs, users typically input a piece of text and the LLM returns a response. Jev, however, operates by **inputting the current state → asking several predefined questions → returning options / scores / probabilities**. Taking a `Noul` type call as an example, it's like you input:
```json
{
  "urgency": {
    "type": "noul",
    "instructions": "Does this message express urgency?"
  }
}
```
Jev will output such structured results in a **very short time** (really fast!):
```json
...
    "is_urgent": {
      "type": "noul",
      "noul": 1.0  //直接返回量化的可能性（概率）
    }
  },
...
```
Or a `Choice` type call:
Input:
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
Or a `Score` type call:
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

# Advantages and Boundaries

This model differs from other LLMs in three main ways:

1.  **Fixed format**: Its returned results are **strictly structured**, making this model extremely suitable for automation tasks. You could of course use system prompts to make regular LLMs output structured data as well, but that brings us to Jev's next advantage.
2.  **Real-time response**: Why emphasize real-time? Because standard LLM responses are at best in seconds, whereas Jev achieves millisecond-level speeds: even when tested under mainland China's network conditions, I got responses in an average of about **300ms**.
3.  **Low cost**: The input price is currently $0.042 / 1 million tokens, and output is **not billed additionally**.
4.  ~~By the way, wouldn't LLM providers use similar tech for routing operations?~~

Currently, its boundaries are also very clear:
1. A claim on their official website is worth mentioning here:

> Zero hallucinations

Personally, I don't think this means true "zero hallucination," but rather that it will not output anything outside the schema. The final judgment result—that number or the option returned via a Choice call—can still be wrong. Before replacing an existing pipeline, I recommend running a benchmark against past data to determine the **threshold** (I will share my own practical experience later).

2. Currently, the model is still in early development and does not support image inputs—only plain text.

3. For tasks requiring human-readable text output, Jev is obviously not suitable.

# Project Practice and Integration

I tested it in one of my real-world projects: a [campus affairs summary plugin](https://github.com/AndyYJF/astrbot_plugin_campus_inbox). In this project, there is a gatekeeper that monitors QQ messages and determines whether they are noise like casual chat or actionable notifications—right in Jev's sweet spot.

## Reliability Testing

I had an AI run a reliability test using my historical data and judgment results. Here are the results:

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

As we can see, for my project, Jev offers extremely high efficiency and acceptable accuracy in determining whether a message is affairs-related. ~~Unfortunately, the model currently doesn't accept image inputs, so I still use a VLM for image messages.~~

## Integration

The integration point is placed **before LLM extraction**: a message debounce mechanism gathers a batch of new messages and passes them through Jev one by one, calling the noul method for scoring. Messages below the threshold are directly archived, and only genuine affairs messages are sent to the large language model for extraction.

Here is how I designed the prompt/instructions:

```python
_INSTRUCTIONS = (
    "这条大学校园群消息是否包含与学业或校园事务相关的信息？"
    "算1的包括：正式通知、作业布置、截止日期、活动安排、官方公告，"
    "以及对这类事项的补充说明、要求提醒、更正（即使语气随意像聊天）。"
    "完全无关的纯闲聊、表情包、寒暄、灌水、晒图才算0。"
   )
```

The core logic is as follows:

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

Then I had the AI perform a real production API smoke test in a container: casual chat scored 0.04 (blocked), while genuine affairs scored 0.99 (passed). Compared to the price of gemini-3.8-flash that I was previously using, each batch of group messages saves more than a third of extraction calls on average, costing less than 1 cent per day.

The open-source repository is available for [viewing](https://github.com/AndyYJF/astrbot_plugin_campus_inbox).

# Final Thoughts
 ![Usage](https://tc.andy-y.cn/i/2026/09/20/6aaff104abbab.png)
My takeaway after using it is: "decision models" like Jev are not here to replace LLMs; instead, they fill in the most cost-ineffective link in LLM pipelines—**high-frequency, low-latency judgments with fixed answer structures**.

You can visit [here](https://awesomejev.com/) to discover more projects built on Jev~

Finally, here is the advice AI gave me:

> Don't rush into refactoring everything. First, find that "overkill" judgment node in your system, run a benchmark with historical data (like sweeping across thresholds as I did above), and only switch over if the numbers look good. Decision models ultimately output probabilities; **where you set the threshold, and whether you fail-open or fail-close, determines the production experience far more than the model itself**.

---

# References:
1. [TypeSafe Official Documentation](https://docs.typesafe.ai/introduction)



