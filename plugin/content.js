/**
 * ========================================================
 *  哈希游戏下注执行器 - Content Script v5.0
 *  核心原则: 每一笔下注命令必须执行，永不跳过
 *  双模式架构:
 *    游戏页面 → 执行器模式 (SiteAdapter + RealBetReceiver)
 *    前端页面 → 桥接模式 (CustomEvent → chrome.runtime → 游戏标签页)
 * ========================================================
 */
(function () {
  'use strict';

  // ==================== 页面类型检测 ====================
  const hostname = window.location.hostname;
  const isGamePage = hostname.includes('amazonaws.com');
  const isFrontendPage = hostname === 'localhost' || hostname === '127.0.0.1';

  if (isGamePage) {
    initGameExecutor();
  } else if (isFrontendPage) {
    initFrontendBridge();
  }

  // ================================================================
  //  前端页面: 桥接模式
  //  CustomEvent ↔ chrome.runtime.sendMessage ↔ background ↔ 游戏标签页
  // ================================================================
  function initFrontendBridge() {
    console.log('[HAXI Bridge] 前端桥接模式已加载');

    // 前端发送真实下注命令 → 转发到游戏页面
    document.addEventListener('haxi-real-bet', (e) => {
      const cmd = e.detail;
      if (!cmd || !cmd.target || !cmd.amount) return;
      console.log('[HAXI Bridge] 转发下注命令到游戏页面:', cmd);

      chrome.runtime.sendMessage({
        type: 'RELAY_BET',
        detail: cmd
      }, (response) => {
        // 游戏页面执行结果返回 → 派发给前端React
        const result = response || { success: false, reason: '插件通信失败' };
        document.dispatchEvent(new CustomEvent('haxi-bet-result', {
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

    // 前端查询插件就绪状态 → 转发到游戏页面
    document.addEventListener('haxi-query-ready', () => {
      chrome.runtime.sendMessage({ type: 'RELAY_QUERY_READY' }, (response) => {
        document.dispatchEvent(new CustomEvent('haxi-ready-result', {
          detail: response || { ready: false }
        }));
      });
    });

    // 前端查询余额 → 转发到游戏页面
    document.addEventListener('haxi-query-balance', () => {
      chrome.runtime.sendMessage({ type: 'RELAY_QUERY_BALANCE' }, (response) => {
        document.dispatchEvent(new CustomEvent('haxi-balance-result', {
          detail: response || { balance: null, timestamp: Date.now() }
        }));
      });
    });
  }

  // ================================================================
  //  游戏页面: 执行器模式
  //  接收 chrome.runtime 消息 + 本地 CustomEvent, 执行真实下注
  //  v5.0: 永不跳过，失败重试，极速执行
  // ================================================================
  function initGameExecutor() {

    // ==================== 配置常量 ====================
    let API_URL = 'http://localhost:3001';
    let WS_URL = 'ws://localhost:8080';
    const STEP_DELAY = 20;           // 步骤间延迟 (极速: 20ms)
    const POST_CONFIRM_DELAY = 80;   // 确认按钮后等待 (80ms, 够UI重置)
    const MAX_RETRIES = 3;           // 单笔下注失败最大重试次数
    const RETRY_WAIT = 100;          // 重试前等待 (100ms, 等UI恢复)
    const UI_READY_TIMEOUT = 800;    // 等待UI就绪最大时间 (800ms)
    const UI_READY_POLL = 15;        // UI就绪检测轮询间隔 (15ms)

    const TARGET_TEXT = { ODD: '单', EVEN: '双', BIG: '大', SMALL: '小' };

    // ==================== 区块追踪 (仅面板显示用) ====================
    let lastKnownBlock = 0;

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

    // ==================== DOM适配器 ====================
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
          if (btn.textContent.trim() === targetText) {
            const parent = btn.parentElement;
            if (parent && parent.getAttribute('height') === '110px') return parent;
            return btn;
          }
        }

        const colorAttr = (target === 'ODD' || target === 'BIG') ? '#24b3a2' : '#ff3636';
        const colorBtns = document.querySelectorAll(`div[color="${colorAttr}"][font-size="40px"]`);
        for (const btn of colorBtns) {
          if (btn.textContent.trim() === targetText) {
            const parent = btn.parentElement;
            if (parent && parent.getAttribute('height') === '110px') return parent;
            return btn;
          }
        }
        return null;
      },

      findAmountInput() {
        return document.querySelector('input[placeholder="输入金额"]');
      },

      findConfirmButton() {
        const spans = document.querySelectorAll('span[color="white"][font-size="14px"]');
        for (const s of spans) {
          if (s.textContent.trim() === '确定') return s.parentElement || s;
        }
        const byClass = document.querySelector('span.NYRcS');
        if (byClass && byClass.textContent.trim() === '确定') return byClass.parentElement || byClass;
        const allSpans = document.querySelectorAll('span.sc-gzVnrw');
        for (const s of allSpans) {
          if (s.textContent.trim() === '确定') return s.parentElement || s;
        }
        return null;
      },

      findResetButton() {
        const divs = document.querySelectorAll('div[width="80px"][color="#6476a0"]');
        for (const div of divs) {
          if (div.textContent.trim() === '重置') return div;
        }
        const byClass = document.querySelector('.cYwdS');
        if (byClass && byClass.textContent.trim() === '重置') return byClass;
        const allDivs = document.querySelectorAll('div[style*="cursor"]');
        for (const div of allDivs) {
          if (div.textContent.trim() === '重置') return div;
        }
        return null;
      },

      // 核心下注方法 (带重试: 永不放弃)
      async executeBet(target, amount) {
        let lastError = '';

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          const result = await this._singleAttempt(target, amount);
          if (result.success) {
            return result;
          }
          lastError = result.reason;
          if (panel) panel.addLog(`[重试${attempt}/${MAX_RETRIES}] ${lastError}`);

          // 最后一次失败不等待
          if (attempt < MAX_RETRIES) {
            await delay(RETRY_WAIT);
          }
        }

        return { success: false, reason: `${MAX_RETRIES}次均失败: ${lastError}` };
      },

      // 单次下注尝试 (快速执行: ~240ms)
      async _singleAttempt(target, amount) {
        // 等待UI就绪
        const uiReady = await this._waitForUIReady();
        if (!uiReady) return { success: false, reason: 'UI未就绪(输入框/确认按钮不存在)' };

        // 1. 重置
        const resetBtn = this.findResetButton();
        if (resetBtn) {
          resetBtn.click();
          await delay(STEP_DELAY);
        }

        // 2. 点击目标 (单/双/大/小)
        const targetBtn = this.findBetButton(target);
        if (!targetBtn) return { success: false, reason: '未找到目标按钮(' + (TARGET_TEXT[target] || target) + ')' };
        targetBtn.click();
        await delay(STEP_DELAY);

        // 3. 输入金额
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
        await delay(STEP_DELAY);

        // 4. 确认
        const confirmBtn = this.findConfirmButton();
        if (!confirmBtn) return { success: false, reason: '未找到确认按钮' };
        confirmBtn.click();
        await delay(POST_CONFIRM_DELAY);

        return { success: true };
      },

      // 等待游戏UI就绪 (输入框 + 确认按钮可用)
      // v5.1优化: 先做立即检测，减少不必要的轮询等待
      async _waitForUIReady() {
        // 立即检测：若UI已就绪直接返回（省去任何等待）
        const inputNow = this.findAmountInput();
        const confirmNow = this.findConfirmButton();
        if (inputNow && confirmNow) return true;

        const start = Date.now();
        while (Date.now() - start < UI_READY_TIMEOUT) {
          await delay(UI_READY_POLL);
          const input = this.findAmountInput();
          const confirm = this.findConfirmButton();
          if (input && confirm) return true;
        }
        return false;
      },

      isGameReady() {
        return !!(this.findAmountInput() || this.getCurrentBlock());
      }
    };

    // ==================== WebSocket实时客户端 ====================
    const WSClient = {
      ws: null,
      connected: false,
      latestBlock: null,
      blocks: [],
      listeners: [],
      reconnectTimer: null,
      reconnectDelay: 1000,

      connect() {
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
          return;
        }

        try {
          console.log('[HAXI执行器] 连接WebSocket:', WS_URL);
          this.ws = new WebSocket(WS_URL);

          this.ws.onopen = () => {
            this.connected = true;
            this.reconnectDelay = 1000;
            console.log('[HAXI执行器] WebSocket已连接');
            if (panel) {
              panel.addLog('WS实时连接已建立');
              panel.update();
            }
          };

          this.ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'connected') return;

              if (data.height && data.hash) {
                this.latestBlock = data;
                this.blocks.unshift(data);
                if (this.blocks.length > 200) this.blocks = this.blocks.slice(0, 200);

                this.listeners.forEach(fn => {
                  try { fn(data); } catch (e) { /* ignore */ }
                });
              }
            } catch (e) { /* ignore parse errors */ }
          };

          this.ws.onclose = () => {
            this.connected = false;
            if (panel) panel.update();
            this.reconnectTimer = setTimeout(() => {
              this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 10000);
              this.connect();
            }, this.reconnectDelay);
          };

          this.ws.onerror = () => {
            this.connected = false;
          };
        } catch (e) {
          console.warn('[HAXI执行器] WebSocket连接失败:', e.message);
          this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
        }
      },

      disconnect() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.ws) {
          this.ws.onclose = null;
          this.ws.close();
        }
        this.connected = false;
      },

      onBlock(fn) {
        this.listeners.push(fn);
      }
    };

    // ==================== 真实下注接收器 ====================
    const RealBetReceiver = {
      queue: [],
      processing: false,
      results: [],
      totalExecuted: 0,
      totalSuccess: 0,
      totalFailed: 0,

      init() {
        // 监听本地 CustomEvent (如果前端和游戏在同一页面时的回退)
        document.addEventListener('haxi-real-bet', (e) => {
          const cmd = e.detail;
          if (!cmd || !cmd.target || !cmd.amount) return;
          this._enqueue(cmd);
        });

        // 监听本地余额查询
        document.addEventListener('haxi-query-balance', () => {
          const balance = this.readRealBalance();
          document.dispatchEvent(new CustomEvent('haxi-balance-result', {
            detail: { balance, timestamp: Date.now() }
          }));
        });

        // 监听本地就绪查询
        document.addEventListener('haxi-query-ready', () => {
          document.dispatchEvent(new CustomEvent('haxi-ready-result', {
            detail: {
              ready: true,
              version: '4.3',
              currentBlock: SiteAdapter.getCurrentBlock(),
              balance: this.readRealBalance()
            }
          }));
        });

        console.log('[HAXI执行器] 下注接收器已启动 (v5.0 永不跳过)');
        if (panel) panel.addLog('v5.0 执行器就绪 (永不跳过)');
      },

      _enqueue(cmd) {
        console.log('[HAXI执行器] 收到下注命令:', cmd);
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

      // 等待目标区块到达 (WS监听 + DOM轮询双保险)
      _waitForBlock(targetBlock, timeoutMs) {
        return new Promise(resolve => {
          let done = false;
          let pollId, timeoutId, wsListener;

          const finish = (success) => {
            if (done) return;
            done = true;
            clearInterval(pollId);
            clearTimeout(timeoutId);
            const idx = WSClient.listeners.indexOf(wsListener);
            if (idx !== -1) WSClient.listeners.splice(idx, 1);
            resolve(success);
          };

          // WS事件监听 (首选, 最快响应)
          wsListener = (data) => {
            if (data.height === targetBlock) finish(true);
            else if (data.height > targetBlock) finish(false); // 已跳过目标区块
          };
          WSClient.listeners.push(wsListener);

          // DOM轮询备用 (每200ms)
          pollId = setInterval(() => {
            const b = SiteAdapter.getCurrentBlock();
            if (b === null) return;
            if (b === targetBlock) finish(true);
            else if (b > targetBlock) finish(false);
          }, 200);

          // 超时兜底
          timeoutId = setTimeout(() => finish(false), timeoutMs);
        });
      },

      // 执行单笔下注 (含重试)
      async executeOne(cmd) {
        // 区块高度验证 (支持等待下一个区块)
        if (cmd.blockHeight) {
          const currentBlock = SiteAdapter.getCurrentBlock();
          if (currentBlock !== null) {
            if (currentBlock > cmd.blockHeight) {
              // 已经过了目标区块，直接失败
              const reason = `区块${cmd.blockHeight}已过(当前${currentBlock})，投注失败`;
              const failResult = { taskId: cmd.taskId, taskName: cmd.taskName, blockHeight: cmd.blockHeight, target: cmd.target, amount: cmd.amount, ruleId: cmd.ruleId, success: false, reason, elapsed: 0, timestamp: Date.now(), balanceAfter: null };
              this.totalExecuted++; this.totalFailed++;
              this.results.unshift(failResult);
              if (this.results.length > 50) this.results = this.results.slice(0, 50);
              if (panel) panel.addLog(`[跳过] ${reason}`);
              if (panel) panel.update();
              return failResult;
            } else if (currentBlock < cmd.blockHeight) {
              // 目标区块还未到达，等待
              if (panel) panel.addLog(`[等待] 目标区块${cmd.blockHeight}，当前${currentBlock}，等待中...`);
              const reached = await this._waitForBlock(cmd.blockHeight, 30000);
              if (!reached) {
                const reason = `等待区块${cmd.blockHeight}超时/已过，投注失败`;
                const failResult = { taskId: cmd.taskId, taskName: cmd.taskName, blockHeight: cmd.blockHeight, target: cmd.target, amount: cmd.amount, ruleId: cmd.ruleId, success: false, reason, elapsed: 0, timestamp: Date.now(), balanceAfter: null };
                this.totalExecuted++; this.totalFailed++;
                this.results.unshift(failResult);
                if (this.results.length > 50) this.results = this.results.slice(0, 50);
                if (panel) panel.addLog(`[超时] ${reason}`);
                if (panel) panel.update();
                return failResult;
              }
              if (panel) panel.addLog(`[触发] 区块${cmd.blockHeight}到达，立即投注`);
              // fall through to executeBet
            }
            // currentBlock === cmd.blockHeight: proceed immediately
          }
        }

        const t0 = Date.now();
        const result = await SiteAdapter.executeBet(cmd.target, cmd.amount);
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

      // 队列处理: 逐个执行，永不跳过
      async _processQueue() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;

        while (this.queue.length > 0) {
          const cmd = this.queue.shift();
          try {
            const betResult = await this.executeOne(cmd);

            // 同页面回退: 派发结果给本地前端
            document.dispatchEvent(new CustomEvent('haxi-bet-result', {
              detail: betResult
            }));

          } catch (err) {
            this.totalExecuted++;
            this.totalFailed++;
            console.error('[HAXI执行器] 下注异常:', err);
            document.dispatchEvent(new CustomEvent('haxi-bet-result', {
              detail: {
                taskId: cmd.taskId,
                blockHeight: cmd.blockHeight,
                target: cmd.target,
                amount: cmd.amount,
                success: false,
                reason: err.message,
                timestamp: Date.now()
              }
            }));
            if (panel) panel.addLog(`[异常] ${err.message}`);
          }

          // 多笔排队时，只需极短间隔让UI恢复
          if (this.queue.length > 0) {
            await delay(STEP_DELAY);
          }
        }

        this.processing = false;
      }
    };

    // ==================== Chrome 消息接收 (来自 background.js 的转发) ====================
    // v5.0: 无时间检查，直接执行
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'EXECUTE_BET') {
        const cmd = message.detail;
        console.log('[HAXI执行器] 收到跨标签页下注命令:', cmd);
        if (panel) panel.addLog(`[跨页] ${TARGET_TEXT[cmd.target]} ¥${cmd.amount} ${cmd.taskName || ''}`);

        // 直接执行，不检查时间，不跳过
        RealBetReceiver.executeOne(cmd).then(result => {
          sendResponse(result);
        }).catch(err => {
          sendResponse({
            success: false,
            reason: err.message,
            taskId: cmd.taskId,
            taskName: cmd.taskName,
            blockHeight: cmd.blockHeight,
            ruleId: cmd.ruleId,
            betType: cmd.betType,
            target: cmd.target,
            amount: cmd.amount,
            timestamp: Date.now()
          });
        });
        return true; // 异步响应
      }

      if (message.type === 'QUERY_READY') {
        sendResponse({
          ready: true,
          version: '4.3',
          currentBlock: SiteAdapter.getCurrentBlock(),
          balance: RealBetReceiver.readRealBalance()
        });
      }

      if (message.type === 'QUERY_BALANCE') {
        sendResponse({
          balance: RealBetReceiver.readRealBalance(),
          timestamp: Date.now()
        });
      }
    });

    // ==================== 状态面板 (精简暗色) ====================
    class StatusPanel {
      constructor() {
        this.logs = [];
        this.minimized = false;
        this.container = null;
        this.currentPageBlock = null;
      }

      create() {
        if (this.container) return;

        const style = document.createElement('style');
        style.textContent = this._buildCSS();
        document.head.appendChild(style);

        const el = document.createElement('div');
        el.id = 'haxi-autobet-panel';
        el.className = 'haxi-panel';
        el.innerHTML = this._buildHTML();
        document.body.appendChild(el);
        this.container = el;
        this._bindEvents();
        this._makeDraggable();
        this.update();
      }

      _buildCSS() {
        return `
          .haxi-panel {
            position: fixed; top: 20px; right: 20px; width: 300px; max-height: 80vh;
            background: #0f172a; border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(99,102,241,0.3);
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
            font-size: 13px; color: #e2e8f0; overflow: hidden;
          }
          .haxi-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 14px;
            background: linear-gradient(135deg, #4f46e5, #7c3aed);
            cursor: move; user-select: none;
          }
          .haxi-header-left { display: flex; align-items: center; gap: 8px; }
          .haxi-header-right { display: flex; gap: 4px; }
          .haxi-title { font-size: 13px; font-weight: 800; color: white; letter-spacing: 0.5px; }
          .haxi-version {
            font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.9);
            background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 10px;
          }
          .haxi-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
          .haxi-dot-idle { background: #94a3b8; }
          .haxi-dot-active { background: #22c55e; box-shadow: 0 0 8px #22c55e; animation: haxi-pulse 1.5s infinite; }
          @keyframes haxi-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
          .haxi-btn-icon {
            width: 24px; height: 24px; border: none; border-radius: 6px;
            background: rgba(255,255,255,0.15); color: white; font-size: 16px; font-weight: bold;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            transition: background 0.2s; line-height: 1;
          }
          .haxi-btn-icon:hover { background: rgba(255,255,255,0.3); }
          .haxi-btn-close:hover { background: #ef4444; }
          .haxi-body { padding: 10px; overflow-y: auto; max-height: calc(80vh - 46px); }
          .haxi-body::-webkit-scrollbar { width: 3px; }
          .haxi-body::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
          .haxi-status-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; }
          .haxi-status-card { background: #1e293b; border-radius: 10px; padding: 8px 10px; border: 1px solid #334155; }
          .haxi-status-label { font-size: 10px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px; }
          .haxi-status-value { font-size: 13px; font-weight: 800; color: #e0e7ff; font-family: 'SF Mono', 'Menlo', monospace; margin-top: 2px; }
          .haxi-exec-bar { display: flex; gap: 6px; margin-bottom: 10px; }
          .haxi-exec-stat { flex: 1; text-align: center; background: #1e293b; border-radius: 8px; padding: 6px 4px; border: 1px solid #334155; }
          .haxi-exec-num { font-size: 16px; font-weight: 800; }
          .haxi-exec-label { font-size: 9px; font-weight: 600; color: #64748b; text-transform: uppercase; }
          .haxi-section-title { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; padding-left: 2px; }
          .haxi-bet-list { background: #1e293b; border-radius: 10px; padding: 4px; max-height: 140px; overflow-y: auto; margin-bottom: 10px; border: 1px solid #334155; }
          .haxi-bet-list::-webkit-scrollbar { width: 3px; }
          .haxi-bet-list::-webkit-scrollbar-thumb { background: #475569; border-radius: 2px; }
          .haxi-bet-item { display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; font-size: 11px; font-weight: 600; border-bottom: 1px solid #0f172a; }
          .haxi-bet-item:last-child { border-bottom: none; }
          .haxi-bet-target { color: #a5b4fc; }
          .haxi-bet-amount { color: #fbbf24; font-family: monospace; }
          .haxi-bet-task { color: #64748b; font-size: 10px; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .haxi-bet-ok { color: #22c55e; font-weight: 800; }
          .haxi-bet-fail { color: #ef4444; font-weight: 800; }
          .haxi-bet-time { color: #475569; font-size: 10px; font-family: monospace; }
          .haxi-log-list { background: #1e293b; border-radius: 10px; padding: 4px; max-height: 100px; overflow-y: auto; border: 1px solid #334155; }
          .haxi-log-list::-webkit-scrollbar { width: 3px; }
          .haxi-log-list::-webkit-scrollbar-thumb { background: #475569; border-radius: 2px; }
          .haxi-log-item { font-size: 10px; color: #94a3b8; padding: 2px 6px; }
          .haxi-log-ts { color: #475569; margin-right: 4px; font-family: monospace; }
          @media (max-width: 768px) { .haxi-panel { width: 280px; right: 10px; top: 10px; } }
        `;
      }

      _buildHTML() {
        const gameType = detectGameType();
        const gameLabel = gameType === 'PARITY' ? '单双' : gameType === 'SIZE' ? '大小' : '?';

        return `
          <div class="haxi-header" id="haxi-drag-handle">
            <div class="haxi-header-left">
              <span class="haxi-dot haxi-dot-idle" id="haxi-status-dot"></span>
              <span class="haxi-title">HAXI 执行器</span>
              <span class="haxi-version">v5.0 ${gameLabel}</span>
            </div>
            <div class="haxi-header-right">
              <button class="haxi-btn-icon" id="haxi-btn-minimize" title="最小化">−</button>
              <button class="haxi-btn-icon haxi-btn-close" id="haxi-btn-close" title="关闭">×</button>
            </div>
          </div>

          <div class="haxi-body" id="haxi-body">
            <div class="haxi-status-grid">
              <div class="haxi-status-card">
                <div class="haxi-status-label">下注区块</div>
                <div class="haxi-status-value" id="haxi-page-block">--</div>
              </div>
              <div class="haxi-status-card">
                <div class="haxi-status-label">平台余额</div>
                <div class="haxi-status-value" id="haxi-real-balance" style="color:#fbbf24">--</div>
              </div>
              <div class="haxi-status-card">
                <div class="haxi-status-label">执行速度</div>
                <div class="haxi-status-value" id="haxi-avg-speed" style="color:#38bdf8">--</div>
              </div>
              <div class="haxi-status-card">
                <div class="haxi-status-label">数据源</div>
                <div class="haxi-status-value" id="haxi-ws-status">等待</div>
              </div>
            </div>

            <div class="haxi-exec-bar">
              <div class="haxi-exec-stat">
                <div class="haxi-exec-num" id="haxi-exec-total" style="color:#a5b4fc">0</div>
                <div class="haxi-exec-label">已执行</div>
              </div>
              <div class="haxi-exec-stat">
                <div class="haxi-exec-num" id="haxi-exec-ok" style="color:#22c55e">0</div>
                <div class="haxi-exec-label">成功</div>
              </div>
              <div class="haxi-exec-stat">
                <div class="haxi-exec-num" id="haxi-exec-fail" style="color:#ef4444">0</div>
                <div class="haxi-exec-label">失败</div>
              </div>
              <div class="haxi-exec-stat">
                <div class="haxi-exec-num" id="haxi-exec-queue" style="color:#fbbf24">0</div>
                <div class="haxi-exec-label">队列</div>
              </div>
            </div>

            <div class="haxi-section-title">最近执行</div>
            <div class="haxi-bet-list" id="haxi-bet-list"></div>

            <div class="haxi-section-title">运行日志</div>
            <div class="haxi-log-list" id="haxi-log-list"></div>
          </div>
        `;
      }

      _bindEvents() {
        const $ = (id) => document.getElementById(id);
        $('haxi-btn-minimize').onclick = () => {
          this.minimized = !this.minimized;
          $('haxi-body').style.display = this.minimized ? 'none' : 'block';
          $('haxi-btn-minimize').textContent = this.minimized ? '+' : '−';
        };
        $('haxi-btn-close').onclick = () => {
          this.container.style.display = 'none';
        };
      }

      _makeDraggable() {
        const handle = document.getElementById('haxi-drag-handle');
        const panelEl = this.container;
        let startX, startY, startLeft, startTop;
        handle.addEventListener('mousedown', (e) => {
          if (e.target.tagName === 'BUTTON') return;
          startX = e.clientX; startY = e.clientY;
          const rect = panelEl.getBoundingClientRect();
          startLeft = rect.left; startTop = rect.top;
          const onMove = (e2) => {
            panelEl.style.left = (startLeft + e2.clientX - startX) + 'px';
            panelEl.style.top = (startTop + e2.clientY - startY) + 'px';
            panelEl.style.right = 'auto';
          };
          const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      }

      addLog(msg) {
        const ts = new Date().toLocaleTimeString('zh-CN');
        this.logs.unshift({ ts, msg });
        if (this.logs.length > 50) this.logs = this.logs.slice(0, 50);
        this._renderLogs();
      }

      _renderLogs() {
        const el = document.getElementById('haxi-log-list');
        if (!el) return;
        el.innerHTML = this.logs.slice(0, 15).map(l =>
          `<div class="haxi-log-item"><span class="haxi-log-ts">${l.ts}</span>${l.msg}</div>`
        ).join('');
      }

      update() {
        const $ = (id) => document.getElementById(id);

        if ($('haxi-page-block')) {
          const block = this.currentPageBlock || SiteAdapter.getCurrentBlock();
          $('haxi-page-block').textContent = block ? block.toString() : '--';
        }
        if ($('haxi-avg-speed')) {
          // 计算最近10笔平均执行速度
          const recent = RealBetReceiver.results.slice(0, 10).filter(r => r.success);
          if (recent.length > 0) {
            const avg = Math.round(recent.reduce((s, r) => s + r.elapsed, 0) / recent.length);
            $('haxi-avg-speed').textContent = `${avg}ms`;
            $('haxi-avg-speed').style.color = avg < 300 ? '#22c55e' : avg < 600 ? '#fbbf24' : '#ef4444';
          } else {
            $('haxi-avg-speed').textContent = '--';
          }
        }
        if ($('haxi-ws-status')) {
          if (WSClient.connected) {
            $('haxi-ws-status').textContent = 'WS实时';
            $('haxi-ws-status').style.color = '#22c55e';
          } else {
            $('haxi-ws-status').textContent = '断开';
            $('haxi-ws-status').style.color = '#ef4444';
          }
        }
        if ($('haxi-real-balance')) {
          const rb = RealBetReceiver.readRealBalance();
          $('haxi-real-balance').textContent = rb !== null ? rb.toFixed(2) : '--';
        }
        if ($('haxi-status-dot')) {
          $('haxi-status-dot').className = 'haxi-dot ' + (WSClient.connected ? 'haxi-dot-active' : 'haxi-dot-idle');
        }
        if ($('haxi-exec-total')) $('haxi-exec-total').textContent = RealBetReceiver.totalExecuted;
        if ($('haxi-exec-ok')) $('haxi-exec-ok').textContent = RealBetReceiver.totalSuccess;
        if ($('haxi-exec-fail')) $('haxi-exec-fail').textContent = RealBetReceiver.totalFailed;
        if ($('haxi-exec-queue')) $('haxi-exec-queue').textContent = RealBetReceiver.queue.length;

        const betListEl = $('haxi-bet-list');
        if (betListEl) {
          const items = RealBetReceiver.results.slice(0, 15);
          if (items.length === 0) {
            betListEl.innerHTML = '<div class="haxi-log-item" style="text-align:center;color:#475569">等待前端发送下注命令...</div>';
          } else {
            betListEl.innerHTML = items.map(b => {
              const targetLabel = TARGET_TEXT[b.target] || b.target;
              const statusBadge = b.success
                ? '<span class="haxi-bet-ok">OK</span>'
                : '<span class="haxi-bet-fail">FAIL</span>';
              const timeStr = new Date(b.timestamp).toLocaleTimeString('zh-CN');
              return `<div class="haxi-bet-item">
                <span class="haxi-bet-target">${targetLabel}</span>
                <span class="haxi-bet-amount">¥${b.amount}</span>
                <span class="haxi-bet-task">${b.taskName || ''}</span>
                ${statusBadge}
                <span class="haxi-bet-time">${b.elapsed}ms ${timeStr}</span>
              </div>`;
            }).join('');
          }
        }
      }
    }

    // ==================== 初始化 ====================
    console.log('[HAXI执行器] Content Script v5.0 游戏页面执行器模式 (永不跳过)');

    function loadApiUrl() {
      return new Promise((resolve) => {
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

    let panel = null;

    async function init() {
      await loadApiUrl();

      let retries = 0;
      const maxRetries = 20;

      const tryInit = () => {
        retries++;
        const gameType = detectGameType();
        const hasInput = !!SiteAdapter.findAmountInput();
        const hasBlock = !!SiteAdapter.getCurrentBlock();

        if ((gameType || hasInput || hasBlock) || retries >= maxRetries) {
          panel = new StatusPanel();
          panel.create();

          if (gameType) {
            panel.addLog('v5.0 执行器 - ' + (gameType === 'PARITY' ? '尾数单双' : '尾数大小'));
          } else {
            panel.addLog('v5.0 执行器 - 等待游戏页面');
          }

          WSClient.connect();
          RealBetReceiver.init();
          startBlockMonitor();
        } else {
          setTimeout(tryInit, 1500);
        }
      };

      setTimeout(tryInit, 2000);
    }

    function startBlockMonitor() {
      let monitorObserver = null;

      const updateStatus = () => {
        const currentBlock = SiteAdapter.getCurrentBlock();
        if (currentBlock && currentBlock !== lastKnownBlock) {
          lastKnownBlock = currentBlock;
        }
        if (panel) {
          panel.currentPageBlock = currentBlock;
          panel.update();
        }
      };

      const setupObserver = () => {
        const candidates = document.querySelectorAll('div[color="#fff"][font-size="24px"][font-weight="600"]');
        if (candidates.length === 0) return;

        const parents = new Set();
        for (const el of candidates) {
          const p = el.parentElement ? (el.parentElement.parentElement || el.parentElement) : null;
          if (p) parents.add(p);
        }

        if (monitorObserver) monitorObserver.disconnect();
        monitorObserver = new MutationObserver(updateStatus);
        for (const p of parents) {
          monitorObserver.observe(p, { childList: true, subtree: true, characterData: true });
        }
      };

      setupObserver();
      setTimeout(setupObserver, 5000);
      WSClient.onBlock(() => updateStatus());
      setInterval(updateStatus, 2000);
    }

    // 启动执行器
    init();
  }

})();
