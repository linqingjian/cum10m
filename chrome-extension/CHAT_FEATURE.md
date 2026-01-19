# 实时对话功能说明

## 功能概述

在神舟平台页面上添加了一个浮动聊天窗口，支持与数仓小助手实时对话。

## 功能特点

1. **浮动窗口**：固定在页面右下角，可拖拽移动
2. **实时对话**：输入问题后立即获得 AI 回复
3. **状态显示**：显示当前执行状态（思考中、执行中、完成、错误）
4. **最小化/关闭**：可以最小化或关闭窗口
5. **自动滚动**：新消息自动滚动到底部

## 使用方法

1. 打开神舟平台页面（https://shenzhou.tatstm.com）
2. 页面右下角会自动出现聊天窗口
3. 在输入框中输入问题，例如：
   - "查询 stat_aigc.mpub_odz_aigc_outer_cost 表今天的 cost 总和"
   - "查看当前页面的表结构"
   - "帮我写一个查询 SQL"
4. 按 Enter 或点击"发送"按钮
5. 等待 AI 处理并返回结果

## 技术实现

### 文件结构

```
chrome-extension/
├── chat_ui.js          # 聊天窗口 UI 和交互逻辑
├── content.js         # 注入聊天 UI 到页面
├── injected_script.js  # 页面主上下文脚本（提供调用接口）
└── manifest.json      # 扩展配置（已更新）
```

### 工作流程

```
用户输入问题
    ↓
chat_ui.js 捕获输入
    ↓
调用 window.callWarehouseAssistant()
    ↓
通过 postMessage 发送到 content.js
    ↓
content.js 转发到 background.js
    ↓
background.js 执行任务
    ↓
返回结果到 content.js
    ↓
通过 postMessage 返回结果
    ↓
chat_ui.js 显示结果
```

### 关键代码

#### 1. 注入聊天 UI（content.js）

```javascript
function injectChatUI() {
  const chatScript = document.createElement('script');
  chatScript.src = chrome.runtime.getURL('chat_ui.js');
  document.head.appendChild(chatScript);
}
```

#### 2. 发送消息（chat_ui.js）

```javascript
async function sendMessage() {
  const question = inputField.value.trim();
  addMessage(question, true);
  
  const result = await window.callWarehouseAssistant(question, 'gpt-4o-mini', {
    waitForResult: true,
    timeout: 120000
  });
  
  addMessage(result, false);
}
```

#### 3. 监听状态更新（chat_ui.js）

```javascript
window.addEventListener('warehouseAssistantStatusChange', (event) => {
  const status = event.detail;
  if (status.status === 'running') {
    updateStatus('执行中...', 'thinking');
  } else if (status.status === 'completed') {
    updateStatus('就绪');
    addMessage(status.result, false);
  }
});
```

## 样式特点

- **现代化设计**：渐变背景、圆角、阴影
- **响应式布局**：自适应内容高度
- **流畅动画**：拖拽、最小化等过渡效果
- **清晰状态**：不同状态用不同颜色标识

## 配置说明

### 模型选择

默认使用 `gpt-4o-mini`，可以在代码中修改：

```javascript
const result = await window.callWarehouseAssistant(question, 'gpt-4o-mini', {
  waitForResult: true,
  timeout: 120000
});
```

### 超时时间

默认 120 秒（2分钟），可以根据需要调整。

## 注意事项

1. **页面刷新**：刷新页面后聊天窗口会重新加载
2. **多标签页**：每个标签页都有独立的聊天窗口
3. **网络要求**：需要能访问 model-router.meitu.com
4. **权限要求**：扩展需要访问神舟平台域名

## 未来改进

1. **消息历史**：保存对话历史，刷新后不丢失
2. **快捷命令**：预设常用查询模板
3. **语音输入**：支持语音输入问题
4. **文件上传**：支持上传 SQL 文件执行
5. **代码高亮**：SQL 和结果格式化显示

## 故障排除

### 聊天窗口不显示

1. 检查扩展是否已加载
2. 检查控制台是否有错误
3. 尝试刷新页面

### 消息发送失败

1. 检查网络连接
2. 检查 API Token 配置
3. 查看控制台错误信息

### 状态不更新

1. 检查 `window.warehouseAssistantStatus` 是否存在
2. 检查事件监听器是否正确绑定
3. 查看 content.js 日志
