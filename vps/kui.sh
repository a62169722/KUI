#!/bin/bash
# 解析参数
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --api) API_DOMAIN="$2"; shift ;;
        --ip) VPS_IP="$2"; shift ;;
        --token) ADMIN_TOKEN="$2"; shift ;;
    esac
    shift
done

if [ -z "$API_DOMAIN" ] || [ -z "$VPS_IP" ] || [ -z "$ADMIN_TOKEN" ]; then
    echo "缺少必要参数！请从 KUI 面板复制完整命令。"
    exit 1
fi

echo ">> 正在初始化 KUI Agent 环境..."
apt-get update -y
apt-get install -y curl wget python3

echo ">> 安装 Sing-box 核心..."
bash <(curl -fsSL https://sing-box.app/deb-install.sh)

echo ">> 下载 Python Agent..."
mkdir -p /opt/kui
# 请替换为你的真实 GitHub Raw 地址
wget -O /opt/kui/agent.py "https://raw.githubusercontent.com/your-username/KUI/main/vps/agent.py"

# 将参数写入 agent 的配置文件
cat <<EOF > /opt/kui/config.json
{
  "api_url": "$API_DOMAIN/api/config",
  "report_url": "$API_DOMAIN/api/report",
  "ip": "$VPS_IP",
  "token": "$ADMIN_TOKEN"
}
EOF

echo ">> 注册 Systemd 守护进程..."
cat <<EOF > /etc/systemd/system/kui-agent.service
[Unit]
Description=KUI Python Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/kui/agent.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable kui-agent
systemctl start kui-agent
systemctl enable sing-box
systemctl start sing-box

echo ">> 安装完成！KUI Agent 已在后台运行，请前往面板查看探针状态。"
