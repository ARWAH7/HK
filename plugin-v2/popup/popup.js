/**
 * 哈希游戏自动下注 - Popup 脚本
 */

document.addEventListener('DOMContentLoaded', () => {
  const statusDot = document.getElementById('statusDot');
  const backendStatus = document.getElementById('backendStatus');
  const gameStatus = document.getElementById('gameStatus');
  const totalBets = document.getElementById('totalBets');
  const winRate = document.getElementById('winRate');
  const profitLoss = document.getElementById('profitLoss');
  const apiUrlInput = document.getElementById('apiUrl');
  const saveBtn = document.getElementById('saveBtn');
  const wsUrlInput = document.getElementById('wsUrl');
  const wsApiKeyInput = document.getElementById('wsApiKey');
  const saveWsBtn = document.getElementById('saveWsBtn');
  const wsStatus = document.getElementById('wsStatus');

  // 加载所有设置
  chrome.storage.local.get(['apiUrl', 'pluginState', 'wsUrl', 'wsApiKey'], (result) => {
    apiUrlInput.value = result.apiUrl || 'http://localhost:3001';
    wsUrlInput.value = result.wsUrl || '';
    wsApiKeyInput.value = result.wsApiKey || '';

    if (result.pluginState) {
      const s = result.pluginState;
      totalBets.textContent = (s.wins + s.losses) || 0;
      const total = (s.wins + s.losses) || 0;
      winRate.textContent = total > 0 ? Math.round((s.wins / total) * 100) + '%' : '0%';
      const pl = s.profit || 0;
      profitLoss.textContent = (pl >= 0 ? '+' : '') + pl.toFixed(2);
      profitLoss.className = 'stat-value ' + (pl >= 0 ? 'profit' : 'loss');
    }
  });

  // 检查后端连接
  chrome.runtime.sendMessage({ type: 'GET_API_URL' }, (response) => {
    const apiUrl = response?.apiUrl || 'http://localhost:3001';
    fetch(apiUrl + '/health', { signal: AbortSignal.timeout(3000) })
      .then(res => res.json())
      .then(() => {
        backendStatus.textContent = '已连接';
        backendStatus.style.color = '#22c55e';
        statusDot.classList.add('connected');
      })
      .catch(() => {
        backendStatus.textContent = '未连接';
        backendStatus.style.color = '#ef4444';
        statusDot.classList.add('disconnected');
      });
  });

  // 检查WS状态 (通过游戏页查询)
  chrome.tabs.query({}, (tabs) => {
    const gameTabs = tabs.filter(t => t.url && (t.url.includes('amazonaws.com') || t.url.includes('hashGame')));
    if (gameTabs.length > 0) {
      chrome.tabs.sendMessage(gameTabs[0].id, { type: 'QUERY_READY' }, (resp) => {
        if (chrome.runtime.lastError) {
          wsStatus.textContent = '未检测到游戏页';
          wsStatus.style.color = '#94a3b8';
        } else if (resp && resp.ready) {
          wsStatus.textContent = 'WS已连接';
          wsStatus.style.color = '#22c55e';
        } else {
          wsStatus.textContent = 'WS未连接';
          wsStatus.style.color = '#ef4444';
        }
      });
    } else {
      wsStatus.textContent = '未检测到游戏页';
      wsStatus.style.color = '#94a3b8';
    }
  });

  // 检查游戏页面
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url || '';
    if (url.includes('hashGame') || url.includes('amazonaws.com')) {
      gameStatus.textContent = '已检测到游戏页面';
      gameStatus.style.color = '#22c55e';
    } else {
      gameStatus.textContent = '非游戏页面';
      gameStatus.style.color = '#94a3b8';
    }
  });

  // 保存API设置
  saveBtn.addEventListener('click', () => {
    const url = apiUrlInput.value.trim();
    if (url) {
      chrome.runtime.sendMessage({ type: 'SET_API_URL', apiUrl: url }, () => {
        saveBtn.textContent = '已保存!';
        setTimeout(() => { saveBtn.textContent = '保存API设置'; }, 1500);
      });
    }
  });

  // 保存WS配置
  saveWsBtn.addEventListener('click', () => {
    const wsUrl = wsUrlInput.value.trim();
    const wsApiKey = wsApiKeyInput.value.trim();
    chrome.storage.local.set({ wsUrl, wsApiKey }, () => {
      saveWsBtn.textContent = '已保存! 请刷新游戏页';
      setTimeout(() => { saveWsBtn.textContent = '保存WS配置'; }, 2000);
    });
  });
});
