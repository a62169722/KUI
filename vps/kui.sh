#!/bin/sh

# ==========================================
# KUI Serverless 集群节点 - 智能跨系统安装脚本 (强制阿里云源版)
# 支持: Ubuntu 18-24 / Debian 10-13 / Alpine Linux
# ==========================================

# 1. 解析传入的参数
while [ "$#" -gt 0 ]; do
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
    echo "用法: sh kui.sh --api <url> --ip <ip> --token <token>"
    exit 1
fi

# 2. 智能识别操作系统
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "❌ 无法识别操作系统，脚本退出。"
    exit 1
fi

echo "=========================================="
echo " 🚀 KUI Agent 智能安装启动中..."
echo " 💻 目标系统: ${OS}"
echo " ⚡ 镜像配置: 强制使用阿里云 (Aliyun) 极速源"
echo "=========================================="

echo "[1/6] 🧹 正在清理历史残留..."
if [ "$OS" = "alpine" ]; then
    rc-service kui-agent stop >/dev/null 2>&1
    rc-service sing-box stop >/dev/null 2>&1
    rc-update del kui-agent default >/dev/null 2>&1
    rc-update del sing-box default >/dev/null 2>&1
    rm -f /etc/init.d/kui-agent /etc/init.d/sing-box
else
    systemctl stop kui-agent >/dev/null 2>&1
    systemctl stop sing-box >/dev/null 2>&1
    rm -f /etc/systemd/system/kui-agent.service
    systemctl daemon-reload >/dev/null 2>&1
fi
rm -rf /opt/kui /etc/sing-box/config.json

echo "[2/6] ⚡ 正在强制配置阿里云镜像源..."
if [ "$OS" = "alpine" ]; then
    sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories
else
    [ -f /etc/apt/sources.list ] && sed -i 's/archive.ubuntu.com/mirrors.aliyun.com/g' /etc/apt/sources.list
    [ -f /etc/apt/sources.list ] && sed -i 's/security.ubuntu.com/mirrors.aliyun.com/g' /etc/apt/sources.list
    [ -f /etc/apt/sources.list ] && sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list
    [ -f /etc/apt/sources.list ] && sed -i 's/security.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list
    
    if [ -d /etc/apt/sources.list.d ]; then
        sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/*.list 2>/dev/null || true
        sed -i 's/archive.ubuntu.com/mirrors.aliyun.com/g' /etc/apt/sources.list.d/*.list 2>/dev/null || true
    fi
fi

echo "[3/6] 📦 正在安装系统底层依赖..."
if [ "$OS" = "alpine" ]; then
    apk update
    # 🌟 核心修复：在此处加入了 libc6-compat 和 gcompat 防止核心二进制报错 not found
    apk add python3 curl openssl iptables coreutils bash tar libc6-compat gcompat iproute2
else
    apt-get update -y
    apt-get install -y python3 curl openssl iptables coreutils bash tar
fi

echo "[4/6] ⚙️ 部署 Sing-box 代理核心..."
if ! command -v sing-box >/dev/null 2>&1; then
    echo "未检测到 Sing-box，正在拉取二进制文件..."
    if [ "$OS" = "alpine" ]; then
        ARCH=$(uname -m)
        case "$ARCH" in
            x86_64) SB_ARCH="amd64" ;;
            aarch64) SB_ARCH="arm64" ;;
            *) echo "不支持的 CPU 架构: $ARCH"; exit 1 ;;
        esac
        SB_VER=$(curl -s "https://api.github.com/repos/SagerNet/sing-box/releases/latest" | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
        curl -sLo sing-box.tar.gz "https://github.com/SagerNet/sing-box/releases/download/v${SB_VER}/sing-box-${SB_VER}-linux-${SB_ARCH}.tar.gz"
        tar -xzf sing-box.tar.gz
        mv sing-box-${SB_VER}-linux-${SB_ARCH}/sing-box /usr/bin/
        chmod +x /usr/bin/sing-box
        rm -rf sing-box.tar.gz sing-box-${SB_VER}-linux-${SB_ARCH}
    else
        bash <(curl -fsSL https://sing-box.app/deb-install.sh)
    fi
else
    echo "✅ Sing-box 已安装，跳过下载。"
fi

echo "[5/6] 📂 初始化 KUI 工作目录与环境..."
mkdir -p /opt/kui /etc/sing-box

cat > /opt/kui/config.json <<EOF
{
  "api_url": "${API_URL}/api/config",
  "report_url": "${API_URL}/api/report",
  "ip": "${VPS_IP}",
  "token": "${TOKEN}"
}
EOF

echo "正在拉取最新版 Agent 执行器..."
curl -sL "https://raw.githubusercontent.com/a62169722/KUI/main/vps/agent.py" -o /opt/kui/agent.py
chmod +x /opt/kui/agent.py

echo "[6/6] 🛡️ 智能注册底层守护进程并启动..."
if [ "$OS" = "alpine" ]; then
    cat > /etc/init.d/kui-agent <<EOF
#!/sbin/openrc-run
description="KUI Serverless Agent"
command="/usr/bin/python3"
command_args="/opt/kui/agent.py"
command_background="yes"
pidfile="/run/kui-agent.pid"
EOF
    cat > /etc/init.d/sing-box <<EOF
#!/sbin/openrc-run
description="Sing-box Proxy Service"
command="/usr/bin/sing-box"
command_args="run -c /etc/sing-box/config.json"
command_background="yes"
pidfile="/run/sing-box.pid"
EOF
    chmod +x /etc/init.d/kui-agent /etc/init.d/sing-box
    rc-update add kui-agent default
    rc-update add sing-box default
    rc-service kui-agent start
else
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
    systemctl start kui-agent
fi

echo "=========================================="
echo " 🎉 KUI Agent 跨平台部署成功！"
echo " 节点 IP: ${VPS_IP}"
echo " 系统架构: ${OS}"
echo " 提示: 所有依赖已通过阿里云镜像站极速完成安装。"
echo "=========================================="
