# -*- coding: utf-8 -*-
import urllib.request
import json
import os
import time
import subprocess
import re
import sys
from datetime import datetime

# 强制系统编码锁
if sys.stdout.encoding != 'UTF-8':
    try: sys.stdout.reconfigure(encoding='utf-8')
    except Exception: pass

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

HEADERS = {'Content-Type': 'application/json', 'Authorization': TOKEN, 'User-Agent': 'KUI-Unified-Agent/2.0'}
last_reported_bytes = {}
argo_tunnels = {}
prev_cpu_total = prev_cpu_idle = 0
prev_rx = prev_tx = 0
loop_counter = 0

# 🌟 动态心跳间隔，默认 5 秒
global_interval = 5

# 🌟 增加全局 Ping 状态缓存锁，防止在非测速轮次上传 '0' 导致前端图表归零
last_pings = {"ct": "0", "cu": "0", "cm": "0", "bd": "0"}

# --- 缓存静态信息 ---
cached_os = cached_arch = cached_cpu_info = cached_virt = None

def get_static_sysinfo():
    global cached_os, cached_arch, cached_cpu_info, cached_virt
    if not cached_os:
        try:
            with open('/etc/os-release') as f:
                for line in f:
                    if line.startswith('PRETTY_NAME='):
                        cached_os = line.split('=')[1].strip().strip('"')
                        break
        except: cached_os = os.popen('uname -srm').read().strip()
    if not cached_arch: cached_arch = os.popen('uname -m').read().strip()
    if not cached_cpu_info:
        try:
            with open('/proc/cpuinfo') as f:
                for line in f:
                    if 'model name' in line:
                        cached_cpu_info = line.split(':')[1].strip()
                        break
        except: cached_cpu_info = "Unknown CPU"
    if not cached_virt:
        virt = os.popen('systemd-detect-virt 2>/dev/null').read().strip()
        if not virt or virt == 'none':
            if 'lxc' in open('/proc/1/environ', 'r', errors='ignore').read(): virt = 'lxc'
            elif 'docker' in open('/proc/1/environ', 'r', errors='ignore').read(): virt = 'docker'
            elif os.path.exists('/proc/user_beancounters'): virt = 'openvz'
            elif 'kvm' in open('/proc/cpuinfo', 'r', errors='ignore').read().lower(): virt = 'kvm'
            elif 'qemu' in open('/proc/cpuinfo', 'r', errors='ignore').read().lower(): virt = 'qemu'
            else: virt = "KVM/Physical"
        cached_virt = virt.upper()
    return cached_os, cached_arch, cached_cpu_info, cached_virt

def get_http_ping(url):
    try:
        out = subprocess.check_output(f'curl -o /dev/null -s -m 2 -w "%{{time_total}}" "http://{url}"', shell=True).decode().strip()
        return str(int(float(out) * 1000))
    except: return "0"

def get_net_dev_bytes():
    rx = tx = 0
    try:
        with open('/proc/net/dev') as f:
            lines = f.readlines()[2:]
            for line in lines:
                parts = line.split()
                if parts[0] != 'lo:':
                    rx += int(parts[1])
                    tx += int(parts[9])
    except: pass
    return rx, tx

def ensure_firewall_open(port):
    port = str(port)
    for protocol in ["tcp", "udp"]:
        cmds = [
            f"iptables -C INPUT -p {protocol} --dport {port} -j ACCEPT 2>/dev/null || iptables -I INPUT -p {protocol} --dport {port} -j ACCEPT",
            f"iptables -C OUTPUT -p {protocol} --sport {port} -j ACCEPT 2>/dev/null || iptables -I OUTPUT -p {protocol} --sport {port} -j ACCEPT",
            f"ip6tables -C INPUT -p {protocol} --dport {port} -j ACCEPT 2>/dev/null || ip6tables -I INPUT -p {protocol} --dport {port} -j ACCEPT",
            f"ip6tables -C OUTPUT -p {protocol} --sport {port} -j ACCEPT 2>/dev/null || ip6tables -I OUTPUT -p {protocol} --sport {port} -j ACCEPT"
        ]
        for cmd in cmds: subprocess.run(cmd, shell=True, stderr=subprocess.DEVNULL)
        if subprocess.run("command -v ufw", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            subprocess.run(f"ufw allow {port}/{protocol} >/dev/null 2>&1", shell=True)

def get_port_traffic(port, protocol="tcp"):
    ensure_firewall_open(port)
    try:
        in_bytes = out_bytes = 0
        out_in = subprocess.check_output(f"iptables -nvx -L INPUT | grep 'dpt:{port}'", shell=True).decode()
        in_bytes += sum([int(line.split()[1]) for line in out_in.strip().split('\n') if line])
        out_out = subprocess.check_output(f"iptables -nvx -L OUTPUT | grep 'spt:{port}'", shell=True).decode()
        out_bytes += sum([int(line.split()[1]) for line in out_out.strip().split('\n') if line])
        try:
            out_in6 = subprocess.check_output(f"ip6tables -nvx -L INPUT | grep 'dpt:{port}'", shell=True).decode()
            in_bytes += sum([int(line.split()[1]) for line in out_in6.strip().split('\n') if line])
            out_out6 = subprocess.check_output(f"ip6tables -nvx -L OUTPUT | grep 'spt:{port}'", shell=True).decode()
            out_bytes += sum([int(line.split()[1]) for line in out_out6.strip().split('\n') if line])
        except Exception: pass
        return in_bytes + out_bytes
    except Exception: return 0

def get_system_status(current_interval):
    global prev_cpu_total, prev_cpu_idle, prev_rx, prev_tx, loop_counter, last_pings
    stats = {"cpu": 0, "mem": 0, "disk": 0, "uptime": "Unknown", "load": "0.00", "net_in_speed": 0, "net_out_speed": 0}
    
    try:
        with open('/proc/stat', 'r') as f:
            for line in f:
                if line.startswith('cpu '):
                    p = [float(x) for x in line.split()[1:]]
                    idle, total = p[3] + p[4], sum(p)
                    if prev_cpu_total > 0 and (total - prev_cpu_total) > 0:
                        stats["cpu"] = int(100.0 * (1.0 - (idle - prev_cpu_idle) / (total - prev_cpu_total)))
                    prev_cpu_total, prev_cpu_idle = total, idle
                    break
    except Exception: pass

    try:
        with open('/proc/meminfo', 'r') as f: mem = f.read()
        t = re.search(r'MemTotal:\s+(\d+)', mem); a = re.search(r'MemAvailable:\s+(\d+)', mem)
        u = re.search(r'SwapTotal:\s+(\d+)', mem); v = re.search(r'SwapFree:\s+(\d+)', mem)
        total_ram = int(t.group(1)) // 1024 if t else 0
        avail_ram = int(a.group(1)) // 1024 if a else 0
        used_ram = total_ram - avail_ram
        if total_ram > 0: stats["mem"] = int((used_ram / total_ram) * 100)
        
        stats["ram_total"] = str(total_ram)
        stats["ram_used"] = str(used_ram)
        stats["swap_total"] = str(int(u.group(1)) // 1024) if u else "0"
        stats["swap_used"] = str((int(u.group(1)) - int(v.group(1))) // 1024) if u and v else "0"
    except Exception: pass

    try:
        df = subprocess.check_output("df -m /", shell=True).decode().split('\n')[1].split()
        stats["disk_total"] = df[1]
        stats["disk_used"] = df[2]
        stats["disk"] = int(df[4].replace('%', ''))
    except: pass

    try:
        with open('/proc/loadavg') as f: stats["load"] = " ".join(f.read().split()[:3])
        with open('/proc/uptime') as f:
            up_sec = float(f.read().split()[0])
            d, h, m = int(up_sec//86400), int((up_sec%86400)//3600), int((up_sec%3600)//60)
            stats["uptime"] = f"{d} days, {h:02d}:{m:02d}" if d > 0 else f"{h:02d}:{m:02d}"
        
        stats["boot_time"] = os.popen("uptime -s 2>/dev/null || stat -c %y / 2>/dev/null | cut -d'.' -f1").read().strip()
        stats["processes"] = str(len(os.popen("ps -e").readlines()) - 1)
        stats["tcp_conn"] = os.popen("ss -ant 2>/dev/null | grep -v 'State' | wc -l").read().strip() or "0"
        stats["udp_conn"] = os.popen("ss -anu 2>/dev/null | grep -v 'State' | wc -l").read().strip() or "0"
    except: pass

    rx_now, tx_now = get_net_dev_bytes()
    stats["net_rx"] = str(rx_now); stats["net_tx"] = str(tx_now)
    # 动态除数计算实时网速
    if prev_rx > 0: stats["net_in_speed"] = (rx_now - prev_rx) // current_interval
    if prev_tx > 0: stats["net_out_speed"] = (tx_now - prev_tx) // current_interval
    prev_rx, prev_tx = rx_now, tx_now

    # 🌟 每间隔几次循环更新一次真实的 Ping 值缓存
    if loop_counter % 4 == 0:
        idx = (loop_counter // 4) % 3
        if idx == 0: ct, cu, cm = "bj-ct-dualstack.ip.zstaticcdn.com", "bj-cu-dualstack.ip.zstaticcdn.com", "bj-cm-dualstack.ip.zstaticcdn.com"
        elif idx == 1: ct, cu, cm = "sh-ct-dualstack.ip.zstaticcdn.com", "sh-cu-dualstack.ip.zstaticcdn.com", "sh-cm-dualstack.ip.zstaticcdn.com"
        else: ct, cu, cm = "gd-ct-dualstack.ip.zstaticcdn.com", "gd-cu-dualstack.ip.zstaticcdn.com", "gd-cm-dualstack.ip.zstaticcdn.com"
        last_pings["ct"] = get_http_ping(ct)
        last_pings["cu"] = get_http_ping(cu)
        last_pings["cm"] = get_http_ping(cm)
        last_pings["bd"] = get_http_ping("lf3-ips.zstaticcdn.com")

    # 把最近一次成功的 Ping 值塞入状态发给后端，避免前端由于读到0产生断崖
    stats["ping_ct"] = last_pings["ct"]
    stats["ping_cu"] = last_pings["cu"]
    stats["ping_cm"] = last_pings["cm"]
    stats["ping_bd"] = last_pings["bd"]

    os_info, arch, cpu_info, virt = get_static_sysinfo()
    stats.update({"os": os_info, "arch": arch, "cpu_info": cpu_info, "virt": virt})

    loop_counter += 1
    return stats

def ensure_cloudflared():
    if not os.path.exists("/usr/local/bin/cloudflared"):
        os.system("curl -L -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /usr/local/bin/cloudflared")

def process_argo_nodes(configs):
    argo_urls = []
    expected_ports = [str(n['port']) for n in configs if n.get('protocol') == 'VLESS-Argo']
    for port in expected_ports:
        if port not in argo_tunnels:
            ensure_cloudflared()
            cmd = ["/usr/local/bin/cloudflared", "tunnel", "--edge-ip-version", "auto", "--no-autoupdate", "--url", f"http://[::1]:{port}"]
            p = subprocess.Popen(cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True)
            url = None; start_t = time.time()
            while time.time() - start_t < 15:
                line = p.stderr.readline()
                if not line: break
                m = re.search(r'https://([a-zA-Z0-9-]+\.trycloudflare\.com)', line)
                if m: url = m.group(1); break
            if url: argo_tunnels[port] = {"proc": p, "url": url}
        if port in argo_tunnels: argo_urls.append({"id": [n['id'] for n in configs if str(n['port'])==port][0], "url": argo_tunnels[port]["url"]})
    for port in list(argo_tunnels.keys()):
        if port not in expected_ports:
            argo_tunnels[port]["proc"].terminate()
            del argo_tunnels[port]
    return argo_urls

def build_singbox_config(nodes):
    singbox_config = {
        "log": {"level": "warn"},
        "inbounds": [],
        "outbounds": [{"type": "direct", "tag": "direct-out"}],
        "route": {"rules": []}
    }
    active_certs = []

    for node in nodes:
        in_tag, proto, port = f"in-{node['id']}", node["protocol"], int(node["port"])
        sni = node.get("sni") or "addons.mozilla.org"
        clean_uuid = node['uuid'].replace('-', '')
        
        if proto in ["Hysteria2", "TUIC", "Trojan", "VLESS-WS-TLS", "AnyTLS", "Naive"]:
            cert_path, key_path = f"/opt/kui/cert_{node['id']}.pem", f"/opt/kui/key_{node['id']}.pem"
            active_certs.extend([f"cert_{node['id']}.pem", f"key_{node['id']}.pem"])
            if not os.path.exists(cert_path):
                parts = sni.split('.'); cn = f"{parts[-2]}.{parts[-1]}" if len(parts) >= 2 else sni
                conf_path = f"/opt/kui/cert_{node['id']}.conf"
                with open(conf_path, "w") as f: f.write(f"[req]\ndistinguished_name = req_distinguished_name\nx509_extensions = v3_req\nprompt = no\n[req_distinguished_name]\nCN = {cn}\n[v3_req]\nsubjectAltName = @alt_names\n[alt_names]\nDNS = {sni}\n")
                os.system(f"openssl ecparam -genkey -name prime256v1 -out {key_path} >/dev/null 2>&1")
                os.system(f"openssl req -new -x509 -days 36500 -key {key_path} -out {cert_path} -config {conf_path} -extensions v3_req >/dev/null 2>&1")
                os.system(f"chmod 644 {cert_path} {key_path}")
                try: os.remove(conf_path)
                except: pass
        
        if proto == "VLESS": singbox_config["inbounds"].append({"type": "vless", "tag": in_tag, "listen": "::", "listen_port": port, "users": [{"uuid": node["uuid"]}]})
        elif proto in ["XTLS-Reality", "Reality"]: singbox_config["inbounds"].append({"type": "vless", "tag": in_tag, "listen": "::", "listen_port": port, "users": [{"uuid": node["uuid"], "flow": "xtls-rprx-vision"}], "tls": {"enabled": True, "server_name": sni, "reality": {"enabled": True, "handshake": {"server": sni, "server_port": 443}, "private_key": node["private_key"], "short_id": [node["short_id"]]}}})
        elif proto == "Hysteria2": singbox_config["inbounds"].append({"type": "hysteria2", "tag": in_tag, "listen": "::", "listen_port": port, "users": [{"password": node["uuid"]}], "tls": {"enabled": True, "alpn": ["h3"], "certificate_path": cert_path, "key_path": key_path}, "port_jump": true})
        elif proto == "TUIC": singbox_config["inbounds"].append({"type": "tuic", "tag": in_tag, "listen": "::", "listen_port": port, "users": [{"uuid": node["uuid"], "password": node["private_key"]}], "tls": {"enabled": True, "alpn": ["h3"], "certificate_path": cert_path, "key_path": key_path}})
        elif proto == "Trojan": singbox_config["inbounds"].append({"type": "trojan", "tag": in_tag, "listen": "::", "listen_port": port, "users": [{"password": node["private_key"]}], "tls": {"enabled": True, "server_name": sni, "certificate_path": cert_path, "key_path": key_path}})
        elif proto == "H2-Reality": singbox_config["inbounds"].append({"type": "vless", "tag": in_tag, "listen": "::", "listen_port": port, "users": [{"uuid": node["uuid"]}], "tls": {"enabled": True, "server_name": sni, "reality": {"enabled": True, "handshake": {"server": sni, "server_port": 443}, "private_key": node["private_key"], "short_id": [node["short_id"]]}}, "transport": {"type": "http"}})
        elif proto == "gRPC-Reality": singbox_config["inbounds"].append({"type": "vless", "tag": in_tag, "listen": "::", "listen_port": port, "users": [{"uuid": node["uuid"]}], "tls": {"enabled": True, "server_name": sni, "reality": {"enabled": True, "handshake": {"server": sni, "server_port": 443}, "private_key": node["private_key"], "short_id": [node["short_id"]]}}, "transport": {"type": "grpc", "service_name": "grpc"}})
        elif proto == "AnyTLS": singbox_config["inbounds"].append({"type": "anytls", "tag": in_tag, "listen": "::", "listen_port": port, "users": [{"password": node["private_key"]}], "tls": {"enabled": True, "certificate_path": cert_path, "key_path": key_path}})
        elif proto == "Naive": singbox_config["inbounds"].append({"type": "naive", "tag": in_tag, "listen": "::", "listen_port": port, "users": [{"username": node["uuid"], "password": node["private_key"]}], "tls": {"enabled": True, "certificate_path": cert_path, "key_path": key_path}})
        elif proto == "Socks5": singbox_config["inbounds"].append({"type": "socks", "tag": in_tag, "listen": "::", "listen_port": port, "users": [{"username": node["uuid"], "password": node["private_key"]}]})
        elif proto == "VLESS-Argo": singbox_config["inbounds"].append({"type": "vless", "tag": in_tag, "listen": "::", "listen_port": port, "users": [{"uuid": node["uuid"]}], "transport": {"type": "ws", "path": "/"}})
        elif proto == "dokodemo-door":
            singbox_config["inbounds"].append({ "type": "direct", "tag": in_tag, "listen": "::", "listen_port": port })
            out_tag = f"out-{node['id']}"
            if node.get("relay_type") == "internal" and node.get("chain_target"):
                t = node["chain_target"]
                outbound = { "type": t["protocol"].lower(), "tag": out_tag, "server": t["ip"], "server_port": int(t["port"]), "uuid": t["uuid"] }
                if t["protocol"] == "Reality" or t["protocol"] == "XTLS-Reality":
                    outbound["tls"] = { "enabled": True, "server_name": t["sni"], "reality": { "enabled": True, "public_key": t["public_key"], "short_id": t["short_id"] } }
                singbox_config["outbounds"].append(outbound)
            else:
                singbox_config["outbounds"].append({ "type": "direct", "tag": out_tag, "override_address": node["target_ip"], "override_port": int(node["target_port"]) })
            singbox_config["route"]["rules"].append({ "inbound": [in_tag], "outbound": out_tag })

    try:
        for filename in os.listdir("/opt/kui/"):
            if (filename.startswith("cert_") or filename.startswith("key_")) and filename.endswith(".pem"):
                if filename not in active_certs: os.remove(os.path.join("/opt/kui/", filename))
    except Exception: pass

    new_config_str = json.dumps(singbox_config, indent=2)
    old_config_str = ""
    if os.path.exists(SINGBOX_CONF_PATH):
        with open(SINGBOX_CONF_PATH, "r") as f: old_config_str = f.read()

    if new_config_str != old_config_str:
        with open(SINGBOX_CONF_PATH, "w") as f: f.write(new_config_str)
        if os.path.exists("/sbin/openrc-run") or os.path.exists("/etc/alpine-release"): os.system("rc-service sing-box restart >/dev/null 2>&1")
        else: os.system("systemctl restart sing-box >/dev/null 2>&1")

def report_status(current_nodes, argo_urls):
    global last_reported_bytes, global_interval
    status = get_system_status(global_interval)
    status["ip"] = VPS_IP
    status["argo_urls"] = argo_urls
    
    deltas = []
    current_ids = set()
    for node in current_nodes:
        nid, port = node["id"], node["port"]
        current_ids.add(nid)
        proto = "udp" if node["protocol"] in ["Hysteria2", "TUIC"] else "tcp"
        current_bytes = get_port_traffic(port, proto)
        delta = current_bytes - last_reported_bytes.get(nid, current_bytes)
        if delta > 0: deltas.append({ "id": nid, "delta_bytes": delta })
        last_reported_bytes[nid] = current_bytes

    last_reported_bytes = {k: v for k, v in last_reported_bytes.items() if k in current_ids}
    status["node_traffic"] = deltas

    try: 
        req = urllib.request.Request(REPORT_URL, data=json.dumps(status).encode(), headers=HEADERS)
        res = urllib.request.urlopen(req, timeout=5)
        resp_data = json.loads(res.read().decode('utf-8'))
        if resp_data and "interval" in resp_data:
            global_interval = max(1, int(resp_data["interval"]))
    except Exception as e: pass

def fetch_and_apply_configs():
    try:
        res = urllib.request.urlopen(urllib.request.Request(f"{API_URL}?ip={VPS_IP}", headers=HEADERS), timeout=10)
        data = json.loads(res.read().decode('utf-8'))
        if data.get("success"):
            nodes = data.get("configs", [])
            build_singbox_config(nodes)
            return nodes
    except Exception: pass
    return None

if __name__ == "__main__":
    current_active_nodes = []
    time.sleep(2)
    while True:
        fetched_nodes = fetch_and_apply_configs()
        if fetched_nodes is not None: current_active_nodes = fetched_nodes
        argo_urls = process_argo_nodes(current_active_nodes)
        report_status(current_active_nodes, argo_urls)
        time.sleep(global_interval)
