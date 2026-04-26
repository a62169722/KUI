#!/bin/bash

# 解析传入的安装参数
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --api) API_DOMAIN="$2"; shift ;;
        --ip) VPS_IP="$2"; shift ;;
        --token) ADMIN_TOKEN="$2"; shift ;;
    esac
    shift
done

if [ -z "$API_DOMAIN" ] || [ -z "$VPS_IP" ] || [ -z "$ADMIN_TOKEN" ]; then
    echo "缺少参数！请直接在 Web 控制台复制完整的部署命令。"
    exit 1
fi

echo ">> [1/4] 安装必要依赖..."
apt-get update -y >/dev/null 2>&1
apt-get install -y curl wget python3 >/dev/null 2>&1

echo ">> [2/4] 部署 Sing-box 底层核心..."
bash <(curl -fsSL https://sing-box.app/deb-install.sh) >/dev/null 2>&1

echo ">> [3/4] 下载配置 Agent..."
mkdir -p /opt/kui
# 注意：在此处替换你真实的 GitHub RAW 链接
wget -qO /opt/kui/agent.py "https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/YOUR_REPO/main/vps/agent.py"

# 生成 Agent 所需的本地配置
cat <<EOF > /opt/kui/config.json
{
  "api_url": "$API_DOMAIN/api/config",
  "report_url": "$API_DOMAIN/api/report",
  "ip": "$VPS_IP",
  "token": "$ADMIN_TOKEN"
}
EOF

echo ">> [4/4] 注册并启动系统服务..."
cat <<EOF > /etc/systemd/system/kui-agent.service
[Unit]
Description=Serverless Gateway Python Agent
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
systemctl enable kui-agent >/dev/null 2>&1
systemctl restart kui-agent
systemctl enable sing-box >/dev/null 2>&1
systemctl restart sing-box

echo "======================================"
echo " 部署完成！"
echo " 守护进程已常驻后台，请返回网页控制台查看探针心跳。"
echo "======================================"
