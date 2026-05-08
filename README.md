## 🤝 参与贡献 (Contributing)

如果你喜欢这个项目，欢迎提交 Pull Request，或者给个 ⭐ **Star** 支持一下！

# K-UI VPS Cluster Gateway | 群控VPS网关面板 🚀
## 已知问题，IPV6没有适配，IPV6只能单节点添加vless argo节点可用，IPV4功能一切正常
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-v1.0-green.svg)
![Architecture](https://img.shields.io/badge/architecture-Serverless-orange.svg)

KUI 是一款基于 **Cloudflare Pages + D1 数据库** 构建的轻量级、无服务器（Serverless）多节点代理聚合管理面板。配合极简的 Python 探针，能够实现单机/多机节点的一键接入、流量监控、多用户管理以及 **极速协议部署**。

特别感谢@FSCARMEN https://github.com/fscarmen/sing-box 加速实现多协议的部署
---

## ✨ 核心特性

- ☁️ **完全 Serverless 化**: 控制端部署于 Cloudflare Pages，数据存储于 CF D1 数据库。永远在线，免维护，零服务器成本。
- 🚀 **FSCARMEN 极速 8 合 1 下发**: 彻底抛弃繁琐的手动配置。输入一个起始端口，系统自动并发生成 8 大防封锁协议矩阵（`XTLS-Reality`, `Hysteria2`, `TUIC`, `Trojan`, `H2-Reality`, `gRPC-Reality`, `AnyTLS`, `Naive`）。
- 👥 **精细化多用户管理**: 支持多用户创建、独立流量配额（GB）、到期时间限制。
- 🔗 **订阅令牌解耦安全机制**: 用户的登录密码与节点订阅 Token 完全分离。一旦订阅泄露，可一键重置订阅 Token，旧链接瞬间作废，且不影响用户登录面板。
- 📊 **毫秒级全息监控**: 面板开启时自动触发探针“极速心跳模式”。实时回传 CPU、内存、硬盘、上下行网速及节点流量消耗，内置 Echarts 实现 7 天流量趋势图。
- 🔔 **智能巡检与 TG 告警**: 依托 Cloudflare Cron 定时触发器，节点失联超过 3 分钟自动向 Telegram 发送宕机告警。
- 🔄 **数据库热升级**: 后端代码内置 Schema 热修复引擎。更新后端代码后，数据库表结构和新字段会自动无缝升级，无需手动删表重建。

---

## 🏗️ 架构设计

1. **Center Panel (Cloudflare Pages)**: 负责 UI 渲染、API 鉴权、D1 数据库读写、订阅链接下发。
2. **Node Agent (Python)**: 运行在各个 VPS 上（`agent.py`）。通过主动发起 HTTP 请求拉取最新的节点配置，并动态编译生成 Sing-box 标准 `config.json`，同时定期上报机器状态。

---

## 🚀 部署指南

### 第一步：部署控制端 (Cloudflare Pages)

## 🚀 闪电部署

### Step 1: 准备 Cloudflare D1 数据库
1. 登录 Cloudflare 控制台，进入 `构建` -> `存储和数据库`-> `D1 SQL数据库`。
2. 点击“创建数据库”，命名为 `kui-db`（创建后即可退出，**无需执行任何建表操作**）。

### Step 2: 部署主控端 (Cloudflare Pages)
1. Fork 本仓库到你的 Github。
2. 在 Cloudflare 控制台左侧进入 `构建` -> `计算`-> Workers和Pages`，点击 `创建应用程序` -> `想要部署 Pages？点开始使用` -> `连接到 Git`。
3. 选择你 Fork 的仓库进行部署，框架预设选择 `None`。
4. **绑定数据库与变量** (进入已部署的 Pages 项目 `设置`)：
   - **函数 -> D1 数据库绑定**：将变量名设为 `DB`，并选择刚才创建的 `kui-db`。
   - **环境变量**：添加以下变量：
     - `ADMIN_USERNAME`: 你的管理员账号（默认填写 `admin` 即可）
     - `ADMIN_PASSWORD`: 你的管理员密码（**必填**，否则无法登录）
     - *(可选)* `TG_BOT_TOKEN`: 你的 Telegram Bot Token（用于掉线告警）
     - *(可选)* `TG_CHAT_ID`: 接收告警的 TG 频道或用户 ID

### Step 3: 零配置初始化
浏览器访问你的 Pages 域名，输入设置的账号密码登入。
**系统将瞬间在后台为你全自动建表并完成所有初始化配置！**

### 第二步：部署被控端 (VPS 节点)

在面板中以管理员身份登录，进入【服务器与节点】模块，输入 VPS 别名和 IP 建立档案。
点击对应机器下的 **“Deploy Command”**，复制系统生成的一键安装脚本，到你的 VPS 上执行即可。

*一键脚本示例 (自动适配 Ubuntu/Debian/Alpine)：*
```bash
apt-get update -y && apt-get install -y curl && bash <(curl -sL [https://raw.githubusercontent.com/a62169722/KUI/main/vps/kui.sh](https://raw.githubusercontent.com/a62169722/KUI/main/vps/kui.sh)) --api "你的CF_Pages域名" --ip "机器IP" --token "面板自动生成的Hash鉴权"
```

---

## 📖 使用说明

### 极速 8 合 1 节点矩阵部署
1. 节点机器接入成功并显示在线后，在面板中找到该机器。
2. 找到 **“极速全量节点下发”** 模块。
3. 选择该节点矩阵的【归属用户】。
4. 输入【起始端口】（推荐使用 `8881`）。
5. 点击 **🚀 爆发下发**。
6. 等待约 10~15 秒，探针下一次心跳交互时，将自动为您拉起底层的全部 Sing-box 协议引擎。

### 客户端订阅
点击右上角 **“🔗 复制订阅”**，将链接导入至 v2rayN、Clash Verge、Shadowrocket 等主流客户端即可自动解析（内置防封锁 SNI 与 16 字节高强度密码算法）。


---

## 目录结构说明
```text
├── index.html                  # 纯前端 UI (Vue3 + TailwindCSS + Echarts)
├── functions/
│   └── api/
│       └── [[path]].js         # CF Pages 后端核心 API (路由、鉴权、D1读写、订阅生成)
└── vps/
    ├── kui.sh                  # 被控端环境初始化守护脚本
    └── agent.py                # 被控端核心探针引擎 (协议编译、心跳上报)
```

---

## ⚠️ 声明

本项目仅供学习 Serverless 架构与网络协议原理使用。请遵守您所在国家和地区的法律法规，勿用于非法用途。

---

> 觉得好用的话，欢迎点个 ⭐ **Star** 支持一下！如果有任何问题或建议，欢迎提交 Issue 或 Pull Request。
```
