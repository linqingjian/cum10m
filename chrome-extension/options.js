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

const GITHUB_REPO_ZIP_URL = 'https://codeload.github.com/linqingjian/cum10m/zip/refs/heads/main';
const GITHUB_MANIFEST_URL = 'https://raw.githubusercontent.com/linqingjian/cum10m/main/chrome-extension/manifest.json';

// 默认配置
const DEFAULT_CONFIG = {
  apiUrl: 'https://model-router.meitu.com/v1',
  apiToken: '',
  model: 'gpt-5.2',
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

    const effective = { ...DEFAULT_CONFIG };
    Object.entries(config).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        effective[key] = value;
      }
    });

    elements.apiUrl.value = effective.apiUrl || DEFAULT_CONFIG.apiUrl;
    elements.apiToken.value = effective.apiToken || '';
    elements.model.value = effective.model || 'gpt-5.2';
    elements.webhookUrl.value = effective.webhookUrl || '';
    elements.confluenceToken.value = effective.confluenceToken || '';
    elements.confluenceUsername.value = effective.confluenceUsername || '';
    elements.maxSteps.value = effective.maxSteps || 15;
    elements.logLevel.value = effective.logLevel || 'info';
    elements.verboseLogs.checked = !!effective.verboseLogs;
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
    let usedFallbackModel = false;
    const attemptTest = async (useMaxCompletionTokens, allowRetry = true, overrideModel = null) => {
      const effectiveModel = overrideModel || model || 'gpt-5.2';
      const body = {
        model: effectiveModel,
        messages: [{ role: 'user', content: 'Hello' }]
      };
      if (useMaxCompletionTokens) {
        body.max_completion_tokens = 10;
      } else {
        body.max_tokens = 10;
      }

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
          'X-Mtcc-Client': 'shenzhou-assistant-extension'
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        return true;
      }

      const responseText = await response.text();
      if (allowRetry && response.status === 400) {
        const lower = responseText.toLowerCase();
        const mentionsBoth = lower.includes('max_tokens') && lower.includes('max_completion_tokens');
        const unknownModel = lower.includes('unknown_model');
        if (unknownModel && effectiveModel === 'gpt-5.2') {
          const fallbackModel = 'gpt-5.2-chat';
          usedFallbackModel = true;
          elements.model.value = fallbackModel;
          return attemptTest(useMaxCompletionTokens, false, fallbackModel);
        }
        if (mentionsBoth) {
          return attemptTest(!useMaxCompletionTokens, false, overrideModel);
        }
      }

      throw new Error(`HTTP ${response.status}: ${responseText || response.statusText}`);
    };

    const preferMaxCompletionTokens = /gpt-5/i.test(model || '');
    await attemptTest(preferMaxCompletionTokens, true);
    if (usedFallbackModel) {
      showStatus('✅ 连接测试成功（gpt-5.2 不可用，已切换 gpt-5.2-chat）', 'success');
    } else {
      showStatus('✅ 连接测试成功！', 'success');
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
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/chat/completions`;
  }

  return trimmed;
}

async function fetchLatestExtensionVersion() {
  try {
    const response = await fetch(GITHUB_MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) {
      return 'latest';
    }
    const data = await response.json();
    return data?.version || 'latest';
  } catch (error) {
    return 'latest';
  }
}

async function downloadLatestExtension() {
  if (!chrome.downloads?.download) {
    showStatus('❌ 当前扩展未开启 downloads 权限，无法自动下载。', 'error');
    return;
  }
  const version = await fetchLatestExtensionVersion();
  const filename = `chrome-extension_${version}.zip`;
  chrome.downloads.download({
    url: GITHUB_REPO_ZIP_URL,
    filename,
    saveAs: true,
    conflictAction: 'uniquify'
  }, () => {
    if (chrome.runtime.lastError) {
      showStatus(`❌ 下载失败: ${chrome.runtime.lastError.message}`, 'error');
    } else {
      showStatus('✅ 已开始下载，请等待完成。', 'success');
    }
  });
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
const downloadExtensionBtn = document.getElementById('downloadExtensionBtn');
if (downloadExtensionBtn) {
  downloadExtensionBtn.addEventListener('click', downloadLatestExtension);
}
elements.resetBtn.addEventListener('click', resetConfig);
