// 数仓小助手 - 内容脚本
// 注入到神舟平台页面，提供更强大的页面操作能力

console.log('🤖 数仓小助手已注入');

// 监听来自 popup 和 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 处理任务状态更新（来自 background）
  if (request.type === 'TASK_STATUS_UPDATE') {
    const status = {
      status: request.status || 'running',
      result: request.result || null,
      error: request.error || null
    };
    
    console.log('📨 Content script 收到状态更新:', status);
    
    // 通过 postMessage 发送到页面 MAIN 上下文（不要在这里创建 window.warehouseAssistantStatus，它应该在 MAIN 上下文中）
    window.postMessage({
      type: 'WAREHOUSE_ASSISTANT_STATUS_UPDATE',
      status: status
    }, '*');
    
    return; // 不需要 sendResponse
  }
  
  // 处理来自 popup 的消息
  switch (request.action) {
    case 'getPageSnapshot':
      sendResponse(getPageSnapshot());
      break;
      
    case 'executeSQL':
      executeSQL(request.sql).then(result => sendResponse(result));
      return true; // 异步响应
      
    case 'clickElement':
      clickElement(request.selector);
      sendResponse({ success: true });
      break;
      
    case 'typeText':
      typeText(request.selector, request.text);
      sendResponse({ success: true });
      break;
      
    case 'getQueryResult':
      sendResponse(getQueryResult());
      break;
  }
});

// ========== 添加从页面脚本调用插件的功能 ==========
// 将函数注入到页面的 MAIN 上下文（因为 content scripts 在 ISOLATED 上下文运行）
// 使用外部脚本文件避免 CSP 限制
(function() {
  function injectScript() {
    // 检查是否已经注入（通过检查函数是否存在，而不是 script 标签）
    if (typeof window.callWarehouseAssistant === 'function') {
      console.log('✅ 数仓小助手已存在，跳过注入');
      return;
    }
    
    // 创建一个脚本元素，使用外部文件注入到页面的 MAIN 上下文
    const script = document.createElement('script');
    script.id = 'warehouse-assistant-injected';
    script.src = chrome.runtime.getURL('injected_script.js');
    script.onload = function() {
      console.log('✅ 数仓小助手注入脚本已加载');
      // 等待一下，确保脚本执行完成
      setTimeout(() => {
        if (typeof window.callWarehouseAssistant === 'function') {
          console.log('✅ 数仓小助手函数已就绪');
        } else {
          console.warn('⚠️ 数仓小助手函数未找到，可能注入失败');
        }
      }, 100);
      // 不立即移除，保留 script 元素以便调试
    };
    script.onerror = function(e) {
      console.error('❌ 数仓小助手注入脚本加载失败:', e);
      console.error('脚本 URL:', chrome.runtime.getURL('injected_script.js'));
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }
  
  // 立即注入，如果页面已加载完成
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectScript);
  } else {
    // 页面已加载，立即注入
    injectScript();
  }
  
  // 也监听 load 事件，确保脚本注入成功
  window.addEventListener('load', () => {
    setTimeout(() => {
      // 检查函数是否存在，如果不存在则重新注入
      if (typeof window.callWarehouseAssistant !== 'function') {
        console.warn('⚠️ load 事件后检查：函数不存在，重新注入...');
        injectScript();
      } else {
        console.log('✅ load 事件后检查：函数已存在');
      }
      
      // 通过 postMessage 检查函数是否存在（避免内联脚本）
      window.postMessage({
        type: 'CHECK_WAREHOUSE_ASSISTANT',
        checkId: Date.now()
      }, '*');
    }, 1000);
  });
  
  // 延迟注入，确保页面完全加载
  setTimeout(() => {
    if (typeof window.callWarehouseAssistant !== 'function') {
      console.warn('⚠️ 延迟检查：函数不存在，尝试重新注入...');
      injectScript();
    }
  }, 2000);
  
  // 注入聊天 UI - 已禁用，使用 popup 中的聊天界面
  // function injectChatUI() {
  //   // 检查是否已经注入
  //   if (document.getElementById('warehouse-chat-window')) {
  //     console.log('✅ 聊天窗口已存在，跳过注入');
  //     return;
  //   }
  //   
  //   // 创建脚本元素注入聊天 UI
  //   const chatScript = document.createElement('script');
  //   chatScript.id = 'warehouse-chat-ui';
  //   chatScript.src = chrome.runtime.getURL('chat_ui.js');
  //   chatScript.onload = function() {
  //     console.log('✅ 聊天 UI 已加载');
  //     this.remove();
  //   };
  //   chatScript.onerror = function(e) {
  //     console.error('❌ 聊天 UI 加载失败:', e);
  //     this.remove();
  //   };
  //   (document.head || document.documentElement).appendChild(chatScript);
  // }
  
  // 在页面加载完成后注入聊天 UI - 已禁用
  // if (document.readyState === 'loading') {
  //   document.addEventListener('DOMContentLoaded', () => {
  //     setTimeout(injectChatUI, 1000);
  //   });
  // } else {
  //   setTimeout(injectChatUI, 1000);
  // }
  
  // 也监听 load 事件 - 已禁用
  // window.addEventListener('load', () => {
  //   setTimeout(injectChatUI, 1000);
  // });
})();

// 监听来自页面的检查响应
window.addEventListener('message', function(event) {
  if (event.source !== window) return;
  if (event.data && event.data.type === 'WAREHOUSE_ASSISTANT_CHECK_RESPONSE') {
    if (!event.data.exists) {
      console.warn('⚠️ callWarehouseAssistant 函数未找到，尝试重新注入...');
      // 重新注入
      const script = document.createElement('script');
      script.id = 'warehouse-assistant-injected';
      script.src = chrome.runtime.getURL('injected_script.js');
      script.onload = function() {
        console.log('✅ 数仓小助手注入脚本已重新加载');
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    } else {
      console.log('✅ callWarehouseAssistant 函数已就绪');
    }
  }
});

// 在 content script 中监听来自页面的消息
// 确保消息监听器在页面加载时就已经设置好
console.log('✅ 数仓小助手 content script 已加载，准备监听消息...');

window.addEventListener('message', function(event) {
  // 只处理来自当前页面的消息
  if (event.source !== window) return;
  
  // 调试：打印所有收到的消息
  if (event.data && event.data.type) {
    console.log('📨 Content script 收到消息:', event.data.type, event.data);
  }
  
  if (event.data && event.data.type === 'CALL_WAREHOUSE_ASSISTANT') {
    const { task, model, options } = event.data;
    
    console.log('📨 Content script 收到调用请求:', { task, model, options });
    
    // 更新状态（通过 postMessage 发送到页面）
    window.postMessage({
      type: 'WAREHOUSE_ASSISTANT_STATUS_UPDATE',
      status: { status: 'running', currentTask: task }
    }, '*');
    
    // 转发消息到 background.js
    try {
      // 检查扩展是否可用
      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        const error = '扩展上下文不可用，请刷新页面';
        console.error('❌', error);
        window.postMessage({
          type: 'WAREHOUSE_ASSISTANT_RESPONSE',
          success: false,
          error: error
        }, '*');
        return;
      }
      
      chrome.runtime.sendMessage({
        type: 'START_TASK',
        task: task,
        model: model || 'gpt-4o-mini'
      }, (response) => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError.message;
          console.error('❌ Content script 调用 background 失败:', error);
          
          // 检查是否是扩展上下文失效
          const isContextInvalidated = error.includes('Extension context invalidated') || 
                                      error.includes('message port closed') ||
                                      error.includes('Receiving end does not exist');
          
          const errorMsg = isContextInvalidated 
            ? '扩展上下文已失效，请刷新页面后重试'
            : error;
          
          window.postMessage({
            type: 'WAREHOUSE_ASSISTANT_RESPONSE',
            success: false,
            error: errorMsg
          }, '*');
          
          window.postMessage({
            type: 'WAREHOUSE_ASSISTANT_STATUS_UPDATE',
            status: { status: 'error', error: errorMsg }
          }, '*');
        } else {
          console.log('✅ Content script 收到 background 响应:', response);
          
          // 确保发送响应消息
          window.postMessage({
            type: 'WAREHOUSE_ASSISTANT_RESPONSE',
            success: true,
            response: response || { status: 'started' }
          }, '*');
        }
      });
    } catch (error) {
      console.error('❌ Content script 发送消息异常:', error);
      const errorMsg = error.message && error.message.includes('Extension context invalidated')
        ? '扩展上下文已失效，请刷新页面后重试'
        : (error.message || String(error));
      
      window.postMessage({
        type: 'WAREHOUSE_ASSISTANT_RESPONSE',
        success: false,
        error: errorMsg
      }, '*');
    }
  }
});

// 触发状态变化事件
function notifyStatusChange() {
  const status = window.warehouseAssistantStatus || {
    currentTask: null,
    status: 'idle',
    result: null,
    error: null
  };
  
  // 通过 postMessage 更新页面状态
  window.postMessage({
    type: 'WAREHOUSE_ASSISTANT_STATUS_UPDATE',
    status: status
  }, '*');
  
  // 更新页面上的状态显示
  updateStatusDisplay();
}

// 更新页面上的状态显示
function updateStatusDisplay() {
  let statusEl = document.getElementById('warehouse-assistant-status');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = 'warehouse-assistant-status';
    statusEl.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 10px 15px;
      border-radius: 5px;
      font-size: 12px;
      z-index: 999998;
      max-width: 300px;
      word-wrap: break-word;
      font-family: monospace;
    `;
    document.body.appendChild(statusEl);
  }
  
  const status = window.warehouseAssistantStatus;
  let html = `<div style="font-weight: bold; margin-bottom: 5px;">🤖 数仓小助手</div>`;
  html += `<div>状态: <span style="color: ${getStatusColor(status.status)}">${getStatusText(status.status)}</span></div>`;
  
  if (status.currentTask) {
    html += `<div style="margin-top: 5px; font-size: 11px; opacity: 0.8;">任务: ${status.currentTask.substring(0, 50)}...</div>`;
  }
  
  if (status.error) {
    html += `<div style="margin-top: 5px; color: #ff6b6b;">错误: ${status.error}</div>`;
  }
  
  if (status.result) {
    html += `<div style="margin-top: 5px; color: #51cf66;">结果: ${typeof status.result === 'string' ? status.result.substring(0, 100) : JSON.stringify(status.result).substring(0, 100)}...</div>`;
  }
  
  statusEl.innerHTML = html;
}

function getStatusColor(status) {
  switch(status) {
    case 'idle': return '#94a3b8';
    case 'running': return '#ffd43b';
    case 'completed': return '#51cf66';
    case 'error': return '#ff6b6b';
    default: return '#fff';
  }
}

function getStatusText(status) {
  switch(status) {
    case 'idle': return '空闲';
    case 'running': return '运行中';
    case 'completed': return '已完成';
    case 'error': return '错误';
    default: return '未知';
  }
}

// 注意：window.callWarehouseAssistant 函数应该在页面的 MAIN 上下文中定义
// 上面的注入脚本已经处理了，这里不再在 ISOLATED 上下文中定义


// 方式2: 通过自定义事件调用（更安全，不污染全局命名空间）
window.addEventListener('warehouseAssistantCall', async function(event) {
  const { task, model = 'gpt-4o-mini', callback } = event.detail;
  
  console.log('📞 通过事件调用数仓小助手:', task);
  
  try {
    chrome.runtime.sendMessage({
      type: 'START_TASK',
      task: task,
      model: model
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('❌ 调用插件失败:', chrome.runtime.lastError.message);
        if (callback) callback({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('✅ 插件响应:', response);
        if (callback) callback({ success: true, response: response || { status: 'started' } });
      }
    });
  } catch (error) {
    console.error('❌ 调用异常:', error);
    if (callback) callback({ success: false, error: error.message });
  }
});

console.log('✅ 数仓小助手 content script 已加载');

// 获取页面快照
function getPageSnapshot() {
  const snapshot = {
    url: window.location.href,
    title: document.title,
    pageType: detectPageType(),
    elements: {
      buttons: getButtons(),
      inputs: getInputs(),
      tables: getTables(),
      tabs: getTabs()
    },
    currentData: getCurrentData()
  };
  
  return snapshot;
}

// 检测页面类型
function detectPageType() {
  const url = window.location.href;
  if (url.includes('/data-develop/query')) return 'temporary_query';
  if (url.includes('/data-develop/tasks')) return 'task_list';
  if (url.includes('/data-develop/dev')) return 'task_dev';
  if (url.includes('/data-manage/tables/table')) return 'table_detail';
  if (url.includes('/data-manage/tables')) return 'data_map';
  return 'unknown';
}

// 获取按钮信息
function getButtons() {
  return Array.from(document.querySelectorAll('button, .ant-btn')).map(btn => ({
    text: btn.textContent.trim().substring(0, 30),
    className: btn.className,
    disabled: btn.disabled,
    visible: btn.offsetParent !== null
  })).filter(b => b.visible && b.text);
}

// 获取输入框信息
function getInputs() {
  return Array.from(document.querySelectorAll('input, textarea, .ant-input')).map(inp => ({
    type: inp.type || 'text',
    placeholder: inp.placeholder,
    value: inp.value?.substring(0, 100),
    className: inp.className,
    visible: inp.offsetParent !== null
  })).filter(i => i.visible);
}

// 获取表格信息
function getTables() {
  const tables = document.querySelectorAll('.ant-table, table');
  return Array.from(tables).map(table => {
    const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim());
    const rows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 5).map(tr => 
      Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim().substring(0, 50))
    );
    return { headers, rows, rowCount: table.querySelectorAll('tbody tr').length };
  });
}

// 获取标签页信息
function getTabs() {
  return Array.from(document.querySelectorAll('.ant-tabs-tab')).map(tab => ({
    text: tab.textContent.trim(),
    active: tab.classList.contains('ant-tabs-tab-active')
  }));
}

// 获取当前数据（查询结果等）
function getCurrentData() {
  // 尝试获取查询结果
  const resultArea = document.querySelector('.result-preview, .query-result-table, .ant-table-tbody');
  if (resultArea) {
    return {
      type: 'query_result',
      content: resultArea.textContent.substring(0, 2000)
    };
  }
  
  // 尝试获取表结构
  const tableSchema = document.querySelector('.table-schema, .field-list');
  if (tableSchema) {
    return {
      type: 'table_schema',
      content: tableSchema.textContent.substring(0, 2000)
    };
  }
  
  return null;
}

// 执行 SQL（在临时查询页面）
async function executeSQL(sql) {
  // 找到编辑器并输入 SQL
  const editor = document.querySelector('.ace_editor, .CodeMirror');
  if (!editor) {
    return { success: false, error: '未找到 SQL 编辑器，请先导航到临时查询页面' };
  }
  
  // 使用 Ace 编辑器 API
  if (window.ace) {
    try {
      const aceEditor = ace.edit(editor);
      aceEditor.setValue(sql);
    } catch (e) {
      console.error('Ace 编辑器操作失败:', e);
    }
  }
  
  // 使用 CodeMirror API
  if (editor.CodeMirror) {
    editor.CodeMirror.setValue(sql);
  }
  
  // 等待一下
  await sleep(500);
  
  // 点击执行按钮
  const runBtn = document.querySelector('button[title*="执行"], button[title*="运行"], .run-button') ||
                 Array.from(document.querySelectorAll('button')).find(b => 
                   b.textContent.includes('执行') || b.textContent.includes('运行'));
  
  if (runBtn) {
    runBtn.click();
    
    // 等待结果
    await sleep(5000);
    
    // 获取结果
    return { success: true, result: getQueryResult() };
  }
  
  return { success: false, error: '未找到执行按钮' };
}

// 点击元素
function clickElement(selector) {
  const el = document.querySelector(selector) ||
             Array.from(document.querySelectorAll('button, a, span, div[role="button"]'))
               .find(e => e.textContent.trim().includes(selector));
  
  if (el) {
    el.click();
    return true;
  }
  return false;
}

// 输入文本
function typeText(selector, text) {
  const el = document.querySelector(selector) ||
             document.querySelector('input:not([type="hidden"]), textarea');
  
  if (el) {
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

// 获取查询结果
function getQueryResult() {
  // 尝试多种方式获取结果
  
  // 1. 表格结果
  const table = document.querySelector('.ant-table-tbody, .result-table tbody');
  if (table) {
    const headers = Array.from(document.querySelectorAll('.ant-table-thead th, .result-table thead th'))
      .map(th => th.textContent.trim());
    const rows = Array.from(table.querySelectorAll('tr')).map(tr =>
      Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())
    );
    
    // 格式化为文本
    let result = headers.join(' | ') + '\n';
    result += '-'.repeat(50) + '\n';
    result += rows.map(r => r.join(' | ')).join('\n');
    
    // 获取总行数
    const total = document.querySelector('.result-count, .ant-pagination-total-text');
    if (total) {
      result += `\n\n共 ${total.textContent}`;
    }
    
    return result;
  }
  
  // 2. 纯文本结果
  const textResult = document.querySelector('.result-preview, .query-result');
  if (textResult) {
    return textResult.textContent.substring(0, 2000);
  }
  
  // 3. 错误信息
  const error = document.querySelector('.ant-message-error, .error-message, .ant-alert-error');
  if (error) {
    return `错误: ${error.textContent}`;
  }
  
  return '未找到查询结果';
}

// 辅助函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 添加浮动按钮（可选）
function addFloatingButton() {
  const btn = document.createElement('div');
  btn.innerHTML = '🤖';
  btn.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 50px;
    height: 50px;
    background: linear-gradient(135deg, #00d9ff, #00ff88);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0, 217, 255, 0.4);
    z-index: 999999;
    transition: transform 0.2s;
  `;
  btn.onmouseenter = () => btn.style.transform = 'scale(1.1)';
  btn.onmouseleave = () => btn.style.transform = 'scale(1)';
  btn.onclick = () => {
    // 发送消息给 popup
    chrome.runtime.sendMessage({ action: 'openPopup' });
  };
  document.body.appendChild(btn);
}

// 页面加载完成后添加浮动按钮
if (document.readyState === 'complete') {
  addFloatingButton();
} else {
  window.addEventListener('load', addFloatingButton);
}
