#!/bin/bash

# ==========================================
# KUI Serverless 集群节点 - 一键初始化/重装脚本
# ==========================================

# 1. 解析传入的参数
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --api) API_URL="$2"; shift ;;
        --ip) VPS_IP="$2"; shift ;;
        --token) TOKEN="$2"; shift ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
    shift
done

if [ -z "$API_URL" ] || [ -z "$VPS_IP" ] || [ -z "$TOKEN" ]; then
    echo "❌ 错误: 缺少必要参数！"
    echo "用法: bash kui.sh --api <url> --ip <ip> --token <token>"
    exit 1
fi

echo "=========================================="
echo "       🚀 KUI Agent 初始化启动中..."
echo "=========================================="

# ----------------------------------------------------
# 🌟 核心新增：深度清理历史残留，确保环境绝对纯净
# ----------------------------------------------------
echo "[1/6] 🧹 正在清理历史残留进程与配置文件..."

# 停止可能正在运行的旧服务
systemctl stop kui-agent 2>/dev/null
systemctl stop sing-box 2>/dev/null

# 彻底删除 KUI 的旧工作目录（包含所有旧证书、旧代码、旧配置）
rm -rf /opt/kui

# 彻底删除旧的 Sing-box 配置文件（防止旧格式导致重启崩溃）
rm -f /etc/sing-box/config.json

# 删除旧的 systemd 服务配置
rm -f /etc/systemd/system/kui-agent.service

# 重载 systemd 使删除生效
systemctl daemon-reload
# ----------------------------------------------------

echo "[2/6] 📦 正在检查并安装系统基础依赖..."
apt-get update -y
apt-get install -y python3 curl openssl iptables coreutils

echo "[3/6] ⚙️ 检查 Sing-box 代理核心..."
if ! command -v sing-box &> /dev/null; then
    echo "未检测到 Sing-box，正在拉取官方安装脚本..."
    bash <(curl -fsSL https://sing-box.app/deb-install.sh)
else
    echo "✅ Sing-box 已安装，跳过下载。"
fi

echo "[4/6] 📂 初始化 KUI 工作目录与环境..."
mkdir -p /opt/kui

# 生成给 agent.py 用的环境变量配置
cat > /opt/kui/config.json <<EOF
{
  "api_url": "${API_URL}/api/config",
  "report_url": "${API_URL}/api/report",
  "ip": "${VPS_IP}",
  "token": "${TOKEN}"
}
EOF

# 从 GitHub 仓库拉取你最新的 agent.py 脚本
echo "正在从主仓库拉取最新版 Agent 执行器..."
curl -sL "https://raw.githubusercontent.com/a62169722/KUI/main/vps/agent.py" -o /opt/kui/agent.py

# 赋予执行权限
chmod +x /opt/kui/agent.py

echo "[5/6] 🛡️ 注册 Systemd 守护进程..."
cat > /etc/systemd/system/kui-agent.service <<EOF
[Unit]
Description=KUI Serverless Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/kui/agent.py
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable kui-agent
systemctl enable sing-box

echo "[6/6] ⚡ 启动节点通信引擎..."
# 启动 agent，agent 启动后会立刻向面板请求配置，并接管重写和重启 sing-box 的工作
systemctl start kui-agent

echo "=========================================="
echo " 🎉 KUI Agent 部署成功！"
echo " 节点 IP: ${VPS_IP}"
echo " Agent 守护进程正在后台运行，并已开始向控制面拉取路由策略。"
echo " "
echo " 💡 常用排障命令:"
echo " 查看 Agent 同步日志: journalctl -u kui-agent -f"
echo " 查看 Sing-box 运行日志: journalctl -u sing-box -f"
echo "=========================================="
