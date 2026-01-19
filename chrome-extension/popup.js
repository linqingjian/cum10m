/**
 * Popup - 侧边栏界面
 *
 * AI Browser Assistant 的主界面
 */

import { logger } from './core/logger.js';
import { storage, StorageKeys } from './core/storage.js';

// ========== DOM 元素 ==========

const elements = {
  input: document.getElementById('task-input'),
  send: document.getElementById('send-btn'),
  stop: document.getElementById('stop-btn'),
  messages: document.getElementById('messages'),
  logs: document.getElementById('logs'),
  status: document.getElementById('status'),
  clearLogs: document.getElementById('clear-logs'),
  openSettings: document.getElementById('open-settings'),
};

// ========== 状态管理 ==========

let isExecuting = false;
let messageHistory = [];

// ========== 初始化 ==========

async function init() {
  console.log('🚀 Popup 已加载');
  
  // 加载配置
  await loadConfig();
  
  // 绑定事件
  bindEvents();
  
  // 添加欢迎消息
  addMessage('system', '👋 欢迎使用 AI Browser Assistant！请告诉我你想做什么。');
}

/**
 * 加载配置
 */
async function loadConfig() {
  const config = await storage.getMany(['apiToken', 'model', 'maxSteps']);
  
  if (!config.apiToken) {
    elements.status.textContent = '⚠️ 请先配置 API Token';
    elements.status.className = 'status warning';
  } else {
    elements.status.textContent = '✅ 配置正常';
    elements.status.className = 'status success';
  }
}

/**
 * 绑定事件
 */
function bindEvents() {
  // 发送任务
  elements.send.addEventListener('click', sendTask);
  
  // 停止任务
  elements.stop.addEventListener('click', stopTask);
  
  // 回车发送
  elements.input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTask();
    }
  });
  
  // 清空日志
  elements.clearLogs.addEventListener('click', () => {
    elements.logs.innerHTML = '';
    logger.clear();
  });
  
  // 打开设置
  elements.openSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

/**
 * 发送任务
 */
async function sendTask() {
  const task = elements.input.value.trim();
  if (!task) {
    addMessage('system', '⚠️ 请输入任务描述');
    return;
  }
  
  if (isExecuting) {
    addMessage('system', '⚠️ 任务执行中，请先停止当前任务');
    return;
  }
  
  // 清空输入
  elements.input.value = '';
  
  // 添加用户消息
  addMessage('user', task);
  
  // 更新状态
  isExecuting = true;
  updateExecutionUI(true);
  
  // 发送到 background
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_TASK',
      data: { task },
    });
    
    if (response.success) {
      const { task: taskData, result } = response.data;
      addMessage('ai', `✅ 任务完成：${result}`);
      addLogs(response.data.logs || []);
    } else {
      addMessage('ai', `❌ 任务失败：${response.error}`);
    }
  } catch (error) {
    addMessage('ai', `❌ 执行出错：${error.message}`);
  } finally {
    isExecuting = false;
    updateExecutionUI(false);
  }
}

/**
 * 停止任务
 */
async function stopTask() {
  try {
    await chrome.runtime.sendMessage({
      type: 'STOP_TASK',
    });
    addMessage('system', '🛑 任务已停止');
  } catch (error) {
    addMessage('system', `⚠️ 停止任务失败：${error.message}`);
  }
}

/**
 * 添加消息
 */
function addMessage(type, text) {
  const message = document.createElement('div');
  message.className = `message message-${type}`;
  message.textContent = text;
  
  // 添加时间戳
  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  message.appendChild(time);
  
  elements.messages.appendChild(message);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  
  // 保存历史
  messageHistory.push({ type, text, time: Date.now() });
  
  // 限制历史记录数量
  if (messageHistory.length > 50) {
    messageHistory.shift();
  }
}

/**
 * 添加日志
 */
function addLogs(logs) {
  logs.forEach(log => {
    const logItem = document.createElement('div');
    logItem.className = 'log-item';
    logItem.innerHTML = `\n      <span class="log-time">${log.time}</span>\n      <span class="log-level">${log.type}</span>\n      <span class="log-message">${escapeHtml(log.message)}</span>\n    `;
    elements.logs.appendChild(logItem);
  });
  elements.logs.scrollTop = elements.logs.scrollHeight;
}

/**
 * 更新执行 UI
 */
function updateExecutionUI(executing) {
  elements.send.disabled = executing;
  elements.input.disabled = executing;
  elements.stop.disabled = !executing;
  
  if (executing) {
    elements.status.textContent = '⏳ 任务执行中...';
    elements.status.className = 'status info';
  } else {
    elements.status.textContent = '✅ 就绪';
    elements.status.className = 'status success';
  }
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== 监听 Background 消息 ==========

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LOG_UPDATE') {
    const log = message.data;
    addLogs([log]);
  }
});

// ========== 启动 ==========

init();
