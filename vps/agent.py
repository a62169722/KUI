import urllib.request
import json
import os
import time
import subprocess

CONF_FILE = "/opt/kui/config.json"
SINGBOX_CONF_PATH = "/etc/sing-box/config.json"

try:
    with open(CONF_FILE, 'r') as f:
        env = json.load(f)
except Exception:
    print("环境配置读取失败，请检查安装流程。")
    exit(1)

API_URL = env["api_url"]
REPORT_URL = env["report_url"]
VPS_IP = env["ip"]
TOKEN = env["token"]

HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': TOKEN,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
}

# 内存缓存：记录上一次成功上报的 iptables 字节数，用于计算增量(Delta)
last_reported_bytes = {}

def get_system_status():
    try:
        cpu = float(os.popen("top -bn1 | grep load | awk '{printf \"%.2f\", $(NF-2)}'").read().strip())
        mem = float(os.popen("free -m | awk 'NR==2{printf \"%.2f\", $3*100/$2 }'").read().strip())
        return {"cpu": int(cpu), "mem": mem}
    except Exception:
        return {"cpu": 0, "mem": 0}

def get_port_traffic(port, protocol="tcp"):
    """安全地读取 iptables 获取特定端口的上下行字节总和"""
    try:
        # 自动注入 iptables 统计规则 (若不存在则添加，不影响其他应用)
        check_in = f"iptables -C INPUT -p {protocol} --dport {port}"
        if subprocess.run(check_in, shell=True, stderr=subprocess.DEVNULL).returncode != 0:
            subprocess.run(f"iptables -I INPUT -p {protocol} --dport {port}", shell=True)

        check_out = f"iptables -C OUTPUT -p {protocol} --sport {port}"
        if subprocess.run(check_out, shell=True, stderr=subprocess.DEVNULL).returncode != 0:
            subprocess.run(f"iptables -I OUTPUT -p {protocol} --sport {port}", shell=True)

        # 读取匹配端口的统计数据 (-x 精确字节数)
        out_in = subprocess.check_output(f"iptables -nvx -L INPUT | grep 'dpt:{port}'", shell=True).decode()
        in_bytes = sum([int(line.split()[1]) for line in out_in.strip().split('\n') if line])

        out_out = subprocess.check_output(f"iptables -nvx -L OUTPUT | grep 'spt:{port}'", shell=True).decode()
        out_bytes = sum([int(line.split()[1]) for line in out_out.strip().split('\n') if line])

        return in_bytes + out_bytes
    except Exception:
        return 0

def report_status(current_nodes):
    global last_reported_bytes
    status = get_system_status()
    status["ip"] = VPS_IP
    
    # 计算本周期内的流量增量
    node_traffic_deltas = []
    current_ids = set()

    for node in current_nodes:
        nid = node["id"]
        port = node["port"]
        current_ids.add(nid)
        proto = "udp" if node["protocol"] == "Hysteria2" else "tcp"
        
        current_bytes = get_port_traffic(port, proto)
        last_bytes = last_reported_bytes.get(nid, 0)
        
        delta = current_bytes - last_bytes
        # 处理 iptables 计数器因服务器重启归零的情况
        if delta < 0: 
            delta = current_bytes
            
        if delta > 0:
            node_traffic_deltas.append({ "id": nid, "delta_bytes": delta })
        
        last_reported_bytes[nid] = current_bytes

    # 清理已删除节点的缓存
    for old_id in list(last_reported_bytes.keys()):
        if old_id not in current_ids:
            del last_reported_bytes[old_id]

    status["node_traffic"] = node_traffic_deltas

    req = urllib.request.Request(REPORT_URL, data=json.dumps(status).encode('utf-8'), headers=HEADERS)
    try:
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass

def fetch_and_apply_configs():
    req = urllib.request.Request(f"{API_URL}?ip={VPS_IP}", headers=HEADERS)
    try:
        res = urllib.request.urlopen(req, timeout=10)
        data = json.loads(res.read().decode('utf-8'))
        if data.get("success"):
            nodes = data["configs"]
            build_singbox_config(nodes)
            return nodes
    except Exception:
        pass
    return []

def build_singbox_config(nodes):
    singbox_config = {
        "log": {"level": "warn"},
        "inbounds": [],
        "outbounds": [{"type": "direct", "tag": "direct-out"}],
        "route": {"rules": []}
    }

    for node in nodes:
        in_tag = f"in-{node['id']}"
        
        if node["protocol"] == "VLESS":
            singbox_config["inbounds"].append({
                "type": "vless", "tag": in_tag, "listen": "::", "listen_port": int(node["port"]),
                "users": [{"uuid": node["uuid"]}]
            })
            
        elif node["protocol"] == "Reality":
            singbox_config["inbounds"].append({
                "type": "vless", "tag": in_tag, "listen": "::", "listen_port": int(node["port"]),
                "users": [{"uuid": node["uuid"], "flow": "xtls-rprx-vision"}],
                "tls": {
                    "enabled": True, "server_name": node["sni"],
                    "reality": {
                        "enabled": True, "handshake": {"server": node["sni"], "server_port": 443},
                        "private_key": node["private_key"], "short_id": [node["short_id"]]
                    }
                }
            })

        elif node["protocol"] == "Hysteria2":
            cert_path = f"/opt/kui/hy2_{node['id']}_cert.pem"
            key_path = f"/opt/kui/hy2_{node['id']}_key.pem"
            sni = node.get("sni", "www.chiba-u.ac.jp") 

            if not os.path.exists(cert_path) or not os.path.exists(key_path):
                cmd = f'openssl req -x509 -nodes -newkey ec:<(openssl ecparam -name prime256v1) -keyout {key_path} -out {cert_path} -days 3650 -subj "/O=GlobalSign/CN={sni}" 2>/dev/null'
                subprocess.run(cmd, shell=True, executable='/bin/bash')
                subprocess.run(["chmod", "644", cert_path, key_path])

            singbox_config["inbounds"].append({
                "type": "hysteria2", "tag": in_tag, "listen": "::", "listen_port": int(node["port"]),
                "users": [{"password": node["uuid"]}], "up_mbps": 1000, "down_mbps": 1000,
                "tls": { "enabled": True, "alpn": ["h3"], "certificate_path": cert_path, "key_path": key_path }
            })
            
        elif node["protocol"] == "dokodemo-door":
            singbox_config["inbounds"].append({ "type": "direct", "tag": in_tag, "listen": "::", "listen_port": int(node["port"]) })
            out_tag = f"out-{node['id']}"
            
            if node.get("relay_type") == "internal" and node.get("chain_target"):
                t = node["chain_target"]
                outbound = { "type": t["protocol"].lower(), "tag": out_tag, "server": t["ip"], "server_port": int(t["port"]), "uuid": t["uuid"] }
                if t["protocol"] == "Reality":
                    outbound["tls"] = { "enabled": True, "server_name": t["sni"], "reality": { "enabled": True, "public_key": t["public_key"], "short_id": t["short_id"] } }
                singbox_config["outbounds"].append(outbound)
            else:
                singbox_config["outbounds"].append({ "type": "direct", "tag": out_tag, "override_address": node["target_ip"], "override_port": int(node["target_port"]) })
            singbox_config["route"]["rules"].append({ "inbound": [in_tag], "outbound": out_tag })

    new_config_str = json.dumps(singbox_config, indent=2)
    old_config_str = ""
    if os.path.exists(SINGBOX_CONF_PATH):
        with open(SINGBOX_CONF_PATH, "r") as f:
            old_config_str = f.read()

    if new_config_str != old_config_str:
        with open(SINGBOX_CONF_PATH, "w") as f:
            f.write(new_config_str)
        subprocess.run(["systemctl", "restart", "sing-box"])

if __name__ == "__main__":
    current_active_nodes = []
    while True:
        # 先拉取并应用配置（从而确定当前哪些节点是存活的）
        current_active_nodes = fetch_and_apply_configs() or current_active_nodes
        # 再上报这些存活节点的流量增量
        report_status(current_active_nodes)
        time.sleep(60)
