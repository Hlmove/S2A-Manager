// ==UserScript==
// @name         S2A Manager (Web Version)
// @namespace    http://tampermonkey.net/
// @version      0.6
// @description  管理 sub2api 的账号、代理与 JSON 转换（CPA 悬浮面板样式）
// @author       Trae AI
// @match        https://sub.hlmove.cloud/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *
// ==/UserScript==

(async function() {
    'use strict';

    // --------------------------------------------------------
    // 1. 样式与基础 UI 注入 (CPA 拟物化高斯模糊风格)
    // --------------------------------------------------------
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    
    // CPA 主题配色
    const theme = {
        dark: {
            panelBg: "linear-gradient(152deg, rgba(64, 62, 58, 0.76), rgba(32, 33, 38, 0.82))",
            panelBorder: "1px solid rgba(228, 217, 204, 0.22)",
            panelShadow: "0 16px 42px rgba(10, 10, 14, 0.35)",
            panelText: "#f4f0e9",
            softBg: "rgba(37, 39, 44, 0.62)",
            softBorder: "1px solid rgba(223,214,204,0.18)",
            btnQueryBg: "linear-gradient(135deg, rgba(83, 105, 139, 0.92), rgba(71, 90, 120, 0.94))",
            btnDeleteBg: "linear-gradient(135deg, rgba(148, 86, 92, 0.94), rgba(124, 72, 84, 0.94))",
            btnBorder: "1px solid rgba(225,216,205,0.2)",
            btnText: "#fff9f1",
            inputBg: "rgba(23, 24, 28, 0.42)",
            inputBorder: "1px solid rgba(223,214,204,0.18)",
            toggleBg: "linear-gradient(145deg, rgba(86, 88, 99, 0.9), rgba(60, 62, 72, 0.92))",
            toggleText: "#f4efe8"
        },
        light: {
            panelBg: "linear-gradient(156deg, rgba(255, 252, 246, 0.9), rgba(244, 241, 236, 0.92))",
            panelBorder: "1px solid rgba(165, 156, 144, 0.42)",
            panelShadow: "0 14px 30px rgba(126, 119, 108, 0.18)",
            panelText: "#2d2a26",
            softBg: "rgba(255, 251, 245, 0.86)",
            softBorder: "1px solid rgba(171, 163, 152, 0.28)",
            btnQueryBg: "linear-gradient(135deg, rgba(102, 134, 176, 0.92), rgba(84, 113, 155, 0.92))",
            btnDeleteBg: "linear-gradient(135deg, rgba(198, 111, 121, 0.92), rgba(171, 91, 103, 0.92))",
            btnBorder: "1px solid rgba(127, 119, 109, 0.24)",
            btnText: "#fffdf9",
            inputBg: "rgba(255, 254, 250, 0.74)",
            inputBorder: "1px solid rgba(171, 163, 152, 0.35)",
            toggleBg: "linear-gradient(145deg, rgba(251, 250, 247, 0.96), rgba(239, 236, 230, 0.94))",
            toggleText: "#5d6273"
        }
    };
    const t = isDark ? theme.dark : theme.light;

    // 创建主面板
    const panel = document.createElement("div");
    panel.id = "__s2a_universal_panel";
    panel.style.cssText = `
        position: fixed;
        z-index: 99999;
        right: 16px;
        top: 70px;
        width: 380px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        backdrop-filter: blur(18px) saturate(120%);
        border-radius: 20px;
        padding: 16px;
        box-sizing: border-box;
        overflow: hidden;
        will-change: transform;
        transition: transform 0.26s ease, opacity 0.22s ease;
        font-family: 'MiSans', 'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', sans-serif;
        transform-origin: right top;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translateX(calc(100% + 24px)) scale(0.985);
        background: ${t.panelBg};
        border: ${t.panelBorder};
        box-shadow: ${t.panelShadow};
        color: ${t.panelText};
    `;

    // 创建切换按钮
    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = "展开 S2A";
    toggleBtn.style.cssText = `
        position: fixed;
        z-index: 100000;
        right: 16px;
        bottom: 16px;
        border-radius: 999px;
        padding: 9px 13px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        backdrop-filter: blur(10px);
        transition: transform 0.2s ease;
        background: ${t.toggleBg};
        color: ${t.toggleText};
        border: 1px solid rgba(164, 156, 145, 0.48);
        box-shadow: 0 8px 18px rgba(136, 129, 118, 0.2);
    `;

    let isOpen = false;
    toggleBtn.addEventListener("click", () => {
        isOpen = !isOpen;
        toggleBtn.textContent = isOpen ? "收起 S2A" : "展开 S2A";
        panel.style.opacity = isOpen ? "1" : "0";
        panel.style.visibility = isOpen ? "visible" : "hidden";
        panel.style.pointerEvents = isOpen ? "auto" : "none";
        panel.style.transform = isOpen ? "translateX(0) scale(1)" : "translateX(calc(100% + 24px)) scale(0.985)";
    });

    // 内部 HTML 结构
    panel.innerHTML = `
        <div style="font-size: 16px; font-weight: 800; margin-bottom: 12px; display: flex; justify-content: space-between;">
            <span>🚀 S2A Manager</span>
            <span style="font-size: 12px; font-weight: normal; opacity: 0.8; cursor:pointer;" id="s2a-auto-token">🔄 尝试自动抓取 Token</span>
        </div>
        
        <div style="display: flex; gap: 6px; margin-bottom: 12px; background: \${t.softBg}; border: \${t.softBorder}; padding: 4px; border-radius: 14px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);">
            <button class="s2a-tab" data-target="config" style="flex: 1; padding: 7px 12px; border-radius: 10px; font-size: 11px; font-weight: 700; cursor: pointer; border: \${t.btnBorder}; background: \${t.btnQueryBg}; color: \${t.btnText};">⚙️ 配置</button>
            <button class="s2a-tab" data-target="account" style="flex: 1; padding: 7px 12px; border-radius: 10px; font-size: 11px; font-weight: 700; cursor: pointer; border: 1px solid transparent; background: transparent; color: \${t.panelText};">👥 账号</button>
            <button class="s2a-tab" data-target="proxy" style="flex: 1; padding: 7px 12px; border-radius: 10px; font-size: 11px; font-weight: 700; cursor: pointer; border: 1px solid transparent; background: transparent; color: \${t.panelText};">🌐 代理</button>
            <button class="s2a-tab" data-target="convert" style="flex: 1; padding: 7px 12px; border-radius: 10px; font-size: 11px; font-weight: 700; cursor: pointer; border: 1px solid transparent; background: transparent; color: \${t.panelText};">🔀 转换</button>
        </div>

        <div style="flex: 1; overflow-y: auto; background: \${t.inputBg}; border: \${t.inputBorder}; border-radius: 16px; padding: 12px; min-height: 280px; max-height: 400px; scrollbar-width: thin;">
            <style>
                .s2a-panel-content { display: none; flex-direction: column; gap: 12px; }
                .s2a-panel-content.active { display: flex; }
                .s2a-input { width: 100%; padding: 8px 10px; border-radius: 8px; border: \${t.inputBorder}; background: \${t.panelBg}; color: \${t.panelText}; font-size: 12px; box-sizing: border-box; outline: none; }
                .s2a-label { font-size: 11px; font-weight: 600; margin-bottom: 4px; display: block; opacity: 0.9; }
                .s2a-btn-action { padding: 10px 14px; border-radius: 12px; cursor: pointer; font-size: 12px; font-weight: 700; transition: transform 0.2s ease; border: \${t.btnBorder}; color: \${t.btnText}; width: 100%; }
                .s2a-btn-action:hover { transform: translateY(-1px); }
                .s2a-btn-query { background: \${t.btnQueryBg}; }
                .s2a-btn-danger { background: \${t.btnDeleteBg}; }
            </style>
            
            <!-- 1. 配置面板 -->
            <div id="panel-config" class="s2a-panel-content active">
                <div>
                    <label class="s2a-label">网站 API 地址</label>
                    <input type="text" id="s2a-baseUrl" class="s2a-input" placeholder="例如 https://sub.example.com">
                </div>
                <div>
                    <label class="s2a-label">管理员 API Key / Token</label>
                    <input type="password" id="s2a-apiKey" class="s2a-input" placeholder="输入 Admin API Key 或 Bearer Token">
                </div>
                <button class="s2a-btn-action s2a-btn-query" id="btn-save-config">💾 保存配置 & 测试连接</button>
            </div>

            <!-- 2. 账号面板 -->
            <div id="panel-account" class="s2a-panel-content">
                <div>
                    <label class="s2a-label">📥 批量导入账号 JSON</label>
                    <input type="file" id="file-import-account" class="s2a-input" accept=".json" multiple>
                    <button class="s2a-btn-action s2a-btn-query" id="btn-import-account" style="margin-top: 8px;">开始导入</button>
                </div>
                <hr style="border: none; border-top: \${t.inputBorder}; margin: 4px 0;">
                <div>
                    <label class="s2a-label">📤 导出现有账号</label>
                    <button class="s2a-btn-action s2a-btn-query" id="btn-export-account">下载全部账号 (JSON)</button>
                </div>
                <hr style="border: none; border-top: \${t.inputBorder}; margin: 4px 0;">
                <div>
                    <label class="s2a-label">🛠️ 账号清理</label>
                    <button class="s2a-btn-action s2a-btn-danger" id="btn-detect-401">一键检测并清除失效账号</button>
                </div>
            </div>

            <!-- 3. 代理面板 -->
            <div id="panel-proxy" class="s2a-panel-content">
                <div>
                    <label class="s2a-label">📥 导入代理 JSON</label>
                    <input type="file" id="file-import-proxy" class="s2a-input" accept=".json">
                    <button class="s2a-btn-action s2a-btn-query" id="btn-import-proxy" style="margin-top: 8px;">开始导入</button>
                </div>
                <hr style="border: none; border-top: \${t.inputBorder}; margin: 4px 0;">
                <div>
                    <label class="s2a-label">🗑️ 清理代理</label>
                    <button class="s2a-btn-action s2a-btn-danger" id="btn-clear-proxies">清空所有代理</button>
                </div>
            </div>

            <!-- 4. 转换面板 -->
            <div id="panel-convert" class="s2a-panel-content">
                <div>
                    <label class="s2a-label">🔀 转换简易 JSON 为标准格式</label>
                    <input type="file" id="file-convert" class="s2a-input" accept=".json" multiple>
                    <button class="s2a-btn-action s2a-btn-query" id="btn-convert" style="margin-top: 8px;">转换并在本地下载</button>
                </div>
                <div style="font-size:10px; opacity:0.7; line-height: 1.4;">
                    纯本地操作，不请求服务器。<br>
                    自动识别 token, access_token, api_key 等提取到 credentials 中。
                </div>
            </div>
        </div>

        <div id="s2a-log" style="margin-top: 12px; font-size: 11px; font-family: monospace; opacity: 0.8; height: 60px; overflow-y: auto; word-break: break-all; white-space: pre-wrap;">等待操作...</div>
    `;

    function probeUrl(path) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${window.location.origin}${path}`,
                headers: {
                    accept: 'application/json, text/plain, */*',
                },
                timeout: 2500,
                onload: (resp) => resolve(resp.status || 0),
                ontimeout: () => resolve(0),
                onerror: () => resolve(0),
            });
        });
    }

    async function shouldActivate() {
        const candidates = ['/admin/accounts', '/api/v1/admin/accounts'];
        for (const path of candidates) {
            const status = await probeUrl(path);
            if (status && status !== 404) {
                return true;
            }
        }
        return false;
    }

    const active = await shouldActivate();
    if (!active) {
        return;
    }

    document.body.appendChild(panel);
    document.body.appendChild(toggleBtn);

    // --------------------------------------------------------
    // 2. 核心状态与通用函数 (Core State & Utils)
    // --------------------------------------------------------
    const ui = {
        app: document.getElementById('__s2a_universal_panel'),
        toggle: toggleBtn,
        tabs: document.querySelectorAll('.s2a-tab'),
        panels: document.querySelectorAll('.s2a-panel-content'),
        baseUrl: document.getElementById('s2a-baseUrl'),
        apiKey: document.getElementById('s2a-apiKey'),
        log: document.getElementById('s2a-log')
    };

    function log(msg) {
        const time = new Date().toLocaleTimeString();
        ui.log.innerHTML += `\n[${time}] ${msg}`;
        ui.log.scrollTop = ui.log.scrollHeight;
    }

    function getBaseUrl() {
        let url = ui.baseUrl.value.trim().replace(/\/+$/, '');
        if (url && !url.endsWith('/api/v1') && url.includes('/api/v1')) {
             url = url.split('/api/v1')[0] + '/api/v1';
        } else if (url && !url.endsWith('/api/v1')) {
             url += '/api/v1';
        }
        return url;
    }

    function getAuthHeaders() {
        return {
            'Authorization': `Bearer ${ui.apiKey.value.trim()}`,
            'Content-Type': 'application/json'
        };
    }

    // 包装 GM_xmlhttpRequest 为 Promise
    function s2aFetch(path, options = {}) {
        return new Promise((resolve, reject) => {
            const url = getBaseUrl() + path;
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: url,
                headers: getAuthHeaders(),
                data: options.body ? JSON.stringify(options.body) : null,
                onload: function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (response.status >= 200 && response.status < 300) {
                            resolve(data);
                        } else {
                            reject(new Error(`HTTP ${response.status}: ${data.message || response.responseText}`));
                        }
                    } catch (e) {
                        if (response.status >= 200 && response.status < 300) {
                            resolve(response.responseText); // 可能不是 JSON
                        } else {
                            reject(new Error(`HTTP ${response.status}: ${response.responseText}`));
                        }
                    }
                },
                onerror: function(err) {
                    reject(new Error('Network error: ' + err));
                }
            });
        });
    }

    // 下载 Blob
    function downloadJSON(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // 读取文件内容 Promise
    function readFileAsync(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = e => reject(e);
            reader.readAsText(file);
        });
    }

    // --------------------------------------------------------
    // 3. 界面交互事件 (UI Interactions)
    // --------------------------------------------------------
    
    // 初始化配置
    ui.baseUrl.value = GM_getValue('s2a_baseUrl', 'http://127.0.0.1:8080');
    ui.apiKey.value = GM_getValue('s2a_apiKey', '');

    // 标签切换
    ui.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            ui.tabs.forEach(btn => {
                btn.style.border = '1px solid transparent';
                btn.style.background = 'transparent';
                btn.style.color = t.panelText;
            });
            ui.panels.forEach(p => p.classList.remove('active'));
            
            tab.style.border = t.btnBorder;
            tab.style.background = t.btnQueryBg;
            tab.style.color = t.btnText;
            
            document.getElementById('panel-' + tab.dataset.target).classList.add('active');
        });
    });

    // 尝试自动获取 Token
    document.getElementById('s2a-auto-token').addEventListener('click', () => {
        log('正在尝试从当前环境提取 Token...');
        const keys = [
            'auth_token', 'admin_key', 'management_token', 'management_key', 
            'tm_token', 'tm_auth_token', 'tm_last_bearer_token_v1'
        ];
        
        let found = null;
        for (const k of keys) {
            try {
                found = localStorage.getItem(k) || sessionStorage.getItem(k);
                if (found && found.trim()) break;
            } catch(e) {}
        }
        
        if (found) {
            ui.apiKey.value = found.trim();
            log('✅ 成功提取到 Token，已自动填入。');
        } else {
            log('⚠️ 未在当前页面缓存中找到 Admin Token，请手动填写。');
        }
    });

    // 保存配置
    document.getElementById('btn-save-config').addEventListener('click', async () => {
        GM_setValue('s2a_baseUrl', ui.baseUrl.value);
        GM_setValue('s2a_apiKey', ui.apiKey.value);
        log('✅ 配置已保存到本地存储。');
        log('正在测试连接...');
        try {
            await s2aFetch('/admin/accounts?limit=1');
            log('✅ 连接成功！');
        } catch (e) {
            log(`❌ 连接失败: ${e.message}`);
        }
    });

    // --------------------------------------------------------
    // 4. 账号功能 (Account Features)
    // --------------------------------------------------------

    // 导入账号
    document.getElementById('btn-import-account').addEventListener('click', async () => {
        const files = document.getElementById('file-import-account').files;
        if (files.length === 0) return log('⚠️ 请先选择要导入的 JSON 文件');
        
        log(`准备导入 ${files.length} 个文件...`);
        let totalImported = 0;
        for (const file of files) {
            try {
                const text = await readFileAsync(file);
                const payload = JSON.parse(text);
                const res = await s2aFetch('/admin/accounts/bulk', {
                    method: 'POST',
                    body: payload
                });
                totalImported += (res.data ? res.data.length : (Array.isArray(payload) ? payload.length : 1));
                log(`✅ 文件 ${file.name} 导入成功。`);
            } catch (e) {
                log(`❌ 文件 ${file.name} 导入失败: ${e.message}`);
            }
        }
        log(`🎉 导入完成，共处理约 ${totalImported} 个账号。`);
    });

    // 导出账号
    document.getElementById('btn-export-account').addEventListener('click', async () => {
        log('正在拉取线上账号列表...');
        try {
            const res = await s2aFetch('/admin/accounts?limit=9999');
            if (res.data && res.data.length > 0) {
                downloadJSON(res.data, `s2a_accounts_export_${Date.now()}.json`);
                log(`✅ 成功导出 ${res.data.length} 个账号。`);
            } else {
                log('⚠️ 网站当前没有账号可导出。');
            }
        } catch (e) {
            log(`❌ 导出失败: ${e.message}`);
        }
    });

    // 检测 401/403 (极简实现)
    document.getElementById('btn-detect-401').addEventListener('click', async () => {
        log('正在检测失效账号...');
        try {
            // 1. 获取所有 error 状态的账号
            const res = await s2aFetch('/admin/accounts?status=error&limit=9999');
            const accounts = res.data || [];
            if (accounts.length === 0) {
                return log('✅ 当前没有状态为 error 的账号。');
            }
            
            // 2. 筛选错误信息包含 401/403 的账号
            const invalidKeywords = ['401', 'unauth', '403', 'forbidden', 'invalid token', 'session expired'];
            const toDelete = accounts.filter(acc => {
                const msg = (acc.error_message || '').toLowerCase();
                return invalidKeywords.some(kw => msg.includes(kw));
            });

            if (toDelete.length === 0) {
                return log('✅ 当前 error 账号中没有匹配 401/403 关键字的失效账号。');
            }

            log(`🔍 发现 ${toDelete.length} 个失效账号，准备删除...`);
            
            // 3. 执行删除
            const ids = toDelete.map(a => a.id);
            await s2aFetch('/admin/accounts/bulk', {
                method: 'DELETE',
                body: { account_ids: ids }
            });
            log(`🎉 成功清除 ${ids.length} 个失效账号。`);

        } catch (e) {
            log(`❌ 检测清除失败: ${e.message}`);
        }
    });

    // --------------------------------------------------------
    // 5. 代理功能 (Proxy Features)
    // --------------------------------------------------------

    // 导入代理
    document.getElementById('btn-import-proxy').addEventListener('click', async () => {
        const file = document.getElementById('file-import-proxy').files[0];
        if (!file) return log('⚠️ 请先选择要导入的代理 JSON 文件');
        
        try {
            const text = await readFileAsync(file);
            const payload = JSON.parse(text);
            await s2aFetch('/admin/proxies/bulk', {
                method: 'POST',
                body: payload
            });
            log(`✅ 代理导入成功。`);
        } catch (e) {
            log(`❌ 代理导入失败: ${e.message}`);
        }
    });

    // 清空所有代理
    document.getElementById('btn-clear-proxies').addEventListener('click', async () => {
        if(!confirm('确定要清空所有代理吗？该操作不可逆！')) return;
        
        log('正在拉取代理列表...');
        try {
            const res = await s2aFetch('/admin/proxies?limit=9999');
            const proxies = res.data || [];
            if (proxies.length === 0) return log('✅ 当前没有代理可删除。');
            
            const ids = proxies.map(p => p.id);
            await s2aFetch('/admin/proxies/bulk', {
                method: 'DELETE',
                body: { proxy_ids: ids }
            });
            log(`🎉 成功清空 ${ids.length} 个代理。`);
        } catch (e) {
            log(`❌ 清空代理失败: ${e.message}`);
        }
    });

    // --------------------------------------------------------
    // 6. JSON 转换功能 (Format Converter)
    // --------------------------------------------------------

    // 提取凭据
    function extractCredentials(acc) {
        if (acc.credentials) return acc.credentials;
        const keys = ['token', 'access_token', 'refresh_token', 'session_token', 'api_key', 'apikey', 'setup_token'];
        let creds = {};
        for (const k of keys) {
            if (acc[k]) creds[k] = acc[k];
        }
        return Object.keys(creds).length > 0 ? creds : null;
    }

    document.getElementById('btn-convert').addEventListener('click', async () => {
        const files = document.getElementById('file-convert').files;
        if (files.length === 0) return log('⚠️ 请选择要转换的 JSON 文件');

        log(`开始转换 ${files.length} 个文件...`);
        for (const file of files) {
            try {
                const text = await readFileAsync(file);
                let data = JSON.parse(text);
                if (!Array.isArray(data)) data = [data];

                const converted = data.map(acc => {
                    const creds = extractCredentials(acc);
                    return {
                        name: acc.name || acc.username || `account_${Math.random().toString(36).substring(7)}`,
                        platform: acc.platform || 'openai',
                        type: acc.type || 'oauth',
                        status: acc.status || 'active',
                        credentials: creds || {}
                    };
                });

                downloadJSON(converted, `s2a_converted_${file.name}`);
                log(`✅ 文件 ${file.name} 转换完成并已触发下载。`);
            } catch (e) {
                log(`❌ 转换 ${file.name} 失败: ${e.message}`);
            }
        }
    });

    // --------------------------------------------------------
    // 7. 初始化与触发逻辑 (参考 CPA)
    // --------------------------------------------------------

    function createSidebar() {
        if (document.getElementById('__s2a_universal_panel')) return;
        
        document.body.appendChild(panel);
        document.body.appendChild(toggleBtn);
        log('✅ 成功匹配 sub2api 接口，面板已加载。');
    }

    function init() {
        // 因为已经通过 @match 限定了域名，直接注入面板
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", createSidebar, { once: true });
        } else {
            createSidebar();
        }
    }

    init();

})();
