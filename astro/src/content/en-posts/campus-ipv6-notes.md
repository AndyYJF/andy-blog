---
slug: campus-ipv6-notes
kind: post
locale: en
title: Campus Network IPv6 Tinkering Notes
legacyCid: 104
canonicalPath: /en/posts/campus-ipv6-notes/
commentKey: /posts/campus-ipv6-notes/
feedGuid: urn:andy-y:post:104#en
allowComment: true
allowFeed: true
pubDate: '2026-09-26T15:11:42.000Z'
updatedDate: '2026-09-26T15:11:42.000Z'
categories:
  - mid: 1
    name: 所有文章
    slug: default
  - mid: 13
    name: 调优
    slug: refine
tags: []
sourceFormat: markdown
sourceCid: 104
sourceRevision: 1
sourcePublishedAt: '2026-09-16T13:24:32.000Z'
translationVersionId: 23
translationStatus: current
translationAvailableAt: '2026-09-26T15:11:42.000Z'
description: A detailed account of configuring IPv6 on a campus network using OpenWrt 25.12. It covers setting up relay mode without prefix delegation, SmartDNS split routing, an automated DHCP watchdog, ZeroTier, AdGuard Home, and testing inbound IPv6 reachability.
cover: https://tc.andy-y.cn/i/2026/09/16/6aaa987c88f2f.png
---

> Campus network (CERNET) + OpenWrt 25.12 + an old MT7621 router. A log of a day's tinkering: IPv6 relay, SmartDNS traffic routing, DHCP self-healing, ZeroTier networking, AdGuard Home, Alibaba Cloud DDNS, and a final test pronouncing the "death sentence on inbound v6".

## Background

The dorm is connected to the Sichuan University campus network, with outbound traffic routed through CERNET. The router is an MT7621 running OpenWrt 25.12 (256MB RAM, 58MB flash). The WAN port gets v4 via DHCP, and web portal authentication is kept alive by a resident Python script.

One day, I checked `ipconfig` on my PC and found only a ULA address starting with `fde3:`—IPv6 was practically non-existent. So, the tinkering began.

## Battle 1: Getting Public v6 on LAN Without PD

SSH into the router to check wan6:

```
inet6 2001:250:2003:8c07:d6da:21ff:fe15:9aee/64 scope global dynamic
```

The address was there, but `ipv6-prefix` in `ifstatus wan6` was empty—**the campus network only assigns a single /64 address, with no prefix delegation (PD)**. Conventional routing mode (where the router receives a PD and then delegates subnets to LAN) wouldn't work.

My approach was relay mode: pass through the campus network router's RA to the LAN, letting clients handle SLAAC themselves:

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

A minute later, the PC received a public v6 of `2001:250:2003:8c07:8630:...`, and `ping -6 240c::6666` worked.

**Note**: On Windows, don't use `ipconfig /renew6` to wait for RA—it hangs in Git Bash; SLAAC will pick it up on its own.

## Battle 2: CERNET DNS Swallowing AAAA Records

v6 was working, but all browser traffic still went over v4. Troubleshooting:

```bash
dig @202.115.39.9 AAAA ipv6.baidu.com +short
# 空。NOERROR，但 answer 为零。
```

SCU DNS (202.115.39.9/6) returned empty for **all** AAAA queries—Tsinghua, TUNA mirror, CERNET official site, none spared. It wasn't that records didn't exist; they were swallowed.

But I didn't want to abandon CERNET DNS: internal campus domains (`www.scu.edu.cn` → 211.83.x.x) are only resolved correctly by it, and CERNET DNS has less DNS pollution than public DNS.

Solution: **SmartDNS concurrent speed testing and split routing**.

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

The beauty of this approach: SmartDNS queries all upstreams concurrently and picks the fastest response. Since CERNET DNS returns empty for AAAA, during speed tests, this defect turns into an automatic split router. Meanwhile, internal campus domains can only be answered by CERNET DNS, so they continue to go through it.

### Interlude: AAAA Is Still Empty

After configuration, direct AAAA queries to SmartDNS were still empty. Tracing logs layer by layer, I finally pinpointed `dualstack_ip_selection`: SmartDNS pings dual-stack results; if v6 is more than 10ms slower than v4, it **actively drops the AAAA record**. Baidu's v6 latency was 54ms vs v4 at 32ms, so it got killed right away. Turning it off fixed the issue.

## Battle 3: Disconnections and "Cyber Unplugging"

Around 10 PM, the internet suddenly dropped. The router's WAN port udhcpc was madly sending discovers, but the campus DHCP server (121.48.198.254, 4-hour lease) responded with absolute silence. `ifdown/ifup` and manual `udhcpc -r` were completely ineffective.

Then, **I unplugged and replugged the network cable, and immediately obtained a lease**.

The root cause was that the access switch's DHCP snooping / port-security binding table froze: the port security state machine only remembered the old binding, completely swallowing new discovers, while a link-layer flap resets the port state.

Since a human can't go unplug the cable every day, let a script do the unplugging:

```bash
# /usr/bin/wan-watchdog.sh，cron 每分钟
if ! ip -4 addr show dev wan | grep -q 'inet '; then
  # 连续 3 次失败才动作，避免误伤
  ...
  ip link set wan down; sleep 2; ip link set wan up  # 物理抖动 = 赛博拔线
  ifup wan
fi
```

Actual test: DHCP was reacquired about 20 seconds after the flap (12 seconds wasn't enough; the campus DHCP responds slowly). While at it, I changed the scu-net authentication script's backoff cap from 900 seconds to 120 seconds—cutting worst-case outage recovery from 15 minutes down to 2 minutes.

## The Trio: ZeroTier / AdGuard Home / Monitoring

### ZeroTier

```bash
apk add zerotier
zerotier-cli join [数据删除]   # 我的既有网络
```

After authorization in the console, obtained 10.64.64.13. Two pitfalls:

- The zt interface isn't in any firewall zone, so inbound traffic is completely dropped. Created a `proto none` network interface and attached it to the lan zone.
- `dropbear.main.Interface='zt0'` caused dropbear to fail to start—netifd doesn't recognize IPs on proto=none interfaces. Removed it to let it bind globally, protected by firewall zones.

Incidentally found: when PC and router are behind the same router, ZeroTier communication between them is extremely unstable due to the campus NAT lacking hairpin support—doesn't matter, just use direct LAN connection; ZT's value lies outside campus.

### AdGuard Home

The initial chain: `dnsmasq:53 → AGH:5353 → SmartDNS:6053`. It worked, but AGH's dashboard "Top Clients" only ever showed localhost—dnsmasq forwarding stripped all source info.

Changed to standard architecture:

- **AGH directly listens on 53** (binding 127.0.0.1 / 192.168.1.1 / ::1 / ULA)
- dnsmasq steps back to 5354, handling only DHCP and `.lan` local domains
- AGH upstreams: `[/lan/]127.0.0.1:5354` + `127.0.0.1:6053`, with `local_ptr_upstreams` pointing to 5354

Top clients immediately showed real device IPs; filtering, AAAA routing, and local domains all worked properly.

### Ping Monitoring

OpenWrt 25.12's apk feeds **do not have smokeping** (only fping). Alternative: `collectd + collectd-mod-ping + collectd-mod-rrdtool + luci-app-statistics`, monitoring four targets: campus gateway, Ali DNS, Tencent DNS, and baidu, at 30-second intervals, viewing graphs in LuCI.

Pitfall: the UCI option is `Hosts` (**capital H**); lowercase is silently ignored, leaving only a single 127.0.0.1 target.

## DDNS: Alibaba Cloud API

I have my own domain with NS hosted on Alibaba Cloud. Goal: `[数据删除].andy-y.cn` points to the router, `[数据删除].andy-y.cn` points to the PC.

Architecturally, the PC must report itself: because it uses Windows privacy temporary v6 addresses (SuffixOrigin=Random, rotates every 7 days), which the router cannot see; the script filters for the stable address where `SuffixOrigin -eq 'Link'` to report.

## Endgame: Inbound v6 Blocked

Finally, validating the most critical hypothesis: CERNET2 traditionally does not filter inbound traffic, **can we directly connect to the router from the outside?**

Conclusion: **The campus network border gateway completely blocks inbound v6**. However, testing under campus Wi-Fi worked—the border only blocks outside traffic. ~~Though this is completely useless, since only one device can be online per campus network account anyway.~~

Conclusions and actions:

- WireGuard-over-v6 server approach: abandoned
- Off-campus management: ZeroTier hole punching (outbound is unrestricted).
- On-campus SSH: firewall allows it but narrowed down to `2001:250:2003::/48` (SCU v6 subnet)
- DDNS kept: resolution works normally, ~~maybe one day the school will open inbound traffic~~
- v6 traffic-free egress (*T, mirrors): unaffected, perhaps a daily perk for CERNET users

## Final Form

```
设备
 └─ AdGuard Home :53        # 去广告 + 客户端统计
     ├─ [/lan/] dnsmasq :5354   # 本地域名 + DHCP
     └─ SmartDNS :6053          # 并发测速分流
         ├─ 教育网 DNS ×2       # 校内域名
         └─ 阿里/腾讯 DNS ×4    # 公网 A/AAAA
```

Superimposed: ZeroTier remote management, WAN DHCP watchdog, scu-net auth keepalive, dual-end Alibaba Cloud DDNS, collectd latency monitoring. All persisted via UCI/files.
