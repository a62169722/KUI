# ⚡ KUI x Server Monitor Pro - 无服务器集群网关

![Vue 3](https://img.shields.io/badge/Frontend-Vue%203-4FC08D?logo=vuedotjs)
![Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020?logo=cloudflare)
![Python Agent](https://img.shields.io/badge/Agent-Python%203-3776AB?logo=python)
![D1 Database](https://img.shields.io/badge/Database-Cloudflare%20D1-4285F4?logo=cloudflare)
![License](https://img.shields.io/badge/License-MIT-blue)

这是 **KUI 代理聚合面板** 与 **Server Monitor Pro 全景探针系统** 的无服务器终极融合方案。

仅需一次 Cloudflare Pages 部署，即可获得一个高可用、零服务器成本的集群管理中心。通过全新重构的**全能 Python Agent**，您只需在 VPS 上执行**一条命令**，即可同时完成 **"8合1防封代理矩阵下发"** 与 **"深度系统性能探针监控"**。

> 本项目基于 [CF-Server-Monitor-Pro](https://github.com/a63414262/CF-Server-Monitor-Pro) 及 [sing-box](https://github.com/SagerNet/sing-box) 加速实现，感谢开源社区的贡献。

---

## ✨ 核心特性

### 🚀 KUI 极速节点网关

- **一键 8合1 协议全家桶**：XTLS-Reality、Hysteria2、TUIC v5、Trojan、H2-Reality、gRPC-Reality、AnyTLS、Naive 防封锁协议极速下发
- **Argo 隧道守护**：当 IP 被封时，可启用 Cloudflared 守护进程，支持 VLESS-Argo 全自动穿透恢复
- **多用户体系**：完善的用户配额、到期时间管理，专属独立订阅链接，防泄漏重置机制
- **流量结算**：自动统计用户/节点流量，精确到字节，支持重置与图表回溯
- **第三方订阅**：支持导入外部订阅源，自动解析并混入本地节点池

### 📊 Server Monitor Pro 探针大盘

- **深度数据抓取**：实时 CPU、内存、磁盘、负载，精准统计出入网实时网速与月度总流量
- **国内四网延迟监控**：持续追踪服务器到 电信、联通、移动、字节跳动 的 24 小时 Ping 值趋势
- **6 大沉浸式主题**：默认白、暗黑极客、新粗野主义、毛玻璃、赛博朋克，以及**完全自定义模式**
- **地理拓扑**：自动识别机器归属地并在首页渲染高颜值全球 Leaflet 世界地图
- **多视图切换**：支持卡片视图、表格视图、地图视图三种展示模式

### 🌐 住宅 IP 代理控制器（双活引擎）

- **主备双活调度**：内置主备双路隧道（`tun_main` / `tun_backup`），通道故障软开关秒切
- **全量国家代码库**：预设 + 实时网络探测，提供最全面的目标锁定选择
- **直链提取 API**：`/api/proxies` 端点直出可用代理，支持外部程序调用

### 🛠 终极单轨架构

- **One Agent to Rule Them All**：彻底抛弃繁杂的 Bash 探针，由单一 Python 进程接管代理核心与系统监控，极大降低性能开销
- **无缝融合后台**：SPA (单页应用) 架构，登录后直接在同一个控制台管理节点和探针展示信息，零割裂感
- **TG 智能告警**：节点离线（超过2分钟）与恢复在线时，第一时间通过 Telegram 机器人推送告警

---

## 📸 界面预览

*(建议在此处添加您的真实截图)*

- **探针大盘展示** — 多视图卡片/表格/地图
- **单机 24H 趋势图** — CPU、内存、磁盘、网络、延迟
- **KUI 控制台与极速下发** — 8合1协议矩阵一键部署
- **住宅IP代理控制器** — 双活引擎调度界面

---

## 🚀 详细部署指南

本项目完全基于 Cloudflare Serverless 架构，您**不需要购买任何面板服务器**。

### 前置要求

- 一个 [GitHub](https://github.com) 账号
- 一个 [Cloudflare](https://dash.cloudflare.com) 账号（免费版即可）
- 一台或多台 VPS（Ubuntu 18-24 / Debian 10-13 / Alpine Linux）

---

### 第一步：创建 Cloudflare D1 数据库

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com)，进入 **Workers & Pages** → **D1 SQL 数据库**
2. 点击 **Create database**，命名为 `kui-db`（或您喜欢的名字）
3. 创建完成后，记下数据库名称，后续部署时需要用到

> **注意**：您**不需要**手动建表！系统在首次访问时会自动完成 `servers`、`users`、`nodes`、`probe_servers` 等所有核心数据表的创建与迁移。

---

### 第二步：Fork 仓库到个人 GitHub

1. 打开本仓库页面
2. 点击右上角 **Fork** 将仓库复制到您的个人 GitHub 账号下
3. Fork 完成后，您将拥有一个完全相同的仓库副本

---

### 第三步：部署到 Cloudflare Pages

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)，进入 **Workers & Pages**
2. 点击 **Create application** → **Pages** → **Connect to Git**
3. 选择您刚刚 Fork 的仓库并授权
4. **构建设置**：
   - **Framework preset**：选择 `None`（无框架预设）
   - **Build command**：留空（`None`）
   - **Build output directory**：填写 `/`（根目录）
   - **Root directory**：保持默认 `/`
5. 点击 **Save and Deploy**
6. 等待部署完成（通常 1-2 分钟），Cloudflare 会分配给您一个 `*.pages.dev` 域名

---

### 第四步：绑定 D1 数据库与环境变量

在 Pages 项目的 **Settings** → **Functions** → **D1 database bindings** 中：

1. **D1 数据库绑定**：
   - 变量名称：`DB`（**必须严格匹配**）
   - 选择您在第一步中创建的数据库（如 `kui-db`）

2. **环境变量**（Environment Variables）：
   | 变量名 | 说明 | 默认值 | 必填 |
   |---|---|---|---|
   | `ADMIN_USERNAME` | 后台登录账号 | `admin` | ✅ |
   | `ADMIN_PASSWORD` | 后台登录密码 | `admin` | ✅ |
   | `TG_BOT_TOKEN` | Telegram 机器人 Token | - | ❌ |
   | `TG_CHAT_ID` | 接收告警的 Telegram Chat ID | - | ❌ |
   | `PROXY_USER` | 住宅代理面板登录账号 | `admin` | ❌ |
   | `PROXY_PASS` | 住宅代理面板登录密码 | `admin888` | ❌ |

> ⚠️ **安全提示**：部署完成后请立即修改默认密码！

---

### 第五步：访问面板

1. 重新触发一次部署（在 Pages 项目页面点击 **Retry deployment**），确保环境变量和 D1 绑定生效
2. 访问您的 Pages 域名（如 `https://kui-monitor.pages.dev`）
3. 点击右上角 **👨‍💻 KUI 管理面板** 或 **系统准入** 登录后台
4. 使用您在第四步设置的账号密码登录

---

## 💻 接入 VPS 节点（Agent 安装）

KUI 与探针已实现终极融合，您只需执行一次操作：

### 1. 在面板添加服务器

1. 登录后台，进入 **服务器与节点** 页面
2. 在 **接入机器** 表单中，填写：
   - **服务器别名**：如 `日本软银 01`
   - **公网 IP**：您的 VPS 公网 IP
   - **系统架构**：Debian/Ubuntu 选 `Linux`，Alpine 选 `Alpine`
3. 点击 **接入机器**

### 2. 获取部署指令

在刚刚添加的服务器卡片底部，系统会生成专属的 **Deploy Command (安装指令)**：

```bash
bash <(curl -sL --ipv4 https://您的域名/vps/kui.sh) \
  --api https://您的域名 \
  --ip 您的VPS_IP \
  --token 您的Token
```

### 3. 执行安装

使用 SSH 登录到您的 VPS，粘贴上述指令并回车：

```bash
# Ubuntu / Debian
bash <(curl -sL --ipv4 https://您的域名/vps/kui.sh) \
  --api https://您的域名 \
  --ip 1.2.3.4 \
  --token 您的Token

# Alpine Linux
bash <(curl -sL --ipv4 https://您的域名/vps/kui.sh) \
  --api https://您的域名 \
  --ip 1.2.3.4 \
  --token 您的Token
```

安装脚本会自动完成以下操作：
- 清理历史残留进程
- 配置阿里云镜像源（加速安装）
- 安装底层网络依赖（Python3、curl、iptables 等）
- 部署 Sing-box 代理核心
- 初始化 KUI 工作目录
- 下载并启动全能 Python Agent
- 注册为系统守护进程（systemd / OpenRC）

### 4. 验证接入

安装完成后约 10-30 秒，您的机器会自动出现在全景探针大盘中并开始上报数据。

您可以直接在面板使用 **🚀 爆发下发** 功能，10 秒内部署 8 大节点阵列！

---

## 🎨 主题与高级自定义

在后台的 **⚙️ 系统设置** 中，您可以自由调整大盘外观：

- **切换主题**：默认白、暗黑极客、新粗野主义、毛玻璃、赛博朋克、完全自定义
- **启用二次元/自定义壁纸**：在"自定义背景图片 URL"中填入图片直链，面板自动切换为毛玻璃半透明卡片风格
- **引入自定义脚本**：在"自定义底部 Script 注入"中填入樱花飘落、鼠标拖尾等 JS 源码（需带 `<script>` 标签），系统会通过虚拟 DOM 安全注入并立即生效
- **站点标题**：自定义面板左上角标题
- **弹窗公告**：配置首次访问弹窗内容
- **自动重置流量**：开启后每月自动清零流量统计

---

## 🏗 项目结构

```
K-UI-main/
├── index.html                    # SPA 单页应用（Vue 3 + Tailwind CSS）
├── functions/
│   └── api/
│       └── [[path]].js           # Cloudflare Pages Functions 后端
│                                   # 包含：API路由、协议生成、订阅解析、D1操作
└── vps/
    ├── agent.py                  # 全能 Python Agent（监控 + 代理管理 + 心跳上报）
    ├── kui.sh                    # VPS 智能跨系统安装脚本
    ├── lite_manager.py           # 住宅 IP 代理双活调度引擎
    ├── proxy_server.py           # SOCKS5 代理服务器核心
    └── residential-proxy.sh      # 住宅代理一键安装脚本
```

---

## 🔧 技术栈

| 层级 | 技术 | 说明 |
|---|---|---|
| 前端 | Vue 3 + Tailwind CSS | 响应式 SPA，6 大主题支持 |
| 后端 | Cloudflare Pages Functions | 无服务器计算，自动扩缩容 |
| 数据库 | Cloudflare D1 | 全球边缘 SQL 数据库 |
| 探针 | ECharts + Chart.js + Leaflet | 图表可视化 + 地理地图 |
| 代理核心 | Sing-box | 现代化代理核心 |
| Agent | Python 3 | 系统监控 + 代理管理 |

---

## 🔑 核心功能说明

### 代理协议支持

| 协议 | 说明 | 适用场景 |
|---|---|---|
| XTLS-Reality | 基于 VLESS + Reality，最高抗封锁 | 生产环境首选 |
| Hysteria2 | 基于 QUIC，极速低延迟 | 需要高速度 |
| TUIC v5 | 基于 QUIC，高并发 | 多用户高并发 |
| Trojan | 经典 Trojan 协议 | 兼容性好 |
| H2-Reality | HTTP/2 + Reality | 伪装正常网站流量 |
| gRPC-Reality | gRPC + Reality | 高隐蔽性 |
| AnyTLS | 新一代抗封锁协议 | 最新抗封锁 |
| Naive | 基于 HTTP/2 | 轻量简洁 |
| VLESS-Argo | VLESS + Cloudflare Argo | IP 被封时隧道穿透 |

### 探针监控指标

- CPU 使用率 + CPU 信息
- 内存使用率 + Swap 使用量
- 磁盘使用率 + 已用/总量
- 系统负载（Load Average）
- 实时网速（入/出）+ 月度总流量
- 进程数
- TCP/UDP 连接数
- 国内四网延迟（电信/联通/移动/字节跳动）24小时趋势

---

## ❓ 常见问题

**Q: 部署后提示 "DB binding not found"？**

A: 请检查 Pages 项目的 **Settings → Functions → D1 database bindings** 中变量名是否为 `DB`，且绑定了正确的数据库。

**Q: Agent 安装失败或下载超时？**

A: 可能是 GitHub 限流导致 agent.py 下载失败。脚本会自动重试备用源，请稍等片刻后重新运行安装命令。也可以手动将 `vps/agent.py` 上传到 VPS 的 `/opt/kui/` 目录。

**Q: 探针数据不上报？**

A: 请检查：
1. VPS 上 `kui-agent` 服务是否正常运行：`systemctl status kui-agent`
2. 防火墙是否放行出站 HTTPS（443 端口）
3. `/opt/kui/config.json` 中的 `api_url` 和 `token` 是否正确

**Q: 支持哪些系统？**

A: 官方支持 Ubuntu 18-24、Debian 10-13、Alpine Linux。其他 systemd 发行版理论上也可运行，但未经过测试。

**Q: 是否需要公网域名？**

A: 部署 Cloudflare Pages 时需要。但 VPS Agent 通信仅需出站 HTTPS，不需要任何端口开放或域名解析。

---

## 📝 贡献与支持

如果您有任何想法或发现了 Bug，欢迎提交 [Pull Request](https://github.com/您的用户名/K-UI/compare) 或 [Issue](https://github.com/您的用户名/K-UI/issues)。

### 特别感谢

- [CF-Server-Monitor-Pro](https://github.com/a63414262/CF-Server-Monitor-Pro) — 探针系统基础
- [sing-box](https://github.com/SagerNet/sing-box) — 现代化代理核心
- [Cloudflare Pages](https://pages.cloudflare.com) — 无服务器托管平台
- 所有为本项目贡献代码、反馈问题的社区成员

### 免责声明

本项目整合了众多优秀的开源协议引擎（如 Sing-box、Xray 等）。请在遵循相关国家法律法规的前提下使用本项目，仅供学习、网络环境测试及探针监控交流使用。

---

## 📄 开源协议

[MIT License](LICENSE) © 2024+ KUI Cluster Gateway Team

---

**⭐ 如果这个项目对您有帮助，请给我们一个 Star！**
