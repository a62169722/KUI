#!/bin/sh

# ==========================================
# KUI Serverless 集群节点 - 智能跨系统安装脚本 (工业级加固版)
# 支持: Ubuntu 18-24 / Debian 10-13 / Alpine Linux
# ==========================================

while [ "$#" -gt 0 ]; do
    case $1 in
        --api) API_URL="$2"; shift ;;
        --ip) VPS_IP="$2"; shift ;;
        --token) TOKEN="$2"; shift ;;
        --proxy-api) PROXY_API_URL="$2"; shift ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
    shift
done

if [ -z "$API_URL" ] || [ -z "$VPS_IP" ] || [ -z "$TOKEN" ]; then
    echo "❌ 错误: 缺少必要参数！"
    exit 1
fi

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
echo "=========================================="

export CURL_USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"

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
fi

echo "[3/6] 📦 正在安装底层网络依赖..."
if [ "$OS" = "alpine" ]; then
    apk update
    apk add python3 curl openssl iptables ip6tables coreutils bash tar libc6-compat gcompat iproute2
    else
    apt-get update -y
    apt-get install -y python3 curl openssl iptables coreutils bash tar iproute2 iputils-ping
    fi

echo "[4/6] ⚙️ 部署 Sing-box 代理核心..."
rm -f /usr/bin/sing-box
ARCH=$(uname -m)
case "$ARCH" in
    x86_64) SB_ARCH="amd64" ;;
    aarch64) SB_ARCH="arm64" ;;
    *) echo "不支持的 CPU 架构: $ARCH"; exit 1 ;;
esac
SB_VER="1.13.14"
curl -sLo sing-box.tar.gz -A "$CURL_USER_AGENT" "https://github.com/SagerNet/sing-box/releases/download/v${SB_VER}/sing-box-${SB_VER}-linux-${SB_ARCH}.tar.gz"
tar -xzf sing-box.tar.gz
mv sing-box-${SB_VER}-linux-${SB_ARCH}/sing-box /usr/bin/
chmod +x /usr/bin/sing-box
rm -rf sing-box.tar.gz sing-box-${SB_VER}-linux-${SB_ARCH}

echo "[4.5/6] ⚙️ 正在应用网络内核调优（BBR / QUIC / conntrack）..."
if [ "$OS" = "alpine" ]; then
    modprobe -q xt_conntrack 2>/dev/null
    sysctl -w net.netfilter.nf_conntrack_max=1048576 >/dev/null 2>&1
else
    cat > /etc/sysctl.d/99-kui-optimize.conf <<'SYSCTL'
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_rmem = 4096 87380 67108864
net.ipv4.tcp_wmem = 4096 65536 67108864
net.core.rmem_max = 67108864
net.core.wmem_max = 67108864
net.core.netdev_max_backlog = 5000
net.netfilter.nf_conntrack_max = 1048576
net.netfilter.nf_conntrack_udp_timeout = 60
net.netfilter.nf_conntrack_tcp_timeout_established = 7200
net.netfilter.nf_conntrack_tcp_timeout_time_wait = 30
SYSCTL
    sysctl --system >/dev/null 2>&1
fi

echo "[5/6] 📂 初始化 KUI 工作目录与环境..."
mkdir -p /opt/kui /etc/sing-box

cat > /opt/kui/config.json <<EOF
{
  "api_url": "${API_URL}/api/config",
  "report_url": "${API_URL}/api/report",
  "ip": "${VPS_IP}",
  "token": "${TOKEN}",
  "proxy_api": "${PROXY_API_URL}"
}
EOF

echo "正在拉取最新版 Agent 执行器..."
AGENT_URL="${API_URL}/vps/agent.py"
BACKUP_URL="https://raw.githubusercontent.com/a62169722/KUI/main/vps/agent.py"
# 校验下载内容确实是 Python（含 import 且不是 GitHub 429/HTML 错误页）
is_valid_py() { [ -s "$1" ] && grep -q "import " "$1" && ! grep -qiE "429|too many requests|<html" "$1"; }
fetch_agent() { curl -sL --retry 3 --retry-delay 2 -A "$CURL_USER_AGENT" "$1" -o /opt/kui/agent.py; }
rm -f /opt/kui/agent.py
fetch_agent "$AGENT_URL"
if ! is_valid_py /opt/kui/agent.py; then
    echo "⚠️ 主源（面板）下载异常（可能未部署 vps/agent.py 或限流），尝试备用源..."
    fetch_agent "$BACKUP_URL"
fi
if ! is_valid_py /opt/kui/agent.py; then
    echo "⏳ 备用源疑似限流，等待 8s 后重试..."
    sleep 8; fetch_agent "$BACKUP_URL"
fi
if ! is_valid_py /opt/kui/agent.py; then
    echo "❌ 下载 agent.py 失败：请确认已在 Cloudflare Pages 部署本仓库（使 /vps/agent.py 可访问），或稍后避开 GitHub 限流再试。"; exit 1;
fi
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
    if command -v sing-box >/dev/null 2>&1; then
        if [ ! -f /etc/systemd/system/sing-box.service ]; then
            cat > /etc/systemd/system/sing-box.service <<EOF
[Unit]
Description=Sing-box Proxy Service
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/sing-box run -c /etc/sing-box/config.json
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF
            systemctl daemon-reload
        fi
        systemctl enable sing-box
    fi
    systemctl start kui-agent
fi

echo "=========================================="
echo " 🎉 KUI Agent 跨平台部署成功！"
echo " 节点 IP: ${VPS_IP}"
echo " 系统架构: ${OS}"
echo "=========================================="
