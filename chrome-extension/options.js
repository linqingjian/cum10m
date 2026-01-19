/**
 * Options Page - 配置页面
 *
 * 管理 AI Browser Assistant 的配置
 */

import { storage, StorageKeys } from './core/storage.js';

// DOM 元素
const elements = {
  apiUrl: document.getElementById('apiUrl'),
  apiToken: document.getElementById('apiToken'),
  model: document.getElementById('model'),
  webhookUrl: document.getElementById('webhookUrl'),
  confluenceToken: document.getElementById('confluenceToken'),
  confluenceUsername: document.getElementById('confluenceUsername'),
  maxSteps: document.getElementById('maxSteps'),
  logLevel: document.getElementById('logLevel'),
  verboseLogs: document.getElementById('verboseLogs'),
  saveBtn: document.getElementById('saveBtn'),
  testBtn: document.getElementById('testBtn'),
  resetBtn: document.getElementById('resetBtn'),
  status: document.getElementById('status'),
};

// 默认配置
const DEFAULT_CONFIG = {
  apiUrl: 'https://model-router.meitu.com/v1/chat/completions',
  apiToken: '',
  model: 'gpt-4o',
  webhookUrl: '',
  confluenceToken: '',
  confluenceUsername: '',
  maxSteps: 15,
  logLevel: 'info',
  verboseLogs: false,
};

/**
 * 加载配置
 */
async function loadConfig() {
  try {
    const config = await storage.getMany([
      StorageKeys.CONFIG_API_URL,
      StorageKeys.CONFIG_API_TOKEN,
      StorageKeys.CONFIG_MODEL,
      StorageKeys.CONFIG_WEBHOOK_URL,
      StorageKeys.CONFIG_CONFLUENCE_TOKEN,
      StorageKeys.CONFIG_VERBOSE_LOGS,
      'maxSteps',
      'logLevel',
      'confluenceUsername',
    ]);
    
    Object.assign(DEFAULT_CONFIG, config);
    
    elements.apiUrl.value = DEFAULT_CONFIG.apiUrl || '';
    elements.apiToken.value = DEFAULT_CONFIG.apiToken || '';
    elements.model.value = DEFAULT_CONFIG.model || 'gpt-4o';
    elements.webhookUrl.value = DEFAULT_CONFIG.webhookUrl || '';
    elements.confluenceToken.value = DEFAULT_CONFIG.confluenceToken || '';
    elements.confluenceUsername.value = DEFAULT_CONFIG.confluenceUsername || '';
    elements.maxSteps.value = DEFAULT_CONFIG.maxSteps || 15;
    elements.logLevel.value = DEFAULT_CONFIG.logLevel || 'info';
    elements.verboseLogs.checked = DEFAULT_CONFIG.verboseLogs || false;
  } catch (error) {
    showStatus('配置加载失败: ' + error.message, 'error');
  }
}

/**
 * 保存配置
 */
async function saveConfig() {
  try {
    const config = {
      apiUrl: elements.apiUrl.value.trim(),
      apiToken: elements.apiToken.value.trim(),
      model: elements.model.value.trim(),
      webhookUrl: elements.webhookUrl.value.trim(),
      confluenceToken: elements.confluenceToken.value.trim(),
      confluenceUsername: elements.confluenceUsername.value.trim(),
      maxSteps: parseInt(elements.maxSteps.value, 10),
      logLevel: elements.logLevel.value,
      verboseLogs: elements.verboseLogs.checked,
    };

    await storage.setMany(config);
    showStatus('✅ 配置已保存成功！', 'success');
  } catch (error) {
    showStatus('配置保存失败: ' + error.message, 'error');
  }
}

/**
 * 测试连接
 */
async function testConnection() {
  const apiUrl = elements.apiUrl.value.trim();
  const apiToken = elements.apiToken.value.trim();
  const model = elements.model.value.trim();

  const requestUrl = normalizeApiUrl(apiUrl);

  if (!apiUrl || !apiToken) {
    showStatus('❌ 请先填写 API URL 和 Token', 'error');
    return;
  }

  elements.testBtn.disabled = true;
  elements.testBtn.textContent = '🔄 测试中...';
  showStatus('正在测试连接...', 'info');

  try {
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 10,
      }),
    });

    if (response.ok) {
      showStatus('✅ 连接测试成功！', 'success');
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    showStatus('❌ 连接测试失败: ' + error.message, 'error');
  } finally {
    elements.testBtn.disabled = false;
    elements.testBtn.textContent = '🧪 测试连接';
  }
}

function normalizeApiUrl(apiUrl) {
  if (!apiUrl) {
    return DEFAULT_CONFIG.apiUrl;
  }

  const trimmed = apiUrl.replace(/\/+$/u, '');
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/chat/completions`;
  }

  return trimmed;
}

/**
 * 重置配置
 */
async function resetConfig() {
  if (!confirm('确定要重置为默认配置吗？')) {
    return;
  }

  elements.apiUrl.value = DEFAULT_CONFIG.apiUrl;
  elements.apiToken.value = '';
  elements.model.value = DEFAULT_CONFIG.model;
  elements.webhookUrl.value = '';
  elements.confluenceToken.value = '';
  elements.confluenceUsername.value = '';
  elements.maxSteps.value = DEFAULT_CONFIG.maxSteps;
  elements.logLevel.value = DEFAULT_CONFIG.logLevel;
  elements.verboseLogs.checked = DEFAULT_CONFIG.verboseLogs;

  showStatus('⚠️ 配置已重置为默认值，请保存', 'info');
}

/**
 * 显示状态
 */
function showStatus(message, type) {
  elements.status.textContent = message;
  elements.status.className = 'status ' + type;
  elements.status.style.display = 'block';

  setTimeout(() => {
    elements.status.style.display = 'none';
  }, 5000);
}

// 初始化
loadConfig();

// 事件监听
elements.saveBtn.addEventListener('click', saveConfig);
elements.testBtn.addEventListener('click', testConnection);
elements.resetBtn.addEventListener('click', resetConfig);
