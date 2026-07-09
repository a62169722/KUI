#!/usr/bin/env python3
import base64, csv, os, subprocess, threading, time, urllib.request, json, ipaddress
from pathlib import Path
import proxy_server

API_URL = "https://www.vpngate.net/api/iphone/"
C2_URL = os.environ.get("C2_URL", "https://YOUR_CONTROLLER_DOMAIN")
# 控制器 API 前缀：本地 (CF Pages) 控制器为 /api/proxy；独立部署的原版控制器为 /api
C2_API_PREFIX = os.environ.get("C2_API_PREFIX", "/api/proxy")

WORKSPACE = Path("/opt/proxy_lite")
CONFIG_DIR = WORKSPACE / "configs"
AUTH_FILE = WORKSPACE / "auth.txt"

WEB_USER = os.environ.get("WEB_USER", "admin")
WEB_PASS = os.environ.get("WEB_PASS", "admin888")

PROXY_PORT = 7920
target_country = "JP"
last_switch_trigger = 0
last_config_sync = 0

state_lock = threading.Lock()
dead_ips = set()
last_blacklist_clear = time.time()
public_ip = ""

global_node_reservoir = {} 
reservoir_lock = threading.Lock()

class Tunnel:
    def __init__(self, name: str, table_id: int):
        self.name = name
        self.table_id = table_id
        self.process = None
        self.node = None
        self.entry_ip = ""
        self.egress_ip = ""
        self.country = ""
        self.ready = False
        self.connected_at = 0
        self.is_connecting = False

tun_main = Tunnel("tun_main", 101)
tun_backup = Tunnel("tun_backup", 102)

def penalize_node(ip: str, penalty: int):
    """
    节点信誉动态降级机制：
    给不可用或低质的节点加上高额的虚拟 ping 值惩罚，
    确保下一次调度排序时，该节点被永久压入蓄水池底部，从而避免"死循环假性枯竭"。
    """
    with reservoir_lock:
        if ip in global_node_reservoir:
            global_node_reservoir[ip]["ping"] += penalty

def get_public_ip():
    global public_ip
    try:
        req = urllib.request.Request("https://api.ipify.org", headers={"User-Agent": "curl/7.68.0"})
        with urllib.request.urlopen(req, timeout=5) as res:
            public_ip = res.read().decode("utf-8").strip()
        if public_ip and ':' in public_ip:
            raise ValueError("Got IPv6")
    except:
        try:
            req = urllib.request.Request("https://api.ipify.org?format=text",
                                          headers={"User-Agent": "curl/7.68.0"})
            with urllib.request.urlopen(req, timeout=5) as res:
                public_ip = res.read().decode("utf-8").strip()
        except:
            public_ip = "Unknown_IP"

def get_c2_headers():
    auth_ptr = base64.b64encode(f"{WEB_USER}:{WEB_PASS}".encode()).decode()
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Authorization": f"Basic {auth_ptr}"
    }

def get_recent_logs():
    try:
        res = subprocess.run(["journalctl", "-u", "proxy-lite.service", "-n", "30", "--no-pager", "--output=cat"], capture_output=True, text=True, errors="replace")
        return res.stdout
    except: return "Waiting for logs..."

def fetch_controller_config():
    """拉取控制器下发的配置，仅使用代理控制器专用端点。
    注意：/api/config 和 /config 返回的是节点配置而非代理配置，
    缺少 "0"/"country" 字段，使用后会迫使 desired_country 回退为 "JP"，
    导致 VPS 永远无法感知地区变更。
    """
    base = C2_URL.rstrip('/')
    url = f"{base}{C2_API_PREFIX}/config"
    try:
        req = urllib.request.Request(url, headers=get_c2_headers())
        with urllib.request.urlopen(req, timeout=10) as res:
            raw = res.read().decode("utf-8")
            data = json.loads(raw)
            if isinstance(data, dict) and (data.get("0") or data.get("country")):
                print(f"[cfg] 拉取配置成功: {raw}", flush=True)
                return data
            else:
                print(f"[cfg] 端点返回数据缺少地区字段(0/country)，跳过: {raw}", flush=True)
    except Exception as e:
        print(f"[cfg] 拉取配置失败({url}): {e}", flush=True)
    return None

def update_config_loop():
    global target_country, last_switch_trigger, PROXY_PORT, tun_main, tun_backup
    while True:
        try:
            data = fetch_controller_config()
            if not data:
                time.sleep(15)
                continue
            desired_country = str(data.get("0") or data.get("country") or "JP").upper()
            switch_trigger = int(data.get("switch_trigger", 0))
            new_port = int(data.get("port", 7920))
            # 同步代理凭证到 proxy_server 模块（让其实时生效，无需重启进程）
            try:
                pc = data.get("proxy") or {}
                if isinstance(pc, dict):
                    pu = str(pc.get("user", "")) or os.environ.get("PROXY_USER", "proxy")
                    pp = str(pc.get("pass", "")) or os.environ.get("PROXY_PASS", "888888")
                    os.environ["PROXY_USER"] = pu
                    os.environ["PROXY_PASS"] = pp
                    if hasattr(proxy_server, "set_credentials"):
                        proxy_server.set_credentials(pu, pp)
                    else:
                        proxy_server.PROXY_USER = pu.encode()
                        proxy_server.PROXY_PASS = pp.encode()
                    print(f"[cfg] 凭证同步: user={pu}, pass={'*' * len(pp)}", flush=True)
            except Exception as e:
                print(f"[cfg] 凭证同步失败: {e}", flush=True)
            print(f"[cfg] 解析: country={desired_country}, port={new_port}, trigger={switch_trigger}, current_country={target_country}", flush=True)
                
            if new_port != PROXY_PORT:
                print(f"[*] 收到端口变更指令 ({PROXY_PORT} -> {new_port})，重启守护进程...", flush=True)
                os._exit(0)
            
            with state_lock:
                force_switch = (switch_trigger > last_switch_trigger)
                if target_country != desired_country or force_switch:
                    target_country = desired_country
                    if force_switch: print(f"[*] 收到强制更换指令，正在清退通道并拉黑当前 IP...", flush=True)
                    else: print(f"[*] 策略热切换: 目标重定向到 {desired_country}...", flush=True)
                    
                    if tun_main.entry_ip: dead_ips.add(tun_main.entry_ip)
                    if tun_main.process:
                        try: tun_main.process.terminate(); tun_main.process.wait(2)
                        except: tun_main.process.kill()
                    tun_main.ready = False; tun_main.process = None; tun_main.entry_ip = ""; tun_main.egress_ip = ""
                    
                    if tun_backup.process:
                        try: tun_backup.process.terminate(); tun_backup.process.wait(2)
                        except: tun_backup.process.kill()
                    tun_backup.ready = False; tun_backup.process = None; tun_backup.entry_ip = ""; tun_backup.egress_ip = ""
                    
                    last_switch_trigger = switch_trigger
        except Exception as e:
            print(f"[cfg] 拉取配置失败: {e}", flush=True)
        time.sleep(15)

def c2_heartbeat_loop():
    global public_ip, PROXY_PORT, tun_main, tun_backup
    while True:
        if not public_ip or public_ip == "Unknown_IP": get_public_ip()
        details = []
        with state_lock:
            for tun in [tun_main, tun_backup]:
                if tun.ready and tun.process and tun.process.poll() is None:
                    uptime = time.time() - tun.connected_at
                    details.append({
                        "tunnel": tun.name,
                        "active": proxy_server.ACTIVE_BIND == tun.name,
                        "country": tun.country, 
                        "port": PROXY_PORT, 
                        "connected_time": int(uptime), 
                        "node_ip": tun.egress_ip if tun.egress_ip else tun.entry_ip
                    })
        
        payload = json.dumps({"ip": public_ip, "details": details, "logs": get_recent_logs()}).encode('utf-8')
        try:
            req = urllib.request.Request(f"{C2_URL}{C2_API_PREFIX}/report", data=payload, headers=get_c2_headers(), method='POST')
            urllib.request.urlopen(req, timeout=10)
        except Exception as e: pass
        time.sleep(8)

def setup_env():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if not AUTH_FILE.exists():
        AUTH_FILE.write_text("vpn\nvpn\n", encoding="utf-8")
        AUTH_FILE.chmod(0o600)
    subprocess.run(["sysctl", "-w", "net.ipv4.conf.all.rp_filter=2"], capture_output=True)
    subprocess.run(["sysctl", "-w", "net.ipv4.conf.default.rp_filter=2"], capture_output=True)
    subprocess.run(["sysctl", "-w", "net.ipv4.ip_forward=1"], capture_output=True)
    subprocess.run(["sysctl", "-w", "net.ipv6.conf.all.forwarding=1"], capture_output=True)

def harvest_snapshot_nodes() -> list:
    try:
        req = urllib.request.Request(API_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as res: text = res.read().decode("utf-8", errors="replace")
        lines = [line for line in text.splitlines() if line and not line.startswith("*")]
        if lines and lines[0].startswith("#"): lines[0] = lines[0][1:]
        nodes = []
        for row in csv.DictReader(lines):
            ip = row.get("IP")
            if not ip or not row.get("OpenVPN_ConfigData_Base64"): continue
            raw_ping = row.get("Ping", "")
            nodes.append({
                "ip": ip, 
                "ping": int(raw_ping) if raw_ping.isdigit() else 9999, 
                "country": row.get("CountryShort", "").upper(), 
                "config": base64.b64decode(row["OpenVPN_ConfigData_Base64"]).decode("utf-8", errors="replace"),
                "harvested_at": time.time()
            })
        return nodes
    except Exception as e: return []

def vpngate_fetch_loop():
    global global_node_reservoir, dead_ips
    while True:
        snapshot = harvest_snapshot_nodes()
        if snapshot:
            with reservoir_lock:
                for n in snapshot:
                    # 保留原有的惩罚性 ping 值，防止坏节点被新抓取的快照刷新后又跑到前列去
                    if n["ip"] in global_node_reservoir:
                        n["ping"] = max(n["ping"], global_node_reservoir[n["ip"]]["ping"])
                    global_node_reservoir[n["ip"]] = n
            print(f"[*] ⚡ 节点库更新，当前囤积有效节点 -> {len(global_node_reservoir)} 个", flush=True)
        else:
            # FIX 3: 如果 VPNGate 接口被限流或不通，延长现有节点的生命周期，防止库干涸
            with reservoir_lock:
                now = time.time()
                for n in global_node_reservoir.values():
                    n["harvested_at"] = now
        time.sleep(300)

def setup_routing(tun_name: str, table_id: int):
    subprocess.run(["ip", "rule", "del", "pref", str(table_id)], capture_output=True)
    subprocess.run(["ip", "rule", "del", "pref", str(table_id + 1000)], capture_output=True)
    subprocess.run(["ip", "route", "flush", "table", str(table_id)], capture_output=True)
    subprocess.run(["ip", "route", "add", "default", "dev", tun_name, "table", str(table_id)], capture_output=True)
    subprocess.run(["ip", "rule", "add", "oif", tun_name, "lookup", str(table_id), "pref", str(table_id)], capture_output=True)
    subprocess.run(["ip", "rule", "add", "iif", tun_name, "lookup", str(table_id), "pref", str(table_id + 1000)], capture_output=True)

def connect_node(tun: Tunnel, node: dict):
    global dead_ips
    try:
        cfg_path = CONFIG_DIR / f"{tun.name}.ovpn"
        log_file = WORKSPACE / f"{tun.name}_err.log"
        cfg_path.write_text(node["config"], encoding="utf-8")
        
        ovpn_version = subprocess.run(["openvpn", "--version"], capture_output=True, text=True).stdout
        cipher_args = ["--ncp-ciphers", "AES-128-CBC:AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305"] if "2.4" in ovpn_version else ["--data-ciphers", "AES-128-CBC:AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305", "--data-ciphers-fallback", "AES-128-CBC"]
        
        # 强制添加 --nobind 解除端口冲突，--route-nopull 剥夺路由修改权
        cmd = ["openvpn", "--config", str(cfg_path), "--dev", tun.name, "--dev-type", "tun", 
               "--nobind", "--route-nopull",
               "--pull-filter", "ignore", "route-ipv6", "--pull-filter", "ignore", "ifconfig-ipv6", 
               "--auth-user-pass", str(AUTH_FILE),
               "--connect-timeout", "5", "--connect-retry-max", "1", "--verb", "3"] + cipher_args
               
        with open(log_file, "w") as f: process = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT)
        
        success = False
        for _ in range(15):
            time.sleep(1)
            if process.poll() is not None: break
            try:
                if "Initialization Sequence Completed" in log_file.read_text():
                    success = True; break
            except: pass
                
        if success and process.poll() is None:
            setup_routing(tun.name, tun.table_id)
            time.sleep(1) 
            
            # --- 穿透获取通道真实出口 IP（纯IPv6+WARP兼容） ---
            true_ip = ""
            try:
                true_ip_res = subprocess.run(["curl", "-s", "-m", "10", "--interface", tun.name, "-4", "https://api.ipify.org"], capture_output=True, text=True)
                candidate_ip = true_ip_res.stdout.strip()
                try:
                    ipaddress.IPv4Address(candidate_ip)
                    true_ip = candidate_ip
                except (ipaddress.AddressValueError, ValueError):
                    pass
            except: pass

            if not true_ip:
                try:
                    true_ip_res = subprocess.run(["curl", "-s", "-m", "10", "--interface", tun.name, "-6", "https://api6.ipify.org"], capture_output=True, text=True)
                    candidate_ip = true_ip_res.stdout.strip()
                    try:
                        ipaddress.IPv6Address(candidate_ip)
                        true_ip = candidate_ip
                    except (ipaddress.AddressValueError, ValueError):
                        pass
                except: pass

            egress_ip = true_ip if true_ip else node['ip']

            if true_ip and true_ip != node['ip']:
                print(f"[*] {tun.name} 探测到真实出口 IP 与入口不一致: 入口 {node['ip']} -> 出口 {true_ip}", flush=True)

            is_residential = True
            try:
                req_url = f"https://testisp.info/api/check?ip={egress_ip}"
                check_req = urllib.request.Request(req_url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"}, method="GET")
                with urllib.request.urlopen(check_req, timeout=10) as check_res:
                    data = json.loads(check_res.read().decode("utf-8"))
                    print(f"[*] {tun.name} testisp.info 报告 {egress_ip}: {data.get('isp',{})} / native={data.get('geo',{}).get('is_native','?')}", flush=True)
                    isp = data.get("isp", {})
                    geo = data.get("geo", {})
                    isp_flag = str(isp.get("flag", "")).lower()
                    isp_type = str(isp.get("type", "")).lower()
                    isp_warn = str(isp.get("warning", "")).lower()
                    is_native = geo.get("is_native", False)
                    
                    # 综合判断：仅凭 isp.flag == "hosting" 不够可靠
                    # 真机房判定：flag=hosting 且 type 不含 isp/broadband/dsl/cable 且 is_native=False
                    if isp_flag == "hosting":
                        residential_indicators = [
                            "isp" in isp_type,
                            "broadband" in isp_type,
                            "dsl" in isp_type,
                            "cable" in isp_type,
                            is_native is True,
                            "hosting" not in isp_warn and "datacenter" not in isp_warn
                        ]
                        if not any(residential_indicators):
                            is_residential = False
            except Exception as e:
                print(f"[*] {tun.name} testisp.info 查询失败: {e}", flush=True)
            
            if not is_residential:
                print(f"[-] {tun.name} 节点出口 ({egress_ip}) 检测为机房 IP，残忍抛弃！", flush=True)
                penalize_node(node["ip"], 50000)  # 机房 IP 极重惩罚，几乎不再启用
                dead_ips.add(node["ip"])
                try: process.terminate(); process.wait(2)
                except: process.kill()
                return

            print(f"[*] {tun.name} 流媒体连通性检测 (多端点)...", flush=True)
            stream_ok = False
            for stream_url in [
                "https://www.youtube.com",
                "https://www.gstatic.com/generate_204",
                "https://cp.cloudflare.com/generate_204",
                "https://www.google.com/robots.txt",
            ]:
                r = subprocess.run(["curl", "-o", "/dev/null", "-s", "-w", "%{http_code}", "-A", "Mozilla/5.0", "-m", "10", "--interface", tun.name, stream_url], capture_output=True, text=True)
                code = r.stdout.strip()
                if code and code != "000" and r.returncode == 0:
                    print(f"[+] {tun.name} 端点可达 {stream_url} HTTP {code}", flush=True)
                    stream_ok = True
                    break
                print(f"[*] {tun.name} 端点不可达 {stream_url} (code={code})", flush=True)
            if not stream_ok:
                print(f"[-] {tun.name} 所有流媒体端点均不可达，轻惩罚保留备用: {node['ip']}", flush=True)
                penalize_node(node["ip"], 3000)
                try: process.terminate(); process.wait(2)
                except: process.kill()
                return

            with state_lock:
                tun.process = process
                tun.node = node
                # 此时不再需要赋 entry_ip，因为在 maintain_pool 里已提前锁住坑位
                tun.egress_ip = egress_ip
                tun.country = node["country"]
                tun.connected_at = time.time()
                tun.ready = True
            role = "主网卡" if proxy_server.ACTIVE_BIND == tun.name else "备用网卡"
            print(f"[+] {tun.name} ({role}) 完全就绪: 入口 {node['ip']} -> 出口 {egress_ip}", flush=True)
        else:
            penalize_node(node["ip"], 5000)  # 建连超时中度惩罚
            try: process.terminate(); process.wait(2)
            except: process.kill()
            dead_ips.add(node["ip"])
    finally:
        with state_lock: tun.is_connecting = False

def health_check_loop():
    global tun_main, dead_ips
    fail_count = 0
    while True:
        # 如果处于异常容错状态，缩短检测间隔进行快速复核
        time.sleep(15 if fail_count == 0 else 5)
        
        target_tun = ""
        target_entry_ip = ""
        proc_ref = None
        
        with state_lock:
            if tun_main.ready and tun_main.process and tun_main.process.poll() is None:
                if time.time() - tun_main.connected_at > 20:
                    target_tun = tun_main.name
                    target_entry_ip = tun_main.entry_ip
                    proc_ref = tun_main.process
        
        if not target_tun:
            fail_count = 0
            continue
            
        # 1. 应用层：多维 HTTP 探针 (包含域名与直连IP，规避单点限流和DNS污染)
        endpoints = [
            "http://www.gstatic.com/generate_204",
            "http://cp.cloudflare.com/generate_204",
            "http://1.1.1.1",
            "http://8.8.8.8"
        ]
        
        is_alive = False
        for ep in endpoints:
            res = subprocess.run(["curl", "-I", "-s", "-m", "5", "--interface", target_tun, ep], capture_output=True)
            if res.returncode == 0:
                is_alive = True
                break
                
        # 2. 网络层：如果应用层全挂，尝试底层 ICMP (Ping) 作为终极底线
        if not is_alive:
            ping_res = subprocess.run(["ping", "-c", "2", "-W", "3", "-I", target_tun, "8.8.8.8"], capture_output=True)
            if ping_res.returncode == 0:
                is_alive = True
                
        # 3. 容错评估与处决
        if not is_alive:
            fail_count += 1
            if fail_count >= 3:
                print(f"[!] {target_tun} 连续 {fail_count} 次多维探针(HTTP/ICMP)均无响应，确认为真死断流，执行踢线: {target_entry_ip}", flush=True)
                penalize_node(target_entry_ip, 3000) # 运行中死掉的节点给予轻中度惩罚
                dead_ips.add(target_entry_ip)
                try: proc_ref.terminate(); proc_ref.wait(timeout=2)
                except: proc_ref.kill()
                with state_lock:
                    if tun_main.process == proc_ref: tun_main.ready = False
                fail_count = 0
            else:
                print(f"[*] {target_tun} 探针无响应，启动快频深度复核容错机制 ({fail_count}/3)...", flush=True)
        else:
            fail_count = 0

def get_best_candidate():
    global global_node_reservoir, dead_ips, target_country, tun_main, tun_backup
    with reservoir_lock:
        all_pool_nodes = sorted(list(global_node_reservoir.values()), key=lambda x: x["ping"])
        candidates = [n for n in all_pool_nodes if n["country"] == target_country and n["ip"] not in dead_ips]
        
        active_ips = []
        if tun_main.entry_ip: active_ips.append(tun_main.entry_ip)
        if tun_backup.entry_ip: active_ips.append(tun_backup.entry_ip)
        candidates = [n for n in candidates if n["ip"] not in active_ips]

        if not candidates:
            has_blacklisted = any(n["country"] == target_country for n in all_pool_nodes)
            if has_blacklisted:
                dead_ips.clear()
                print(f"[!] ⚡ 紧急熔断：[{target_country}] 节点黑名单释放救场（由于动态信誉系统存在，历史坏节点将被沉底）", flush=True)
                candidates = [n for n in all_pool_nodes if n["country"] == target_country and n["ip"] not in active_ips]

        if candidates: return candidates.pop(0)
    return None

def maintain_pool():
    global dead_ips, last_blacklist_clear, tun_main, tun_backup
    while True:
        if time.time() - last_blacklist_clear > 600:
            dead_ips.clear()
            last_blacklist_clear = time.time()

        with reservoir_lock:
            now = time.time()
            stale_ips = [ip for ip, node in global_node_reservoir.items() if now - node["harvested_at"] > 10800]
            for ip in stale_ips: global_node_reservoir.pop(ip, None)

        with state_lock:
            # FIX 2: 严格检测通道是否正在连接，防止由于尚未就绪导致的错误判死和秒切混乱
            main_dead = False
            if not tun_main.is_connecting:
                if tun_main.process is None or tun_main.process.poll() is not None or not tun_main.ready:
                    main_dead = True

            if main_dead:
                if tun_backup.ready and tun_backup.process and tun_backup.process.poll() is None and not tun_backup.is_connecting:
                    print(f"[*] ⚡ 主通道暴毙，软开关秒切！无缝接管业务至备用通道: 出口 {tun_backup.egress_ip or tun_backup.entry_ip}", flush=True)
                    # 状态互换 (身份对调)
                    tun_main, tun_backup = tun_backup, tun_main
                    proxy_server.ACTIVE_BIND = tun_main.name
                    
                    # 异步清理死掉的旧主卡 (现在的 tun_backup)
                    if tun_backup.process:
                        try: tun_backup.process.terminate(); tun_backup.process.wait(2)
                        except: tun_backup.process.kill()
                    tun_backup.process = None; tun_backup.node = None; tun_backup.entry_ip = ""; tun_backup.egress_ip = ""
                    tun_backup.ready = False; tun_backup.is_connecting = False
                else:
                    if tun_main.process:
                        try: tun_main.process.terminate(); tun_main.process.wait(2)
                        except: tun_main.process.kill()
                    tun_main.process = None; tun_main.ready = False; tun_main.is_connecting = False
                    tun_main.entry_ip = ""; tun_main.egress_ip = ""

        with state_lock:
            needs_main = not tun_main.ready and not tun_main.is_connecting
            needs_backup = not tun_backup.ready and not tun_backup.is_connecting

        if needs_main:
            node = get_best_candidate()
            if node:
                with state_lock: 
                    tun_main.is_connecting = True
                    tun_main.entry_ip = node["ip"] # FIX 1: 提前占住坑位，防止备用通道刚好获取到同样的 IP 导致死锁冲突
                threading.Thread(target=connect_node, args=(tun_main, node,), daemon=True).start()
                time.sleep(1)
        elif needs_backup:
            node = get_best_candidate()
            if node:
                with state_lock: 
                    tun_backup.is_connecting = True
                    tun_backup.entry_ip = node["ip"] # FIX 1: 提前占住坑位
                threading.Thread(target=connect_node, args=(tun_backup, node,), daemon=True).start()

        time.sleep(2)

def main():
    global PROXY_PORT, tun_main
    if os.geteuid() != 0: return
    get_public_ip()
    setup_env()
    subprocess.run(["pkill", "-f", "openvpn.*tun_main|tun_backup"], capture_output=True)
    
    proxy_server.ACTIVE_BIND = tun_main.name
    
    try:
        data = fetch_controller_config()
        if data:
            PROXY_PORT = int(data.get("port", 7920))
    except: pass

    print("========================================", flush=True)
    print(f"  Proxy Controller (主备双活引擎) 启动！端口: {PROXY_PORT}", flush=True)
    print("========================================", flush=True)

    threading.Thread(target=vpngate_fetch_loop, daemon=True).start()
    threading.Thread(target=update_config_loop, daemon=True).start()
    # 启用全局 IPv6 ANY 监听
    threading.Thread(target=proxy_server.start_proxy_server, args=("::", PROXY_PORT), daemon=True).start()
    threading.Thread(target=health_check_loop, daemon=True).start()
    threading.Thread(target=c2_heartbeat_loop, daemon=True).start()
    maintain_pool()

if __name__ == "__main__":
    main()
