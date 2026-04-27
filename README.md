# 🚀 KUI - Serverless 极简节点网关控制台

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)
![Sing-box](https://img.shields.io/badge/core-Sing--box-black.svg)

KUI 是一个基于 **Cloudflare Pages** 和 **Sing-box** 构建的极简、轻量级 Serverless 节点管理网关。它彻底抛弃了传统的“面板-数据库-守护进程”的笨重架构，实现了“云端意图下发，边缘全自动落地”的现代化网络代理管理体验。

## ✨ 核心特性

* ☁️ **绝对的 Serverless 控制端**：管理面板完全托管在 Cloudflare Pages，**零成本、免维护、永不宕机**。
* ⚡ **极致轻量化的边缘 Agent**：VPS 端摒弃臃肿的面板环境，仅运行一个极简的 Python 守护进程与原生的 Sing-box 内核。
* 🛡️ **前沿协议支持**：原生支持 `VLESS`、`Reality` (自动生成防封锁密钥/短 ID)、`Hysteria 2` (自动签发证书) 以及 `Dokodemo-door` (任意门链式/公网转发)。
* 🔄 **分钟级状态同步**：节点流量配额、系统负载监控、到期时间自动核验，面板操作实时下发生效。
* 🎯 **“防弹版” 一键接入**：独创前置环境修复指令，无惧任何主机的精简版系统，一键复制，闭眼秒装。


---

## 🛠️ 详细部署教程

KUI 的部署分为两步：**云端面板部署** 与 **边缘节点接入**。

### 第一步：部署云端管理面板 (Cloudflare Pages)

1. **Fork 本仓库** 到你自己的 GitHub 账号下。
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 **Workers & Pages** -> **创建应用程序** -> **Pages** -> **连接到 Git**。
3. 选择你刚刚 Fork 的 `KUI` 仓库，点击“开始设置”。
4. **核心配置**：
   * 框架预设：根据你的后端代码结构选择（如果是原生 Cloudflare Functions，默认即可）。
   * **环境变量设置 (非常重要)**：你需要添加一个密码变量用于面板登录验证。
     * 变量名称：`ADMIN_PASSWORD`
     * 变量值：`自定义你的高强度登录密码`
5. 点击 **保存并部署**。部署完成后，你将获得一个类似于 `https://kui-xxx.pages.dev` 的面板地址。

### 第二步：登录面板并生成部署指令

1. 浏览器访问你的 Cloudflare Pages 域名。
2. 输入你在上一步设置的 `ADMIN_PASSWORD` 登入控制台。
3. 在顶部的 **“接入机器”** 区域：
   * 输入你 VPS 的**别名**（如：日本软银、香港 CMI）。
   * 输入你 VPS 的**公网 IP**。
   * 点击 **[接入机器]**。
4. 机器卡片创建成功后，点击卡片底部的 **[终端部署指令]** 黑色模块，系统会自动将针对该 IP 的专属“防弹版”部署命令复制到你的剪贴板。

### 第三步：在 VPS 上执行一键安装

SSH 登录到你的 VPS（推荐使用 Debian 11/12 或 Ubuntu 20.04+），直接**粘贴并回车**刚才复制的指令。

指令类似如下结构（*自带前置环境检查，全自动修复缺失的下载工具*）：
```bash
apt-get update -y && apt-get install -y curl && bash <(curl -sL [https://raw.githubusercontent.com/你的用户名/KUI/main/vps/kui.sh](https://raw.githubusercontent.com/你的用户名/KUI/main/vps/kui.sh)) --api "[https://你的域名.pages.dev](https://你的域名.pages.dev)" --ip "你的VPS_IP" --token "你的密码"
