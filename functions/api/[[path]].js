// ==========================================
// KUI Serverless 聚合网关后端 - 精简核心版
// (包含：自动建表升级 + 极速8合1协议生成 + 探针管理 + Clash订阅 + 动态云端测速/主题)
// ==========================================

async function sha256(text) {
    const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function ensureDbSchema(db) {
    const initQueries = [
        `CREATE TABLE IF NOT EXISTS servers (ip TEXT PRIMARY KEY, name TEXT NOT NULL, cpu INTEGER DEFAULT 0, mem REAL DEFAULT 0, last_report INTEGER DEFAULT 0, alert_sent INTEGER DEFAULT 0, disk INTEGER DEFAULT 0, load TEXT DEFAULT "", uptime TEXT DEFAULT "", net_in_speed INTEGER DEFAULT 0, net_out_speed INTEGER DEFAULT 0, tcp_conn INTEGER DEFAULT 0, udp_conn INTEGER DEFAULT 0)`,
        `CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password TEXT NOT NULL, traffic_limit INTEGER DEFAULT 0, traffic_used INTEGER DEFAULT 0, expire_time INTEGER DEFAULT 0, enable INTEGER DEFAULT 1, sub_token TEXT)`,
        `CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, uuid TEXT NOT NULL, vps_ip TEXT NOT NULL, protocol TEXT NOT NULL, port INTEGER NOT NULL, sni TEXT, private_key TEXT, public_key TEXT, short_id TEXT, relay_type TEXT, target_ip TEXT, target_port INTEGER, target_id TEXT, enable INTEGER DEFAULT 1, traffic_used INTEGER DEFAULT 0, traffic_limit INTEGER DEFAULT 0, expire_time INTEGER DEFAULT 0, username TEXT DEFAULT 'admin', FOREIGN KEY(vps_ip) REFERENCES servers(ip) ON DELETE CASCADE)`,
        `CREATE TABLE IF NOT EXISTS traffic_stats (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, delta_bytes INTEGER DEFAULT 0, timestamp INTEGER NOT NULL, FOREIGN KEY(ip) REFERENCES servers(ip) ON DELETE CASCADE)`,
        `CREATE INDEX IF NOT EXISTS idx_traffic_ip_time ON traffic_stats(ip, timestamp)`,
        `CREATE TABLE IF NOT EXISTS sys_config (key TEXT PRIMARY KEY, val TEXT, ts INTEGER)`
    ];
    for (let query of initQueries) { try { await db.prepare(query).run(); } catch (e) {} }

    const probeQueries = [
        `CREATE TABLE IF NOT EXISTS probe_settings (key TEXT PRIMARY KEY, value TEXT)`,
        `CREATE TABLE IF NOT EXISTS probe_servers (
            id TEXT PRIMARY KEY, name TEXT, cpu TEXT, ram TEXT, disk TEXT, load_avg TEXT, uptime TEXT, last_updated INTEGER,
            ram_total TEXT, net_rx TEXT, net_tx TEXT, net_in_speed TEXT, net_out_speed TEXT,
            os TEXT, cpu_info TEXT, arch TEXT, boot_time TEXT, ram_used TEXT, swap_total TEXT, 
            swap_used TEXT, disk_total TEXT, disk_used TEXT, processes TEXT, tcp_conn TEXT, udp_conn TEXT, 
            country TEXT, ip_v4 TEXT, ip_v6 TEXT, server_group TEXT DEFAULT '默认分组', price TEXT DEFAULT '', 
            expire_date TEXT DEFAULT '', bandwidth TEXT DEFAULT '', traffic_limit TEXT DEFAULT '', agent_os TEXT DEFAULT 'debian',
            ping_ct TEXT DEFAULT '0', ping_cu TEXT DEFAULT '0', ping_cm TEXT DEFAULT '0', ping_bd TEXT DEFAULT '0',
            monthly_rx TEXT DEFAULT '0', monthly_tx TEXT DEFAULT '0', last_rx TEXT DEFAULT '0', last_tx TEXT DEFAULT '0', 
            reset_month TEXT DEFAULT '', history TEXT DEFAULT '{}', is_hidden TEXT DEFAULT 'false', virt TEXT DEFAULT '', reset_day TEXT DEFAULT '1'
        )`
    ];
    for (let query of probeQueries) { try { await db.prepare(query).run(); } catch (e) {} }

    try { await db.prepare("SELECT username FROM nodes LIMIT 1").first(); } catch (e) { try { await db.prepare("ALTER TABLE nodes ADD COLUMN username TEXT DEFAULT 'admin'").run(); } catch(e){} }
    try { await db.prepare("SELECT disk FROM servers LIMIT 1").first(); } catch (e) { const newCols = ['disk INTEGER DEFAULT 0', 'load TEXT DEFAULT ""', 'uptime TEXT DEFAULT ""', 'net_in_speed INTEGER DEFAULT 0', 'net_out_speed INTEGER DEFAULT 0', 'tcp_conn INTEGER DEFAULT 0', 'udp_conn INTEGER DEFAULT 0']; for (let col of newCols) { try { await db.prepare(`ALTER TABLE servers ADD COLUMN ${col}`).run(); } catch(err){} } }
    try { await db.prepare("SELECT sub_token FROM users LIMIT 1").first(); } catch (e) { try { await db.prepare("ALTER TABLE users ADD COLUMN sub_token TEXT").run(); } catch(err){} }
    try { await db.prepare("SELECT reset_day FROM probe_servers LIMIT 1").first(); } catch (e) { try { await db.prepare("ALTER TABLE probe_servers ADD COLUMN reset_day TEXT DEFAULT '1'").run(); } catch(e){} }

    // 初始化云端测速数据
    const checkNodes = await db.prepare("SELECT value FROM probe_settings WHERE key = 'cached_nodes_data'").first();
    if (!checkNodes) {
        try {
            const res = await fetch('https://raw.githubusercontent.com/a63414262/CF-Server-Monitor-Pro/refs/heads/main/nodes.json');
            if (res.ok) {
                const dataText = await res.text();
                await db.prepare("INSERT INTO probe_settings (key, value) VALUES ('cached_nodes_data', ?)").bind(dataText).run();
            }
        } catch(e) {}
    }
}

async function verifyAuth(authHeader, db, env) {
    if (!authHeader) return null;
    const adminUser = env.ADMIN_USERNAME || "admin";
    const adminPass = env.ADMIN_PASSWORD || "admin";
    if (authHeader === adminPass || authHeader === await sha256(adminPass)) return adminUser;
    const parts = authHeader.split('.');
    if (parts.length !== 3) return null;
    const [b64User, timestamp, clientSig] = parts;
    if (Math.abs(Date.now() - parseInt(timestamp)) > 300000) return null; 
    const username = atob(b64User);
    let baseKeyHex;
    if (username === adminUser) { baseKeyHex = await sha256(adminPass); } 
    else { const u = await db.prepare("SELECT password FROM users WHERE username = ?").bind(username).first(); if (!u) return null; baseKeyHex = u.password; }
    const keyBytes = new Uint8Array(baseKeyHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(username + timestamp));
    const expectedSig = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
    return clientSig === expectedSig ? username : null;
}

// ==============================================
// 探针纯净 API 子系统处理
// ==============================================
async function handleProbeAPI(request, env, context, pathArray) {
    const subPath = pathArray ? pathArray.join('/') : '';
    const url = new URL(request.url);
    const method = request.method;
    const db = env.DB;

    // Telegram Bot 交互回调控制
    if (method === 'POST' && subPath === 'tg_webhook') {
        try {
            const body = await request.json();
            const message = body.message; const callback_query = body.callback_query;
            let tgBotToken = ''; let tgChatId = '';
            try { const { results } = await db.prepare("SELECT key, value FROM probe_settings WHERE key IN ('tg_bot_token', 'tg_chat_id')").all(); results.forEach(r => { if(r.key === 'tg_bot_token') tgBotToken = r.value; if(r.key === 'tg_chat_id') tgChatId = r.value; }); } catch(e){}
            
            const tgSend = async (chatId, text, kb=null) => { const p = { chat_id: chatId, text, parse_mode: 'HTML' }; if (kb) p.reply_markup = kb; await fetch(`https://api.telegram.org/bot${tgBotToken}/sendMessage`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(p)}); };
            const tgEdit = async (chatId, msgId, text, kb=null) => { const p = { chat_id: chatId, message_id: msgId, text, parse_mode: 'HTML' }; if (kb) p.reply_markup = kb; await fetch(`https://api.telegram.org/bot${tgBotToken}/editMessageText`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(p)}); };

            let chatId, text, msgId;
            if (message) { chatId = message.chat.id.toString(); text = message.text || ''; msgId = message.message_id; } 
            else if (callback_query) { chatId = callback_query.message.chat.id.toString(); text = callback_query.data; msgId = callback_query.message.message_id; }
            if (chatId !== tgChatId) return new Response('OK', { status: 200 });

            const mainMenuText = `🖥 <b>Server Monitor Pro 探针管理</b>\n\n您可以使用命令快速设置系统：\n<code>/set_interval 10</code> - 上报间隔10秒\n<code>/set_sitetitle 新标题</code> - 更改大盘标题\n<code>/menu</code> - 调出本菜单`;
            const mainMenuKb = { inline_keyboard: [ [{text: '📋 探针节点列表', callback_data: 'cb_list_nodes'}], [{text: '⚙️ 系统设置快捷开关', callback_data: 'cb_settings'}] ] };
            
            if (callback_query) {
                if (text === 'cb_menu') await tgEdit(chatId, msgId, mainMenuText, mainMenuKb);
                else if (text === 'cb_list_nodes') {
                    const { results } = await db.prepare('SELECT id, name, last_updated FROM probe_servers WHERE is_hidden != "true"').all();
                    let kb = { inline_keyboard: [] };
                    for (const s of results) { kb.inline_keyboard.push([{text: `${s.name}`, callback_data: `cb_node_${s.id}`}]); }
                    kb.inline_keyboard.push([{text: '🔙 返回', callback_data: 'cb_menu'}]);
                    await tgEdit(chatId, msgId, '📋 <b>当前在线探针：</b>', kb);
                }
                else if (text.startsWith('cb_node_')) {
                    const id = text.split('_')[2]; const s = await db.prepare('SELECT * FROM probe_servers WHERE id = ?').bind(id).first();
                    if (s) await tgEdit(chatId, msgId, `🖥 <b>探针详情:</b> ${s.name}\n\n系统: ${s.os||'-'}\nIP类型: IPv4:${s.ip_v4} / IPv6:${s.ip_v6}\n运行时长: ${s.uptime}\n分组: ${s.server_group}`, {inline_keyboard: [[{text: '🔙 返回列表', callback_data: 'cb_list_nodes'}]]});
                }
                else if (text === 'cb_settings') {
                    let set = { is_public: 'true', show_price: 'true' }; try { const { results } = await db.prepare("SELECT key, value FROM probe_settings").all(); results.forEach(r => set[r.key]=r.value); } catch(e){}
                    const kb = { inline_keyboard: [
                        [{text: `${set.is_public === 'true' ? '✅' : '❌'} 公开大盘`, callback_data: 'cb_tog_is_public'}, {text: `${set.show_price === 'true' ? '✅' : '❌'} 显示价格`, callback_data: 'cb_tog_show_price'}],
                        [{text: '🔙 返回主菜单', callback_data: 'cb_menu'}]
                    ]};
                    await tgEdit(chatId, msgId, '⚙️ <b>点击切换探针前台展示状态</b>', kb);
                }
                else if (text.startsWith('cb_tog_')) {
                    const key = text.replace('cb_tog_', '');
                    let cur = 'true'; try { const r = await db.prepare('SELECT value FROM probe_settings WHERE key=?').bind(key).first(); if(r) cur = r.value; } catch(e){}
                    await db.prepare('INSERT INTO probe_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, cur==='true'?'false':'true').run();
                    await tgSend(chatId, `✅ 属性 ${key} 已成功切换！`);
                }
            }
            if (message) {
                const cmdParts = text.trim().split(/\s+/); const cmd = cmdParts[0].toLowerCase();
                if (cmd === '/start' || cmd === '/menu') await tgSend(chatId, mainMenuText, mainMenuKb);
                else if (cmd === '/set_interval' && cmdParts[1]) { await db.prepare('INSERT INTO probe_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('report_interval', cmdParts[1]).run(); await tgSend(chatId, `✅ 上报间隔设为 ${cmdParts[1]} 秒`); }
                else if (cmd === '/set_sitetitle') { await db.prepare('INSERT INTO probe_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('site_title', text.replace(cmdParts[0], '').trim()).run(); await tgSend(chatId, '✅ 大盘标题已更新'); }
            }
            return new Response('OK', { status: 200 });
        } catch(e) { return new Response('Webhook Error', {status:200}); }
    }

    if (method === 'GET' && subPath === 'public') {
        const settings = { theme: 'theme1', is_public: 'true', site_title: '⚡ Server Monitor Pro', show_price: 'true', show_expire: 'true', show_bw: 'true', show_tf: 'true', custom_css: '', custom_bg: '', custom_head: '', custom_script: '', report_interval: '5', enable_popup: 'false', popup_content: '', cached_nodes_data: '' };
        try { const { results } = await db.prepare('SELECT * FROM probe_settings').all(); if (results) results.forEach(r => settings[r.key] = r.value); } catch(e){}
        
        const isAjax = url.searchParams.get('ajax') === '1';
        if (!isAjax) {
            const localNow = new Date(new Date().getTime() + 8 * 60 * 60000); const todayStr = `${localNow.getFullYear()}-${localNow.getMonth() + 1}-${localNow.getDate()}`;
            let vTotal = parseInt(settings.visits_total || '0') + 1; let vToday = parseInt(settings.visits_today || '0'); let vDate = settings.visits_date || '';
            if (vDate !== todayStr) { vToday = 1; vDate = todayStr; } else vToday++;
            settings.visits_total = vTotal.toString(); settings.visits_today = vToday.toString(); settings.visits_date = todayStr;
            context.waitUntil(db.prepare(`INSERT INTO probe_settings (key, value) VALUES ('visits_total', ?), ('visits_today', ?), ('visits_date', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(vTotal.toString(), vToday.toString(), todayStr).run().catch(()=>{}));
        }

        const authHeader = request.headers.get("Authorization");
        const isLoggedIn = await verifyAuth(authHeader, db, env);
        if (settings.is_public !== 'true' && !isLoggedIn) return Response.json({ error: "Private Dashboard" }, { status: 401 });

        const servers = (await db.prepare('SELECT id, name, cpu, ram, disk, load_avg, uptime, last_updated, net_in_speed, net_out_speed, os, arch, virt, tcp_conn, udp_conn, country, ip_v4, ip_v6, server_group, price, expire_date, bandwidth, traffic_limit, ping_ct, ping_cu, ping_cm, ping_bd, monthly_rx, monthly_tx, net_rx, net_tx, cpu_info, ram_used, ram_total, disk_used, disk_total FROM probe_servers WHERE is_hidden != "true"').all()).results;
        return Response.json({ settings, servers });
    }

    if (method === 'GET' && subPath === 'detail') {
        const id = url.searchParams.get('id');
        const server = await db.prepare('SELECT * FROM probe_servers WHERE id = ?').bind(id).first();
        if (!server || server.is_hidden === 'true') return Response.json({ error: "Not found" }, { status: 404 });
        return Response.json(server);
    }

    if (!(await verifyAuth(request.headers.get("Authorization"), db, env))) return Response.json({error: "Unauthorized"}, {status: 401});

    // 🌟 GitHub 云端拉取三网节点库
    if (method === 'POST' && subPath === 'admin/pull_github') {
        try {
            const res = await fetch('https://raw.githubusercontent.com/a63414262/CF-Server-Monitor-Pro/refs/heads/main/nodes.json');
            if (res.ok) {
                const dataText = await res.text();
                await db.prepare("INSERT INTO probe_settings (key, value) VALUES ('cached_nodes_data', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(dataText).run();
                return Response.json({ success: true });
            }
            return Response.json({ error: 'Fetch failed' }, { status: 400 });
        } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
    }

    if (method === 'GET' && subPath === 'admin/data') {
        const settings = {};
        try { const { results } = await db.prepare('SELECT * FROM probe_settings').all(); if (results) results.forEach(r => settings[r.key] = r.value); } catch(e){}
        const servers = (await db.prepare('SELECT id, name, last_updated, server_group, price, expire_date, bandwidth, traffic_limit, agent_os, is_hidden, reset_day FROM probe_servers').all()).results;
        return Response.json({ settings, servers });
    }
    
    if (method === 'POST' && subPath === 'admin/settings') {
        const { settings } = await request.json();
        for (const [k, v] of Object.entries(settings)) { await db.prepare('INSERT INTO probe_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v).run(); }
        if (settings.tg_bot_token) {
            try {
               await fetch(`https://api.telegram.org/bot${settings.tg_bot_token}/setWebhook`, {
                  method: 'POST', headers: {'Content-Type': 'application/json'},
                  body: JSON.stringify({ url: `${url.origin}/api/probe/tg_webhook` })
               });
            } catch(e) {}
        }
        return Response.json({ success: true });
    }

    if (method === 'PUT' && subPath === 'admin/server') {
        const data = await request.json();
        await db.prepare(`UPDATE probe_servers SET name=?, server_group=?, price=?, expire_date=?, bandwidth=?, traffic_limit=?, agent_os=?, is_hidden=?, reset_day=? WHERE id=?`).bind(data.name || 'Unnamed', data.server_group || '默认分组', data.price || '', data.expire_date || '', data.bandwidth || '', data.traffic_limit || '', data.agent_os || 'debian', data.is_hidden || 'false', data.reset_day || '1', data.id).run();
        return Response.json({ success: true });
    }
    
    if (method === 'DELETE' && subPath === 'admin/server') {
        const id = url.searchParams.get('id');
        await db.prepare('DELETE FROM probe_servers WHERE id = ?').bind(id).run();
        return Response.json({ success: true });
    }

    return Response.json({error: "Not Found"}, {status: 404});
}

// ==============================================
// KUI 主体接口路由
// ==============================================
export async function onRequest(context) {
    const { request, env, params } = context;
    const method = request.method;
    const action = params.path ? params.path[0] : ''; 
    const db = env.DB; 

    if (action === "probe") {
        await ensureDbSchema(db);
        return await handleProbeAPI(request, env, context, params.path.slice(1));
    }

    if (action === "ui_ping" && method === "POST") {
        if (!(await verifyAuth(request.headers.get("Authorization"), db, env))) return new Response("Unauthorized", { status: 401 });
        await db.prepare("INSERT OR REPLACE INTO sys_config (key, val, ts) VALUES ('ui_active', '1', ?)").bind(Date.now()).run();
        return Response.json({ success: true });
    }

    // 🌟 Agent 统一探针与管理上报接口 (融入全新的 Reset Day 计算和动态云端测速节点)
    if (action === "report" && method === "POST") {
        if (!(await verifyAuth(request.headers.get("Authorization"), db, env))) return new Response("Unauthorized", { status: 401 });
        const data = await request.json(); 
        const nowMs = Date.now();
        const vpsIp = data.ip;

        const kuiServer = await db.prepare('SELECT name FROM servers WHERE ip = ?').bind(vpsIp).first();
        if (!kuiServer) {
            return Response.json({ error: "Server has been removed from KUI panel." }, { status: 403 });
        }
        const serverName = kuiServer.name;

        try { 
            await db.prepare("UPDATE servers SET cpu=?, mem=?, disk=?, load=?, uptime=?, net_in_speed=?, net_out_speed=?, tcp_conn=?, udp_conn=?, last_report=?, alert_sent=0 WHERE ip=?")
                    .bind(data.cpu||0, data.mem||0, data.disk||0, data.load||'', data.uptime||'', data.net_in_speed||0, data.net_out_speed||0, data.tcp_conn||0, data.udp_conn||0, nowMs, vpsIp).run(); 
        } catch (e) { 
            await ensureDbSchema(db); 
            await db.prepare("UPDATE servers SET cpu=?, mem=?, disk=?, load=?, uptime=?, net_in_speed=?, net_out_speed=?, tcp_conn=?, udp_conn=?, last_report=?, alert_sent=0 WHERE ip=?")
                    .bind(data.cpu||0, data.mem||0, data.disk||0, data.load||'', data.uptime||'', data.net_in_speed||0, data.net_out_speed||0, data.tcp_conn||0, data.udp_conn||0, nowMs, vpsIp).run(); 
        }

        try {
            let countryCode = request.cf && request.cf.country ? request.cf.country : 'XX'; 
            if (countryCode.toUpperCase() === 'TW') countryCode = 'CN';

            const probeServer = await db.prepare('SELECT * FROM probe_servers WHERE id = ?').bind(vpsIp).first();
            
            // --- 全新核心：基于动态 reset_day 的流量生命周期重置 ---
            const localNow = new Date(nowMs + 8 * 60 * 60000); 
            let y = localNow.getFullYear();
            let m = localNow.getMonth() + 1;
            let d = localNow.getDate();
            
            let resetDayVal = probeServer ? parseInt(probeServer.reset_day) || 1 : 1;
            if (resetDayVal < 1) resetDayVal = 1; if (resetDayVal > 31) resetDayVal = 31;
            
            let maxDaysThisMonth = new Date(y, m, 0).getDate();
            let actualResetDayThisMonth = Math.min(resetDayVal, maxDaysThisMonth);
            
            let currentCycleStr = '';
            if (d < actualResetDayThisMonth) {
                let pm = m - 1; let py = y;
                if (pm === 0) { pm = 12; py -= 1; }
                let maxDaysPrevMonth = new Date(py, pm, 0).getDate();
                let actualResetDayPrevMonth = Math.min(resetDayVal, maxDaysPrevMonth);
                currentCycleStr = `${py}-${pm}-${actualResetDayPrevMonth}`;
            } else {
                currentCycleStr = `${y}-${m}-${actualResetDayThisMonth}`;
            }

            let monthly_rx = 0, monthly_tx = 0, last_rx = 0, last_tx = 0;
            let reset_month = currentCycleStr;
            let history = {};

            if (!probeServer) {
                await db.prepare(`INSERT INTO probe_servers (id, name, cpu, ram, disk, load_avg, uptime, last_updated, ram_total, net_rx, net_tx, net_in_speed, net_out_speed, os, cpu_info, arch, boot_time, ram_used, swap_total, swap_used, disk_total, disk_used, processes, tcp_conn, udp_conn, country, ip_v4, ip_v6, server_group, price, expire_date, bandwidth, traffic_limit, ping_ct, ping_cu, ping_cm, ping_bd, monthly_rx, monthly_tx, last_rx, last_tx, reset_month, agent_os, history, is_hidden, virt, reset_day) VALUES (?, ?, '0', '0', '0', '0', '0', 0, '0', '0', '0', '0', '0', '', '', '', '', '0', '0', '0', '0', '0', '0', '0', '0', ?, '1', '0', '默认分组', '免费', '', '', '', '0', '0', '0', '0', '0', '0', '0', '0', ?, 'debian', '{}', 'false', '', '1')`).bind(vpsIp, serverName, countryCode, currentCycleStr).run();
            } else {
                monthly_rx = parseFloat(probeServer.monthly_rx || '0'); monthly_tx = parseFloat(probeServer.monthly_tx || '0');
                last_rx = parseFloat(probeServer.last_rx || '0'); last_tx = parseFloat(probeServer.last_tx || '0');
                reset_month = probeServer.reset_month || currentCycleStr;
                
                let autoReset = 'false';
                try { const r = await db.prepare("SELECT value FROM probe_settings WHERE key = 'auto_reset_traffic'").first(); if (r) autoReset = r.value; } catch(e){}
                // 周期变动立即清零结算
                if (autoReset === 'true' && currentCycleStr !== reset_month) { monthly_rx = 0; monthly_tx = 0; reset_month = currentCycleStr; }
                try { history = JSON.parse(probeServer.history || '{}'); } catch(e) {}
            }

            const current_rx = parseFloat(data.net_rx || '0'); const current_tx = parseFloat(data.net_tx || '0');
            if (current_rx >= last_rx) monthly_rx += (current_rx - last_rx); else monthly_rx += current_rx;
            if (current_tx >= last_tx) monthly_tx += (current_tx - last_tx); else monthly_tx += current_tx;
            last_rx = current_rx; last_tx = current_tx;

            const lastHistTime = history.last_time || 0;
            if (nowMs - lastHistTime >= 300000 || !history.time) {
                const maxPoints = 288; 
                const updateArr = (arr, val) => { if (!Array.isArray(arr)) arr = []; arr.push(val); if (arr.length > maxPoints) arr.shift(); return arr; };
                const updateLabels = (arr) => { if (!Array.isArray(arr)) arr = []; const d = new Date(nowMs + 8 * 60 * 60000); arr.push(d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')); if (arr.length > maxPoints) arr.shift(); return arr; };
                history.cpu = updateArr(history.cpu, parseFloat(data.cpu) || 0); history.ram = updateArr(history.ram, parseFloat(data.mem) || 0); history.proc = updateArr(history.proc, parseInt(data.processes) || 0); 
                history.net_in = updateArr(history.net_in, parseFloat(data.net_in_speed) || 0); history.net_out = updateArr(history.net_out, parseFloat(data.net_out_speed) || 0); 
                history.tcp = updateArr(history.tcp, parseInt(data.tcp_conn) || 0); history.udp = updateArr(history.udp, parseInt(data.udp_conn) || 0); 
                history.ping_ct = updateArr(history.ping_ct, parseInt(data.ping_ct) || 0); history.ping_cu = updateArr(history.ping_cu, parseInt(data.ping_cu) || 0); history.ping_cm = updateArr(history.ping_cm, parseInt(data.ping_cm) || 0); history.ping_bd = updateArr(history.ping_bd, parseInt(data.ping_bd) || 0); 
                history.time = updateLabels(history.time); history.last_time = nowMs;
            }

            await db.prepare(`UPDATE probe_servers SET cpu=?, ram=?, disk=?, load_avg=?, uptime=?, last_updated=?, ram_total=?, net_rx=?, net_tx=?, net_in_speed=?, net_out_speed=?, os=?, cpu_info=?, arch=?, boot_time=?, ram_used=?, swap_total=?, swap_used=?, disk_total=?, disk_used=?, processes=?, tcp_conn=?, udp_conn=?, ping_ct=?, ping_cu=?, ping_cm=?, ping_bd=?, monthly_rx=?, monthly_tx=?, last_rx=?, last_tx=?, reset_month=?, history=?, virt=? WHERE id=?`)
                    .bind(data.cpu||0, data.mem||0, data.disk||0, data.load||'', data.uptime||'', nowMs, data.ram_total||'0', data.net_rx||'0', data.net_tx||'0', data.net_in_speed||0, data.net_out_speed||0, data.os||'', data.cpu_info||'', data.arch||'', data.boot_time||'', data.ram_used||'0', data.swap_total||'0', data.swap_used||'0', data.disk_total||'0', data.disk_used||'0', data.processes||'0', data.tcp_conn||0, data.udp_conn||0, data.ping_ct||'0', data.ping_cu||'0', data.ping_cm||'0', data.ping_bd||'0', monthly_rx.toString(), monthly_tx.toString(), last_rx.toString(), last_tx.toString(), reset_month, JSON.stringify(history), data.virt||'', vpsIp).run();

        } catch (e) { console.error("探针数据同步失败:", e); }

        const stmts = []; let totalDelta = 0;
        if (data.node_traffic && data.node_traffic.length > 0) { 
            for (let nt of data.node_traffic) { 
                stmts.push(db.prepare("UPDATE nodes SET traffic_used = traffic_used + ? WHERE id = ?").bind(nt.delta_bytes, nt.id)); 
                stmts.push(db.prepare(`UPDATE users SET traffic_used = traffic_used + ? WHERE username = (SELECT username FROM nodes WHERE id = ?)`).bind(nt.delta_bytes, nt.id)); 
                totalDelta += nt.delta_bytes; 
            } 
        }
        if (data.argo_urls && data.argo_urls.length > 0) { for (let argo of data.argo_urls) { stmts.push(db.prepare("UPDATE nodes SET sni = ? WHERE id = ? AND protocol = 'VLESS-Argo' AND sni != ?").bind(argo.url, argo.id, argo.url)); } }
        if (totalDelta > 0) { stmts.push(db.prepare("INSERT INTO traffic_stats (ip, delta_bytes, timestamp) VALUES (?, ?, ?)").bind(vpsIp, totalDelta, nowMs)); }
        if (stmts.length > 0) await db.batch(stmts);
        
        let fastMode = false; try { const uiActive = await db.prepare("SELECT ts FROM sys_config WHERE key = 'ui_active'").first(); if (uiActive && (nowMs - uiActive.ts < 20000)) fastMode = true; } catch(e) {}
        
        let reportInterval = 5; let pingCt = 'default'; let pingCu = 'default'; let pingCm = 'default';
        try { 
            const { results } = await db.prepare("SELECT key, value FROM probe_settings WHERE key IN ('report_interval', 'ping_node_ct', 'ping_node_cu', 'ping_node_cm')").all(); 
            if (results) {
                results.forEach(r => {
                    if (r.key === 'report_interval') reportInterval = parseInt(r.value) || 5;
                    if (r.key === 'ping_node_ct') pingCt = r.value;
                    if (r.key === 'ping_node_cu') pingCu = r.value;
                    if (r.key === 'ping_node_cm') pingCm = r.value;
                });
            }
        } catch(e) {}
        
        return Response.json({ success: true, fast_mode: fastMode, interval: reportInterval, ping_ct: pingCt, ping_cu: pingCu, ping_cm: pingCm });
    }

    if (action === "config" && method === "GET") {
        if (!(await verifyAuth(request.headers.get("Authorization"), db, env))) return new Response("Unauthorized", { status: 401 });
        const ip = new URL(request.url).searchParams.get("ip"); const now = Date.now(); const adminUser = env.ADMIN_USERNAME || "admin";
        const query = `SELECT n.* FROM nodes n LEFT JOIN users u ON n.username = u.username WHERE n.vps_ip = ? AND n.enable = 1 AND (n.traffic_limit = 0 OR n.traffic_used < n.traffic_limit) AND (n.expire_time = 0 OR n.expire_time > ?) AND (n.username = ? OR n.username = 'admin' OR (u.username IS NOT NULL AND u.enable = 1 AND (u.traffic_limit = 0 OR u.traffic_used < u.traffic_limit) AND (u.expire_time = 0 OR u.expire_time > ?)))`;
        const { results: machineNodes } = await db.prepare(query).bind(ip, now, adminUser, now).all();
        for (let node of machineNodes) { if (node.protocol === "dokodemo-door" && node.relay_type === "internal") { const targetNode = await db.prepare("SELECT * FROM nodes WHERE id = ?").bind(node.target_id).first(); if (targetNode) node.chain_target = { ip: targetNode.vps_ip, port: targetNode.port, protocol: targetNode.protocol, uuid: targetNode.uuid, sni: targetNode.sni, public_key: targetNode.public_key, short_id: targetNode.short_id }; } }
        return Response.json({ success: true, configs: machineNodes });
    }

    // 🌟 核心拦截并拆分普通订阅与 Clash 订阅生成
    if (action === "sub" && method === "GET") {
        const urlObj = new URL(request.url); 
        const ip = urlObj.searchParams.get("ip"); 
        const reqUser = urlObj.searchParams.get("user"); 
        const token = urlObj.searchParams.get("token"); 
        const format = urlObj.searchParams.get("format"); 
        const adminUser = env.ADMIN_USERNAME || "admin";

        let isValid = false;
        if (reqUser === adminUser) { 
            let adminSubToken = await sha256(env.ADMIN_PASSWORD || "admin"); 
            try { const r = await db.prepare("SELECT val FROM sys_config WHERE key='admin_sub_token'").first(); if(r && r.val) adminSubToken = r.val; } catch(e){} 
            isValid = (token === adminSubToken) || (token === await sha256(env.ADMIN_PASSWORD || "admin")); 
        } 
        else { 
            const u = await db.prepare("SELECT password, sub_token FROM users WHERE username = ?").bind(reqUser).first(); 
            if (u) isValid = (token === u.sub_token) || (!u.sub_token && token === u.password); 
        }
        
        if (!isValid) return new Response("Forbidden", { status: 403 });
        
        const now = Date.now(); 
        let query; 
        let sqlParams = [now];
        
        if (reqUser === adminUser) { 
            query = `SELECT * FROM nodes WHERE enable = 1 AND (traffic_limit = 0 OR traffic_used < traffic_limit) AND (expire_time = 0 OR expire_time > ?) AND (username = ? OR username = 'admin')`; 
            sqlParams.push(adminUser); 
            if (ip) { query += " AND vps_ip = ?"; sqlParams.push(ip); } 
        } else { 
            query = `SELECT n.* FROM nodes n JOIN users u ON n.username = u.username WHERE n.enable = 1 AND (n.traffic_limit = 0 OR n.traffic_used < n.traffic_limit) AND (n.expire_time = 0 OR n.expire_time > ?) AND n.username = ? AND u.enable = 1 AND (u.traffic_limit = 0 OR u.traffic_used < u.traffic_limit) AND (u.expire_time = 0 OR u.expire_time > ?)`; 
            sqlParams.push(reqUser, now); 
            if (ip) { query += " AND n.vps_ip = ?"; sqlParams.push(ip); } 
        }
        
        const { results } = await db.prepare(query).bind(...sqlParams).all(); 
        
        let subLinks = [];
        let clashProxies = [];
        let proxyNames = [];

        for (let node of results) {
            const vpsInfo = await db.prepare("SELECT name FROM servers WHERE ip = ?").bind(node.vps_ip).first(); 
            const rawRemark = `${vpsInfo ? vpsInfo.name : 'KUI'} | ${node.protocol}_${node.port}`; 
            const remark = encodeURIComponent(rawRemark); 
            let link = "";
            let cProxy = "";

            // --- 传统 Base64 URL 生成 ---
            switch (node.protocol) {
                case "VLESS": link = `vless://${node.uuid}@${node.vps_ip}:${node.port}?encryption=none&security=none&type=tcp#${remark}`; break;
                case "XTLS-Reality": case "Reality": link = `vless://${node.uuid}@${node.vps_ip}:${node.port}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${node.sni}&fp=chrome&pbk=${node.public_key}&sid=${node.short_id || ""}&type=tcp&headerType=none#${remark}`; break;
                case "Hysteria2": link = `hysteria2://${node.uuid}@${node.vps_ip}:${node.port}/?insecure=1&sni=${node.sni}&alpn=h3#${remark}`; break;
                case "TUIC": link = `tuic://${node.uuid}:${node.private_key}@${node.vps_ip}:${node.port}?sni=${node.sni}&congestion_control=bbr&alpn=h3&allow_insecure=1#${remark}`; break;
                case "Trojan": link = `trojan://${node.private_key}@${node.vps_ip}:${node.port}?security=tls&sni=${node.sni}&allowInsecure=1&type=tcp#${remark}`; break;
                case "H2-Reality": link = `vless://${node.uuid}@${node.vps_ip}:${node.port}?encryption=none&security=reality&sni=${node.sni}&fp=chrome&pbk=${node.public_key}&sid=${node.short_id || ""}&type=http#${remark}`; break;
                case "gRPC-Reality": link = `vless://${node.uuid}@${node.vps_ip}:${node.port}?encryption=none&security=reality&sni=${node.sni}&fp=chrome&pbk=${node.public_key}&sid=${node.short_id || ""}&type=grpc&serviceName=grpc#${remark}`; break;
                case "AnyTLS": link = `anytls://${node.private_key}@${node.vps_ip}:${node.port}?security=tls&sni=${node.sni}&insecure=1#${remark}`; break;
                case "Naive": link = `naive+https://${node.uuid}:${node.private_key}@${node.vps_ip}:${node.port}?security=tls&sni=${node.sni}#${remark}`; break;
                case "Socks5": link = `socks5://${btoa(`${node.uuid}:${node.private_key}`)}@${node.vps_ip}:${node.port}#${remark}`; break;
                case "VLESS-Argo": if (!node.sni.includes('等待')) link = `vless://${node.uuid}@${node.sni}:443?encryption=none&security=tls&type=ws&host=${node.sni}&path=%2F#${remark}-Argo`; break;
            }
            if (link) subLinks.push(link);

            // --- 动态拼装 Clash YAML 代理字典 (支持 Clash Meta / Mihomo) ---
            if (format === 'clash') {
                if (node.protocol.includes("VLESS") || node.protocol.includes("Reality")) {
                    const serverIpOrSni = (node.protocol === 'VLESS-Argo' && !node.sni.includes('等待')) ? node.sni : node.vps_ip;
                    const serverPort = node.protocol === 'VLESS-Argo' ? 443 : node.port;
                    cProxy = `  - name: "${rawRemark}"\n    type: vless\n    server: ${serverIpOrSni}\n    port: ${serverPort}\n    uuid: ${node.uuid}\n    udp: true`;
                    
                    if (node.protocol === "XTLS-Reality" || node.protocol === "Reality") {
                        cProxy += `\n    tls: true\n    flow: xtls-rprx-vision\n    servername: ${node.sni}\n    client-fingerprint: chrome\n    reality-opts:\n      public-key: ${node.public_key}\n      short-id: ${node.short_id || ""}`;
                    } else if (node.protocol === "gRPC-Reality") {
                        cProxy += `\n    tls: true\n    servername: ${node.sni}\n    client-fingerprint: chrome\n    network: grpc\n    grpc-opts:\n      grpc-service-name: grpc\n    reality-opts:\n      public-key: ${node.public_key}\n      short-id: ${node.short_id || ""}`;
                    } else if (node.protocol === "H2-Reality") {
                        cProxy += `\n    tls: true\n    servername: ${node.sni}\n    client-fingerprint: chrome\n    network: h2\n    reality-opts:\n      public-key: ${node.public_key}\n      short-id: ${node.short_id || ""}`;
                    } else if (node.protocol === 'VLESS-Argo' && !node.sni.includes('等待')) {
                        cProxy += `\n    tls: true\n    servername: ${node.sni}\n    network: ws\n    ws-opts:\n      path: "/"\n      headers:\n        Host: ${node.sni}`;
                    }
                } else if (node.protocol === "Trojan") {
                    cProxy = `  - name: "${rawRemark}"\n    type: trojan\n    server: ${node.vps_ip}\n    port: ${node.port}\n    password: ${node.private_key}\n    udp: true\n    sni: ${node.sni}\n    skip-cert-verify: true`;
                } else if (node.protocol === "Hysteria2") {
                    cProxy = `  - name: "${rawRemark}"\n    type: hysteria2\n    server: ${node.vps_ip}\n    port: ${node.port}\n    password: ${node.uuid}\n    sni: ${node.sni}\n    skip-cert-verify: true`;
                } else if (node.protocol === "TUIC") {
                    cProxy = `  - name: "${rawRemark}"\n    type: tuic\n    server: ${node.vps_ip}\n    port: ${node.port}\n    uuid: ${node.uuid}\n    password: ${node.private_key}\n    sni: ${node.sni}\n    skip-cert-verify: true`;
                }
                
                if (cProxy) {
                    clashProxies.push(cProxy);
                    proxyNames.push(`"${rawRemark}"`);
                }
            }
        }

        // --- 若为 Clash 格式，渲染 YAML 返回 ---
        if (format === 'clash') {
            const proxyGroupList = proxyNames.length > 0 ? proxyNames.map(n => `      - ${n}`).join('\n') : '      - DIRECT';
            const clashYaml = `port: 7890
socks-port: 7891
allow-lan: true
mode: rule
log-level: info
ipv6: false
external-controller: 127.0.0.1:9090

proxies:
${clashProxies.join('\n')}

proxy-groups:
  - name: "PROXY"
    type: select
    proxies:
      - "AUTO"
${proxyGroupList}
  - name: "AUTO"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    proxies:
${proxyGroupList}

rules:
  - MATCH,PROXY
`;
            return new Response(clashYaml, { 
                headers: { 
                    "Content-Type": "text/yaml; charset=utf-8", 
                    "Content-Disposition": "attachment; filename=kui-clash.yaml" 
                }
            });
        }

        // --- 否则走默认的 Base64 普通订阅格式 ---
        return new Response(btoa(unescape(encodeURIComponent(subLinks.join('\n')))), { headers: { "Content-Type": "text/plain; charset=utf-8" }});
    }

    if (action === "login" && method === "POST") {
        await ensureDbSchema(db); const username = await verifyAuth(request.headers.get("Authorization"), db, env);
        if (username) return Response.json({ success: true, role: username === (env.ADMIN_USERNAME || "admin") ? 'admin' : 'user' });
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentUser = await verifyAuth(request.headers.get("Authorization"), db, env);
    const isAdmin = currentUser === (env.ADMIN_USERNAME || "admin");
    if (!currentUser) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
        if (action === "data") {
            const servers = (await db.prepare("SELECT * FROM servers").all()).results;
            const nodes = isAdmin ? (await db.prepare("SELECT * FROM nodes").all()).results : (await db.prepare("SELECT * FROM nodes WHERE username = ?").bind(currentUser).all()).results;
            const users = isAdmin ? (await db.prepare("SELECT * FROM users").all()).results : (await db.prepare("SELECT * FROM users WHERE username = ?").bind(currentUser).all()).results;
            let siteTitle = "Cluster Gateway"; try { const r = await db.prepare("SELECT val FROM sys_config WHERE key='site_title'").first(); if(r && r.val) siteTitle = r.val; } catch(e){}
            let mySubToken = "";
            if (isAdmin) { try { const r = await db.prepare("SELECT val FROM sys_config WHERE key='admin_sub_token'").first(); if(r && r.val) mySubToken = r.val; } catch(e){} } 
            else { const u = await db.prepare("SELECT sub_token FROM users WHERE username = ?").bind(currentUser).first(); if(u && u.sub_token) mySubToken = u.sub_token; }
            return Response.json({ servers, nodes, users, siteTitle, mySubToken });
        }
        
        if (action === "settings" && method === "POST" && isAdmin) { const { site_title } = await request.json(); await db.prepare("INSERT OR REPLACE INTO sys_config (key, val, ts) VALUES ('site_title', ?, ?)").bind(site_title, Date.now()).run(); return Response.json({ success: true }); }
        if (action === "user" && params.path[1] === "password" && method === "PUT") { const { password } = await request.json(); if (isAdmin) return Response.json({error: "管理员密码受绝对安全保护，仅可通过 Cloudflare Pages 环境变量修改！"}, {status: 400}); const hash = await sha256(password); await db.prepare("UPDATE users SET password = ? WHERE username = ?").bind(hash, currentUser).run(); return Response.json({ success: true }); }
        if (action === "user" && params.path[1] === "sub_token" && method === "PUT") { const newToken = crypto.randomUUID(); if (isAdmin) await db.prepare("INSERT OR REPLACE INTO sys_config (key, val, ts) VALUES ('admin_sub_token', ?, ?)").bind(newToken, Date.now()).run(); else await db.prepare("UPDATE users SET sub_token = ? WHERE username = ?").bind(newToken, currentUser).run(); return Response.json({ success: true, token: newToken }); }
        if (action === "stats" && method === "GET" && isAdmin) { const query = `SELECT strftime('%m-%d', datetime(timestamp / 1000, 'unixepoch', 'localtime')) as day, SUM(delta_bytes) as total_bytes FROM traffic_stats WHERE ip = ? AND timestamp > ? GROUP BY day ORDER BY day ASC`; const { results } = await db.prepare(query).bind(new URL(request.url).searchParams.get("ip"), Date.now() - 604800000).all(); return Response.json(results || []); }
        
        if (action === "users" && isAdmin) {
            if (method === "POST") { const { username, password, traffic_limit, expire_time } = await request.json(); const hash = await sha256(password); const subToken = crypto.randomUUID(); await db.prepare("INSERT INTO users (username, password, traffic_limit, expire_time, sub_token) VALUES (?, ?, ?, ?, ?)").bind(username, hash, traffic_limit, expire_time, subToken).run(); return Response.json({ success: true }); }
            if (method === "PUT") { const { username, enable, reset_traffic } = await request.json(); if (reset_traffic) await db.prepare("UPDATE users SET traffic_used = 0 WHERE username = ?").bind(username).run(); else if (enable !== undefined) await db.prepare("UPDATE users SET enable = ? WHERE username = ?").bind(enable, username).run(); return Response.json({ success: true }); }
            if (method === "DELETE") { const target = new URL(request.url).searchParams.get("username"); await db.prepare("DELETE FROM users WHERE username = ?").bind(target).run(); await db.prepare("UPDATE nodes SET username = ? WHERE username = ?").bind(currentUser, target).run(); return Response.json({ success: true }); }
        }
        
        if (action === "vps" && isAdmin) {
            if (method === "POST") { const { ip, name } = await request.json(); await db.prepare("INSERT OR IGNORE INTO servers (ip, name, alert_sent) VALUES (?, ?, 0)").bind(ip, name).run(); return Response.json({ success: true }); }
            if (method === "DELETE") { 
                const ip = new URL(request.url).searchParams.get("ip"); 
                await db.batch([ db.prepare("DELETE FROM nodes WHERE vps_ip = ?").bind(ip), db.prepare("DELETE FROM traffic_stats WHERE ip = ?").bind(ip), db.prepare("DELETE FROM servers WHERE ip = ?").bind(ip), db.prepare("DELETE FROM probe_servers WHERE id = ?").bind(ip) ]); 
                return Response.json({ success: true }); 
            }
        }

        if (action === "nodes" && isAdmin) {
            if (method === "POST") { const n = await request.json(); let nodeUser = n.username || currentUser; if (nodeUser === 'admin') nodeUser = currentUser; await db.prepare(`INSERT INTO nodes (id, uuid, vps_ip, protocol, port, sni, private_key, public_key, short_id, relay_type, target_ip, target_port, target_id, enable, traffic_used, traffic_limit, expire_time, username) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(n.id, n.uuid, n.vps_ip, n.protocol, n.port, n.sni||null, n.private_key||null, n.public_key||null, n.short_id||null, n.relay_type||null, n.target_ip||null, n.target_port||null, n.target_id||null, 1, 0, n.traffic_limit||0, n.expire_time||0, nodeUser).run(); return Response.json({ success: true }); }
            if (method === "PUT") { const { id, enable, reset_traffic } = await request.json(); if (reset_traffic) await db.prepare("UPDATE nodes SET traffic_used = 0 WHERE id = ?").bind(id).run(); else if (enable !== undefined) await db.prepare("UPDATE nodes SET enable = ? WHERE id = ?").bind(enable, id).run(); return Response.json({ success: true }); }
            if (method === "DELETE") { await db.prepare("DELETE FROM nodes WHERE id = ?").bind(new URL(request.url).searchParams.get("id")).run(); return Response.json({ success: true }); }
        }

        return new Response("Not Found", { status: 404 });
    } catch (err) { return Response.json({ error: err.message }, { status: 500 }); }
}

export async function onRequestScheduled(context) {
    const { env } = context; const db = env.DB; const nowMs = Date.now();
    try {
        const { results } = await db.prepare(`SELECT ip, name, last_report FROM servers WHERE last_report < ? AND alert_sent = 0`).bind(nowMs - 180000).all();
        if (results && results.length > 0) {
            let tgBotToken = env.TG_BOT_TOKEN; let tgChatId = env.TG_CHAT_ID;
            try { const { results: settings } = await db.prepare("SELECT key, value FROM probe_settings WHERE key IN ('tg_bot_token', 'tg_chat_id')").all(); settings.forEach(r => { if(r.key === 'tg_bot_token') tgBotToken = r.value; if(r.key === 'tg_chat_id') tgChatId = r.value; }); } catch(e){}
            
            const updateStmts = [];
            for (let vps of results) {
                if (tgBotToken && tgChatId) { const text = `⚠️ [KUI 节点失联告警]\n\n节点别名: ${vps.name}\n公网IP: ${vps.ip}\n最后在线: ${new Date(vps.last_report).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`; await fetch(`https://api.telegram.org/bot${tgBotToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: tgChatId, text }) }); }
                updateStmts.push(db.prepare("UPDATE servers SET alert_sent = 1 WHERE ip = ?").bind(vps.ip));
            }
            if (updateStmts.length > 0) await db.batch(updateStmts);
        }
    } catch (error) {}
}
