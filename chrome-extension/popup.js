// 数仓小助手 Chrome 扩展 - 主逻辑

const STORAGE_PREFIX = 'ai_assistant_';
const storageKey = (key) => `${STORAGE_PREFIX}${key}`;
const readStoredValue = (result, key) => {
  const prefixed = storageKey(key);
  return result[prefixed] ?? result[key];
};
const CUSTOM_SKILLS_STORAGE_KEY = storageKey('customSkills');
const DEFAULT_API_URL = 'https://model-router.meitu.com/v1';

// 系统提示词 - 整合完整 Skills
const SYSTEM_PROMPT = `你是美图公司数仓团队的 AI 助手 "数仓小助手"，负责在神舟大数据平台上执行数据查询和任务管理。

## 你的主人
蔺清建（linqingjian@meitu.com），数仓工程师，负责 RoboNeo、外采成本、素材中台、活跃宽表。

## 核心能力
1. 分析当前页面内容
2. 决定下一步操作（导航、点击、输入、等待）
3. 执行 SQL 查询并获取结果
4. 查看表结构和血缘关系
5. 查看任务执行状态和日志
6. 重跑失败任务
7. 查看任务 DAG 依赖关系
8. 搜索和获取 Confluence 页面内容

---

## 神舟平台 URL（重要！）

| 功能 | URL |
|-----|-----|
| 临时查询 | https://shenzhou.tatstm.com/data-develop/query |
| 数据地图 | https://shenzhou.tatstm.com/data-manage/tables |
| 表详情 | https://shenzhou.tatstm.com/data-manage/tables/table?tableName={表名}&databaseName={库名} |
| 任务列表 | https://shenzhou.tatstm.com/data-develop/tasks |
| 任务开发 | https://shenzhou.tatstm.com/data-develop/dev |
| 任务实例 | https://shenzhou.tatstm.com/data-develop/instances |

**快捷方式**：可以直接构造表详情 URL，例如：
\`https://shenzhou.tatstm.com/data-manage/tables/table?tableName=mpub_odz_aigc_outer_cost&databaseName=stat_aigc\`

---

## 分区处理规范（必须遵守！）

| 分区字段 | 格式 | 示例 |
|---------|------|------|
| date_p | 'yyyyMMdd' | date_p = '20260101' 或 date_p >= '20260101' AND date_p <= '20260110' |
| type_p | >= '0000' | AND type_p >= '0000'（匹配所有类型）|
| hour_p | 'HH' | AND hour_p = '10' |

**重要**：当表有 type_p 分区时，必须加上 \`AND type_p >= '0000'\`

---

## SQL 查询模板

### 基础统计查询
\`\`\`sql
SELECT
  SUM(cost) AS total_cost,
  COUNT(*) AS row_count
FROM
  库名.表名
WHERE
  date_p >= '开始日期'
  AND date_p <= '结束日期'
  AND type_p >= '0000'
\`\`\`

### 按日期分组统计
\`\`\`sql
SELECT
  date_p,
  SUM(cost) AS total_cost,
  COUNT(*) AS row_count
FROM
  库名.表名
WHERE
  date_p >= '开始日期'
  AND date_p <= '结束日期'
  AND type_p >= '0000'
GROUP BY
  date_p
ORDER BY
  date_p
\`\`\`

---

## 执行引擎选择

| 引擎 | 适用场景 | 特点 |
|-----|---------|------|
| Presto | 简单查询、快速响应 | 速度快，默认使用 |
| SparkSql | 复杂查询、大数据量 | 稳定，适合大查询 |
| Hive | 超大数据量 | 最稳定，速度较慢 |

---

## 操作流程

### 执行数据查询
1. navigate → 临时查询页面
2. 如有"恢复缓存"提示 → click "放弃"
3. type → 在 SQL 编辑器输入查询
4. click → 点击"格式化"
5. click → 点击"执行"
6. wait → 等待 5000ms
7. get_result → 获取查询结果
8. done → 返回最终结果

### 查看表信息
1. navigate → 表详情页面（直接构造 URL）
2. get_result → 获取表结构信息
3. 如需血缘关系 → click "血缘关系" Tab
4. done → 返回表信息

### 查看任务
1. navigate → 任务列表
2. type → 在搜索框输入任务名
3. click → 点击搜索结果
4. get_result → 获取任务信息

### 重跑任务
1. navigate → 任务实例页面
2. 找到失败的实例
3. click_rerun → 点击重跑按钮（rerun_type: "latest" 或 "instance"）
4. wait → 等待重跑选项弹窗
5. click → 选择重跑方式
6. click → 点击确认
7. finish → 返回重跑结果

### 查看任务 DAG
1. navigate → 任务列表或任务开发页面
2. click_dag_view → 点击"可视化"或"DAG"按钮
3. wait → 等待 DAG 图加载
4. get_dag_info → 获取 DAG 节点和依赖关系
5. finish → 返回 DAG 信息

### 搜索 Confluence 页面
1. confluence_search → 搜索关键词（query: "搜索词"）
2. finish → 返回搜索结果列表

### 获取 Confluence 页面内容
1. confluence_get_content → 获取页面内容（page_id: "页面ID"）
2. finish → 返回页面标题和内容

---

## 输出格式（严格遵守！）

返回 JSON 格式的操作指令：
\`\`\`json
{
  "action": "navigate|click|type|wait|get_result|done",
  "target": "URL或元素选择器或等待时间(ms)",
  "value": "输入的值（type操作时需要）",
  "thinking": "简短说明你在做什么",
  "result": "最终结果（done操作时需要）"
}
\`\`\`

### 操作说明
- **navigate**: 导航到指定 URL（会在新标签页打开）
- **click**: 点击元素（支持选择器或按钮文本）
- **type**: 在输入框输入文本
- **wait**: 等待指定毫秒数
- **get_result**: 获取页面上的数据
- **done**: 任务完成，返回最终结果

---

## 错误处理

| 错误 | 解决方案 |
|-----|---------|
| 分区条件未填 | 添加 date_p 和 type_p >= '0000' 条件 |
| 表不存在 | 检查库名.表名拼写 |
| 无权限 | 切换项目组或申请权限 |
| 查询超时 | 切换到 SparkSql 引擎 |

---

## 示例

### 用户请求：查询 stat_aigc.mpub_odz_aigc_outer_cost 表 20260101-20260110 的 cost 总和

**你的操作序列**：

1. {"action": "navigate", "target": "https://shenzhou.tatstm.com/data-develop/query", "thinking": "打开临时查询页面"}

2. {"action": "type", "target": ".ace_text-input", "value": "SELECT SUM(cost) AS total_cost, COUNT(*) AS row_count FROM stat_aigc.mpub_odz_aigc_outer_cost WHERE date_p >= '20260101' AND date_p <= '20260110' AND type_p >= '0000'", "thinking": "输入 SQL"}

3. {"action": "click", "target": "执行", "thinking": "执行查询"}

4. {"action": "wait", "target": "5000", "thinking": "等待查询完成"}

5. {"action": "get_result", "target": ".result-table", "thinking": "获取结果"}

6. {"action": "done", "result": "cost 总和: 3,935,433.46，数据条数: 11,202,560", "thinking": "任务完成"}

---

**重要提醒**：
1. 必须返回有效的 JSON
2. 分区条件必须完整
3. **尽量减少步骤数量，能一步完成就不要分多步**
4. **如果页面已在临时查询且有结果，直接 get_result 然后 done**
5. **wait 时间不要超过 3000ms**
6. 使用中文回复 thinking

**快速完成策略**：
- 如果用户问的是简单查询，直接生成 SQL 并返回 done（不需要实际执行）
- 如果需要执行查询：navigate → type → click → wait(3000) → get_result → done（最多6步）`;

// DOM 元素
let statusBar, taskInput, executeBtn, sendBtn, outputArea;
let apiUrl, apiToken, model, webhookUrl, confluenceToken, weeklyReportRootPageId;
let verboseLogsToggle;
let resultSection, resultIcon, resultTitle, resultContent;
// 聊天相关元素
let chatMessages, chatInput, chatSendBtn, chatStatus;
let chatTab, logsTab;
let chatModeSelect, chatShowPlanToggle, chatIncludePageContextToggle;
let chatSyncPageButton;
let pinBtn, pauseBtn, resumeBtn, cancelBtn;
let attachBtn, screenshotBtn, fileInput, attachmentBar;
let skillNameInput, skillDescInput, skillPromptInput, skillSaveBtn, skillCancelBtn, skillsList;

let pendingAttachments = [];
let pendingExecAfterCancel = null; // { taskWithAttachments, originalText, preferShenzhou, skillMentions }
let pendingExecCheckTimer = null;
let pendingExecRetryCount = 0;
let chatHistory = []; // [{role, content, ts}]
let customSkills = [];
let editingSkillId = null;

function saveChatHistory() {
  try {
    chrome.storage.local.set({ chatHistory: chatHistory.slice(-40) });
  } catch (e) {
    // ignore
  }
}

function pushChatHistory(role, content) {
  const text = String(content || '').trim();
  if (!text) return;
  // 不把超长附件原文塞进记忆
  const clipped = text.length > 6000 ? `${text.slice(0, 6000)}\n\n[已截断]` : text;
  chatHistory.push({ role, content: clipped, ts: Date.now() });
  if (chatHistory.length > 40) chatHistory = chatHistory.slice(-40);
  saveChatHistory();
}

function buildContextText(maxItems = 12) {
  const items = (chatHistory || []).slice(-maxItems);
  if (items.length === 0) return '';
  return items
    .map(m => `${m.role === 'user' ? '用户' : '助手'}：${String(m.content || '').replace(/\s+$/g, '')}`)
    .join('\n');
}

function normalizeSkillHandle(value) {
  return String(value || '')
    .replace(/^@+/, '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function getSkillHandle(skill) {
  return normalizeSkillHandle(skill?.handle || skill?.name || '');
}

function extractSkillMentions(text) {
  const normalized = String(text || '');
  const regex = /@([\w\u4e00-\u9fa5_-]+)/g;
  const mentions = new Set();
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const handle = normalizeSkillHandle(match[1]);
    if (handle) mentions.add(handle);
  }
  return Array.from(mentions);
}

function getMissingSkillMentions(mentions) {
  const handles = new Set((customSkills || []).map(getSkillHandle).filter(Boolean));
  return (mentions || []).filter(m => !handles.has(normalizeSkillHandle(m)));
}

function loadCustomSkills() {
  chrome.storage.local.get([CUSTOM_SKILLS_STORAGE_KEY, 'customSkills'], (result) => {
    const stored = readStoredValue(result, 'customSkills');
    customSkills = Array.isArray(stored)
      ? stored.map(skill => ({
        ...skill,
        handle: getSkillHandle(skill) || normalizeSkillHandle(skill?.name || '')
      }))
      : [];
    renderSkillsList();
  });
}

function saveCustomSkills() {
  chrome.storage.local.set({ [CUSTOM_SKILLS_STORAGE_KEY]: customSkills });
}

function resetSkillForm() {
  editingSkillId = null;
  if (skillNameInput) skillNameInput.value = '';
  if (skillDescInput) skillDescInput.value = '';
  if (skillPromptInput) skillPromptInput.value = '';
  if (skillSaveBtn) skillSaveBtn.textContent = '保存技能';
}

function renderSkillsList() {
  if (!skillsList) return;
  skillsList.innerHTML = '';
  if (!customSkills || customSkills.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'skill-item';
    empty.textContent = '暂无自定义技能，添加后可用 @技能名 调用。';
    skillsList.appendChild(empty);
    return;
  }

  customSkills.forEach((skill) => {
    const item = document.createElement('div');
    item.className = 'skill-item';

    const header = document.createElement('div');
    header.className = 'skill-item-header';

    const title = document.createElement('div');
    title.className = 'skill-item-title';
    const handle = getSkillHandle(skill);
    title.textContent = handle ? `${skill.name} (@${handle})` : skill.name;

    const actions = document.createElement('div');
    actions.className = 'skill-item-actions';

    const toggleLabel = document.createElement('label');
    toggleLabel.style.display = 'inline-flex';
    toggleLabel.style.alignItems = 'center';
    toggleLabel.style.gap = '4px';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = skill.enabled !== false;
    toggle.addEventListener('change', () => {
      skill.enabled = toggle.checked;
      saveCustomSkills();
    });
    const toggleText = document.createElement('span');
    toggleText.style.fontSize = '11px';
    toggleText.textContent = '启用';
    toggleLabel.appendChild(toggle);
    toggleLabel.appendChild(toggleText);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', () => {
      editingSkillId = skill.id;
      if (skillNameInput) skillNameInput.value = skill.name || '';
      if (skillDescInput) skillDescInput.value = skill.description || '';
      if (skillPromptInput) skillPromptInput.value = skill.prompt || '';
      if (skillSaveBtn) skillSaveBtn.textContent = '保存修改';
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = '删除';
    deleteBtn.addEventListener('click', () => {
      customSkills = customSkills.filter(s => s.id !== skill.id);
      saveCustomSkills();
      renderSkillsList();
      if (editingSkillId === skill.id) resetSkillForm();
    });

    actions.appendChild(toggleLabel);
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    header.appendChild(title);
    header.appendChild(actions);

    const desc = document.createElement('div');
    desc.className = 'skill-item-desc';
    desc.textContent = skill.description || '（暂无描述）';

    const hint = document.createElement('div');
    hint.className = 'skill-hint';
    hint.textContent = skill.prompt ? `说明: ${skill.prompt}` : '说明: -';

    item.appendChild(header);
    item.appendChild(desc);
    item.appendChild(hint);
    skillsList.appendChild(item);
  });
}

function upsertSkillFromForm() {
  const name = skillNameInput?.value?.trim();
  const description = skillDescInput?.value?.trim();
  const prompt = skillPromptInput?.value?.trim();

  if (!name) {
    if (skillNameInput) skillNameInput.focus();
    return;
  }

  if (editingSkillId) {
    const existing = customSkills.find(skill => skill.id === editingSkillId);
    if (existing) {
      existing.name = name;
      existing.description = description || '';
      existing.prompt = prompt || '';
      existing.handle = getSkillHandle({ name });
    }
  } else {
    customSkills.unshift({
      id: `skill_${Date.now()}`,
      name,
      description: description || '',
      prompt: prompt || '',
      handle: getSkillHandle({ name }),
      enabled: true
    });
  }

  saveCustomSkills();
  renderSkillsList();
  resetSkillForm();
}

// 当前操作的标签页 ID（支持在新标签页操作）
let currentTabId = null;
let lastSubmittedTask = null;
let isTaskRunning = false;
let chatExecActive = false;
let chatExecLogs = [];
let chatExecBubbleEl = null;
let chatExecLastFlushTs = 0;
let lastPolledLogIndex = 0;
let autoSyncTimer = null;
let autoSyncInFlight = false;
let lastAutoSyncAt = 0;
let chatStreamRequestId = null;
let chatStreamBuffer = '';
let chatStreamBubbleEl = null;

function isVerboseLogsEnabled() {
  return !!verboseLogsToggle?.checked;
}

function shouldShowLogItem(logItem) {
  if (isVerboseLogsEnabled()) return true;
  const type = (logItem?.type || '').toLowerCase();
  const msg = String(logItem?.message || '');

  // 只保留关键进度/结果/错误
  const keepTypes = new Set(['action', 'success', 'error', 'warn', 'warning', 'result']);
  if (keepTypes.has(type)) return true;

  // 丢掉大段噪音（debug/info）
  const noisy = [
    'messages 数量',
    'messages 总字符数',
    '估计 token',
    'SQL 完整长度',
    '找到 ',
    '候选',
    '调试信息',
    '准备调用 AI',
    '响应键',
    '完整响应',
    'choice 对象'
  ];
  if (noisy.some(k => msg.includes(k))) return false;

  // 默认不显示 info
  if (type === 'info') return false;

  return false;
}

function flushChatExecLogs(force = false) {
  if (!chatExecActive || !chatExecBubbleEl || !chatMessages) return;
  const now = Date.now();
  if (!force && now - chatExecLastFlushTs < 250) return;
  chatExecLastFlushTs = now;

  const maxLines = 25;
  const lines = chatExecLogs.slice(-maxLines);
  chatExecBubbleEl.textContent = `执行中…\n${lines.join('\n')}`;
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendChatExecLog(line) {
  if (!chatExecActive) return;
  const text = String(line || '').trim();
  if (!text) return;
  chatExecLogs.push(`[${new Date().toLocaleTimeString('zh-CN')}] ${text}`);
  flushChatExecLogs(false);
}

// 通过 Port 保持 MV3 Service Worker 存活，避免长任务中途被挂起
let keepAlivePort = null;
let keepAliveTimer = null;
function ensureKeepAlivePort() {
  try {
    if (keepAlivePort) return;
    keepAlivePort = chrome.runtime.connect({ name: 'popup-keepalive' });
    keepAlivePort.onDisconnect.addListener(() => {
      keepAlivePort = null;
      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
      // popup 仍在时尝试重连
      setTimeout(() => ensureKeepAlivePort(), 500);
    });
    
    // 定期 ping，避免 MV3 service worker 因空闲被挂起（Chrome 可能不会因仅保持 Port 而持续活跃）
    if (!keepAliveTimer) {
      keepAliveTimer = setInterval(() => {
        try {
          keepAlivePort?.postMessage({ type: 'PING', t: Date.now() });
        } catch (e) {
          // ignore
        }
      }, 25_000);
    }
  } catch (e) {
    keepAlivePort = null;
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  ensureKeepAlivePort();
  
  statusBar = document.getElementById('statusBar');
  taskInput = document.getElementById('taskInput');
  executeBtn = document.getElementById('executeBtn');
  sendBtn = document.getElementById('sendBtn');
  exportLogsBtn = document.getElementById('exportLogsBtn');
  clearLogsBtn = document.getElementById('clearLogsBtn');
  outputArea = document.getElementById('outputArea');
  apiToken = document.getElementById('apiToken');
  apiUrl = document.getElementById('apiUrl');
  confluenceToken = document.getElementById('confluenceToken');
  weeklyReportRootPageId = document.getElementById('weeklyReportRootPageId');
  
  // 检查是否是自动执行模式（从 popup 跳转过来）
  const urlParams = new URLSearchParams(window.location.search);
  const isAutoRun = urlParams.get('autorun') === 'true';
  model = document.getElementById('model');
  webhookUrl = document.getElementById('webhookUrl');
  verboseLogsToggle = document.getElementById('verboseLogs');
  
  // 结果展示区元素
  resultSection = document.getElementById('resultSection');
  resultIcon = document.getElementById('resultIcon');
  resultTitle = document.getElementById('resultTitle');
  resultContent = document.getElementById('resultContent');
  
  // 聊天相关元素
  chatMessages = document.getElementById('chatMessages');
  chatInput = document.getElementById('chatInput');
  chatSendBtn = document.getElementById('chatSendBtn');
  chatStatus = document.getElementById('chatStatus');
  chatTab = document.querySelector('[data-tab="chat"]');
  logsTab = document.querySelector('[data-tab="logs"]');
  chatModeSelect = document.getElementById('chatMode');
  chatShowPlanToggle = document.getElementById('chatShowPlan');
  chatIncludePageContextToggle = document.getElementById('chatIncludePageContext');
  chatSyncPageButton = document.getElementById('chatSyncPage');
  pinBtn = document.getElementById('pinBtn');
  pauseBtn = document.getElementById('pauseBtn');
  resumeBtn = document.getElementById('resumeBtn');
  cancelBtn = document.getElementById('cancelBtn');
  attachBtn = document.getElementById('attachBtn');
  screenshotBtn = document.getElementById('screenshotBtn');
  fileInput = document.getElementById('fileInput');
  attachmentBar = document.getElementById('attachmentBar');
  skillNameInput = document.getElementById('skillNameInput');
  skillDescInput = document.getElementById('skillDescInput');
  skillPromptInput = document.getElementById('skillPromptInput');
  skillSaveBtn = document.getElementById('skillSaveBtn');
  skillCancelBtn = document.getElementById('skillCancelBtn');
  skillsList = document.getElementById('skillsList');
  
  // 设置欢迎消息时间
  const welcomeTime = document.getElementById('welcomeTime');
  if (welcomeTime) {
    welcomeTime.textContent = new Date().toLocaleTimeString('zh-CN');
  }
  
  // 加载保存的配置
  const configKeys = ['apiUrl', 'apiToken', 'model', 'webhookUrl', 'confluenceToken', 'weeklyReportRootPageId', 'verboseLogs', 'chatShowPlan'];
  chrome.storage.local.get(configKeys.flatMap(key => [key, storageKey(key)]), (result) => {
    const apiUrlValue = readStoredValue(result, 'apiUrl');
    const apiTokenValue = readStoredValue(result, 'apiToken');
    const modelValue = readStoredValue(result, 'model');
    const webhookValue = readStoredValue(result, 'webhookUrl');
    const confluenceValue = readStoredValue(result, 'confluenceToken');
    const weeklyRootValue = readStoredValue(result, 'weeklyReportRootPageId');
    const verboseLogsValue = readStoredValue(result, 'verboseLogs');
    const chatShowPlanValue = readStoredValue(result, 'chatShowPlan');

    if (apiUrl) apiUrl.value = apiUrlValue || DEFAULT_API_URL;
    if (apiTokenValue) apiToken.value = apiTokenValue;
    if (modelValue) model.value = modelValue;
    if (webhookValue) webhookUrl.value = webhookValue;
    if (confluenceValue) confluenceToken.value = confluenceValue;
    if (weeklyRootValue && weeklyReportRootPageId) weeklyReportRootPageId.value = weeklyRootValue;
    if (typeof verboseLogsValue === 'boolean' && verboseLogsToggle) verboseLogsToggle.checked = verboseLogsValue;
    if (chatShowPlanToggle) {
      if (typeof chatShowPlanValue === 'boolean') {
        chatShowPlanToggle.checked = chatShowPlanValue;
      } else {
        chatShowPlanToggle.checked = true;
      }
    }
  });

  // 加载会话上下文
  chrome.storage.local.get(['chatHistory'], (result) => {
    if (Array.isArray(result.chatHistory)) {
      chatHistory = result.chatHistory;
    }
  });

  loadCustomSkills();
  if (skillSaveBtn) skillSaveBtn.addEventListener('click', upsertSkillFromForm);
  if (skillCancelBtn) skillCancelBtn.addEventListener('click', resetSkillForm);
  
  // 保存配置
  [apiUrl, apiToken, model, webhookUrl, confluenceToken, weeklyReportRootPageId, verboseLogsToggle, chatShowPlanToggle].forEach(el => {
    if (el) el.addEventListener('change', saveConfig);
  });
  
  // 快捷按钮
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.task) {
        taskInput.value = btn.dataset.task;
      }
    });
  });
  
  // 标签页切换
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      // 切换标签按钮状态
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      // 切换标签内容
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(`${tabName}Tab`).classList.add('active');

      if (tabName === 'chat') {
        startAutoSyncLoop();
        autoSyncPageContext({ silent: true });
      } else {
        stopAutoSyncLoop();
      }
    });
  });
  
  // 聊天功能
  function copyTextToClipboard(text) {
    const content = String(text || '');
    if (!content) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(content).catch(() => {});
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = content;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      // ignore
    }
    document.body.removeChild(textarea);
  }

  function createCodeBlockElement(code, lang) {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';

    const header = document.createElement('div');
    header.className = 'code-block-header';

    const label = document.createElement('span');
    label.className = 'lang';
    label.textContent = lang ? lang : 'TEXT';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'code-copy-btn';
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', () => {
      copyTextToClipboard(code);
      copyBtn.textContent = '已复制';
      setTimeout(() => {
        copyBtn.textContent = '复制';
      }, 1200);
    });

    header.appendChild(label);
    header.appendChild(copyBtn);

    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    codeEl.textContent = code;
    pre.appendChild(codeEl);

    wrapper.appendChild(header);
    wrapper.appendChild(pre);
    return wrapper;
  }

  function renderMessageContent(container, text) {
    if (!container) return;
    container.innerHTML = '';
    const rawText = String(text || '');
    if (!rawText) return;

    const normalized = rawText.replace(/\r\n/g, '\n');
    const regex = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;
    const fragment = document.createDocumentFragment();

    while ((match = regex.exec(normalized)) !== null) {
      const [full, lang, code] = match;
      if (match.index > lastIndex) {
        const textPart = normalized.slice(lastIndex, match.index);
        fragment.appendChild(document.createTextNode(textPart));
      }

      const cleanCode = String(code || '').replace(/\n$/, '');
      fragment.appendChild(createCodeBlockElement(cleanCode, lang));
      lastIndex = match.index + full.length;
    }

    if (lastIndex < normalized.length) {
      fragment.appendChild(document.createTextNode(normalized.slice(lastIndex)));
    }

    container.appendChild(fragment);
  }

  function addChatMessage(text, isUser = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isUser ? 'user-message' : 'bot-message'}`;
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    renderMessageContent(bubble, text);
    
    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = new Date().toLocaleTimeString('zh-CN');
    
    messageDiv.appendChild(bubble);
    messageDiv.appendChild(time);
    chatMessages.appendChild(messageDiv);
    
    // 滚动到底部
    chatMessages.scrollTop = chatMessages.scrollHeight;

    pushChatHistory(isUser ? 'user' : 'assistant', text);
  }

  function addUserMessageWithAttachments(text, attachments) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message user-message';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (text) {
      const textDiv = document.createElement('div');
      renderMessageContent(textDiv, text);
      bubble.appendChild(textDiv);
    }

    const list = Array.isArray(attachments) ? attachments : [];
    if (list.length > 0) {
      const attachmentsDiv = document.createElement('div');
      attachmentsDiv.className = 'message-attachments';
      list.forEach(att => {
        if (att.kind === 'image' && att.dataUrl) {
          const img = document.createElement('img');
          img.className = 'message-attachment-image';
          img.src = att.dataUrl;
          img.alt = att.name || 'image';
          attachmentsDiv.appendChild(img);
        } else {
          const fileChip = document.createElement('div');
          fileChip.className = 'message-attachment-file';
          fileChip.textContent = `📎 ${att.name || '附件'}`;
          attachmentsDiv.appendChild(fileChip);
        }
      });
      bubble.appendChild(attachmentsDiv);
    }

    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = new Date().toLocaleTimeString('zh-CN');

    messageDiv.appendChild(bubble);
    messageDiv.appendChild(time);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    const names = list.map(att => att.name || '附件').join(', ');
    const historyText = text || (list.some(att => att.kind === 'image') ? '（发送图片）' : '（发送附件）');
    const historyEntry = names ? `${historyText} [附件: ${names}]` : historyText;
    pushChatHistory('user', historyEntry);
  }

  function createUpdatableBotMessage(initialText) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message bot-message';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = initialText || '';

    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = new Date().toLocaleTimeString('zh-CN');

    messageDiv.appendChild(bubble);
    messageDiv.appendChild(time);
    chatMessages.appendChild(messageDiv);

    chatMessages.scrollTop = chatMessages.scrollHeight;
    return bubble;
  }

  function normalizePlanSections(replyText) {
    const text = String(replyText || '').trim();
    if (!text) return { answer: '', plan: '' };

    const markers = ['【思路】', '思路：', '思路:'];
    let idx = -1;
    let marker = '';
    for (const m of markers) {
      idx = text.indexOf(m);
      if (idx !== -1) {
        marker = m;
        break;
      }
    }
    if (idx === -1) return { answer: text, plan: '' };

    const answer = text.slice(0, idx).trim();
    const plan = text.slice(idx + marker.length).trim();
    return { answer, plan };
  }

  function addBotReplyWithOptionalPlan(replyText) {
    const { answer, plan } = normalizePlanSections(replyText);
    if (!plan) {
      addChatMessage(answer || replyText || '', false);
      return;
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message bot-message';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const answerDiv = document.createElement('div');
    renderMessageContent(answerDiv, answer || '');

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '思路（点击展开）';
    const planDiv = document.createElement('div');
    planDiv.style.marginTop = '8px';
    planDiv.style.whiteSpace = 'pre-wrap';
    planDiv.textContent = plan;
    details.appendChild(summary);
    details.appendChild(planDiv);

    if (chatShowPlanToggle?.checked) {
      details.open = true;
    }

    bubble.appendChild(answerDiv);
    bubble.appendChild(details);

    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = new Date().toLocaleTimeString('zh-CN');

    messageDiv.appendChild(bubble);
    messageDiv.appendChild(time);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // 记忆里保存完整原文（包含思路），便于连续对话
    pushChatHistory('assistant', replyText);
  }

  function renderBotReplyIntoBubble(bubble, replyText) {
    if (!bubble) return;
    const { answer, plan } = normalizePlanSections(replyText);
    bubble.innerHTML = '';
    const answerDiv = document.createElement('div');
    renderMessageContent(answerDiv, answer || replyText || '');
    bubble.appendChild(answerDiv);
    if (plan) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = '思路（点击展开）';
      const planDiv = document.createElement('div');
      planDiv.style.marginTop = '8px';
      planDiv.style.whiteSpace = 'pre-wrap';
      planDiv.textContent = plan;
      details.appendChild(summary);
      details.appendChild(planDiv);
      if (chatShowPlanToggle?.checked) {
        details.open = true;
      }
      bubble.appendChild(details);
    }
  }

  function updateChatStatus(text, type = '') {
    chatStatus.textContent = text;
    chatStatus.className = `chat-status ${type}`;
  }

  function clearPendingExecCheck() {
    if (pendingExecCheckTimer) {
      clearTimeout(pendingExecCheckTimer);
      pendingExecCheckTimer = null;
    }
    pendingExecRetryCount = 0;
  }

  function schedulePendingExecCheck() {
    clearPendingExecCheck();
    const check = () => {
      if (!pendingExecAfterCancel) return;
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (resp?.status === 'idle') {
          kickoffPendingExec(pendingExecAfterCancel);
          return;
        }
        pendingExecRetryCount += 1;
        if (pendingExecRetryCount < 6) {
          pendingExecCheckTimer = setTimeout(check, 700);
        }
      });
    };
    pendingExecCheckTimer = setTimeout(check, 700);
  }

  function kickoffPendingExec(pending) {
    if (!pending) return;
    pendingExecAfterCancel = null;
    clearPendingExecCheck();
    updateChatStatus('开始新任务...', 'thinking');
    chatExecActive = true;
    chatExecLogs = [];
    chatExecBubbleEl = createUpdatableBotMessage('收到，我开始在浏览器里执行…\n（执行日志会在这里滚动输出）');
    chatExecLastFlushTs = 0;
    if (taskInput) taskInput.value = pending.taskWithAttachments;
    lastSubmittedTask = pending.originalText;
    isTaskRunning = true;
    setTaskControlButtons({ running: true, paused: false });
    chrome.runtime.sendMessage({
      type: 'START_TASK',
      task: pending.taskWithAttachments,
      model: model.value || 'gpt-4o-mini',
      confluenceToken: confluenceToken?.value || null,
      preferShenzhou: pending.preferShenzhou,
      contextText: buildContextText(12),
      skillMentions: pending.skillMentions || []
    }, () => {
      if (chrome.runtime.lastError) {
        updateChatStatus('错误', 'error');
        chatSendBtn && (chatSendBtn.disabled = false);
        addChatMessage(`自动开始新任务失败：${chrome.runtime.lastError.message}`, false);
        return;
      }
      updateChatStatus('执行中...', 'thinking');
      startStatusPolling();
      chatSendBtn && (chatSendBtn.disabled = false);
    });
  }

  function startChatStream(requestId) {
    chatStreamRequestId = requestId;
    chatStreamBuffer = '';
    chatStreamBubbleEl = createUpdatableBotMessage('思考中...');
  }

  function applyChatStreamChunk(requestId, chunk) {
    if (!chatStreamBubbleEl || chatStreamRequestId !== requestId) return;
    chatStreamBuffer += String(chunk || '');
    renderMessageContent(chatStreamBubbleEl, chatStreamBuffer);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function finalizeChatStream(requestId, replyText) {
    if (!chatStreamBubbleEl || chatStreamRequestId !== requestId) return;
    const finalText = String(replyText || chatStreamBuffer || '').trim();
    renderBotReplyIntoBubble(chatStreamBubbleEl, finalText);
    pushChatHistory('assistant', finalText);
    chatStreamRequestId = null;
    chatStreamBuffer = '';
    chatStreamBubbleEl = null;
  }

  function setTaskControlButtons({ running, paused }) {
    if (!pauseBtn || !resumeBtn || !cancelBtn) return;
    pauseBtn.style.display = running && !paused ? 'inline-flex' : 'none';
    resumeBtn.style.display = running && paused ? 'inline-flex' : 'none';
    cancelBtn.style.display = running ? 'inline-flex' : 'none';
  }

  function isChatTabActive() {
    const tab = document.getElementById('chatTab');
    return tab?.classList.contains('active');
  }

  function shouldAutoSyncPage() {
    return !!chatIncludePageContextToggle?.checked && isChatTabActive();
  }

  async function autoSyncPageContext(options = {}) {
    const force = options.force === true;
    if (!force && !shouldAutoSyncPage()) return;
    if (autoSyncInFlight) return;
    autoSyncInFlight = true;
    const silent = options.silent !== false;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SYNC_PAGE_CONTEXT',
        includePageContext: true
      });
      if (response?.success) {
        lastAutoSyncAt = Date.now();
        if (!silent) {
          const summary = response.summary || {};
          const clickCount = summary.clickableCount ?? 0;
          const inputCount = summary.inputCount ?? 0;
          const scrollCount = summary.scrollableCount ?? 0;
          addChatMessage(`✅ 页面已同步（按钮:${clickCount} 输入:${inputCount} 滚动区:${scrollCount}）`, false);
        }
      } else if (!silent) {
        addChatMessage(`⚠️ 页面同步失败：${response?.error || '未知错误'}`, false);
      }
    } catch (error) {
      if (!silent) {
        addChatMessage(`⚠️ 页面同步失败：${error.message}`, false);
      }
    } finally {
      autoSyncInFlight = false;
    }
  }

  function startAutoSyncLoop() {
    if (autoSyncTimer) return;
    autoSyncTimer = setInterval(() => {
      if (!shouldAutoSyncPage()) return;
      const now = Date.now();
      if (now - lastAutoSyncAt < 5000) return;
      autoSyncPageContext({ silent: true });
    }, 6000);
  }

  function stopAutoSyncLoop() {
    if (!autoSyncTimer) return;
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }

  function renderAttachments() {
    if (!attachmentBar) return;
    if (!pendingAttachments || pendingAttachments.length === 0) {
      attachmentBar.style.display = 'none';
      attachmentBar.innerHTML = '';
      return;
    }
    attachmentBar.style.display = 'flex';
    attachmentBar.innerHTML = '';
    pendingAttachments.forEach((att, idx) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';

      const name = document.createElement('span');
      name.className = 'name';
      const icon = att.kind === 'image' ? '🖼️' : '📄';
      name.textContent = `${icon} ${att.name}`;

      const remove = document.createElement('span');
      remove.className = 'remove';
      remove.textContent = '✕';
      remove.title = '移除';
      remove.addEventListener('click', () => {
        pendingAttachments.splice(idx, 1);
        renderAttachments();
      });

      chip.appendChild(name);
      chip.appendChild(remove);
      attachmentBar.appendChild(chip);
    });
  }

  function clearAttachments() {
    pendingAttachments = [];
    renderAttachments();
    if (fileInput) fileInput.value = '';
  }

  function isImageCapableModel(modelName) {
    const m = String(modelName || '').toLowerCase();
    // 只对明显支持图像的模型走 data-url image_url（路由是否支持仍然可能失败，会由后台降级）
    return m.includes('gpt-4o') || m.includes('gpt-5');
  }

  function isProbablyTextFile(file) {
    const name = String(file?.name || '').toLowerCase();
    const type = String(file?.type || '').toLowerCase();
    if (type.startsWith('text/')) return true;
    return ['.txt', '.md', '.sql', '.json', '.csv', '.tsv', '.py', '.js', '.ts', '.yaml', '.yml', '.log'].some(ext => name.endsWith(ext));
  }

  function readFileAsText(file, maxChars = 40000) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.onload = () => {
        const text = String(reader.result || '');
        resolve(text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[内容已截断，原始长度=${text.length}]` : text);
      };
      reader.readAsText(file);
    });
  }

  function readFileAsDataUrl(file, maxBytes = 1_200_000) {
    return new Promise((resolve, reject) => {
      if (file.size > maxBytes) {
        reject(new Error(`文件过大（${Math.round(file.size / 1024)}KB），建议压缩后再上传`));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
  }

  async function handleFilesSelected(files) {
    const list = Array.from(files || []);
    if (list.length === 0) return;

    for (const f of list) {
      try {
        if (isProbablyTextFile(f)) {
          const text = await readFileAsText(f);
          pendingAttachments.push({
            kind: 'text',
            name: f.name,
            mime: f.type || 'text/plain',
            size: f.size,
            text
          });
        } else if (String(f.type || '').startsWith('image/')) {
          const dataUrl = await readFileAsDataUrl(f);
          pendingAttachments.push({
            kind: 'image',
            name: f.name,
            mime: f.type || 'image/png',
            size: f.size,
            dataUrl
          });
        } else {
          addChatMessage(`暂不支持该文件类型：${f.name}（${f.type || 'unknown'}）`, false);
        }
      } catch (e) {
        addChatMessage(`添加附件失败：${f.name}：${e.message}`, false);
      }
    }

    renderAttachments();
  }

  async function captureScreenshotAsAttachment() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('未找到当前标签页');
      const tabUrl = String(tab.url || '');
      if (!tabUrl || tabUrl.startsWith('chrome://') || tabUrl.startsWith('chrome-extension://') || tabUrl.startsWith('about:')) {
        addChatMessage('当前页面不支持截图（如 chrome:// 或扩展页）。请切换到普通网页后再试，或直接粘贴截图。', false);
        return;
      }
      const dataUrl = await new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (url) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(url);
        });
      });
      const approxSizeKb = Math.round((dataUrl.length * 3 / 4) / 1024);
      if (dataUrl.length > 1_600_000) {
        addChatMessage(`截图过大（约 ${approxSizeKb}KB），已添加但发送给模型可能失败；建议缩小窗口或局部截图。`, false);
      }
      pendingAttachments.push({
        kind: 'image',
        name: `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
        mime: 'image/png',
        size: approxSizeKb * 1024,
        dataUrl
      });
      renderAttachments();
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes('<all_urls>') || msg.includes('activeTab')) {
        addChatMessage('截图失败：权限不足。请先在扩展管理页点“重新加载扩展”，并确保当前是普通网页；或使用粘贴截图/附件上传。', false);
        return;
      }
      addChatMessage(`截图失败：${msg}`, false);
    }
  }

  async function openSidePanel() {
    try {
      if (!chrome.sidePanel?.open) {
        addChatMessage('当前 Chrome 不支持侧边栏 API（sidePanel）。可通过扩展图标的“固定/别针”将其常驻。', false);
        return;
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tab?.id;
      if (!tabId) {
        addChatMessage('打开侧边栏失败：未找到当前标签页。', false);
        return;
      }

      await chrome.sidePanel.open({ tabId });
      addChatMessage('已打开右侧侧边栏（现在点击页面不会关闭）。', false);
    } catch (e) {
      const msg = e?.message || String(e);
      // sidePanel.open() 只能在“用户手势”里调用；如果链路被打断会报这个错
      addChatMessage(`打开侧边栏失败：${msg}\n提示：请直接点击浏览器工具栏的扩展图标（或右上角侧边栏按钮）来打开“数仓小助手”。`, false);
    }
  }
  
  async function sendChatMessage() {
    let question = chatInput.value.trim();
    if (!question && (!pendingAttachments || pendingAttachments.length === 0)) return;

    console.log('📤 发送聊天消息:', question);
    
    // 清空输入框
    chatInput.value = '';

    if (!question && pendingAttachments && pendingAttachments.length > 0) {
      const hasImage = pendingAttachments.some(att => att.kind === 'image');
      question = hasImage ? '请结合图片回答' : '请结合附件回答';
    }
    
    const attachments = pendingAttachments.slice(0);

    if (attachments.length > 0) {
      addUserMessageWithAttachments(question, attachments);
    } else {
      addChatMessage(question, true);
    }

    const skillMentions = extractSkillMentions(question);
    const missingSkills = getMissingSkillMentions(skillMentions);
    if (missingSkills.length > 0) {
      addChatMessage(`⚠️ 未找到技能：${missingSkills.map(m => `@${m}`).join('，')}（请先在 Skills 管理中添加）`, false);
    }
    
    // 更新状态
    updateChatStatus('处理中...', 'thinking');
    chatSendBtn.disabled = true;
    
    try {
      const mode = chatModeSelect?.value || 'chat';
      const showPlan = !!chatShowPlanToggle?.checked;
      const includePageContext = chatIncludePageContextToggle ? !!chatIncludePageContextToggle.checked : true;
      const contextText = buildContextText(12);

      if (mode === 'chat') {
        const requestId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        startChatStream(requestId);
        chrome.runtime.sendMessage({
          type: 'CHAT_MESSAGE_STREAM',
          requestId: requestId,
          message: question,
          model: model.value || 'gpt-4o-mini',
          weeklyReportRootPageId: weeklyReportRootPageId?.value || null,
          showPlan: showPlan,
          includePageContext: includePageContext,
          attachments: attachments,
          allowImages: isImageCapableModel(model.value || 'gpt-4o-mini'),
          contextText: contextText,
          skillMentions: skillMentions
        }, (response) => {
          console.log('📥 收到响应:', response);

          if (chrome.runtime.lastError) {
            console.error('❌ 消息发送错误:', chrome.runtime.lastError);
            updateChatStatus('错误', 'error');
            chatSendBtn.disabled = false;
            addChatMessage(`错误: ${chrome.runtime.lastError.message}`, false);
            return;
          }

          if (!response) {
            console.error('❌ 响应为空');
            updateChatStatus('错误', 'error');
            chatSendBtn.disabled = false;
            addChatMessage('未收到响应，请检查扩展是否正常运行', false);
            return;
          }

          if (response.success) {
            console.log('✅ 对话成功');
            updateChatStatus('就绪');
            chatSendBtn.disabled = false;
            if (chatStreamRequestId === requestId && chatStreamBubbleEl) {
              finalizeChatStream(requestId, response.reply || '');
            } else if (response.reply) {
              addBotReplyWithOptionalPlan(response.reply || '抱歉，我没有理解你的问题');
            }
            clearAttachments();
          } else {
            console.error('❌ 对话失败:', response.error);
            updateChatStatus('错误', 'error');
            chatSendBtn.disabled = false;
            addChatMessage(response.error || '对话失败，请检查配置', false);
          }
        });
        return;
      }

      const beginExecTask = (taskWithAttachments, originalText, preferShenzhou) => {
        chatExecActive = true;
        chatExecLogs = [];
        chatExecBubbleEl = createUpdatableBotMessage('收到，我开始在浏览器里执行…\n（执行日志会在这里滚动输出）');
        chatExecLastFlushTs = 0;

        if (taskInput) taskInput.value = taskWithAttachments;
        lastSubmittedTask = originalText;

        isTaskRunning = true;
        setTaskControlButtons({ running: true, paused: false });

        chrome.runtime.sendMessage({
          type: 'START_TASK',
          task: taskWithAttachments,
          model: model.value || 'gpt-4o-mini',
          confluenceToken: confluenceToken?.value || null,
          preferShenzhou: preferShenzhou,
          contextText: contextText,
          skillMentions: skillMentions
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('❌ 发送执行任务失败:', chrome.runtime.lastError);
            updateChatStatus('错误', 'error');
            chatSendBtn.disabled = false;
            chatExecActive = false;
            isTaskRunning = false;
            setTaskControlButtons({ running: false, paused: false });
            if (chatExecBubbleEl) chatExecBubbleEl.textContent = `错误: ${chrome.runtime.lastError.message}`;
            return;
          }

          updateChatStatus('执行中...', 'thinking');
          startStatusPolling();
        });
      };

      // 执行模式：交给后台驱动浏览器
      // 执行模式：把文本附件拼进任务，图片不直接注入（避免 token/协议问题）
      const attachmentTextParts = attachments
        .filter(a => a.kind === 'text' && a.text)
        .map(a => `【附件：${a.name}】\n${a.text}`);
      const taskWithAttachments = attachmentTextParts.length > 0
        ? `${question}\n\n${attachmentTextParts.join('\n\n')}`
        : question;

      const preferShenzhou = mode === 'exec_shenzhou';

      if (isTaskRunning) {
        // 体验优化：自动先停止当前任务，再开始新的
        pendingExecAfterCancel = { taskWithAttachments, originalText: question, preferShenzhou, skillMentions };
        updateChatStatus('正在停止当前任务...', 'thinking');
        addChatMessage('当前有任务在执行中，我会先停止它再开始新的任务。', false);
        chrome.runtime.sendMessage({ type: 'TASK_CANCEL' }, (resp) => {
          if (chrome.runtime.lastError) {
            updateChatStatus('错误', 'error');
            chatSendBtn.disabled = false;
            addChatMessage(`停止任务失败：${chrome.runtime.lastError.message}`, false);
            return;
          }
          if (resp && resp.success === true) {
            schedulePendingExecCheck();
          }
          if (resp && resp.success === false && typeof resp.error === 'string' && resp.error.includes('没有运行中的任务')) {
            // 后台认为没有任务在跑，直接开始
            const pending = pendingExecAfterCancel;
            pendingExecAfterCancel = null;
            isTaskRunning = false;
            setTaskControlButtons({ running: false, paused: false });
            beginExecTask(pending.taskWithAttachments, pending.originalText, pending.preferShenzhou);
          }
        });
        clearAttachments();
        return;
      }

      beginExecTask(taskWithAttachments, question, preferShenzhou);
      clearAttachments();
    } catch (error) {
      console.error('❌ 发送消息异常:', error);
      updateChatStatus('错误', 'error');
      chatSendBtn.disabled = false;
      addChatMessage(`错误: ${error.message}`, false);
    }
  }
  
  // 聊天发送按钮事件
  if (chatSendBtn) {
    chatSendBtn.addEventListener('click', sendChatMessage);
  }

  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => handleFilesSelected(fileInput.files));
  }

  if (screenshotBtn) {
    screenshotBtn.addEventListener('click', () => captureScreenshotAsAttachment());
  }

  if (pinBtn) {
    // 如果当前已经在侧边栏（通常宽度较窄），就不需要再“固定右侧”
    const probablyInSidePanel = window.innerWidth && window.innerWidth < 520;
    if (probablyInSidePanel) {
      pinBtn.textContent = '📌 已固定';
      pinBtn.disabled = true;
      pinBtn.title = '你当前已在右侧侧边栏中，无需再次固定';
    } else {
      pinBtn.addEventListener('click', () => {
        openSidePanel();
      });
    }
  }

  if (chatSyncPageButton) {
    chatSyncPageButton.addEventListener('click', async () => {
      updateChatStatus('同步页面...', 'thinking');
      chatSyncPageButton.disabled = true;
      try {
        await autoSyncPageContext({ silent: false, force: true });
        updateChatStatus('就绪');
      } catch (error) {
        addChatMessage(`⚠️ 页面同步失败：${error.message}`, false);
        updateChatStatus('错误', 'error');
      } finally {
        chatSyncPageButton.disabled = false;
      }
    });
  }

  if (chatIncludePageContextToggle) {
    chatIncludePageContextToggle.addEventListener('change', () => {
      if (chatIncludePageContextToggle.checked) {
        startAutoSyncLoop();
        autoSyncPageContext({ silent: true });
      } else {
        stopAutoSyncLoop();
      }
    });
  }

  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'TASK_PAUSE' }, () => {});
    });
  }

  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'TASK_RESUME' }, () => {});
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      // 体验优化：先本地解除“有任务在执行”的阻塞，后台再异步停止
      updateChatStatus('正在停止...', 'thinking');
      chrome.runtime.sendMessage({ type: 'TASK_CANCEL' }, () => {});
    });
  }
  
  // 聊天输入框回车发送
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });

    chatInput.addEventListener('paste', async (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItems = items.filter(item => String(item.type || '').startsWith('image/'));
      if (imageItems.length === 0) return;

      e.preventDefault();
      try {
        const plainText = e.clipboardData?.getData('text/plain');
        if (plainText) {
          const start = chatInput.selectionStart ?? chatInput.value.length;
          const end = chatInput.selectionEnd ?? chatInput.value.length;
          chatInput.value = `${chatInput.value.slice(0, start)}${plainText}${chatInput.value.slice(end)}`;
          const cursor = start + plainText.length;
          chatInput.setSelectionRange(cursor, cursor);
        }
      } catch (e) {
        // ignore
      }
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;
        try {
          const dataUrl = await readFileAsDataUrl(file);
          pendingAttachments.push({
            kind: 'image',
            name: `clipboard-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
            mime: file.type || 'image/png',
            size: file.size,
            dataUrl
          });
        } catch (error) {
          addChatMessage(`粘贴图片失败：${error.message}`, false);
        }
      }
      renderAttachments();
    });
  }
  
  // 执行按钮
  executeBtn.addEventListener('click', executeTask);
  
  // 发送到群按钮
  sendBtn.addEventListener('click', sendToGroup);
  
  // 导出日志按钮
  exportLogsBtn = document.getElementById('exportLogsBtn');
  clearLogsBtn = document.getElementById('clearLogsBtn');
  
  if (exportLogsBtn) {
    exportLogsBtn.addEventListener('click', exportLogs);
  }
  
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', clearLogs);
  }
  
  // 如果是自动执行模式，读取待执行任务并执行
  if (isAutoRun) {
    chrome.storage.local.get(['pendingTask', 'pendingModel'], (result) => {
      if (result.pendingTask) {
        setTimeout(() => {
          taskInput.value = result.pendingTask;
          if (result.pendingModel && model) {
            model.value = result.pendingModel;
          }
          chrome.storage.local.remove(['pendingTask', 'pendingModel']);
          log('🚀 自动执行任务...', 'action');
          executeTask();
        }, 500);
      }
    });
  }

  if (shouldAutoSyncPage()) {
    startAutoSyncLoop();
    autoSyncPageContext({ silent: true });
  }
});

function saveConfig() {
  const apiUrlValue = apiUrl?.value?.trim();
  const config = {
    apiUrl: apiUrlValue || DEFAULT_API_URL,
    apiToken: apiToken.value,
    model: model.value,
    webhookUrl: webhookUrl.value,
    confluenceToken: confluenceToken.value,
    weeklyReportRootPageId: weeklyReportRootPageId?.value || '',
    verboseLogs: !!verboseLogsToggle?.checked,
    chatShowPlan: !!chatShowPlanToggle?.checked
  };

  const payload = {};
  Object.entries(config).forEach(([key, value]) => {
    payload[storageKey(key)] = value;
  });

  chrome.storage.local.set(payload);
}

function log(message, type = 'action') {
  if (!outputArea) {
    console.warn('⚠️ outputArea 不存在，无法显示日志:', message);
    return;
  }

  // 默认精简：不显示 info 类日志（可在配置里开启详细日志）
  if (!isVerboseLogsEnabled() && String(type).toLowerCase() === 'info') {
    return;
  }
  
  const item = document.createElement('div');
  item.className = `log-item ${type}`;
  item.style.whiteSpace = 'pre-wrap'; // 保留换行符
  item.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  outputArea.appendChild(item);
  outputArea.scrollTop = outputArea.scrollHeight;
  
  console.log(`[日志 ${type}]`, message);
}

function setStatus(message, type = 'ready') {
  statusBar.className = `status-bar ${type}`;
  statusBar.textContent = message;
}

// 显示最终结果（清晰醒目）
function showResult(result, isError = false) {
  resultSection.style.display = 'block';
  resultSection.className = isError ? 'result-section error' : 'result-section';
  
  if (isError) {
    resultIcon.textContent = '❌';
    resultTitle.textContent = '执行失败';
    resultContent.innerHTML = `<span style="color: #ff6b6b;">${result}</span>`;
  } else {
    resultIcon.textContent = '✅';
    resultTitle.textContent = '查询成功';
    
    // 格式化结果显示
    let formattedResult = result;
    
    // 尝试解析数字并高亮
    formattedResult = formattedResult.replace(/(\d{1,3}(,\d{3})*(\.\d+)?)/g, '<span class="highlight">$1</span>');
    
    // 添加标签样式
    formattedResult = formattedResult.replace(/(Cost|cost|总和|总计|合计|数据条数|条数|row_count|total)/gi, '<span class="label">$1</span>');
    
    resultContent.innerHTML = formattedResult;
  }
  
  // 滚动到结果区域
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// 隐藏结果区域
function hideResult() {
  resultSection.style.display = 'none';
}


// 获取当前页面信息
async function getPageInfo() {
  // 使用保存的标签页 ID，如果没有则获取当前活动标签页
  let tab;
  if (currentTabId) {
    tab = await chrome.tabs.get(currentTabId);
  } else {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = activeTab;
  }
  
  // 检查是否是特殊页面
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
    return {
      url: tab.url || 'unknown',
      title: tab.title || 'unknown',
      isSpecialPage: true,
      error: '当前页面无法操作。请先打开神舟平台：https://shenzhou.tatstm.com'
    };
  }
  
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // 获取页面关键信息
        const info = {
          url: window.location.href,
          title: document.title,
          // 获取可交互元素
          buttons: Array.from(document.querySelectorAll('button')).map(b => ({
            text: b.textContent.trim().substring(0, 50),
            class: b.className
          })).slice(0, 20),
          inputs: Array.from(document.querySelectorAll('input, textarea')).map(i => ({
            type: i.type,
            placeholder: i.placeholder,
            class: i.className
          })).slice(0, 10),
          // 获取结果区域（如果有）
          results: document.querySelector('.result-preview, .ant-table, .query-result')?.textContent?.substring(0, 1000) || '',
          // 获取错误信息（如果有）
          errors: document.querySelector('.ant-message-error, .error-message')?.textContent || ''
        };
        return info;
      }
    });
    
    return result[0].result;
  } catch (error) {
    return {
      url: tab.url,
      title: tab.title,
      error: `无法访问页面: ${error.message}`
    };
  }
}

// 执行页面操作
async function executeAction(action) {
  // 使用保存的标签页 ID，如果没有则获取当前活动标签页
  let tabId = currentTabId;
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab.id;
  }
  
  switch (action.action) {
    case 'navigate':
      // 在新标签页打开，不影响当前页面
      const newTab = await chrome.tabs.create({ url: action.target, active: true });
      currentTabId = newTab.id; // 保存新标签页 ID，后续操作在这里执行
      tabId = newTab.id;
      await new Promise(r => setTimeout(r, 3000)); // 等待新页面加载
      log(`🌐 已在新标签页打开: ${action.target}`, 'action');
      break;
      
    case 'click':
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (selector) => {
          // 方法1: 尝试 CSS 选择器
          let el = document.querySelector(selector);
          
          // 方法2: 按文本内容查找
          if (!el) {
            const allClickable = document.querySelectorAll('button, a, span, div[role="button"], [cursor="pointer"]');
            for (const item of allClickable) {
              if (item.textContent.trim() === selector || item.textContent.includes(selector)) {
                el = item;
                break;
              }
            }
          }
          
          // 方法3: 查找包含特定文本的元素
          if (!el) {
            const xpath = `//*[contains(text(), '${selector}')]`;
            const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            el = result.singleNodeValue;
          }
          
          if (el) {
            el.click();
            return { success: true, clicked: el.textContent?.substring(0, 30) };
          }
          return { success: false, selector: selector };
        },
        args: [action.target]
      });
      await new Promise(r => setTimeout(r, 1000));
      break;
      
    case 'type':
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (selector, value) => {
          // 优先处理 CodeMirror 编辑器（神舟平台使用）
          const cmElements = document.querySelectorAll('.CodeMirror');
          for (const cmEl of cmElements) {
            if (cmEl.CodeMirror) {
              cmEl.CodeMirror.setValue(value);
              return { success: true, type: 'CodeMirror' };
            }
          }
          
          // 处理 Ace 编辑器
          if (window.ace) {
            const aceEditor = document.querySelector('.ace_editor');
            if (aceEditor) {
              ace.edit(aceEditor).setValue(value);
              return { success: true, type: 'Ace' };
            }
          }
          
          // 普通输入框
          const el = document.querySelector(selector) || 
                     document.querySelector('textarea, input[type="text"]');
          if (el) {
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true, type: 'input' };
          }
          
          return { success: false };
        },
        args: [action.target, action.value]
      });
      break;
      
    case 'wait':
      await new Promise(r => setTimeout(r, parseInt(action.target) || 1000));
      break;
      
    case 'get_result':
      const result = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          // 尝试多种方式获取结果
          const resultEl = document.querySelector('.result-preview, .ant-table-tbody, .query-result');
          if (resultEl) return resultEl.textContent.substring(0, 2000);
          
          // 尝试获取表格数据
          const table = document.querySelector('table');
          if (table) {
            const rows = Array.from(table.querySelectorAll('tr')).map(tr => 
              Array.from(tr.querySelectorAll('td, th')).map(td => td.textContent.trim()).join(' | ')
            );
            return rows.join('\n');
          }
          
          return '未找到结果';
        }
      });
      return result[0].result;
  }
  
  return null;
}

// 调用 AI
async function callAI(messages) {
  try {
    log(`📡 调用模型: ${model.value}`, 'action');
    
    const response = await fetch('https://model-router.meitu.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken.value}`,
        'Content-Type': 'application/json',
        'X-Mtcc-Client': 'shenzhou-assistant-extension'
      },
      body: JSON.stringify({
        model: model.value,
        messages: messages,
        max_tokens: 65536  // Gemini 推理模型最大 token
      })
    });
    
    const responseText = await response.text();
    
    if (!response.ok) {
      console.error('AI 调用失败:', responseText);
      throw new Error(`AI 调用失败 (${response.status}): ${responseText.substring(0, 100)}`);
    }
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`AI 响应解析失败: ${responseText.substring(0, 100)}`);
    }
    
    // 检查响应格式
    if (!data.choices || !data.choices[0]) {
      console.error('AI 响应格式异常:', data);
      throw new Error(`AI 响应格式异常: ${JSON.stringify(data).substring(0, 200)}`);
    }
    
    const choice = data.choices[0];
    
    // 检查是否被截断
    if (choice.finish_reason === 'length') {
      console.warn('AI 响应被截断');
    }
    
    // 获取内容（可能在 message.content 或 message.reasoning_content）
    const content = choice.message?.content || choice.message?.reasoning_content || '';
    
    if (!content) {
      throw new Error(`AI 未返回内容 (finish_reason: ${choice.finish_reason})`);
    }
    
    return content;
  } catch (error) {
    console.error('callAI 错误:', error);
    throw error;
  }
}

// 解析 AI 响应为 JSON
function parseAIResponse(response) {
  try {
    // 尝试直接解析
    return JSON.parse(response);
  } catch {
    // 尝试提取 JSON
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  }
  return null;
}

// 快速解析查询任务，提取表名、日期、字段
function parseQueryTask(task) {
  // 匹配模式：查询 表名 日期范围 的 字段
  const tableMatch = task.match(/(\w+\.\w+)/);
  
  // 修复：先匹配日期范围（支持空格），再匹配单个日期
  let startDate, endDate;
  const dateRangeMatch = task.match(/(\d{8})\s*[至到-]\s*(\d{8})/);
  if (dateRangeMatch) {
    startDate = dateRangeMatch[1];
    endDate = dateRangeMatch[2];
  } else {
    const singleDateMatch = task.match(/(\d{8})/);
    if (singleDateMatch) {
      startDate = singleDateMatch[1];
      endDate = singleDateMatch[1];
    }
  }
  
  const fieldMatch = task.match(/(cost|count|sum|数据条数|总和|总数)/gi);
  
  if (tableMatch && startDate && endDate) {
    const tableName = tableMatch[1];
    
    // 生成 SQL
    let sql = `SELECT\n  SUM(cost) AS total_cost,\n  COUNT(*) AS row_count\nFROM\n  ${tableName}\nWHERE\n  date_p >= '${startDate}'\n  AND date_p <= '${endDate}'\n  AND type_p >= '0000'`;
    
    return { tableName, startDate, endDate, sql };
  }
  return null;
}

// 快速执行模式（跳过 AI，直接执行 SQL）
async function executeQuickQuery(parsedTask) {
  log(`🚀 快速模式：检测到查询任务`, 'action');
  log(`表名: ${parsedTask.tableName}, 日期: ${parsedTask.startDate}-${parsedTask.endDate}`, 'action');
  log(`SQL: ${parsedTask.sql.substring(0, 50)}...`, 'action');
  
  // 1. 获取当前标签页
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // 检查是否是特殊页面
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    throw new Error('请先打开神舟平台页面');
  }
  
  // 2. 如果不在临时查询页面，先导航
  if (!tab.url.includes('data-develop/query')) {
    log(`🌐 导航到临时查询页面...`, 'action');
    await chrome.tabs.update(tab.id, { url: 'https://shenzhou.tatstm.com/data-develop/query' });
    await new Promise(r => setTimeout(r, 3000)); // 等待页面加载
    
    // 重新获取标签页信息
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  
  // 3. 输入 SQL
  log(`📝 输入 SQL...`, 'action');
  try {
    const [inputResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (sql) => {
        const cmElements = document.querySelectorAll('.CodeMirror');
        for (const cmEl of cmElements) {
          if (cmEl.CodeMirror) {
            cmEl.CodeMirror.setValue(sql);
            return { success: true };
          }
        }
        return { success: false, error: '未找到编辑器' };
      },
      args: [parsedTask.sql]
    });
    
    if (!inputResult.result?.success) {
      throw new Error(inputResult.result?.error || '输入 SQL 失败');
    }
  } catch (e) {
    throw new Error(`输入 SQL 失败: ${e.message}`);
  }
  
  // 4. 点击执行
  log(`▶️ 执行查询...`, 'action');
  try {
    const [clickResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const allElements = document.querySelectorAll('div, span, button');
        for (const el of allElements) {
          if (el.textContent.trim() === '执行' && el.offsetParent !== null) {
            el.click();
            return { success: true };
          }
        }
        return { success: false, error: '未找到执行按钮' };
      }
    });
    
    if (!clickResult.result?.success) {
      throw new Error(clickResult.result?.error || '点击执行失败');
    }
  } catch (e) {
    throw new Error(`点击执行失败: ${e.message}`);
  }
  
  // 5. 等待结果（轮询检查）
  log(`⏳ 等待结果...`, 'action');
  let result = null;
  
  for (let i = 0; i < 15; i++) { // 最多等待 15 秒
    await new Promise(r => setTimeout(r, 1000));
    log(`⏳ 检查结果... (${i + 1}/15)`, 'action');
    
    try {
      const [resultData] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // 检查是否有错误
          const error = document.querySelector('.ant-message-error, .error-message');
          if (error) {
            return { error: error.textContent };
          }
          
          // 检查结果表格
          const table = document.querySelector('.ant-table-tbody, table tbody');
          if (table && table.querySelectorAll('tr').length > 0) {
            const rows = Array.from(table.querySelectorAll('tr')).map(tr =>
              Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())
            );
            if (rows.length > 0 && rows[0].length > 0) {
              return { success: true, rows: rows };
            }
          }
          
          // 检查是否还在运行
          const running = document.querySelector('.loading, .ant-spin');
          if (running) {
            return { running: true };
          }
          
          return { waiting: true };
        }
      });
      
      if (resultData.result?.error) {
        throw new Error(`查询错误: ${resultData.result.error}`);
      }
      
      if (resultData.result?.success && resultData.result?.rows) {
        result = resultData.result.rows;
        break;
      }
    } catch (e) {
      console.error('获取结果失败:', e);
    }
  }
  
  if (result && result.length > 0) {
    // 解析结果（第一行数据）
    const row = result[0];
    let finalResult = '';
    
    if (row.length >= 3) {
      // 格式: [序号, total_cost, row_count]
      const totalCost = parseFloat(row[1]) || 0;
      const rowCount = parseInt(row[2]) || 0;
      finalResult = `Cost 总和: ${totalCost.toLocaleString('zh-CN', {minimumFractionDigits: 2})}\n数据条数: ${rowCount.toLocaleString()}`;
    } else if (row.length >= 2) {
      // 格式: [total_cost, row_count]
      const totalCost = parseFloat(row[0]) || 0;
      const rowCount = parseInt(row[1]) || 0;
      finalResult = `Cost 总和: ${totalCost.toLocaleString('zh-CN', {minimumFractionDigits: 2})}\n数据条数: ${rowCount.toLocaleString()}`;
    } else {
      finalResult = `结果: ${row.join(', ')}`;
    }
    
    log(`✅ 查询完成!`, 'result');
    showResult(finalResult, false);
    
    // 保存结果
    chrome.storage.local.set({ lastResult: finalResult, lastTask: taskInput.value });
    setStatus('✅ 查询完成', 'ready');
    return true;
  } else {
    throw new Error('获取结果超时，请检查页面是否有查询结果');
  }
}

// 主执行函数
async function executeTask() {
  const task = taskInput.value.trim();
  if (!task) {
    alert('请输入任务');
    return;
  }

  lastSubmittedTask = task;
  
  // 检测是否在 popup 模式（小窗口），如果是，先打开独立窗口
  if (window.innerWidth < 500) {
    // 保存任务到 storage，然后打开独立窗口
    chrome.storage.local.set({ pendingTask: task, pendingModel: model.value }, () => {
      chrome.windows.create({
        url: chrome.runtime.getURL('popup.html?autorun=true'),
        type: 'popup',
        width: 450,
        height: 700
      });
    });
    return;
  }
  
  // 清空日志区域并显示初始日志
  if (outputArea) {
    outputArea.innerHTML = '';
    log('🚀 开始执行任务...', 'action');
    log(`任务内容: ${task}`, 'info');
    log(`使用模型: ${model.value || 'gpt-4o-mini'}`, 'info');
  } else {
    console.error('❌ outputArea 不存在！无法显示日志');
  }
  hideResult();
  setStatus('🔄 执行中...', 'working');
  executeBtn.disabled = true;
  isTaskRunning = true;

  const skillMentions = extractSkillMentions(task);
  const missingSkills = getMissingSkillMentions(skillMentions);
  if (missingSkills.length > 0) {
    log(`⚠️ 未找到技能：${missingSkills.map(m => `@${m}`).join('，')}（请先在 Skills 管理中添加）`, 'warn');
  }
  
  // 发送任务到 background 执行
  try {
    chrome.runtime.sendMessage({
      type: 'START_TASK',
      task: task,
      model: model.value,
      confluenceToken: confluenceToken.value || null, // 传递 Confluence Token
      skillMentions: skillMentions
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('❌ 发送任务失败:', chrome.runtime.lastError);
        log(`❌ 发送任务失败: ${chrome.runtime.lastError.message}`, 'error');
        setStatus('❌ 发送任务失败', 'error');
        executeBtn.disabled = false;
        isTaskRunning = false;
        return;
      }
      
      if (response?.status === 'started') {
        if (outputArea) {
          log('✅ 任务已提交到后台执行', 'action');
        }
        executeBtn.disabled = true; // 确认发送成功后才禁用按钮
        // 开始轮询状态
        startStatusPolling();
      } else {
        if (outputArea) {
          log('⚠️ 未收到确认响应', 'warning');
        }
        setStatus('⚠️ 任务状态未知', 'working');
        executeBtn.disabled = true;
        startStatusPolling();
      }
    });
  } catch (error) {
    console.error('❌ 执行任务异常:', error);
    log(`❌ 执行任务异常: ${error.message}`, 'error');
    setStatus('❌ 执行失败', 'error');
    executeBtn.disabled = false;
    isTaskRunning = false;
  }
}

// 轮询任务状态
let statusPollingInterval = null;
function startStatusPolling() {
  // 清除之前的轮询
  if (statusPollingInterval) {
    clearInterval(statusPollingInterval);
  }
  lastPolledLogIndex = 0;
  
  // 每2秒查询一次状态
  statusPollingInterval = setInterval(async () => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('⚠️ 查询状态失败:', chrome.runtime.lastError);
          return;
        }
        
        if (response) {
          // 更新日志（按 raw index 增量拉取，避免“精简日志”导致 children 数不一致）
          if (outputArea && response.logs && response.logs.length > 0) {
            const newLogs = response.logs.slice(lastPolledLogIndex);
            newLogs.forEach(logItem => {
              if (!logItem || !logItem.message) return;
              if (shouldShowLogItem(logItem)) {
                log(logItem.message, logItem.type || 'info');
              }
            });
            lastPolledLogIndex = response.logs.length;
          } else if (!outputArea) {
            console.warn('⚠️ outputArea 不存在，无法更新日志');
          }
          
          // 更新状态
          if (response.status === 'idle' && isTaskRunning) {
            // 任务已完成
            clearInterval(statusPollingInterval);
            statusPollingInterval = null;
            setStatus('✅ 任务完成', 'ready');
            executeBtn.disabled = false;
            isTaskRunning = false;
            
            // 如果有结果，显示结果
            if (response.lastResult) {
              showResult(response.lastResult.result || response.lastResult, false);
            }
          } else if (response.status === 'paused') {
            setStatus('⏸ 已暂停', 'working');
          } else if (response.status === 'running') {
            setStatus('🔄 执行中...', 'working');
          }
        }
      });
    } catch (error) {
      console.error('❌ 轮询状态异常:', error);
    }
  }, 2000);
  
  // 3分钟后停止轮询（防止无限轮询）
  setTimeout(() => {
    if (statusPollingInterval) {
      clearInterval(statusPollingInterval);
      statusPollingInterval = null;
      if (executeBtn.disabled) {
        setStatus('⏳ 任务仍在执行中', 'working');
        executeBtn.disabled = false;
      }
    }
  }, 180000);
}

// 监听 background 发来的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📥 Popup 收到消息:', message.type, message);
  
  if (message.type === 'LOG_UPDATE') {
    if (outputArea && message.log) {
      if (shouldShowLogItem(message.log)) {
        log(message.log.message, message.log.type || 'info');
      }
    } else {
      console.warn('⚠️ 日志更新失败: outputArea 或 log 不存在', { outputArea: !!outputArea, log: message.log });
    }
    if (message.log && chatExecActive) {
      // 聊天气泡也做精简
      if (isVerboseLogsEnabled() || ['action','success','error','warn','warning','result'].includes(String(message.log.type || '').toLowerCase())) {
        appendChatExecLog(message.log.message);
      }
    }
  } else if (message.type === 'TASK_COMPLETE') {
    // 停止轮询（如果有）
    if (statusPollingInterval) {
      clearInterval(statusPollingInterval);
      statusPollingInterval = null;
    }
    setStatus('✅ 任务完成', 'ready');
    showResult(message.result, false);
    executeBtn.disabled = false;
    isTaskRunning = false;
    setTaskControlButtons({ running: false, paused: false });

    // 保存结果用于发送到群（新逻辑：后台执行路径也需要保存）
    const taskText = lastSubmittedTask || taskInput?.value?.trim() || '';
    chrome.storage.local.set({
      lastResult: message.result,
      lastTask: taskText
    });

    if (chatExecActive) {
      appendChatExecLog('✅ 任务完成');
      if (chatExecBubbleEl) {
        chatExecBubbleEl.textContent = `✅ 任务完成\n\n结果：\n${message.result || ''}`;
      }
      chatExecActive = false;
      chatSendBtn && (chatSendBtn.disabled = false);
      updateChatStatus('就绪');
    }

    if (pendingExecAfterCancel) kickoffPendingExec(pendingExecAfterCancel);
  } else if (message.type === 'TASK_ERROR') {
    if (statusPollingInterval) {
      clearInterval(statusPollingInterval);
      statusPollingInterval = null;
    }
    const errText = message.error || '任务执行失败';
    log(`❌ ${errText}`, 'error');
    setStatus('❌ 执行失败', 'error');
    showResult(errText, true);
    executeBtn.disabled = false;
    isTaskRunning = false;
    setTaskControlButtons({ running: false, paused: false });

    if (chatExecActive) {
      appendChatExecLog(`❌ ${errText}`);
      if (chatExecBubbleEl) chatExecBubbleEl.textContent = `❌ 执行失败\n\n${errText}`;
      chatExecActive = false;
      chatSendBtn && (chatSendBtn.disabled = false);
      updateChatStatus('错误', 'error');
    }

    if (pendingExecAfterCancel) kickoffPendingExec(pendingExecAfterCancel);
  } else if (message.type === 'TASK_PAUSED') {
    updateChatStatus('已暂停', 'thinking');
    setTaskControlButtons({ running: true, paused: true });
    if (chatExecActive) appendChatExecLog('⏸ 已暂停');
  } else if (message.type === 'TASK_RESUMED') {
    updateChatStatus('执行中...', 'thinking');
    setTaskControlButtons({ running: true, paused: false });
    if (chatExecActive) appendChatExecLog('▶️ 已继续');
  } else if (message.type === 'TASK_CANCELED') {
    if (isTaskRunning && chatExecActive && !pendingExecAfterCancel) {
      return;
    }
    updateChatStatus('已停止', 'error');
    setTaskControlButtons({ running: false, paused: false });
    if (statusPollingInterval) {
      clearInterval(statusPollingInterval);
      statusPollingInterval = null;
    }
    if (chatExecActive) {
      appendChatExecLog('⛔ 已停止');
      chatExecActive = false;
      chatSendBtn && (chatSendBtn.disabled = false);
    }
    isTaskRunning = false;
    executeBtn.disabled = false;

    // 如果用户在执行中又发了新的执行请求：停止后自动开始
    if (pendingExecAfterCancel) kickoffPendingExec(pendingExecAfterCancel);
  } else if (message.type === 'TASK_PROGRESS') {
    const action = message.action || '';
    const thinking = message.thinking || '';
    if (action) updateChatStatus(`执行中：${action}${thinking ? `（${thinking.slice(0, 20)}）` : ''}`, 'thinking');
    if (action && statusBar) {
      setStatus(`🔄 执行中：${action}${thinking ? `（${thinking.slice(0, 20)}）` : ''}`, 'working');
    }
    if (chatExecActive && (action || thinking)) {
      if (action) appendChatExecLog(`执行：${action}`);
      if (thinking) appendChatExecLog(`思路：${thinking}`);
    }
  } else if (message.type === 'CHAT_STREAM') {
    if (message.requestId && message.requestId === chatStreamRequestId) {
      applyChatStreamChunk(message.requestId, message.chunk || '');
    }
  } else if (message.type === 'CHAT_STREAM_STATUS') {
    if (message.requestId && message.requestId === chatStreamRequestId) {
      const statusText = message.status || '思考中...';
      updateChatStatus(statusText, 'thinking');
      if (chatStreamBubbleEl && !chatStreamBuffer) {
        chatStreamBubbleEl.textContent = statusText;
      }
    }
  } else if (message.type === 'CHAT_STREAM_DONE') {
    if (message.requestId && message.requestId === chatStreamRequestId) {
      finalizeChatStream(message.requestId, message.reply || '');
      updateChatStatus('就绪');
      chatSendBtn && (chatSendBtn.disabled = false);
    }
  } else if (message.type === 'CHAT_STREAM_ERROR') {
    if (message.requestId && message.requestId === chatStreamRequestId) {
      const errMsg = message.error || '对话失败';
      updateChatStatus('错误', 'error');
      if (chatStreamBubbleEl) {
        chatStreamBubbleEl.textContent = `❌ ${errMsg}`;
      }
      chatStreamRequestId = null;
      chatStreamBuffer = '';
      chatStreamBubbleEl = null;
      chatSendBtn && (chatSendBtn.disabled = false);
    }
  }
});

// 旧的执行逻辑（保留但不使用）
async function executeTaskOld() {
  const task = taskInput.value.trim();
  if (!task) {
    alert('请输入任务');
    return;
  }
  
  outputArea.innerHTML = '';
  hideResult();
  setStatus('🔄 执行中...', 'working');
  executeBtn.disabled = true;
  currentTabId = null;
  
  try {
    log(`开始任务: ${task}`);
    
    // 获取当前页面信息
    const pageInfo = await getPageInfo();
    
    // 检查是否是特殊页面
    if (pageInfo.isSpecialPage || pageInfo.error) {
      log(`⚠️ ${pageInfo.error || '无法访问当前页面'}`, 'error');
      log(`请先打开神舟平台: https://shenzhou.tatstm.com`, 'action');
      
      // 提示用户是否自动导航
      if (confirm('当前页面无法操作。\n\n是否自动打开神舟临时查询页面？')) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.tabs.update(tab.id, { url: 'https://shenzhou.tatstm.com/data-develop/query' });
        log('正在导航到神舟临时查询页面...', 'action');
        setStatus('🔄 正在打开神舟平台...', 'working');
        
        // 等待页面加载
        await new Promise(r => setTimeout(r, 3000));
        
        // 重新获取页面信息
        const newPageInfo = await getPageInfo();
        if (newPageInfo.error) {
          throw new Error('导航失败，请手动打开神舟平台');
        }
        log(`已打开: ${newPageInfo.url}`, 'result');
      } else {
        setStatus('❌ 请先打开神舟平台', 'error');
        executeBtn.disabled = false;
        return;
      }
    }
    
    log(`当前页面: ${pageInfo.url}`);
    
    // 构建消息
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `任务: ${task}\n\n当前页面信息:\n${JSON.stringify(pageInfo, null, 2)}` }
    ];
    
    let maxSteps = 10;
    let finalResult = null;
    
    while (maxSteps-- > 0) {
      // 调用 AI 获取下一步操作
      log('🤔 AI 分析中...');
      const aiResponse = await callAI(messages);
      const action = parseAIResponse(aiResponse);
      
      if (!action) {
        log('AI 响应解析失败', 'error');
        break;
      }
      
      log(`思考: ${action.thinking || '...'}`);
      log(`操作: ${action.action} - ${action.target || ''}`);
      
      if (action.action === 'done') {
        finalResult = action.result;
        log(`✅ 任务完成!`, 'result');
        log(finalResult, 'result');
        
        // 显示清晰的结果展示区
        showResult(finalResult, false);
        break;
      }
      
      // 执行操作
      const result = await executeAction(action);
      
      // 获取新的页面信息
      await new Promise(r => setTimeout(r, 1000));
      const newPageInfo = await getPageInfo();
      
      // 添加操作结果到对话
      messages.push({
        role: 'assistant',
        content: aiResponse
      });
      messages.push({
        role: 'user',
        content: `操作已执行。${result ? `结果: ${result}` : ''}\n\n新页面信息:\n${JSON.stringify(newPageInfo, null, 2)}`
      });
    }
    
    if (finalResult) {
      setStatus('✅ 任务完成', 'ready');
      // 保存结果用于发送到群
      chrome.storage.local.set({ lastResult: finalResult, lastTask: task });
    } else {
      setStatus('⚠️ 任务未完成', 'error');
    }
    
  } catch (error) {
    log(`错误: ${error.message}`, 'error');
    setStatus('❌ 执行失败', 'error');
    
    // 显示错误结果
    showResult(error.message, true);
  } finally {
    executeBtn.disabled = false;
  }
}

// 发送结果到企业微信群
async function sendToGroup() {
  let result = await chrome.storage.local.get(['lastResult', 'lastTask']);

  // 兜底：如果 storage 里没有结果，但页面上已展示结果，则直接使用展示区内容
  if (!result.lastResult) {
    const uiResult = (resultContent?.innerText || resultContent?.textContent || '').trim();
    const uiTask = (taskInput?.value || '').trim();
    if (uiResult) {
      result = { lastResult: uiResult, lastTask: uiTask || lastSubmittedTask || '' };
      chrome.storage.local.set({ lastResult: result.lastResult, lastTask: result.lastTask });
    }
  }

  if (!result.lastResult) {
    alert('没有可发送的结果，请先执行任务');
    return;
  }
  
  setStatus('📤 发送中...', 'working');
  
  try {
    const msg = `【数仓小助手】\n\n❓ ${result.lastTask}\n\n💡 ${result.lastResult}`;
    
    const response = await fetch(webhookUrl.value, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'text',
        text: { content: msg.substring(0, 4000) }
      })
    });
    
    const data = await response.json();
    
    if (data.errcode === 0) {
      log('✅ 已发送到企业微信群', 'result');
      setStatus('✅ 发送成功', 'ready');
    } else {
      throw new Error(data.errmsg);
    }
  } catch (error) {
    log(`发送失败: ${error.message}`, 'error');
    setStatus('❌ 发送失败', 'error');
  }
}

// 导出日志到本地文件
async function exportLogs() {
  try {
    // 从 storage 获取所有日志
    const data = await chrome.storage.local.get(['taskLogs', 'lastLogTime']);
    const logs = data.taskLogs || [];
    
    if (logs.length === 0) {
      alert('暂无日志可导出');
      return;
    }
    
    // 格式化日志内容
    let logContent = `数仓小助手 - 运行日志\n`;
    logContent += `导出时间: ${new Date().toLocaleString('zh-CN')}\n`;
    logContent += `日志条数: ${logs.length}\n`;
    logContent += `${'='.repeat(80)}\n\n`;
    
    logs.forEach((log, index) => {
      const typeIcon = {
        'info': 'ℹ️',
        'action': '⚡',
        'success': '✅',
        'error': '❌',
        'warn': '⚠️',
        'result': '📊'
      }[log.type] || '📝';
      
      logContent += `[${log.time || log.timestamp || 'N/A'}] ${typeIcon} [${log.type || 'info'}] ${log.message}\n`;
    });
    
    // 创建下载链接
    const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    a.href = url;
    a.download = `数仓小助手日志-${timestamp}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    log(`✅ 日志已导出（${logs.length} 条）`, 'success');
  } catch (error) {
    console.error('导出日志失败:', error);
    log(`❌ 导出日志失败: ${error.message}`, 'error');
    alert(`导出日志失败: ${error.message}`);
  }
}

// 清空日志
async function clearLogs() {
  if (!confirm('确定要清空所有日志吗？')) {
    return;
  }
  
  try {
    await chrome.storage.local.remove(['taskLogs', 'lastLogTime']);
    await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
    outputArea.innerHTML = '日志已清空';
    log('✅ 日志已清空', 'success');
  } catch (error) {
    console.error('清空日志失败:', error);
    log(`❌ 清空日志失败: ${error.message}`, 'error');
  }
}
