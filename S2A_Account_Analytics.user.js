// ==UserScript==
// @name         S2A Account Analytics (Web Version)
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  统计 sub2api 账号的7天使用率 (Utilization & Tokens) 并生成分析报告
// @author       Trae AI
// @match        https://sub.hlmove.cloud/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *
// ==/UserScript==

(function() {
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
    panel.id = "__s2a_analytics_panel";
    panel.style.cssText = `
        position: fixed;
        z-index: 99999;
        right: 420px; /* 与 Manager 错开 */
        top: 70px;
        width: 600px; /* 调大面板宽度 */
        max-height: 90vh; /* 增加最大高度 */
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
    toggleBtn.textContent = "📊 账号统计";
    toggleBtn.style.cssText = `
        position: fixed;
        z-index: 100000;
        right: 120px; /* 与 Manager 错开 */
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
        panel.style.opacity = isOpen ? "1" : "0";
        panel.style.visibility = isOpen ? "visible" : "hidden";
        panel.style.pointerEvents = isOpen ? "auto" : "none";
        panel.style.transform = isOpen ? "translateX(0) scale(1)" : "translateX(calc(100% + 24px)) scale(0.985)";
    });

    // 内部 HTML 结构
    panel.innerHTML = `
        <div style="font-size: 16px; font-weight: 800; margin-bottom: 12px; display: flex; justify-content: space-between;">
            <span>📊 S2A 账号用量统计</span>
            <span style="font-size: 12px; font-weight: normal; opacity: 0.8; cursor:pointer;" id="s2a-stat-auto-token">🔄 尝试自动抓取 Token</span>
        </div>
        
        <div style="flex: 1; overflow-y: hidden; display: flex; flex-direction: column; background: ${t.inputBg}; border: ${t.inputBorder}; border-radius: 16px; padding: 12px; height: 600px;">
            <style>
                .s2a-input { width: 100%; padding: 8px 10px; border-radius: 8px; border: ${t.inputBorder}; background: ${t.panelBg}; color: ${t.panelText}; font-size: 12px; box-sizing: border-box; outline: none; margin-bottom: 10px;}
                .s2a-label { font-size: 11px; font-weight: 600; margin-bottom: 4px; display: block; opacity: 0.9; }
                .s2a-btn-action { padding: 10px 14px; border-radius: 12px; cursor: pointer; font-size: 12px; font-weight: 700; transition: transform 0.2s ease; border: ${t.btnBorder}; color: ${t.btnText}; width: 100%; margin-bottom: 10px;}
                .s2a-btn-action:hover { transform: translateY(-1px); }
                .s2a-btn-query { background: ${t.btnQueryBg}; }
                
                .s2a-stat-box { display: flex; justify-content: space-between; background: ${t.softBg}; padding: 10px; border-radius: 8px; margin-bottom: 10px; border: ${t.softBorder}; font-size: 12px;}
                .s2a-stat-item { display: flex; flex-direction: column; align-items: center; }
                .s2a-stat-num { font-size: 18px; font-weight: 800; color: #ff4d4f; }
                .s2a-stat-num.safe { color: #52c41a; }
                .s2a-stat-num.warn { color: #faad14; }
                
                .s2a-table-container { flex: 1; overflow-y: auto; scrollbar-width: thin; border-radius: 8px; border: ${t.inputBorder}; background: ${t.panelBg}; }
                .s2a-table { width: 100%; border-collapse: collapse; font-size: 11px; text-align: left; }
                .s2a-table th { padding: 8px; background: ${t.softBg}; position: sticky; top: 0; backdrop-filter: blur(10px); z-index: 10; border-bottom: ${t.softBorder}; font-weight: 600; }
                .s2a-table td { padding: 8px; border-bottom: ${t.softBorder}; }
                .s2a-table tr:hover { background: ${t.softBg}; }
            </style>
            
            <div>
                <label class="s2a-label">管理员 API Key / Token</label>
                <input type="password" id="s2a-stat-apiKey" class="s2a-input" placeholder="输入 Admin API Key 或 Bearer Token">
                <button class="s2a-btn-action s2a-btn-query" id="btn-start-analysis">🚀 开始全量统计与分析</button>
            </div>

            <!-- 统计摘要 -->
            <div class="s2a-stat-box" id="stat-summary" style="display: none;">
                <div class="s2a-stat-item">
                    <span class="s2a-stat-num" id="stat-total">0</span>
                    <span>总账号数</span>
                </div>
                <div class="s2a-stat-item">
                    <span class="s2a-stat-num" id="stat-100">0</span>
                    <span>100% 用尽</span>
                </div>
                <div class="s2a-stat-item">
                    <span class="s2a-stat-num warn" id="stat-80">0</span>
                    <span>>80% 高负载</span>
                </div>
                <div class="s2a-stat-item">
                    <span class="s2a-stat-num safe" id="stat-50">0</span>
                    <span>>50% 活跃</span>
                </div>
            </div>

            <!-- 详细列表 -->
            <div class="s2a-table-container" id="table-container" style="display: none;">
                <table class="s2a-table">
                    <thead>
                        <tr>
                            <th width="40%">账号 Email/Name</th>
                            <th width="20%">7天使用率</th>
                            <th width="20%">消耗 Tokens</th>
                            <th width="20%">请求次数</th>
                        </tr>
                    </thead>
                    <tbody id="s2a-tbody">
                    </tbody>
                </table>
            </div>
            
            <!-- 进度条/日志 -->
            <div id="s2a-stat-log" style="margin-top: 10px; font-size: 11px; text-align: center; opacity: 0.8;">等待开始...</div>
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
            tbody: document.getElementById('s2a-tbody'),
            btnStart: document.getElementById('btn-start-analysis'),
            sTotal: document.getElementById('stat-total'),
            s100: document.getElementById('stat-100'),
            s80: document.getElementById('stat-80'),
            s50: document.getElementById('stat-50')
        };

        function setLog(msg) {
            ui.log.innerText = msg;
        }

        function getAuthHeaders() {
            return {
                'Authorization': `Bearer ${ui.apiKey.value.trim()}`,
                'Content-Type': 'application/json'
            };
        }

        // 包装 Fetch 为 Promise
        function s2aFetch(url) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    headers: getAuthHeaders(),
                    onload: function(response) {
                        try {
                            const data = JSON.parse(response.responseText);
                            if (response.status >= 200 && response.status < 300) {
                                resolve(data);
                            } else {
                                reject(new Error(`HTTP ${response.status}: ${data.message || response.responseText}`));
                            }
                        } catch (e) {
                            reject(new Error(`HTTP ${response.status}: ${response.responseText}`));
                        }
                    },
                    onerror: function(err) {
                        reject(new Error('Network error: ' + err));
                    }
                });
            });
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

        // 开始分析流程
        ui.btnStart.addEventListener('click', async () => {
            if (!ui.apiKey.value.trim()) {
                return setLog('❌ 请先填写或抓取 Admin Token！');
            }

            ui.btnStart.disabled = true;
            ui.summary.style.display = 'none';
            ui.tableContainer.style.display = 'none';
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

                await asyncPool(10, allAccounts, async (acc) => {
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
                    if (completedCount % 5 === 0 || completedCount === totalAccs) {
                        setLog(`⏳ 正在分析用量进度: ${completedCount} / ${totalAccs} ...`);
                    }
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
                            <td>${item.tokens.toLocaleString()}</td>
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