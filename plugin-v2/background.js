/**
 * 哈希游戏下注执行器 v2 - Background Service Worker
 * WS触发极速投注版本
 * 负责:
 *   1. 跨标签页消息中转 (前端页面 ↔ 游戏页面)
 *   2. API地址持久化存储
 */

const DEFAULT_API_URL = 'http://localhost:3001';

// 查找游戏页面标签页 (amazonaws.com)
async function findGameTab() {
  const tabs = await chrome.tabs.query({
    url: ['*://*.amazonaws.com/*']
  });
  return tabs.length > 0 ? tabs[0] : null;
}

// 向游戏标签页发送消息并等待响应
async function sendToGameTab(message) {
  const tab = await findGameTab();
  if (!tab) {
    return { success: false, reason: '未找到游戏页面标签页 - 请先打开游戏页面' };
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    return response;
  } catch (e) {
    return { success: false, reason: '游戏页面插件未响应: ' + e.message };
  }
}

// 向所有游戏标签页广播下注命令，返回第一个成功结果
// 不兼容的页面会静默返回 { skipped: true }，由此函数过滤
async function sendToAllGameTabs(message) {
  const tabs = await chrome.tabs.query({ url: ['*://*.amazonaws.com/*'] });
  if (tabs.length === 0) return { success: false, reason: '未找到游戏页面标签页 - 请先打开游戏页面' };
  const results = await Promise.all(
    tabs.map(tab => chrome.tabs.sendMessage(tab.id, message).catch(e => ({ success: false, reason: e.message })))
  );
  return results.find(r => r && r.success)
      || results.find(r => r && !r.skipped)
      || { success: false, reason: '未找到兼容的游戏页面' };
}

// 监听消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'GET_API_URL') {
    chrome.storage.local.get(['apiUrl'], (result) => {
      sendResponse({ apiUrl: result.apiUrl || DEFAULT_API_URL });
    });
    return true;
  }

  if (message.type === 'SET_API_URL') {
    chrome.storage.local.set({ apiUrl: message.apiUrl }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'SAVE_PLUGIN_STATE') {
    chrome.storage.local.set({ pluginState: message.state }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'LOAD_PLUGIN_STATE') {
    chrome.storage.local.get(['pluginState'], (result) => {
      sendResponse({ state: result.pluginState || null });
    });
    return true;
  }

  if (message.type === 'PLUGIN_STATUS') {
    chrome.runtime.sendMessage(message).catch(() => {});
  }

  // ========== v2: WS触发极速投注 ==========

  if (message.type === 'RELAY_BET_V2') {
    sendToAllGameTabs({
      type: 'EXECUTE_BET_V2',
      detail: message.detail
    }).then(response => {
      sendResponse(response);
    });
    return true;
  }

  if (message.type === 'RELAY_QUERY_READY') {
    sendToGameTab({ type: 'QUERY_READY' }).then(response => {
      sendResponse(response || { ready: false });
    });
    return true;
  }

  if (message.type === 'RELAY_QUERY_BALANCE') {
    sendToGameTab({ type: 'QUERY_BALANCE' }).then(response => {
      sendResponse(response || { balance: null, timestamp: Date.now() });
    });
    return true;
  }
});

// 安装时初始化
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    apiUrl: DEFAULT_API_URL,
    pluginState: null
  });
  console.log('[HAXI Plugin v2] v2.0 WS触发极速投注插件已安装');
});
