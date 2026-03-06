/**
 * ========================================================
 *  哈希游戏下注执行器 v2 - Content Script
 *  模式: WS区块触发 (比v1更快)
 *
 *  v1 触发条件: currentBlock === targetBlock (DOM确认)
 *  v2 触发条件: WSClient收到 block(targetBlock-1) 时立即投注
 *               即上一个区块结果到达时，直接下注下一个区块
 *               跳过waitForUIReady + 跳过reset步骤，极速执行
 *
 *  目标执行时间: ≤ 80ms (从WS触发到confirm完成)
 *  CustomEvent : haxi-real-bet-v2 / haxi-bet-result-v2
 *  Chrome消息  : RELAY_BET_V2 / EXECUTE_BET_V2
 * ========================================================
 */
(function () {
  'use strict';

  const hostname = window.location.hostname;
  const isGamePage = hostname.includes('amazonaws.com');
  const isFrontendPage = hostname === 'localhost' || hostname === '127.0.0.1';

  if (isGamePage) {
    initGameExecutorV2();
  } else if (isFrontendPage) {
    initFrontendBridgeV2();
  }

  // ================================================================
  //  前端桥接模式 v2
  // ================================================================
  function initFrontendBridgeV2() {
    console.log('[HAXI Bridge v2] 前端桥接模式已加载');

    document.addEventListener('haxi-real-bet-v2', (e) => {
      const cmd = e.detail;
      if (!cmd || !cmd.target || !cmd.amount) return;
      console.log('[HAXI Bridge v2] 转发下注命令:', cmd);

      chrome.runtime.sendMessage({ type: 'RELAY_BET_V2', detail: cmd }, (response) => {
        const result = response || { success: false, reason: '插件通信失败' };
        document.dispatchEvent(new CustomEvent('haxi-bet-result-v2', {
          detail: {
            taskId: cmd.taskId,
            taskName: cmd.taskName,
            blockHeight: cmd.blockHeight,
            target: cmd.target,
            amount: cmd.amount,
            ruleId: cmd.ruleId,
            betType: cmd.betType,
            success: result.success || false,
            reason: result.reason || '',
            elapsed: result.elapsed || 0,
            timestamp: Date.now(),
            balanceAfter: result.balanceAfter
          }
        }));
      });
    });

    // 余额查询桥接
    document.addEventListener('haxi-query-balance-v2', () => {
      chrome.runtime.sendMessage({ type: 'RELAY_QUERY_BALANCE' }, (response) => {
        document.dispatchEvent(new CustomEvent('haxi-balance-result-v2', {
          detail: response || { balance: null, timestamp: Date.now() }
        }));
      });
    });
  }

  // ================================================================
  //  游戏页执行器模式 v2
  // ================================================================
  function initGameExecutorV2() {
    console.log('[HAXI执行器 v2] 游戏页面 WS触发模式');

    // ==================== 常量 ====================
    const STEP_DELAY_V2 = 10;         // 步骤间隔 (v1=20ms, v2=10ms)
    const POST_CONFIRM_V2 = 60;       // 确认后等待 (v1=80ms, v2=60ms)
    const TARGET_TEXT = { ODD: '单', EVEN: '双', BIG: '大', SMALL: '小' };

    let API_URL = 'http://localhost:3001';
    let WS_URL = 'ws://localhost:8080';

    // ==================== 工具函数 ====================
    function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    function detectGameType() {
      const url = decodeURIComponent(window.location.href);
      if (url.includes('尾数单双')) return 'PARITY';
      if (url.includes('尾数大小')) return 'SIZE';
      const tab = new URLSearchParams(window.location.search).get('tab');
      if (tab) {
        if (tab.includes('单双')) return 'PARITY';
        if (tab.includes('大小')) return 'SIZE';
      }
      const divs = document.querySelectorAll('div.sc-bdVaJa');
      for (const div of divs) {
        const text = div.textContent.trim();
        if (text === '尾数单双') return 'PARITY';
        if (text === '尾数大小') return 'SIZE';
      }
      return null;
    }

    // ==================== DOM适配器 (同v1) ====================
    const SiteAdapter = {
      getCurrentBlock() {
        let maxBlock = null;
        const candidates = document.querySelectorAll('div[color="#fff"][font-size="24px"][font-weight="600"]');
        for (const el of candidates) {
          const num = parseInt(el.textContent.trim());
          if (!isNaN(num) && num > 1000000) {
            if (!maxBlock || num > maxBlock) maxBlock = num;
          }
        }
        if (maxBlock) return maxBlock;
        const wavxa = document.querySelector('.Wavxa');
        if (wavxa) {
          const num = parseInt(wavxa.textContent.trim());
          if (!isNaN(num) && num > 1000000) return num;
        }
        const allDivs = document.querySelectorAll('div.sc-bdVaJa');
        for (const div of allDivs) {
          const text = div.textContent.trim();
          if (/^\d{7,9}$/.test(text)) {
            const num = parseInt(text);
            if (num > 1000000 && (!maxBlock || num > maxBlock)) maxBlock = num;
          }
        }
        return maxBlock;
      },

      findBetButton(target) {
        const targetText = TARGET_TEXT[target];
        if (!targetText) return null;
        const btns = document.querySelectorAll('div[width="40px"][height="40px"][font-size="40px"][font-weight="600"]');
        for (const btn of btns) {
          if (btn.textContent.trim() === targetText) return btn;
        }
        const allDivs = document.querySelectorAll('div.sc-bdVaJa');
        for (const div of allDivs) {
          if (div.textContent.trim() === targetText) return div;
        }
        return null;
      },

      findAmountInput() {
        const inputs = document.querySelectorAll('input[type="number"], input[inputmode="decimal"]');
        for (const inp of inputs) {
          if (inp.offsetParent !== null && !inp.disabled && !inp.readOnly) return inp;
        }
        const byClass = document.querySelector('.sc-Rmtcm input, .fQggfv input');
        if (byClass && byClass.offsetParent !== null) return byClass;
        return null;
      },

      findConfirmButton() {
        const candidates = document.querySelectorAll('div[width="100%"][height="40px"][font-size="14px"][font-weight="600"]');
        for (const el of candidates) {
          if (el.textContent.trim() === '确认') return el;
        }
        const allDivs = document.querySelectorAll('div.sc-bdVaJa');
        for (const div of allDivs) {
          if (div.textContent.trim() === '确认') return div;
        }
        return null;
      },

      // 极速下注: 跳过waitForUIReady和reset，直接 target→input→confirm
      async executeBetFast(target, amount) {
        const targetBtn = this.findBetButton(target);
        if (!targetBtn) return { success: false, reason: '未找到目标按钮(' + (TARGET_TEXT[target] || target) + ')' };
        targetBtn.click();
        await delay(STEP_DELAY_V2);

        const input = this.findAmountInput();
        if (!input) return { success: false, reason: '未找到金额输入框' };

        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        ).set;
        nativeSetter.call(input, String(amount));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        const tracker = input._valueTracker;
        if (tracker) {
          tracker.setValue('');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await delay(STEP_DELAY_V2);

        const confirmBtn = this.findConfirmButton();
        if (!confirmBtn) return { success: false, reason: '未找到确认按钮' };
        confirmBtn.click();
        await delay(POST_CONFIRM_V2);

        return { success: true };
      }
    };

    // ==================== WS客户端 (同v1) ====================
    const WSClient = {
      ws: null,
      connected: false,
      latestBlock: null,
      blocks: [],
      listeners: [],
      reconnectTimer: null,
      reconnectDelay: 1000,

      connect() {
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
        try {
          this.ws = new WebSocket(WS_URL);
          this.ws.onopen = () => {
            this.connected = true;
            this.reconnectDelay = 1000;
            if (panel) { panel.addLog('WS v2 连接已建立'); panel.update(); }
          };
          this.ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'connected') return;
              if (data.height && data.hash) {
                this.latestBlock = data;
                this.blocks.unshift(data);
                if (this.blocks.length > 200) this.blocks = this.blocks.slice(0, 200);
                this.listeners.forEach(fn => { try { fn(data); } catch (e) { /* ignore */ } });
              }
            } catch (e) { /* ignore */ }
          };
          this.ws.onclose = () => {
            this.connected = false;
            if (panel) panel.update();
            this.reconnectTimer = setTimeout(() => {
              this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 10000);
              this.connect();
            }, this.reconnectDelay);
          };
          this.ws.onerror = () => { this.connected = false; };
        } catch (e) {
          this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
        }
      },

      onBlock(fn) { this.listeners.push(fn); }
    };

    // ==================== v2 下注接收器 ====================
    const RealBetReceiverV2 = {
      queue: [],
      processing: false,
      results: [],
      totalExecuted: 0,
      totalSuccess: 0,
      totalFailed: 0,

      init() {
        document.addEventListener('haxi-real-bet-v2', (e) => {
          const cmd = e.detail;
          if (!cmd || !cmd.target || !cmd.amount) return;
          this._enqueue(cmd);
        });

        document.addEventListener('haxi-query-balance-v2', () => {
          const balance = this.readRealBalance();
          document.dispatchEvent(new CustomEvent('haxi-balance-result-v2', {
            detail: { balance, timestamp: Date.now() }
          }));
        });

        console.log('[HAXI执行器 v2] 下注接收器启动 (WS触发模式)');
        if (panel) panel.addLog('v2 执行器就绪 (WS触发模式)');
      },

      _enqueue(cmd) {
        this.queue.push(cmd);
        if (panel) panel.addLog(`[队列+] ${TARGET_TEXT[cmd.target]} ¥${cmd.amount} ${cmd.taskName || ''}`);
        this._processQueue();
      },

      readRealBalance() {
        const span = document.querySelector('span.jwlTOs');
        if (span) {
          const val = parseFloat(span.textContent.trim());
          if (!isNaN(val)) return val;
        }
        const containers = document.querySelectorAll('.fQggfv, .sc-Rmtcm');
        for (const c of containers) {
          const spans = c.querySelectorAll('span');
          for (const s of spans) {
            const text = s.textContent.trim();
            if (/^\d+\.?\d*$/.test(text)) {
              const val = parseFloat(text);
              if (!isNaN(val)) return val;
            }
          }
        }
        return null;
      },

      // 等待WS确认指定区块的结果
      _waitForWSBlock(targetBlock, timeoutMs) {
        return new Promise(resolve => {
          let done = false;
          let timeoutId, wsListener;

          const finish = (success) => {
            if (done) return;
            done = true;
            clearTimeout(timeoutId);
            const idx = WSClient.listeners.indexOf(wsListener);
            if (idx !== -1) WSClient.listeners.splice(idx, 1);
            resolve(success);
          };

          // 检查是否WS已经有该区块数据
          const existing = WSClient.blocks.find(b => b.height === targetBlock);
          if (existing) { resolve(true); return; }

          wsListener = (data) => {
            if (data.height === targetBlock) finish(true);
            else if (data.height > targetBlock) finish(false); // 跳过了目标区块
          };
          WSClient.listeners.push(wsListener);

          timeoutId = setTimeout(() => finish(false), timeoutMs);
        });
      },

      // v2 executeOne: 当currentBlock < targetBlock时，等WS收到(targetBlock-1)再投注
      async executeOne(cmd) {
        const t0 = Date.now();

        if (cmd.blockHeight) {
          const currentBlock = SiteAdapter.getCurrentBlock();
          if (currentBlock !== null) {
            if (currentBlock > cmd.blockHeight) {
              const reason = `区块${cmd.blockHeight}已过(当前${currentBlock})，投注失败`;
              return this._buildFailResult(cmd, reason, 0);
            }

            if (currentBlock < cmd.blockHeight) {
              // v2核心逻辑: 等待(targetBlock-1)的WS结果到达，说明下注窗口已开
              const prevBlock = cmd.blockHeight - 1;
              if (panel) panel.addLog(`[v2等待] 等待区块${prevBlock}结果...`);
              const triggered = await this._waitForWSBlock(prevBlock, 30000);
              if (!triggered) {
                const reason = `等待区块${prevBlock}超时/已过，投注失败`;
                return this._buildFailResult(cmd, reason, Date.now() - t0);
              }
              if (panel) panel.addLog(`[v2触发] 区块${prevBlock}已确认，极速投注`);
            }
            // currentBlock === targetBlock: 直接投注
          }
        }

        // 极速下注 (跳过waitForUIReady和reset)
        const result = await SiteAdapter.executeBetFast(cmd.target, cmd.amount);
        const elapsed = Date.now() - t0;

        this.totalExecuted++;
        if (result.success) this.totalSuccess++;
        else this.totalFailed++;

        const betResult = {
          taskId: cmd.taskId,
          taskName: cmd.taskName,
          blockHeight: cmd.blockHeight ?? SiteAdapter.getCurrentBlock(),
          target: cmd.target,
          amount: cmd.amount,
          ruleId: cmd.ruleId,
          success: result.success,
          reason: result.reason || '',
          elapsed,
          timestamp: Date.now(),
          balanceAfter: this.readRealBalance()
        };

        this.results.unshift(betResult);
        if (this.results.length > 50) this.results = this.results.slice(0, 50);

        const targetLabel = TARGET_TEXT[cmd.target] || cmd.target;
        if (result.success) {
          if (panel) panel.addLog(`[成功] ${targetLabel} ¥${cmd.amount} [${elapsed}ms]`);
        } else {
          if (panel) panel.addLog(`[失败] ${targetLabel} ¥${cmd.amount}: ${result.reason}`);
        }
        if (panel) panel.update();
        return betResult;
      },

      _buildFailResult(cmd, reason, elapsed) {
        const failResult = {
          taskId: cmd.taskId, taskName: cmd.taskName, blockHeight: cmd.blockHeight,
          target: cmd.target, amount: cmd.amount, ruleId: cmd.ruleId,
          success: false, reason, elapsed, timestamp: Date.now(), balanceAfter: null
        };
        this.totalExecuted++; this.totalFailed++;
        this.results.unshift(failResult);
        if (this.results.length > 50) this.results = this.results.slice(0, 50);
        if (panel) panel.addLog(`[跳过] ${reason}`);
        if (panel) panel.update();
        return failResult;
      },

      async _processQueue() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;
        while (this.queue.length > 0) {
          const cmd = this.queue.shift();
          try {
            const betResult = await this.executeOne(cmd);
            document.dispatchEvent(new CustomEvent('haxi-bet-result-v2', { detail: betResult }));
          } catch (err) {
            this.totalExecuted++; this.totalFailed++;
            const failResult = { taskId: cmd.taskId, blockHeight: cmd.blockHeight, target: cmd.target, amount: cmd.amount, success: false, reason: err.message, timestamp: Date.now() };
            document.dispatchEvent(new CustomEvent('haxi-bet-result-v2', { detail: failResult }));
            if (panel) panel.addLog(`[异常] ${err.message}`);
          }
          if (this.queue.length > 0) await delay(20);
        }
        this.processing = false;
      }
    };

    // ==================== Chrome消息处理 ====================
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'EXECUTE_BET_V2') {
        const cmd = message.detail;
        if (panel) panel.addLog(`[跨页v2] ${TARGET_TEXT[cmd.target]} ¥${cmd.amount} ${cmd.taskName || ''}`);
        RealBetReceiverV2.executeOne(cmd).then(result => {
          sendResponse(result);
        }).catch(err => {
          sendResponse({
            success: false, reason: err.message,
            taskId: cmd.taskId, taskName: cmd.taskName,
            blockHeight: cmd.blockHeight, ruleId: cmd.ruleId,
            target: cmd.target, amount: cmd.amount, timestamp: Date.now()
          });
        });
        return true;
      }

      if (message.type === 'QUERY_READY') {
        sendResponse({ ready: true, version: 'v2', currentBlock: SiteAdapter.getCurrentBlock(), balance: RealBetReceiverV2.readRealBalance() });
        return true;
      }
    });

    // ==================== 状态面板 (橙色主题) ====================
    class StatusPanelV2 {
      constructor() {
        this.logs = [];
        this.minimized = false;
        this.container = null;
        this.currentPageBlock = null;
      }

      create() {
        if (this.container) return;
        const style = document.createElement('style');
        style.textContent = `
          .haxi-panel-v2 {
            position: fixed; top: 20px; left: 20px; width: 300px; max-height: 80vh;
            background: #0f172a; border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(245,158,11,0.3);
            z-index: 999998;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
            font-size: 13px; color: #e2e8f0; overflow: hidden;
          }
          .haxi-header-v2 {
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 14px;
            background: linear-gradient(135deg, #d97706, #b45309);
            cursor: move; user-select: none;
          }
          .haxi-header-left-v2 { display: flex; align-items: center; gap: 8px; }
          .haxi-title-v2 { font-size: 13px; font-weight: 800; color: white; }
          .haxi-version-v2 { font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.9); background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 10px; }
          .haxi-dot-v2 { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
          .haxi-dot-idle-v2 { background: #94a3b8; }
          .haxi-dot-active-v2 { background: #fbbf24; box-shadow: 0 0 8px #fbbf24; animation: haxi-pulse-v2 1.5s infinite; }
          @keyframes haxi-pulse-v2 { 0%,100%{opacity:1}50%{opacity:0.5} }
          .haxi-btn-v2 { width: 24px; height: 24px; border: none; border-radius: 6px; background: rgba(255,255,255,0.15); color: white; font-size: 16px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; }
          .haxi-btn-v2:hover { background: rgba(255,255,255,0.3); }
          .haxi-body-v2 { padding: 10px; overflow-y: auto; max-height: calc(80vh - 46px); }
          .haxi-body-v2::-webkit-scrollbar { width: 3px; }
          .haxi-body-v2::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
          .haxi-grid-v2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; }
          .haxi-card-v2 { background: #1e293b; border-radius: 10px; padding: 8px 10px; border: 1px solid #334155; }
          .haxi-label-v2 { font-size: 10px; font-weight: 600; color: #64748b; text-transform: uppercase; }
          .haxi-value-v2 { font-size: 13px; font-weight: 800; color: #e0e7ff; margin-top: 2px; }
          .haxi-bar-v2 { display: flex; gap: 6px; margin-bottom: 10px; }
          .haxi-stat-v2 { flex: 1; text-align: center; background: #1e293b; border-radius: 8px; padding: 6px 4px; border: 1px solid #334155; }
          .haxi-stat-num-v2 { font-size: 16px; font-weight: 800; }
          .haxi-stat-label-v2 { font-size: 9px; font-weight: 600; color: #64748b; text-transform: uppercase; }
          .haxi-section-v2 { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 6px; }
          .haxi-list-v2 { background: #1e293b; border-radius: 10px; padding: 4px; max-height: 140px; overflow-y: auto; margin-bottom: 10px; border: 1px solid #334155; }
          .haxi-list-v2::-webkit-scrollbar { width: 3px; }
          .haxi-list-v2::-webkit-scrollbar-thumb { background: #475569; border-radius: 2px; }
          .haxi-bet-row-v2 { display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; font-size: 11px; font-weight: 600; border-bottom: 1px solid #0f172a; }
          .haxi-bet-row-v2:last-child { border-bottom: none; }
          .haxi-ok-v2 { color: #22c55e; font-weight: 800; }
          .haxi-fail-v2 { color: #ef4444; font-weight: 800; }
          .haxi-log-v2 { background: #1e293b; border-radius: 10px; padding: 4px; max-height: 100px; overflow-y: auto; border: 1px solid #334155; }
          .haxi-log-v2::-webkit-scrollbar { width: 3px; }
          .haxi-log-v2::-webkit-scrollbar-thumb { background: #475569; border-radius: 2px; }
          .haxi-log-item-v2 { font-size: 10px; color: #94a3b8; padding: 2px 6px; }
        `;
        document.head.appendChild(style);

        const gameType = detectGameType();
        const gameLabel = gameType === 'PARITY' ? '单双' : gameType === 'SIZE' ? '大小' : '?';

        const el = document.createElement('div');
        el.id = 'haxi-panel-v2';
        el.className = 'haxi-panel-v2';
        el.innerHTML = `
          <div class="haxi-header-v2" id="haxi-drag-v2">
            <div class="haxi-header-left-v2">
              <span class="haxi-dot-v2 haxi-dot-idle-v2" id="haxi-dot-v2"></span>
              <span class="haxi-title-v2">HAXI 执行器 v2</span>
              <span class="haxi-version-v2">WS触发 ${gameLabel}</span>
            </div>
            <div style="display:flex;gap:4px">
              <button class="haxi-btn-v2" id="haxi-min-v2" title="最小化">−</button>
              <button class="haxi-btn-v2" id="haxi-close-v2" title="关闭" style="background:rgba(255,255,255,0.15)">×</button>
            </div>
          </div>
          <div class="haxi-body-v2" id="haxi-body-v2">
            <div class="haxi-grid-v2">
              <div class="haxi-card-v2"><div class="haxi-label-v2">下注区块</div><div class="haxi-value-v2" id="haxi-block-v2">--</div></div>
              <div class="haxi-card-v2"><div class="haxi-label-v2">平台余额</div><div class="haxi-value-v2" id="haxi-bal-v2" style="color:#fbbf24">--</div></div>
              <div class="haxi-card-v2"><div class="haxi-label-v2">执行速度</div><div class="haxi-value-v2" id="haxi-speed-v2" style="color:#fb923c">--</div></div>
              <div class="haxi-card-v2"><div class="haxi-label-v2">数据源</div><div class="haxi-value-v2" id="haxi-ws-v2">等待</div></div>
            </div>
            <div class="haxi-bar-v2">
              <div class="haxi-stat-v2"><div class="haxi-stat-num-v2" id="haxi-total-v2" style="color:#a5b4fc">0</div><div class="haxi-stat-label-v2">已执行</div></div>
              <div class="haxi-stat-v2"><div class="haxi-stat-num-v2" id="haxi-ok-v2" style="color:#22c55e">0</div><div class="haxi-stat-label-v2">成功</div></div>
              <div class="haxi-stat-v2"><div class="haxi-stat-num-v2" id="haxi-fail-v2" style="color:#ef4444">0</div><div class="haxi-stat-label-v2">失败</div></div>
              <div class="haxi-stat-v2"><div class="haxi-stat-num-v2" id="haxi-queue-v2" style="color:#fbbf24">0</div><div class="haxi-stat-label-v2">队列</div></div>
            </div>
            <div class="haxi-section-v2">最近执行</div>
            <div class="haxi-list-v2" id="haxi-bets-v2"></div>
            <div class="haxi-section-v2" style="margin-top:10px">运行日志</div>
            <div class="haxi-log-v2" id="haxi-logs-v2"></div>
          </div>
        `;
        document.body.appendChild(el);
        this.container = el;
        this._bindEvents();
        this._makeDraggable();
        this.update();
      }

      _bindEvents() {
        document.getElementById('haxi-min-v2').onclick = () => {
          this.minimized = !this.minimized;
          document.getElementById('haxi-body-v2').style.display = this.minimized ? 'none' : 'block';
          document.getElementById('haxi-min-v2').textContent = this.minimized ? '+' : '−';
        };
        document.getElementById('haxi-close-v2').onclick = () => {
          this.container.style.display = 'none';
        };
      }

      _makeDraggable() {
        const handle = document.getElementById('haxi-drag-v2');
        const panelEl = this.container;
        let startX, startY, startLeft, startTop;
        handle.addEventListener('mousedown', (e) => {
          if (e.target.tagName === 'BUTTON') return;
          startX = e.clientX; startY = e.clientY;
          const rect = panelEl.getBoundingClientRect();
          startLeft = rect.left; startTop = rect.top;
          const onMove = (ev) => {
            panelEl.style.left = (startLeft + ev.clientX - startX) + 'px';
            panelEl.style.top = (startTop + ev.clientY - startY) + 'px';
            panelEl.style.right = 'auto';
          };
          const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      }

      addLog(msg) {
        const ts = new Date().toLocaleTimeString('zh-CN');
        this.logs.unshift(`${ts} ${msg}`);
        if (this.logs.length > 100) this.logs = this.logs.slice(0, 100);
        this.update();
      }

      update() {
        if (!this.container || this.minimized) return;

        const block = this.currentPageBlock || SiteAdapter.getCurrentBlock();
        const blockEl = document.getElementById('haxi-block-v2');
        if (blockEl) blockEl.textContent = block || '--';

        const balEl = document.getElementById('haxi-bal-v2');
        if (balEl) {
          const bal = RealBetReceiverV2.readRealBalance();
          balEl.textContent = bal !== null ? bal.toFixed(2) : '--';
        }

        const speedEl = document.getElementById('haxi-speed-v2');
        if (speedEl) {
          const recent = RealBetReceiverV2.results.filter(r => r.elapsed > 0).slice(0, 5);
          if (recent.length > 0) {
            const avg = Math.round(recent.reduce((s, r) => s + r.elapsed, 0) / recent.length);
            speedEl.textContent = `${avg}ms`;
          } else {
            speedEl.textContent = '--';
          }
        }

        const wsEl = document.getElementById('haxi-ws-v2');
        if (wsEl) wsEl.textContent = WSClient.connected ? 'WS实时' : '重连中';

        const dotEl = document.getElementById('haxi-dot-v2');
        if (dotEl) dotEl.className = 'haxi-dot-v2 ' + (WSClient.connected ? 'haxi-dot-active-v2' : 'haxi-dot-idle-v2');

        const totalEl = document.getElementById('haxi-total-v2');
        if (totalEl) totalEl.textContent = RealBetReceiverV2.totalExecuted;
        const okEl = document.getElementById('haxi-ok-v2');
        if (okEl) okEl.textContent = RealBetReceiverV2.totalSuccess;
        const failEl = document.getElementById('haxi-fail-v2');
        if (failEl) failEl.textContent = RealBetReceiverV2.totalFailed;
        const queueEl = document.getElementById('haxi-queue-v2');
        if (queueEl) queueEl.textContent = RealBetReceiverV2.queue.length;

        const betsEl = document.getElementById('haxi-bets-v2');
        if (betsEl) {
          const items = RealBetReceiverV2.results.slice(0, 15);
          if (items.length === 0) {
            betsEl.innerHTML = '<div class="haxi-log-item-v2" style="text-align:center;color:#475569">等待下注命令...</div>';
          } else {
            betsEl.innerHTML = items.map(b => {
              const lbl = TARGET_TEXT[b.target] || b.target;
              const badge = b.success ? '<span class="haxi-ok-v2">OK</span>' : '<span class="haxi-fail-v2">FAIL</span>';
              const ts = new Date(b.timestamp).toLocaleTimeString('zh-CN');
              return `<div class="haxi-bet-row-v2"><span style="color:#a5b4fc">${lbl}</span><span style="color:#fbbf24;font-family:monospace">¥${b.amount}</span><span style="color:#64748b;font-size:10px;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.taskName||''}</span>${badge}<span style="color:#475569;font-size:10px;font-family:monospace">${b.elapsed}ms ${ts}</span></div>`;
            }).join('');
          }
        }

        const logsEl = document.getElementById('haxi-logs-v2');
        if (logsEl) {
          logsEl.innerHTML = this.logs.slice(0, 30).map(l => `<div class="haxi-log-item-v2">${l}</div>`).join('');
        }
      }
    }

    // ==================== 区块监控 ====================
    function startBlockMonitorV2() {
      const updateStatus = () => {
        const b = SiteAdapter.getCurrentBlock();
        if (panel) { panel.currentPageBlock = b; panel.update(); }
      };
      WSClient.onBlock(() => updateStatus());
      setInterval(updateStatus, 2000);
    }

    // ==================== 初始化 ====================
    let panel = null;

    function loadApiUrlV2() {
      return new Promise(resolve => {
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ type: 'GET_API_URL' }, (response) => {
              if (response && response.apiUrl) {
                API_URL = response.apiUrl;
                try {
                  const u = new URL(API_URL);
                  WS_URL = `ws://${u.hostname}:8080`;
                } catch (e) { /* keep default */ }
              }
              resolve();
            });
          } else { resolve(); }
        } catch (e) { resolve(); }
      });
    }

    async function initV2() {
      await loadApiUrlV2();

      let retries = 0;
      const tryInit = () => {
        retries++;
        const gameType = detectGameType();
        const hasInput = !!SiteAdapter.findAmountInput();
        const hasBlock = !!SiteAdapter.getCurrentBlock();

        if (gameType || hasInput || hasBlock || retries >= 20) {
          panel = new StatusPanelV2();
          panel.create();
          WSClient.connect();
          RealBetReceiverV2.init();
          startBlockMonitorV2();
        } else {
          setTimeout(tryInit, 1500);
        }
      };

      setTimeout(tryInit, 2000);
    }

    initV2();
  }

})();
