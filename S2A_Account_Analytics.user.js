// ==UserScript==
// @name         S2A Account Analytics (Web Version)
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  统计 sub2api 账号的7天使用率 (Utilization & Tokens) 并生成分析报告
// @author       Trae AI
// @match        https://sub.hlmove.cloud/*
// @require      https://cdn.jsdelivr.net/npm/chart.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // --------------------------------------------------------
    // 1. 样式与基础 UI 注入 (适配 sub2api 原站风格)
    // --------------------------------------------------------
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    
    // sub2api 现代化面板配色 (去除拟物化，采用扁平与毛玻璃结合的现代风)
    const theme = {
        dark: {
            panelBg: "rgba(30, 30, 30, 0.85)",
            panelBorder: "1px solid rgba(255, 255, 255, 0.1)",
            panelShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            panelText: "#e5e7eb",
            softBg: "rgba(255, 255, 255, 0.05)",
            softBorder: "1px solid rgba(255, 255, 255, 0.08)",
            btnQueryBg: "#3b82f6", // 蓝色主色调
            btnQueryHover: "#2563eb",
            btnBorder: "none",
            btnText: "#ffffff",
            inputBg: "rgba(0, 0, 0, 0.2)",
            inputBorder: "1px solid rgba(255, 255, 255, 0.1)",
            toggleBg: "#3b82f6",
            toggleText: "#ffffff"
        },
        light: {
            panelBg: "rgba(255, 255, 255, 0.9)",
            panelBorder: "1px solid rgba(0, 0, 0, 0.08)",
            panelShadow: "0 8px 32px rgba(0, 0, 0, 0.1)",
            panelText: "#374151",
            softBg: "rgba(0, 0, 0, 0.03)",
            softBorder: "1px solid rgba(0, 0, 0, 0.06)",
            btnQueryBg: "#3b82f6",
            btnQueryHover: "#2563eb",
            btnBorder: "none",
            btnText: "#ffffff",
            inputBg: "#ffffff",
            inputBorder: "1px solid #d1d5db",
            toggleBg: "#3b82f6",
            toggleText: "#ffffff"
        }
    };
    const t = isDark ? theme.dark : theme.light;

    // 创建主面板
    const panel = document.createElement("div");
    panel.id = "__s2a_analytics_panel";
    panel.style.cssText = `
        position: fixed;
        z-index: 99999;
        right: 420px;
        top: 70px;
        width: 720px;
        height: 75vh;
        max-height: 90vh;
        min-width: 400px;
        min-height: 400px;
        display: flex;
        flex-direction: column;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-radius: 12px; /* 更符合现代前端框架的圆角 */
        padding: 20px;
        box-sizing: border-box;
        overflow: hidden;
        will-change: transform, width, height;
        transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        transform-origin: right top;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translateY(-10px) scale(0.98);
        background: ${t.panelBg};
        border: ${t.panelBorder};
        box-shadow: ${t.panelShadow};
        color: ${t.panelText};
        resize: both;
    `;

    // 创建切换按钮
    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = "📊 账号统计";
    toggleBtn.style.cssText = `
        position: fixed;
        z-index: 100000;
        right: 120px;
        bottom: 24px;
        border-radius: 8px;
        padding: 10px 16px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0.5px;
        transition: all 0.2s ease;
        background: ${t.toggleBg};
        color: ${t.toggleText};
        border: none;
        box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.3), 0 2px 4px -1px rgba(59, 130, 246, 0.2);
    `;

    let isOpen = false;
    toggleBtn.addEventListener("click", () => {
        isOpen = !isOpen;
        panel.style.opacity = isOpen ? "1" : "0";
        panel.style.visibility = isOpen ? "visible" : "hidden";
        panel.style.pointerEvents = isOpen ? "auto" : "none";
        panel.style.transform = isOpen ? "translateY(0) scale(1)" : "translateY(-10px) scale(0.98)";
    });

    // 内部 HTML 结构
    panel.innerHTML = `
        <div style="font-size: 18px; font-weight: 600; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
            <span>S2A 账号用量分析</span>
            <span style="font-size: 13px; font-weight: normal; color: #3b82f6; cursor:pointer; padding: 4px 8px; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='${t.softBg}'" onmouseout="this.style.background='transparent'" id="s2a-stat-auto-token">🔄 自动抓取 Token</span>
        </div>
        
        <div style="flex: 1; overflow-y: hidden; display: flex; flex-direction: column; min-height: 0;">
            <style>
                .s2a-input { width: 100%; padding: 10px 12px; border-radius: 6px; border: ${t.inputBorder}; background: ${t.inputBg}; color: ${t.panelText}; font-size: 13px; box-sizing: border-box; outline: none; margin-bottom: 12px; transition: border-color 0.2s;}
                .s2a-input:focus { border-color: #3b82f6; }
                .s2a-label { font-size: 12px; font-weight: 500; margin-bottom: 6px; display: block; color: ${t.panelText}; opacity: 0.8; }
                .s2a-btn-action { padding: 10px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; transition: background-color 0.2s ease; border: none; color: #ffffff; width: 100%; margin-bottom: 16px;}
                .s2a-btn-query { background: ${t.btnQueryBg}; }
                .s2a-btn-query:hover { background: ${t.btnQueryHover}; }
                
                .s2a-stat-box { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 16px;}
                .s2a-stat-item { flex: 1; display: flex; flex-direction: column; background: ${t.softBg}; padding: 16px 12px; border-radius: 8px; border: ${t.softBorder}; }
                .s2a-stat-title { font-size: 12px; opacity: 0.7; margin-bottom: 8px; }
                .s2a-stat-num { font-size: 24px; font-weight: 600; color: ${t.panelText}; line-height: 1; }
                .s2a-stat-num.danger { color: #ef4444; }
                .s2a-stat-num.safe { color: #10b981; }
                .s2a-stat-num.warn { color: #f59e0b; }
                
                .s2a-table-container { flex: 1; overflow-y: auto; scrollbar-width: thin; border-radius: 8px; border: ${t.inputBorder}; background: ${t.panelBg}; margin-bottom: 16px;}
                .s2a-table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; }
                .s2a-table th { padding: 12px 16px; background: ${t.softBg}; position: sticky; top: 0; z-index: 10; font-weight: 500; color: ${t.panelText}; border-bottom: ${t.inputBorder}; }
                .s2a-table td { padding: 12px 16px; border-bottom: ${t.softBorder}; color: ${t.panelText}; }
                .s2a-table tr:hover { background: ${t.softBg}; }

                .s2a-chart-container { height: 200px; width: 100%; border-radius: 8px; background: ${t.panelBg}; padding: 12px; box-sizing: border-box; border: ${t.inputBorder}; }
            </style>
            
            <div>
                <label class="s2a-label">管理员 API Key / Token</label>
                <div style="display: flex; gap: 8px;">
                    <input type="password" id="s2a-stat-apiKey" class="s2a-input" style="flex: 2; margin-bottom: 12px;" placeholder="输入 Admin API Key 或 Bearer Token">
                    <select id="s2a-group-filter" class="s2a-input" style="flex: 1; margin-bottom: 12px; cursor: pointer;">
                        <option value="">全部账号</option>
                    </select>
                </div>
                <button class="s2a-btn-action s2a-btn-query" id="btn-start-analysis">开始全量统计与分析</button>
            </div>

            <!-- 操作按钮栏 -->
            <div id="action-bar" style="display: none; gap: 8px; margin-bottom: 16px;">
                <button class="s2a-btn-action" style="background: #ef4444; flex: 1; margin-bottom: 0;" id="btn-disable-error">🚨 停用异常账号 (<span id="count-error">0</span>)</button>
                <button class="s2a-btn-action" style="background: #f59e0b; flex: 1; margin-bottom: 0;" id="btn-refresh-error">🔄 测活异常账号</button>
            </div>

            <!-- 统计摘要 -->
            <div class="s2a-stat-box" id="stat-summary" style="display: none; flex-wrap: wrap;">
                <div class="s2a-stat-item">
                    <span class="s2a-stat-title">总账号数</span>
                    <span class="s2a-stat-num" id="stat-total">0</span>
                </div>
                <div class="s2a-stat-item">
                    <span class="s2a-stat-title">100% 用尽</span>
                    <span class="s2a-stat-num danger" id="stat-100">0</span>
                </div>
                <div class="s2a-stat-item">
                    <span class="s2a-stat-title">>80% 高负载</span>
                    <span class="s2a-stat-num warn" id="stat-80">0</span>
                </div>
                <div class="s2a-stat-item">
                    <span class="s2a-stat-title">>50% 活跃</span>
                    <span class="s2a-stat-num safe" id="stat-50">0</span>
                </div>
                <div class="s2a-stat-item">
                    <span class="s2a-stat-title" style="color: #ef4444;">异常/报错</span>
                    <span class="s2a-stat-num danger" id="stat-error">0</span>
                </div>
                <div class="s2a-stat-item">
                    <span class="s2a-stat-title" style="color: #6b7280;">零消耗僵尸</span>
                    <span class="s2a-stat-num" style="color: #6b7280;" id="stat-zombie">0</span>
                </div>
            </div>

            <!-- 详细列表 -->
            <div class="s2a-table-container" id="table-container" style="display: none;">
                <table class="s2a-table">
                    <thead>
                        <tr>
                            <th width="40%">账号标识</th>
                            <th width="20%">状态 / 使用率</th>
                            <th width="20%">消耗 Tokens</th>
                            <th width="20%">请求次数</th>
                        </tr>
                    </thead>
                    <tbody id="s2a-tbody">
                    </tbody>
                </table>
            </div>

            <!-- 图表容器 -->
            <div style="display: flex; gap: 12px; height: 200px;" id="chart-wrapper">
                <div class="s2a-chart-container" id="chart-container" style="display: none; flex: 2;">
                    <canvas id="s2a-chart"></canvas>
                </div>
                <div class="s2a-chart-container" id="pie-chart-container" style="display: none; flex: 1;">
                    <canvas id="s2a-pie-chart"></canvas>
                </div>
            </div>
            
            <!-- 进度条/日志 -->
            <div id="s2a-stat-log" style="margin-top: 12px; font-size: 12px; text-align: center; color: #6b7280; flex-shrink: 0;">等待操作...</div>
        </div>
    `;

    function createSidebar() {
        if (document.getElementById('__s2a_analytics_panel')) return;
        document.body.appendChild(panel);
        document.body.appendChild(toggleBtn);
        
        // 在元素插入 DOM 后再获取它们的引用
        const ui = {
            apiKey: document.getElementById('s2a-stat-apiKey'),
            log: document.getElementById('s2a-stat-log'),
            summary: document.getElementById('stat-summary'),
            tableContainer: document.getElementById('table-container'),
            chartContainer: document.getElementById('chart-container'),
            pieChartContainer: document.getElementById('pie-chart-container'),
            tbody: document.getElementById('s2a-tbody'),
            btnStart: document.getElementById('btn-start-analysis'),
            sTotal: document.getElementById('stat-total'),
            s100: document.getElementById('stat-100'),
            s80: document.getElementById('stat-80'),
            s50: document.getElementById('stat-50'),
            sError: document.getElementById('stat-error'),
            sZombie: document.getElementById('stat-zombie'),
            groupFilter: document.getElementById('s2a-group-filter'),
            actionBar: document.getElementById('action-bar'),
            btnDisableError: document.getElementById('btn-disable-error'),
            btnRefreshError: document.getElementById('btn-refresh-error'),
            countError: document.getElementById('count-error')
        };

        let myChart = null; // 图表实例
        let myPieChart = null; // 饼图实例
        let errorAccountIds = []; // 存储异常账号ID

        function setLog(msg) {
            ui.log.innerText = msg;
        }

        function getAuthHeaders() {
            return {
                'Authorization': `Bearer ${ui.apiKey.value.trim()}`,
                'Content-Type': 'application/json'
            };
        }

        // 原生 fetch 请求
        async function s2aFetch(url, method = 'GET', body = null) {
            try {
                const options = {
                    method: method,
                    headers: getAuthHeaders(),
                    mode: 'cors'
                };
                if (body) {
                    options.body = JSON.stringify(body);
                }
                const response = await window.fetch(url, options);
                const data = await response.json().catch(() => null);
                
                if (response.ok && data) {
                    return data;
                } else {
                    throw new Error(`HTTP ${response.status}: ${data ? data.message : response.statusText}`);
                }
            } catch (err) {
                throw new Error('Fetch error: ' + err.message);
            }
        }

        // 自动获取 Token 逻辑
        function autoFetchToken() {
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
                setLog('✅ 已自动提取到当前环境的 Token。');
            } else {
                setLog('⚠️ 未找到 Token，请手动填写。');
            }
        }

        // 手动点击按钮获取 Token
        document.getElementById('s2a-stat-auto-token').addEventListener('click', autoFetchToken);
        
        // 面板展开时也自动获取一次
        toggleBtn.addEventListener("click", () => {
            if(isOpen && !ui.apiKey.value.trim()) {
                autoFetchToken();
            }
        });

        // 初始也尝试获取一次
        autoFetchToken();

        // 并发控制函数 (限制最大并发数，防止把服务器打挂)
        async function asyncPool(poolLimit, array, iteratorFn) {
            const ret = [];
            const executing = [];
            for (const item of array) {
                const p = Promise.resolve().then(() => iteratorFn(item, array));
                ret.push(p);
                if (poolLimit <= array.length) {
                    const e = p.then(() => executing.splice(executing.indexOf(e), 1));
                    executing.push(e);
                    if (executing.length >= poolLimit) {
                        await Promise.race(executing);
                    }
                }
            }
            return Promise.all(ret);
        }

        // 格式化 Tokens 显示 (K, M)
        function formatTokens(num) {
            if (num >= 1000000) {
                return (num / 1000000).toFixed(1) + 'M';
            } else if (num >= 1000) {
                return (num / 1000).toFixed(1) + 'K';
            }
            return num.toString();
        }

        // 获取分组列表并填充下拉框
        async function fetchGroups() {
            if (!ui.apiKey.value.trim()) return;
            try {
                const res = await s2aFetch('https://sub.hlmove.cloud/api/v1/admin/groups/all');
                if (res && res.data) {
                    const oldVal = ui.groupFilter.value;
                    ui.groupFilter.innerHTML = '<option value="">全部账号</option>';
                    res.data.forEach(g => {
                        const opt = document.createElement('option');
                        opt.value = g.id;
                        opt.textContent = g.name;
                        ui.groupFilter.appendChild(opt);
                    });
                    ui.groupFilter.value = oldVal;
                }
            } catch(e) {
                console.error("Fetch groups failed:", e);
            }
        }

        ui.apiKey.addEventListener('change', fetchGroups);
        toggleBtn.addEventListener('click', () => { if(isOpen) fetchGroups(); });

        // 异常账号处理功能
        ui.btnDisableError.addEventListener('click', async () => {
            if (!errorAccountIds.length) return;
            if (!confirm(`确定要停用这 ${errorAccountIds.length} 个异常/报错账号吗？`)) return;
            
            ui.btnDisableError.disabled = true;
            ui.btnRefreshError.disabled = true;
            setLog(`🔄 正在批量停用 ${errorAccountIds.length} 个账号...`);
            
            try {
                // 方案一：如果有批量更新接口，则使用。这里我们直接使用批量更新 /bulk-update 
                // 由于我们不完全确定 bulk-update 的结构，最稳妥的是并发 PUT
                let completed = 0;
                await asyncPool(5, errorAccountIds, async (id) => {
                    await s2aFetch(`https://sub.hlmove.cloud/api/v1/admin/accounts/bulk-update`, 'POST', {
                        account_ids: [id],
                        status: "disabled"
                    }).catch(async () => {
                        // 降级使用 PUT
                        try {
                            const accInfo = await s2aFetch(`https://sub.hlmove.cloud/api/v1/admin/accounts/${id}`);
                            if(accInfo && accInfo.data) {
                                accInfo.data.status = "disabled";
                                await s2aFetch(`https://sub.hlmove.cloud/api/v1/admin/accounts/${id}`, 'PUT', accInfo.data);
                            }
                        } catch(e) {}
                    });
                    completed++;
                    setLog(`🔄 正在停用进度: ${completed} / ${errorAccountIds.length}`);
                });
                
                setLog(`✅ 成功停用异常账号！请重新点击全量分析。`);
                ui.btnStart.click(); // 自动刷新
            } catch(e) {
                setLog(`❌ 停用失败: ${e.message}`);
            }
        });

        ui.btnRefreshError.addEventListener('click', async () => {
            if (!errorAccountIds.length) return;
            ui.btnDisableError.disabled = true;
            ui.btnRefreshError.disabled = true;
            setLog(`🔄 正在批量强制测活 ${errorAccountIds.length} 个账号...`);
            
            try {
                let completed = 0;
                await asyncPool(5, errorAccountIds, async (id) => {
                    await s2aFetch(`https://sub.hlmove.cloud/api/v1/admin/accounts/${id}/test`, 'POST').catch(()=>{});
                    completed++;
                    setLog(`🔄 正在测活进度: ${completed} / ${errorAccountIds.length}`);
                });
                setLog(`✅ 测活完成！请重新点击全量分析查看最新状态。`);
                ui.btnStart.click(); // 自动刷新
            } catch(e) {
                setLog(`❌ 测活失败: ${e.message}`);
            }
        });

        // 开始分析流程
        ui.btnStart.addEventListener('click', async () => {
            if (!ui.apiKey.value.trim()) {
                return setLog('❌ 请先填写或抓取 Admin Token！');
            }

            ui.btnStart.disabled = true;
            ui.summary.style.display = 'none';
            ui.tableContainer.style.display = 'none';
            ui.chartContainer.style.display = 'none';
            ui.pieChartContainer.style.display = 'none';
            ui.actionBar.style.display = 'none';
            ui.tbody.innerHTML = '';
            errorAccountIds = [];
            
            try {
                // 1. 获取第一页并计算总页数
                setLog('🔍 正在获取账号列表 (第1页)...');
                const baseUrl = 'https://sub.hlmove.cloud/api/v1/admin/accounts';
                let queryParams = '?page_size=50&sort_by=expires_at&sort_order=asc&lite=1&timezone=Asia%2FShanghai';
                
                const selectedGroup = ui.groupFilter.value;
                if (selectedGroup) {
                    queryParams += `&group=${selectedGroup}`;
                }
                
                const firstPageData = await s2aFetch(`${baseUrl}${queryParams}&page=1`);
                if (!firstPageData || !firstPageData.data || !firstPageData.data.items) {
                    throw new Error('无法解析第一页数据结构');
                }

                const totalPages = firstPageData.data.pages || 1;
                let allAccounts = [...firstPageData.data.items];

                // 2. 并发获取剩余所有页的账号
                if (totalPages > 1) {
                    const pagesToFetch = [];
                    for (let i = 2; i <= totalPages; i++) {
                        pagesToFetch.push(i);
                    }
                    
                    setLog(`📦 正在并发拉取剩余 ${totalPages - 1} 页账号数据...`);
                    
                    const pageResults = await asyncPool(5, pagesToFetch, async (page) => {
                        const res = await s2aFetch(`${baseUrl}${queryParams}&page=${page}`);
                        return res.data.items || [];
                    });
                    
                    pageResults.forEach(items => {
                        allAccounts = allAccounts.concat(items);
                    });
                }

                const totalAccs = allAccounts.length;
                setLog(`✅ 成功获取到 ${totalAccs} 个账号，开始并发请求用量数据...`);

                // 3. 并发获取所有账号的 usage 数据
                let completedCount = 0;
                const analyzedData = [];

                await asyncPool(15, allAccounts, async (acc) => {
                    try {
                        const usageRes = await s2aFetch(`https://sub.hlmove.cloud/api/v1/admin/accounts/${acc.id}/usage?timezone=Asia%2FShanghai`);
                        let util = 0, tokens = 0, reqs = 0;
                        
                        if (usageRes && usageRes.data && usageRes.data.seven_day) {
                            const sd = usageRes.data.seven_day;
                            util = sd.utilization || 0;
                            if (sd.window_stats) {
                                tokens = sd.window_stats.tokens || 0;
                                reqs = sd.window_stats.requests || 0;
                            }
                        }
                        
                        const isError = acc.status !== 'active' || acc.error_message;
                        if (isError) {
                            errorAccountIds.push(acc.id);
                        }
                        
                        analyzedData.push({
                            id: acc.id,
                            name: acc.name || `Account #${acc.id}`,
                            utilization: util,
                            tokens: tokens,
                            requests: reqs,
                            status: acc.status,
                            errorMessage: acc.error_message || '',
                            isError: isError
                        });
                    } catch (err) {
                        console.error(`Failed to fetch usage for ${acc.id}`, err);
                        errorAccountIds.push(acc.id);
                        analyzedData.push({
                            id: acc.id,
                            name: acc.name || `Account #${acc.id}`,
                            utilization: 0,
                            tokens: 0,
                            requests: 0,
                            status: acc.status || 'unknown',
                            errorMessage: 'Failed to fetch usage',
                            isError: true
                        });
                    }
                    
                    completedCount++;
                    // 每次完成都实时更新日志（对于 UI 刷新来说性能完全没问题）
                    setLog(`⏳ 正在分析用量进度: ${completedCount} / ${totalAccs} ...`);
                });

                // 4. 数据排序 (先按 utilization 降序，再按 tokens 降序)
                setLog('🧮 正在统计与排序结果...');
                analyzedData.sort((a, b) => {
                    if (a.isError && !b.isError) return -1; // 报错账号排最前面
                    if (!a.isError && b.isError) return 1;
                    if (b.utilization !== a.utilization) return b.utilization - a.utilization;
                    return b.tokens - a.tokens;
                });

                // 5. 统计整体分析数据
                let count100 = 0;
                let count80 = 0; // >80 且 <100
                let count50 = 0; // >50 且 <=80
                let countZombie = 0; // tokens = 0 且无报错
                
                let htmlStr = '';

                analyzedData.forEach(item => {
                    if (item.utilization === 100) count100++;
                    else if (item.utilization > 80 && item.utilization < 100) count80++;
                    else if (item.utilization > 50 && item.utilization <= 80) count50++;
                    
                    if (item.tokens === 0 && !item.isError) countZombie++;

                    // 生成表格行
                    let colorColor = item.utilization >= 90 ? '#ef4444' : (item.utilization > 50 ? '#f59e0b' : '#10b981');
                    let statusLabel = item.utilization + '%';
                    
                    if (item.isError) {
                        colorColor = '#ef4444';
                        statusLabel = `异常: ${item.status}`;
                    } else if (item.tokens === 0) {
                        colorColor = '#6b7280'; // 灰色僵尸
                    }

                    htmlStr += `
                        <tr>
                            <td style="word-break: break-all;" title="${item.errorMessage || item.name}">${item.name}</td>
                            <td style="color: ${colorColor}; font-weight: bold;" title="${item.errorMessage}">${statusLabel}</td>
                            <td title="${item.tokens.toLocaleString()}">${formatTokens(item.tokens)}</td>
                            <td>${item.requests}</td>
                        </tr>
                    `;
                });

                // 6. 渲染到 UI
                ui.sTotal.innerText = totalAccs;
                ui.s100.innerText = count100;
                ui.s80.innerText = count80;
                ui.s50.innerText = count50;
                ui.sError.innerText = errorAccountIds.length;
                ui.sZombie.innerText = countZombie;
                
                ui.countError.innerText = errorAccountIds.length;
                if (errorAccountIds.length > 0) {
                    ui.actionBar.style.display = 'flex';
                }
                
                ui.tbody.innerHTML = htmlStr;

                ui.summary.style.display = 'flex';
                ui.tableContainer.style.display = 'block';
                ui.chartContainer.style.display = 'block';

                // 7. 渲染图表 (Chart.js)
                if (myChart) myChart.destroy();
                const ctx = document.getElementById('s2a-chart').getContext('2d');
                
                // 提取前 20 个账号用于柱状图展示
                const chartData = analyzedData.slice(0, 20);
                
                myChart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: chartData.map(a => a.name.split('@')[0].substring(0, 8) + '..'), // 缩短标签
                        datasets: [
                            {
                                label: '使用率 (%)',
                                data: chartData.map(a => a.utilization),
                                backgroundColor: chartData.map(a => 
                                    a.isError ? 'rgba(239, 68, 68, 0.7)' : (a.utilization >= 90 ? 'rgba(239, 68, 68, 0.7)' : (a.utilization > 50 ? 'rgba(245, 158, 11, 0.7)' : 'rgba(16, 185, 129, 0.7)'))
                                ),
                                borderColor: chartData.map(a => 
                                    a.isError ? '#ef4444' : (a.utilization >= 90 ? '#ef4444' : (a.utilization > 50 ? '#f59e0b' : '#10b981'))
                                ),
                                borderWidth: 1,
                                yAxisID: 'y'
                            },
                            {
                                label: 'Tokens (K)',
                                data: chartData.map(a => a.tokens / 1000),
                                type: 'line',
                                borderColor: '#3b82f6',
                                backgroundColor: '#3b82f6',
                                tension: 0.3,
                                yAxisID: 'y1'
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: {
                            legend: { display: true, labels: { color: t.panelText, font: { size: 10 } } },
                            tooltip: { titleFont: { size: 11 }, bodyFont: { size: 11 } }
                        },
                        scales: {
                            x: { ticks: { color: t.panelText, font: { size: 9 }, maxRotation: 45, minRotation: 45 } },
                            y: { 
                                type: 'linear', display: true, position: 'left', 
                                title: { display: true, text: '使用率 %', color: t.panelText, font: { size: 10 } },
                                max: 100, min: 0,
                                ticks: { color: t.panelText }
                            },
                            y1: { 
                                type: 'linear', display: true, position: 'right', 
                                title: { display: true, text: 'Tokens (K)', color: t.panelText, font: { size: 10 } },
                                grid: { drawOnChartArea: false },
                                ticks: { color: t.panelText }
                            }
                        }
                    }
                });

                // 8. 绘制分组饼图
                if (myPieChart) myPieChart.destroy();
                ui.pieChartContainer.style.display = 'block';
                const ctxPie = document.getElementById('s2a-pie-chart').getContext('2d');
                
                // 统计每个分组的账号数
                const groupCount = {};
                let noGroupCount = 0;
                allAccounts.forEach(acc => {
                    if (acc.groups && acc.groups.length > 0) {
                        acc.groups.forEach(g => {
                            groupCount[g.name] = (groupCount[g.name] || 0) + 1;
                        });
                    } else {
                        noGroupCount++;
                    }
                });
                
                const pieLabels = Object.keys(groupCount);
                const pieData = Object.values(groupCount);
                if (noGroupCount > 0) {
                    pieLabels.push('未分组');
                    pieData.push(noGroupCount);
                }

                myPieChart = new Chart(ctxPie, {
                    type: 'doughnut',
                    data: {
                        labels: pieLabels,
                        datasets: [{
                            data: pieData,
                            backgroundColor: [
                                '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1', '#6b7280'
                            ],
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'right', labels: { color: t.panelText, font: { size: 10 }, boxWidth: 10 } },
                            tooltip: { titleFont: { size: 11 }, bodyFont: { size: 11 } }
                        }
                    }
                });
                
                setLog(`🎉 分析完成！耗时统计结束。`);

            } catch (e) {
                setLog(`❌ 发生错误: ${e.message}`);
                console.error(e);
            } finally {
                ui.btnStart.disabled = false;
            }
        });
    }

    // 注入 DOM
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", createSidebar, { once: true });
    } else {
        createSidebar();
    }

})();