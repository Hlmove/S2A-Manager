// ==UserScript==
// @name         S2A Manager (Web Version)
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  管理 sub2api 的账号、代理与 JSON 转换（可视化面板）
// @author       Trae AI
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // --------------------------------------------------------
    // 1. 样式与基础 UI 注入 (CSS & UI Base)
    // --------------------------------------------------------
    GM_addStyle(`
        #s2a-app {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 400px;
            height: 600px;
            background: #fff;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            border-radius: 8px;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 14px;
            color: #333;
            border: 1px solid #e8e8e8;
            transition: transform 0.3s ease;
        }
        #s2a-app.collapsed {
            transform: translateY(calc(100% - 40px));
        }
        #s2a-header {
            padding: 10px 15px;
            background: #fafafa;
            border-bottom: 1px solid #e8e8e8;
            border-radius: 8px 8px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
            font-weight: bold;
        }
        #s2a-header:hover {
            background: #f0f0f0;
        }
        .s2a-tabs {
            display: flex;
            border-bottom: 1px solid #e8e8e8;
            background: #fafafa;
        }
        .s2a-tab {
            flex: 1;
            text-align: center;
            padding: 8px 0;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            font-size: 13px;
        }
        .s2a-tab.active {
            color: #1890ff;
            border-bottom: 2px solid #1890ff;
            background: #fff;
        }
        .s2a-content {
            flex: 1;
            overflow-y: auto;
            padding: 15px;
            background: #fff;
            border-radius: 0 0 8px 8px;
        }
        .s2a-panel {
            display: none;
        }
        .s2a-panel.active {
            display: block;
        }
        .s2a-form-group {
            margin-bottom: 12px;
        }
        .s2a-form-group label {
            display: block;
            margin-bottom: 4px;
            font-weight: 500;
            font-size: 13px;
        }
        .s2a-form-group input[type="text"],
        .s2a-form-group input[type="password"],
        .s2a-form-group select {
            width: 100%;
            padding: 6px;
            border: 1px solid #d9d9d9;
            border-radius: 4px;
            box-sizing: border-box;
            font-size: 13px;
        }
        .s2a-btn {
            padding: 6px 12px;
            background: #1890ff;
            color: #fff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            margin-right: 8px;
            margin-bottom: 8px;
        }
        .s2a-btn:hover {
            background: #40a9ff;
        }
        .s2a-btn-danger {
            background: #ff4d4f;
        }
        .s2a-btn-danger:hover {
            background: #ff7875;
        }
        .s2a-log {
            margin-top: 10px;
            padding: 8px;
            background: #f5f5f5;
            border: 1px solid #d9d9d9;
            border-radius: 4px;
            height: 120px;
            overflow-y: auto;
            font-family: monospace;
            font-size: 12px;
            white-space: pre-wrap;
        }
        .s2a-hr {
            border: none;
            border-top: 1px solid #e8e8e8;
            margin: 15px 0;
        }
    `);

    const appHTML = `
        <div id="s2a-app" class="collapsed">
            <div id="s2a-header">
                <span>🚀 S2A Manager (Web)</span>
                <span id="s2a-toggle">▲ 展开</span>
            </div>
            <div class="s2a-tabs">
                <div class="s2a-tab active" data-target="panel-config">⚙️ 配置</div>
                <div class="s2a-tab" data-target="panel-account">👥 账号</div>
                <div class="s2a-tab" data-target="panel-proxy">🌐 代理</div>
                <div class="s2a-tab" data-target="panel-convert">🔀 转换</div>
            </div>
            <div class="s2a-content">
                <!-- 1. 配置面板 -->
                <div id="panel-config" class="s2a-panel active">
                    <div class="s2a-form-group">
                        <label>网站 API 地址 (例如 http://127.0.0.1:8080)</label>
                        <input type="text" id="s2a-baseUrl" placeholder="输入 sub2api 地址">
                    </div>
                    <div class="s2a-form-group">
                        <label>管理员 API Key</label>
                        <input type="password" id="s2a-apiKey" placeholder="输入 Admin API Key">
                    </div>
                    <button class="s2a-btn" id="btn-save-config">💾 保存配置</button>
                    <button class="s2a-btn" id="btn-test-conn">🔗 测试连接</button>
                </div>

                <!-- 2. 账号面板 -->
                <div id="panel-account" class="s2a-panel">
                    <div class="s2a-form-group">
                        <label>📥 导入账号 JSON</label>
                        <input type="file" id="file-import-account" accept=".json" multiple>
                    </div>
                    <button class="s2a-btn" id="btn-import-account">开始导入</button>

                    <hr class="s2a-hr">
                    <div class="s2a-form-group">
                        <label>📤 导出现有账号</label>
                        <button class="s2a-btn" id="btn-export-account">下载全部账号 (JSON)</button>
                    </div>

                    <hr class="s2a-hr">
                    <div class="s2a-form-group">
                        <label>🛠️ 账号检测与清理</label>
                        <button class="s2a-btn s2a-btn-danger" id="btn-detect-401">检测并清除失效(401/403)</button>
                    </div>
                </div>

                <!-- 3. 代理面板 -->
                <div id="panel-proxy" class="s2a-panel">
                    <div class="s2a-form-group">
                        <label>📥 导入代理 JSON</label>
                        <input type="file" id="file-import-proxy" accept=".json">
                    </div>
                    <button class="s2a-btn" id="btn-import-proxy">开始导入</button>

                    <hr class="s2a-hr">
                    <div class="s2a-form-group">
                        <label>🗑️ 清理代理</label>
                        <button class="s2a-btn s2a-btn-danger" id="btn-clear-proxies">清空所有代理</button>
                    </div>
                </div>

                <!-- 4. 转换面板 -->
                <div id="panel-convert" class="s2a-panel">
                    <div class="s2a-form-group">
                        <label>🔀 转换简易 JSON 为标准 S2A 格式</label>
                        <input type="file" id="file-convert" accept=".json" multiple>
                    </div>
                    <button class="s2a-btn" id="btn-convert">转换并下载</button>
                    <div style="font-size:12px; color:#666; margin-top:8px;">
                        自动识别 token, access_token, session_token 等凭证字段。
                    </div>
                </div>

                <!-- 公共日志区 -->
                <div class="s2a-log" id="s2a-log">就绪...</div>
            </div>
        </div>
    `;

    const container = document.createElement('div');
    container.innerHTML = appHTML;
    document.body.appendChild(container);

    // --------------------------------------------------------
    // 2. 核心状态与通用函数 (Core State & Utils)
    // --------------------------------------------------------
    const ui = {
        app: document.getElementById('s2a-app'),
        toggle: document.getElementById('s2a-toggle'),
        header: document.getElementById('s2a-header'),
        tabs: document.querySelectorAll('.s2a-tab'),
        panels: document.querySelectorAll('.s2a-panel'),
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

    // 展开/收起
    ui.header.addEventListener('click', () => {
        ui.app.classList.toggle('collapsed');
        ui.toggle.innerText = ui.app.classList.contains('collapsed') ? '▲ 展开' : '▼ 收起';
    });

    // 标签切换
    ui.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            ui.tabs.forEach(t => t.classList.remove('active'));
            ui.panels.forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.target).classList.add('active');
        });
    });

    // 保存配置
    document.getElementById('btn-save-config').addEventListener('click', () => {
        GM_setValue('s2a_baseUrl', ui.baseUrl.value);
        GM_setValue('s2a_apiKey', ui.apiKey.value);
        log('✅ 配置已保存到本地存储。');
    });

    // 测试连接
    document.getElementById('btn-test-conn').addEventListener('click', async () => {
        log('正在测试连接...');
        try {
            const res = await s2aFetch('/admin/settings/admin-api-key');
            log(`✅ 连接成功！(当前 Admin Key 有效)`);
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

})();