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

  // 加载设置
  chrome.storage.local.get(['apiUrl', 'pluginState'], (result) => {
    apiUrlInput.value = result.apiUrl || 'http://localhost:3001';

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

  // 检查游戏页面
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url || '';
    if (url.includes('hashGame')) {
      gameStatus.textContent = '已检测到游戏页面';
      gameStatus.style.color = '#22c55e';
    } else {
      gameStatus.textContent = '非游戏页面';
      gameStatus.style.color = '#94a3b8';
    }
  });

  // 保存设置
  saveBtn.addEventListener('click', () => {
    const url = apiUrlInput.value.trim();
    if (url) {
      chrome.runtime.sendMessage({ type: 'SET_API_URL', apiUrl: url }, () => {
        saveBtn.textContent = '已保存!';
        setTimeout(() => { saveBtn.textContent = '保存设置'; }, 1500);
      });
    }
  });
});
