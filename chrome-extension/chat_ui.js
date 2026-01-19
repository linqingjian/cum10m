// 数仓小助手 - 实时对话 UI
// 在页面上添加一个浮动聊天窗口

(function() {
  'use strict';
  
  // 检查是否已经创建了聊天窗口
  if (document.getElementById('warehouse-chat-window')) {
    return;
  }
  
  // 创建聊天窗口 HTML
  function createChatWindow() {
    const chatWindow = document.createElement('div');
    chatWindow.id = 'warehouse-chat-window';
    chatWindow.innerHTML = `
      <div class="chat-header">
        <span class="chat-title">🤖 数仓小助手</span>
        <button class="chat-minimize" id="chat-minimize-btn">−</button>
        <button class="chat-close" id="chat-close-btn">×</button>
      </div>
      <div class="chat-messages" id="chat-messages">
        <div class="chat-message bot-message">
          <div class="message-content">
            你好！我是数仓小助手，可以帮你：
            <ul>
              <li>查询数据表信息</li>
              <li>执行 SQL 查询</li>
              <li>查看表结构</li>
              <li>分析任务状态</li>
            </ul>
            有什么可以帮你的吗？
          </div>
        </div>
      </div>
      <div class="chat-input-area">
        <textarea id="chat-input" placeholder="输入你的问题..."></textarea>
        <button id="chat-send-btn">发送</button>
      </div>
      <div class="chat-status" id="chat-status">就绪</div>
    `;
    
    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
      #warehouse-chat-window {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 400px;
        height: 600px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        display: flex;
        flex-direction: column;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        transition: transform 0.3s ease;
      }
      
      #warehouse-chat-window.minimized {
        height: 50px;
        overflow: hidden;
      }
      
      #warehouse-chat-window.minimized .chat-messages,
      #warehouse-chat-window.minimized .chat-input-area {
        display: none;
      }
      
      .chat-header {
        background: linear-gradient(135deg, #00d9ff, #00ff88);
        color: #000;
        padding: 12px 16px;
        border-radius: 12px 12px 0 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: bold;
        cursor: move;
      }
      
      .chat-title {
        flex: 1;
      }
      
      .chat-minimize,
      .chat-close {
        background: transparent;
        border: none;
        color: #000;
        font-size: 20px;
        cursor: pointer;
        padding: 0 8px;
        line-height: 1;
      }
      
      .chat-minimize:hover,
      .chat-close:hover {
        opacity: 0.7;
      }
      
      .chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        background: #f5f5f5;
      }
      
      .chat-message {
        margin-bottom: 16px;
        display: flex;
        flex-direction: column;
      }
      
      .chat-message.user-message {
        align-items: flex-end;
      }
      
      .chat-message.bot-message {
        align-items: flex-start;
      }
      
      .message-content {
        max-width: 80%;
        padding: 10px 14px;
        border-radius: 12px;
        word-wrap: break-word;
        white-space: pre-wrap;
        line-height: 1.5;
      }
      
      .user-message .message-content {
        background: linear-gradient(135deg, #00d9ff, #00ff88);
        color: #000;
      }
      
      .bot-message .message-content {
        background: white;
        color: #333;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }
      
      .message-time {
        font-size: 11px;
        color: #999;
        margin-top: 4px;
        padding: 0 4px;
      }
      
      .chat-input-area {
        padding: 12px;
        background: white;
        border-top: 1px solid #e0e0e0;
        display: flex;
        gap: 8px;
      }
      
      #chat-input {
        flex: 1;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        padding: 10px;
        font-size: 14px;
        resize: none;
        font-family: inherit;
        min-height: 40px;
        max-height: 120px;
      }
      
      #chat-input:focus {
        outline: none;
        border-color: #00d9ff;
      }
      
      #chat-send-btn {
        background: linear-gradient(135deg, #00d9ff, #00ff88);
        color: #000;
        border: none;
        border-radius: 8px;
        padding: 10px 20px;
        font-weight: bold;
        cursor: pointer;
        transition: opacity 0.2s;
      }
      
      #chat-send-btn:hover {
        opacity: 0.9;
      }
      
      #chat-send-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      
      .chat-status {
        padding: 8px 16px;
        background: #f5f5f5;
        border-top: 1px solid #e0e0e0;
        font-size: 12px;
        color: #666;
        text-align: center;
      }
      
      .chat-status.thinking {
        color: #00d9ff;
      }
      
      .chat-status.error {
        color: #ff6b6b;
      }
      
      /* 滚动条样式 */
      .chat-messages::-webkit-scrollbar {
        width: 6px;
      }
      
      .chat-messages::-webkit-scrollbar-track {
        background: #f1f1f1;
      }
      
      .chat-messages::-webkit-scrollbar-thumb {
        background: #888;
        border-radius: 3px;
      }
      
      .chat-messages::-webkit-scrollbar-thumb:hover {
        background: #555;
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(chatWindow);
    
    return chatWindow;
  }
  
  // 创建聊天窗口
  const chatWindow = createChatWindow();
  const messagesContainer = document.getElementById('chat-messages');
  const inputField = document.getElementById('chat-input');
  const sendButton = document.getElementById('chat-send-btn');
  const statusBar = document.getElementById('chat-status');
  const minimizeBtn = document.getElementById('chat-minimize-btn');
  const closeBtn = document.getElementById('chat-close-btn');
  
  // 添加消息到聊天窗口
  function addMessage(content, isUser = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isUser ? 'user-message' : 'bot-message'}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = content;
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    timeDiv.textContent = new Date().toLocaleTimeString('zh-CN');
    
    messageDiv.appendChild(contentDiv);
    messageDiv.appendChild(timeDiv);
    messagesContainer.appendChild(messageDiv);
    
    // 滚动到底部
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  
  // 更新状态栏
  function updateStatus(text, type = 'normal') {
    statusBar.textContent = text;
    statusBar.className = `chat-status ${type}`;
  }
  
  // 发送消息
  async function sendMessage() {
    const question = inputField.value.trim();
    if (!question) return;
    
    // 显示用户消息
    addMessage(question, true);
    inputField.value = '';
    sendButton.disabled = true;
    updateStatus('思考中...', 'thinking');
    
    try {
      // 调用数仓小助手
      if (typeof window.callWarehouseAssistant === 'function') {
        // 使用页面注入的函数
        const result = await window.callWarehouseAssistant(question, 'gpt-4o-mini', {
          waitForResult: true,
          timeout: 120000
        });
        
        // 显示结果
        const answer = typeof result === 'string' ? result : JSON.stringify(result);
        addMessage(answer, false);
        updateStatus('就绪');
      } else {
        // 通过 postMessage 调用
        const response = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('请求超时'));
          }, 120000);
          
          const handler = (event) => {
            if (event.source !== window) return;
            if (event.data && event.data.type === 'WAREHOUSE_ASSISTANT_RESPONSE') {
              clearTimeout(timeout);
              window.removeEventListener('message', handler);
              
              if (event.data.success) {
                // 等待任务完成
                const checkInterval = setInterval(() => {
                  if (window.warehouseAssistantStatus) {
                    const status = window.warehouseAssistantStatus;
                    if (status.status === 'completed') {
                      clearInterval(checkInterval);
                      resolve(status.result || '任务完成');
                    } else if (status.status === 'error') {
                      clearInterval(checkInterval);
                      reject(new Error(status.error || '任务失败'));
                    }
                  }
                }, 500);
              } else {
                reject(new Error(event.data.error || '调用失败'));
              }
            }
          };
          
          window.addEventListener('message', handler);
          
          // 发送请求
          window.postMessage({
            type: 'CALL_WAREHOUSE_ASSISTANT',
            task: question,
            model: 'gpt-4o-mini',
            options: {}
          }, '*');
        });
        
        addMessage(response, false);
        updateStatus('就绪');
      }
    } catch (error) {
      console.error('发送消息失败:', error);
      addMessage(`错误: ${error.message}`, false);
      updateStatus('错误', 'error');
    } finally {
      sendButton.disabled = false;
      inputField.focus();
    }
  }
  
  // 绑定事件
  sendButton.addEventListener('click', sendMessage);
  inputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  // 最小化/恢复
  minimizeBtn.addEventListener('click', () => {
    chatWindow.classList.toggle('minimized');
    minimizeBtn.textContent = chatWindow.classList.contains('minimized') ? '+' : '−';
  });
  
  // 关闭（隐藏）
  closeBtn.addEventListener('click', () => {
    chatWindow.style.display = 'none';
  });
  
  // 拖拽功能
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;
  
  const header = chatWindow.querySelector('.chat-header');
  
  header.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);
  
  function dragStart(e) {
    if (e.target === minimizeBtn || e.target === closeBtn) return;
    
    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;
    
    if (e.target === header || header.contains(e.target)) {
      isDragging = true;
    }
  }
  
  function drag(e) {
    if (isDragging) {
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      
      xOffset = currentX;
      yOffset = currentY;
      
      chatWindow.style.transform = `translate(${currentX}px, ${currentY}px)`;
    }
  }
  
  function dragEnd(e) {
    initialX = currentX;
    initialY = currentY;
    isDragging = false;
  }
  
  // 监听状态更新
  window.addEventListener('warehouseAssistantStatusChange', (event) => {
    const status = event.detail;
    if (status.status === 'running') {
      updateStatus('执行中...', 'thinking');
    } else if (status.status === 'completed') {
      updateStatus('就绪');
      if (status.result) {
        addMessage(status.result, false);
      }
    } else if (status.status === 'error') {
      updateStatus('错误', 'error');
      if (status.error) {
        addMessage(`错误: ${status.error}`, false);
      }
    }
  });
  
  console.log('✅ 数仓小助手聊天窗口已加载');
})();
