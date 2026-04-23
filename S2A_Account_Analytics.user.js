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
                <input type="password" id="s2a-stat-apiKey" class="s2a-input" placeholder="输入 Admin API Key 或 Bearer Token">
                <button class="s2a-btn-action s2a-btn-query" id="btn-start-analysis">开始全量统计与分析</button>
            </div>

            <!-- 统计摘要 -->
            <div class="s2a-stat-box" id="stat-summary" style="display: none;">
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
            </div>

            <!-- 详细列表 -->
            <div class="s2a-table-container" id="table-container" style="display: none;">
                <table class="s2a-table">
                    <thead>
                        <tr>
                            <th width="40%">账号标识</th>
                            <th width="20%">使用率</th>
                            <th width="20%">消耗 Tokens</th>
                            <th width="20%">请求次数</th>
                        </tr>
                    </thead>
                    <tbody id="s2a-tbody">
                    </tbody>
                </table>
            </div>

            <!-- 图表容器 -->
            <div class="s2a-chart-container" id="chart-container" style="display: none;">
                <canvas id="s2a-chart"></canvas>
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
            tbody: document.getElementById('s2a-tbody'),
            btnStart: document.getElementById('btn-start-analysis'),
            sTotal: document.getElementById('stat-total'),
            s100: document.getElementById('stat-100'),
            s80: document.getElementById('stat-80'),
            s50: document.getElementById('stat-50')
        };

        let myChart = null; // 图表实例

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
        async function s2aFetch(url) {
            try {
                const response = await window.fetch(url, {
                    method: 'GET',
                    headers: getAuthHeaders(),
                    mode: 'cors'
                });
                
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

        // 开始分析流程
        ui.btnStart.addEventListener('click', async () => {
            if (!ui.apiKey.value.trim()) {
                return setLog('❌ 请先填写或抓取 Admin Token！');
            }

            ui.btnStart.disabled = true;
            ui.summary.style.display = 'none';
            ui.tableContainer.style.display = 'none';
            ui.chartContainer.style.display = 'none';
            ui.tbody.innerHTML = '';
            
            try {
                // 1. 获取第一页并计算总页数
                setLog('🔍 正在获取账号列表 (第1页)...');
                const baseUrl = 'https://sub.hlmove.cloud/api/v1/admin/accounts';
                const queryParams = '?page_size=50&sort_by=expires_at&sort_order=asc&lite=1&timezone=Asia%2FShanghai';
                
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
                        
                        analyzedData.push({
                            id: acc.id,
                            name: acc.name || `Account #${acc.id}`,
                            utilization: util,
                            tokens: tokens,
                            requests: reqs
                        });
                    } catch (err) {
                        console.error(`Failed to fetch usage for ${acc.id}`, err);
                        analyzedData.push({
                            id: acc.id,
                            name: acc.name || `Account #${acc.id}`,
                            utilization: 0,
                            tokens: 0,
                            requests: 0,
                            error: true
                        });
                    }
                    
                    completedCount++;
                    // 每次完成都实时更新日志（对于 UI 刷新来说性能完全没问题）
                    setLog(`⏳ 正在分析用量进度: ${completedCount} / ${totalAccs} ...`);
                });

                // 4. 数据排序 (先按 utilization 降序，再按 tokens 降序)
                setLog('🧮 正在统计与排序结果...');
                analyzedData.sort((a, b) => {
                    if (b.utilization !== a.utilization) {
                        return b.utilization - a.utilization;
                    }
                    return b.tokens - a.tokens;
                });

                // 5. 统计整体分析数据
                let count100 = 0;
                let count80 = 0; // >80 且 <100
                let count50 = 0; // >50 且 <=80
                
                let htmlStr = '';

                analyzedData.forEach(item => {
                    if (item.utilization === 100) count100++;
                    else if (item.utilization > 80 && item.utilization < 100) count80++;
                    else if (item.utilization > 50 && item.utilization <= 80) count50++;

                    // 生成表格行
                    let colorColor = item.utilization >= 90 ? '#ff4d4f' : (item.utilization > 50 ? '#faad14' : '#52c41a');
                    if(item.error) colorColor = '#999';

                    htmlStr += `
                        <tr>
                            <td style="word-break: break-all;" title="ID: ${item.id}">${item.name}</td>
                            <td style="color: ${colorColor}; font-weight: bold;">${item.error ? '获取失败' : item.utilization + '%'}</td>
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
                
                ui.tbody.innerHTML = htmlStr;

                ui.summary.style.display = 'flex';
                ui.tableContainer.style.display = 'block';
                ui.chartContainer.style.display = 'block';

                // 7. 渲染图表 (Chart.js)
                if (myChart) myChart.destroy();
                const ctx = document.getElementById('s2a-chart').getContext('2d');
                
                // 提取前 20 个高负载账号用于展示，如果总数不够则展示全部
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
                                    a.utilization >= 90 ? 'rgba(255, 77, 79, 0.7)' : 
                                    (a.utilization > 50 ? 'rgba(250, 173, 20, 0.7)' : 'rgba(82, 196, 26, 0.7)')
                                ),
                                borderColor: chartData.map(a => 
                                    a.utilization >= 90 ? '#ff4d4f' : 
                                    (a.utilization > 50 ? '#faad14' : '#52c41a')
                                ),
                                borderWidth: 1,
                                yAxisID: 'y'
                            },
                            {
                                label: 'Tokens (K)',
                                data: chartData.map(a => a.tokens / 1000),
                                type: 'line',
                                borderColor: '#1890ff',
                                backgroundColor: '#1890ff',
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