<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>KUI Serverless 极速聚合面板</title>
    <!-- 核心依赖库 -->
    <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/tweetnacl@1.0.3/nacl-fast.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
    <style>
        [v-cloak] { display: none !important; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.5); border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(107, 114, 128, 0.8); }
        input:focus, select:focus { outline: none; box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.4); }
    </style>
</head>
<body class="bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-50 min-h-screen text-slate-700 font-sans p-4 md:p-8 selection:bg-indigo-200 selection:text-indigo-900 relative">
    
    <div id="app" v-cloak class="max-w-6xl mx-auto space-y-8">
        
        <!-- ================= 登录界面 ================= -->
        <div v-if="!isLoggedIn" class="bg-white/60 backdrop-blur-xl border border-white/80 p-10 rounded-[2.5rem] shadow-2xl shadow-indigo-100/50 max-w-sm mx-auto mt-24 transform transition-all">
            <div class="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl mx-auto mb-6 shadow-lg flex items-center justify-center"><span class="text-white text-3xl">✨</span></div>
            <h2 class="text-3xl font-black mb-8 text-center bg-clip-text text-transparent bg-gradient-to-r from-slate-800 to-slate-600">系统准入</h2>
            <input v-model="loginUser" placeholder="用户名 (管理员为 admin)" class="w-full bg-white/50 border border-white/60 p-4 rounded-2xl mb-4 focus:bg-white transition-all">
            <input v-model="password" type="password" placeholder="请输入密码" @keyup.enter="login" class="w-full bg-white/50 border border-white/60 p-4 rounded-2xl mb-8 focus:bg-white transition-all">
            <button @click="login" class="w-full bg-gradient-to-r from-slate-800 to-black text-white p-4 rounded-2xl font-bold shadow-lg hover:scale-[1.02] active:scale-95 transition-all">登 入</button>
        </div>

        <!-- ================= 面板主界面 ================= -->
        <div v-else class="space-y-8 animate-fade-in">
            
            <div class="bg-white/70 backdrop-blur-xl border border-white/80 p-4 md:px-8 rounded-[2rem] md:rounded-full shadow-xl shadow-slate-200/50 flex flex-col xl:flex-row justify-between items-center sticky top-4 z-50">
                
                <h1 class="text-2xl font-black mb-4 xl:mb-0 bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600 shrink-0">
                    <template v-if="siteTitle && siteTitle !== 'Cluster Gateway'">{{ siteTitle }}</template>
                    <template v-else>Cluster <span class="font-medium text-slate-400">Gateway</span></template>
                </h1>
                
                <!-- 🌟 修复：补充了 YouTube 频道和 Github 仓库的入口 -->
                <div class="flex flex-wrap justify-center gap-3 items-center shrink-0 w-full xl:w-auto">
                    <a href="https://www.youtube.com/@%E7%A7%91%E6%8A%80KKK" target="_blank" class="bg-white/50 hover:bg-white/90 border border-slate-200 px-3 md:px-4 py-2 rounded-full text-[11px] md:text-sm font-bold text-slate-600 hover:text-rose-600 transition-all flex items-center justify-center gap-1.5 shadow-sm hover:shadow-md cursor-pointer">
                        📺 Youtube频道
                    </a>
                    <a href="https://github.com/a62169722/KUI" target="_blank" class="bg-white/50 hover:bg-white/90 border border-slate-200 px-3 md:px-4 py-2 rounded-full text-[11px] md:text-sm font-bold text-slate-600 hover:text-slate-900 transition-all flex items-center justify-center gap-1.5 shadow-sm hover:shadow-md cursor-pointer mr-auto xl:mr-4">
                        🐙 Github仓库
                    </a>
                    <span class="text-[11px] md:text-xs font-bold text-emerald-500 bg-emerald-100/50 px-3 py-2 rounded-full border border-emerald-200 animate-pulse">🟢 <span class="hidden md:inline">实时高速监控中</span></span>
                    <button v-if="role === 'admin'" @click="copyCommand(generateSubLink(''), '全量聚合订阅已复制！')" class="bg-gradient-to-r from-indigo-500 to-purple-500 text-white px-4 md:px-5 py-2 rounded-full text-[11px] md:text-sm font-bold shadow-md hover:scale-105 active:scale-95 transition-all">🔗 复制全量订阅</button>
                    <button @click="refreshData" class="bg-white/50 hover:bg-white/80 border border-slate-200 px-3 md:px-5 py-2 rounded-full text-[11px] md:text-sm font-medium transition-all shadow-sm">🔄 刷新</button>
                    <button @click="logout" class="text-rose-500 hover:bg-rose-50 px-3 md:px-5 py-2 rounded-full text-[11px] md:text-sm font-bold transition-all">退出</button>
                </div>
            </div>

            <!-- 核心导航区 -->
            <div class="flex justify-center mb-4">
                <div class="bg-slate-200/50 p-1.5 rounded-full flex flex-wrap justify-center gap-1 backdrop-blur-sm border border-white/50 shadow-inner">
                    <template v-if="role === 'admin'">
                        <button @click="activeTab = 'nodes'" :class="activeTab === 'nodes' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'" class="px-6 md:px-8 py-2.5 rounded-full font-bold transition-all text-sm md:text-base">服务器与节点</button>
                        <button @click="activeTab = 'users'" :class="activeTab === 'users' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'" class="px-6 md:px-8 py-2.5 rounded-full font-bold transition-all text-sm md:text-base">多用户管理</button>
                        <button @click="activeTab = 'settings'" :class="activeTab === 'settings' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'" class="px-6 md:px-8 py-2.5 rounded-full font-bold transition-all text-sm md:text-base">⚙️ 系统设置</button>
                    </template>
                    <template v-if="role === 'user'">
                        <button @click="activeTab = 'dashboard'" :class="activeTab === 'dashboard' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'" class="px-6 md:px-8 py-2.5 rounded-full font-bold transition-all text-sm md:text-base">我的主页</button>
                        <button @click="activeTab = 'settings'" :class="activeTab === 'settings' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'" class="px-6 md:px-8 py-2.5 rounded-full font-bold transition-all text-sm md:text-base">⚙️ 系统设置</button>
                    </template>
                </div>
            </div>

            <!-- ================= 管理员专属板块 ================= -->
            <div v-if="role === 'admin'" class="space-y-8">
                
                <!-- 大盘统计 -->
                <div v-if="activeTab === 'nodes'" class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="bg-white/60 backdrop-blur-xl p-5 rounded-[2rem] border border-white shadow-lg shadow-indigo-100/30 text-center">
                        <div class="text-[10px] text-slate-400 font-bold mb-1 tracking-widest">ONLINE SERVERS</div>
                        <div class="text-3xl font-black text-slate-700">{{ globalOnline }} / {{ servers.length }}</div>
                    </div>
                    <div class="bg-white/60 backdrop-blur-xl p-5 rounded-[2rem] border border-white shadow-lg shadow-indigo-100/30 text-center">
                        <div class="text-[10px] text-slate-400 font-bold mb-1 tracking-widest">AGGREGATE TRAFFIC</div>
                        <div class="text-3xl font-black text-slate-700">{{ formatBytes(globalTraffic) }}</div>
                    </div>
                    <div class="bg-white/60 backdrop-blur-xl p-5 rounded-[2rem] border border-white shadow-lg shadow-indigo-100/30 text-center">
                        <div class="text-[10px] text-slate-400 font-bold mb-1 tracking-widest">DOWNLOAD</div>
                        <div class="text-2xl font-black text-emerald-500 truncate">↓ {{ formatBytes(globalSpeedIn) }}/s</div>
                    </div>
                    <div class="bg-white/60 backdrop-blur-xl p-5 rounded-[2rem] border border-white shadow-lg shadow-indigo-100/30 text-center">
                        <div class="text-[10px] text-slate-400 font-bold mb-1 tracking-widest">UPLOAD</div>
                        <div class="text-2xl font-black text-blue-500 truncate">↑ {{ formatBytes(globalSpeedOut) }}/s</div>
                    </div>
                </div>

                <!-- 用户管理板块 -->
                <div v-if="activeTab === 'users'" class="space-y-6">
                    <div class="bg-white/60 backdrop-blur-xl p-6 md:p-8 rounded-[2rem] border border-white shadow-xl shadow-slate-200/40 flex flex-col xl:flex-row gap-4 items-end">
                        <div class="flex-1 w-full"><label class="block text-xs font-bold text-slate-400 mb-2 pl-2">新建用户名</label><input v-model="newUser.username" placeholder="如: user01" class="w-full bg-white/50 border border-white p-3 rounded-2xl transition hover:bg-white focus:bg-white"></div>
                        <div class="flex-1 w-full relative">
                            <label class="block text-xs font-bold text-slate-400 mb-2 pl-2">登录密码 / 随机UUID</label>
                            <input v-model="newUser.password" type="text" placeholder="自定义密码 或 UUID" class="w-full bg-white/50 border border-white p-3 pr-12 rounded-2xl transition hover:bg-white focus:bg-white font-mono text-sm">
                            <button @click="generateUUIDForNewUser" title="随机生成 UUID 密码" class="absolute right-3 top-[34px] p-1 bg-white rounded-lg shadow-sm hover:bg-indigo-50 transition-colors">🔄</button>
                        </div>
                        <div class="flex-1 w-full"><label class="block text-xs font-bold text-slate-400 mb-2 pl-2">配额 (GB)</label><input v-model="newUser.traffic_limit_gb" type="number" placeholder="0为无限" class="w-full bg-white/50 border border-white p-3 rounded-2xl transition hover:bg-white focus:bg-white"></div>
                        <div class="flex-1 w-full"><label class="block text-xs font-bold text-slate-400 mb-2 pl-2">有效期</label><input v-model="newUser.expire_date" type="date" class="w-full bg-white/50 border border-white p-3 rounded-2xl text-slate-600 transition hover:bg-white focus:bg-white"></div>
                        <button @click="addUser" class="w-full xl:w-auto bg-slate-800 text-white px-8 py-3.5 rounded-2xl font-bold hover:bg-black transition-all shadow-lg hover:scale-105 active:scale-95 whitespace-nowrap">开通用户</button>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div v-for="u in users" :key="u.username" class="bg-white/70 backdrop-blur-xl p-6 rounded-[2rem] border border-white shadow-xl shadow-slate-200/40 hover:shadow-indigo-100/50 transition-all">
                            <div class="flex justify-between items-start mb-6">
                                <div>
                                    <h3 class="text-2xl font-black text-slate-800 mb-1 flex items-center gap-2">{{ u.username }} <span v-if="u.enable===0" class="text-[10px] bg-rose-100 text-rose-600 px-2 py-1 rounded-lg">已封禁</span></h3>
                                    <div class="text-xs text-slate-400 font-medium">到期: {{ formatDate(u.expire_time) }}</div>
                                </div>
                                <div class="flex gap-2">
                                    <button @click="toggleUser(u.username, u.enable===1?0:1)" class="px-3 py-1.5 bg-white border border-slate-100 hover:bg-slate-50 rounded-xl text-xs font-bold shadow-sm">{{ u.enable===1?'停用':'启用' }}</button>
                                    <button @click="deleteUser(u.username)" class="px-3 py-1.5 bg-rose-50 text-rose-500 rounded-xl text-xs font-bold transition-all">删除</button>
                                </div>
                            </div>
                            <div class="flex justify-between text-xs text-slate-500 mb-2 font-bold"><span>已用: {{ formatBytes(u.traffic_used) }}</span><span>上限: {{ u.traffic_limit > 0 ? formatBytes(u.traffic_limit) : '无限' }}</span></div>
                            <div class="w-full bg-slate-100 rounded-full h-2.5 mb-3 overflow-hidden shadow-inner"><div :class="(u.traffic_limit > 0 && u.traffic_used >= u.traffic_limit) ? 'bg-rose-500' : 'bg-gradient-to-r from-blue-400 to-indigo-500'" class="h-2.5 rounded-full" :style="{ width: getTrafficPercent(u.traffic_used, u.traffic_limit) + '%' }"></div></div>
                            <button v-if="u.traffic_used > 0" @click="resetUserTraffic(u.username)" class="text-[11px] text-indigo-500 font-bold hover:underline">重置流量</button>
                        </div>
                    </div>
                </div>

                <!-- 服务器与节点管理板块 -->
                <div v-if="activeTab === 'nodes'" class="space-y-8">
                    <!-- 接入机器表单 -->
                    <div class="bg-white/60 backdrop-blur-xl p-6 md:p-8 rounded-[2rem] border border-white shadow-xl shadow-slate-200/40 flex flex-col md:flex-row gap-4 items-end">
                        <div class="flex-1"><label class="block text-xs font-bold text-slate-400 mb-2 pl-2">服务器别名</label><input v-model="newVps.name" placeholder="例如: 日本软银 01" class="w-full bg-white/50 border border-white p-3 rounded-2xl transition hover:bg-white focus:bg-white"></div>
                        <div class="flex-1"><label class="block text-xs font-bold text-slate-400 mb-2 pl-2">公网 IP</label><input v-model="newVps.ip" placeholder="8.8.8.8" class="w-full bg-white/50 border border-white p-3 rounded-2xl transition hover:bg-white focus:bg-white"></div>
                        <div class="w-full md:w-48"><label class="block text-xs font-bold text-slate-400 mb-2 pl-2">系统架构</label>
                            <select v-model="newVps.os" class="w-full bg-white/50 border border-white p-3 rounded-2xl transition hover:bg-white focus:bg-white outline-none font-medium text-slate-700">
                                <option value="debian">Ubuntu / Debian</option>
                                <option value="alpine">Alpine Linux</option>
                            </select>
                        </div>
                        <button @click="addVps" class="bg-slate-800 text-white px-8 py-3.5 rounded-2xl font-bold hover:bg-black transition-all shadow-lg hover:scale-105 whitespace-nowrap">接入机器</button>
                    </div>

                    <!-- 机器列表大网格 -->
                    <div class="grid grid-cols-1 xl:grid-cols-2 gap-8">
                        <div v-for="vps in servers" :key="vps.ip" class="bg-white/70 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/40 flex flex-col overflow-hidden transition-all hover:shadow-2xl">
                            
                            <!-- 机器头部监控数据 -->
                            <div class="p-6 md:p-8 relative">
                                <div class="flex justify-between items-start mb-4">
                                    <div>
                                        <h3 class="font-black text-2xl text-slate-800 flex items-center gap-2 mb-1">{{ vps.name }}<span :class="isOnline(vps.last_report) ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]'" class="w-3 h-3 rounded-full inline-block"></span></h3>
                                        <p class="text-sm font-mono text-slate-400 font-medium">{{ vps.ip }}</p>
                                    </div>
                                    <button @click="deleteVps(vps.ip)" class="text-slate-300 hover:text-rose-500 font-bold transition-all">彻底移除</button>
                                </div>
                                
                                <div class="flex justify-between text-[10px] text-slate-400 font-mono font-black mb-4 px-1 uppercase tracking-wider">
                                    <span>UP: {{ vps.uptime || 'N/A' }}</span>
                                    <span>LOAD: {{ vps.load || '0.00' }}</span>
                                </div>

                                <div class="grid grid-cols-4 gap-2 mb-6">
                                    <div class="bg-white/50 p-3 rounded-2xl border border-white shadow-sm flex flex-col justify-between">
                                        <div class="text-[9px] text-slate-400 font-bold tracking-wider mb-1">CPU</div>
                                        <div class="font-black text-lg text-slate-700">{{ vps.cpu || 0 }}%</div>
                                        <div class="w-full bg-slate-200/50 rounded-full h-1 mt-1 overflow-hidden"><div class="bg-indigo-400 h-1 rounded-full" :style="{ width: (vps.cpu || 0) + '%' }"></div></div>
                                    </div>
                                    <div class="bg-white/50 p-3 rounded-2xl border border-white shadow-sm flex flex-col justify-between">
                                        <div class="text-[9px] text-slate-400 font-bold tracking-wider mb-1">MEM</div>
                                        <div class="font-black text-lg text-slate-700">{{ vps.mem || 0 }}%</div>
                                        <div class="w-full bg-slate-200/50 rounded-full h-1 mt-1 overflow-hidden"><div class="bg-purple-400 h-1 rounded-full" :style="{ width: (vps.mem || 0) + '%' }"></div></div>
                                    </div>
                                    <div class="bg-white/50 p-3 rounded-2xl border border-white shadow-sm flex flex-col justify-between">
                                        <div class="text-[9px] text-slate-400 font-bold tracking-wider mb-1">DISK</div>
                                        <div class="font-black text-lg text-slate-700">{{ vps.disk || 0 }}%</div>
                                        <div class="w-full bg-slate-200/50 rounded-full h-1 mt-1 overflow-hidden"><div class="bg-emerald-400 h-1 rounded-full" :style="{ width: (vps.disk || 0) + '%' }"></div></div>
                                    </div>
                                    <div class="bg-white/50 p-2 rounded-2xl border border-white shadow-sm flex flex-col justify-center text-center">
                                        <div class="text-[9px] text-slate-400 font-bold tracking-wider mb-1">SPEED</div>
                                        <div class="text-[10px] font-black text-emerald-500 truncate">↓ {{ formatBytes(vps.net_in_speed || 0) }}/s</div>
                                        <div class="text-[10px] font-black text-blue-500 truncate mt-0.5">↑ {{ formatBytes(vps.net_out_speed || 0) }}/s</div>
                                    </div>
                                </div>

                                <div class="bg-white/40 p-4 rounded-2xl border border-white">
                                    <div class="text-[10px] text-slate-400 font-bold tracking-wider mb-2">7-DAY TRAFFIC TREND</div>
                                    <div :id="'chart-' + vps.ip" class="w-full h-32"></div>
                                </div>
                            </div>

                            <div class="px-6 md:px-8 pb-4">
                                
                                <!-- 🌟 彻底强化：FSCARMEN 全系 12 大协议极速部署模块 -->
                                <div class="bg-indigo-50/70 border-2 border-dashed border-indigo-200 p-6 rounded-[1.5rem] mb-2 relative overflow-hidden group shadow-sm hover:border-indigo-300 transition-all">
                                    <div class="absolute top-0 right-0 bg-indigo-500 text-white text-[10px] font-black px-3 py-1 rounded-bl-xl shadow-sm">FSCARMEN QUICK INSTALL</div>
                                    <h4 class="font-black text-indigo-800 text-lg mb-2 flex items-center gap-2">🚀 极速全量节点下发 (12合1)</h4>
                                    <p class="text-xs text-indigo-500/80 font-bold mb-5 leading-relaxed">
                                        输入起始端口，系统将采用 FSCARMEN 算法依次为您生成全部 12 个协议阵列：XTLS+Reality, Hysteria2, TUIC, ShadowTLS, Shadowsocks, Trojan, VMess+WS, VLESS+WS+TLS, H2+Reality, gRPC+Reality, AnyTLS, Naive。
                                    </p>
                                    
                                    <div class="flex flex-col md:flex-row gap-4 mb-2">
                                        <div class="flex-1">
                                            <label class="block text-[10px] text-indigo-400 font-bold mb-1 pl-1">归属用户设置</label>
                                            <select v-model="batchUser[vps.ip]" class="w-full bg-white border border-indigo-100 text-indigo-700 font-bold text-sm p-3.5 rounded-xl outline-none focus:shadow-md transition">
                                                <option value="admin">👤 管理员自身</option>
                                                <option v-for="u in users" :value="u.username">👤 {{ u.username }}</option>
                                            </select>
                                        </div>
                                        <div class="flex-1">
                                            <label class="block text-[10px] text-indigo-400 font-bold mb-1 pl-1">起始端口 (建议 8881)</label>
                                            <input v-model="batchStartPort[vps.ip]" type="number" placeholder="例如: 8881" class="w-full bg-white border border-indigo-100 p-3.5 rounded-xl outline-none text-sm font-mono text-indigo-900 focus:shadow-md transition">
                                        </div>
                                        <div class="flex items-end">
                                            <button @click="deployAllProtocols(vps.ip)" class="h-[50px] bg-gradient-to-r from-indigo-500 to-blue-600 text-white px-8 rounded-xl text-sm font-black shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all whitespace-nowrap">🚀 爆发下发</button>
                                        </div>
                                    </div>
                                </div>
                                <!-- 🌟 极速全量模块结束 -->

                                <!-- 保留手动精细化表单供特殊场景使用，并补全所有协议 -->
                                <div class="bg-gradient-to-br from-white/80 to-white/40 p-5 rounded-[1.5rem] border border-white shadow-sm mt-4">
                                    <div class="text-xs font-bold text-slate-400 mb-2 pl-1">手动单节点精细化下发</div>
                                    <select v-model="newNodeParams[vps.ip].username" class="w-full border-none bg-indigo-50/50 text-indigo-700 font-bold text-sm p-3 rounded-xl outline-none mb-3">
                                        <option value="admin">👤 归属权: 管理员自身</option>
                                        <option v-for="u in users" :value="u.username">👤 归属权: {{ u.username }}</option>
                                    </select>
                                    
                                    <div class="flex gap-3 mb-3">
                                        <select v-model="newNodeParams[vps.ip].protocol" class="border-none bg-slate-100/50 text-slate-700 text-sm p-3 rounded-xl flex-1 outline-none font-medium">
                                            <option value="XTLS-Reality">XTLS + Reality</option>
                                            <option value="Hysteria2">Hysteria2 (极速)</option>
                                            <option value="TUIC">TUIC v5 (高并发)</option>
                                            <option value="ShadowTLS">ShadowTLS</option>
                                            <option value="Shadowsocks">Shadowsocks</option>
                                            <option value="Trojan">Trojan</option>
                                            <option value="VMess-WS">VMess + WS</option>
                                            <option value="VLESS-WS-TLS">VLESS + WS + TLS</option>
                                            <option value="H2-Reality">H2 + Reality</option>
                                            <option value="gRPC-Reality">gRPC + Reality</option>
                                            <option value="AnyTLS">AnyTLS</option>
                                            <option value="Naive">Naive</option>
                                            <option disabled>──────────</option>
                                            <option value="VLESS-Argo">VLESS Argo (全自动穿透)</option>
                                            <option value="dokodemo-door">Dokodemo (内部转发)</option>
                                        </select>
                                        <input v-model="newNodeParams[vps.ip].port" type="number" placeholder="端口" class="bg-slate-100/50 text-slate-700 text-sm p-3 rounded-xl w-24 outline-none font-mono">
                                    </div>
                                    
                                    <div class="grid grid-cols-2 gap-3 mb-3">
                                        <div class="bg-slate-100/50 p-3 rounded-xl"><label class="block text-[10px] text-slate-400 font-bold mb-1">配额(GB, 0无限)</label><input v-model="newNodeParams[vps.ip].traffic_limit_gb" type="number" class="w-full text-sm bg-transparent outline-none font-bold text-slate-700"></div>
                                        <div class="bg-slate-100/50 p-3 rounded-xl"><label class="block text-[10px] text-slate-400 font-bold mb-1">到期日(留空永久)</label><input v-model="newNodeParams[vps.ip].expire_date" type="date" class="w-full text-sm bg-transparent outline-none font-bold text-slate-700"></div>
                                    </div>

                                    <div v-if="['XTLS-Reality', 'H2-Reality', 'gRPC-Reality'].includes(newNodeParams[vps.ip].protocol)" class="bg-slate-100/50 p-3 rounded-xl mb-3">
                                        <input v-model="newNodeParams[vps.ip].sni" :list="'sni-rec-' + vps.ip" placeholder="伪装域名: 支持手填或下拉" class="w-full bg-transparent outline-none text-sm font-medium text-slate-700">
                                        <datalist :id="'sni-rec-' + vps.ip">
                                            <option value="addons.mozilla.org"></option>
                                            <option value="www.apple.com"></option>
                                            <option value="gateway.icloud.com"></option>
                                            <option value="itunes.apple.com"></option>
                                            <option value="www.microsoft.com"></option>
                                        </datalist>
                                    </div>
                                    
                                    <div v-if="['TUIC', 'Hysteria2', 'ShadowTLS', 'Trojan', 'VLESS-WS-TLS', 'VMess-WS', 'AnyTLS', 'Naive'].includes(newNodeParams[vps.ip].protocol)" class="bg-slate-100/50 p-3 rounded-xl mb-3">
                                        <input v-model="newNodeParams[vps.ip].sni" placeholder="SNI 域名 / 主机名" class="w-full bg-transparent outline-none text-sm font-medium text-slate-700">
                                    </div>
                                    
                                    <button @click="addNode(vps.ip)" class="w-full bg-gradient-to-r from-slate-800 to-black text-white py-3 rounded-xl font-bold shadow-lg transition-all hover:scale-[1.02]">添加单节点</button>
                                </div>
                            </div>

                            <div class="p-6 md:p-8 bg-slate-50/50 border-t border-white flex-1">
                                <div v-for="node in getNodesByIp(vps.ip)" :key="node.id" class="bg-white/80 border border-white p-4 rounded-2xl mb-3 shadow-sm hover:shadow-md group transition-all">
                                    <div class="flex justify-between items-start mb-3">
                                        <div class="flex-1 overflow-hidden pr-2">
                                            <div class="flex items-center gap-2 mb-1.5">
                                                <span class="font-black text-slate-700">{{ node.protocol }} <span class="font-mono text-slate-400 text-xs bg-slate-100 px-1.5 rounded">#{{ node.port }}</span></span>
                                                <span class="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-md font-bold">👤 {{ node.username }}</span>
                                                <span v-if="node.enable === 0" class="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md font-bold">已停用</span>
                                            </div>
                                            <div v-if="node.protocol === 'VLESS-Argo'" class="text-[11px] p-1.5 rounded-lg overflow-hidden text-ellipsis whitespace-nowrap max-w-full inline-block" :class="node.sni.includes('等待') ? 'bg-amber-50 text-amber-600 animate-pulse font-bold' : 'bg-emerald-50 border border-emerald-100 text-emerald-700 font-mono font-bold'">Argo: {{ node.sni }}</div>
                                            <div v-else-if="node.sni" class="text-[11px] bg-slate-50 text-slate-500 p-1.5 rounded-lg overflow-hidden text-ellipsis font-mono inline-block">SNI: {{ node.sni }}</div>
                                        </div>
                                        <div class="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button @click="toggleNode(node.id, node.enable === 1 ? 0 : 1)" class="text-[11px] px-2 py-1 rounded-md bg-white border border-slate-200 hover:bg-slate-50 font-bold text-slate-600 shadow-sm">{{ node.enable === 1 ? '停用' : '启用' }}</button>
                                            <button @click="deleteNode(node.id)" class="text-rose-500 text-[11px] px-2 py-1 bg-white border border-rose-100 rounded-md hover:bg-rose-50 font-bold shadow-sm">删除</button>
                                        </div>
                                    </div>
                                    <div class="w-full bg-slate-100 rounded-full h-1.5 mt-2 overflow-hidden"><div :class="(node.traffic_limit > 0 && node.traffic_used >= node.traffic_limit) ? 'bg-rose-400' : 'bg-slate-800'" class="h-1.5 rounded-full transition-all duration-500" :style="{ width: getTrafficPercent(node.traffic_used, node.traffic_limit) + '%' }"></div></div>
                                    <div class="flex justify-between text-[10px] text-slate-400 mt-2 font-medium">
                                        <span>已用: {{ formatBytes(node.traffic_used) }} <span v-if="node.traffic_limit > 0">/ {{ formatBytes(node.traffic_limit) }}</span></span>
                                        <div class="flex gap-3">
                                            <span v-if="node.expire_time > 0">到期: {{ formatDate(node.expire_time) }}</span>
                                            <button v-if="node.traffic_used > 0" @click="resetTraffic(node.id)" class="text-indigo-500 hover:underline font-bold">清零</button>
                                        </div>
                                    </div>
                                </div>
                                <div v-if="getNodesByIp(vps.ip).length === 0" class="text-center text-slate-400 text-xs py-6 border-2 border-dashed border-slate-200 rounded-2xl font-medium">节点矩阵为空，请在上方一键下发建立</div>
                            </div>

                            <div class="p-4 md:p-6 bg-slate-100/50 border-t border-white grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div class="bg-slate-800 p-4 rounded-[1.25rem] group shadow-inner transition-colors">
                                    <div class="text-[10px] text-slate-400 font-bold uppercase mb-2 flex justify-between items-center">
                                        <span>Deploy Command</span>
                                        <div class="flex gap-2 text-[9px]">
                                            <label class="cursor-pointer hover:text-white flex items-center gap-1"><input type="radio" v-model="deployOsMap[vps.ip]" @change="saveOsMap" value="debian" class="accent-indigo-500"> Ubuntu/Debian</label>
                                            <label class="cursor-pointer hover:text-white flex items-center gap-1"><input type="radio" v-model="deployOsMap[vps.ip]" @change="saveOsMap" value="alpine" class="accent-indigo-500"> Alpine</label>
                                        </div>
                                    </div>
                                    <div class="text-emerald-400 font-mono text-xs truncate cursor-pointer hover:text-emerald-300 transition-colors" @click="copyCommand(generateCmd(vps.ip), '部署指令已复制！')">
                                        {{ generateCmd(vps.ip) }}
                                    </div>
                                </div>
                                <div class="bg-gradient-to-br from-indigo-500 to-purple-600 p-4 rounded-[1.25rem] cursor-pointer transition flex items-center justify-center text-white font-bold shadow-lg hover:scale-[1.02] active:scale-95" @click="copyCommand(generateSubLink(vps.ip), '单机节点订阅已复制！')">复制该机专属订阅</div>
                            </div>

                        </div>
                    </div>
                </div>
            </div>

            <!-- ================= 普通用户受限视图 ================= -->
            <div v-if="role === 'user'" class="space-y-8 animate-fade-in">
                
                <!-- 用户专属大盘区 -->
                <div v-if="activeTab === 'dashboard'" class="space-y-8">
                    <div class="bg-white/60 backdrop-blur-xl p-10 md:p-16 rounded-[3rem] shadow-2xl border border-white text-center relative overflow-hidden">
                        <div class="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-lg h-32 bg-indigo-400/20 blur-3xl rounded-full pointer-events-none"></div>
                        <h2 class="text-4xl md:text-5xl font-black mb-3 text-slate-800 relative z-10">Hi, {{ currentUser }} 👋</h2>
                        <p class="text-slate-500 mb-10 font-medium relative z-10">欢迎来到您的专属网络服务中心</p>
                        <div class="max-w-md mx-auto bg-white/80 p-8 rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 mb-10 relative z-10">
                            <div class="flex justify-between text-sm font-black text-slate-700 mb-3"><span>已用流量: {{ formatBytes(users[0]?.traffic_used || 0) }}</span><span class="text-indigo-600">总量: {{ users[0]?.traffic_limit > 0 ? formatBytes(users[0].traffic_limit) : '无限制' }}</span></div>
                            <div class="w-full bg-slate-100 rounded-full h-3 overflow-hidden shadow-inner mb-4"><div :class="users[0]?.traffic_used >= users[0]?.traffic_limit && users[0]?.traffic_limit > 0 ? 'bg-rose-500' : 'bg-gradient-to-r from-blue-400 to-indigo-500'" class="h-3 transition-all duration-1000 rounded-full" :style="{ width: getTrafficPercent(users[0]?.traffic_used||0, users[0]?.traffic_limit||0) + '%' }"></div></div>
                            <div class="flex justify-between mt-4 pt-4 border-t border-slate-100 text-xs text-slate-500 font-medium"><span>账户状态: <span :class="users[0]?.enable === 1 ? 'text-emerald-500 font-bold bg-emerald-50 px-2 py-1 rounded' : 'text-rose-500 font-bold bg-rose-50 px-2 py-1 rounded'">{{ users[0]?.enable === 1 ? '🟢 正常运行' : '🔴 已被封禁' }}</span></span><span>到期时间: <span class="font-bold text-slate-700">{{ formatDate(users[0]?.expire_time) }}</span></span></div>
                        </div>
                        <button @click="copyCommand(generateSubLink(''), '聚合链接已复制！')" class="relative z-10 bg-gradient-to-r from-slate-800 to-black text-white font-black py-4 px-12 rounded-full shadow-2xl transition-all transform hover:scale-105 active:scale-95 text-lg">🔗 一键复制我的专属订阅</button>
                    </div>
                    <div>
                        <h3 class="font-black text-xl mb-6 text-slate-700 px-4">📍 我已开通的节点</h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            <div v-for="node in nodes" :key="node.id" class="bg-white/70 backdrop-blur-xl p-6 rounded-[2rem] border border-white shadow-lg transition-all hover:-translate-y-1">
                                <div class="font-black text-xl mb-4 text-slate-800">{{ getVpsName(node.vps_ip) }}</div>
                                <div class="flex justify-between items-center"><span class="font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-xl text-xs">{{ node.protocol }}</span><span class="text-xs font-mono font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-xl">PORT: {{ node.port }}</span></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ================= 系统设置板块 ================= -->
            <div v-if="activeTab === 'settings'" class="space-y-6">
                
                <template v-if="role === 'admin'">
                    <div class="bg-white/60 backdrop-blur-xl p-8 rounded-[2.5rem] border border-white shadow-xl shadow-slate-200/40">
                        <h3 class="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">⚙️ 系统外观与偏好</h3>
                        <div class="max-w-md">
                            <label class="block text-xs font-bold text-slate-400 mb-2 pl-2">控制面板全局名称</label>
                            <div class="flex gap-3">
                                <input v-model="siteTitleInput" placeholder="Cluster Gateway" class="w-full bg-white/50 border border-white p-3 rounded-2xl transition hover:bg-white focus:bg-white text-sm font-medium">
                                <button @click="saveSiteTitle" class="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-md whitespace-nowrap">保存更改</button>
                            </div>
                            <p class="text-[11px] text-slate-400 mt-3 pl-2">修改后，面板左上角和浏览器标签页的名称将会全员同步更新。</p>
                        </div>
                    </div>
                    
                    <div class="bg-white/60 backdrop-blur-xl p-8 rounded-[2.5rem] border border-white shadow-xl shadow-slate-200/40">
                        <h3 class="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">🔐 管理员订阅防泄漏重置</h3>
                        <p class="text-sm text-slate-500 mb-4 font-medium">如果您怀疑管理员的聚合订阅链接已被泄漏，可以在此重置。重置后系统将在底层生成一个全新独立的 UUID 作为您的专属验证令牌，**不会影响您的登录密码**，但旧的订阅链接会立即彻底作废。</p>
                        <button @click="resetMySubLink" class="bg-rose-50 text-rose-600 border border-rose-100 px-6 py-3 rounded-2xl font-bold hover:bg-rose-100 transition-all shadow-sm">⚠️ 一键重置我的订阅令牌</button>
                    </div>
                </template>

                <template v-if="role === 'user'">
                    <div class="bg-white/60 backdrop-blur-xl p-8 rounded-[2.5rem] border border-white shadow-xl shadow-slate-200/40">
                        <h3 class="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">🔑 账号安全</h3>
                        <div class="max-w-md">
                            <label class="block text-xs font-bold text-slate-400 mb-2 pl-2">修改登录密码</label>
                            <div class="flex gap-3">
                                <input v-model="userNewPassword" type="password" placeholder="请输入新密码" class="w-full bg-white/50 border border-white p-3 rounded-2xl transition hover:bg-white focus:bg-white text-sm font-medium">
                                <button @click="updateUserPassword" class="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-md whitespace-nowrap">确认修改</button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="bg-white/60 backdrop-blur-xl p-8 rounded-[2.5rem] border border-white shadow-xl shadow-slate-200/40">
                        <h3 class="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">🔄 订阅连接重置</h3>
                        <p class="text-sm text-slate-500 mb-4 font-medium">如果您的订阅链接泄露给他人，请立刻在此重置。系统将自动生成全新的独立 UUID 订阅密钥（不影响您的登录密码），旧链接瞬间失效。</p>
                        <button @click="resetMySubLink" class="bg-rose-50 text-rose-600 border border-rose-100 px-6 py-3 rounded-2xl font-bold hover:bg-rose-100 transition-all shadow-sm">⚠️ 重置并吊销旧订阅</button>
                    </div>
                </template>
                
            </div>

        </div>
    </div>

    <!-- ================= 脚本逻辑区 ================= -->
    <script>
        const { createApp, ref, reactive, onMounted, onUnmounted, nextTick, computed, watch } = Vue;
        
        const sha256 = async (text) => { const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join(''); };
        const generateHMAC = async (keyHex, message) => { const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))); const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)); return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join(''); };
        const toBase64Url = (uint8Array) => { let str = ''; for (let i = 0; i < uint8Array.length; i++) str += String.fromCharCode(uint8Array[i]); return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); };
        const generateRealityKeys = () => { const keypair = nacl.box.keyPair(); return { privateKey: toBase64Url(keypair.secretKey), publicKey: toBase64Url(keypair.publicKey), shortId: crypto.randomUUID().replace(/-/g, '').substring(0, 16) }; };

        createApp({
            setup() {
                const isLoggedIn = ref(false); const loginUser = ref(''); const password = ref('');
                const currentUser = ref(localStorage.getItem('kui_user') || ''); const authKey = ref(localStorage.getItem('kui_auth_key') || ''); const role = ref(localStorage.getItem('kui_role') || '');
                const activeTab = ref(''); const servers = ref([]); const nodes = ref([]); const users = ref([]);
                
                const newVps = ref({ name: '', ip: '', os: 'debian' }); 
                const newNodeParams = reactive({});
                const newUser = reactive({ username: '', password: '', traffic_limit_gb: '', expire_date: '' });
                const currentDomain = window.location.origin;

                const mySubToken = ref('');
                const siteTitle = ref('Cluster Gateway');
                const siteTitleInput = ref('');
                const userNewPassword = ref('');

                // 🌟 FSCARMEN 极速模式状态存储
                const batchStartPort = reactive({});
                const batchUser = reactive({});

                watch(siteTitle, (newVal) => { document.title = newVal || 'KUI Serverless 聚合面板'; });

                const deployOsMap = reactive(JSON.parse(localStorage.getItem('kui_deploy_os') || '{}'));
                const saveOsMap = () => { localStorage.setItem('kui_deploy_os', JSON.stringify(deployOsMap)); };

                const isOnline = (lastReport) => lastReport && (Date.now() - lastReport) < 600000;
                const formatBytes = (bytes) => { if (bytes === 0) return '0 B'; const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'], i = Math.floor(Math.log(bytes) / Math.log(k)); return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]; };
                const formatDate = (ts) => { if (!ts) return '永久'; const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
                const getTrafficPercent = (used, limit) => { if (!limit || limit === 0) return 0; return Math.min((used / limit) * 100, 100); };

                const globalOnline = computed(() => servers.value.filter(s => isOnline(s.last_report)).length);
                const globalTraffic = computed(() => nodes.value.reduce((sum, n) => sum + (parseFloat(n.traffic_used) || 0), 0));
                const globalSpeedIn = computed(() => servers.value.reduce((sum, s) => sum + (parseFloat(s.net_in_speed) || 0), 0));
                const globalSpeedOut = computed(() => servers.value.reduce((sum, s) => sum + (parseFloat(s.net_out_speed) || 0), 0));

                const fetchApi = async (url, options = {}) => {
                    const timestamp = Date.now().toString(); const signature = await generateHMAC(authKey.value, currentUser.value + timestamp);
                    options.headers = { ...options.headers, 'Authorization': `${btoa(currentUser.value)}.${timestamp}.${signature}` };
                    const res = await fetch(url, options);
                    if (res.status === 401) { logout(); throw new Error('Unauthorized'); }
                    if (!res.ok) { const err = await res.json(); alert(`❌ 后端报错: ${err.error}`); throw new Error('API Failed'); }
                    return res;
                };

                const login = async () => {
                    if (!loginUser.value) loginUser.value = 'admin';
                    try {
                        const hashedPass = await sha256(password.value); const timestamp = Date.now().toString(); const sig = await generateHMAC(hashedPass, loginUser.value + timestamp);
                        const res = await fetch('/api/login', { method: 'POST', headers: { 'Authorization': `${btoa(loginUser.value)}.${timestamp}.${sig}` } });
                        if (res.ok) {
                            const data = await res.json(); authKey.value = hashedPass; currentUser.value = loginUser.value; role.value = data.role;
                            localStorage.setItem('kui_auth_key', authKey.value); localStorage.setItem('kui_user', currentUser.value); localStorage.setItem('kui_role', role.value);
                            isLoggedIn.value = true; password.value = ''; 
                            activeTab.value = role.value === 'admin' ? 'nodes' : 'dashboard';
                            refreshData(); startPolling();
                        } else alert('⚠️ 账户名或密码错误');
                    } catch (e) { alert('登录异常'); }
                };
                
                const logout = () => { localStorage.removeItem('kui_auth_key'); localStorage.removeItem('kui_user'); localStorage.removeItem('kui_role'); isLoggedIn.value = false; currentUser.value = ''; authKey.value = ''; stopPolling(); };

                const sendUiPing = async () => { try { await fetchApi('/api/ui_ping', { method: 'POST' }); } catch(e) {} };

                let isFetching = false;
                const refreshData = async () => {
                    if (isFetching) return;
                    isFetching = true;
                    try {
                        const res = await fetchApi('/api/data'); const data = await res.json();
                        servers.value = data.servers || []; nodes.value = data.nodes || []; users.value = data.users || [];
                        
                        if (data.siteTitle) { siteTitle.value = data.siteTitle; siteTitleInput.value = data.siteTitle; }
                        if (data.mySubToken) mySubToken.value = data.mySubToken;

                        servers.value.forEach(s => { 
                            if(!newNodeParams[s.ip]) newNodeParams[s.ip] = { protocol: 'XTLS-Reality', port: 443, username: 'admin', sni: '', relay_type: 'external', traffic_limit_gb: '', expire_date: '' }; 
                            if(!deployOsMap[s.ip]) deployOsMap[s.ip] = 'debian';
                            if(!batchStartPort[s.ip]) batchStartPort[s.ip] = '';
                            if(!batchUser[s.ip]) batchUser[s.ip] = 'admin';
                        });
                        renderCharts();
                    } catch(e) {}
                    finally { isFetching = false; }
                };

                const renderCharts = async () => {
                    if (role.value !== 'admin' || activeTab.value !== 'nodes') return;
                    await nextTick();
                    for (let vps of servers.value) {
                        const chartDom = document.getElementById('chart-' + vps.ip); if (!chartDom) continue;
                        let myChart = echarts.getInstanceByDom(chartDom) || echarts.init(chartDom);
                        const res = await fetchApi(`/api/stats?ip=${vps.ip}`); const stats = await res.json();
                        myChart.setOption({ grid: { left: '8%', right: '5%', top: '5%', bottom: '15%' }, tooltip: { trigger: 'axis', backgroundColor: 'rgba(255, 255, 255, 0.9)', borderColor: '#e2e8f0', textStyle: { color: '#334155' } }, xAxis: { type: 'category', data: stats.map(s=>s.day), axisLabel: { color: '#94a3b8', fontSize: 10 }, axisLine: { lineStyle: { color: '#cbd5e1' } } }, yAxis: { type: 'value', show: false }, series: [{ data: stats.map(s=>(s.total_bytes/1024/1024).toFixed(2)), type: 'line', smooth: true, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(99, 102, 241, 0.2)' }, { offset: 1, color: 'rgba(99, 102, 241, 0)' }]) }, itemStyle: { color: '#6366f1' }, lineStyle: { width: 3 }, symbol: 'none' }] });
                    }
                };

                const generateUUIDForNewUser = () => { newUser.password = crypto.randomUUID(); };

                const addUser = async () => { 
                    if (!newUser.username || !newUser.password) return alert('请输入用户名和密码！');
                    const limit = newUser.traffic_limit_gb ? Math.floor(parseFloat(newUser.traffic_limit_gb) * 1073741824) : 0; 
                    const expire = newUser.expire_date ? new Date(newUser.expire_date).getTime() : 0; 
                    await fetchApi('/api/users', { method: 'POST', body: JSON.stringify({ ...newUser, traffic_limit: limit, expire_time: expire }) }); 
                    Object.assign(newUser, { username: '', password: '', traffic_limit_gb: '', expire_date: '' }); 
                    refreshData(); 
                };
                
                const toggleUser = async (username, status) => { await fetchApi('/api/users', { method: 'PUT', body: JSON.stringify({ username, enable: status }) }); refreshData(); };
                const deleteUser = async (username) => { if(confirm('⚠️ 确定删除用户？节点将归还给管理员。')) { await fetchApi(`/api/users?username=${username}`, { method: 'DELETE' }); refreshData(); } };
                const resetUserTraffic = async (username) => { await fetchApi('/api/users', { method: 'PUT', body: JSON.stringify({ username, reset_traffic: true }) }); refreshData(); };

                const addVps = async () => { 
                    if(!newVps.value.ip || !newVps.value.name) return alert('请输入名称和IP');
                    deployOsMap[newVps.value.ip] = newVps.value.os;
                    saveOsMap();
                    await fetchApi('/api/vps', { method: 'POST', body: JSON.stringify({ ip: newVps.value.ip, name: newVps.value.name }) }); 
                    newVps.value = { name: '', ip: '', os: 'debian' }; 
                    refreshData(); 
                };
                const deleteVps = async (ip) => { if(confirm('🧨 确定移除该机器？所有数据将被清空！')) { await fetchApi(`/api/vps?ip=${ip}`, { method: 'DELETE' }); refreshData(); } };

                // ================= 单节点下发 =================
                const addNode = async (ip) => {
                    const p = newNodeParams[ip]; if(!p.port) return alert('请填写端口!');
                    let limitBytes = p.traffic_limit_gb ? Math.floor(parseFloat(p.traffic_limit_gb) * 1073741824) : 0; 
                    let expireTs = p.expire_date ? new Date(p.expire_date).getTime() : 0;
                    
                    const payload = { 
                        id: Date.now().toString(), 
                        uuid: crypto.randomUUID(), 
                        vps_ip: ip, 
                        protocol: p.protocol, 
                        port: p.port, 
                        username: p.username, 
                        traffic_limit: limitBytes, 
                        expire_time: expireTs,
                        sni: p.sni || ''
                    };
                    
                    if (['XTLS-Reality', 'H2-Reality', 'gRPC-Reality'].includes(p.protocol)) { 
                        const keys = generateRealityKeys(); 
                        payload.private_key = keys.privateKey; 
                        payload.public_key = keys.publicKey; 
                        payload.short_id = keys.shortId; 
                    } else if (p.protocol === 'TUIC') { 
                        if (!p.sni) return alert('TUIC 必填 SNI！'); 
                        payload.private_key = crypto.randomUUID().replace(/-/g, ''); 
                    } else if (p.protocol === 'ShadowTLS' || p.protocol === 'Shadowsocks' || p.protocol === 'Trojan' || p.protocol === 'AnyTLS') {
                        payload.private_key = crypto.randomUUID().replace(/-/g, ''); // 密码字段复用
                    } else if (p.protocol === 'Naive') {
                        payload.uuid = crypto.randomUUID().replace(/-/g, '').substring(0, 16); // User
                        payload.private_key = payload.uuid; // Pass
                    } else if (p.protocol === 'VLESS-Argo') { 
                        payload.sni = '⏳ 正在等待 VPS 自动回传穿透域名...'; 
                    } else if (p.protocol === 'dokodemo-door') { 
                        payload.relay_type = p.relay_type; 
                        if (p.relay_type === 'external') { 
                            payload.target_ip = p.target_ip; 
                            payload.target_port = p.target_port; 
                        } else { 
                            payload.target_id = p.target_id; 
                        } 
                    }
                    
                    await fetchApi('/api/nodes', { method: 'POST', body: JSON.stringify(payload) }); 
                    refreshData();
                };
                
                // 🌟 完美复刻开源脚本逻辑：极速全系 12 大协议下发
                const deployAllProtocols = async (ip) => {
                    let startPort = parseInt(batchStartPort[ip]);
                    if (!startPort || startPort < 10 || startPort > 65000) {
                        return alert('⚠️ 请输入有效的起始端口 (推荐: 8881)');
                    }

                    const defaultSni = 'addons.mozilla.org'; // fscarmen 默认防封锁域
                    const commonUser = batchUser[ip] || 'admin';
                    const commonUUID = crypto.randomUUID(); // 全局复用同一个 UUID
                    
                    // 完全匹配 fscarmen 的 12 个核心协议矩阵和端口递增策略
                    const protocolSequence = [
                        { protocol: 'XTLS-Reality', offset: 0, sni: defaultSni, type: 'reality' },
                        { protocol: 'Hysteria2', offset: 1, sni: defaultSni },
                        { protocol: 'TUIC', offset: 2, sni: defaultSni },
                        { protocol: 'ShadowTLS', offset: 3, sni: defaultSni },
                        { protocol: 'Shadowsocks', offset: 4 },
                        { protocol: 'Trojan', offset: 5, sni: defaultSni },
                        { protocol: 'VMess-WS', offset: 6, sni: defaultSni },
                        { protocol: 'VLESS-WS-TLS', offset: 7, sni: defaultSni },
                        { protocol: 'H2-Reality', offset: 8, sni: defaultSni, type: 'reality' },
                        { protocol: 'gRPC-Reality', offset: 9, sni: defaultSni, type: 'reality' },
                        { protocol: 'AnyTLS', offset: 10, sni: defaultSni },
                        { protocol: 'Naive', offset: 11, sni: defaultSni }
                    ];

                    const confirmMsg = `🚀 极速部署确认：\n\n系统将按照 FSCARMEN 模式，向该服务器并发下发完整 ${protocolSequence.length} 个协议矩阵：\n` + 
                                    protocolSequence.map(p => `- ${p.protocol} (端口: ${startPort + p.offset})`).join('\n') +
                                    `\n\n所有节点归属: ${commonUser}\n\n确认立刻组建节点矩阵吗？`;

                    if (!confirm(confirmMsg)) return;

                    // 开始并发创建节点
                    for (let item of protocolSequence) {
                        const payload = { 
                            id: Date.now().toString() + Math.floor(Math.random() * 10000), 
                            uuid: commonUUID, 
                            vps_ip: ip, 
                            protocol: item.protocol, 
                            port: startPort + item.offset, 
                            username: commonUser, 
                            traffic_limit: 0, 
                            expire_time: 0,
                            sni: item.sni || ''
                        };
                        
                        if (item.type === 'reality') { 
                            const keys = generateRealityKeys(); 
                            payload.private_key = keys.privateKey; 
                            payload.public_key = keys.publicKey; 
                            payload.short_id = keys.shortId; 
                        } else if (item.protocol === 'Naive') {
                            payload.uuid = commonUUID.replace(/-/g, '').substring(0, 16); 
                            payload.private_key = payload.uuid;
                        } else {
                            // 给 TUIC, ShadowTLS, SS, Trojan, AnyTLS 提供高强度密码复用
                            payload.private_key = crypto.randomUUID().replace(/-/g, ''); 
                        }
                        
                        try {
                            await fetchApi('/api/nodes', { method: 'POST', body: JSON.stringify(payload) });
                        } catch(e) {
                            console.error(`[极速模式] ${item.protocol} 下发失败`, e);
                        }
                    }

                    batchStartPort[ip] = ''; // 清空输入框
                    alert("✅ 极速 12合1 全家桶部署指令已发送！\n\n远端探针将在约十秒后的心跳中自动拉取配置，并使用成熟的底层环境启动所有引擎，请稍候。");
                    refreshData();
                };

                const deleteNode = async (id) => { await fetchApi(`/api/nodes?id=${id}`, { method: 'DELETE' }); refreshData(); };
                const toggleNode = async (id, status) => { await fetchApi('/api/nodes', { method: 'PUT', body: JSON.stringify({ id: id, enable: status }) }); refreshData(); };
                const resetTraffic = async (id) => { await fetchApi('/api/nodes', { method: 'PUT', body: JSON.stringify({ id: id, reset_traffic: true }) }); refreshData(); };
                
                const getNodesByIp = (ip) => nodes.value.filter(n => n.vps_ip === ip).sort((a, b) => a.port - b.port); // 按端口排序展示
                const getVpsName = (ip) => servers.value.find(s => s.ip === ip)?.name || ip;
                
                let dataTimer = null; let pingTimer = null;
                const startPolling = () => { 
                    if (!dataTimer) { refreshData(); dataTimer = setInterval(() => { if (isLoggedIn.value && !document.hidden && (activeTab.value === 'nodes' || activeTab.value === 'dashboard')) refreshData(); }, 2500); }
                    if (!pingTimer) { sendUiPing(); pingTimer = setInterval(() => { if (isLoggedIn.value && !document.hidden) sendUiPing(); }, 10000); }
                };
                const stopPolling = () => { if (dataTimer) { clearInterval(dataTimer); dataTimer = null; } if (pingTimer) { clearInterval(pingTimer); pingTimer = null; } };
                
                const generateCmd = (ip) => {
                    const osType = deployOsMap[ip] || 'debian';
                    const scriptUrl = "https://raw.githubusercontent.com/a62169722/KUI/main/vps/kui.sh";
                    if (osType === 'alpine') return `apk update && apk add curl && curl -sL ${scriptUrl} | sh -s -- --api "${currentDomain}" --ip "${ip}" --token "${authKey.value}"`;
                    else return `apt-get update -y && apt-get install -y curl && bash <(curl -sL ${scriptUrl}) --api "${currentDomain}" --ip "${ip}" --token "${authKey.value}"`;
                };

                const saveSiteTitle = async () => {
                    if(!siteTitleInput.value) return alert('名称不能为空！');
                    await fetchApi('/api/settings', { method: 'POST', body: JSON.stringify({ site_title: siteTitleInput.value }) });
                    siteTitle.value = siteTitleInput.value;
                    alert('✅ 系统面板名称重命名成功！');
                };

                const updateUserPassword = async () => {
                    if(!userNewPassword.value) return alert('请输入新密码');
                    await fetchApi('/api/user/password', { method: 'PUT', body: JSON.stringify({ password: userNewPassword.value }) });
                    alert('✅ 密码修改成功！为了安全，请使用新密码重新登录。');
                    logout();
                };

                const resetMySubLink = async () => {
                    if(confirm('🚨 危险操作！\n重置后系统将为您签发全新的 UUID 订阅令牌，原有的全部旧订阅链接将【立即作废】！\n\n确定要继续重置吗？')) {
                        await fetchApi('/api/user/sub_token', { method: 'PUT' });
                        alert('✅ 订阅令牌已刷新！旧链接已被吊销。请点击右上角复制获取您的全新订阅链接。');
                        refreshData();
                    }
                };

                const generateSubLink = (ip='') => {
                    const tokenToUse = mySubToken.value || authKey.value;
                    return `${currentDomain}/api/sub?user=${currentUser.value}&token=${tokenToUse}${ip?`&ip=${ip}`:''}`;
                };

                const copyCommand = (txt, msg) => navigator.clipboard.writeText(txt).then(() => alert(msg));

                onMounted(() => { 
                    if (authKey.value && currentUser.value) { 
                        isLoggedIn.value = true; 
                        activeTab.value = role.value === 'admin' ? 'nodes' : 'dashboard';
                        startPolling(); 
                    } 
                    document.addEventListener('visibilitychange', () => { 
                        if (document.hidden) stopPolling(); else if (isLoggedIn.value) startPolling(); 
                    }); 
                });

                return { 
                    isLoggedIn, loginUser, password, currentUser, role, activeTab, 
                    servers, nodes, users, 
                    newVps, newNodeParams, // 手动添加节点所需变量
                    newUser, 
                    login, logout, refreshData, 
                    addUser, toggleUser, deleteUser, resetUserTraffic, 
                    addVps, deleteVps, addNode,
                    deleteNode, toggleNode, resetTraffic, 
                    getNodesByIp, getVpsName, 
                    formatBytes, formatDate, getTrafficPercent, isOnline, 
                    generateCmd, generateSubLink, copyCommand, 
                    globalOnline, globalTraffic, globalSpeedIn, globalSpeedOut, 
                    deployOsMap, saveOsMap, 
                    siteTitle, siteTitleInput, saveSiteTitle, 
                    userNewPassword, updateUserPassword, resetMySubLink, generateUUIDForNewUser, 
                    batchStartPort, batchUser, deployAllProtocols 
                };
            }
        }).mount('#app');
    </script>
</body>
</html>
