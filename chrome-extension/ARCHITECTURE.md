# 数仓小助手 - 架构文档

## 📋 目录

1. [架构概览](#架构概览)
2. [核心技能](#核心技能)
3. [实时对话功能](#实时对话功能)
4. [技术细节](#技术细节)

---

## 🏗 架构概览

### 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome 扩展                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐      ┌──────────────┐               │
│  │  popup.html  │      │ background.js│               │
│  │  popup.js    │◄────►│ (Service     │               │
│  │  (UI界面)    │      │  Worker)     │               │
│  └──────────────┘      └──────┬───────┘               │
│                                │                       │
│                                ▼                       │
│                         ┌──────────────┐              │
│                         │ content.js   │              │
│                         │ (内容脚本)    │              │
│                         └──────┬───────┘              │
│                                │                       │
│                                ▼                       │
│                    ┌─────────────────────┐            │
│                    │ injected_script.js  │            │
│                    │ (页面主上下文)       │            │
│                    └─────────────────────┘            │
│                                │                       │
│                                ▼                       │
│                    ┌─────────────────────┐            │
│                    │    chat_ui.js       │            │
│                    │  (聊天窗口UI)        │            │
│                    └─────────────────────┘            │
│                                                         │
└─────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌─────────────────────┐
                    │   神舟平台页面        │
                    │  (shenzhou.tatstm)  │
                    └─────────────────────┘
```

### 组件说明

#### 1. popup.html/js（弹出界面）
- **位置**：`chrome-extension/popup.html`, `popup.js`
- **作用**：扩展的 UI 界面，用户输入任务的地方
- **功能**：
  - 任务输入框
  - 执行按钮
  - 模型选择
  - 日志显示
  - 结果展示

#### 2. background.js（后台服务）
- **位置**：`chrome-extension/background.js`
- **作用**：Service Worker，处理任务执行逻辑
- **功能**：
  - 接收 popup 的任务请求
  - 调用 AI API 获取操作指令
  - 执行浏览器操作（导航、点击、输入等）
  - 管理任务状态和日志
  - 发送结果到 popup

#### 3. content.js（内容脚本）
- **位置**：`chrome-extension/content.js`
- **作用**：注入到页面，桥接扩展和页面
- **功能**：
  - 注入 `injected_script.js` 到页面主上下文
  - 注入 `chat_ui.js` 创建聊天窗口
  - 监听页面消息并转发到 background
  - 更新页面状态显示

#### 4. injected_script.js（页面主上下文脚本）
- **位置**：`chrome-extension/injected_script.js`
- **作用**：在页面主 JavaScript 上下文中运行
- **功能**：
  - 提供 `window.callWarehouseAssistant()` 函数
  - 管理任务状态 `window.warehouseAssistantStatus`
  - 监听状态变化事件
  - 允许页面脚本直接调用扩展功能

#### 5. chat_ui.js（聊天窗口 UI）
- **位置**：`chrome-extension/chat_ui.js`
- **作用**：在页面上创建浮动聊天窗口
- **功能**：
  - 创建聊天界面
  - 处理用户输入
  - 调用扩展功能
  - 显示对话历史
  - 状态更新显示

---

## 🎯 核心技能

### 1. 页面分析
- **能力**：分析当前页面的 DOM 结构、可交互元素、URL 等
- **实现**：`content.js` → `getPageSnapshot()`
- **输出**：页面快照 JSON，包含按钮、输入框、表格等信息

### 2. 自动化操作
- **能力**：执行浏览器操作
- **支持的操作**：
  - `navigate`：导航到指定 URL
  - `click`：点击元素（支持选择器或文本匹配）
  - `type`：输入文本（支持 CodeMirror、Ace、普通输入框）
  - `wait`：等待指定时间
  - `get_result`：获取页面结果
  - `finish`：完成任务

### 3. SQL 查询执行
- **能力**：在神舟临时查询页面执行 SQL
- **流程**：
  1. 导航到查询页面
  2. 输入 SQL（支持 CodeMirror、Ace 编辑器）
  3. 点击格式化按钮
  4. 点击执行按钮
  5. 等待查询完成
  6. 获取结果

### 4. 结果提取
- **能力**：从页面提取查询结果
- **支持格式**：
  - Ant Design 表格
  - 普通 HTML 表格
  - 文本结果
  - 错误信息

### 5. 消息推送
- **能力**：发送结果到企业微信群
- **实现**：通过 Webhook URL 发送消息
- **格式**：支持文本和 Markdown 格式

---

## 💬 实时对话功能

### 功能特点

1. **浮动窗口**：固定在页面右下角，可拖拽
2. **实时对话**：输入问题立即获得回复
3. **状态显示**：显示执行状态（思考中、执行中、完成、错误）
4. **消息历史**：显示对话历史记录
5. **最小化/关闭**：可以最小化或关闭窗口

### 实现方式

#### 1. UI 注入
```javascript
// content.js
function injectChatUI() {
  const chatScript = document.createElement('script');
  chatScript.src = chrome.runtime.getURL('chat_ui.js');
  document.head.appendChild(chatScript);
}
```

#### 2. 消息发送
```javascript
// chat_ui.js
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

#### 3. 状态监听
```javascript
// chat_ui.js
window.addEventListener('warehouseAssistantStatusChange', (event) => {
  const status = event.detail;
  updateStatus(getStatusText(status.status), status.status);
});
```

### 通信流程

```
用户输入问题
    ↓
chat_ui.js 捕获
    ↓
调用 window.callWarehouseAssistant()
    ↓
postMessage → content.js
    ↓
chrome.runtime.sendMessage → background.js
    ↓
background.js 执行任务
    ↓
返回结果 → content.js
    ↓
postMessage → chat_ui.js
    ↓
显示结果
```

---

## 🔧 技术细节

### 消息传递机制

#### 1. popup ↔ background
```javascript
// popup.js → background.js
chrome.runtime.sendMessage({
  type: 'START_TASK',
  task: task,
  model: model
});

// background.js → popup.js
chrome.runtime.sendMessage({
  type: 'LOG_UPDATE',
  log: log
});
```

#### 2. background ↔ content
```javascript
// background.js → content.js
chrome.tabs.sendMessage(tabId, {
  type: 'TASK_STATUS_UPDATE',
  status: status
});

// content.js → background.js
chrome.runtime.sendMessage({
  type: 'START_TASK',
  task: task
});
```

#### 3. content ↔ page (MAIN context)
```javascript
// content.js → page
window.postMessage({
  type: 'WAREHOUSE_ASSISTANT_STATUS_UPDATE',
  status: status
}, '*');

// page → content.js
window.postMessage({
  type: 'CALL_WAREHOUSE_ASSISTANT',
  task: task
}, '*');
```

### AI 调用流程

```
1. 构建系统提示词（包含用户任务和技能文档）
   ↓
2. 调用 Model Router API
   ↓
3. 解析 AI 返回的 JSON 操作指令
   ↓
4. 执行操作（navigate/click/type/wait/get_result）
   ↓
5. 获取操作结果，更新对话历史
   ↓
6. 重复步骤 2-5，直到返回 finish 操作
   ↓
7. 返回最终结果
```

### 操作执行细节

#### SQL 输入（支持多种编辑器）
```javascript
// 1. CodeMirror
cmInstance.setValue(sql);

// 2. Ace Editor
ace.edit(editor).setValue(sql);

// 3. Vue CodeMirror
vueInstance.codemirror.setValue(sql);

// 4. 普通 textarea
textarea.value = sql;
textarea.dispatchEvent(new Event('input'));
```

#### 按钮点击（智能匹配）
```javascript
// 1. CSS 选择器
document.querySelector(selector).click();

// 2. 文本匹配
Array.from(buttons).find(b => 
  b.textContent.includes(text)
).click();

// 3. XPath
document.evaluate(xpath, document).singleNodeValue.click();
```

---

## 📝 配置说明

### manifest.json 关键配置

```json
{
  "permissions": [
    "activeTab",      // 访问当前标签页
    "scripting",      // 注入脚本
    "storage",        // 本地存储
    "tabs"           // 标签页管理
  ],
  "host_permissions": [
    "https://shenzhou.tatstm.com/*",      // 神舟平台
    "https://model-router.meitu.com/*",  // AI API
    "https://qyapi.weixin.qq.com/*"      // 企业微信
  ],
  "content_scripts": [{
    "matches": ["https://shenzhou.tatstm.com/*"],
    "js": ["content.js"]
  }],
  "web_accessible_resources": [{
    "resources": ["injected_script.js", "chat_ui.js"],
    "matches": ["https://shenzhou.tatstm.com/*"]
  }]
}
```

---

## 🚀 使用示例

### 1. 通过 popup 使用
```javascript
// 用户在 popup 输入任务
taskInput.value = "查询 stat_aigc.mpub_odz_aigc_outer_cost 表今天的 cost 总和";
executeBtn.click();

// popup.js 发送到 background
chrome.runtime.sendMessage({
  type: 'START_TASK',
  task: task,
  model: 'gpt-4o-mini'
});
```

### 2. 通过页面脚本使用
```javascript
// 页面脚本直接调用
const result = await window.callWarehouseAssistant(
  "查询 stat_aigc.mpub_odz_aigc_outer_cost 表今天的 cost 总和",
  'gpt-4o-mini',
  { waitForResult: true }
);
console.log(result);
```

### 3. 通过聊天窗口使用
```javascript
// 用户在聊天窗口输入
// chat_ui.js 自动处理
// 显示结果在聊天窗口
```

---

## 🔍 调试技巧

### 1. 查看日志
- popup：打开扩展，查看日志区域
- background：`chrome://extensions/` → 查看视图 → Service Worker
- content：页面控制台（F12）
- page：页面控制台（F12）

### 2. 检查状态
```javascript
// 在页面控制台
console.log(window.warehouseAssistantStatus);
console.log(typeof window.callWarehouseAssistant);
```

### 3. 手动触发
```javascript
// 在页面控制台
window.callWarehouseAssistant("测试任务", 'gpt-4o-mini')
  .then(result => console.log(result))
  .catch(err => console.error(err));
```

---

## 📚 相关文档

- [README.md](./README.md) - 使用说明
- [CHAT_FEATURE.md](./CHAT_FEATURE.md) - 实时对话功能说明
- [CODE_REVIEW.md](./CODE_REVIEW.md) - 代码审查报告

---

Made with ❤️ by 数仓团队
