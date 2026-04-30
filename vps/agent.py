# -*- coding: utf-8 -*-
import urllib.request
import json
import os
import time
import subprocess
import re
import sys

# ===============================================
# 强制系统编码锁
# ===============================================
if sys.stdout.encoding != 'UTF-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

CONF_FILE = "/opt/kui/config.json"
SINGBOX_CONF_PATH = "/etc/sing-box/config.json"

try:
    with open(CONF_FILE, 'r') as f:
        env = json.load(f)
except Exception:
    print("Failed to read config file.")
    exit(1)

API_URL = env["api_url"]
REPORT_URL = env["report_url"]
VPS_IP = env["ip"]
TOKEN = env["token"]

HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': TOKEN,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
}

last_reported_bytes = {}
argo_tunnels = {}
prev_cpu_total = 0
prev_cpu_idle = 0
prev_rx = 0
prev_tx = 0
prev_net_time = 0

# ===============================================
# Argo 全自动穿透核心模块
# ===============================================
def ensure_cloudflared():
    if not os.path.exists("/usr/local/bin/cloudflared"):
        print("First Argo node detected. Installing cloudflared silently...")
        os.system("curl -L -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64")
        os.system("chmod +x /usr/local/bin/cloudflared")

def start_argo_tunnel(port):
    ensure_cloudflared()
    cmd = ["/usr/local/bin/cloudflared", "tunnel", "--url", f"http://127.0.0.1:{port}"]
    p = subprocess.Popen(cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True)
    
    url = None
    start_time = time.time()
    while time.time() - start_time < 15:
        line = p.stderr.readline()
        if not line: break
        match = re.search(r'https://([a-zA-Z0-9-]+\.trycloudflare\.com)', line)
        if match:
            url = match.group(1)
            break
    return p, url

def process_argo_nodes(configs):
    argo_urls_to_report = []
    expected_argo_ports = []
    
    for node in configs:
        if node.get('protocol') == 'VLESS-Argo':
            port = str(node['port'])
            expected_argo_ports.append(port)
            if port not in argo_tunnels:
                p, url = start_argo_tunnel(port)
                if url:
                    argo_tunnels[port] = {"proc": p, "url": url}
                    argo_urls_to_report.append({"id": node["id"], "url": url})
            else:
                argo_urls_to_report.append({"id": node["id"], "url": argo_tunnels[port]["url"]})
                
    for port in list(argo_tunnels.keys()):
        if port not in expected_argo_ports:
            argo_tunnels[port]["proc"].terminate()
            del argo_tunnels[port]
            
    return argo_urls_to_report

# ===============================================
# 内核抓取模块 (100%兼容所有Linux) + 精准增量测速
# ===============================================
def get_system_status():
    global prev_cpu_total, prev_cpu_idle, prev_rx, prev_tx, prev_net_time
    stats = {
        "cpu": 0, "mem": 0, "disk": 0, "uptime": "Unknown", 
        "load": "0.00 0.00 0.00", "net_in_speed": 0, "net_out_speed": 0, 
        "tcp_conn": 0, "udp_conn": 0
    }
    
    try:
        with open('/proc/stat', 'r') as f:
            for line in f:
                if line.startswith('cpu '):
                    parts = [float(p) for p in line.split()[1:]]
                    idle = parts[3] + parts[4]
                    total = sum(parts)
                    if prev_cpu_total > 0:
                        diff_total = total - prev_cpu_total
                        diff_idle = idle - prev_cpu_idle
                        if diff_total > 0:
                            stats["cpu"] = int(100.0 * (1.0 - diff_idle / diff_total))
                    prev_cpu_total = total
                    prev_cpu_idle = idle
                    break
    except Exception: pass

    try:
        with open('/proc/meminfo', 'r') as f:
            mem_data = f.read()
        total_match = re.search(r'MemTotal:\s+(\d+)', mem_data)
        avail_match = re.search(r'MemAvailable:\s+(\d+)', mem_data)
        if total_match and avail_match:
            total = float(total_match.group(1))
            avail = float(avail_match.group(1))
            stats["mem"] = round(((total - avail) / total) * 100, 2)
    except Exception: pass

    try:
        st = os.statvfs('/')
        total_disk = st.f_blocks * st.f_frsize
        used_disk = (st.f_blocks - st.f_bfree) * st.f_frsize
        if total_disk > 0:
            stats["disk"] = int((used_disk / total_disk) * 100)
    except Exception: pass

    try:
        with open('/proc/uptime', 'r') as f:
            uptime_seconds = float(f.readline().split()[0])
            days = int(uptime_seconds // 86400)
            hours = int((uptime_seconds % 86400) // 3600)
            mins = int((uptime_seconds % 3600) // 60)
            stats["uptime"] = f"{days} Day, {hours}:{mins:02d}"
    except Exception: pass

    try:
        with open('/proc/loadavg', 'r') as f:
            stats["load"] = " ".join(f.readline().split()[:3])
    except Exception: pass

    try:
        stats["tcp_conn"] = int(os.popen("ss -ant 2>/dev/null | grep -v State | wc -l").read().strip() or 0)
        stats["udp_conn"] = int(os.popen("ss -anu 2>/dev/null | grep -v State | wc -l").read().strip() or 0)
    except Exception: pass

    try:
        rx_now = 0
        tx_now = 0
        with open('/proc/net/dev', 'r') as f:
            lines = f.readlines()[2:]
            for line in lines:
                parts = line.split()
                if len(parts) > 10 and not parts[0].startswith('lo'):
                    rx_now += int(parts[1])
                    tx_now += int(parts[9])
        
        now_t = time.time()
        if prev_rx > 0 and prev_tx > 0 and prev_net_time > 0:
            delta_t = now_t - prev_net_time
            if delta_t > 0:
                stats["net_in_speed"] = int((rx_now - prev_rx) / delta_t)
                stats["net_out_speed"] = int((tx_now - prev_tx) / delta_t)
        
        prev_rx = rx_now
        prev_tx = tx_now
        prev_net_time = now_t
    except Exception: pass

    return stats

# ===============================================
# 节点流量精准抓取模块 (增加防火墙规则防抖优化)
# ===============================================
checked_ports = set()

def get_port_traffic(port, protocol="tcp"):
    global checked_ports
    try:
        if port not in checked_ports:
            check_in = f"iptables -C INPUT -p {protocol} --dport {port}"
            if subprocess.run(check_in, shell=True, stderr=subprocess.DEVNULL).returncode != 0:
                subprocess.run(f"iptables -I INPUT -p {protocol} --dport {port}", shell=True)

            check_out = f"iptables -C OUTPUT -p {protocol} --sport {port}"
            if subprocess.run(check_out, shell=True, stderr=subprocess.DEVNULL).returncode != 0:
                subprocess.run(f"iptables -I OUTPUT -p {protocol} --sport {port}", shell=True)
            checked_ports.add(port)

        out_in = subprocess.check_output(f"iptables -nvx -L INPUT | grep 'dpt:{port}'", shell=True).decode()
        in_bytes = sum([int(line.split()[1]) for line in out_in.strip().split('\n') if line])

        out_out = subprocess.check_output(f"iptables -nvx -L OUTPUT | grep 'spt:{port}'", shell=True).decode()
        out_bytes = sum([int(line.split()[1]) for line in out_out.strip().split('\n') if line])

        return in_bytes + out_bytes
    except Exception:
        return 0

# ===============================================
# 云端通讯模块
# ===============================================
def report_status(current_nodes, argo_urls):
    global last_reported_bytes
    status = get_system_status()
    status["ip"] = VPS_IP
    status["argo_urls"] = argo_urls
    
    node_traffic_deltas = []
    current_ids = set()

    for node in current_nodes:
        nid = node["id"]
        port = node["port"]
        current_ids.add(nid)
        proto = "udp" if node["protocol"] in ["Hysteria2", "TUIC"] else "tcp"
        
        current_bytes = get_port_traffic(port, proto)
        last_bytes = last_reported_bytes.get(nid, 0)
        
        delta = current_bytes - last_bytes
        if delta < 0: delta = current_bytes
        if delta > 0: node_traffic_deltas.append({ "id": nid, "delta_bytes": delta })
        
        last_reported_bytes[nid] = current_bytes

    for old_id in list(last_reported_bytes.keys()):
        if old_id not in current_ids:
            del last_reported_bytes[old_id]

    status["node_traffic"] = node_traffic_deltas

    req = urllib.request.Request(REPORT_URL, data=json.dumps(status).encode('utf-8'), headers=HEADERS)
    try:
        res = urllib.request.urlopen(req, timeout=5)
        return json.loads(res.read().decode('utf-8'))
    except Exception:
        return None

def fetch_and_apply_configs():
    req = urllib.request.Request(f"{API_URL}?ip={VPS_IP}", headers=HEADERS)
    try:
        res = urllib.request.urlopen(req, timeout=10)
        data = json.loads(res.read().decode('utf-8'))
        if data.get("success"):
            nodes = data.get("configs", [])
            build_singbox_config(nodes)
            return nodes
    except Exception:
        pass
    return None

# ===============================================
# Sing-box 全协议底层配置引擎
# ===============================================
def build_singbox_config(nodes):
    singbox_config = {
        "log": {"level": "warn"},
        "inbounds": [],
        "outbounds": [{"type": "direct", "tag": "direct-out"}],
        "route": {"rules": []}
    }

    active_certs = []

    for node in nodes:
        in_tag = f"in-{node['id']}"
        proto = node["protocol"]
        
        if proto == "VLESS":
            singbox_config["inbounds"].append({
                "type": "vless", "tag": in_tag, "listen": "::", "listen_port": int(node["port"]),
                # 🌟 修复：补全 name 字段
                "users": [{"name": node["uuid"], "uuid": node["uuid"]}]
            })
            
        elif proto == "Reality":
            singbox_config["inbounds"].append({
                "type": "vless", "tag": in_tag, "listen": "::", "listen_port": int(node["port"]),
                # 🌟 修复：补全 name 字段
                "users": [{"name": node["uuid"], "uuid": node["uuid"], "flow": "xtls-rprx-vision"}],
                "tls": {
                    "enabled": True,
                    # 🌟 核心修复：移除死板的 server_name 强校验，避免阻断客户端握手
                    "reality": {
                        "enabled": True, "handshake": {"server": node["sni"], "server_port": 443},
                        "private_key": node["private_key"], "short_id": [node["short_id"]]
                    }
                }
            })

        elif proto in ["Hysteria2", "TUIC"]:
            cert_path = f"/opt/kui/cert_{node['id']}.pem"
            key_path = f"/opt/kui/key_{node['id']}.pem"
            sni = node.get("sni", "www.apple.com")
            
            active_certs.extend([f"cert_{node['id']}.pem", f"key_{node['id']}.pem"])

            if not os.path.exists(cert_path) or not os.path.exists(key_path):
                cmd = f'openssl ecparam -genkey -name prime256v1 -out {key_path} && openssl req -new -x509 -nodes -days 3650 -key {key_path} -out {cert_path} -subj "/O=GlobalSign/CN={sni}" 2>/dev/null'
                subprocess.run(cmd, shell=True)
                subprocess.run(["chmod", "644", cert_path, key_path])

            if proto == "Hysteria2":
                singbox_config["inbounds"].append({
                    "type": "hysteria2", "tag": in_tag, "listen": "::", "listen_port": int(node["port"]),
                    # 🌟 修复：补全 name 字段
                    "users": [{"name": node["uuid"], "password": node["uuid"]}],
                    "tls": { "enabled": True, "alpn": ["h3"], "certificate_path": cert_path, "key_path": key_path }
                })
            elif proto == "TUIC":
                singbox_config["inbounds"].append({
                    "type": "tuic", "tag": in_tag, "listen": "::", "listen_port": int(node["port"]),
                    # 🌟 修复：补全 name 字段
                    "users": [{"name": node["uuid"], "uuid": node["uuid"], "password": node["private_key"]}],
                    "tls": { "enabled": True, "alpn": ["h3"], "certificate_path": cert_path, "key_path": key_path }
                })

        elif proto == "SS2022":
            singbox_config["inbounds"].append({
                "type": "shadowsocks", "tag": in_tag, "listen": "::", "listen_port": int(node["port"]),
                "method": node.get("sni", "2022-blake3-aes-128-gcm"),
                "password": node["private_key"]
            })

        elif proto == "VLESS-Argo":
            singbox_config["inbounds"].append({
                "type": "vless", "tag": in_tag, "listen": "127.0.0.1", "listen_port": int(node["port"]),
                # 🌟 修复：补全 name 字段
                "users": [{"name": node["uuid"], "uuid": node["uuid"]}],
                "transport": {"type": "ws", "path": "/"}
            })
            
        elif proto == "Socks5":
            singbox_config["inbounds"].append({
                "type": "socks", "tag": in_tag, "listen": "::", "listen_port": int(node["port"]),
                "users": [{"username": node["uuid"], "password": node["private_key"]}]
            })
            
        elif proto == "dokodemo-door":
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

    try:
        for filename in os.listdir("/opt/kui/"):
            if (filename.startswith("cert_") or filename.startswith("key_")) and filename.endswith(".pem"):
                if filename not in active_certs:
                    os.remove(os.path.join("/opt/kui/", filename))
    except Exception:
        pass

    new_config_str = json.dumps(singbox_config, indent=2)
    old_config_str = ""
    if os.path.exists(SINGBOX_CONF_PATH):
        with open(SINGBOX_CONF_PATH, "r") as f:
            old_config_str = f.read()

    if new_config_str != old_config_str:
        with open(SINGBOX_CONF_PATH, "w") as f:
            f.write(new_config_str)
        if os.path.exists("/sbin/openrc-run") or os.path.exists("/etc/alpine-release"):
            subprocess.run(["rc-service", "sing-box", "restart"])
        else:
            subprocess.run(["systemctl", "restart", "sing-box"])

# ===============================================
# 🌟 极速主循环引擎 (Fast-Mode)
# ===============================================
if __name__ == "__main__":
    current_active_nodes = []
    
    last_config_fetch = 0
    last_report_time = 0
    fast_mode = False
    
    time.sleep(1)
    
    while True:
        now = time.time()

        if now - last_config_fetch >= 60:
            fetched_nodes = fetch_and_apply_configs()
            if fetched_nodes is not None:
                current_active_nodes = fetched_nodes
            last_config_fetch = now

        target_interval = 2 if fast_mode else 15
        
        if now - last_report_time >= target_interval:
            argo_urls = process_argo_nodes(current_active_nodes)
            res_json = report_status(current_active_nodes, argo_urls)
            
            if res_json and isinstance(res_json, dict) and res_json.get("fast_mode"):
                fast_mode = True
            else:
                fast_mode = False
                
            last_report_time = time.time()
        
        time.sleep(1)
