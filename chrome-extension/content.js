/**
 * Content Script - 页面注入脚本
 *
 * 在所有网页上运行的注入脚本，提供页面操作能力
 */

console.log('🤖 AI Browser Assistant Content Script 已加载');

// 监听来自 background 和 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const { type, data } = message;

      switch (type) {
        case 'GET_PAGE_CONTEXT':
          const context = getPageContext();
          sendResponse({ success: true, data: context });
          break;

        case 'GET_INTERACTIVE_ELEMENTS':
          const elements = getInteractiveElements(data?.selector);
          sendResponse({ success: true, data: elements });
          break;

        case 'TAKE_SCREENSHOT':
          const screenshot = await takeScreenshot(data?.selector);
          sendResponse({ success: true, data: screenshot });
          break;

        case 'INJECT_ASSISTANT_UI':
          injectAssistantUI();
          sendResponse({ success: true });
          break;

        case 'EXECUTE_PAGE_ACTION':
          const result = await executePageAction(data);
          sendResponse({ success: true, data: result });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Content Script 错误:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true;
});

// ========== 页面上下文获取 ==========

function getPageContext() {
  return {
    title: document.title,
    url: window.location.href,
    domain: window.location.hostname,
    path: window.location.pathname,
    hasForms: document.querySelectorAll('form').length > 0,
    hasInputs: document.querySelectorAll('input, textarea').length,
    hasButtons: document.querySelectorAll('button, [role="button"]').length,
    hasTables: document.querySelectorAll('table').length,
    hasLinks: document.querySelectorAll('a, [href]').length,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  };
}

// ========== 交互元素获取 ==========

function getInteractiveElements(selector) {
  const baseSelectors = [
    'input',
    'textarea',
    'select',
    'button',
    '[role="button"]',
    'a[href]',
  ];

  const finalSelector = selector || baseSelectors.join(', ');
  const elements = document.querySelectorAll(finalSelector);

  const result = [];
  const viewport = { bottom: window.innerHeight, right: window.innerWidth };

  elements.forEach((el) => {
    const rect = el.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0
      && rect.top >= 0 && rect.top <= viewport.bottom
      && rect.left >= 0 && rect.left <= viewport.right
      && window.getComputedStyle(el).visibility !== 'hidden'
      && window.getComputedStyle(el).display !== 'none';

    if (!isVisible) return;

    result.push({
      tag: el.tagName.toLowerCase(),
      id: el.id,
      selector: getSelector(el),
      text: el.textContent?.trim?.().slice(0, 50) || '',
      type: el.type || '',
      placeholder: el.placeholder || '',
      href: el.href || '',
      position: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    });
  });

  return {
    count: result.length,
    elements: result.slice(0, 100), // 最多返回 100 个元素
  };
}

// ========== 获取元素选择器 ==========

function getSelector(element) {
  if (element.id) {
    return `#${element.id}`;
  }

  if (element.classList && element.classList.toString()) {
    return `.${element.classList.toString().replace(/\s+/g, '.')}`;
  }

  const tagName = element.tagName.toLowerCase();
  const siblings = element.parentNode ? Array.from(element.parentNode.children) : [];
  const sameTagSiblings = siblings.filter(el => el.tagName === element.tagName);

  if (sameTagSiblings.length > 1) {
    const index = sameTagSiblings.indexOf(element) + 1;
    return `${tagName}:nth-of-type(${index})`;
  }

  return tagName;
}

// ========== 截图功能 ==========

async function takeScreenshot(selector) {
  throw new Error('截图功能需要在 background.js 使用 chrome.tabs.captureVisibleTab');
}

// ========== 注入助手 UI ==========

function injectAssistantUI() {
  // 检查是否已注入
  if (document.getElementById('ai-assistant-ui')) {
    return;
  }

  const container = document.createElement('div');
  container.id = 'ai-assistant-ui';
  container.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `;

  container.innerHTML = `
    <style>
      .ai-assistant-toggle {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: none;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        transition: transform 0.3s ease, box-shadow 0.3s ease;
      }

      .ai-assistant-toggle:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
      }

      .ai-assistant-panel {
        position: absolute;
        bottom: 70px;
        right: 0;
        width: 400px;
        max-height: 80vh;
        background: white;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
        display: none;
        flex-direction: column;
        overflow: hidden;
      }

      .ai-assistant-panel.active {
        display: flex;
      }

      .ai-assistant-header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 16px;
        font-weight: 600;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .ai-assistant-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        min-height: 300px;
        max-height: 500px;
      }

      .ai-assistant-message {
        margin-bottom: 12px;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 14px;
        line-height: 1.5;
      }

      .ai-assistant-message.user {
        background: #f0f0f0;
        color: #333;
        margin-right: 30px;
      }

      .ai-assistant-message.ai {
        background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
        color: #333;
        margin-left: 30px;
      }

      .ai-assistant-input-area {
        padding: 16px;
        border-top: 1px solid #e0e0e0;
        display: flex;
        gap: 10px;
      }

      .ai-assistant-input {
        flex: 1;
        padding: 10px 14px;
        border: 1px solid #d0d0d0;
        border-radius: 6px;
        font-size: 14px;
        outline: none;
      }

      .ai-assistant-input:focus {
        border-color: #667eea;
      }

      .ai-assistant-send {
        padding: 10px 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: opacity 0.2s;
      }

      .ai-assistant-send:hover {
        opacity: 0.9;
      }

      .ai-assistant-send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    </style>

    <button class="ai-assistant-toggle" id="ai-assistant-toggle">🤖</button>

    <div class="ai-assistant-panel" id="ai-assistant-panel">
      <div class="ai-assistant-header">
        <span>AI 助手</span>
        <button id="ai-assistant-close" style="background:none;border:none;color:white;cursor:pointer;font-size:18px;">✕</button>
      </div>
      <div class="ai-assistant-messages" id="ai-assistant-messages">\n        <div class="ai-assistant-message ai">👋 你好！我可以帮你操作这个页面，需要我做什么吗？</div>\n      </div>
      <div class="ai-assistant-input-area">\n        <input type="text" class="ai-assistant-input" id="ai-assistant-input" placeholder="输入你的需求..."/>\n        <button class="ai-assistant-send" id="ai-assistant-send">发送</button>\n      </div>
    </div>
  `;

  document.body.appendChild(container);

  // 绑定事件
  const toggle = document.getElementById('ai-assistant-toggle');
  const panel = document.getElementById('ai-assistant-panel');
  const close = document.getElementById('ai-assistant-close');
  const input = document.getElementById('ai-assistant-input');
  const sendButton = document.getElementById('ai-assistant-send');
  const messages = document.getElementById('ai-assistant-messages');

  let isOpen = false;

  toggle.addEventListener('click', () => {
    isOpen = !isOpen;
    panel.classList.toggle('active', isOpen);
  });

  close.addEventListener('click', () => {
    isOpen = false;
    panel.classList.remove('active');
  });

  const addMessage = (text, type) => {
    const message = document.createElement('div');
    message.className = `ai-assistant-message ${type}`;
    message.textContent = text;
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
  };

  const handleSend = async () => {
    const text = input.value.trim();
    if (!text) return;

    // 清空输入
    input.value = '';

    // 添加用户消息
    addMessage(text, 'user');

    // 发送到 background
    const response = await chrome.runtime.sendMessage({
      type: 'START_TASK',
      data: { task: text },
    });

    if (response.success) {
      addMessage(JSON.stringify(response.data.result || '任务完成'), 'ai');
    } else {
      addMessage(`❌ ${response.error || '任务失败'}`, 'ai');
    }
  };

  sendButton.addEventListener('click', handleSend);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
  });
}

// ========== 页面动作执行 ==========

async function executePageAction(data) {
  const { action, selector, value } = data;

  switch (action) {
    case 'click':
      const clickEl = document.querySelector(selector);
      if (!clickEl) throw new Error('元素不存在: ' + selector);
      clickEl.click();
      return { success: true };

    case 'type':
      const typeEl = document.querySelector(selector);
      if (!typeEl) throw new Error('元素不存在: ' + selector);
      typeEl.value = value;
      typeEl.dispatchEvent(new Event('input', { bubbles: true }));
      typeEl.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };

    default:
      throw new Error('未知的动作: ' + action);
  }
}

// ========== 初始化 ==========

console.log('✅ AI Browser Assistant Content Script 已准备就绪');

// 默认注入浮动聊天入口
injectAssistantUI();
