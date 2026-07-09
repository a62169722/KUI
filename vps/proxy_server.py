#!/usr/bin/env python3
from __future__ import annotations
import os
import ipaddress
import select, socket, threading, urllib.parse, time, base64
from typing import Any

_PROXY_USER = os.environ.get("PROXY_USER", "proxy")
_PROXY_PASS = os.environ.get("PROXY_PASS", "888888")

def set_credentials(user: str, passwd: str) -> None:
    global _PROXY_USER, _PROXY_PASS, PROXY_USER, PROXY_PASS
    _PROXY_USER = user
    _PROXY_PASS = passwd
    PROXY_USER = user.encode()
    PROXY_PASS = passwd.encode()

PROXY_USER = _PROXY_USER.encode()
PROXY_PASS = _PROXY_PASS.encode()

# 全局软开关：由 lite_manager 动态更新，实现秒切
ACTIVE_BIND = "tun_main"

def parse_int(value: Any) -> int:
    try: return int(value)
    except: return 0

def recv_exact(sock: socket.socket, size: int) -> bytes:
    data = b""
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk: raise ConnectionError("Unexpected disconnect.")
        data += chunk
    return data

def parse_addr_port(raw: str):
    if not raw:
        return None
    if raw.startswith('['):
        idx = raw.find(']')
        if idx == -1:
            return None
        host = raw[1:idx]
        port_str = raw[idx + 2:] if len(raw) > idx + 1 and raw[idx + 1] == ':' else ''
        port = parse_int(port_str) or 443
        return host, port
    if ':' in raw:
        host, port_text = raw.rsplit(':', 1)
        return host, parse_int(port_text) or 443
    return raw, 443

def create_connection(address: tuple[str, int], timeout: float = 20) -> socket.socket:
    global ACTIVE_BIND
    bind_interface = ACTIVE_BIND
    host, port = address
    err = None
    if ':' in host:
        try:
            ipaddress.IPv6Address(host)
            address = (host, port, 0, 0)
        except (ipaddress.AddressValueError, ValueError):
            pass
    addrinfos = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)
    if not addrinfos:
        raise OSError("getaddrinfo empty")

    def sort_key(res):
        af, socktype, proto, canonname, sa = res
        if bind_interface and af != socket.AF_INET:
            return (1, 0)
        return (0, 0)

    addrinfos.sort(key=sort_key)

    for af, socktype, proto, canonname, sa in addrinfos:
        sock = None
        try:
            sock = socket.socket(af, socktype, proto)
            sock.settimeout(timeout)
            if bind_interface and af == socket.AF_INET:
                try:
                    sock.setsockopt(socket.SOL_SOCKET, 25, bind_interface.encode('utf-8'))
                except OSError:
                    continue
            elif bind_interface and af == socket.AF_INET6:
                continue
            sock.connect(sa)
            return sock
        except OSError as e:
            err = e
            if sock:
                sock.close()
    raise err or OSError("getaddrinfo empty")

def relay(left: socket.socket, right: socket.socket) -> None:
    sockets = [left, right]
    while True:
        readable, _, errored = select.select(sockets, [], sockets, 120)
        if errored: return
        for source in readable:
            target = right if source is left else left
            data = source.recv(65536)
            if not data: return
            target.sendall(data)

def socks5_client(client: socket.socket, first_byte: bytes) -> None:
    upstream = None
    try:
        methods_count = recv_exact(client, 1)[0]
        methods = recv_exact(client, methods_count)
        
        if b"\x02" not in methods:
            client.sendall(b"\x05\xFF")
            return
        client.sendall(b"\x05\x02")
        
        auth_req = recv_exact(client, 2)
        if auth_req[0] != 1: return
        ulen = auth_req[1]
        uname = recv_exact(client, ulen)
        plen = recv_exact(client, 1)[0]
        upass = recv_exact(client, plen)
        
        if uname != PROXY_USER or upass != PROXY_PASS:
            client.sendall(b"\x01\x01")
            return
        client.sendall(b"\x01\x00") 

        version, command, _, address_type = recv_exact(client, 4)
        if version != 5 or command != 1: return
        if address_type == 1: host = socket.inet_ntoa(recv_exact(client, 4))
        elif address_type == 3: host = recv_exact(client, recv_exact(client, 1)[0]).decode("idna")
        elif address_type == 4: host = socket.inet_ntop(socket.AF_INET6, recv_exact(client, 16))
        else: return
        port = int.from_bytes(recv_exact(client, 2), "big")
        
        upstream = create_connection((host, port), timeout=20)
        client.sendall(b"\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00")
        relay(client, upstream)
    except: pass
    finally:
        client.close()
        if upstream: upstream.close()

def http_client(client: socket.socket, first_byte: bytes) -> None:
    upstream = None
    try:
        data = first_byte
        while b"\r\n\r\n" not in data and len(data) < 65536:
            chunk = client.recv(4096)
            if not chunk: break
            data += chunk
        head, rest = data.split(b"\r\n\r\n", 1)
        lines = head.decode("iso-8859-1", errors="replace").split("\r\n")
        
        expected_auth = "Basic " + base64.b64encode(PROXY_USER + b":" + PROXY_PASS).decode("ascii")
        auth_passed = False
        for line in lines[1:]:
            if line.lower().startswith("proxy-authorization:"):
                if line.split(":", 1)[1].strip() == expected_auth:
                    auth_passed = True
                    break
                    
        if not auth_passed:
            client.sendall(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Proxy\"\r\n\r\n")
            return

        method, target, version = lines[0].split(" ", 2)
        if method.upper() == "CONNECT":
            parsed = parse_addr_port(target)
            if not parsed:
                return
            host, port = parsed
            upstream = create_connection((host, port), timeout=20)
            client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            if rest: upstream.sendall(rest)
            relay(client, upstream)
            return
        parsed = urllib.parse.urlsplit(target)
        if not parsed.hostname: return
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        path = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
        headers = [line for line in lines[1:] if not line.lower().startswith(("proxy-connection:", "connection:", "proxy-authorization:"))]
        request = f"{method} {path} {version}\r\n" + "\r\n".join(headers) + "\r\nConnection: close\r\n\r\n"
        upstream = create_connection((parsed.hostname, port), timeout=20)
        upstream.sendall(request.encode("iso-8859-1") + rest)
        relay(client, upstream)
    except: pass
    finally:
        client.close()
        if upstream: upstream.close()

def proxy_client(client: socket.socket, address: tuple[str, int]) -> None:
    try:
        client.settimeout(30)
        first = recv_exact(client, 1)
        if first == b"\x05": socks5_client(client, first)
        else: http_client(client, first)
    except:
        try: client.close()
        except: pass

def start_proxy_server(host: str, port: int) -> None:
    servers = []
    try:
        server6 = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        server6.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server6.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        server6.bind(("::", port))
        server6.listen(256)
        servers.append(server6)
    except Exception as e:
        pass

    try:
        server4 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server4.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server4.bind(("0.0.0.0", port))
        server4.listen(256)
        servers.append(server4)
    except Exception as e:
        pass

    if not servers:
        return
    while True:
        try:
            readable, _, _ = select.select(servers, [], [], 1.0)
            for server in readable:
                client, address = server.accept()
                threading.Thread(target=proxy_client, args=(client, address), daemon=True).start()
        except Exception:
            time.sleep(0.5)
