// 数仓小助手 - 注入到页面 MAIN 上下文的脚本
// 这个文件会被注入到页面的主 JavaScript 上下文中，允许页面脚本直接调用插件功能

(function() {
  // 任务状态跟踪
  if (!window.warehouseAssistantStatus) {
    window.warehouseAssistantStatus = {
      currentTask: null,
      status: 'idle', // idle, running, completed, error
      result: null,
      error: null,
      listeners: []
    };
  }
  
  // 添加状态监听器
  if (!window.onWarehouseAssistantStatusChange) {
    window.onWarehouseAssistantStatusChange = function(callback) {
      window.warehouseAssistantStatus.listeners.push(callback);
    };
  }
  
  // 更新状态显示
  function updateStatusDisplay() {
    let statusEl = document.getElementById('warehouse-assistant-status');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.id = 'warehouse-assistant-status';
      statusEl.style.cssText = 'position: fixed; top: 10px; right: 10px; background: rgba(0, 0, 0, 0.8); color: white; padding: 10px 15px; border-radius: 5px; font-size: 12px; z-index: 999998; max-width: 300px; word-wrap: break-word; font-family: monospace;';
      document.body.appendChild(statusEl);
    }
    
    const status = window.warehouseAssistantStatus;
    let html = '<div style="font-weight: bold; margin-bottom: 5px;">🤖 数仓小助手</div>';
    html += '<div>状态: <span style="color: ' + getStatusColor(status.status) + '">' + getStatusText(status.status) + '</span></div>';
    
    if (status.currentTask) {
      html += '<div style="margin-top: 5px; font-size: 11px; opacity: 0.8;">任务: ' + status.currentTask.substring(0, 50) + '...</div>';
    }
    
    if (status.error) {
      html += '<div style="margin-top: 5px; color: #ff6b6b;">错误: ' + status.error + '</div>';
    }
    
    if (status.result) {
      html += '<div style="margin-top: 5px; color: #51cf66;">结果: ' + (typeof status.result === 'string' ? status.result.substring(0, 100) : JSON.stringify(status.result).substring(0, 100)) + '...</div>';
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
  
  // 监听来自 content script 的状态更新
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'WAREHOUSE_ASSISTANT_STATUS_UPDATE') {
      const status = event.data.status || {};
      Object.assign(window.warehouseAssistantStatus, status);
      
      // 触发状态变化事件
      window.warehouseAssistantStatus.listeners.forEach(cb => {
        try {
          cb(window.warehouseAssistantStatus);
        } catch (e) {
          console.error('状态监听器错误:', e);
        }
      });
      
      window.dispatchEvent(new CustomEvent('warehouseAssistantStatusChange', {
        detail: window.warehouseAssistantStatus
      }));
      
      // 更新状态显示
      updateStatusDisplay();
    }
  });
  
  // 通过 window 全局函数调用（支持等待结果）
  if (!window.callWarehouseAssistant) {
    window.callWarehouseAssistant = function(task, model = 'gpt-4o-mini', options = {}) {
      return new Promise((resolve, reject) => {
        console.log('📞 页面脚本调用数仓小助手:', task);
        console.log('📞 调用参数:', { task, model, options });
        
        // 更新状态
        window.warehouseAssistantStatus.currentTask = task;
        window.warehouseAssistantStatus.status = 'running';
        window.warehouseAssistantStatus.result = null;
        window.warehouseAssistantStatus.error = null;
        updateStatusDisplay();
        
        // 通过 postMessage 与 content script 通信
        const message = {
          type: 'CALL_WAREHOUSE_ASSISTANT',
          task: task,
          model: model,
          options: options
        };
        console.log('📤 发送消息到 content script:', message);
        window.postMessage(message, '*');
        
        // 监听响应
        const timeout = options.timeout || 120000; // 默认2分钟超时
        const startTime = Date.now();
        
        const responseHandler = (event) => {
          if (event.source !== window) return;
          if (event.data && event.data.type === 'WAREHOUSE_ASSISTANT_RESPONSE') {
            window.removeEventListener('message', responseHandler);
            
            // 检查是否是扩展上下文失效错误
            if (event.data.error && event.data.error.includes('Extension context invalidated')) {
              const errorMsg = '扩展上下文已失效，请刷新页面后重试';
              console.error('❌', errorMsg);
              window.warehouseAssistantStatus.status = 'error';
              window.warehouseAssistantStatus.error = errorMsg;
              updateStatusDisplay();
              reject(new Error(errorMsg));
              return;
            }
            
            if (event.data.success) {
              if (options.waitForResult !== false) {
                // 等待结果
                const checkInterval = setInterval(() => {
                  const status = window.warehouseAssistantStatus;
                  
                  if (status.status === 'completed') {
                    clearInterval(checkInterval);
                    resolve(status.result || { status: 'completed' });
                  } else if (status.status === 'error') {
                    clearInterval(checkInterval);
                    reject(new Error(status.error || '任务执行失败'));
                  } else if (Date.now() - startTime > timeout) {
                    clearInterval(checkInterval);
                    reject(new Error('任务执行超时'));
                  }
                }, 500);
              } else {
                resolve(event.data.response || { status: 'started' });
              }
            } else {
              reject(new Error(event.data.error || '调用失败'));
            }
          }
        };
        
        window.addEventListener('message', responseHandler);
        
        // 超时处理
        setTimeout(() => {
          window.removeEventListener('message', responseHandler);
          if (Date.now() - startTime > timeout) {
            reject(new Error('任务执行超时'));
          }
        }, timeout);
      });
    };
  }
  
  // 监听检查请求
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'CHECK_WAREHOUSE_ASSISTANT') {
      window.postMessage({
        type: 'WAREHOUSE_ASSISTANT_CHECK_RESPONSE',
        checkId: event.data.checkId,
        exists: typeof window.callWarehouseAssistant !== 'undefined'
      }, '*');
    }
  });
  
  console.log('✅ 数仓小助手页面调用接口已就绪');
  console.log('   使用: window.callWarehouseAssistant(task, model, options)');
  console.log('   当前状态:', window.warehouseAssistantStatus);
  
  // 监听所有消息，用于调试
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    if (event.data && event.data.type) {
      console.log('📨 Injected script 收到消息:', event.data.type, event.data);
    }
  });
})();
