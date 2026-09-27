---
slug: campus-ipv6-notes
kind: post
title: 校园网IPv6折腾札记
legacyCid: 104
canonicalPath: /posts/campus-ipv6-notes/
commentKey: /posts/campus-ipv6-notes/
feedGuid: urn:andy-y:post:104
allowComment: true
allowFeed: true
pubDate: '2026-09-16T13:24:32.000Z'
updatedDate: '2026-09-16T13:24:32.000Z'
categories:
  - mid: 1
    name: 所有文章
    slug: default
  - mid: 13
    name: 调优
    slug: refine
tags: []
sourceFormat: markdown
description: 校园网（CERNET）+ OpenWrt 25.12 + 一台 MT7621 老路由器。一天的折腾记录：IPv6 中继、SmartDNS 分流、DHCP 自愈、ZeroTier 组网、AdGuard Home、阿里云 DDNS，以及一个"入站 v6 死刑"的最终测试。
cover: https://tc.andy-y.cn/i/2026/09/16/6aaa987c88f2f.png
---

> 校园网（CERNET）+ OpenWrt 25.12 + 一台 MT7621 老路由器。一天的折腾记录：IPv6 中继、SmartDNS 分流、DHCP 自愈、ZeroTier 组网、AdGuard Home、阿里云 DDNS，以及一个"入站 v6 死刑"的最终测试。

## 背景

宿舍接的是川大校园网，出口走 CERNET。路由器是一台刷 OpenWrt 25.12 的 MT7621（256MB 内存，58MB 闪存），WAN 口 DHCP 拿 v4，Portal 网页认证由一个常驻 Python 脚本自动保活。

某天看了眼 PC 的 `ipconfig`，发现只有 `fde3:` 开头的 ULA 地址——IPv6 等于没有。于是开始折腾。

## 第一战：没有 PD，怎么让 LAN 拿到公网 v6

SSH 上路由器看 wan6：

```
inet6 2001:250:2003:8c07:d6da:21ff:fe15:9aee/64 scope global dynamic
```

地址有了，但 `ifstatus wan6` 里 `ipv6-prefix` 是空的——**校园网只给单个 /64 地址，不做前缀委派**。常规的路由模式（路由器拿 PD 再给 LAN 划分子网）用不了。

我的做法是中继模式：即让校园网路由器的 RA 透传到 LAN，客户端自己 SLAAC：

```bash
uci set dhcp.wan6.ra='relay'
uci set dhcp.wan6.dhcpv6='relay'
uci set dhcp.wan6.ndp='relay'
uci set dhcp.wan6.master='1'
uci set dhcp.lan.ra='relay'
uci set dhcp.lan.dhcpv6='relay'
uci set dhcp.lan.ndp='relay'
uci delete dhcp.lan.ra_flags   # 关键：去掉 lan 侧自己宣告前缀
uci commit dhcp && /etc/init.d/odhcpd restart
```

一分钟后 PC 拿到了 `2001:250:2003:8c07:8630:...` 的公网 v6，`ping -6 240c::6666` 通了。

**注意**：Windows 上别用 `ipconfig /renew6` 等 RA，在 Git Bash 里会卡死，SLAAC 自己会收。

## 第二战：教育网 DNS 吞 AAAA

v6 通了，但浏览器访问任何网站都走 v4。排查：

```bash
dig @202.115.39.9 AAAA ipv6.baidu.com +short
# 空。NOERROR，但 answer 为零。
```

川大 DNS（202.115.39.9/6）对**所有** AAAA 查询都返回空——清华、TUNA 镜像站、CERNET 官网，无一幸免。不是没记录，是被吞了。

但我不想放弃教育网 DNS：校内域名（`www.scu.edu.cn` → 211.83.x.x）只有它解析得对，而且教育网的 DNS 污染比公共 DNS 小。

解法：**SmartDNS 并发测速分流**。

```bash
apk add smartdns
```

```bash
uci set smartdns.@smartdns[0].port='6053'
uci set smartdns.@smartdns[0].ipv6_server='1'
uci set smartdns.@smartdns[0].dualstack_ip_selection='0'   # 后面细说这个坑
uci set smartdns.@smartdns[0].serve_expired='1'
# 上游：教育网 + 阿里 + 腾讯，v4/v6 混编
for s in 202.115.39.9 202.115.39.6 223.5.5.5 119.29.29.29 2400:3200::1 2400:3200:baba::1; do
  uci add_list smartdns.@smartdns[0].server="$s"
done
# dnsmasq 全部转给 smartdns
uci set dhcp.@dnsmasq[0].noresolv='1'
uci add_list dhcp.@dnsmasq[0].server='127.0.0.1#6053'
```

这样做的妙处在于：SmartDNS 并发问所有上游、取最快应答。教育网 DNS 对 AAAA 返回空，在测速中，缺陷变成了自动分流器。校内域名则只有教育网 DNS 能答，继续走它。

### 插曲：AAAA 还是空的

配完发现 SmartDNS 直接查 AAAA 依然为空。抓 log 逐层排，最后定位到 `dualstack_ip_selection`：SmartDNS 会 ping 双栈结果，v6 比 v4 慢 10ms 以上就**主动丢弃 AAAA**。baidu 的 v6 延迟 54ms vs v4 32ms，正好被毙。关掉即好。

## 第三战：断网与"赛博拔线"

晚上 10 点多，网突然没了。路由器 WAN 口 udhcpc 疯狂 discover，校园 DHCP 服务器（121.48.198.254，租期 4 小时）一个字不回。`ifdown/ifup`、手动 `udhcpc -r` 全部无效。

然后**拔插了一下网线，立刻拿到租约**。

根因是接入交换机的 DHCP snooping / port-security 绑定表卡死：端口安全状态机只记得旧的 binding，新 discover 直接被吞，而链路层 flap 会重置端口状态。

人不可能每天去拔线，那就让脚本拔：

```bash
# /usr/bin/wan-watchdog.sh，cron 每分钟
if ! ip -4 addr show dev wan | grep -q 'inet '; then
  # 连续 3 次失败才动作，避免误伤
  ...
  ip link set wan down; sleep 2; ip link set wan up  # 物理抖动 = 赛博拔线
  ifup wan
fi
```

实测：flap 后约 20 秒重新拿到 DHCP（12 秒不够，校园 DHCP 反应慢）。顺手把 scu-net 认证脚本的退避上限从 900 秒改成 120 秒——断网恢复从最坏 15 分钟缩到 2 分钟。

## 三件套：ZeroTier / AdGuard Home / 监控

### ZeroTier

```bash
apk add zerotier
zerotier-cli join [数据删除]   # 我的既有网络
```

控制台授权后拿到 10.64.64.13。两个坑：

- zt 接口不在任何防火墙 zone，入向全丢。建一个 `proto none` 的 network 接口挂进 lan zone。
- `dropbear.main.Interface='zt0'` 会导致 dropbear 起不来——proto=none 的接口 netifd 不认 IP。删掉让它绑全局，靠防火墙 zone 保护。

顺带发现：PC 和路由器在同一台路由器后面时，ZeroTier 互访会因校园 NAT 不支持 hairpin 而极不稳定——无所谓，同 LAN 直连就行，ZT 的价值在校外。

### AdGuard Home

最初的链：`dnsmasq:53 → AGH:5353 → SmartDNS:6053`。能用，但 AGH 后台"客户端排行"永远只有 localhost——dnsmasq 转发把来源全抹了。

改为标准架构：

- **AGH 直接监听 53**（绑 127.0.0.1 / 192.168.1.1 / ::1 / ULA）
- dnsmasq 退到 5354，只管 DHCP 和 `.lan` 本地域名
- AGH 上游：`[/lan/]127.0.0.1:5354` + `127.0.0.1:6053`，`local_ptr_upstreams` 指向 5354

客户端排行立刻出现真实设备 IP，过滤、AAAA 分流、本地域名三项全通。

### Ping 监控

OpenWrt 25.12 的 apk feeds 里**没有 smokeping**（只有 fping）。平替：`collectd + collectd-mod-ping + collectd-mod-rrdtool + luci-app-statistics`，监控校园网关、阿里 DNS、腾讯 DNS、baidu 四个目标，30 秒间隔，LuCI 里看图。

坑：UCI 选项是 `Hosts`（**大写 H**），小写静默忽略，只会留一个 127.0.0.1 目标。

## DDNS：阿里云 API

我有自己的域名，NS 在阿里云。目标：`[数据删除].andy-y.cn` 指路由器，`[数据删除].andy-y.cn` 指 PC。

架构上 PC 必须自报：因为它用 Windows 隐私临时 v6 地址（SuffixOrigin=Random，7 天一换），路由器看不到；脚本里筛 `SuffixOrigin -eq 'Link'` 的那个稳定地址上报。

## 终局：入站 v6 被阻断

最后验证最关键的假设：CERNET2 传统上入站不过滤， **能不能从外面直连路由器？**

结论： **校园网边界网关把入站 v6 全拦了** 。但校内 WiFi 下测是通的——边界只拦校外。 ~~不过这完全没有用，同一个校园网账户只能有一个设备在线。~~

结论与处置：

- WireGuard-over-v6 服务端方案：弃
- 校外管理：ZeroTier 打洞（出向不受限）。
- 校内 SSH：防火墙放行但收窄到 `2001:250:2003::/48`（SCU v6 段）
- DDNS 保留：解析正常， ~~或许哪天学校开放入站了呢~~
- v6 免流量出站（*T、镜像站）：不受影响，或许是 CERNET 用户的日常红利了

## 最终形态

```
设备
 └─ AdGuard Home :53        # 去广告 + 客户端统计
     ├─ [/lan/] dnsmasq :5354   # 本地域名 + DHCP
     └─ SmartDNS :6053          # 并发测速分流
         ├─ 教育网 DNS ×2       # 校内域名
         └─ 阿里/腾讯 DNS ×4    # 公网 A/AAAA
```

叠加：ZeroTier 远程管理、WAN DHCP 看门狗、scu-net 认证保活、双端阿里云 DDNS、collectd 延迟监控。全部 UCI/文件持久化。


