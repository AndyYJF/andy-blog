---
slug: grafana-bird-status
kind: post
title: 搭建Grafana监测Bird运行状态
legacyCid: 30
canonicalPath: /posts/grafana-bird-status/
commentKey: /posts/grafana-bird-status/
feedGuid: https://www.andy-y.cn/index.php/archives/30/
allowComment: true
allowFeed: true
pubDate: '2026-02-19T14:39:00.000Z'
updatedDate: '2026-07-02T07:34:48.000Z'
categories:
  - mid: 1
    name: 所有文章
    slug: default
  - mid: 10
    name: DN42
    slug: DN42
  - mid: 11
    name: 开源项目
    slug: opensource
  - mid: 13
    name: 调优
    slug: refine
  - mid: 14
    name: 运维
    slug: mnt
tags: []
sourceFormat: markdown
description: 本人在dn42网络中有4个节点，本来搭建了LookingGlass来监测节点运行状态，但考虑到不够直观 其实是想折腾，所以打算搭建一个可以图形化监控每台节点Bird运行状态的仪表盘，在社区里面发现可以用Grafana搭配Prometheus作为数据源实现 拓扑图如下：
cover: https://tc.andy-y.cn/i/2026/06/11/6a2ab03df14ef.png
---

# 写在前面
本人在dn42网络中有4个节点，本来搭建了LookingGlass来监测节点运行状态，但考虑到不够直观 ~~其实是想折腾~~，所以打算搭建一个可以图形化监控每台节点Bird运行状态的仪表盘，在社区里面发现可以用Grafana搭配Prometheus作为数据源实现
拓扑图如下：

```mermaid
graph TD
    subgraph DN42 Network
        N1[Node 1] --> NE1(Node Exporter)
        N1 --> BE1(Bird/FRR Exporter)
        N2[Node 2] --> NE2(Node Exporter)
        N2 --> BE2(Bird/FRR Exporter)
        N3[Node 3] --> NE3(Node Exporter)
        N3 --> BE3(Bird/FRR Exporter)
        N4[Node 4] --> NE4(Node Exporter)
        N4 --> BE4(Bird/FRR Exporter)
    end

    NE1 --> P(Prometheus Server)
    NE2 --> P
    NE3 --> P
    NE4 --> P
    BE1 --> P
    BE2 --> P
    BE3 --> P
    BE4 --> P

    P --> G(Grafana Server)

    User[用户] --> G
```

# 搭建
## 部署 Prometheus Server

Prometheus Server 将运行在独立的监控服务器上。

####  创建工作目录

```bash
mkdir -p /opt/prometheus/config /opt/prometheus/data
```

####  创建 Prometheus 配置文件 (`/opt/prometheus/config/prometheus.yml`)

```yaml
global:
  scrape_interval: 15s # 默认抓取间隔

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090'] # 监控 Prometheus 自身

  - job_name: 'node_exporter'
    static_configs:
      - targets: ['<node1_ip>:9100', '<node2_ip>:9100', '<node3_ip>:9100', '<node4_ip>:9100'] # 替换为您的 DN42 节点 IP

  - job_name: 'bird_exporter'
    static_configs:
      - targets: ['<node1_ip>:9324', '<node2_ip>:9324', '<node3_ip>:9324', '<node4_ip>:9324'] # 替换为您的 DN42 节点 IP
```

**注意**: 请将 `<nodeX_ip>` 替换为您的 DN42 节点的实际 IP 地址。

####  使用 Docker Compose 部署 Prometheus

创建 `docker-compose.yml` 文件：

```yaml
services:
  prometheus:
    image: prom/prometheus
    container_name: prometheus
    network_mode: host
    ports:
      - "9090:9090"
    volumes:
      - /opt/prometheus/config/prometheus.yml:/etc/prometheus/prometheus.yml
      - /opt/prometheus/data:/prometheus
    command: 
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.enable-lifecycle'
    restart: unless-stopped
```

将数据目录的权限赋予 Prometheus 用户：

```bash
chown -R 65534:65534 /opt/prometheus/data
```

启动 Prometheus：

```bash
docker-compose up -d
```

通过访问 `http://<监控服务器IP>:9090` 来验证 Prometheus 是否正常运行。

## 部署 Node Exporter (每个 DN42 节点上)
#### 创建工作目录

```bash
mkdir -p /opt/node_exporter
```

#### 方式1：使用 Docker 部署 Node Exporter

```bash
docker run -d \
  --name node_exporter \
  --net="host" \
  --pid="host" \
  -v "/:/host:ro,rslave" \
  quay.io/prometheus/node-exporter:latest \
  --path.rootfs=/host
```

#### 方式2：使用二进制可执行文件部署 Node Exporter

1.  **下载并解压 Node Exporter**

    访问 [Prometheus 下载页面](https://prometheus.io/download/) 获取最新版本的 Node Exporter。以下示例使用 `1.7.0` 版本

    ```bash
    wget https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz
    tar xvfz node_exporter-1.7.0.linux-amd64.tar.gz
    sudo cp node_exporter-1.7.0.linux-amd64/node_exporter /usr/local/bin
    sudo chown prometheus:prometheus /usr/local/bin/node_exporter
    rm -rf node_exporter-1.7.0.linux-amd64.tar.gz node_exporter-1.7.0.linux-amd64
    ```

2.  **创建 Systemd 服务文件 (`/etc/systemd/system/node_exporter.service`)**

    ```ini
    [Unit]
    Description=Node Exporter
    Wants=network-online.target
    After=network-online.target

    [Service]
    Type=simple
    ExecStart=/usr/local/bin/node_exporter \
      --web.listen-address=":9100" \
      --collector.textfile.directory="/var/lib/node_exporter/textfile_collector"

    [Install]
    WantedBy=multi-user.target
    ```

3.  **重新加载 Systemd 并启动 Node Exporter**

    ```bash
    sudo systemctl daemon-reload
    sudo systemctl start node_exporter
    sudo systemctl enable node_exporter
    ```

#### Bird Exporter

首先，确保 BIRD 配置允许 `bird_exporter` 访问其控制套接字。通常需要在 `/etc/bird/bird.conf` 或 `/etc/bird2/bird.conf` 中添加类似以下内容：

```
control socket "/var/run/bird/bird.ctl" mode 0777;
```

然后，使用 Docker 部署 Bird Exporter (推荐用于内存充足的节点)：

```bash
docker run -d \
  --name bird_exporter \
  --network host \
  -v /var/run/bird/bird.ctl:/var/run/bird/bird.ctl \
  czerwonk/bird_exporter:latest
```

#### 使用二进制方式部署 Bird Exporter
1.  **下载并解压 Bird Exporter**

    访问 [Bird Exporter GitHub Releases](https://github.com/czerwonk/bird_exporter/releases) 获取最新版本的 Bird Exporter。以下示例使用 `1.1.0` 版本，请根据实际情况替换。

    ```bash
    wget https://github.com/czerwonk/bird_exporter/releases/download/v1.1.0/bird_exporter-1.1.0.linux-amd64.tar.gz
    tar xvfz bird_exporter-1.1.0.linux-amd64.tar.gz
    sudo cp bird_exporter-1.1.0.linux-amd64/bird_exporter /usr/local/bin
    sudo chown prometheus:prometheus /usr/local/bin/bird_exporter
    rm -rf bird_exporter-1.1.0.linux-amd64.tar.gz bird_exporter-1.1.0.linux-amd64
    ```

2.  **创建 Systemd 服务文件 (`/etc/systemd/system/bird_exporter.service`)**

    ```ini
    [Unit]
    Description=Bird Exporter
    Wants=network-online.target
    After=network-online.target

    [Service]
    Type=simple
    ExecStart=/usr/local/bin/bird_exporter \
      --bird.socket="/var/run/bird/bird.ctl" \
      --web.listen-address=":9324"

    [Install]
    WantedBy=multi-user.target
    ```

3.  **重新加载 Systemd 并启动 Bird Exporter**

    ```bash
    sudo systemctl daemon-reload
    sudo systemctl start bird_exporter
    sudo systemctl enable bird_exporter
    ```
### 部署 Grafana Server

Grafana Server 建议与 Prometheus Server 部署在同一台监控服务器上。

#### 创建工作目录

```bash
mkdir -p /opt/grafana/data
```

#### 4.4.2 使用 Docker Compose 部署 Grafana

更新之前创建的 `docker-compose.yml` 文件，添加 Grafana 服务：

```yaml
services:
  prometheus:
    image: prom/prometheus
    container_name: prometheus
    ports:
      - "9090:9090"
    volumes:
      - /opt/prometheus/config/prometheus.yml:/etc/prometheus/prometheus.yml
      - /opt/prometheus/data:/prometheus
    command: 
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.enable-lifecycle'
    restart: unless-stopped

  grafana:
    image: grafana/grafana
    container_name: grafana
    ports:
      - "3000:3000"
    volumes:
      - /opt/grafana/data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=your_strong_password # 请替换为强密码
    depends_on:
      - prometheus
    restart: unless-stopped
```

重新启动 Docker Compose 服务以启动 Grafana：

```bash
docker-compose up -d
```

### 配置 Grafana 数据源

1.  登录 Grafana。
2.  在左侧导航栏中，点击齿轮图标 (Configuration) -> Data Sources。
3.  点击 
`Add data source`。
4.  选择 `Prometheus`。
5.  在 `HTTP` 部分的 `URL` 字段中输入 `http://prometheus:9090` (如果 Prometheus 和 Grafana 在同一个 Docker Compose 网络中) 或 `http://localhost:9090` (如果 Prometheus 运行在宿主机上，且 Grafana 可以直接访问)。
6.  点击 `Save & Test`。如果一切正常，您将看到 `Data source is working` 的消息。

## 导入 Grafana 仪表盘

Grafana 社区提供了许多现成的仪表盘，可以大大简化监控配置。以下是一些推荐的仪表盘 ID：

*   **Node Exporter Full**: ID `1860` (或搜索 `Node Exporter Full`)，用于监控主机操作系统指标。
*   **BIRD RS**: ID `5259` (或搜索 `BIRD RS`)，用于监控 BIRD 路由协议状态。
*   **FRR Exporter - BGP**: ID `22943` (或搜索 `FRR Exporter - BGP`)，用于监控 FRR BGP 状态。

#### 导入步骤

1.  在 Grafana 左侧导航栏中，点击 `+` 图标 (Create) -> `Import`。
2.  在 `Import via grafana.com` 字段中输入上述仪表盘 ID，然后点击 `Load`。
3.  选择您的 Prometheus 数据源。
4.  点击 `Import`。

重复此过程，导入所有您需要的仪表盘。

## 告警配置 (可选)

Grafana 允许您基于 Prometheus 收集的指标配置告警规则。当指标达到预设阈值时，Grafana 可以通过邮件、Slack、Webhook 等方式发送通知。

#### 配置告警通道

1.  在 Grafana 左侧导航栏中，点击齿轮图标 (Configuration) -> `Alerting` -> `Notification channels`。
2.  点击 `New channel`。
3.  选择偏好的通知类型 (例如 `Email`, `Slack`) 并填写相关配置信息。
4.  点击 `Save`。

#### 创建告警规则

1.  打开想要添加告警的仪表盘。
2.  选择一个面板，点击面板标题，然后选择 `Edit`。
3.  在面板编辑视图中，切换到 `Alert` 选项卡。
4.  点击 `Create Alert`。
5.  定义告警规则的条件、评估周期和通知通道。
6.  点击 `Save`。
7.  分享我的JSON



:::collapse{label="Sample"}
```json
{
    "annotations":  {
                        "list":  [
                                     {
                                         "builtIn":  1,
                                         "datasource":  {
                                                            "uid":  "-- Grafana --"
                                                        },
                                         "enable":  true,
                                         "hide":  true,
                                         "iconColor":  "rgba(0, 211, 255, 1)",
                                         "name":  "Annotations \u0026 Alerts",
                                         "type":  "dashboard"
                                     }
                                 ]
                    },
    "description":  "Live BIRD routing health, prefix visibility, session status and routing activity across all monitored routers.",
    "editable":  true,
    "fiscalYearStartMonth":  0,
    "graphTooltip":  1,
    "id":  6,
    "links":  [

              ],
    "panels":  [
                   {
                       "datasource":  {
                                          "type":  "prometheus",
                                          "uid":  "dfdlzb2hrvlz4b"
                                      },
                       "description":  "Healthy Prometheus scrape targets for the selected BIRD exporters.",
                       "fieldConfig":  {
                                           "defaults":  {
                                                            "color":  {
                                                                          "mode":  "thresholds"
                                                                      },
                                                            "mappings":  [

                                                                         ],
                                                            "thresholds":  {
                                                                               "mode":  "absolute",
                                                                               "steps":  [
                                                                                             {
                                                                                                 "color":  "red",
                                                                                                 "value":  0
                                                                                             },
                                                                                             {
                                                                                                 "color":  "green",
                                                                                                 "value":  1
                                                                                             }
                                                                                         ]
                                                                           },
                                                            "unit":  "short"
                                                        },
                                           "overrides":  [

                                                         ]
                                       },
                       "gridPos":  {
                                       "h":  4,
                                       "w":  6,
                                       "x":  0,
                                       "y":  0
                                   },
                       "id":  10,
                       "options":  {
                                       "colorMode":  "background_solid",
                                       "graphMode":  "none",
                                       "justifyMode":  "center",
                                       "orientation":  "horizontal",
                                       "percentChangeColorMode":  "standard",
                                       "reduceOptions":  {
                                                             "calcs":  [
                                                                           "lastNotNull"
                                                                       ],
                                                             "fields":  "",
                                                             "values":  false
                                                         },
                                       "showPercentChange":  false,
                                       "textMode":  "auto",
                                       "wideLayout":  true
                                   },
                       "pluginVersion":  "12.3.3",
                       "targets":  [
                                       {
                                           "datasource":  {
                                                              "type":  "prometheus",
                                                              "uid":  "dfdlzb2hrvlz4b"
                                                          },
                                           "editorMode":  "code",
                                           "expr":  "count(up{job=\"bird_exporter\",instance=~\"$instance\"} == 1) or vector(0)",
                                           "format":  "time_series",
                                           "instant":  true,
                                           "legendFormat":  "__auto",
                                           "range":  false,
                                           "refId":  "A"
                                       }
                                   ],
                       "title":  "BIRD Exporters Online",
                       "type":  "stat"
                   },
                   {
                       "datasource":  {
                                          "type":  "prometheus",
                                          "uid":  "dfdlzb2hrvlz4b"
                                      },
                       "description":  "Established BGP sessions across the selected router scope.",
                       "fieldConfig":  {
                                           "defaults":  {
                                                            "color":  {
                                                                          "mode":  "thresholds"
                                                                      },
                                                            "mappings":  [

                                                                         ],
                                                            "thresholds":  {
                                                                               "mode":  "absolute",
                                                                               "steps":  [
                                                                                             {
                                                                                                 "color":  "red",
                                                                                                 "value":  0
                                                                                             },
                                                                                             {
                                                                                                 "color":  "green",
                                                                                                 "value":  1
                                                                                             }
                                                                                         ]
                                                                           },
                                                            "unit":  "short"
                                                        },
                                           "overrides":  [

                                                         ]
                                       },
                       "gridPos":  {
                                       "h":  4,
                                       "w":  6,
                                       "x":  6,
                                       "y":  0
                                   },
                       "id":  11,
                       "options":  {
                                       "colorMode":  "background_solid",
                                       "graphMode":  "none",
                                       "justifyMode":  "center",
                                       "orientation":  "horizontal",
                                       "percentChangeColorMode":  "standard",
                                       "reduceOptions":  {
                                                             "calcs":  [
                                                                           "lastNotNull"
                                                                       ],
                                                             "fields":  "",
                                                             "values":  false
                                                         },
                                       "showPercentChange":  false,
                                       "textMode":  "auto",
                                       "wideLayout":  true
                                   },
                       "pluginVersion":  "12.3.3",
                       "targets":  [
                                       {
                                           "datasource":  {
                                                              "type":  "prometheus",
                                                              "uid":  "dfdlzb2hrvlz4b"
                                                          },
                                           "editorMode":  "code",
                                           "expr":  "count(bird_protocol_up{proto=\"BGP\",instance=~\"$instance\"} == 1) or vector(0)",
                                           "format":  "time_series",
                                           "instant":  true,
                                           "legendFormat":  "__auto",
                                           "range":  false,
                                           "refId":  "A"
                                       }
                                   ],
                       "title":  "BGP Sessions Up",
                       "type":  "stat"
                   },
                   {
                       "datasource":  {
                                          "type":  "prometheus",
                                          "uid":  "dfdlzb2hrvlz4b"
                                      },
                       "description":  "BGP sessions currently not established.",
                       "fieldConfig":  {
                                           "defaults":  {
                                                            "color":  {
                                                                          "mode":  "thresholds"
                                                                      },
                                                            "mappings":  [

                                                                         ],
                                                            "thresholds":  {
                                                                               "mode":  "absolute",
                                                                               "steps":  [
                                                                                             {
                                                                                                 "color":  "green",
                                                                                                 "value":  0
                                                                                             },
                                                                                             {
                                                                                                 "color":  "red",
                                                                                                 "value":  1
                                                                                             }
                                                                                         ]
                                                                           },
                                                            "unit":  "short"
                                                        },
                                           "overrides":  [

                                                         ]
                                       },
                       "gridPos":  {
                                       "h":  4,
                                       "w":  6,
                                       "x":  12,
                                       "y":  0
                                   },
                       "id":  12,
                       "options":  {
                                       "colorMode":  "background_solid",
                                       "graphMode":  "none",
                                       "justifyMode":  "center",
                                       "orientation":  "horizontal",
                                       "percentChangeColorMode":  "standard",
                                       "reduceOptions":  {
                                                             "calcs":  [
                                                                           "lastNotNull"
                                                                       ],
                                                             "fields":  "",
                                                             "values":  false
                                                         },
                                       "showPercentChange":  false,
                                       "textMode":  "auto",
                                       "wideLayout":  true
                                   },
                       "pluginVersion":  "12.3.3",
                       "targets":  [
                                       {
                                           "datasource":  {
                                                              "type":  "prometheus",
                                                              "uid":  "dfdlzb2hrvlz4b"
                                                          },
                                           "editorMode":  "code",
                                           "expr":  "count(bird_protocol_up{proto=\"BGP\",instance=~\"$instance\"} == 0) or vector(0)",
                                           "format":  "time_series",
                                           "instant":  true,
                                           "legendFormat":  "__auto",
                                           "range":  false,
                                           "refId":  "A"
                                       }
                                   ],
                       "title":  "BGP Sessions Down",
                       "type":  "stat"
                   },
                   {
                       "datasource":  {
                                          "type":  "prometheus",
                                          "uid":  "dfdlzb2hrvlz4b"
                                      },
                       "description":  "Total adjacent OSPF and OSPFv3 neighbors.",
                       "fieldConfig":  {
                                           "defaults":  {
                                                            "color":  {
                                                                          "mode":  "thresholds"
                                                                      },
                                                            "mappings":  [

                                                                         ],
                                                            "thresholds":  {
                                                                               "mode":  "absolute",
                                                                               "steps":  [
                                                                                             {
                                                                                                 "color":  "red",
                                                                                                 "value":  0
                                                                                             },
                                                                                             {
                                                                                                 "color":  "green",
                                                                                                 "value":  1
                                                                                             }
                                                                                         ]
                                                                           },
                                                            "unit":  "short"
                                                        },
                                           "overrides":  [

                                                         ]
                                       },
                       "gridPos":  {
                                       "h":  4,
                                       "w":  6,
                                       "x":  18,
                                       "y":  0
                                   },
                       "id":  13,
                       "options":  {
                                       "colorMode":  "background_solid",
                                       "graphMode":  "none",
                                       "justifyMode":  "center",
                                       "orientation":  "horizontal",
                                       "percentChangeColorMode":  "standard",
                                       "reduceOptions":  {
                                                             "calcs":  [
                                                                           "lastNotNull"
                                                                       ],
                                                             "fields":  "",
                                                             "values":  false
                                                         },
                                       "showPercentChange":  false,
                                       "textMode":  "auto",
                                       "wideLayout":  true
                                   },
                       "pluginVersion":  "12.3.3",
                       "targets":  [
                                       {
                                           "datasource":  {
                                                              "type":  "prometheus",
                                                              "uid":  "dfdlzb2hrvlz4b"
                                                          },
                                           "editorMode":  "code",
                                           "expr":  "(sum(bird_ospf_neighbor_adjacent_count{instance=~\"$instance\"}) or vector(0)) + (sum(bird_ospfv3_neighbor_adjacent_count{instance=~\"$instance\"}) or vector(0))",
                                           "format":  "time_series",
                                           "instant":  true,
                                           "legendFormat":  "__auto",
                                           "range":  false,
                                           "refId":  "A"
                                       }
                                   ],
                       "title":  "OSPF Adjacent Neighbors",
                       "type":  "stat"
                   },
                   {
                       "datasource":  {
                                          "type":  "prometheus",
                                          "uid":  "dfdlzb2hrvlz4b"
                                      },
                       "description":  "Prefixes advertised to PITER-IX peers across the selected time range.",
                       "fieldConfig":  {
                                           "defaults":  {
                                                            "color":  {
                                                                          "mode":  "palette-classic"
                                                                      },
                                                            "custom":  {
                                                                           "axisBorderShow":  false,
                                                                           "axisCenteredZero":  false,
                                                                           "axisColorMode":  "text",
                                                                           "axisLabel":  "",
                                                                           "axisPlacement":  "left",
                                                                           "barAlignment":  0,
                                                                           "barWidthFactor":  0.6,
                                                                           "drawStyle":  "line",
                                                                           "fillOpacity":  0,
                                                                           "gradientMode":  "none",
                                                                           "hideFrom":  {
                                                                                            "legend":  false,
                                                                                            "tooltip":  false,
                                                                                            "viz":  false
                                                                                        },
                                                                           "insertNulls":  false,
                                                                           "lineInterpolation":  "stepAfter",
                                                                           "lineWidth":  2,
                                                                           "pointSize":  5,
                                                                           "scaleDistribution":  {
                                                                                                     "type":  "linear"
                                                                                                 },
                                                                           "showPoints":  "never",
                                                                           "showValues":  false,
                                                                           "spanNulls":  false,
                                                                           "stacking":  {
                                                                                            "group":  "A",
                                                                                            "mode":  "none"
                                                                                        },
                                                                           "thresholdsStyle":  {
                                                                                                   "mode":  "off"
                                                                                               }
                                                                       },
                                                            "mappings":  [

                                                                         ],
                                                            "thresholds":  {
                                                                               "mode":  "absolute",
                                                                               "steps":  [
                                                                                             {
                                                                                                 "color":  "green",
                                                                                                 "value":  0
                                                                                             },
                                                                                             {
                                                                                                 "color":  "red",
                                                                                                 "value":  80
                                                                                             }
                                                                                         ]
                                                                           },
                                                            "unit":  "short"
                                                        },
                                           "overrides":  [
                                                             {
                                                                 "matcher":  {
                                                                                 "id":  "byValue",
                                                                                 "options":  {
                                                                                                 "op":  "gte",
                                                                                                 "reducer":  "allIsZero",
                                                                                                 "value":  0
                                                                                             }
                                                                             },
                                                                 "properties":  [
                                                                                    {
                                                                                        "id":  "custom.hideFrom",
                                                                                        "value":  {
                                                                                                      "legend":  true,
                                                                                                      "tooltip":  true,
                                                                                                      "viz":  false
                                                                                                  }
                                                                                    }
                                                                                ]
                                                             },
                                                             {
                                                                 "matcher":  {
                                                                                 "id":  "byValue",
                                                                                 "options":  {
                                                                                                 "op":  "gte",
                                                                                                 "reducer":  "allIsNull",
                                                                                                 "value":  0
                                                                                             }
                                                                             },
                                                                 "properties":  [
                                                                                    {
                                                                                        "id":  "custom.hideFrom",
                                                                                        "value":  {
                                                                                                      "legend":  true,
                                                                                                      "tooltip":  true,
                                                                                                      "viz":  false
                                                                                                  }
                                                                                    }
                                                                                ]
                                                             },
                                                             {
                                                                 "matcher":  {
                                                                                 "id":  "byValue",
                                                                                 "options":  {
                                                                                                 "op":  "gte",
                                                                                                 "reducer":  "allIsZero",
                                                                                                 "value":  0
                                                                                             }
                                                                             },
                                                                 "properties":  [
                                                                                    {
                                                                                        "id":  "custom.hideFrom",
                                                                                        "value":  {
                                                                                                      "legend":  true,
                                                                                                      "tooltip":  true,
                                                                                                      "viz":  false
                                                                                                  }
                                                                                    }
                                                                                ]
                                                             },
                                                             {
                                                                 "matcher":  {
                                                                                 "id":  "byValue",
                                                                                 "options":  {
                                                                                                 "op":  "gte",
                                                                                                 "reducer":  "allIsNull",
                                                                                                 "value":  0
                                                                                             }
                                                                             },
                                                                 "properties":  [
                                                                                    {
                                                                                        "id":  "custom.hideFrom",
                                                                                        "value":  {
                                                                                                      "legend":  true,
                                                                                                      "tooltip":  true,
                                                                                                      "viz":  false
                                                                                                  }
                                                                                    }
                                                                                ]
                                                             },
                                                             {
                                                                 "matcher":  {
                                                                                 "id":  "byValue",
                                                                                 "options":  {
                                                                                                 "op":  "gte",
                                                                                                 "reducer":  "allIsZero",
                                                                                                 "value":  0
                                                                                             }
                                                                             },
                                                                 "properties":  [
                                                                                    {
                                                                                        "id":  "custom.hideFrom",
                                                                                        "value":  {
                                                                                                      "legend":  true,
                                                                                                      "tooltip":  true,
                                                                                                      "viz":  false
                                                                                                  }
                                                                                    }
                                                                                ]
                                                             },
                                                             {
                                                                 "matcher":  {
                                                                                 "id":  "byValue",
                                                                                 "options":  {
                                                                                                 "op":  "gte",
                                                                                                 "reducer":  "allIsNull",
                                                                                                 "value":  0
                                                                                             }
                                                                             },
                                                                 "properties":  [
                                                                                    {
                                                                                        "id":  "custom.hideFrom",
                                                                                        "value":  {
                                                                                                      "legend":  true,
                                                                                                      "tooltip":  true,
                                                                                                      "viz":  false
                                                                                                  }
                                                                                    }
                                                                                ]
                                                             }
                                                         ]
                                       },
                       "gridPos":  {
                                       "h":  8,
                                       "w":  12,
                                       "x":  0,
                                       "y":  4
                                   },
                       "id":  2,
                       "options":  {
                                       "legend":  {
                                                      "calcs":  [
                                                                    "lastNotNull"
                                                                ],
                                                      "displayMode":  "table",
                                                      "placement":  "bottom",
                                                      "showLegend":  true
                                                  },
                                       "tooltip":  {
                                                       "hideZeros":  true,
                                                       "mode":  "multi",
                                                       "sort":  "desc"
                                                   }
                                   },
                       "pluginVersion":  "12.3.3",
                       "targets":  [
                                       {
                                           "datasource":  {
                                                              "type":  "prometheus",
                                                              "uid":  "dfdlzb2hrvlz4b"
                                                          },
                                           "dateTimeType":  "DATETIME",
                                           "editorMode":  "code",
                                           "expr":  "bird_protocol_prefix_export_count{\n  instance=~\"$instance\",\r\n  name=~\"(dn42_peer_|dn42_)[0-9a-zA-Z]+\", \r\n  name!~\"dn42_ospf\",\r\n  name!~\"dn42_ospf6\", \r\n  ip_version=\"4\"\r\n} \u003e 0\r\n",
                                           "format":  "time_series",
                                           "formattedQuery":  "SELECT $timeSeries as t, count() FROM $table WHERE $timeFilter GROUP BY t ORDER BY t",
                                           "intervalFactor":  1,
                                           "legendFormat":  "{{name}}",
                                           "query":  "SELECT\n    $timeSeries as t,\n    count()\nFROM $table\nWHERE $timeFilter\nGROUP BY t\nORDER BY t",
                                           "range":  true,
                                           "refId":  "A",
                                           "round":  "0s"
                                       }
                                   ],
                       "title":  "PITER-IX · Exported Prefixes",
                       "type":  "timeseries"
                   },
                   {
                       "datasource":  {
                                          "type":  "prometheus",
                                          "uid":  "dfdlzb2hrvlz4b"
                                      },
                       "description":  "Prefixes received from PITER-IX peers across the selected time range.",
                       "fieldConfig":  {
                                           "defaults":  {
                                                            "color":  {
                                                                          "mode":  "palette-classic"
                                                                      },
                                                            "custom":  {
                                                                           "axisBorderShow":  false,
                                                                           "axisCenteredZero":  false,
                                                                           "axisColorMode":  "text",
                                                                           "axisLabel":  "prefixes",
                                                                           "axisPlacement":  "left",
                                                                           "barAlignment":  0,
                                                                           "barWidthFactor":  0.6,
                                                                           "drawStyle":  "line",
                                                                           "fillOpacity":  0,
                                                                           "gradientMode":  "none",
                                                                           "hideFrom":  {
                                                                                            "legend":  false,
                                                                                            "tooltip":  false,
                                                                                            "viz":  false
                                                                                        },
                                                                           "insertNulls":  false,
                                                                           "lineInterpolation":  "stepAfter",
                                                                           "lineWidth":  2,
                                                                           "pointSize":  5,
                                                                           "scaleDistribution":  {
                                                                                                     "type":  "linear"
                                                                                                 },
                                                                           "showPoints":  "never",
                                                                           "showValues":  false,
                                                                           "spanNulls":  false,
                                                                           "stacking":  {
                                                                                            "group":  "A",
                                                                                            "mode":  "none"
                                                                                        },
                                                                           "thresholdsStyle":  {
                                                                                                   "mode":  "off"
                                                                                               }
                                                                       },
                                                            "mappings":  [

                                                                         ],
                                                            "thresholds":  {
                                                                               "mode":  "absolute",
                                                                               "steps":  [
                                                                                             {
                                                                                                 "color":  "green",
                                                                                                 "value":  0
                                                                                             },
                                                                                             {
                                                                                                 "color":  "red",
                                                                                                 "value":  80
                                                                                             }
                                                                                         ]
                                                                           },
                                                            "unit":  "none"
                                                        },
                                           "overrides":  [
                                                             {
                                                                 "matcher":  {
                                                                                 "id":  "byValue",
                                                                                 "options":  {
                                                                                                 "op":  "gte",
                                                                                                 "reducer":  "allIsZero",
                                                                                                 "value":  0
                                                                                             }
                                                                             },
                                                                 "properties":  [
                                                                                    {
                                                                                        "id":  "custom.hideFrom",
                                                                                        "value":  {
                                                                                                      "legend":  true,
                                                                                                      "tooltip":  true,
                                                                                                      "viz":  false
                                                                                                  }
                                                                                    }
                                                                                ]
                                                             },
                                                             {
                                                                 "matcher":  {
                                                                                 "id":  "byValue",
                                                                                 "options":  {
                                                                                                 "op":  "gte",
                                                                                                 "reducer":  "allIsNull",
                                                                                                 "value":  0
                                                                                             }
                                                                             },
                                                                 "properties":  [
                                                                                    {
                                                                                        "id":  "custom.hideFrom",
                                                                                        "value":  {
                                                                                                      "legend":  true,
                                                                                                      "tooltip":  true,
                                                                                                      "viz":  false
                                                                                                  }
                                                                                    }
                                                                                ]
                                                             },
                                                             {
                                                                 "matcher":  {
                                                                                 "id":  "byValue",
                                                                                 "options":  {
                                                                                                 "op":  "gte",
                                                                                                 "reducer":  "allIsZero",
                                                                                                 "value":  0
                                                                                             }
                                                                             },
                                                                 "properties":  [
                                                                                    {
                                                                                        "id":  "custom.hideFrom",
                                                                                        "value":  {
                                                                                                      "legend":  true,
                                                                                                      "tooltip":  true,
                                                                                                      "viz":  false
                                                                                                  }
                                                                                    }
                                                                                ]
                                                             },
                                                             {
                                                                 "matcher":  {
                                                                                 "id":  "byValue",
                                                                                 "options":  {
                                                                                                 "op":  "gte",
                                                                                                 "reducer":  "allIsNull",
                                                                                                 "value":  0
                                                                                             }
                                                                             },
                                                                 "properties":  [
                                                                                    {
                                                                                        "id":  "custom.hideFrom",
                                                                                        "value":  {
                                                                                                      "legend":  true,
                                                                                                      "tooltip":  true,
                                                                                                      "viz":  false
                                                                                                  }
                                                                                    }
                                                                                ]
                                                             },
                                                             {
                                                                 "matcher":  {
                                                                                 "id":  "byValue",
                                                                                 "options":  {
                                                                                                 "op":  "gte",
                                                                                                 "reducer":  "allIsZero",
                                                                                                 "value":  0
                                                                                             }
                                                                             },
                                                                 "properties":  [
                                                                                    {
                                                                                        "id":  "custom.hideFrom",
                                                                                        "value":  {
                                                                                                      "legend":  true,
                                                                                                      "tooltip":  true,
                                                                                                      "viz":  false
                                                                                                  }
                                                                                    }
                                                                                ]
                                                             },
                                                             {
                                                                 "matcher":  {
                                                                                 "id":  "byValue",
                                                                                 "options":  {
                                                                                                 "op":  "gte",
                                                                                                 "reducer":  "allIsNull",
                                                                                                 "value":  0
                                                                                             }
                                                                             },
                                                                 "properties":  [
                                                                                    {
                                                                                        "id":  "custom.hideFrom",
                                                                                        "value":  {
                                                                                                      "legend":  true,
                                                                                                      "tooltip":  true,
                                                                                                      "viz":  false
                                                                                                  }
                                                                                    }
                                                                                ]
                                                             }
                                                         ]
                                       },
                       "gridPos":  {
                                       "h":  8,
                                       "w":  12,
                                       "x":  12,
                                       "y":  4
                                   },
                       "id":  3,
                       "options":  {
                                       "legend":  {
                                                      "calcs":  [
                                                                    "lastNotNull"
                                                                ],
                                                      "displayMode":  "table",
                                                      "placement":  "bottom",
                                                      "showLegend":  true
                                                  },
                                       "tooltip":  {
                                                       "hideZeros":  true,
                                                       "mode":  "multi",
                                                       "sort":  "desc"
                                                   }
                                   },
                       "pluginVersion":  "12.3.3",
                       "targets":  [
                                       {
                                           "datasource":  {
                                                              "type":  "prometheus",
                                                              "uid":  "dfdlzb2hrvlz4b"
                                                          },
                                           "dateTimeType":  "DATETIME",
                                           "editorMode":  "code",
                                           "expr":  "bird_protocol_prefix_import_count{\n  instance=~\"$instance\",\r\n  name=~\"(dn42_peer_|dn42_)[0-9a-zA-Z]+\", \r\n  name!~\"dn42_ospf\",\r\n  name!~\"dn42_ospf6\", \r\n  ip_version=\"4\"\r\n} \u003e 0",
                                           "format":  "time_series",
                                           "formattedQuery":  "SELECT $timeSeries as t, count() FROM $table WHERE $timeFilter GROUP BY t ORDER BY t",
                                           "intervalFactor":  1,
                                           "legendFormat":  "{{name}}",
                                           "query":  "SELECT\n    $timeSeries as t,\n    count()\nFROM $table\nWHERE $timeFilter\nGROUP BY t\nORDER BY t",
                                           "range":  true,
                                           "refId":  "A",
                                           "round":  "0s"
                                       }
                                   ],
                       "title":  "PITER-IX · Imported Prefixes",
                       "type":  "timeseries"
                   },
                   {
                       "datasource":  {
                                          "type":  "prometheus",
                                          "uid":  "dfdlzb2hrvlz4b"
                                      },
                       "description":  "Accepted route updates and withdrawals per second. Spikes make routing churn immediately visible.",
                       "fieldConfig":  {
                                           "defaults":  {
                                                            "color":  {
                                                                          "mode":  "palette-classic"
                                                                      },
                                                            "custom":  {
                                                                           "axisBorderShow":  false,
                                                                           "axisCenteredZero":  false,
                                                                           "axisColorMode":  "text",
                                                                           "axisLabel":  "events / second",
                                                                           "axisPlacement":  "left",
                                                                           "barAlignment":  0,
                                                                           "barWidthFactor":  0.6,
                                                                           "drawStyle":  "line",
                                                                           "fillOpacity":  8,
                                                                           "gradientMode":  "opacity",
                                                                           "hideFrom":  {
                                                                                            "legend":  false,
                                                                                            "tooltip":  false,
                                                                                            "viz":  false
                                                                                        },
                                                                           "insertNulls":  false,
                                                                           "lineInterpolation":  "smooth",
                                                                           "lineWidth":  2,
                                                                           "pointSize":  4,
                                                                           "scaleDistribution":  {
                                                                                                     "type":  "linear"
                                                                                                 },
                                                                           "showPoints":  "never",
                                                                           "showValues":  false,
                                                                           "spanNulls":  true,
                                                                           "stacking":  {
                                                                                            "group":  "A",
                                                                                            "mode":  "none"
                                                                                        },
                                                                           "thresholdsStyle":  {
                                                                                                   "mode":  "off"
                                                                                               }
                                                                       },
                                                            "mappings":  [

                                                                         ],
                                                            "thresholds":  {
                                                                               "mode":  "absolute",
                                                                               "steps":  [
                                                                                             {
                                                                                                 "color":  "green",
                                                                                                 "value":  0
                                                                                             }
                                                                                         ]
                                                                           },
                                                            "unit":  "ops"
                                                        },
                                           "overrides":  [

                                                         ]
                                       },
                       "gridPos":  {
                                       "h":  8,
                                       "w":  12,
                                       "x":  0,
                                       "y":  12
                                   },
                       "id":  14,
                       "options":  {
                                       "legend":  {
                                                      "calcs":  [
                                                                    "lastNotNull"
                                                                ],
                                                      "displayMode":  "table",
                                                      "placement":  "bottom",
                                                      "showLegend":  true
                                                  },
                                       "tooltip":  {
                                                       "hideZeros":  true,
                                                       "mode":  "multi",
                                                       "sort":  "desc"
                                                   }
                                   },
                       "pluginVersion":  "12.3.3",
                       "targets":  [
                                       {
                                           "datasource":  {
                                                              "type":  "prometheus",
                                                              "uid":  "dfdlzb2hrvlz4b"
                                                          },
                                           "editorMode":  "code",
                                           "expr":  "sum by (instance) (rate(bird_protocol_changes_update_import_accept_count{instance=~\"$instance\"}[$__rate_interval]))",
                                           "format":  "time_series",
                                           "legendFormat":  "{{instance}} · imported updates",
                                           "range":  true,
                                           "refId":  "A"
                                       },
                                       {
                                           "datasource":  {
                                                              "type":  "prometheus",
                                                              "uid":  "dfdlzb2hrvlz4b"
                                                          },
                                           "editorMode":  "code",
                                           "expr":  "sum by (instance) (rate(bird_protocol_changes_withdraw_import_accept_count{instance=~\"$instance\"}[$__rate_interval]))",
                                           "format":  "time_series",
                                           "legendFormat":  "{{instance}} · imported withdrawals",
                                           "range":  true,
                                           "refId":  "B"
                                       },
                                       {
                                           "datasource":  {
                                                              "type":  "prometheus",
                                                              "uid":  "dfdlzb2hrvlz4b"
                                                          },
                                           "editorMode":  "code",
                                           "expr":  "sum by (instance) (rate(bird_protocol_changes_update_export_accept_count{instance=~\"$instance\"}[$__rate_interval]))",
                                           "format":  "time_series",
                                           "legendFormat":  "{{instance}} · exported updates",
                                           "range":  true,
                                           "refId":  "C"
                                       },
                                       {
                                           "datasource":  {
                                                              "type":  "prometheus",
                                                              "uid":  "dfdlzb2hrvlz4b"
                                                          },
                                           "editorMode":  "code",
                                           "expr":  "sum by (instance) (rate(bird_protocol_changes_withdraw_export_accept_count{instance=~\"$instance\"}[$__rate_interval]))",
                                           "format":  "time_series",
                                           "legendFormat":  "{{instance}} · exported withdrawals",
                                           "range":  true,
                                           "refId":  "D"
                                       }
                                   ],
                       "title":  "Routing Activity · Updates \u0026 Withdrawals",
                       "type":  "timeseries"
                   },
                   {
                       "datasource":  {
                                          "type":  "prometheus",
                                          "uid":  "dfdlzb2hrvlz4b"
                                      },
                       "description":  "Only non-established BGP sessions are listed. An empty table means all matched sessions are healthy.",
                       "fieldConfig":  {
                                           "defaults":  {
                                                            "color":  {
                                                                          "mode":  "thresholds"
                                                                      },
                                                            "custom":  {
                                                                           "align":  "auto",
                                                                           "cellOptions":  {
                                                                                               "type":  "auto"
                                                                                           },
                                                                           "filterable":  true,
                                                                           "footer":  {
                                                                                          "reducers":  [

                                                                                                       ]
                                                                                      },
                                                                           "inspect":  false
                                                                       },
                                                            "mappings":  [
                                                                             {
                                                                                 "options":  {
                                                                                                 "0":  {
                                                                                                           "color":  "red",
                                                                                                           "index":  0,
                                                                                                           "text":  "DOWN"
                                                                                                       }
                                                                                             },
                                                                                 "type":  "value"
                                                                             }
                                                                         ],
                                                            "thresholds":  {
                                                                               "mode":  "absolute",
                                                                               "steps":  [
                                                                                             {
                                                                                                 "color":  "red",
                                                                                                 "value":  0
                                                                                             }
                                                                                         ]
                                                                           }
                                                        },
                                           "overrides":  [

                                                         ]
                                       },
                       "gridPos":  {
                                       "h":  8,
                                       "w":  12,
                                       "x":  12,
                                       "y":  12
                                   },
                       "id":  15,
                       "options":  {
                                       "cellHeight":  "sm",
                                       "footer":  {
                                                      "countRows":  false,
                                                      "enablePagination":  true,
                                                      "fields":  "",
                                                      "reducer":  [
                                                                      "sum"
                                                                  ],
                                                      "show":  false
                                                  },
                                       "showHeader":  true,
                                       "sortBy":  [
                                                      {
                                                          "desc":  false,
                                                          "displayName":  "instance"
                                                      }
                                                  ]
                                   },
                       "pluginVersion":  "12.3.3",
                       "targets":  [
                                       {
                                           "datasource":  {
                                                              "type":  "prometheus",
                                                              "uid":  "dfdlzb2hrvlz4b"
                                                          },
                                           "editorMode":  "code",
                                           "expr":  "bird_protocol_up{proto=\"BGP\",instance=~\"$instance\"} == 0",
                                           "format":  "table",
                                           "instant":  true,
                                           "legendFormat":  "{{instance}} · {{name}} · IPv{{ip_version}}",
                                           "range":  false,
                                           "refId":  "A"
                                       }
                                   ],
                       "title":  "BGP Sessions Requiring Attention",
                       "transformations":  [
                                               {
                                                   "id":  "organize",
                                                   "options":  {
                                                                   "excludeByName":  {
                                                                                         "Time":  true,
                                                                                         "__name__":  true,
                                                                                         "export_filter":  true,
                                                                                         "import_filter":  true,
                                                                                         "job":  true,
                                                                                         "proto":  true
                                                                                     },
                                                                   "indexByName":  {
                                                                                       "Value":  4,
                                                                                       "instance":  0,
                                                                                       "ip_version":  2,
                                                                                       "name":  1,
                                                                                       "state":  3
                                                                                   },
                                                                   "renameByName":  {
                                                                                        "Value":  "Status",
                                                                                        "instance":  "Router",
                                                                                        "ip_version":  "IP",
                                                                                        "name":  "Session",
                                                                                        "state":  "State"
                                                                                    }
                                                               }
                                               }
                                           ],
                       "type":  "table"
                   },
                   {
                       "datasource":  {
                                          "type":  "prometheus",
                                          "uid":  "dfdlzb2hrvlz4b"
                                      },
                       "description":  "IPv4 and IPv6 prefixes exported by the BIRD protocol named flapalerted. Use the Router selector to isolate a node.",
                       "fieldConfig":  {
                                           "defaults":  {
                                                            "color":  {
                                                                          "mode":  "palette-classic"
                                                                      },
                                                            "custom":  {
                                                                           "axisBorderShow":  false,
                                                                           "axisCenteredZero":  false,
                                                                           "axisColorMode":  "text",
                                                                           "axisLabel":  "events / second",
                                                                           "axisPlacement":  "left",
                                                                           "barAlignment":  0,
                                                                           "barWidthFactor":  0.6,
                                                                           "drawStyle":  "line",
                                                                           "fillOpacity":  6,
                                                                           "gradientMode":  "opacity",
                                                                           "hideFrom":  {
                                                                                            "legend":  false,
                                                                                            "tooltip":  false,
                                                                                            "viz":  false
                                                                                        },
                                                                           "insertNulls":  false,
                                                                           "lineInterpolation":  "smooth",
                                                                           "lineWidth":  2,
                                                                           "pointSize":  4,
                                                                           "scaleDistribution":  {
                                                                                                     "type":  "linear"
                                                                                                 },
                                                                           "showPoints":  "never",
                                                                           "showValues":  false,
                                                                           "spanNulls":  true,
                                                                           "stacking":  {
                                                                                            "group":  "A",
                                                                                            "mode":  "none"
                                                                                        },
                                                                           "thresholdsStyle":  {
                                                                                                   "mode":  "off"
                                                                                               }
                                                                       },
                                                            "mappings":  [

                                                                         ],
                                                            "thresholds":  {
                                                                               "mode":  "absolute",
                                                                               "steps":  [
                                                                                             {
                                                                                                 "color":  "green",
                                                                                                 "value":  0
                                                                                             }
                                                                                         ]
                                                                           },
                                                            "unit":  "short"
                                                        },
                                           "overrides":  [

                                                         ]
                                       },
                       "gridPos":  {
                                       "h":  8,
                                       "w":  24,
                                       "x":  0,
                                       "y":  20
                                   },
                       "id":  16,
                       "options":  {
                                       "legend":  {
                                                      "calcs":  [
                                                                    "lastNotNull",
                                                                    "max"
                                                                ],
                                                      "displayMode":  "table",
                                                      "placement":  "bottom",
                                                      "showLegend":  true
                                                  },
                                       "tooltip":  {
                                                       "hideZeros":  true,
                                                       "mode":  "multi",
                                                       "sort":  "desc"
                                                   }
                                   },
                       "pluginVersion":  "12.3.3",
                       "targets":  [
                                       {
                                           "datasource":  {
                                                              "type":  "prometheus",
                                                              "uid":  "dfdlzb2hrvlz4b"
                                                          },
                                           "editorMode":  "code",
                                           "expr":  "bird_protocol_prefix_export_count{name=\"flapalerted\",instance=~\"$instance\"}",
                                           "format":  "time_series",
                                           "legendFormat":  "{{instance}} · IPv{{ip_version}}",
                                           "range":  true,
                                           "refId":  "A"
                                       }
                                   ],
                       "title":  "FlapAlerted · Exported Prefixes",
                       "type":  "timeseries"
                   }
               ],
    "preload":  false,
    "refresh":  "30s",
    "schemaVersion":  42,
    "tags":  [

             ],
    "templating":  {
                       "list":  [
                                    {
                                        "current":  {
                                                        "text":  "All",
                                                        "value":  "$__all"
                                                    },
                                        "datasource":  {
                                                           "type":  "prometheus",
                                                           "uid":  "dfdlzb2hrvlz4b"
                                                       },
                                        "definition":  "label_values(up{job=\"bird_exporter\"}, instance)",
                                        "includeAll":  true,
                                        "label":  "Router",
                                        "multi":  true,
                                        "name":  "instance",
                                        "options":  [

                                                    ],
                                        "query":  {
                                                      "query":  "label_values(up{job=\"bird_exporter\"}, instance)",
                                                      "refId":  "PrometheusVariableQueryEditor-VariableQuery"
                                                  },
                                        "refresh":  1,
                                        "regex":  "",
                                        "sort":  1,
                                        "type":  "query"
                                    }
                                ]
                   },
    "time":  {
                 "from":  "now-5m",
                 "to":  "now"
             },
    "timepicker":  {

                   },
    "timezone":  "",
    "title":  "BIRD · Routing Overview",
    "uid":  "f6bde99c-ee14-44cf-9b57-17052329ab55",
    "version":  15
}
```
:::





## 参考文献

*   [Grafana Labs - FRR Exporter - BGP Dashboard](https://grafana.com/grafana/dashboards/22943-frr-exporter-bgp/)
*   [Grafana Labs - BIRD RS Dashboard](https://grafana.com/grafana/dashboards/5259-bird-rs/)
*   [Grafana Labs - Node Exporter Full Dashboard](https://grafana.com/grafana/dashboards/1860-node-exporter-full/)
*   [GitHub - czerwonk/bird_exporter](https://github.com/czerwonk/bird_exporter)
*   [GitHub - tynany/frr_exporter](https://github.com/tynany/frr_exporter)
*   [Prometheus Documentation](https://prometheus.io/docs/)
*   [Grafana Documentation](https://grafana.com/docs/grafana/latest/)
