
# 🚀 KUI - Serverless 极简聚合节点网关

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Architecture](https://img.shields.io/badge/architecture-100%25%20Serverless-orange.svg)
![Database](https://img.shields.io/badge/database-Cloudflare%20D1-blue.svg)
![Security](https://img.shields.io/badge/security-HMAC--SHA256-red.svg)
![Core](https://img.shields.io/badge/core-Sing--box-black.svg)

KUI 是一个基于 **Cloudflare Pages + D1 数据库** 和 **Sing-box** 构建的极简、轻量级 Serverless 节点聚合管理网关。它彻底抛弃了传统的“面板-数据库-守护进程”笨重架构，实现了**“云端重逻辑，边缘极轻量”**的现代化网络代理管理体验。

## ✨ 核心特性

* ☁️ **纯 D1 驱动的单体闭环**：零成本、免维护。单一代码仓库同时处理 API 请求、托管前端面板、处理多用户鉴权，并后台静默执行定时巡检任务。
* 👥 **多用户分权与聚合订阅 (New!)**：
  * **管理员视角**：全量统筹集群节点、添加/封禁用户、分配独立流量配额与到期时间。
  * **普通用户视角**：精简版专属大屏，一键复制名下所有 VPS 节点的**聚合订阅链接**。云端自动拦截超量或到期用户的连接请求。
* 🛡️ **零攻击面 & 动态军工级鉴权**：
  * **边缘零端口**：VPS 采用纯 Pull 模式，不开放任何 Web 管理端口，免疫一切全网扫描器。
  * **防重放攻击**：抛弃明文 Token，采用前端动态生成 `时间戳 + HMAC-SHA256` 签名，Token 寿命仅 5 分钟，内存零明文存储。VPS 终端部署指令同样使用 Hash 脱敏。
* 📊 **立体化可观测性**：
  * **流量趋势图**：内置 ECharts，直观展示单机流量历史走势。
  * **智能休眠轮询**：基于 Web Page Visibility API，面板切入后台自动休眠，切回瞬间唤醒，杜绝无效请求，极致节省 Cloudflare 额度。
  * **全自动原生巡检**：利用 Cloudflare Pages 原生 Cron 触发器，节点掉线 3 分钟自动推送 Telegram 告警。
* 🚀 **前沿协议原生支持**：`VLESS`、`Reality` (自动防封锁)、`Hysteria 2` (自动发签)、`Dokodemo-door` (公网转发 / 内部链式隧道)。

---

## 🛠️ 极速部署指南

KUI 的部署完全基于 Cloudflare 生态，只需简单四步：

### 第一步：初始化 Cloudflare D1 数据库

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 **Workers & Pages** -> **D1 SQL 数据库**，点击 **创建数据库**（建议命名为 `kui-db`）。
2. 进入该数据库的 **控制台 (Console)**，**分四次**执行以下 SQL 语句初始化表结构：

**1. 节点状态表 (servers)：**
```sql
CREATE TABLE IF NOT EXISTS servers (
    ip TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cpu INTEGER DEFAULT 0,
    mem REAL DEFAULT 0,
    last_report INTEGER DEFAULT 0,
    alert_sent INTEGER DEFAULT 0
);
```
**2. 节点配置表 (nodes)：**
```sql
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    uuid TEXT NOT NULL,
    vps_ip TEXT NOT NULL,
    protocol TEXT NOT NULL,
    port INTEGER NOT NULL,
    sni TEXT,
    private_key TEXT,
    public_key TEXT,
    short_id TEXT,
    relay_type TEXT,
    target_ip TEXT,
    target_port INTEGER,
    target_id TEXT,
    enable INTEGER DEFAULT 1,
    traffic_used INTEGER DEFAULT 0,
    traffic_limit INTEGER DEFAULT 0,
    expire_time INTEGER DEFAULT 0,
    username TEXT DEFAULT 'admin',
    FOREIGN KEY(vps_ip) REFERENCES servers(ip) ON DELETE CASCADE
);
```
**3. 用户表 (users)：**
```sql
CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY, 
    password TEXT NOT NULL, 
    traffic_limit INTEGER DEFAULT 0, 
    traffic_used INTEGER DEFAULT 0, 
    expire_time INTEGER DEFAULT 0, 
    enable INTEGER DEFAULT 1
);
```
**4. 流量统计与性能索引：**
```sql
CREATE TABLE IF NOT EXISTS traffic_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    delta_bytes INTEGER DEFAULT 0,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY(ip) REFERENCES servers(ip) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_traffic_ip_time ON traffic_stats(ip, timestamp);
```

### 第二步：部署云端管理面板

1. **Fork 本仓库** 到你的 GitHub。
2. 在 Cloudflare 中进入 **Workers & Pages** -> **概述** -> **创建应用程序** -> **Pages** -> **连接到 Git**，选择你 Fork 的 KUI 仓库。
3. **设置环境变量 (Settings -> Environment variables)**：
   * `ADMIN_USERNAME` = `自定义管理员账号 (默认 admin)`
   * `ADMIN_PASSWORD` = `你的高强度登录密码 (必填)`
   * `TG_BOT_TOKEN` = `你的Telegram机器人Token (选填，用于失联告警)`
   * `TG_CHAT_ID` = `你的TG账号ID (选填，用于失联告警)`
4. **绑定 D1 数据库 (Settings -> Functions -> D1 database bindings)**：
   * 变量名称：`DB`
   * 命名空间：选择你第一步创建的 `kui-db`
5. 点击 **部署**，获取你的控制台专属域名（如 `https://kui-xxx.pages.dev`）。

### 第三步：开启原生定时告警 (Cron)

为了让面板能够在后台自动巡检死机节点：
1. 在 Cloudflare 进入你的 KUI Pages 项目详情页。
2. 点击顶部的 **设置 (Settings)** 选项卡 -> 左侧选择 **函数 (Functions)**。
3. 向下滚动找到 **Cron 触发器 (Cron Triggers)**，点击 **添加 Cron 触发器**。
4. 时间表达式选择 **自定义 (Custom)**，输入：`*/3 * * * *` （代表每 3 分钟执行一次后台巡检）。
5. 点击保存。

### 第四步：VPS 一键安全接入

1. 浏览器访问你的控制台域名，输入管理员账号密码登录。
2. 在 **[集群与节点]** 选项卡中，输入 VPS 别名与公网 IP，点击接入。
3. 点击生成的机器卡片底部的 **[终端部署指令]**。
4. SSH 登录到你的 VPS（推荐 Debian 11/12 或 Ubuntu 20.04+），**粘贴并回车**。
   *(指令自带前置环境检查，全自动拉取 Python 探针并运行。配置 1 分钟内生效，面板指示灯变绿 🟢)*

> **📝 普通用户分发提示：**
> 在 **[多用户管理]** 选项卡中创建普通用户后，直接将你的面板域名发送给他们。用户登录后将进入受限视图，只能查看并复制自己的聚合订阅链接。

---

## 📂 项目结构
```text
KUI/
├── index.html       # 控制台前端 (Vue3 + Tailwind + 双轨视图 + 动态签名)
├── functions/
│   └── api/
│       └── [[path]].js # Serverless 后端 (API 路由 + 数据聚合 + Cron 任务)
└── vps/
    ├── kui.sh       # 边缘节点一键初始化环境脚本
    └── agent.py     # 边缘 Python 守护探针 (轻量监控 + Sing-box 托管)
```

## ⚠️ 免责声明

本项目仅供网络技术学习、Serverless 架构研究与安全防御测试使用。请严格遵守当地法律法规，严禁用于任何非法用途。开发者不对使用该工具造成的任何后果负责。
```
