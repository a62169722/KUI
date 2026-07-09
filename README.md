# ⚡ KUI x Server Monitor Pro - Cluster Gateway

![Vue 3](https://img.shields.io/badge/Frontend-Vue%203-4FC08D?logo=vuedotjs)
![Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020?logo=cloudflare)
![Python Agent](https://img.shields.io/badge/Agent-Python%203-3776AB?logo=python)
![License](https://img.shields.io/badge/License-MIT-blue)

这是结合了 **KUI 代理聚合面板** 与 **Server Monitor Pro 全景探针系统** 的终极 Serverless 解决方案。

只需一次 Cloudflare Pages 部署，即可拥有一个高可用、零服务器成本的集群管理中心。通过我们全新重构的**全能 Python Agent**，您只需在 VPS 上执行**一条命令**，即可同时完成 **“8合1防封代理矩阵下发”** 与 **“深度系统性能探针监控”**。

## ✨ 核心特性 (Features)

### 🚀 KUI 极速节点网关  特别感谢@FSCARMEN https://github.com/fscarmen/sing-box 加速实现多协议的部署
*   **一键 8合1 协议全家桶：** 支持极速下发 XTLS-Reality, Hysteria2, TUIC, Trojan, gRPC, Naive 等主流抗封锁协议。
*   **Argo 隧道守护：** 内置 Cloudflared 守护进程，支持 VLESS-Argo 全自动穿透。
*   **多用户体系：** 完善的用户配额、到期时间管理，专属独立订阅链接，防泄漏重置机制。
*   **流量结算：** 自动统计用户/节点流量，精确到字节，支持重置与图表回溯。

### 📊 Server Monitor Pro 探针大盘  https://github.com/a63414262/CF-Server-Monitor-Pro 深度融合
*   **深度数据抓取：** 实时 CPU/内存/磁盘/负载，精准统计出入网实时网速与月度总流量。
*   **国内四网延迟监控：** 持续追踪服务器到 电信、联通、移动、字节跳动 的 24 小时 Ping 值趋势。
*   **6 大沉浸式主题：** 默认白、暗黑极客、新粗野主义、毛玻璃、赛博朋克，以及**完全自定义模式**。
*   **极高自由度：** 支持自定义 CSS / 动态背景图 / 动态 JS 注入（如：樱花飘落、鼠标拖尾特效）。
*   **地理拓扑：** 自动识别机器归属地并在首页渲染高颜值的全球 Leaflet 世界地图。

### 🛠 终极单轨架构
*   **One Agent to Rule Them All：** 彻底抛弃繁杂的 Bash 探针，由单一 Python 进程接管代理核心与系统监控，极大降低性能开销。
*   **无缝融合后台：** SPA (单页应用) 架构，登录后直接在同一个控制台管理节点和探针展示信息，零割裂感。
*   **TG 智能告警：** 节点离线（超过2分钟）与恢复在线时，第一时间通过 Telegram 机器人推送告警。

---

## 📸 界面预览 (Screenshots)

*(建议在此处添加您的截图图片链接)*

*   **探针大盘展示**
    ![Dashboard](https://via.placeholder.com/800x400.png?text=Server+Monitor+Dashboard)
*   **单机 24H 趋势图**
    ![Detail Stats](https://via.placeholder.com/800x400.png?text=Node+Detail+Stats)
*   **KUI 控制台与极速下发**
    ![Admin Panel](https://via.placeholder.com/800x400.png?text=Admin+Control+Panel)

---

## ⚡ 部署指南 (Deployment)

本项目完全基于 Cloudflare Serverless 架构，您不需要购买任何面板服务器。

### Step 1: 创建 Cloudflare D1 数据库
1. 登录 Cloudflare 控制台，进入 **“Workers & Pages” -> “D1 SQL 数据库”**。
2. 创建一个新数据库，命名为 `kui-db` (或您喜欢的名字)。
> **注意：** 您**不需要**手动建表！系统在首次访问时会自动完成 `servers`, `users`, `nodes`, `probe_servers` 等所有核心数据表的创建与迁移。

### Step 2: 部署 Cloudflare Pages
1. Fork 此仓库到您的个人 GitHub。
2. 在 Cloudflare 中创建一个 **Pages** 项目，连接到您刚刚 Fork 的仓库。
3. **框架预设** 选择 `None`。
4. **构建命令** 留空，**构建输出目录** 填入 `/` (根目录)。

### Step 3: 绑定数据库与环境变量
在 Pages 项目的 **“设置” -> “函数”** (或绑定选项卡) 中：
1. **D1 数据库绑定:**
   * 变量名称必须为：`DB`
   * 选择您在 Step 1 中创建的数据库。
2. **环境变量 (Environment Variables):**
   设置以下变量以保护您的后台并开启高级功能：
   * `ADMIN_USERNAME` : 后台登录账号 (默认: `admin`)
   * `ADMIN_PASSWORD` : 后台登录密码 (默认: `admin`，**部署后强烈建议修改**)
   * `TG_BOT_TOKEN` : *(可选)* Telegram 机器人 Token，用于断线告警。
   * `TG_CHAT_ID` : *(可选)* 接收告警的 Telegram Chat ID。

### Step 4: 访问面板
重新部署一次后，访问您的 Pages 域名即可看到极美的监控大盘。点击右上角“系统准入”登录后台。

---

## 💻 接入节点 (Agent Installation)

KUI 与 Probe 已实现终极融合，您只需执行一次操作：

1. 登录后台面板，进入 **“服务器与节点”** 页面。
2. 在“接入机器”表单中，输入您的 VPS 名称、IP，选择系统架构（Debian/Ubuntu 选 Linux，Alpine 选 Alpine），点击 **“接入机器”**。
3. 系统会在页面下方生成该机器专属的 **Deploy Command (安装指令)**。
4. 复制该指令，使用 SSH 登录到您的 VPS 服务器，粘贴并回车。
5. **搞定！** 
   - 您的机器会**自动**出现在全景探针大盘中并开始上报数据。
   - 您可以直接在面板使用 **“🚀 爆发下发”** 功能，10 秒内部署 8 大节点阵列！

---

## 🎨 主题与高级自定义 (Customization)

在后台的 **“⚙️ 系统设置”** 中，您可以自由调整大盘的外观：

*   **启用二次元/自定义壁纸：** 在“自定义背景图片 URL”中填入图片直链，面板会自动切换为毛玻璃半透明卡片风格。
*   **引入自定义脚本：** 您可以在“自定义底部 Script 注入”中填入樱花飘落、鼠标拖尾等 JS 源码（需带 `<script>` 标签），系统会通过虚拟 DOM 安全注入并立即生效，拒绝白屏！

---

## 📝 贡献与支持 (Contributing)

如果您有任何想法或发现了 Bug，欢迎提交 Pull Request 或 Issue。

*   **声明：** 本项目整合了众多优秀的开源协议引擎（如 Sing-box, Xray 等）。请在遵循相关国家法律法规的前提下使用本项目，仅供学习、网络环境测试及探针监控交流使用。

## 📄 开源协议 (License)

[MIT License](LICENSE) © 2024+ KUI Cluster Gateway Team
