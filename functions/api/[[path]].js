export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);
    const method = request.method;
    const action = params.path ? params.path[0] : ''; 
    
    const ADMIN_PASS = env.ADMIN_PASSWORD || "admin"; 
    const db = env.DB; 

    if (action === "report" && method === "POST") {
        const data = await request.json(); 
        await db.prepare("UPDATE servers SET cpu = ?, mem = ?, last_report = ? WHERE ip = ?")
                .bind(data.cpu, data.mem, Date.now(), data.ip).run();
                
        if (data.node_traffic && data.node_traffic.length > 0) {
            const stmts = data.node_traffic.map(nt => 
                db.prepare("UPDATE nodes SET traffic_used = traffic_used + ? WHERE id = ?").bind(nt.delta_bytes, nt.id)
            );
            await db.batch(stmts);
        }
        return Response.json({ success: true });
    }

    if (action === "config" && method === "GET") {
        if (request.headers.get("Authorization") !== ADMIN_PASS) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const ip = url.searchParams.get("ip");
        const now = Date.now();
        
        // 提取该机器的流媒体解锁配置
        const serverInfo = await db.prepare("SELECT unlock_proxy FROM servers WHERE ip = ?").bind(ip).first();

        const query = `
            SELECT * FROM nodes 
            WHERE vps_ip = ? AND enable = 1 
            AND (traffic_limit = 0 OR traffic_used < traffic_limit)
            AND (expire_time = 0 OR expire_time > ?)
        `;
        const { results: machineNodes } = await db.prepare(query).bind(ip, now).all();
        
        for (let node of machineNodes) {
            if (node.protocol === "dokodemo-door" && node.relay_type === "internal") {
                const targetNode = await db.prepare("SELECT * FROM nodes WHERE id = ?").bind(node.target_id).first();
                if (targetNode) {
                    node.chain_target = {
                        ip: targetNode.vps_ip, port: targetNode.port, protocol: targetNode.protocol,
                        uuid: targetNode.uuid, sni: targetNode.sni, public_key: targetNode.public_key, short_id: targetNode.short_id
                    };
                }
            }
        }
        // 将解锁规则一并下发给 Agent
        return Response.json({ success: true, server: serverInfo, configs: machineNodes });
    }

    if (action === "sub" && method === "GET") {
        const ip = url.searchParams.get("ip");
        const token = url.searchParams.get("token");
        if (token !== ADMIN_PASS) return new Response("Invalid Sub Token", { status: 403 });

        const now = Date.now();
        let query = `SELECT * FROM nodes WHERE enable = 1 AND (traffic_limit = 0 OR traffic_used < traffic_limit) AND (expire_time = 0 OR expire_time > ?)`;
        let sqlParams = [now];
        
        if (ip) {
            query += " AND vps_ip = ?";
            sqlParams.push(ip);
        }
        
        const { results: targetNodes } = await db.prepare(query).bind(...sqlParams).all();
        let subLinks = [];
        for (let node of targetNodes) {
            const vpsInfo = await db.prepare("SELECT name FROM servers WHERE ip = ?").bind(node.vps_ip).first();
            const remark = encodeURIComponent(vpsInfo ? vpsInfo.name : "KUI_Node");

            if (node.protocol === "VLESS") {
                subLinks.push(`vless://${node.uuid}@${node.vps_ip}:${node.port}?encryption=none&security=none&type=tcp#${remark}`);
            } else if (node.protocol === "Reality") {
                subLinks.push(`vless://${node.uuid}@${node.vps_ip}:${node.port}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${node.sni}&fp=chrome&pbk=${node.public_key}&sid=${node.short_id}&type=tcp&headerType=none#${remark}-Reality`);
            } else if (node.protocol === "Hysteria2") {
                subLinks.push(`hysteria2://${node.uuid}@${node.vps_ip}:${node.port}/?insecure=1&sni=${node.sni}#${remark}-Hy2`);
            }
        }

        const base64Sub = btoa(unescape(encodeURIComponent(subLinks.join('\n'))));
        return new Response(base64Sub, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }});
    }

    if (action === "login" && method === "POST") {
        const data = await request.json();
        if (data.password === ADMIN_PASS) return Response.json({ success: true });
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (request.headers.get("Authorization") !== ADMIN_PASS) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
        if (action === "data" && method === "GET") {
            const servers = (await db.prepare("SELECT * FROM servers ORDER BY last_report DESC").all()).results;
            const nodes = (await db.prepare("SELECT * FROM nodes").all()).results;
            return Response.json({ servers, nodes });
        }

        if (action === "vps") {
            if (method === "POST") {
                const { ip, name } = await request.json();
                await db.prepare("INSERT OR IGNORE INTO servers (ip, name) VALUES (?, ?)").bind(ip, name).run();
                return Response.json({ success: true });
            }
            if (method === "PUT") {
                // 保存机器的流媒体解锁配置
                const { ip, unlock_proxy } = await request.json();
                await db.prepare("UPDATE servers SET unlock_proxy = ? WHERE ip = ?").bind(unlock_proxy, ip).run();
                return Response.json({ success: true });
            }
            if (method === "DELETE") {
                await db.prepare("DELETE FROM servers WHERE ip = ?").bind(url.searchParams.get("ip")).run();
                return Response.json({ success: true });
            }
        }

        if (action === "nodes") {
            if (method === "POST") {
                const n = await request.json();
                await db.prepare(`
                    INSERT INTO nodes (id, uuid, vps_ip, protocol, port, sni, private_key, public_key, short_id, relay_type, target_ip, target_port, target_id, enable, traffic_used, traffic_limit, expire_time) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    n.id, n.uuid, n.vps_ip, n.protocol, n.port, n.sni || null, n.private_key || null, n.public_key || null, 
                    n.short_id || null, n.relay_type || null, n.target_ip || null, n.target_port || null, n.target_id || null,
                    1, 0, n.traffic_limit || 0, n.expire_time || 0
                ).run();
                return Response.json({ success: true });
            }
            if (method === "PUT") {
                const { id, enable, reset_traffic } = await request.json();
                if (reset_traffic) {
                    await db.prepare("UPDATE nodes SET traffic_used = 0 WHERE id = ?").bind(id).run();
                } else if (enable !== undefined) {
                    await db.prepare("UPDATE nodes SET enable = ? WHERE id = ?").bind(enable, id).run();
                }
                return Response.json({ success: true });
            }
            if (method === "DELETE") {
                await db.prepare("DELETE FROM nodes WHERE id = ?").bind(url.searchParams.get("id")).run();
                return Response.json({ success: true });
            }
        }
        return new Response("Not Found", { status: 404 });
    } catch (err) { return Response.json({ error: err.message }, { status: 500 }); }
}
