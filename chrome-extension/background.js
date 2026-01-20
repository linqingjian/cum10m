// 数仓小助手 - 后台服务（任务执行核心）

const STORAGE_PREFIX = 'ai_assistant_';
const storageKey = (key) => `${STORAGE_PREFIX}${key}`;
const readStoredValue = (result, key) => {
  const prefixed = storageKey(key);
  return result[prefixed] ?? result[key];
};
const CUSTOM_SKILLS_STORAGE_KEY = storageKey('customSkills');

const DEFAULT_API_BASE_URL = 'https://model-router.meitu.com/v1';
let API_TOKEN = '';
let API_URL = DEFAULT_API_BASE_URL;
let WEBHOOK_URL = '';
const DEBUG_AI = false;

// Confluence API 配置
// Confluence Personal Access Token（来自 meitu-mcp 配置）
let CONFLUENCE_API_TOKEN = '';
const CONFLUENCE_USERNAME = 'linqingjian@meitu.com';
let WEEKLY_REPORT_ROOT_PAGE_ID = '529775023'; // 默认周报根目录页面ID（蔺清建-2025）

let currentTask = null;
let taskLogs = [];
let currentTabId = null;
let actionsHistory = []; // 记录操作历史，用于判断上一步操作
let lastCompleted = null; // { task, result, ts }
let lastPageInfo = null; // { clickables: [], inputs: [], ... }
let taskControl = { paused: false, canceled: false };
let pauseWaiters = [];
let activeTaskAbortControllers = new Set();
let lastPageContextSummary = null;
const SCREENSHOT_REQUEST_TOKEN = '[[NEED_SCREENSHOT]]';

function normalizeApiUrl(apiUrl) {
  if (!apiUrl) {
    return `${DEFAULT_API_BASE_URL}/chat/completions`;
  }

  const trimmed = String(apiUrl).replace(/\/+$/u, '');
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/chat/completions`;
  }
  return trimmed;
}

async function loadConfigFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get([
      'apiToken',
      'apiUrl',
      'webhookUrl',
      'confluenceToken',
      'weeklyReportRootPageId',
      storageKey('apiToken'),
      storageKey('apiUrl'),
      storageKey('webhookUrl'),
      storageKey('confluenceToken'),
      storageKey('weeklyReportRootPageId'),
    ], (result) => {
      const apiTokenValue = readStoredValue(result, 'apiToken');
      const apiUrlValue = readStoredValue(result, 'apiUrl');
      const webhookValue = readStoredValue(result, 'webhookUrl');
      const confluenceValue = readStoredValue(result, 'confluenceToken');
      const weeklyRootValue = readStoredValue(result, 'weeklyReportRootPageId');

      if (apiTokenValue) API_TOKEN = apiTokenValue;
      if (apiUrlValue) API_URL = apiUrlValue;
      if (webhookValue) WEBHOOK_URL = webhookValue;
      if (confluenceValue) CONFLUENCE_API_TOKEN = confluenceValue;
      if (weeklyRootValue) WEEKLY_REPORT_ROOT_PAGE_ID = weeklyRootValue;

      resolve();
    });
  });
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

async function loadCustomSkillsFromStorage() {
  const result = await chrome.storage.local.get([CUSTOM_SKILLS_STORAGE_KEY, 'customSkills']);
  const stored = readStoredValue(result, 'customSkills');
  return Array.isArray(stored) ? stored : [];
}

function buildCustomSkillsBlock(customSkills, mentions = [], options = {}) {
  const enabled = (customSkills || []).filter(skill => skill && skill.enabled !== false);
  if (enabled.length === 0) return '';

  const normalizedMentions = (mentions || []).map(normalizeSkillHandle).filter(Boolean);
  let selected = enabled;
  if (normalizedMentions.length > 0) {
    selected = enabled.filter(skill => normalizedMentions.includes(getSkillHandle(skill)));
  }
  const maxSkills = typeof options.maxSkills === 'number' ? options.maxSkills : 6;
  selected = selected.slice(0, maxSkills);
  if (selected.length === 0) return '';

  const lines = selected.map(skill => {
    const handle = getSkillHandle(skill);
    const label = handle ? `${skill.name}（@${handle}）` : skill.name;
    const desc = String(skill.description || '').trim().slice(0, 200);
    const prompt = String(skill.prompt || '').trim().slice(0, 240);
    const detail = prompt ? `\n  说明: ${prompt}` : '';
    return `- ${label}: ${desc || '（暂无描述）'}${detail}`;
  });
  const header = normalizedMentions.length > 0 ? '【用户指定技能】' : '【用户自定义技能】';
  return `${header}\n${lines.join('\n')}`;
}

function withTimeout(promise, ms) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

async function autoDismissBlockingDialogs(tabId) {
  if (!tabId) return { dismissed: false };
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

        // Ant Design 弹窗/对话框
        const modals = Array.from(document.querySelectorAll('.ant-modal, .ant-modal-root, .ant-modal-wrap, .ant-modal-content'))
          .filter(isVisible);

        // 常见遮罩/对话框（非 antd）
        const overlays = Array.from(document.querySelectorAll('[role="dialog"], .modal, .dialog, .ant-popover, .ant-message'))
          .filter(isVisible);

        const candidates = [...modals, ...overlays];
        if (candidates.length === 0) return { dismissed: false };

        // 找到最“像阻塞弹窗”的那个：含遮罩或按钮区
        const dialog = candidates.find(el =>
          el.classList?.contains('ant-modal') ||
          el.querySelector?.('.ant-modal-footer, .ant-modal-confirm-btns, button')
        ) || candidates[0];

        const dialogText = textOf(dialog).slice(0, 200);

        // 优先点击“放弃/取消/关闭/×”
        const buttonTexts = ['放弃', '取消', '关闭', '我知道了', '知道了', '确定', 'OK'];
        const buttons = Array.from(dialog.querySelectorAll('button, [role="button"], .ant-btn')).filter(isVisible);

        const pickButton = () => {
          for (const t of buttonTexts) {
            const btn = buttons.find(b => textOf(b) === t || textOf(b).includes(t));
            if (btn) return { btn, t };
          }
          return null;
        };

        const picked = pickButton();
        if (picked?.btn) {
          picked.btn.click();
          return { dismissed: true, method: 'button', picked: picked.t, dialogText };
        }

        // 尝试右上角关闭按钮
        const close = dialog.querySelector('.ant-modal-close, .ant-modal-close-x, .close, [aria-label="Close"]');
        if (close && isVisible(close)) {
          close.click();
          return { dismissed: true, method: 'close', picked: 'close', dialogText };
        }

        // 兜底：点击遮罩
        const mask = document.querySelector('.ant-modal-mask, .modal-backdrop, .overlay, [class*="mask"]');
        if (mask && isVisible(mask)) {
          mask.click();
          return { dismissed: true, method: 'mask', picked: 'mask', dialogText };
        }

        return { dismissed: false, dialogText };
      }
    });
    return result?.[0]?.result || { dismissed: false };
  } catch (e) {
    return { dismissed: false, error: e?.message || String(e) };
  }
}

function setTaskPaused(paused) {
  taskControl.paused = !!paused;
  if (!taskControl.paused) {
    const waiters = pauseWaiters;
    pauseWaiters = [];
    waiters.forEach(r => {
      try { r(); } catch (e) {}
    });
  }
}

function cancelTask() {
  taskControl.canceled = true;
  setTaskPaused(false);
  // 尽快中断正在进行的 AI 请求（fetch）
  try {
    for (const controller of activeTaskAbortControllers) {
      try { controller.abort(); } catch (e) {}
    }
  } catch (e) {
    // ignore
  }
}

async function waitIfPaused() {
  while (taskControl.paused) {
    await new Promise(resolve => pauseWaiters.push(resolve));
    if (taskControl.canceled) throw new Error('任务已取消');
  }
}

function isOperablePageUrl(url) {
  return !!url && (url.startsWith('http://') || url.startsWith('https://'));
}

function waitForTabComplete(tabId, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        chrome.tabs.onUpdated.removeListener(onUpdated);
      } catch (e) {
        // ignore
      }
      clearTimeout(timer);
      resolve(result);
    };

    const onUpdated = (updatedTabId, info) => {
      if (updatedTabId !== tabId) return;
      if (info && info.status === 'complete') {
        finish({ ok: true, status: 'complete' });
      }
    };

    const timer = setTimeout(() => {
      finish({ ok: false, status: 'timeout' });
    }, timeoutMs);

    try {
      chrome.tabs.onUpdated.addListener(onUpdated);
    } catch (e) {
      finish({ ok: false, status: 'listener_error' });
      return;
    }

    try {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) return;
        if (tab && tab.status === 'complete') {
          finish({ ok: true, status: 'complete' });
        }
      });
    } catch (e) {
      // ignore
    }
  });
}

const DELETE_VERBS = ['删除', '移除', '清空', '清除', 'delete', 'remove', 'erase'];
const BLOCK_DELETE_OBJECTS = ['表', '任务', '作业', '节点', 'dag', 'node', 'table', 'task'];
const SAFE_DELETE_HINTS = ['取消删除', '撤销删除', '恢复', '放弃'];
const BLOCKED_SQL_REGEXES = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+view\b/i
];
const DELETE_SENSITIVE_URL_HINTS = [
  'data-manage/tables',
  'data-develop/tasks',
  'data-develop/dev',
  'data-develop/instances',
  'dag',
  'workflow',
  'node'
];

function looksBlockedDeleteText(text, tabUrl = '') {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (SAFE_DELETE_HINTS.some(k => lowered.includes(k.toLowerCase()))) return null;

  for (const regex of BLOCKED_SQL_REGEXES) {
    if (regex.test(lowered)) return raw.slice(0, 120);
  }

  const hasDeleteVerb = DELETE_VERBS.some(keyword => lowered.includes(keyword.toLowerCase()));
  if (!hasDeleteVerb) return null;

  const hasBlockedObject = BLOCK_DELETE_OBJECTS.some(keyword => lowered.includes(keyword.toLowerCase()));
  if (hasBlockedObject) return raw.slice(0, 120);

  const urlLower = String(tabUrl || '').toLowerCase();
  const inSensitiveContext = DELETE_SENSITIVE_URL_HINTS.some(hint => urlLower.includes(hint));
  if (inSensitiveContext) return raw.slice(0, 120);

  return null;
}

function collectActionTextCandidates(action) {
  const candidates = [];
  const index = typeof action?.index === 'number' ? action.index : (typeof action?.索引 === 'number' ? action.索引 : null);
  if (action?.action === 'click' && index !== null && lastPageInfo?.clickables?.[index]) {
    const clickItem = lastPageInfo.clickables[index];
    if (clickItem.text) candidates.push(clickItem.text);
    if (clickItem.selector) candidates.push(clickItem.selector);
  }

  if (action?.action === 'click') {
    candidates.push(action.selector, action.target, action.text, action.文本, action.参数);
  }

  if (action?.action === 'type') {
    candidates.push(action.text, action.value, action.内容, action.值, action.参数);
  }

  if (action?.action === 'input_sql') {
    candidates.push(action.sql, action.参数);
  }

  return candidates.filter(Boolean).map(value => String(value));
}

function getDestructiveReason(action, context = {}) {
  const candidates = collectActionTextCandidates(action);
  const tabUrl = context.url || '';
  for (const candidate of candidates) {
    const reason = looksBlockedDeleteText(candidate, tabUrl);
    if (reason) return reason;
  }
  return null;
}

async function getCurrentTabUrl() {
  if (!currentTabId) return '';
  try {
    const tab = await chrome.tabs.get(currentTabId);
    return tab?.url || '';
  } catch (e) {
    return '';
  }
}

function extractTaskNameFromQuery(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  // 常见表达：查看神舟任务 XXX 的逻辑 / 帮我看任务 XXX 总结
  const patterns = [
    /任务\s*[:：]?\s*([^\n，。,。]{2,60}?)(?:\s*的\s*(?:逻辑|SQL|脚本|代码)|\s*(?:逻辑|SQL|脚本|代码))/,
    /查看\s*([^\n，。,。]{2,60}?)\s*(?:任务|作业)\s*(?:逻辑|SQL|脚本|代码)/,
    /查看(?:神舟)?任务\s*([^\n，。,。]{2,60}?)(?:的|逻辑|SQL|脚本|代码)/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

function looksLikeTaskLogicInspection(userTask) {
  const t = String(userTask || '').trim();
  if (!t) return { ok: false, name: '' };
  const hasTaskWord = /任务|作业|调度|实例/.test(t);
  const wantsLogic = /逻辑|SQL|脚本|代码|编辑|开发|依赖|DAG/.test(t);
  const name = extractTaskNameFromQuery(t);
  return { ok: hasTaskWord && wantsLogic, name };
}

function responseRequestsScreenshot(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (trimmed === SCREENSHOT_REQUEST_TOKEN) return true;
  const withoutToken = trimmed.replace(SCREENSHOT_REQUEST_TOKEN, '').trim();
  return withoutToken.length === 0;
}

async function captureActiveTabScreenshot() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) {
      return { success: false, error: '未找到当前标签页' };
    }
    const url = String(activeTab.url || '');
    if (!isOperablePageUrl(url) || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
      return { success: false, error: '当前页面不支持截图' };
    }

    const dataUrl = await new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(activeTab.windowId, { format: 'png' }, (capturedUrl) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(capturedUrl);
      });
    });

    if (!dataUrl || typeof dataUrl !== 'string') {
      return { success: false, error: '截图失败：未获取到图像' };
    }

    if (dataUrl.length > 1_600_000) {
      return { success: false, error: '截图过大，建议缩小窗口或局部截图后重试' };
    }

    return { success: true, dataUrl };
  } catch (error) {
    return { success: false, error: error.message || '截图失败' };
  }
}

async function findBestShenzhouTab() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://shenzhou.tatstm.com/*' });
    if (!tabs || tabs.length === 0) return null;

    const active = tabs.find(t => t.active && isOperablePageUrl(t.url));
    if (active) return active;

    const sorted = tabs
      .filter(t => isOperablePageUrl(t.url))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return sorted[0] || null;
  } catch (e) {
    console.warn('⚠️ findBestShenzhouTab 失败:', e?.message || e);
    return null;
  }
}

async function resolveInitialTaskTabId(options = {}) {
  const preferShenzhou = options.preferShenzhou !== false;
  // 先尝试当前窗口激活 tab（注意：扩展独立窗口里 active tab 可能是 chrome-extension://）
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (tab && isOperablePageUrl(tab.url) && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('chrome://')) {
      return tab.id;
    }
  } catch (e) {
    // ignore
  }

  // 可选：最近访问的神舟页面 tab
  if (preferShenzhou) {
    const shenzhouTab = await findBestShenzhouTab();
    if (shenzhouTab) return shenzhouTab.id;
  }

  // 兜底：任意可操作的 http(s) tab
  try {
    const tabs = await chrome.tabs.query({});
    const candidates = (tabs || [])
      .filter(t => isOperablePageUrl(t.url) && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://'))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return candidates[0]?.id || null;
  } catch (e) {
    return null;
  }
}

// MV3 Service Worker 可能在长任务中被挂起；通过长连接（Port）保持存活
const keepAlivePorts = new Set();
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'popup-keepalive') return;
  keepAlivePorts.add(port);
  port.onMessage.addListener((msg) => {
    if (msg && msg.type === 'PING') {
      try {
        port.postMessage({ type: 'PONG', t: Date.now() });
      } catch (e) {
        // ignore
      }
    }
  });
  port.onDisconnect.addListener(() => keepAlivePorts.delete(port));
});

// 极简版 Skills 文档（最小化 token 使用）
const SKILLS_DOC = `操作：navigate, wait, get_page_info, click, click_at, type, wheel, scroll, scroll_to, scroll_to_text, scroll_container, drag, input_sql, click_format, click_execute, get_result, click_rerun, click_dag_view, get_dag_info, confluence_search, confluence_get_content, finish

神舟URL：
- 临时查询：https://shenzhou.tatstm.com/data-develop/query
- 数据地图：https://shenzhou.tatstm.com/data-manage/tables
- 任务列表：https://shenzhou.tatstm.com/data-develop/tasks
- 任务实例：https://shenzhou.tatstm.com/data-develop/instances

分区：date_p格式'20260101'，type_p使用'>=0000'
SQL：SELECT SUM(cost) AS total_cost, COUNT(*) AS row_count FROM 库.表 WHERE date_p>='开始' AND date_p<='结束' AND type_p>='0000'

规则：只返回一个JSON对象（不要数组/不要markdown/不要解释）；禁止删除表/任务/任务节点（包含 Drop Table）

- navigate: {"action":"navigate","url":"https://..."}
- wait: {"action":"wait","seconds":0.2-2}
- get_page_info: {"action":"get_page_info"}（获取当前页 clickables/inputs/scrollables 列表，用于后续 click/type/scroll_container）
- click: {"action":"click","selector":"CSS选择器或按钮文本"} 或 {"action":"click","index":0}（优先用 get_page_info 的 index）
- click_at: {"action":"click_at","x":100,"y":200}（视口坐标；用于复杂组件/Canvas）
- type: {"action":"type","selector":"CSS选择器或输入框提示/文本","text":"要输入的内容"} 或 {"action":"type","index":0,"text":"..."}

通用滚动/复杂组件：
- scroll: {"action":"scroll","direction":"down|up","amount":800} 或 {"action":"scroll","x":0,"y":800}
- scroll_to: {"action":"scroll_to","position":"top|bottom"} 或 {"action":"scroll_to","top":1200}
- scroll_to_text: {"action":"scroll_to_text","text":"关键字","occurrence":1}
- scroll_container: {"action":"scroll_container","selector":"CSS","direction":"down","amount":600} 或 {"action":"scroll_container","index":0,"direction":"down","amount":600}（滚动容器，优先用 get_page_info 的 scrollables）
- wheel: {"action":"wheel","x":200,"y":300,"deltaY":800}（在坐标处滚轮；用于虚拟列表等）
- drag: {"action":"drag","from":{"selector":"CSS","offsetX":10,"offsetY":10},"to":{"x":600,"y":400},"steps":20}（拖拽/滑块/画布）

神舟查询专用：
- input_sql: {"action":"input_sql","sql":"SELECT ..."}
- click_format: {"action":"click_format"}
- click_execute: {"action":"click_execute"}
- get_result: {"action":"get_result"}（获取查询结果并自动格式化；无结果时尝试读取 SQL 编辑器内容）

任务/依赖：
- click_rerun: {"action":"click_rerun","rerun_type":"latest|instance"}
- click_dag_view: {"action":"click_dag_view"}
- get_dag_info: {"action":"get_dag_info"}

Confluence：
- confluence_search: {"action":"confluence_search","query":"关键词"}
- confluence_get_content: {"action":"confluence_get_content","page_id":"页面ID"}

- finish: {"action":"finish","result":"结果文本"}`;

// 构建动态 SYSTEM_PROMPT（极简版）
function buildSystemPrompt(userTask, contextText = '', customSkillsBlock = '') {
  const taskInspect = looksLikeTaskLogicInspection(userTask);
  const inspectHint = taskInspect.ok
    ? `\n【任务逻辑查看规范 - 必须严格遵守】\n你必须真实打开神舟页面获取信息，不允许凭空总结。\n目标任务名：${taskInspect.name || '（从页面搜索）'}\n\n⚠️⚠️⚠️ 强制操作流程（不可跳过任何步骤，即使任务在列表中可见也必须先搜索）⚠️⚠️⚠️：\n1) navigate 到 https://shenzhou.tatstm.com/data-develop/tasks\n2) get_page_info → 获取页面状态，找到"任务名称"或"任务名"搜索输入框（通常在页面顶部）\n3) type → 在搜索框输入任务名"${taskInspect.name || '任务名'}"（必须完整输入任务名称）\n4) click → 点击搜索按钮（通常是输入框右侧的搜索图标或"搜索"按钮）\n5) wait → 等待搜索结果加载完成（必须看到搜索结果列表，通常会有"共X条"提示）\n6) get_page_info → 再次获取页面状态，确认搜索结果中出现目标任务"${taskInspect.name || '任务名'}"\n7) click → 点击搜索结果中的目标任务名称或"编辑"按钮\n8) get_page_info → 获取任务详情页面状态\n9) click → 点击"编辑"按钮（如果还没进入编辑页面）\n10) get_result → 抓取任务SQL/说明/输入输出表/调度信息\n11) 如需依赖：click_dag_view / get_dag_info\n12) finish → 用要点总结（目的/来源/口径/产出/分区/调度/依赖/注意事项）\n\n🚫🚫🚫 严格禁止（违反将导致任务失败）🚫🚫🚫：\n- ❌ 禁止跳过搜索步骤直接点击列表中的任务（即使任务已经在列表中可见）\n- ❌ 禁止在未输入任务名称到搜索框时就点击任何按钮\n- ❌ 禁止在未点击搜索按钮时就点击任务\n- ❌ 禁止在未看到搜索结果时就点击任何按钮\n- ❌ 禁止假设任务位置，必须通过搜索确认\n- ❌ 禁止在未 get_result 或 get_dag_info 之前就 finish\n\n💡 重要提示：\n- 即使任务列表已经显示了目标任务，也必须先清空搜索框、输入任务名、点击搜索\n- 搜索是为了确保找到正确的任务，避免点击错误的同名任务\n- 搜索后通常会显示"共X条"结果，确认找到目标任务后再点击\n`
    : '';

  const clippedContext = String(contextText || '').trim().slice(0, 3500);
  const contextBlock = clippedContext
    ? `\n【最近对话上下文】\n${clippedContext}\n（请结合上下文理解用户目标与约束）\n`
    : '';

  const skillBlock = customSkillsBlock
    ? `\n${customSkillsBlock}\n`
    : '';

  return `数仓助手。返回一个JSON操作。

${SKILLS_DOC}
${skillBlock}
${inspectHint}
${contextBlock}

问题：${userTask}

重要：
- 根据用户目标决定是否需要 navigate（不要盲目跳到临时查询页）
- 如果不知道点哪个/填哪个，先 get_page_info 再 click/type
- 每次只返回一个操作；尽量少步骤；action.thinking 用中文简短说明

返回：{"action":"操作名", ...}（只一个操作，不要数组）
`;
}

// 初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('🤖 数仓小助手已安装');
  loadConfigFromStorage().catch(() => {});

  // Gemini 在当前路由下经常超时，默认使用更稳定的模型
  chrome.storage.local.get(['model', storageKey('model')], (result) => {
    const existingModel = readStoredValue(result, 'model');
    if (!existingModel) {
      chrome.storage.local.set({ [storageKey('model')]: 'gpt-4o-mini' });
    }
  });

  // 侧边栏：尽量让点击扩展图标直接打开右侧面板（避免 popup 点击页面就关闭）
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    }
  } catch (e) {
    // ignore
  }

  if (details?.reason === 'install') {
    try {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        chrome.tabs.create({ url: 'options.html' });
      }
    } catch (e) {
      // ignore
    }
  }
});

// 启动时也加载 Confluence Token 和周报根目录页面ID
loadConfigFromStorage().catch(() => {});

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 Background script 收到消息:', request.type, request);
  
  if (request.type === 'START_TASK') {
    console.log('🚀 Background script 开始执行任务:', request.task);
    // 更新 Confluence Token（如果提供了）
    if (request.confluenceToken) {
      CONFLUENCE_API_TOKEN = request.confluenceToken;
      console.log('✅ Confluence Token 已更新');
    }
    // 初始化任务控制状态
    taskControl = { paused: false, canceled: false };
    pauseWaiters = [];

    // 异步执行任务，不阻塞响应
    startTask(request.task, request.model, {
      preferShenzhou: request.preferShenzhou !== false,
      contextText: request.contextText || '',
      skillMentions: Array.isArray(request.skillMentions) ? request.skillMentions : []
    }).catch(error => {
      console.error('❌ 任务执行失败:', error);
      addLog(`❌ 任务执行失败: ${error.message}`, 'error');
    });
    // 立即通知 content script 任务已开始
    notifyContentScript('running', null, null);
    sendResponse({ status: 'started' });
  } else if (request.type === 'GET_STATUS') {
    sendResponse({ 
      status: currentTask ? (taskControl.paused ? 'paused' : 'running') : 'idle',
      logs: taskLogs,
      lastResult: lastCompleted,
      paused: !!taskControl.paused
    });
  } else if (request.type === 'TASK_PAUSE') {
    if (currentTask) {
      setTaskPaused(true);
      addLog('⏸ 已暂停任务', 'warn');
      chrome.runtime.sendMessage({ type: 'TASK_PAUSED' }).catch(() => {});
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: '当前没有运行中的任务' });
    }
  } else if (request.type === 'TASK_RESUME') {
    if (currentTask) {
      setTaskPaused(false);
      addLog('▶️ 已继续任务', 'info');
      chrome.runtime.sendMessage({ type: 'TASK_RESUMED' }).catch(() => {});
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: '当前没有运行中的任务' });
    }
  } else if (request.type === 'TASK_CANCEL') {
    if (currentTask) {
      cancelTask();
      addLog('⛔ 已停止任务', 'error');
      chrome.runtime.sendMessage({ type: 'TASK_CANCELED' }).catch(() => {});
      notifyContentScript('error', null, '任务已取消');
      // 立即清理 running 状态，避免前端继续显示“执行中”
      currentTask = null;
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: '当前没有运行中的任务' });
    }
  } else if (request.type === 'OPEN_SIDE_PANEL') {
    try {
      const tabId = sender?.tab?.id;
      const winId = sender?.tab?.windowId;
      const open = async () => {
        if (chrome.sidePanel?.open) {
          if (tabId) await chrome.sidePanel.open({ tabId });
          else if (winId) await chrome.sidePanel.open({ windowId: winId });
          else {
            const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (t?.id) await chrome.sidePanel.open({ tabId: t.id });
          }
          return true;
        }
        throw new Error('当前 Chrome 不支持 sidePanel API');
      };
      open()
        .then(() => sendResponse({ success: true }))
        .catch((e) => sendResponse({ success: false, error: e.message || String(e) }));
      return true;
    } catch (e) {
      sendResponse({ success: false, error: e.message || String(e) });
    }
  } else if (request.type === 'GET_LAST_RESULT') {
    sendResponse({ 
      result: lastCompleted?.result || null
    });
  } else if (request.type === 'SYNC_PAGE_CONTEXT') {
    syncPageContext()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.type === 'CHAT_MESSAGE_STREAM') {
    if (request.weeklyReportRootPageId) {
      WEEKLY_REPORT_ROOT_PAGE_ID = request.weeklyReportRootPageId;
      console.log('✅ 周报根目录页面ID已更新:', WEEKLY_REPORT_ROOT_PAGE_ID);
    }
    const requestId = request.requestId || `chat_${Date.now()}`;
    const sendChunk = (chunk) => {
      chrome.runtime.sendMessage({ type: 'CHAT_STREAM', requestId, chunk }).catch(() => {});
    };
    const sendStatus = (status) => {
      chrome.runtime.sendMessage({ type: 'CHAT_STREAM_STATUS', requestId, status }).catch(() => {});
    };
    handleChatMessage(
      request.message,
      request.model,
      request.weeklyReportRootPageId || WEEKLY_REPORT_ROOT_PAGE_ID,
      {
        showPlan: !!request.showPlan,
        includePageContext: request.includePageContext !== false,
        attachments: Array.isArray(request.attachments) ? request.attachments : [],
        allowImages: !!request.allowImages,
        contextText: request.contextText || '',
        skillMentions: Array.isArray(request.skillMentions) ? request.skillMentions : [],
        stream: true,
        onStreamChunk: sendChunk,
        onStreamStatus: sendStatus
      }
    )
      .then(reply => {
        sendResponse({ success: true, reply: reply });
        chrome.runtime.sendMessage({ type: 'CHAT_STREAM_DONE', requestId, reply }).catch(() => {});
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message || '对话处理失败，请检查控制台日志' });
        chrome.runtime.sendMessage({ type: 'CHAT_STREAM_ERROR', requestId, error: error.message || '对话处理失败' }).catch(() => {});
      });
    return true;
  } else if (request.type === 'CHAT_MESSAGE') {
    // 纯对话模式：直接调用 AI 进行对话，不执行浏览器操作
    // 更新周报根目录页面ID（如果提供了）
    if (request.weeklyReportRootPageId) {
      WEEKLY_REPORT_ROOT_PAGE_ID = request.weeklyReportRootPageId;
      console.log('✅ 周报根目录页面ID已更新:', WEEKLY_REPORT_ROOT_PAGE_ID);
    }
    console.log('💬 开始处理对话消息:', request.message);
    handleChatMessage(
      request.message,
      request.model,
      request.weeklyReportRootPageId || WEEKLY_REPORT_ROOT_PAGE_ID,
      {
        showPlan: !!request.showPlan,
        includePageContext: request.includePageContext !== false,
        attachments: Array.isArray(request.attachments) ? request.attachments : [],
        allowImages: !!request.allowImages,
        contextText: request.contextText || '',
        skillMentions: Array.isArray(request.skillMentions) ? request.skillMentions : []
      }
    )
      .then(reply => {
        console.log('✅ 对话处理成功，回复长度:', reply?.length || 0);
        sendResponse({ success: true, reply: reply });
      })
      .catch(error => {
        console.error('❌ 对话处理失败:', error);
        sendResponse({ success: false, error: error.message || '对话处理失败，请检查控制台日志' });
      });
    return true; // 异步响应
  } else if (request.type === 'SEND_TO_WECHAT') {
    sendToWechat(request.result);
    sendResponse({ status: 'sent' });
  } else if (request.type === 'CLEAR_LOGS') {
    taskLogs = [];
    chrome.storage.local.remove(['taskLogs', 'lastLogTime']).catch(() => {});
    sendResponse({ status: 'cleared' });
  } else if (request.type === 'GET_LOGS') {
    chrome.storage.local.get(['taskLogs'], (data) => {
      sendResponse({ logs: data.taskLogs || [] });
    });
    return true; // 异步响应
  }
  return true;
});

// 添加日志
function addLog(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const log = { 
    time: new Date().toLocaleTimeString(), 
    timestamp: timestamp,
    message, 
    type 
  };
  taskLogs.push(log);
  
  // 保存到 storage（保留最近1000条日志）
  const logsToSave = taskLogs.slice(-1000);
  chrome.storage.local.set({ 
    taskLogs: logsToSave,
    lastLogTime: timestamp
  }).catch(() => {});
  
  // 通知 popup 更新
  try {
    chrome.runtime.sendMessage({ type: 'LOG_UPDATE', log }).catch((err) => {
      console.warn('⚠️ 发送日志到 popup 失败:', err);
    });
  } catch (err) {
    console.warn('⚠️ 发送日志异常:', err);
  }
  console.log(`[${type}] ${message}`);
}

// 开始执行任务
async function startTask(task, model, options = {}) {
  await loadConfigFromStorage();
  currentTask = task;
  taskLogs = [];
  actionsHistory = []; // 重置操作历史
  lastPageInfo = null;
  const taskInspect = looksLikeTaskLogicInspection(task);
  let evidenceCount = 0;
  
  // 获取一个“可操作的”标签页（避免把扩展自身窗口当成目标页面）
  try {
    currentTabId = await resolveInitialTaskTabId({ preferShenzhou: options.preferShenzhou !== false });
    if (currentTabId) {
      addLog(`当前标签页 ID: ${currentTabId}`, 'info');
    } else {
      addLog('⚠️ 未找到可操作的标签页，将创建新标签页', 'warning');
    }
  } catch (error) {
    addLog(`⚠️ 获取标签页失败: ${error.message}`, 'warning');
  }
  
  addLog(`开始任务: ${task}`, 'info');
  addLog(`使用模型: ${model}`, 'info');
  
  // 尽量不“强制跳转”：按任务类型做最小必要的自动导航
  const queryUrl = 'https://shenzhou.tatstm.com/data-develop/query';
  const tasksUrl = 'https://shenzhou.tatstm.com/data-develop/tasks';
  const taskLower = String(task || '').toLowerCase();
  const queryLike = [
    'select ', 'from ', 'where ', 'group by', 'order by', 'sum(', 'count(',
    'sql', '查询', '临时查询', 'cost', 'row_count', 'total_cost'
  ].some(k => taskLower.includes(k));

  let currentUrl = '';
  let isShenzhou = false;
  let isQueryPage = false;
  try {
    if (currentTabId) {
      const tab = await chrome.tabs.get(currentTabId);
      currentUrl = tab.url || '';
      addLog(`当前页面 URL: ${currentUrl}`, 'info');
      isShenzhou = currentUrl.includes('shenzhou.tatstm.com');
      isQueryPage = currentUrl.includes('data-develop/query');
    }
  } catch (e) {
    addLog(`⚠️ 无法获取当前页面 URL: ${e.message}`, 'warning');
  }

  const needNavigateQuery = queryLike && (!currentTabId || !isOperablePageUrl(currentUrl) || !isShenzhou);
  const needNavigateTasks = taskInspect.ok && (!currentTabId || !isOperablePageUrl(currentUrl) || !isShenzhou);

  if (needNavigateTasks) {
    addLog(`🌐 检测到“查看任务逻辑”类任务，自动打开任务列表: ${tasksUrl}`, 'action');
    if (currentTabId) {
      await chrome.tabs.update(currentTabId, { url: tasksUrl });
    } else {
      const newTab = await chrome.tabs.create({ url: tasksUrl, active: true });
      currentTabId = newTab.id;
      addLog(`✅ 已创建新标签页并导航，标签页 ID: ${currentTabId}`, 'info');
    }
    const navResult = await waitForTabComplete(currentTabId, 8000);
    if (!navResult.ok) addLog(`⚠️ 任务列表页面加载超时`, 'warn');
  } else if (needNavigateQuery) {
    addLog(`🌐 检测到查询类任务且当前不在神舟页面，自动打开临时查询页: ${queryUrl}`, 'action');
    if (currentTabId) {
      await chrome.tabs.update(currentTabId, { url: queryUrl });
    } else {
      const newTab = await chrome.tabs.create({ url: queryUrl, active: true });
      currentTabId = newTab.id;
      addLog(`✅ 已创建新标签页并导航，标签页 ID: ${currentTabId}`, 'info');
    }
    const navResult = await waitForTabComplete(currentTabId, 8000);
    if (!navResult.ok) addLog(`⚠️ 临时查询页面加载超时`, 'warn');
  } else {
    addLog(isQueryPage ? '✅ 当前已在临时查询页' : '✅ 当前页面可用，交给 AI 决定是否导航', 'success');
  }
  
  // 使用动态构建的提示词：用户问题 + skills 文档
  addLog(`📝 构建系统提示词...`, 'action');
  const skillMentions = Array.isArray(options.skillMentions) && options.skillMentions.length > 0
    ? options.skillMentions
    : extractSkillMentions(task);
  const customSkills = await loadCustomSkillsFromStorage();
  const customSkillsBlock = buildCustomSkillsBlock(customSkills, skillMentions, { maxSkills: 6 });
  const systemPrompt = buildSystemPrompt(task, options.contextText || '', customSkillsBlock);
  addLog(`✅ 系统提示词构建完成`, 'success');
  addLog(`✅ 已加载技能库: ${SKILLS_DOC.split('\n')[0]}`, 'info');
  if (customSkillsBlock) {
    addLog('✅ 已加载自定义技能', 'info');
  }
  
  let messages = [
    { role: 'system', content: systemPrompt }
  ];
  
  let maxSteps = 100; // 增加到100步，允许更复杂的任务
  let step = 0;
  let waitCount = 0; // 连续 wait 次数
  let lastActions = []; // 记录最近的操作序列，用于检测循环
  
  addLog(`🚀 开始执行任务步骤（最多${maxSteps}步）...`, 'action');
  
  while (step < maxSteps) {
    if (taskControl.canceled) {
      addLog('⛔ 任务已取消，停止执行', 'error');
      chrome.runtime.sendMessage({ type: 'TASK_CANCELED' }).catch(() => {});
      break;
    }
    await waitIfPaused();

    step++;
    addLog(`步骤 ${step}/${maxSteps}: 等待 AI 指令...`, 'action');
    
    try {
      // 限制 messages 长度，避免过长导致 API 限制
      // 保留：system message + 最近 4 轮对话（8 条消息）
      if (messages.length > 9) {
        messages = [
          messages[0], // system message（包含用户问题和 skills）
          ...messages.slice(-8) // 最近 4 轮对话（8 条消息）
        ];
        console.log(`messages 过长，已截断到 ${messages.length} 条`);
      }
      
      // 记录 messages 信息
      console.log(`准备调用 AI，messages 数量: ${messages.length}`);
      const totalChars = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
      console.log(`messages 总字符数: ${totalChars}, 估计 token: ${Math.floor(totalChars / 4)}`);
	      
	      // 调用 AI 获取下一步操作（带重试和备选模型机制）
	      let aiResponse;
	      let retryCount = 0;
	      const maxRetries = 2; // 增加重试次数：1次重试 + 1次切换模型
	      let currentModel = model;
	      const fallbackModel = 'gpt-4o-mini'; // 备选模型
	      const originalMessages = JSON.parse(JSON.stringify(messages)); // 保存原始 messages 的副本
	
	      while (retryCount <= maxRetries) {
	        try {
	          if (taskControl.canceled) throw new Error('任务已取消');
	          await waitIfPaused();
	          const isGeminiModel = typeof currentModel === 'string' && currentModel.toLowerCase().includes('gemini');
	          const perCallTimeout = isGeminiModel ? 20000 : 60000; // Gemini 经常卡住，先快速失败再降级
	
	          addLog(`调用 AI（模型: ${currentModel}，重试: ${retryCount}/${maxRetries}，超时: ${Math.floor(perCallTimeout / 1000)}s）...`, 'info');
	          aiResponse = await callAI(messages, currentModel, perCallTimeout, { max_tokens: 1600, temperature: 0.1 });
	          addLog(`✅ AI 调用成功`, 'success');
	          break; // 成功，退出重试循环
	        } catch (error) {
	          console.error(`AI 调用错误（重试 ${retryCount}/${maxRetries}）:`, error);
	
	          const isEmptyChoicesError = typeof error?.message === 'string' && error.message.includes('choices 为空数组');
	          const isTimeoutError = typeof error?.message === 'string' && error.message.includes('超时');
	          const isGeminiModel = typeof currentModel === 'string' && currentModel.toLowerCase().includes('gemini');
	          
	          // 超时：Gemini 优先降级到备选模型；其他模型直接抛出
	          if (isTimeoutError) {
	            retryCount++;
	
	            if (isGeminiModel && currentModel !== fallbackModel) {
	              addLog(`⚠️ ${currentModel} 调用超时，切换到备选模型: ${fallbackModel}`, 'warn');
	              currentModel = fallbackModel;
	              messages = JSON.parse(JSON.stringify(originalMessages));
	              if (messages.length > 9) {
	                messages = [
	                  messages[0],
	                  ...messages.slice(-8)
	                ];
	              }
	              continue;
	            }
	
	            addLog(`❌ AI 调用错误: ${error.message}`, 'error');
	            throw new Error(`AI 调用超时，请检查网络连接或稍后重试`);
	          }
	
	          // 如果是空 choices 错误
	          if (isEmptyChoicesError) {
	            retryCount++;
	
	            if (retryCount === 1) {
	              // Gemini：第一次就空 choices，直接切到备选模型（不浪费时间重试）
	              if (isGeminiModel && currentModel !== fallbackModel) {
	                console.log(`⚠️ Gemini 返回空 choices，直接切换到备选模型: ${fallbackModel}`);
	                addLog(`⚠️ Gemini 返回空 choices，切换到备选模型: ${fallbackModel}`, 'warn');
	                currentModel = fallbackModel;
	                // 恢复原始的 messages（但限制长度）
	                messages = JSON.parse(JSON.stringify(originalMessages));
	                // 限制长度，避免过长
	                if (messages.length > 9) {
	                  messages = [
	                    messages[0], // system message（包含用户问题和 skills）
	                    ...messages.slice(-8) // 最近 4 轮对话（8 条消息）
	                  ];
	                }
	                console.log(`切换模型后 messages 数量: ${messages.length}`);
	                addLog(`切换模型后 messages 数量: ${messages.length}`, 'warn');
	                continue;
	              }
	
	              // 非 Gemini：先原样重试一次
	              addLog(`⚠️ AI 返回空 choices，准备重试 ${retryCount}/${maxRetries}（同模型）`, 'warn');
	              continue;
	            } else if (retryCount === 2) {
	              console.log(`⚠️ 遇到空 choices，尝试重试 ${retryCount}/${maxRetries}，使用更短的 messages`);
	              addLog(`⚠️ 遇到空 choices，尝试重试 ${retryCount}/${maxRetries}，使用更短的 messages`, 'warn');
	
	              // 使用更短的 messages：system + 最近 1 轮对话（2 条消息）
	              messages = [
	                messages[0], // system message（包含用户问题和 skills）
	                ...messages.slice(-2) // 最近 1 轮对话（2 条消息）
	              ];
	              console.log(`重试时 messages 数量: ${messages.length}`);
	              addLog(`重试时 messages 数量: ${messages.length}`, 'warn');
	              continue;
	            }
	          }
	
	          // 其他错误或重试次数用完，抛出错误
	          addLog(`❌ AI 调用错误: ${error.message}`, 'error');
	          throw error;
	        }
	      }
      
      // 检查是否成功获取响应
      if (!aiResponse) {
        throw new Error('AI 调用失败：未获取到响应');
      }
      
      const preview = aiResponse.substring(0, 200);
      addLog(`AI 返回: ${preview}${aiResponse.length > 200 ? '...' : ''}`, 'info');
      
      // 解析 JSON 操作
      const action = parseAction(aiResponse);
      if (!action) {
        // 显示详细的错误信息（完整内容）
        const errorMsg = `❌ 无法解析 AI 返回的操作\n完整内容: ${aiResponse}\n长度: ${aiResponse.length} 字符`;
        addLog(errorMsg, 'error');
        
        // 尝试提取可能的 JSON
        const jsonMatch = aiResponse.match(/\{[^}]*"action"[^}]*\}/);
        if (jsonMatch) {
          addLog(`发现可能的 JSON: ${jsonMatch[0]}`, 'error');
        }
        
        // 尝试继续，让 AI 知道解析失败
        messages.push({ role: 'assistant', content: aiResponse });
        messages.push({ role: 'user', content: `你返回的内容无法解析为 JSON。请只返回一个纯 JSON 对象，不要添加任何解释文字、markdown 代码块或其他内容。格式示例：{"action": "navigate", "url": "https://shenzhou.tatstm.com/data-develop/query"}` });
        continue;
      }
      
      // 任务逻辑查看：没拿到页面证据前，不允许 finish（防止模型胡编）
      if (taskInspect.ok && action.action === 'finish' && evidenceCount === 0) {
        addLog('⚠️ 拒绝 finish：尚未抓取页面证据（请先打开任务详情并 get_result）', 'warn');
        messages.push({ role: 'assistant', content: aiResponse });
        const nameHint = taskInspect.name ? `任务名：${taskInspect.name}。` : '';
        messages.push({
          role: 'user',
          content: `你不能在未获取页面信息前总结。${nameHint}请按流程：navigate 到任务列表→get_page_info→type 搜索任务→click 打开→点击“编辑/开发/SQL/脚本”→get_result 抓取关键信息→必要时 get_dag_info→最后再 finish。现在返回下一步 JSON。`
        });
        continue;
      }

      const currentUrl = await getCurrentTabUrl();
      const destructiveReason = getDestructiveReason(action, { url: currentUrl });
      if (destructiveReason) {
        const blockedMsg = `检测到删除表/任务/节点相关操作，已拦截：${destructiveReason}`;
        addLog(`🚫 ${blockedMsg}`, 'error');
        throw new Error(blockedMsg);
      }

      addLog(`执行操作: ${action.action}`, 'action');
      const thinking = action.thinking || action.思路 || action.说明 || action.reasoning;
      if (thinking && typeof thinking === 'string' && thinking.trim().length > 0) {
        addLog(`思路: ${thinking.trim()}`, 'info');
      }
      chrome.runtime.sendMessage({
        type: 'TASK_PROGRESS',
        action: action.action,
        thinking: thinking ? String(thinking).trim() : ''
      }).catch(() => {});

      // 如果有阻塞弹窗，优先关掉（例如“恢复缓存/未保存临时查询语句”）
      // 注意：当 AI 明确要点“恢复/放弃”时，不要抢先处理
      const rawTarget = action.selector || action.target || action.url || action.参数 || '';
      const wantsDialog = action.action === 'click' && typeof rawTarget === 'string' && (rawTarget.includes('恢复') || rawTarget.includes('放弃'));
      if (!wantsDialog && action.action !== 'finish') {
        const dismissed = await autoDismissBlockingDialogs(currentTabId);
        if (dismissed?.dismissed) {
          addLog(`🧹 已自动关闭弹窗（${dismissed.method}:${dismissed.picked || ''}）`, 'action');
          await sleep(250);
        }
      }

      // 记录操作历史
      actionsHistory.push(action.action);
      
      // 记录最近的操作序列（用于检测循环）
      lastActions.push(action.action);
      if (lastActions.length > 10) {
        lastActions.shift(); // 只保留最近10个操作
      }
      
      // 检测循环：如果最近10个操作中有5个以上相同，可能是循环
      if (lastActions.length >= 10) {
        const actionCounts = {};
        lastActions.forEach(a => {
          actionCounts[a] = (actionCounts[a] || 0) + 1;
        });
        const maxCount = Math.max(...Object.values(actionCounts));
        if (maxCount >= 5) {
          const repeatedAction = Object.keys(actionCounts).find(k => actionCounts[k] === maxCount);
          addLog(`⚠️ 检测到可能的循环（最近10个操作中有${maxCount}个"${repeatedAction}"），尝试提示AI`, 'warn');
          messages.push({ 
            role: 'user', 
            content: `检测到可能的循环。最近的操作序列：${lastActions.join(' -> ')}。操作"${repeatedAction}"重复了${maxCount}次。请检查任务是否已经完成，如果已完成请使用 finish 操作。如果未完成，请尝试不同的操作或检查是否有错误。` 
          });
        }
      }
      
      // 统计连续 wait 次数
      if (action.action === 'wait') {
        waitCount++;
        // 如果连续 wait 超过 5 次，停止（增加容错）
        if (waitCount >= 5) {
          addLog('❌ 检测到无限循环（连续 wait 5次），任务已停止', 'error');
          notifyContentScript('error', null, '检测到无限循环（连续 wait），任务已停止');
          break;
        }
      } else {
        waitCount = 0; // 重置计数
      }
      
      await waitIfPaused();
      // 执行操作
      const result = await executeAction(action);

      // 记录“已获取证据”的步骤
      if (taskInspect.ok) {
        const evidenceActions = new Set(['get_result', 'get_page_info', 'get_dag_info']);
        if (evidenceActions.has(action.action)) evidenceCount++;
        if (result && typeof result === 'object') {
          if (result.data || result.result) evidenceCount++;
        }
      }
      
      // 检查是否需要停止执行（例如 SQL 输入失败）
      if (result && result.stopExecution) {
        addLog(`🛑 操作失败，停止执行后续操作: ${result.error || '未知错误'}`, 'error');
        notifyContentScript('error', null, result.error || '操作失败，已停止执行');
        break;
      }
      
      if (action.action === 'finish') {
        addLog(`✅ 任务完成: ${action.result}`, 'success');
        // 保存最后一次成功结果，供 popup “发送到群”使用
        lastCompleted = { task: currentTask || '', result: action.result || '', ts: Date.now() };
        chrome.storage.local.set({
          lastResult: action.result || '',
          lastTask: currentTask || ''
        }).catch(() => {});

        // 通知 popup 任务完成
        chrome.runtime.sendMessage({ 
          type: 'TASK_COMPLETE', 
          result: action.result 
        }).catch(() => {});
        
        // 通知 content script 任务完成
        notifyContentScript('completed', action.result);
        break;
      }
      
      // 将结果添加到对话历史
      messages.push({ role: 'assistant', content: aiResponse });
      
      // 如果执行了 click_execute，明确告诉 AI 下一步应该获取结果
      if (action.action === 'click_execute' && result.success) {
        messages.push({ 
          role: 'user', 
          content: `SQL 查询已执行，查询正在运行中。现在你需要：
1. 先等待查询完成：{"action": "wait", "seconds": 5}
2. 然后立即获取结果：{"action": "get_result"}
3. 获取结果后立即 finish：{"action": "finish", "result": "..."}

重要：不要连续执行多个 wait，执行完一次 wait 后必须执行 get_result，然后 finish。` 
        });
      }
      // 如果执行了 wait，检查是否应该获取结果
      else if (action.action === 'wait') {
        // 检查上一步是否是 click_execute（使用操作历史）
        if (actionsHistory.length >= 2 && actionsHistory[actionsHistory.length - 2] === 'click_execute') {
            messages.push({ 
              role: 'user', 
              content: `等待完成。现在必须立即获取查询结果：{"action": "get_result"}。不要继续 wait。` 
            });
        } else {
          messages.push({ 
            role: 'user', 
            content: `操作已执行。结果: ${JSON.stringify(result)}。请继续下一步操作。` 
            });
        }
      }
      // 如果获取到了查询结果，明确告诉 AI 应该 finish
      else if (action.action === 'get_result' && result.success && result.resultType === 'sql') {
        const sqlText = String(result.sql || '');
        const clipped = sqlText.length > 8000 ? `${sqlText.slice(0, 8000)}\n\n[已截断]` : sqlText;
        messages.push({
          role: 'user',
          content: `已获取任务 SQL（来源: ${result.editorType || 'editor'}）。请结合 SQL 总结任务逻辑并立即 finish。SQL 内容：\n${clipped}`
        });
      }
      else if (action.action === 'get_result' && result.success && result.data) {
        if (result.formatted) {
          // 如果已经有格式化结果，直接使用
          messages.push({ 
            role: 'user', 
            content: `查询结果已获取：${result.formatted}。请立即返回 finish 操作：{"action": "finish", "result": "${result.formatted}"}。不要继续 wait 或其他操作。` 
          });
        } else {
          const resultText = JSON.stringify(result.data);
          messages.push({ 
            role: 'user', 
            content: `查询结果已获取：${resultText}。请立即返回 finish 操作，格式：{"action": "finish", "result": "Cost 总和: xxx, 数据条数: xxx"}。不要继续 wait 或其他操作。` 
          });
        }
      } else {
        messages.push({ role: 'user', content: `操作已执行。结果: ${JSON.stringify(result)}。请继续下一步操作。` });
      }
      
    } catch (error) {
      if (taskControl.canceled) {
        const cancelMsg = '任务已取消';
        addLog(`⛔ ${cancelMsg}`, 'error');
        chrome.runtime.sendMessage({ type: 'TASK_CANCELED' }).catch(() => {});
        notifyContentScript('error', null, cancelMsg);
        break;
      }
      const errorMsg = `❌ 错误: ${error.message}\n${error.stack ? error.stack.substring(0, 500) : ''}`;
      addLog(errorMsg, 'error');
      console.error('任务执行错误:', error);
      
      // 通知 content script 任务失败
      notifyContentScript('error', null, error.message);
      
      // 通知 popup 任务失败
      chrome.runtime.sendMessage({ 
        type: 'TASK_ERROR', 
        error: error.message 
      }).catch(() => {});
      
      break;
    }
  }
  
  if (step >= maxSteps) {
    const errorMsg = `❌ 任务执行步骤过多（${step}步），已停止。请检查任务是否正常完成。`;
    addLog(errorMsg, 'error');
    
    // 通知 content script 任务失败
    notifyContentScript('error', null, errorMsg);
    
    // 通知 popup 任务失败
    chrome.runtime.sendMessage({ 
      type: 'TASK_ERROR', 
      error: errorMsg 
    }).catch(() => {});
  }
  
  currentTask = null;
}

// 通知 content script 任务状态更新
function notifyContentScript(status, result = null, error = null) {
  const send = (tabId) => {
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, {
      type: 'TASK_STATUS_UPDATE',
      status: status,
      result: result,
      error: error
    }).catch(() => {
      // content script 可能未加载，忽略错误
    });
  };

  // 优先发送到任务所在 tab
  if (currentTabId) {
    send(currentTabId);
    return;
  }

  // 回退到当前活动 tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs.length > 0) send(tabs[0].id);
  });
}

// 处理纯对话消息（不执行浏览器操作，但可以调用 Confluence API）
async function handleChatMessage(message, model = 'gpt-4o-mini', weeklyReportRootPageId = null, options = {}) {
  await loadConfigFromStorage();
  console.log('💬 处理对话消息:', message);
  
  // 加载周报根目录页面ID（如果未提供）
  if (!weeklyReportRootPageId) {
    const stored = await chrome.storage.local.get(['weeklyReportRootPageId', storageKey('weeklyReportRootPageId')]);
    weeklyReportRootPageId = readStoredValue(stored, 'weeklyReportRootPageId') || WEEKLY_REPORT_ROOT_PAGE_ID;
  }
  console.log('📁 周报根目录页面ID:', weeklyReportRootPageId);
  
  // 获取当前浏览器页面信息（快速获取，不阻塞对话）
  let pageInfo = null;
  let pageContextSummary = null;
  let activeTabId = null;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url && !activeTab.url.startsWith('chrome://') && !activeTab.url.startsWith('chrome-extension://')) {
      activeTabId = activeTab.id;
      // 先获取基本信息
      pageInfo = {
        url: activeTab.url,
        title: activeTab.title
      };
      
      // 只获取基本信息，不获取详细内容（避免阻塞）
      console.log('✅ 获取到页面基本信息:', pageInfo.url);
    }
  } catch (error) {
    console.warn('⚠️ 获取当前标签页失败:', error.message);
    // 继续执行，不阻塞对话
  }

  if (options.includePageContext !== false && activeTabId) {
    try {
      const summary = lastPageContextSummary || await withTimeout(getPageInfoSummary(activeTabId), 1500);
      if (summary?.success || summary?.url) {
        const trimText = (value) => String(value || '').trim().slice(0, 80);
        pageContextSummary = {
          url: summary.url,
          title: summary.title,
          clickables: (summary.clickables || []).slice(0, 8).map(item => ({
            index: item.index,
            tag: item.tag,
            text: trimText(item.text),
            selector: item.selector
          })),
          inputs: (summary.inputs || []).slice(0, 8).map(item => ({
            index: item.index,
            tag: item.tag,
            type: item.type,
            placeholder: trimText(item.placeholder),
            selector: item.selector
          })),
          scrollables: (summary.scrollables || []).slice(0, 5).map(item => ({
            index: item.index,
            tag: item.tag,
            selector: item.selector,
            scrollHeight: item.scroll?.scrollHeight || 0,
            clientHeight: item.scroll?.clientHeight || 0
          }))
        };
        console.log('✅ 已同步页面上下文');
      }
    } catch (error) {
      console.warn('⚠️ 获取页面上下文失败:', error.message);
    }
  }

  const streamEnabled = !!options.stream && typeof options.onStreamChunk === 'function';
  const onStreamChunk = streamEnabled ? options.onStreamChunk : null;
  const onStreamStatus = typeof options.onStreamStatus === 'function' ? options.onStreamStatus : null;
  if (onStreamStatus) onStreamStatus('思考中...');
  
  try {
    const skillMentions = Array.isArray(options.skillMentions) && options.skillMentions.length > 0
      ? options.skillMentions
      : extractSkillMentions(message);
    const customSkills = await loadCustomSkillsFromStorage();
    const customSkillsBlock = buildCustomSkillsBlock(customSkills, skillMentions, { maxSkills: 6 });

    // 直接根据用户消息中的关键词判断是否需要搜索（避免AI调用超时）
    const needsSearch = message.toLowerCase().includes('confluence') || 
                        message.toLowerCase().includes('cf') ||
                        message.toLowerCase().includes('周报') ||
                        message.toLowerCase().includes('日报') ||
                        message.toLowerCase().includes('文档');
    
    console.log('🔍 是否需要搜索:', needsSearch, '消息:', message);
    
    let confluenceResults = null;
    
    // 如果需要搜索，优先从周报根目录查找（如果是周报相关查询）
    const isWeeklyReportQuery = message.includes('周报') || message.includes('日报');
    
    if (needsSearch && isWeeklyReportQuery && weeklyReportRootPageId) {
      try {
        console.log('📁 从周报根目录查找:', weeklyReportRootPageId);
        console.log('🔑 Confluence Token 前10个字符:', CONFLUENCE_API_TOKEN ? CONFLUENCE_API_TOKEN.substring(0, 10) + '...' : '未设置');
        // 从根目录获取子页面
        const childrenUrl = `https://cf.meitu.com/rest/api/content/${weeklyReportRootPageId}/child/page?expand=version,space&limit=100`;
        const childrenResponse = await fetch(childrenUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${CONFLUENCE_API_TOKEN}`,
            'Accept': 'application/json'
          }
        });
        
        if (childrenResponse.ok) {
          const childrenData = await childrenResponse.json();
          const children = childrenData.results || [];
          
          // 过滤出周报/日报页面（标题包含"周报"或"日报"）
          const weeklyReports = children.filter(page => 
            page.title.includes('周报') || page.title.includes('日报')
          );
          
          // 按最后修改时间排序
          weeklyReports.sort((a, b) => {
            const timeA = new Date(a.version?.when || 0).getTime();
            const timeB = new Date(b.version?.when || 0).getTime();
            return timeB - timeA;
          });
          
          if (weeklyReports.length > 0) {
            // 返回所有周报页面，让AI判断哪个是最新的
            confluenceResults = weeklyReports.map(page => {
              const lastModified = page.version?.when || '';
              return {
                id: page.id,
                title: page.title,
                space: page.space?.name || '',
                url: `https://cf.meitu.com/confluence/pages/viewpage.action?pageId=${page.id}`,
                lastModified: lastModified,
                created: page.version?.when || ''
              };
            });
            console.log('✅ 从根目录找到', confluenceResults.length, '个周报页面，将让AI判断哪个是最新的');
          } else {
            console.log('⚠️ 根目录下没有找到周报页面，将使用搜索');
          }
        } else {
          console.warn('⚠️ 获取根目录子页面失败:', childrenResponse.status);
        }
      } catch (error) {
        console.error('❌ 从根目录查找失败:', error);
      }
    }
    
    // 如果从根目录没找到，或者不是周报查询，使用AI搜索策略
    if (!confluenceResults || confluenceResults.length === 0) {
      try {
        console.log('🔍 从根目录未找到结果，使用AI搜索策略');
        // 让 AI 自己决定搜索策略（搜索关键词、搜索方式、排序方式等）
        const searchStrategyPrompt = `用户问题：${message}

**任务流程**：
1. 搜索关键词，找到所有相关的周报/日报页面
2. 从搜索结果中找出最新的页面

**搜索策略**：
- 如果用户问"最新的周报/日报"，需要先找到所有周报/日报页面，然后从中找出最新的
- 搜索关键词应该包含人名和"周报"/"日报"（如"蔺清建 周报"），这样才能找到具体的周报页面
- 搜索方式建议用"title"，因为周报/日报的标题通常包含这些关键词
- 排序用"lastModified"，按最后修改时间排序，最新的在前

请决定搜索策略，返回 JSON 格式：
{
  "query": "搜索关键词",
  "searchType": "title|text|both",
  "sortBy": "lastModified|created|relevance",
  "limit": 10
}

说明：
- query: 从用户问题中提取的搜索关键词（必须包含人名和"周报"/"日报"，如"蔺清建 周报"）
- searchType: "title"表示搜索标题（推荐用于周报/日报），"text"表示搜索内容，"both"表示两者都搜索
- sortBy: "lastModified"按最后修改时间排序（最新的在前，推荐），"created"按创建时间排序，"relevance"按相关性排序
- limit: 返回结果数量限制（建议10-20，确保能找到所有相关页面）

只返回 JSON，不要其他内容。`;

        const strategyMessages = [
          { role: 'system', content: '你是一个搜索策略助手。只返回 JSON 格式的搜索策略，不要其他内容。不要调用任何函数，只返回纯 JSON 文本。' },
          { role: 'user', content: searchStrategyPrompt }
        ];
        
        const strategyResponse = await callAI(strategyMessages, model, 30000, { max_tokens: 800, temperature: 0.1 }); // 搜索策略用更短输出
        console.log('🤔 AI 搜索策略原始响应:', strategyResponse);
        
        let searchStrategy;
        try {
          // 清理响应文本，移除可能的 function call 格式
          let cleanedResponse = strategyResponse;
          // 移除 function call 格式（如 call:confluence_search{...}）
          cleanedResponse = cleanedResponse.replace(/call:\w+\{/g, '{');
          cleanedResponse = cleanedResponse.replace(/^[^{]*/, ''); // 移除开头的非 JSON 内容
          cleanedResponse = cleanedResponse.replace(/[^}]*$/, ''); // 移除结尾的非 JSON 内容
          
          // 尝试解析 JSON
          const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            searchStrategy = JSON.parse(jsonMatch[0]);
            console.log('✅ 成功解析搜索策略:', searchStrategy);
          } else {
            throw new Error('未找到 JSON');
          }
        } catch (e) {
          // 如果解析失败，使用默认策略
          console.warn('⚠️ 无法解析 AI 搜索策略，使用默认策略:', e.message);
          
          // 从用户消息中提取关键词作为默认搜索词
          let defaultQuery = message;
          // 移除常见词
          defaultQuery = defaultQuery.replace(/在|cf|上|查看|最新的|最新|搜索|查找|找|查|帮我/gi, '').trim();
          // 如果包含"周报"或"日报"，保留这些词
          if (!defaultQuery.includes('周报') && !defaultQuery.includes('日报')) {
            if (message.includes('周报')) defaultQuery += ' 周报';
            if (message.includes('日报')) defaultQuery += ' 日报';
          }
          
          searchStrategy = {
            query: defaultQuery || '蔺清建 周报',
            searchType: message.includes('周报') || message.includes('日报') ? 'title' : 'text',
            sortBy: 'lastModified',
            limit: 10
          };
          console.log('📋 使用默认搜索策略:', searchStrategy);
        }
        
        const { query, searchType = 'text', sortBy = 'lastModified', limit = 10 } = searchStrategy;
        console.log('🔍 搜索策略:', { query, searchType, sortBy, limit });
        
        if (query && query.length > 0) {
          // 根据 AI 的策略构建 CQL 查询
          let cqlQuery = '';
          if (searchType === 'title') {
            cqlQuery = `title ~ "${query}"`;
          } else if (searchType === 'text') {
            cqlQuery = `text ~ "${query}"`;
          } else {
            // both: 搜索标题或内容
            cqlQuery = `(title ~ "${query}" OR text ~ "${query}")`;
          }
          
          // 添加排序
          if (sortBy === 'lastModified') {
            cqlQuery += ' order by lastModified desc';
          } else if (sortBy === 'created') {
            cqlQuery += ' order by created desc';
          }
          
          console.log('🔍 CQL 查询:', cqlQuery);
          
          // 调用 Confluence API
          const searchUrl = 'https://cf.meitu.com/rest/api/content/search';
          const response = await fetch(searchUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${CONFLUENCE_API_TOKEN}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({
              cql: cqlQuery,
              limit: Math.min(limit, 20), // 限制最大20个
              expand: 'space,version,history'
            })
          });
          
          if (response.ok) {
            const data = await response.json();
            const results = data.results || [];
            
            // 按 AI 指定的方式排序
            if (sortBy === 'lastModified') {
              results.sort((a, b) => {
                const timeA = new Date(a.version?.when || a.history?.lastUpdated?.when || 0).getTime();
                const timeB = new Date(b.version?.when || b.history?.lastUpdated?.when || 0).getTime();
                return timeB - timeA;
              });
            } else if (sortBy === 'created') {
              results.sort((a, b) => {
                const timeA = new Date(a.version?.when || 0).getTime();
                const timeB = new Date(b.version?.when || 0).getTime();
                return timeB - timeA;
              });
            }
            
            // 返回所有结果，让 AI 自己决定如何过滤和排序
            confluenceResults = results.slice(0, Math.min(limit, 10)).map(page => {
              const lastModified = page.version?.when || page.history?.lastUpdated?.when || '';
              const created = page.version?.when || '';
              return {
                id: page.id,
                title: page.title,
                space: page.space?.name || '',
                url: `https://cf.meitu.com/confluence/pages/viewpage.action?pageId=${page.id}`,
                lastModified: lastModified,
                created: created
              };
            });
            console.log('✅ Confluence 搜索成功，找到', confluenceResults.length, '个结果');
          } else {
            const errorText = await response.text().catch(() => '');
            console.warn('⚠️ Confluence 搜索失败:', response.status, errorText.substring(0, 200));
          }
        }
      } catch (error) {
        console.error('❌ Confluence 搜索错误:', error);
      }
    }
    
    // 构建最终回复提示词（简化版，确保快速响应）
    const clippedContext = String(options.contextText || '').trim().slice(0, 3500);
    const contextBlock = clippedContext
      ? `\n**最近对话上下文**（请结合理解用户目标与约束）：\n${clippedContext}\n`
      : '';

    const pageContextBlock = pageContextSummary
      ? `\n**当前页面元素快照**（用于辅助回答）：\n${JSON.stringify(pageContextSummary, null, 2)}\n`
      : '';
    const planHint = options.showPlan
      ? '- 在回复末尾追加一段【思路】（3-6条要点），只写高层步骤/计划，不要输出模型隐含推理细节'
      : '';
    const canSendImages = !!options.allowImages && (String(model || '').toLowerCase().includes('gpt-4o') || String(model || '').toLowerCase().includes('gpt-5'));
    const screenshotHintLine = canSendImages
      ? `- 如果需要当前页面截图才能回答，请只回复一行：${SCREENSHOT_REQUEST_TOKEN}（不要添加其他文字）`
      : '';
    const pageAwarenessLine = (pageInfo || pageContextSummary)
      ? '- 已提供页面信息/元素快照，请直接基于它回答，不要说无法查看页面'
      : '- 如果需要页面视觉信息而当前没有，请按截图规则请求截图';

    const buildFinalPrompt = (includeScreenshotHint = true) => {
      const importantLines = [
        '- 只返回纯文本回复，不要调用任何函数',
        '- 不要使用 function call 格式（如 call:confluence_search{...}）',
        '- 不要返回 JSON 格式的操作指令',
        '- 直接用中文回答用户的问题',
        '- 如果包含代码/SQL/脚本，请使用 Markdown 代码块并标注语言（例如：sql 代码块）',
        pageAwarenessLine
      ];
      if (includeScreenshotHint && screenshotHintLine) importantLines.push(screenshotHintLine);
      if (planHint) importantLines.push(planHint);

      return `你是美图公司数仓团队的 AI 助手 "数仓小助手"。

你的主人是蔺清建（linqingjian@meitu.com），数仓工程师，负责 RoboNeo、外采成本、素材中台、活跃宽表。

${contextBlock}

${customSkillsBlock ? `${customSkillsBlock}\n` : ''}

${pageInfo ? `
**当前浏览器页面信息**：
- URL: ${pageInfo.url}
- 标题: ${pageInfo.title}

你可以根据当前页面内容帮助用户分析页面、填写表单、点击按钮等。

` : ''}

${pageContextBlock}

${confluenceResults && confluenceResults.length > 0 ? `
用户问题：${message}

我在 Confluence 中找到了以下相关页面：
${confluenceResults.map((page, index) => {
  const timeInfo = page.lastModified ? `最后修改: ${page.lastModified}` : '';
  const createdInfo = page.created ? `创建时间: ${page.created}` : '';
  // 提取标题中的日期信息（如"周报——蔺清建-2026010"中的"2026010"）
  const dateMatch = page.title.match(/\d{7,8}/);
  const dateInfo = dateMatch ? `标题日期: ${dateMatch[0]}` : '';
  return `${index + 1}. ${page.title}\n   页面ID: ${page.id}\n   空间: ${page.space}\n   ${timeInfo}${createdInfo ? '\n   ' + createdInfo : ''}${dateInfo ? '\n   ' + dateInfo : ''}\n   链接: ${page.url}`;
}).join('\n\n')}

**重要任务**：
1. 如果用户问的是"最新的周报/日报"，你必须：
   - 明确告诉用户："我找到了 ${confluenceResults.length} 个周报页面"
   - **自己判断哪个是最新的**，根据以下信息：
     * 最后修改时间（越新越好）
     * 标题中的日期（如"2026010"比"2025122"新）
     * 创建时间（如果最后修改时间相同）
   - 推荐你判断出的最新页面，提供具体的页面标题和链接
   - 例如："最新的是：[你判断出的页面标题]，链接：[URL]"
   
2. **不要**说"你可以在 Confluence 上搜索"或"建议你搜索"，因为我已经找到了结果
3. **不要**说我无法访问，因为我已经找到了结果
4. **必须**根据这些页面信息，自己判断哪个是最新的，然后推荐给用户` : needsSearch ? `
用户问题：${message}

注意：我尝试搜索了 Confluence，但没有找到相关结果。请告诉用户可能的原因（如关键词不匹配、权限问题等），并建议其他查找方式。` : `
用户问题：${message}

你可以帮助用户：
- 查询数据表信息
- 执行 SQL 查询
- 查看表结构
- 分析任务状态
- 搜索 Confluence 文档

请用友好、专业的语气直接回答用户的问题。`}

**重要**：
${importantLines.join('\n')}`;
    };

    const buildUserContent = (baseMessage, attachmentsList, extraImages = []) => {
      const attachments = Array.isArray(attachmentsList) ? attachmentsList : [];
      const textAttachments = attachments
        .filter(a => a && a.kind === 'text' && typeof a.text === 'string' && a.text.trim().length > 0)
        .slice(0, 3)
        .map(a => {
          const name = String(a.name || 'untitled').slice(0, 80);
          const text = a.text.length > 40000 ? `${a.text.slice(0, 40000)}\n\n[内容已截断]` : a.text;
          return `【附件：${name}】\n${text}`;
        });

      const imageAttachments = attachments
        .filter(a => a && a.kind === 'image' && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:image/'));
      const combinedImages = [...extraImages, ...imageAttachments]
        .filter(img => img && typeof img.dataUrl === 'string' && img.dataUrl.startsWith('data:image/'))
        .slice(0, 2);

      const baseUserText = textAttachments.length > 0
        ? `${baseMessage}\n\n用户提供的附件内容如下（可用于理解上下文）：\n\n${textAttachments.join('\n\n')}`
        : baseMessage;

      if (canSendImages && combinedImages.length > 0) {
        const parts = [{ type: 'text', text: baseUserText }];
        for (const img of combinedImages) {
          if (img.dataUrl.length > 1_600_000) continue;
          parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
        }
        return parts;
      }

      if (combinedImages.length > 0) {
        const names = combinedImages.map(a => String(a.name || 'image')).join(', ');
        return `${baseUserText}\n\n（用户还提供了图片附件：${names}。如果你无法直接理解图片，请提示用户描述图片内容或提供文字信息。）`;
      }

      return baseUserText;
    };

    const attachments = Array.isArray(options.attachments) ? options.attachments : [];
    const finalPrompt = buildFinalPrompt(true);
    const userContent = buildUserContent(message, attachments);
    const finalMessages = [
      { role: 'system', content: finalPrompt },
      { role: 'user', content: userContent }
    ];
    
    console.log('🤖 调用 AI 生成回复，超时时间: 60秒');
    try {
      const timeout = 60000; // 60秒
      const callChatModel = async (messages, streamConfig = null) => {
        console.log('📤 发送消息到 AI，消息数量:', messages.length);
        if (streamEnabled && streamConfig) {
          return callAIStream(messages, model, timeout, { max_tokens: 1800, temperature: 0.2 }, streamConfig.onChunk);
        }
        return callAI(messages, model, timeout, { max_tokens: 1800, temperature: 0.2 });
      };

      let streamSent = false;
      const directStreamHandler = streamEnabled && typeof onStreamChunk === 'function'
        ? (delta) => {
          if (!delta) return;
          streamSent = true;
          onStreamChunk(delta);
        }
        : null;
      let gatedBuffer = '';
      const tokenGate = () => {
        if (!streamEnabled || !canSendImages || typeof onStreamChunk !== 'function') return null;
        const token = SCREENSHOT_REQUEST_TOKEN;
        return {
          onChunk: (delta) => {
            if (!delta) return;
            gatedBuffer += delta;
            if (token.startsWith(gatedBuffer)) return;
            streamSent = true;
            onStreamChunk(gatedBuffer);
            gatedBuffer = '';
          },
          flushIfAny: () => {
            if (gatedBuffer) {
              streamSent = true;
              onStreamChunk(gatedBuffer);
              gatedBuffer = '';
            }
          }
        };
      };

      const gate = tokenGate();
      const response = await callChatModel(finalMessages, gate ? { onChunk: gate.onChunk } : (directStreamHandler ? { onChunk: directStreamHandler } : null));
      if (gate) gate.flushIfAny();

      const responseText = String(response || '').trim();
      console.log('✅ AI 回复生成成功，长度:', responseText.length || 0);

      if (!responseText) {
        throw new Error('AI 返回了空响应');
      }

      if (responseRequestsScreenshot(responseText)) {
        if (!canSendImages) {
          return '当前模型不支持图片输入，无法自动截图。请切换到支持图片的模型，或手动上传截图。';
        }

        if (onStreamStatus) onStreamStatus('需要截图，正在获取...');
        const screenshot = await captureActiveTabScreenshot();
        if (!screenshot.success) {
          return `需要截图但未成功：${screenshot.error || '截图失败'}。你也可以手动上传或粘贴截图。`;
        }

        if (onStreamStatus) onStreamStatus('已获取截图，正在分析...');
        const followupPrompt = `${buildFinalPrompt(false)}\n\n（已获取当前页面截图，请直接基于截图回答。）`;
        const screenshotAttachment = { kind: 'image', name: 'auto-screenshot.png', dataUrl: screenshot.dataUrl };
        const followupUserContent = buildUserContent(message, attachments, [screenshotAttachment]);
        const followupMessages = [
          { role: 'system', content: followupPrompt },
          { role: 'user', content: followupUserContent }
        ];

        const followupResponse = await callChatModel(followupMessages, directStreamHandler ? { onChunk: directStreamHandler } : null);
        const followupText = String(followupResponse || '').trim();
        if (responseRequestsScreenshot(followupText)) {
          return '已提供截图，但仍无法判断。请描述你希望我关注的区域或补充问题细节。';
        }
        return followupText;
      }

      if (streamEnabled && !streamSent && typeof onStreamChunk === 'function') {
        onStreamChunk(responseText);
      }

      return responseText;
    } catch (error) {
      // 如果 AI 调用失败（如 function call 被拒绝），但已有搜索结果，生成默认回复
      if (confluenceResults && confluenceResults.length > 0 && 
          (error.hasResults || error.message.includes('function_call') || error.message.includes('refusal') || error.message.includes('malformed'))) {
        console.warn('⚠️ AI 调用失败，但已有搜索结果，生成默认回复');
        // 让 AI 判断哪个是最新的（基于已有数据）
        const sortedPages = [...confluenceResults].sort((a, b) => {
          // 优先按最后修改时间
          const timeA = new Date(a.lastModified || 0).getTime();
          const timeB = new Date(b.lastModified || 0).getTime();
          if (timeB !== timeA) return timeB - timeA;
          
          // 如果时间相同，按标题中的日期
          const dateA = a.title.match(/\d{7,8}/)?.[0] || '';
          const dateB = b.title.match(/\d{7,8}/)?.[0] || '';
          if (dateB && dateA) return dateB.localeCompare(dateA);
          
          return 0;
        });
        const latestPage = sortedPages[0];
        return `我找到了 ${confluenceResults.length} 个周报页面。根据最后修改时间和标题中的日期，最新的是：${latestPage.title}，链接：${latestPage.url}`;
      }
      // 对于简单对话，如果超时，返回友好提示
      if (error.message.includes('超时')) {
        return '抱歉，响应超时了。请检查网络连接或稍后重试。';
      }
      // 其他错误也返回友好提示，不抛出异常
      console.error('❌ AI 调用错误:', error);
      return `抱歉，处理你的问题时出错了：${error.message || '未知错误'}`;
    }
  } catch (error) {
    console.error('❌ 对话处理错误:', error);
    // 确保总是返回一个响应，不抛出异常
    return `抱歉，处理你的问题时出错了：${error.message || '未知错误'}。请检查控制台日志获取详细信息。`;
  }
}

// 执行页面点击操作
async function executePageClick(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: async (selector) => {
        // 方法1: 尝试 CSS 选择器
        let el = document.querySelector(selector);
        
        // 方法2: 按文本内容查找按钮
        if (!el) {
          const allClickable = Array.from(document.querySelectorAll('button, a, span, div[role="button"], [onclick], [cursor="pointer"]'));
          for (const item of allClickable) {
            if (item.textContent && (item.textContent.trim() === selector || item.textContent.includes(selector))) {
              el = item;
              break;
            }
          }
        }
        
        // 方法3: 按 ID 或 class 查找
        if (!el) {
          el = document.getElementById(selector) || document.querySelector(`.${selector}`);
        }
        
        if (el) {
          // 滚动到元素可见
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await new Promise(r => setTimeout(r, 300));
          
          // 触发点击事件
          el.click();
          return { success: true, clicked: el.textContent?.trim().substring(0, 50) || selector, tagName: el.tagName };
        }
        return { success: false, error: `未找到元素: ${selector}` };
      },
      args: [selector]
    });
    
    return result[0]?.result || { success: false, error: '执行失败' };
  } catch (error) {
    console.error('❌ 点击操作失败:', error);
    return { success: false, error: error.message };
  }
}

// 执行页面输入操作
async function executePageType(tabId, selector, value) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (selector, value) => {
        // 方法1: 按 placeholder 查找
        let el = Array.from(document.querySelectorAll('input, textarea')).find(
          input => input.placeholder && input.placeholder.includes(selector)
        );
        
        // 方法2: 按 ID 或 name 查找
        if (!el) {
          el = document.getElementById(selector) || document.querySelector(`input[name="${selector}"], textarea[name="${selector}"]`);
        }
        
        // 方法3: CSS 选择器
        if (!el) {
          el = document.querySelector(selector);
        }
        
        // 方法4: 按类型查找第一个可用的输入框
        if (!el) {
          el = document.querySelector('input[type="text"], input[type="search"], textarea');
        }
        
        if (el) {
          el.focus();
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, typed: value.substring(0, 50), element: el.tagName };
        }
        return { success: false, error: `未找到输入框: ${selector}` };
      },
      args: [selector, value]
    });
    
    return result[0]?.result || { success: false, error: '执行失败' };
  } catch (error) {
    console.error('❌ 输入操作失败:', error);
    return { success: false, error: error.message };
  }
}

async function executeClickAt(tabId, x, y, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (x, y, options) => {
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        const vx = clamp(Math.round(x), 0, window.innerWidth - 1);
        const vy = clamp(Math.round(y), 0, window.innerHeight - 1);

        const el = document.elementFromPoint(vx, vy);
        if (!el) return { success: false, error: `坐标无元素: (${vx}, ${vy})` };

        const button = typeof options.button === 'number' ? options.button : 0;
        const detail = typeof options.detail === 'number' ? options.detail : 1;

        const common = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: vx,
          clientY: vy,
          button: button,
          buttons: 1
        };

        el.dispatchEvent(new MouseEvent('mousemove', common));
        el.dispatchEvent(new MouseEvent('mousedown', { ...common, detail }));
        el.dispatchEvent(new MouseEvent('mouseup', { ...common, detail }));
        el.dispatchEvent(new MouseEvent('click', { ...common, detail }));

        return {
          success: true,
          clicked: (el.textContent || el.value || el.tagName || '').toString().trim().slice(0, 60),
          tagName: el.tagName,
          x: vx,
          y: vy
        };
      },
      args: [x, y, options]
    });

    return result[0]?.result || { success: false, error: '执行失败' };
  } catch (error) {
    console.error('❌ 坐标点击失败:', error);
    return { success: false, error: error.message };
  }
}

async function executeWheelAt(tabId, x, y, deltaX = 0, deltaY = 800) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (x, y, dx, dy) => {
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        const vx = clamp(Math.round(x), 0, window.innerWidth - 1);
        const vy = clamp(Math.round(y), 0, window.innerHeight - 1);
        const el = document.elementFromPoint(vx, vy) || document.scrollingElement || document.body;

        const evtInit = {
          bubbles: true,
          cancelable: true,
          clientX: vx,
          clientY: vy,
          deltaX: dx,
          deltaY: dy
        };

        let prevented = false;
        const onWheel = (e) => {
          if (e.defaultPrevented) prevented = true;
        };
        el.addEventListener('wheel', onWheel, { once: true });
        const evt = new WheelEvent('wheel', evtInit);
        el.dispatchEvent(evt);

        // 如果 wheel 没有滚动（或被阻止），尝试直接 scrollBy
        try {
          if (typeof el.scrollBy === 'function') {
            el.scrollBy({ left: dx, top: dy, behavior: 'auto' });
          } else {
            window.scrollBy({ left: dx, top: dy, behavior: 'auto' });
          }
        } catch (e) {
          // ignore
        }

        return {
          success: true,
          x: vx,
          y: vy,
          deltaX: dx,
          deltaY: dy,
          targetTag: el.tagName,
          prevented
        };
      },
      args: [x, y, deltaX, deltaY]
    });

    return result[0]?.result || { success: false, error: '执行失败' };
  } catch (error) {
    console.error('❌ wheel 失败:', error);
    return { success: false, error: error.message };
  }
}

async function executeScrollPage(tabId, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (options) => {
        const behavior = options.smooth ? 'smooth' : 'auto';
        const direction = (options.direction || '').toLowerCase();
        const amount = typeof options.amount === 'number' ? options.amount : 800;
        const x = typeof options.x === 'number' ? options.x : 0;
        const y = typeof options.y === 'number' ? options.y : 0;

        let dx = x;
        let dy = y;
        if (!dx && !dy) {
          if (direction === 'up') dy = -amount;
          else if (direction === 'down') dy = amount;
          else if (direction === 'left') dx = -amount;
          else if (direction === 'right') dx = amount;
          else dy = amount;
        }

        const before = { x: window.scrollX, y: window.scrollY };
        window.scrollBy({ left: dx, top: dy, behavior });
        const after = { x: window.scrollX, y: window.scrollY };
        return { success: true, before, after, dx, dy };
      },
      args: [options]
    });
    return result[0]?.result || { success: false, error: '执行失败' };
  } catch (error) {
    console.error('❌ scroll 失败:', error);
    return { success: false, error: error.message };
  }
}

async function executeScrollTo(tabId, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (options) => {
        const behavior = options.smooth ? 'smooth' : 'auto';
        const pos = (options.position || '').toLowerCase();
        const before = { x: window.scrollX, y: window.scrollY };

        if (pos === 'top') {
          window.scrollTo({ top: 0, left: 0, behavior });
        } else if (pos === 'bottom') {
          const el = document.scrollingElement || document.documentElement;
          window.scrollTo({ top: el.scrollHeight, left: 0, behavior });
        } else {
          const top = typeof options.top === 'number' ? options.top : before.y;
          const left = typeof options.left === 'number' ? options.left : before.x;
          window.scrollTo({ top, left, behavior });
        }

        const after = { x: window.scrollX, y: window.scrollY };
        return { success: true, before, after };
      },
      args: [options]
    });
    return result[0]?.result || { success: false, error: '执行失败' };
  } catch (error) {
    console.error('❌ scroll_to 失败:', error);
    return { success: false, error: error.message };
  }
}

async function executeScrollToText(tabId, text, occurrence = 1) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (text, occurrence) => {
        const needle = String(text || '').trim();
        if (!needle) return { success: false, error: 'text 为空' };
        const occ = Math.max(1, Number(occurrence) || 1);

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let node;
        let found = 0;
        while ((node = walker.nextNode())) {
          const v = (node.nodeValue || '').trim();
          if (!v) continue;
          if (v.includes(needle)) {
            found += 1;
            if (found === occ) {
              const el = node.parentElement || node.parentNode;
              if (el && el.scrollIntoView) {
                el.scrollIntoView({ behavior: 'auto', block: 'center' });
                try {
                  const r = el.getBoundingClientRect();
                  return {
                    success: true,
                    found,
                    tag: el.tagName,
                    preview: v.slice(0, 120),
                    rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
                  };
                } catch (e) {
                  return { success: true, found, tag: el.tagName, preview: v.slice(0, 120) };
                }
              }
              return { success: false, error: '找到文本但无法滚动到元素' };
            }
          }
        }
        return { success: false, error: `未找到文本: ${needle}` };
      },
      args: [text, occurrence]
    });

    return result[0]?.result || { success: false, error: '执行失败' };
  } catch (error) {
    console.error('❌ scroll_to_text 失败:', error);
    return { success: false, error: error.message };
  }
}

async function executeScrollContainer(tabId, selector, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector, options) => {
        const behavior = options.smooth ? 'smooth' : 'auto';
        const direction = (options.direction || '').toLowerCase();
        const amount = typeof options.amount === 'number' ? options.amount : 600;
        const x = typeof options.x === 'number' ? options.x : 0;
        const y = typeof options.y === 'number' ? options.y : 0;

        const el = selector ? document.querySelector(selector) : null;
        if (!el) return { success: false, error: `未找到容器: ${selector}` };

        let dx = x;
        let dy = y;
        if (!dx && !dy) {
          if (direction === 'up') dy = -amount;
          else if (direction === 'down') dy = amount;
          else if (direction === 'left') dx = -amount;
          else if (direction === 'right') dx = amount;
          else dy = amount;
        }

        const before = { left: el.scrollLeft, top: el.scrollTop };
        if (typeof el.scrollBy === 'function') {
          el.scrollBy({ left: dx, top: dy, behavior });
        } else {
          el.scrollTop += dy;
          el.scrollLeft += dx;
        }
        const after = { left: el.scrollLeft, top: el.scrollTop };
        return { success: true, before, after, dx, dy, tag: el.tagName };
      },
      args: [selector, options]
    });
    return result[0]?.result || { success: false, error: '执行失败' };
  } catch (error) {
    console.error('❌ scroll_container 失败:', error);
    return { success: false, error: error.message };
  }
}

async function executeDrag(tabId, from, to, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (from, to, options) => {
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        const steps = Math.max(1, Math.min(80, Number(options.steps) || 20));
        const durationMs = Math.max(0, Math.min(3000, Number(options.durationMs) || 0));

        const resolvePoint = (p) => {
          if (!p) return null;
          // selector + offset 优先
          if (p.selector) {
            const el = document.querySelector(p.selector);
            if (el) {
              const r = el.getBoundingClientRect();
              const ox = Number(p.offsetX) || r.width / 2;
              const oy = Number(p.offsetY) || r.height / 2;
              return { x: r.left + ox, y: r.top + oy, via: 'selector', tag: el.tagName };
            }
          }
          if (typeof p.x === 'number' && typeof p.y === 'number') {
            return { x: p.x, y: p.y, via: 'xy' };
          }
          return null;
        };

        const a = resolvePoint(from);
        const b = resolvePoint(to);
        if (!a || !b) return { success: false, error: 'drag 缺少 from/to 坐标或 selector' };

        const ax = clamp(Math.round(a.x), 0, window.innerWidth - 1);
        const ay = clamp(Math.round(a.y), 0, window.innerHeight - 1);
        const bx = clamp(Math.round(b.x), 0, window.innerWidth - 1);
        const by = clamp(Math.round(b.y), 0, window.innerHeight - 1);

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const stepDelay = durationMs > 0 ? Math.floor(durationMs / steps) : 0;

        const downTarget = document.elementFromPoint(ax, ay) || document.body;
        const common = (x, y) => ({
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: 1
        });

        // pointer + mouse 组合，适配更多组件
        try {
          downTarget.dispatchEvent(new PointerEvent('pointerdown', { ...common(ax, ay), pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        } catch (e) {}
        downTarget.dispatchEvent(new MouseEvent('mousedown', common(ax, ay)));

        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const x = Math.round(ax + (bx - ax) * t);
          const y = Math.round(ay + (by - ay) * t);
          const moveTarget = document.elementFromPoint(x, y) || document.body;
          try {
            moveTarget.dispatchEvent(new PointerEvent('pointermove', { ...common(x, y), pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          } catch (e) {}
          moveTarget.dispatchEvent(new MouseEvent('mousemove', common(x, y)));
          if (stepDelay) await sleep(stepDelay);
        }

        const upTarget = document.elementFromPoint(bx, by) || document.body;
        try {
          upTarget.dispatchEvent(new PointerEvent('pointerup', { ...common(bx, by), pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        } catch (e) {}
        upTarget.dispatchEvent(new MouseEvent('mouseup', common(bx, by)));

        // 尝试触发 HTML5 DnD（部分场景需要）
        try {
          const dt = new DataTransfer();
          downTarget.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ax, clientY: ay }));
          upTarget.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: bx, clientY: by }));
          upTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: bx, clientY: by }));
          downTarget.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: bx, clientY: by }));
        } catch (e) {
          // ignore
        }

        return { success: true, from: { x: ax, y: ay, via: a.via }, to: { x: bx, y: by, via: b.via }, steps };
      },
      args: [from, to, options]
    });

    return result[0]?.result || { success: false, error: '执行失败' };
  } catch (error) {
    console.error('❌ drag 失败:', error);
    return { success: false, error: error.message };
  }
}

// 获取页面结果
async function getPageResult(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // 尝试获取常见的结果区域
        const resultSelectors = [
          '.result-preview',
          '.ant-table',
          '.query-result',
          '[class*="result"]',
          '[class*="Result"]',
          'table',
          '.data-table'
        ];
        
        for (const selector of resultSelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent && el.textContent.trim().length > 0) {
            return {
              success: true,
              result: el.textContent.trim().substring(0, 2000),
              selector: selector
            };
          }
        }
        
        // 如果没有找到特定结果区域，返回页面主要内容
        return {
          success: true,
          result: document.body?.innerText?.substring(0, 2000) || '未找到结果',
          selector: 'body'
        };
      }
    });
    
    return result[0]?.result || { success: false, error: '获取结果失败' };
  } catch (error) {
    console.error('❌ 获取结果失败:', error);
    return { success: false, error: error.message };
  }
}

// 获取当前页可交互元素（用于 click/type 的选择依据）
async function getPageInfoSummary(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const escapeCss = (s) => {
          try {
            return CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
          } catch (e) {
            return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
          }
        };

        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const cssPath = (el) => {
          if (!el || el.nodeType !== 1) return '';
          if (el.id) return `#${escapeCss(el.id)}`;
          const parts = [];
          let cur = el;
          while (cur && cur.nodeType === 1 && cur !== document.body) {
            let part = cur.tagName.toLowerCase();
            if (cur.classList && cur.classList.length > 0) {
              const cls = Array.from(cur.classList).slice(0, 2).map(escapeCss).join('.');
              if (cls) part += `.${cls}`;
            }
            const parent = cur.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
              if (siblings.length > 1) {
                const idx = siblings.indexOf(cur);
                part += `:nth-of-type(${idx + 1})`;
              }
            }
            parts.unshift(part);
            cur = cur.parentElement;
          }
          return parts.join(' > ');
        };

        const clickCandidates = Array.from(document.querySelectorAll(
          'button, a, [role="button"], input[type="button"], input[type="submit"], [onclick]'
        ))
          .filter(isVisible)
          .slice(0, 40)
          .map((el, idx) => {
            const r = el.getBoundingClientRect();
            return {
              index: idx,
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || el.value || '').trim().slice(0, 80),
              id: el.id || '',
              className: (el.className && typeof el.className === 'string') ? el.className.slice(0, 120) : '',
              selector: cssPath(el),
              rect: {
                x: Math.round(r.left),
                y: Math.round(r.top),
                width: Math.round(r.width),
                height: Math.round(r.height),
                centerX: Math.round(r.left + r.width / 2),
                centerY: Math.round(r.top + r.height / 2),
                pageX: Math.round(r.left + r.width / 2 + window.scrollX),
                pageY: Math.round(r.top + r.height / 2 + window.scrollY)
              }
            };
          });

        const inputCandidates = Array.from(document.querySelectorAll('input, textarea'))
          .filter(isVisible)
          .slice(0, 40)
          .map((el, idx) => {
            const r = el.getBoundingClientRect();
            return {
              index: idx,
              tag: el.tagName.toLowerCase(),
              type: el.type || '',
              placeholder: (el.placeholder || '').slice(0, 80),
              name: el.name || '',
              id: el.id || '',
              selector: cssPath(el),
              rect: {
                x: Math.round(r.left),
                y: Math.round(r.top),
                width: Math.round(r.width),
                height: Math.round(r.height),
                centerX: Math.round(r.left + r.width / 2),
                centerY: Math.round(r.top + r.height / 2),
                pageX: Math.round(r.left + r.width / 2 + window.scrollX),
                pageY: Math.round(r.top + r.height / 2 + window.scrollY)
              }
            };
          });

        const scrollCandidates = Array.from(document.querySelectorAll('div, section, main, aside, ul, ol, table, [role="table"], [role="grid"]'))
          .filter(isVisible)
          .filter(el => {
            const style = window.getComputedStyle(el);
            const oy = style?.overflowY;
            const ox = style?.overflowX;
            const canY = (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 10;
            const canX = (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 10;
            return canY || canX;
          })
          .slice(0, 25)
          .map((el, idx) => {
            const r = el.getBoundingClientRect();
            return {
              index: idx,
              tag: el.tagName.toLowerCase(),
              id: el.id || '',
              className: (el.className && typeof el.className === 'string') ? el.className.slice(0, 120) : '',
              selector: cssPath(el),
              scroll: {
                scrollTop: Math.round(el.scrollTop || 0),
                scrollLeft: Math.round(el.scrollLeft || 0),
                scrollHeight: Math.round(el.scrollHeight || 0),
                scrollWidth: Math.round(el.scrollWidth || 0),
                clientHeight: Math.round(el.clientHeight || 0),
                clientWidth: Math.round(el.clientWidth || 0)
              },
              rect: {
                x: Math.round(r.left),
                y: Math.round(r.top),
                width: Math.round(r.width),
                height: Math.round(r.height),
                centerX: Math.round(r.left + r.width / 2),
                centerY: Math.round(r.top + r.height / 2)
              }
            };
          });

        return {
          success: true,
          url: location.href,
          title: document.title,
          clickables: clickCandidates,
          inputs: inputCandidates,
          scrollables: scrollCandidates
        };
      }
    });

    return result[0]?.result || { success: false, error: '获取页面信息失败' };
  } catch (error) {
    console.error('❌ 获取页面信息失败:', error);
    return { success: false, error: error.message };
  }
}

async function syncPageContext() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id || !isOperablePageUrl(activeTab.url)) {
      return { success: false, error: '未找到可同步的页面' };
    }

    const summary = await getPageInfoSummary(activeTab.id);
    if (!summary?.success) {
      return { success: false, error: summary?.error || '页面同步失败' };
    }

    const trimmed = {
      url: summary.url,
      title: summary.title,
      clickables: (summary.clickables || []).slice(0, 12),
      inputs: (summary.inputs || []).slice(0, 12),
      scrollables: (summary.scrollables || []).slice(0, 8)
    };

    lastPageContextSummary = trimmed;
    return {
      success: true,
      summary: {
        clickableCount: summary.clickables?.length || 0,
        inputCount: summary.inputs?.length || 0,
        scrollableCount: summary.scrollables?.length || 0
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 调用 AI（带超时处理）
async function callAI(messages, model = 'gemini-3-pro-preview', timeout = 60000, options = {}) {
  let controller = null;
  try {
    await loadConfigFromStorage();
    if (!API_TOKEN) {
      throw new Error('API Token 未配置，请在侧边栏配置后重试');
    }

    const requestUrl = normalizeApiUrl(API_URL);
    controller = new AbortController();
    // 仅任务执行链路注册可取消的 controller（聊天不影响）
    if (currentTask) activeTaskAbortControllers.add(controller);
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const maxTokens = typeof options.max_tokens === 'number' ? options.max_tokens : 2000;
    
    // 根据模型类型决定是否使用 temperature 参数
    // 某些模型（如 GPT-5）不支持低 temperature，只支持默认值 1
    const modelLower = String(model || '').toLowerCase();
    
    // 检测可能不支持低 temperature 的模型
    // 包括：gpt-5, gpt-5-*, 以及其他可能不支持的模型
    const mayNotSupportLowTemperature = modelLower.includes('gpt-5') || 
                                         modelLower.startsWith('gpt-5') ||
                                         modelLower === 'gpt-5';
    
    let temperature = typeof options.temperature === 'number' ? options.temperature : 0.2;
    let originalTemperature = temperature; // 保存原始值用于日志
    
    // 如果模型可能不支持低 temperature，且 temperature < 1，则不传该参数
    if (mayNotSupportLowTemperature && temperature < 1) {
      console.log(`⚠️ 模型 ${model} 可能不支持 temperature=${temperature}，使用 API 默认值（不传 temperature 参数）`);
      temperature = undefined; // 不传 temperature，让 API 使用默认值
    }
    
    const requestBody = {
      model: model,
      messages: messages,
      max_tokens: maxTokens
    };
    
    // 只有当 temperature 有值时才添加到请求体
    if (temperature !== undefined) {
      requestBody.temperature = temperature;
      console.log(`📊 请求参数: model=${model}, temperature=${temperature}, max_tokens=${maxTokens}`);
    } else {
      console.log(`📊 请求参数: model=${model}, temperature=undefined(使用默认值), max_tokens=${maxTokens}`);
    }
    
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
        // 与 popup 保持一致，便于后端按客户端做路由/策略处理
        'X-Mtcc-Client': 'shenzhou-assistant-extension'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    let data;
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI 调用失败:', response.status, errorText);
      
      // 检查是否是 temperature 不支持的错误（更宽松的检测）
      const isTemperatureError = errorText.includes('temperature') && 
                                 (errorText.includes('does not support') || 
                                  errorText.includes('unsupported') ||
                                  errorText.includes('Only the default') ||
                                  errorText.includes('invalid_request_error'));
      
      console.log(`🔍 错误检测: isTemperatureError=${isTemperatureError}, temperature=${temperature}, originalTemperature=${originalTemperature}`);
      
      if (isTemperatureError) {
        // 如果是 temperature 错误，自动重试使用默认值（不传 temperature）
        console.log(`⚠️ 检测到 temperature 不支持错误，自动重试使用默认值（不传 temperature 参数）`);
        controller = new AbortController();
        if (currentTask) activeTaskAbortControllers.add(controller);
        const retryTimeoutId = setTimeout(() => controller.abort(), timeout);
        
        const retryBody = {
          model: model,
          messages: messages,
          max_tokens: maxTokens
          // 不传 temperature，使用 API 默认值
        };
        
        const retryResponse = await fetch(requestUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json',
            'X-Mtcc-Client': 'shenzhou-assistant-extension'
          },
          body: JSON.stringify(retryBody),
          signal: controller.signal
        });
        
        clearTimeout(retryTimeoutId);
        
        if (!retryResponse.ok) {
          const retryErrorText = await retryResponse.text();
          throw new Error(`AI 调用失败: ${retryResponse.status} - ${retryErrorText.substring(0, 200)}`);
        }
        
        // 使用重试的响应继续处理
        data = await retryResponse.json();
      } else {
        throw new Error(`AI 调用失败: ${response.status} - ${errorText.substring(0, 200)}`);
      }
    } else {
      // 正常响应，解析 JSON
      data = await response.json();
    }
    
    if (DEBUG_AI) {
      console.log('='.repeat(80));
      console.log('AI 响应处理开始');
      console.log('='.repeat(80));
      console.log('响应状态码:', response.status);
      console.log('响应键:', Object.keys(data));
      console.log('完整响应:', JSON.stringify(data, null, 2).substring(0, 2000));
      console.log('是否有 choices:', 'choices' in data);
      console.log('choices 类型:', typeof data.choices);
      console.log('choices 是否为数组:', Array.isArray(data.choices));
      if (data.choices) {
        console.log('choices 长度:', data.choices.length);
        if (data.choices.length > 0) {
          console.log('choice[0] 键:', Object.keys(data.choices[0]));
          console.log('choice[0] 内容:', JSON.stringify(data.choices[0], null, 2));
        }
      }
    }
    
    // 处理不同的响应格式（和测试脚本逻辑一致）
    let content = '';
    
    // 格式1: OpenAI 标准格式 {choices: [{message: {content: "..."}}]}
    if (DEBUG_AI) {
      console.log('检查 choices:', {
        exists: !!data.choices,
        isArray: Array.isArray(data.choices),
        length: data.choices?.length
      });
    }
    
    if (data.choices && Array.isArray(data.choices)) {
      if (DEBUG_AI) console.log('✅ 进入格式1分支，choices 长度:', data.choices.length);
      
      if (data.choices.length === 0) {
        // choices 为空数组，可能是请求被过滤或拒绝
        console.error('❌ choices 是空数组！');
        console.error('完整响应:', JSON.stringify(data, null, 2));
        console.error('usage:', data.usage);
        
        const errorMsg = `AI 响应异常：choices 为空数组。
可能的原因：
1. 请求被内容安全策略过滤
2. SYSTEM_PROMPT 太长（当前约 ${data.usage?.prompt_tokens || '未知'} tokens）
3. API 限制或配额问题

建议：
1. 尝试简化请求
2. 检查 API 配额
3. 联系 API 管理员

usage: ${JSON.stringify(data.usage)}`;
        throw new Error(errorMsg);
      }
      
      if (data.choices.length > 0) {
        if (DEBUG_AI) console.log('✅ 使用格式1: OpenAI 标准格式');
        const choice = data.choices[0];
        if (DEBUG_AI) console.log('choice 对象:', choice);
        
        // 检查是否有 message
        if (!choice.message && !choice.delta) {
          console.error('❌ choice 中没有 message 和 delta');
          console.error('choice 完整内容:', JSON.stringify(choice, null, 2));
          
          if (choice.finish_reason === 'length') {
            const errorMsg = `AI 响应被截断（finish_reason: length）。
当前 max_tokens: 8000
建议：
1. 检查 SYSTEM_PROMPT 是否过长（当前约 ${data.usage?.prompt_tokens || '未知'} tokens）
2. 检查 messages 历史是否过长
3. 尝试简化请求或联系 API 管理员

usage: ${JSON.stringify(data.usage)}`;
            throw new Error(errorMsg);
          }
          throw new Error(`AI 响应格式异常：choice 中没有 message。choice: ${JSON.stringify(choice)}`);
        }
        
        const message = choice.message || choice.delta;
        console.log('message 对象:', message);
        
        // 检查是否有 refusal（function call 被拒绝的情况）
        if (message?.refusal) {
          console.warn('⚠️ AI 返回了 refusal（可能是 function call 被拒绝）:', message.refusal);
          // 如果 refusal 包含 function call，说明 AI 试图调用函数但被拒绝
          // 这种情况下，如果已经有搜索结果，直接使用搜索结果生成回复
          if (message.refusal.includes('call:confluence_search') || message.refusal.includes('function_call')) {
            console.log('✅ 检测到 function call refusal，将使用已有搜索结果');
            // 不设置 content，让后续逻辑处理
          } else {
            // 其他类型的 refusal，直接使用 refusal 作为回复
            content = message.refusal;
            console.log('✅ 使用 refusal 作为回复');
          }
        }
        
        if (message && !content) {
          const msgContent = message.content;
          console.log('message.content 类型:', typeof msgContent);
          console.log('message.content 值:', msgContent);
          
          if (typeof msgContent === 'string') {
            content = msgContent;
            console.log('✅ 提取到字符串 content:', content.substring(0, 200));
            
            // 检查是否被截断
            if (choice.finish_reason === 'length') {
              console.warn('⚠️ AI 响应被截断（finish_reason: length），但已提取部分内容');
              // 不抛出错误，尝试使用已提取的内容
            }
          } else if (Array.isArray(msgContent)) {
            console.log('message.content 是数组，长度:', msgContent.length);
            content = msgContent
              .filter(item => item.type === 'text' || !item.type)
              .map(item => item.text || item.content || String(item))
              .join('');
            console.log('✅ 从数组提取到 content:', content.substring(0, 200));
          } else if (msgContent) {
            content = String(msgContent);
            console.log('✅ 转换为字符串 content:', content.substring(0, 200));
          } else {
            console.warn('⚠️ message.content 为空或 undefined');
          }
        } else if (!message) {
          console.error('❌ message 对象为空');
        }
      }
    } else {
      // choices 不存在或不是数组
      console.error('❌ choices 不存在或不是数组');
      console.error('data.choices:', data.choices);
      console.error('typeof data.choices:', typeof data.choices);
      console.error('Array.isArray(data.choices):', Array.isArray(data.choices));
      
      // 如果 choices 存在但是空数组，也应该在这里处理
      if (data.choices && Array.isArray(data.choices) && data.choices.length === 0) {
        const errorMsg = `AI 响应异常：choices 为空数组。
可能的原因：
1. 请求被内容安全策略过滤
2. SYSTEM_PROMPT 太长（当前约 ${data.usage?.prompt_tokens || '未知'} tokens）
3. API 限制或配额问题

usage: ${JSON.stringify(data.usage)}`;
        throw new Error(errorMsg);
      }
    }
    
    // 如果还没有提取到 content，尝试其他格式
    if (!content) {
      // 格式2: 直接返回 content
      if (data.content) {
        console.log('✅ 使用格式2: 直接返回 content');
        content = typeof data.content === 'string' ? data.content : String(data.content);
        console.log('提取的 content:', content.substring(0, 200));
      }
      // 格式3: 直接返回 text
      else if (data.text) {
        console.log('✅ 使用格式3: 直接返回 text');
        content = typeof data.text === 'string' ? data.text : String(data.text);
        console.log('提取的 content:', content.substring(0, 200));
      }
      // 格式4: 错误响应
      else if (data.error) {
        console.error('❌ 格式4: 错误响应');
        console.error('错误内容:', data.error);
        throw new Error(`AI API 错误: ${data.error.message || data.error}`);
      }
      // 格式5: 未知格式，尝试提取
      else {
      console.warn('⚠️ 未识别的响应格式，尝试提取内容');
      console.log('响应键:', Object.keys(data));
      console.log('完整响应:', JSON.stringify(data, null, 2).substring(0, 1000));
      
      // 尝试从响应中提取任何可能的文本内容
      const responseStr = JSON.stringify(data);
      
      // 尝试匹配 content 字段（可能在嵌套结构中，支持多行）
      const contentPatterns = [
        /"content"\s*:\s*"((?:[^"\\]|\\.|\\n)*)"/,  // 支持转义字符和多行
        /"content"\s*:\s*"([^"]+)"/,  // 简单匹配
        /"text"\s*:\s*"((?:[^"\\]|\\.|\\n)*)"/,  // text 字段
        /"message"\s*:\s*"((?:[^"\\]|\\.|\\n)*)"/  // message 字段
      ];
      
      for (const pattern of contentPatterns) {
        const match = responseStr.match(pattern);
        if (match && match[1]) {
          try {
            // 处理转义字符
            content = match[1]
              .replace(/\\n/g, '\n')
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, '\\')
              .replace(/\\t/g, '\t');
            console.log('✅ 从响应中提取到 content:', content.substring(0, 200));
            break;
          } catch (e) {
            console.error('提取 content 失败:', e);
          }
        }
      }
      
      // 如果还是没有提取到，尝试深度搜索
      if (!content) {
        try {
          // 递归搜索所有可能的 content 字段
          function findContent(obj, depth = 0) {
            if (depth > 5) return null; // 防止无限递归
            if (typeof obj !== 'object' || obj === null) return null;
            
            if (obj.content && typeof obj.content === 'string') {
              return obj.content;
            }
            if (obj.text && typeof obj.text === 'string') {
              return obj.text;
            }
            if (obj.message && typeof obj.message === 'string') {
              return obj.message;
            }
            
            for (const key in obj) {
              if (obj.hasOwnProperty(key)) {
                const result = findContent(obj[key], depth + 1);
                if (result) return result;
              }
            }
            return null;
          }
          
          content = findContent(data);
          if (content) {
            console.log('✅ 深度搜索找到 content:', content.substring(0, 200));
          }
        } catch (e) {
          console.error('深度搜索失败:', e);
        }
      }
      
      // 如果还是没有提取到，检查是否有 refusal 字段（function call 被拒绝的情况）
      if (!content) {
        try {
          const choice = data.choices?.[0];
          if (choice?.message?.refusal) {
            const refusal = choice.message.refusal;
            console.warn('⚠️ AI 返回了 refusal（可能是 function call 被拒绝）:', refusal);
            
            // 如果 refusal 包含 function call，说明 AI 试图调用函数但被拒绝
            // 这种情况下，抛出特殊错误，让调用方处理
            if (refusal.includes('call:confluence_search') || refusal.includes('function_call') || refusal.includes('malformed')) {
              // 这是一个 function call 被拒绝的情况
              // 抛出特殊错误，让调用方知道已经有搜索结果了
              const error = new Error('AI function call refused');
              error.refusal = refusal;
              error.hasResults = true;
              throw error;
            } else {
              // 其他类型的 refusal，直接使用 refusal 作为回复
              content = refusal;
              console.log('✅ 使用 refusal 作为回复');
            }
          }
        } catch (e) {
          if (e.hasResults) {
            // 重新抛出，让调用方处理
            throw e;
          }
          console.error('处理 refusal 失败:', e);
        }
      }
      
	      if (!content) {
	        // 显示完整的响应以便调试
	        const errorMsg = `AI 响应格式异常：无法提取内容。
	响应键: ${Object.keys(data).join(', ')}
	完整响应: ${responseStr.substring(0, 2000)}`;
	        console.error(errorMsg);
	        throw new Error(errorMsg);
	      }
	    }
	    }
    
    if (!content) {
      console.error('AI 响应中 content 为空，完整响应:', JSON.stringify(data, null, 2));
      throw new Error(`AI 响应格式异常：content 为空。响应: ${JSON.stringify(data).substring(0, 1000)}`);
    }
    
    console.log('提取的 content:', content.substring(0, 200));
    return content;
  } catch (error) {
    if (error && (error.name === 'AbortError' || String(error).includes('AbortError'))) {
      // 任务取消导致的 abort
      if (taskControl.canceled && controller && activeTaskAbortControllers.has(controller)) {
        throw new Error('任务已取消');
      }
      const timeoutMessage = `AI 调用超时（${timeout}ms）`;
      console.error(timeoutMessage);
      throw new Error(timeoutMessage);
    }
    console.error('callAI 错误:', error);
    throw error;
  } finally {
    if (controller) activeTaskAbortControllers.delete(controller);
  }
}

async function callAIStream(messages, model = 'gemini-3-pro-preview', timeout = 60000, options = {}, onChunk = null) {
  let controller = null;
  try {
    await loadConfigFromStorage();
    if (!API_TOKEN) {
      throw new Error('API Token 未配置，请在侧边栏配置后重试');
    }

    const requestUrl = normalizeApiUrl(API_URL);
    const maxTokens = typeof options.max_tokens === 'number' ? options.max_tokens : 2000;

    const modelLower = String(model || '').toLowerCase();
    const mayNotSupportLowTemperature = modelLower.includes('gpt-5') ||
                                         modelLower.startsWith('gpt-5') ||
                                         modelLower === 'gpt-5';
    let temperature = typeof options.temperature === 'number' ? options.temperature : 0.2;
    if (mayNotSupportLowTemperature && temperature < 1) {
      temperature = undefined;
    }

    const buildBody = (override = {}) => {
      const requestBody = {
        model: model,
        messages: messages,
        max_tokens: maxTokens,
        ...override
      };
      if (temperature !== undefined && override.temperature !== null) {
        requestBody.temperature = temperature;
      }
      return requestBody;
    };

    const runRequest = async (body) => {
      controller = new AbortController();
      if (currentTask) activeTaskAbortControllers.add(controller);
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Mtcc-Client': 'shenzhou-assistant-extension'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response;
    };

    let response = await runRequest(buildBody({ stream: true }));

    if (!response.ok) {
      const errorText = await response.text();
      const isTemperatureError = errorText.includes('temperature') &&
        (errorText.includes('does not support') ||
         errorText.includes('unsupported') ||
         errorText.includes('Only the default') ||
         errorText.includes('invalid_request_error'));
      if (isTemperatureError && temperature !== undefined) {
        temperature = undefined;
        response = await runRequest(buildBody({ stream: true, temperature: null }));
      } else {
        throw new Error(`AI 调用失败 (${response.status}): ${errorText.substring(0, 200)}`);
      }
    }

    const contentType = response.headers.get('content-type') || '';
    if (!response.body || !contentType.includes('text/event-stream')) {
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return text;
      }
      if (!data?.choices?.length) return '';
      const choice = data.choices[0];
      return choice.message?.content || choice.text || '';
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.replace(/^data:\s*/, '');
        if (payload === '[DONE]') {
          buffer = '';
          break;
        }
        if (!payload) continue;
        let json;
        try {
          json = JSON.parse(payload);
        } catch (e) {
          continue;
        }
        const delta = json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content ?? '';
        if (delta) {
          fullText += delta;
          if (typeof onChunk === 'function') {
            try {
              onChunk(delta);
            } catch (e) {
              // ignore
            }
          }
        }
      }
    }

    return fullText;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('AI 调用超时');
    }
    throw error;
  } finally {
    if (controller && currentTask) activeTaskAbortControllers.delete(controller);
  }
}

// 解析 AI 返回的操作
function parseAction(text) {
  if (!text) {
    console.error('parseAction: text 为空');
    return null;
  }
  
  console.log('parseAction 输入:', text.substring(0, 200));
  
  // 清理文本：去掉前后空白、换行等
  let cleaned = text.trim();
  console.log('清理后:', cleaned.substring(0, 200));
  
  // 1. 尝试直接解析
  try {
    const result = JSON.parse(cleaned);
    console.log('✅ 直接解析成功:', result);
    
    // 如果返回的是数组，取第一个元素
    if (Array.isArray(result) && result.length > 0) {
      console.log('⚠️ 解析到数组，取第一个元素');
      return result[0];
    }
    
    return result;
  } catch (e) {
    console.log('直接解析失败:', e.message);
    // 继续尝试其他方式
  }
  
  // 2. 尝试提取 markdown 代码块中的 JSON（支持多行，支持对象和数组）
  const codeBlockMatch = text.match(/```(?:json)?\s*([\[\{][\s\S]*?[\]\}])\s*```/);
  if (codeBlockMatch) {
    const jsonInBlock = codeBlockMatch[1].trim();
    console.log('找到 markdown 代码块:', jsonInBlock.substring(0, 100));
    try {
      const result = JSON.parse(jsonInBlock);
      console.log('✅ markdown 代码块解析成功');
      
      // 如果返回的是数组，取第一个元素
      if (Array.isArray(result) && result.length > 0) {
        console.log('⚠️ 解析到数组，取第一个元素');
        return result[0];
      }
      
      return result;
    } catch (e) {
      console.log('markdown 代码块解析失败:', e.message);
      // 继续尝试其他方式
    }
  }
  
  // 3. 尝试提取第一个完整的 JSON 对象（更智能的匹配）
  // 先尝试匹配完整的 JSON（从 { 到对应的 }）
  let braceCount = 0;
  let startIdx = cleaned.indexOf('{');
  if (startIdx !== -1) {
    let endIdx = startIdx;
    let inString = false;
    let escapeNext = false;
    
    for (let i = startIdx; i < cleaned.length; i++) {
      const char = cleaned[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"') {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') braceCount++;
        if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            endIdx = i;
            break;
          }
        }
      }
    }
    
    if (endIdx > startIdx && braceCount === 0) {
      try {
        const jsonStr = cleaned.substring(startIdx, endIdx + 1);
        console.log('括号匹配提取:', jsonStr.substring(0, 200));
        const result = JSON.parse(jsonStr);
        console.log('✅ 括号匹配解析成功:', result);
        
        // 如果返回的是数组，取第一个元素
        if (Array.isArray(result) && result.length > 0) {
          console.log('⚠️ 解析到数组，取第一个元素');
          return result[0];
        }
        
        return result;
      } catch (e) {
        console.error('括号匹配提取失败:', e.message);
        // 继续
      }
    }
  }
  
  // 备用方案：简单匹配（支持对象和数组）
  const jsonMatch = text.match(/[\[\{][\s\S]*[\]\}]/);
  if (jsonMatch) {
    try {
      const result = JSON.parse(jsonMatch[0]);
      
      // 如果返回的是数组，取第一个元素
      if (Array.isArray(result) && result.length > 0) {
        console.log('⚠️ 解析到数组，取第一个元素');
        return result[0];
      }
      
      return result;
    } catch (e) {
      // 继续
    }
  }
  
  // 4. 尝试提取多行 JSON（去掉可能的注释）
  const cleanedText = text
    .replace(/\/\/.*$/gm, '') // 去掉单行注释
    .replace(/\/\*[\s\S]*?\*\//g, '') // 去掉多行注释
    .trim();
  
  const cleanedMatch = cleanedText.match(/\{[\s\S]*\}/);
  if (cleanedMatch) {
    try {
      return JSON.parse(cleanedMatch[0]);
    } catch (e) {
      // 最后尝试失败
    }
  }
  
  // 记录详细的错误信息
  console.error('无法解析 AI 返回:', {
    text: text.substring(0, 500),
    length: text.length,
    firstChar: text[0],
    lastChar: text[text.length - 1]
  });
  return null;
}

// 执行操作
async function executeAction(action) {
  if (taskControl.canceled) {
    return { success: false, error: '任务已取消', stopExecution: true };
  }
  await waitIfPaused();

  // 获取当前活动的标签页
  let tab = null;
  if (currentTabId) {
    try {
      tab = await chrome.tabs.get(currentTabId);
    } catch (e) {
      currentTabId = null;
    }
  }
  
  if (!tab) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
  }
  
  // 如果还是没有标签页，创建一个
  if (!tab) {
    if (action.action === 'navigate') {
      const newTab = await chrome.tabs.create({ url: action.url, active: true });
      currentTabId = newTab.id;
      await sleep(2000); // 等待页面加载（减少到2秒）
      return { success: true };
    } else {
      // 其他操作需要先导航到临时查询页面
      const newTab = await chrome.tabs.create({ 
        url: 'https://shenzhou.tatstm.com/data-develop/query', 
        active: true 
      });
      currentTabId = newTab.id;
      await sleep(2000); // 等待页面加载（减少到2秒）
      tab = await chrome.tabs.get(currentTabId);
    }
  } else {
    currentTabId = tab.id;
  }
  
  switch (action.action) {
    case 'navigate':
      // 兼容不同的字段名：url 或 参数
      const url = action.url || action.参数;
      if (!url) {
        addLog(`❌ navigate 操作缺少 url 参数。action: ${JSON.stringify(action)}`, 'error');
        return { success: false, error: `navigate 操作缺少 url 参数。收到的 action: ${JSON.stringify(action)}` };
      }
      
      // 获取当前页面信息
      let currentPageInfo = '';
      try {
        if (currentTabId) {
          const tab = await chrome.tabs.get(currentTabId);
          currentPageInfo = `当前页面: ${tab.url || '未知'}, 标题: ${tab.title || '未知'}`;
          addLog(`📄 ${currentPageInfo}`, 'info');
        }
      } catch (e) {
        addLog(`⚠️ 无法获取当前页面信息: ${e.message}`, 'warn');
      }
      
      addLog(`🌐 导航操作: 从 ${currentPageInfo || '未知页面'} 导航到 ${url}`, 'action');
      
      // 如果已经有标签页，更新它；否则上面已经创建了
      if (currentTabId) {
        await chrome.tabs.update(currentTabId, { url: url });
        addLog(`✅ 已更新标签页 ${currentTabId} 的 URL`, 'success');
        const navResult = await waitForTabComplete(currentTabId, 8000);
        if (!navResult.ok) addLog('⚠️ 页面加载超时，继续执行后续步骤', 'warn');
        
        // 验证导航是否成功
        try {
          const newTab = await chrome.tabs.get(currentTabId);
          addLog(`✅ 导航完成: 新页面 URL: ${newTab.url || '未知'}, 标题: ${newTab.title || '未知'}`, 'success');
        } catch (e) {
          addLog(`⚠️ 无法验证导航结果: ${e.message}`, 'warn');
        }
      }
      return { success: true };
      
    case 'wait':
      // 兼容不同的字段名：seconds 或 参数
      const seconds = action.seconds || (action.参数 ? parseInt(action.参数) : null) || 1;
      await sleep(seconds * 1000);
      return { success: true };

    case 'get_page_info': {
      addLog(`📄 获取页面可交互元素...`, 'action');
      const info = await getPageInfoSummary(currentTabId);
      if (info && info.success) {
        lastPageInfo = info;
        addLog(`✅ 页面信息获取成功：clickables=${info.clickables?.length || 0}，inputs=${info.inputs?.length || 0}，scrollables=${info.scrollables?.length || 0}`, 'success');
      } else {
        addLog(`⚠️ 页面信息获取失败：${info?.error || '未知错误'}`, 'warn');
      }
      return info;
    }

    case 'click': {
      const index = typeof action.index === 'number' ? action.index : (typeof action.索引 === 'number' ? action.索引 : null);
      const selectorOrText = action.selector || action.target || action.参数 || action.text || action.文本 || '';

      let clickTarget = selectorOrText;
      if (index !== null && lastPageInfo?.clickables?.[index]?.selector) {
        clickTarget = lastPageInfo.clickables[index].selector;
        addLog(`🖱️ click(index=${index}) -> ${clickTarget}`, 'action');
      } else {
        addLog(`🖱️ click -> ${clickTarget}`, 'action');
      }

      if (!clickTarget) {
        return { success: false, error: 'click 缺少 selector/text 或 index' };
      }
      let res = await executePageClick(currentTabId, clickTarget);
      if (res?.success) {
        addLog(`✅ 点击成功: ${res.clicked || clickTarget}`, 'success');
        return res;
      }

      // 复杂组件兜底：如果有 index 且拿得到坐标，则用坐标点击
      const rect = index !== null ? lastPageInfo?.clickables?.[index]?.rect : null;
      if (rect && typeof rect.centerX === 'number' && typeof rect.centerY === 'number') {
        addLog(`⚠️ 选择器点击失败，尝试坐标点击 (${rect.centerX}, ${rect.centerY})`, 'warn');
        const alt = await executeClickAt(currentTabId, rect.centerX, rect.centerY);
        if (alt?.success) {
          addLog(`✅ 坐标点击成功: ${alt.clicked || ''}`, 'success');
          return { ...alt, fallback: 'click_at' };
        }
      }

      addLog(`⚠️ 点击失败: ${res?.error || '未知错误'}`, 'warn');
      return res;
    }

    case 'click_at': {
      const x = action.x ?? action.clientX ?? action.横坐标;
      const y = action.y ?? action.clientY ?? action.纵坐标;
      if (typeof x !== 'number' || typeof y !== 'number') {
        return { success: false, error: 'click_at 需要数字 x/y' };
      }
      addLog(`🖱️ 坐标点击: (${x}, ${y})`, 'action');
      const res = await executeClickAt(currentTabId, x, y, { button: action.button });
      if (res?.success) addLog(`✅ 坐标点击成功`, 'success');
      else addLog(`⚠️ 坐标点击失败: ${res?.error || '未知错误'}`, 'warn');
      return res;
    }

    case 'type': {
      const index = typeof action.index === 'number' ? action.index : (typeof action.索引 === 'number' ? action.索引 : null);
      let selectorOrText = action.selector || action.target || action.field || action.字段 || action.selectorText || '';
      const param = action.参数;
      let text = action.text ?? action.value ?? action.内容 ?? action.值;
      // 兼容：只有“参数”的情况；有 text 时把“参数”当 selector，没有 text 时把“参数”当要输入的内容
      if (param && !selectorOrText && (text !== undefined && text !== null && String(text).length > 0)) {
        selectorOrText = String(param);
      } else if ((text === undefined || text === null) && param) {
        text = param;
      }
      text = text === undefined || text === null ? '' : String(text);

      let typeTarget = selectorOrText;
      if (index !== null && lastPageInfo?.inputs?.[index]?.selector) {
        typeTarget = lastPageInfo.inputs[index].selector;
        addLog(`⌨️ type(index=${index}) -> ${typeTarget}`, 'action');
      } else {
        addLog(`⌨️ type -> ${typeTarget}`, 'action');
      }

      // selector 为空也允许（会退化为“找第一个可输入框”）
      if (!typeTarget && index === null) {
        addLog(`⚠️ type 未指定输入框，将尝试使用第一个可输入框`, 'warn');
      }
      const res = await executePageType(currentTabId, typeTarget, String(text));
      if (res?.success) addLog(`✅ 输入成功`, 'success');
      else addLog(`⚠️ 输入失败: ${res?.error || '未知错误'}`, 'warn');
      return res;
    }

    case 'wheel': {
      const x = action.x ?? action.clientX ?? action.横坐标;
      const y = action.y ?? action.clientY ?? action.纵坐标;
      const deltaX = typeof action.deltaX === 'number' ? action.deltaX : 0;
      const deltaY = typeof action.deltaY === 'number' ? action.deltaY : (typeof action.参数 === 'number' ? action.参数 : 800);
      if (typeof x !== 'number' || typeof y !== 'number') {
        return { success: false, error: 'wheel 需要数字 x/y' };
      }
      addLog(`🧭 wheel: (${x}, ${y}) deltaY=${deltaY}`, 'action');
      const res = await executeWheelAt(currentTabId, x, y, deltaX, deltaY);
      if (res?.success) addLog(`✅ wheel 已发送`, 'success');
      else addLog(`⚠️ wheel 失败: ${res?.error || '未知错误'}`, 'warn');
      return res;
    }

    case 'scroll': {
      addLog(`🧭 页面滚动...`, 'action');
      const res = await executeScrollPage(currentTabId, {
        direction: action.direction || action.方向,
        amount: typeof action.amount === 'number' ? action.amount : undefined,
        x: typeof action.x === 'number' ? action.x : undefined,
        y: typeof action.y === 'number' ? action.y : undefined,
        smooth: !!action.smooth
      });
      if (res?.success) addLog(`✅ 已滚动`, 'success');
      else addLog(`⚠️ 滚动失败: ${res?.error || '未知错误'}`, 'warn');
      return res;
    }

    case 'scroll_to': {
      addLog(`🧭 滚动到指定位置...`, 'action');
      const res = await executeScrollTo(currentTabId, {
        position: action.position || action.位置,
        top: typeof action.top === 'number' ? action.top : undefined,
        left: typeof action.left === 'number' ? action.left : undefined,
        smooth: !!action.smooth
      });
      if (res?.success) addLog(`✅ 已滚动到位置`, 'success');
      else addLog(`⚠️ scroll_to 失败: ${res?.error || '未知错误'}`, 'warn');
      return res;
    }

    case 'scroll_to_text': {
      const text = action.text || action.参数 || action.文本;
      const occurrence = action.occurrence ?? action.n ?? action.次数 ?? 1;
      addLog(`🧭 滚动到文本: ${String(text || '').slice(0, 50)}`, 'action');
      const res = await executeScrollToText(currentTabId, text, occurrence);
      if (res?.success) addLog(`✅ 已定位到文本`, 'success');
      else addLog(`⚠️ scroll_to_text 失败: ${res?.error || '未知错误'}`, 'warn');
      return res;
    }

    case 'scroll_container': {
      const index = typeof action.index === 'number' ? action.index : (typeof action.索引 === 'number' ? action.索引 : null);
      let selector = action.selector || action.container || action.参数;
      if (!selector && index !== null && lastPageInfo?.scrollables?.[index]?.selector) {
        selector = lastPageInfo.scrollables[index].selector;
      }
      if (!selector) return { success: false, error: 'scroll_container 缺少 selector 或 index（先 get_page_info）' };
      addLog(`🧭 容器滚动: ${selector}`, 'action');
      const res = await executeScrollContainer(currentTabId, selector, {
        direction: action.direction || action.方向,
        amount: typeof action.amount === 'number' ? action.amount : undefined,
        x: typeof action.x === 'number' ? action.x : undefined,
        y: typeof action.y === 'number' ? action.y : undefined,
        smooth: !!action.smooth
      });
      if (res?.success) addLog(`✅ 容器已滚动`, 'success');
      else addLog(`⚠️ scroll_container 失败: ${res?.error || '未知错误'}`, 'warn');
      return res;
    }

    case 'drag': {
      addLog(`🧲 拖拽...`, 'action');
      const from = action.from || action.起点 || action.start;
      const to = action.to || action.终点 || action.end;
      const res = await executeDrag(currentTabId, from, to, {
        steps: action.steps ?? action.步数 ?? 20,
        durationMs: action.durationMs ?? action.时长 ?? 0
      });
      if (res?.success) addLog(`✅ 拖拽完成`, 'success');
      else addLog(`⚠️ 拖拽失败: ${res?.error || '未知错误'}`, 'warn');
      return res;
    }
      
    case 'input_sql':
      // 兼容不同的字段名：sql 或 参数
      const sql = action.sql || action.参数 || '';
      if (!sql || typeof sql !== 'string') {
        addLog(`❌ input_sql 操作缺少 sql 参数。action: ${JSON.stringify(action)}`, 'error');
        return { success: false, error: `input_sql 操作缺少 sql 参数。收到的 action: ${JSON.stringify(action)}` };
      }
      addLog(`📝 输入 SQL: ${sql.substring(0, 100)}...`, 'action');
      addLog(`   SQL 完整长度: ${sql.length} 字符`, 'info');
      
      // 先获取当前页面信息
      let inputPageInfo = '';
      try {
        if (currentTabId) {
          const tab = await chrome.tabs.get(currentTabId);
          inputPageInfo = `页面: ${tab.url || '未知'}, 标题: ${tab.title || '未知'}`;
          addLog(`📄 ${inputPageInfo}`, 'info');
        }
      } catch (e) {
        addLog(`⚠️ 无法获取页面信息: ${e.message}`, 'warn');
      }
      
      // 尝试多次查找编辑器（等待初始化，增加等待时间）
      let inputResult = null;
      const maxAttempts = 15; // 增加到15次重试
      const waitTimePerAttempt = 2000; // 每次等待2秒
      
      // 先等待页面完全加载（增加初始等待时间）
      addLog(`⏳ 等待页面完全加载（5秒）...`, 'info');
      await sleep(5000);
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
          addLog(`⏳ 等待编辑器初始化，重试 ${attempt + 1}/${maxAttempts}（等待 ${waitTimePerAttempt}ms）...`, 'info');
          await sleep(waitTimePerAttempt);
        }
        
        inputResult = await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
          func: (sqlValue, attemptNumber) => {
            console.log(`🔍 [尝试 ${attemptNumber}] 开始查找 SQL 编辑器...`);
            console.log(`🔍 SQL 值:`, sqlValue.substring(0, 50) + '...');
            
            const debugInfo = {
              attempt: attemptNumber,
              pageReady: document.readyState,
              hasCodeMirrorGlobal: typeof window.CodeMirror !== 'undefined',
              hasAceGlobal: typeof window.ace !== 'undefined',
              editors: []
            };
            
            // 方法0: 查找 Vue CodeMirror 组件（优先，因为页面使用了 vue-codemirror）
            // Vue CodeMirror 通常会在最外层的 .vue-codemirror 或 .CodeMirror 元素上
            const vueCmElements = document.querySelectorAll('.vue-codemirror, [class*="vue-codemirror"]');
            console.log(`找到 ${vueCmElements.length} 个 Vue CodeMirror 元素`);
            
            for (let i = 0; i < vueCmElements.length; i++) {
              const vueCmEl = vueCmElements[i];
              console.log(`检查 Vue CodeMirror 元素 ${i}:`, {
                className: vueCmEl.className,
                id: vueCmEl.id,
                visible: vueCmEl.offsetParent !== null
              });
              
              // 方法0.1: 尝试通过 Vue 实例访问 CodeMirror
              // Vue 2: __vue__ 或 __vueParentComponent
              // Vue 3: __vueParentComponent
              let vueInstance = vueCmEl.__vue__ || vueCmEl.__vueParentComponent;
              if (vueInstance) {
                console.log(`✅ 找到 Vue 实例，尝试访问 CodeMirror`);
                // 查找 CodeMirror 实例（可能在 $refs 或组件实例中）
                if (vueInstance.$refs && vueInstance.$refs.codemirror) {
                  const cmInstance = vueInstance.$refs.codemirror.codemirror || vueInstance.$refs.codemirror;
                  if (cmInstance && typeof cmInstance.setValue === 'function') {
                    console.log(`✅ 通过 Vue $refs 获取 CodeMirror 实例`);
                    try {
                      cmInstance.setValue(sqlValue);
                      const currentValue = cmInstance.getValue();
                      return { 
                        success: true, 
                        sqlLength: currentValue.length, 
                        editorType: 'Vue-CodeMirror (refs)',
                        sqlPreview: currentValue.substring(0, 50)
                      };
                    } catch (e) {
                      console.error(`Vue CodeMirror 设置失败:`, e);
                    }
                  }
                }
                // 尝试访问组件内部的 codemirror 属性
                if (vueInstance.codemirror && typeof vueInstance.codemirror.setValue === 'function') {
                  console.log(`✅ 通过 Vue 实例属性获取 CodeMirror 实例`);
                  try {
                    vueInstance.codemirror.setValue(sqlValue);
                    const currentValue = vueInstance.codemirror.getValue();
                    return { 
                      success: true, 
                      sqlLength: currentValue.length, 
                      editorType: 'Vue-CodeMirror (property)',
                      sqlPreview: currentValue.substring(0, 50)
                    };
                  } catch (e) {
                    console.error(`Vue CodeMirror 设置失败:`, e);
                  }
                }
              }
              
              // 方法0.2: 查找 Vue CodeMirror 组件下的 textarea
              // 注意：很多 vue-codemirror 实现会有一个“外层 textarea(name=codemirror)”作为占位/桥接，
              // 仅设置它的 value 可能不会同步到真正的 CodeMirror 实例。
              // 这里我们允许先写入 textarea 触发事件，但“成功”必须以 CodeMirror.getValue() 校验通过为准。
              const textarea = vueCmEl.querySelector('textarea');
              if (textarea) {
                console.log(`✅ 找到 Vue CodeMirror 内部的 textarea，直接设置值`);
                
                // 先 focus，然后设置值，触发多个事件确保 Vue 检测到变化
                textarea.focus();
                textarea.value = sqlValue;
                
                // 触发多种事件，确保 Vue CodeMirror 检测到变化
                const events = ['input', 'change', 'keyup', 'keydown', 'paste'];
                events.forEach(eventType => {
                  const event = new Event(eventType, { bubbles: true, cancelable: true });
                  textarea.dispatchEvent(event);
                });
                
                // 尝试通过 Vue 实例直接设置 CodeMirror 的值（确保同步）
                if (vueInstance) {
                  // 方法1: 通过 $refs 访问 CodeMirror
                  if (vueInstance.$refs && vueInstance.$refs.codemirror) {
                    const cmInstance = vueInstance.$refs.codemirror.codemirror || vueInstance.$refs.codemirror;
                    if (cmInstance && typeof cmInstance.setValue === 'function') {
                      try {
                        cmInstance.setValue(sqlValue);
                        console.log(`✅ 通过 Vue $refs 设置 CodeMirror 值`);
                      } catch (e) {
                        console.log(`通过 Vue $refs 设置 CodeMirror 失败:`, e);
                      }
                    }
                  }
                  
                  // 方法2: 通过 Vue 实例属性访问 CodeMirror
                  if (vueInstance.codemirror && typeof vueInstance.codemirror.setValue === 'function') {
                    try {
                      vueInstance.codemirror.setValue(sqlValue);
                      console.log(`✅ 通过 Vue 实例属性设置 CodeMirror 值`);
                    } catch (e) {
                      console.log(`通过 Vue 实例属性设置 CodeMirror 失败:`, e);
                    }
                  }
                  
                  // 方法3: 尝试触发 Vue 的响应式更新
                  if (vueInstance.$forceUpdate) {
                    try {
                      vueInstance.$forceUpdate();
                      console.log(`✅ 触发了 Vue 强制更新`);
                    } catch (e) {
                      console.log(`Vue 强制更新失败:`, e);
                    }
                  }
                  
                  // 方法4: 尝试通过 Vue 的 $emit 触发 change 事件
                  if (vueInstance.$emit) {
                    try {
                      vueInstance.$emit('input', sqlValue);
                      vueInstance.$emit('change', sqlValue);
                      console.log(`✅ 触发了 Vue input/change 事件`);
                    } catch (e) {
                      console.log(`触发 Vue 事件失败:`, e);
                    }
                  }
                }
                
                // 关键：验证是否真正同步到了 CodeMirror 实例（避免只写到桥接 textarea）
                let cmValue = '';
                try {
                  // 1) 优先从 Vue 实例拿 codemirror
                  if (vueInstance?.$refs?.codemirror) {
                    const refCm = vueInstance.$refs.codemirror.codemirror || vueInstance.$refs.codemirror;
                    if (refCm && typeof refCm.getValue === 'function') {
                      cmValue = refCm.getValue() || '';
                    }
                  }
                  // 2) 其次从 vueInstance.codemirror
                  if (!cmValue && vueInstance?.codemirror && typeof vueInstance.codemirror.getValue === 'function') {
                    cmValue = vueInstance.codemirror.getValue() || '';
                  }
                  // 3) 最后从 DOM 上的 .CodeMirror 实例获取
                  if (!cmValue) {
                    const cmHost = vueCmEl.querySelector('.CodeMirror');
                    const cmInst = cmHost && (cmHost.CodeMirror || cmHost.__CodeMirror);
                    if (cmInst && typeof cmInst.getValue === 'function') {
                      cmValue = cmInst.getValue() || '';
                    }
                  }
                } catch (e) {
                  console.log('⚠️ 校验 CodeMirror 值失败:', e);
                }

                const normalizedExpected = (sqlValue || '').trim();
                const normalizedActual = (cmValue || '').trim();

                if (normalizedActual && normalizedActual === normalizedExpected) {
                  return { 
                    success: true, 
                    sqlLength: cmValue.length, 
                    editorType: 'Vue-CodeMirror (synced)',
                    sqlPreview: cmValue.substring(0, 50)
                  };
                }

                console.log('⚠️ Vue-CodeMirror textarea 已写入，但 CodeMirror 未同步，继续尝试其他方式…', {
                  textareaLen: (textarea.value || '').length,
                  codeMirrorLen: (cmValue || '').length
                });
              }
            }
            
            // 方法1: 查找 CodeMirror 编辑器（标准方式）
            const cmElements = document.querySelectorAll('.CodeMirror, [class*="CodeMirror"], [class*="codemirror"]');
            console.log(`找到 ${cmElements.length} 个 CodeMirror 元素`);
            debugInfo.codeMirrorCount = cmElements.length;
            
            // 优先查找最外层的 CodeMirror 容器（通常是 vue-codemirror 的直接子元素）
            const outerCmElements = Array.from(cmElements).filter(el => {
              // 查找 class 包含 vue-codemirror 的父元素
              return el.closest('.vue-codemirror, [class*="vue-codemirror"]') !== null;
            });
            
            // 如果没有找到 Vue CodeMirror，使用所有 CodeMirror 元素
            const elementsToCheck = outerCmElements.length > 0 ? outerCmElements : cmElements;
            
            for (let i = 0; i < elementsToCheck.length; i++) {
              const cmEl = elementsToCheck[i];
              
              // 跳过 CodeMirror 内部的子元素（只检查最外层容器）
              if (cmEl.closest('.CodeMirror') !== cmEl && cmEl.closest('.CodeMirror') !== null) {
                console.log(`跳过 CodeMirror 内部元素 ${i}`);
                continue;
              }
              
              const elementInfo = {
                index: i,
                className: cmEl.className,
                id: cmEl.id,
                visible: cmEl.offsetParent !== null,
                hasCodeMirror: !!cmEl.CodeMirror,
                has__CodeMirror: !!cmEl.__CodeMirror,
                hasWindowCodeMirror: !!window.CodeMirror,
                tagName: cmEl.tagName,
                parentElement: cmEl.parentElement ? {
                  tagName: cmEl.parentElement.tagName,
                  className: cmEl.parentElement.className
                } : null
              };
              
              console.log(`检查 CodeMirror 元素 ${i}:`, elementInfo);
              debugInfo.editors.push({ type: 'CodeMirror', ...elementInfo });
              
              // 方法1.1: 查找 CodeMirror 内部的 textarea（最可靠的方式）
              const textarea = cmEl.querySelector('textarea');
              if (textarea && textarea.offsetParent !== null) {
                console.log(`✅ 找到 CodeMirror 内部的 textarea，直接设置值`);
                
                // 先 focus，然后设置值，触发多个事件确保变化被检测
                textarea.focus();
                textarea.value = sqlValue;
                
                // 触发多种事件，确保变化被检测
                const events = ['input', 'change', 'keyup', 'keydown', 'paste'];
                events.forEach(eventType => {
                  const event = new Event(eventType, { bubbles: true, cancelable: true });
                  textarea.dispatchEvent(event);
                });
                
                // 验证值是否设置成功
                if (textarea.value === sqlValue) {
                  return { 
                    success: true, 
                    sqlLength: sqlValue.length, 
                    editorType: 'CodeMirror (textarea)',
                    sqlPreview: sqlValue.substring(0, 50)
                  };
                }
              }
              
              // 方法1.2: 检查是否有 CodeMirror 实例（多种方式）
              let cmInstance = null;
            if (cmEl.CodeMirror) {
                cmInstance = cmEl.CodeMirror;
                console.log(`✅ 通过 cmEl.CodeMirror 获取实例`);
              } else if (cmEl.__CodeMirror) {
                cmInstance = cmEl.__CodeMirror;
                console.log(`✅ 通过 cmEl.__CodeMirror 获取实例`);
              } else if (window.CodeMirror) {
                try {
                  cmInstance = window.CodeMirror.get(cmEl);
                  if (cmInstance) {
                    console.log(`✅ 通过 window.CodeMirror.get 获取实例`);
                  }
                } catch (e) {
                  console.log(`无法通过 CodeMirror.get 获取实例:`, e);
                }
              }
              
              if (cmInstance && typeof cmInstance.setValue === 'function') {
                console.log(`✅ 找到 CodeMirror 实例 ${i}，设置 SQL 值`);
                try {
                  cmInstance.setValue(sqlValue);
                  const currentValue = cmInstance.getValue();
                  console.log(`SQL 已设置，当前值长度: ${currentValue.length}`);
                  console.log(`SQL 前50字符: ${currentValue.substring(0, 50)}`);
                  
                  // 触发 change 事件
                  if (cmInstance.getDoc && typeof cmInstance.getDoc === 'function') {
                    try {
                      cmInstance.getDoc().markClean();
                    } catch (e) {
                      console.log('markClean 失败:', e);
                    }
                  }
                  
                  // 触发事件
                  const changeEvent = new Event('change', { bubbles: true });
                  cmEl.dispatchEvent(changeEvent);
                  
                  const inputEvent = new Event('input', { bubbles: true });
                  cmEl.dispatchEvent(inputEvent);
                  
                  // 也尝试触发 CodeMirror 的内部事件
                  if (cmInstance.triggerOnKeyDown) {
                    try {
                      cmInstance.triggerOnKeyDown({keyCode: 13, preventDefault: () => {}, stopPropagation: () => {}});
                    } catch (e) {
                      console.log('triggerOnKeyDown 失败:', e);
                    }
                  }
                  
                  return { 
                    success: true, 
                    sqlLength: currentValue.length, 
                    editorType: 'CodeMirror', 
                    sqlPreview: currentValue.substring(0, 50),
                    debugInfo: debugInfo,
                    editorInfo: elementInfo
                  };
                } catch (e) {
                  console.error(`CodeMirror 设置失败:`, e);
                  console.error(`错误堆栈:`, e.stack);
                }
              } else {
                console.log(`CodeMirror 元素 ${i} 没有有效的实例或 setValue 方法`);
                if (cmInstance) {
                  console.log(`实例存在但没有 setValue 方法，实例类型:`, typeof cmInstance);
                }
              }
            }
            
            // 方法2: 查找 Ace Editor
            if (window.ace) {
              const aceElements = document.querySelectorAll('.ace_editor, [class*="ace_editor"]');
              console.log(`找到 ${aceElements.length} 个 Ace Editor 元素`);
              for (let i = 0; i < aceElements.length; i++) {
                try {
                  const aceEditor = ace.edit(aceElements[i]);
                  if (aceEditor) {
                    aceEditor.setValue(sqlValue);
                    aceEditor.clearSelection();
                    console.log(`✅ 找到 Ace Editor ${i}，设置 SQL 值`);
                    return { success: true, sqlLength: sqlValue.length, editorType: 'Ace' };
                  }
                } catch (e) {
                  console.error(`Ace Editor 设置失败:`, e);
                }
              }
            }
            
            // 方法3: 查找 textarea（仅作为最后的后备方案，因为 CodeMirror 通常有自己的 textarea）
            // 注意：如果页面使用 CodeMirror，应该优先使用 CodeMirror，不要使用 textarea
            // 因为 CodeMirror 的 textarea 只是隐藏的输入框，直接设置值不会同步到 CodeMirror
            const textareas = document.querySelectorAll('textarea');
            console.log(`找到 ${textareas.length} 个 textarea 元素`);
            
            // 检查是否有 CodeMirror 相关的 textarea（这些不应该直接使用）
            const cmTextareas = document.querySelectorAll('.CodeMirror textarea, [class*="CodeMirror"] textarea');
            console.log(`找到 ${cmTextareas.length} 个 CodeMirror 相关的 textarea（不应直接使用）`);
            
            // 只使用非 CodeMirror 的 textarea
            for (let i = 0; i < textareas.length; i++) {
              const textarea = textareas[i];
              
              // 跳过 CodeMirror 的 textarea
              let isCmTextarea = false;
              for (const cmTextarea of cmTextareas) {
                if (textarea === cmTextarea) {
                  isCmTextarea = true;
                  break;
                }
              }
              if (isCmTextarea) {
                console.log(`跳过 CodeMirror 的 textarea ${i}`);
                continue;
              }
              
              // 检查是否是可见的 SQL 编辑器
              if (textarea.offsetParent !== null) {
                const isLikelyEditor = textarea.className.includes('sql') || 
                                       textarea.className.includes('query') ||
                                       textarea.className.includes('editor') ||
                                       textarea.id.includes('sql') ||
                                       textarea.id.includes('query') ||
                                       textarea.id.includes('editor') ||
                                       textarea.placeholder.toLowerCase().includes('sql') ||
                                       textarea.placeholder.toLowerCase().includes('query');
                
                if (isLikelyEditor) {
                  console.log(`✅ 找到独立的 textarea ${i}（非 CodeMirror），设置 SQL 值`);
                  textarea.value = sqlValue;
                  textarea.dispatchEvent(new Event('input', { bubbles: true }));
                  textarea.dispatchEvent(new Event('change', { bubbles: true }));
                  textarea.focus();
                  textarea.blur();
                  return { success: true, sqlLength: sqlValue.length, editorType: 'textarea' };
                }
              }
            }
            
            // 方法4: 查找 contenteditable 元素
            const editableElements = document.querySelectorAll('[contenteditable="true"]');
            console.log(`找到 ${editableElements.length} 个 contenteditable 元素`);
            for (let i = 0; i < editableElements.length; i++) {
              const el = editableElements[i];
              if (el.offsetParent !== null && 
                  (el.className.includes('sql') || 
                   el.className.includes('query') ||
                   el.className.includes('editor'))) {
                console.log(`✅ 找到 contenteditable ${i}，设置 SQL 值`);
                el.textContent = sqlValue;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                return { success: true, sqlLength: sqlValue.length, editorType: 'contenteditable' };
              }
            }
            
            console.error('❌ 未找到任何可用的 SQL 编辑器');
            console.error('调试信息:', debugInfo);
            return { 
              success: false, 
              error: '未找到编辑器（已尝试 CodeMirror、Ace、textarea、contenteditable）',
              debugInfo: debugInfo
            };
          },
          args: [sql, attempt + 1]
        });
        
        const result = inputResult[0]?.result || { success: false };
        if (result.success) {
          addLog(`✅ SQL 已成功输入到 ${result.editorType || '编辑器'}（长度: ${result.sqlLength || 'unknown'}）`, 'success');
          addLog(`   编辑器类型: ${result.editorType || '未知'}`, 'info');
          if (result.sqlPreview) {
            addLog(`   SQL 预览: ${result.sqlPreview}...`, 'info');
          }
          
          // 验证 SQL 是否真的被输入了（等待一小段时间后检查）
          await sleep(500);
          addLog(`🔍 验证 SQL 是否真正输入到编辑器...`, 'info');
          const verifyResult = await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: (expectedSqlPreview) => {
              // 方法1: 检查 CodeMirror 内部的 textarea（Vue CodeMirror 通常使用这种方式）
              const cmTextareas = document.querySelectorAll('.CodeMirror textarea, .vue-codemirror textarea');
              console.log(`验证：找到 ${cmTextareas.length} 个 CodeMirror textarea 元素`);
              for (const textarea of cmTextareas) {
                if (textarea.value && textarea.value.length > 0) {
                  const preview = textarea.value.substring(0, 50);
                  if (!expectedSqlPreview || preview === expectedSqlPreview) {
                    console.log(`验证：CodeMirror textarea 中找到 SQL，长度: ${textarea.value.length}`);
                    return { 
                      verified: true, 
                      editorType: 'CodeMirror (textarea)', 
                      sqlLength: textarea.value.length, 
                      sqlPreview: preview,
                      editorInfo: {
                        className: textarea.className,
                        id: textarea.id
                      }
                    };
                  }
                }
              }
              
              // 方法2: 检查 CodeMirror 实例
              const cmElements = document.querySelectorAll('.CodeMirror');
              console.log(`验证：找到 ${cmElements.length} 个 CodeMirror 元素`);
              for (const cmEl of cmElements) {
                const cmInstance = cmEl.CodeMirror || cmEl.__CodeMirror || window.CodeMirror?.get(cmEl);
                if (cmInstance && typeof cmInstance.getValue === 'function') {
                  const value = cmInstance.getValue();
                  if (value && value.length > 0) {
                    const preview = value.substring(0, 50);
                    if (!expectedSqlPreview || preview === expectedSqlPreview) {
                      console.log(`验证：CodeMirror 实例中找到 SQL，长度: ${value.length}`);
                      return { 
                        verified: true, 
                        editorType: 'CodeMirror', 
                        sqlLength: value.length, 
                        sqlPreview: preview,
                        editorInfo: {
                          className: cmEl.className,
                          id: cmEl.id
                        }
                      };
                    }
                  }
                }
              }
              
              // 方法3: 检查独立的 textarea（非 CodeMirror）
              const textareas = document.querySelectorAll('textarea');
              console.log(`验证：找到 ${textareas.length} 个 textarea 元素`);
              for (const textarea of textareas) {
                // 跳过 CodeMirror 的 textarea
                if (textarea.closest('.CodeMirror') || textarea.closest('[class*="CodeMirror"]') || textarea.closest('.vue-codemirror')) {
                  continue;
                }
                if (textarea.value && textarea.value.length > 0) {
                  const preview = textarea.value.substring(0, 50);
                  if (!expectedSqlPreview || preview === expectedSqlPreview) {
                    console.log(`验证：独立 textarea 中找到 SQL，长度: ${textarea.value.length}`);
                    return { 
                      verified: true, 
                      editorType: 'textarea', 
                      sqlLength: textarea.value.length, 
                      sqlPreview: preview,
                      editorInfo: {
                        className: textarea.className,
                        id: textarea.id
                      }
                    };
                  }
                }
              }
              
              console.log(`验证：未找到已输入的 SQL`);
              return { verified: false, error: '未找到已输入的 SQL' };
            },
            args: [sql.substring(0, 50)] // 传递 SQL 预览进行验证
          });
          
          const verify = verifyResult[0]?.result || {};
          if (verify.verified) {
            addLog(`✅ 验证成功：SQL 已确认输入到 ${verify.editorType}（长度: ${verify.sqlLength}）`, 'success');
            if (verify.editorInfo) {
              addLog(`   编辑器信息: ${verify.editorInfo.className || '无class'} (${verify.editorInfo.id || '无id'})`, 'info');
            }
            if (verify.sqlPreview) {
              addLog(`   验证的 SQL 预览: ${verify.sqlPreview}...`, 'info');
            }
            
            // 如果 SQL 输入成功，等待一下让 Vue CodeMirror 同步（特别是通过 textarea 输入的情况）
            if (result.editorType && result.editorType.includes('textarea')) {
              addLog(`⏳ 等待 Vue CodeMirror 同步 SQL（1.5秒）...`, 'info');
              await sleep(1500);
            }
          } else {
            addLog(`⚠️ 警告：SQL 输入后验证失败，可能未真正输入到编辑器`, 'warn');
            addLog(`   错误: ${verify.error || '未知错误'}`, 'warn');
          }
          
          return result;
        }
      }
      
      // 所有尝试都失败
      const finalResult = inputResult[0]?.result || { success: false };
      addLog(`❌ SQL 输入失败: ${finalResult.error || '未知错误'}`, 'error');
      
      // 输出详细的调试信息
      if (finalResult.debugInfo) {
        addLog(`   调试信息:`, 'error');
        addLog(`     - 页面状态: ${finalResult.debugInfo.pageReady || '未知'}`, 'error');
        addLog(`     - 找到 CodeMirror 元素: ${finalResult.debugInfo.codeMirrorCount || 0} 个`, 'error');
        addLog(`     - window.CodeMirror 存在: ${finalResult.debugInfo.hasCodeMirrorGlobal || false}`, 'error');
        addLog(`     - window.ace 存在: ${finalResult.debugInfo.hasAceGlobal || false}`, 'error');
        if (finalResult.debugInfo.editors && finalResult.debugInfo.editors.length > 0) {
          addLog(`     - 编辑器详情:`, 'error');
          finalResult.debugInfo.editors.forEach((editor, idx) => {
            addLog(`       编辑器 ${idx + 1}: ${editor.type} - ${editor.className || '无class'} (${editor.id || '无id'}) - 可见: ${editor.visible}, 有实例: ${editor.hasCodeMirror || editor.has__CodeMirror}`, 'error');
          });
        }
      }
      
      addLog(`💡 提示：请确保页面已完全加载，并且已导航到临时查询页面`, 'info');
      addLog(`💡 如果页面已加载，可能需要等待更长时间让编辑器初始化`, 'info');
      addLog(`🛑 SQL 输入失败，停止后续操作`, 'error');
      // SQL 输入失败，直接返回错误，不继续执行后续操作
      return { success: false, error: finalResult.error || 'SQL 输入失败', stopExecution: true };
      
    case 'click_format':
      addLog(`🔘 开始查找并点击格式化按钮...`, 'action');
      
      // 先获取当前页面信息
      let formatPageInfo = '';
      try {
        if (currentTabId) {
          const tab = await chrome.tabs.get(currentTabId);
          formatPageInfo = `页面: ${tab.url || '未知'}, 标题: ${tab.title || '未知'}`;
          addLog(`📄 ${formatPageInfo}`, 'info');
        }
      } catch (e) {
        addLog(`⚠️ 无法获取页面信息: ${e.message}`, 'warn');
      }
      
      const formatResult = await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        func: () => {
          console.log('🔍 开始查找格式化按钮...');
          const buttons = document.querySelectorAll('button, div, span, a');
          console.log(`找到 ${buttons.length} 个可能的按钮元素`);
          
          const buttonCandidates = [];
          let foundButton = null;
          
          for (let i = 0; i < buttons.length; i++) {
            const btn = buttons[i];
            const text = btn.textContent.trim();
            const isVisible = btn.offsetParent !== null;
            
            // 记录所有可能的格式化按钮
            if (text === '格式化' || text === 'Format' || text.includes('格式化') || text.includes('format')) {
              buttonCandidates.push({
                index: i,
                text: text,
                tagName: btn.tagName,
                className: btn.className,
                id: btn.id,
                visible: isVisible,
                disabled: btn.disabled
              });
            }
            
            // 查找格式化按钮（可能是"格式化"、"Format"等）
            if ((text === '格式化' || text === 'Format' || text.includes('格式化') || text.includes('format')) && isVisible && !btn.disabled) {
              foundButton = btn;
              break;
            }
          }
          
          console.log(`找到 ${buttonCandidates.length} 个可能的格式化按钮候选:`, buttonCandidates);
          
          if (foundButton) {
            const buttonInfo = {
              tagName: foundButton.tagName,
              className: foundButton.className,
              id: foundButton.id,
              text: foundButton.textContent.trim(),
              visible: foundButton.offsetParent !== null,
              disabled: foundButton.disabled
            };
            console.log(`✅ 找到格式化按钮:`, buttonInfo);
            
            // 记录点击前的状态
            const beforeClick = {
              hasFocus: document.activeElement === foundButton,
              pageTitle: document.title,
              pageUrl: window.location.href
            };
            
            foundButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            foundButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            foundButton.click();
            
            // 记录点击后的状态
            const afterClick = {
              hasFocus: document.activeElement === foundButton,
              pageTitle: document.title,
              pageUrl: window.location.href
            };
            
            console.log(`✅ 已点击格式化按钮`);
            console.log(`点击前状态:`, beforeClick);
            console.log(`点击后状态:`, afterClick);
            
            return { 
              success: true, 
              message: '已点击格式化按钮',
              buttonInfo: buttonInfo,
              beforeClick: beforeClick,
              afterClick: afterClick,
              candidatesCount: buttonCandidates.length
            };
          }
          
          console.error('❌ 未找到格式化按钮');
          return { 
            success: false, 
            error: '未找到格式化按钮',
            candidatesCount: buttonCandidates.length,
            candidates: buttonCandidates
          };
        }
      });
      
      const formatResultData = formatResult[0]?.result || { success: false };
      if (formatResultData.success) {
        addLog(`✅ 格式化按钮点击成功`, 'success');
        addLog(`   按钮信息: ${formatResultData.buttonInfo?.tagName || '未知'} - ${formatResultData.buttonInfo?.text || '未知'} (${formatResultData.buttonInfo?.className || '无class'})`, 'info');
        addLog(`   找到 ${formatResultData.candidatesCount || 0} 个候选按钮`, 'info');
      } else {
        addLog(`⚠️ 格式化按钮点击失败: ${formatResultData.error || '未知错误'}`, 'warn');
        if (formatResultData.candidates && formatResultData.candidates.length > 0) {
          addLog(`   找到 ${formatResultData.candidates.length} 个候选按钮，但都不可用:`, 'warn');
          formatResultData.candidates.forEach((candidate, idx) => {
            addLog(`     候选 ${idx + 1}: ${candidate.text} (${candidate.tagName}) - 可见: ${candidate.visible}, 禁用: ${candidate.disabled}`, 'warn');
          });
        }
        // 格式化失败不影响后续流程，继续执行
      }
      return formatResultData;
      
    case 'click_execute':
      addLog(`🔘 开始查找并点击执行按钮...`, 'action');
      
      // 先获取当前页面信息
      let executePageInfo = '';
      try {
        if (currentTabId) {
          const tab = await chrome.tabs.get(currentTabId);
          executePageInfo = `页面: ${tab.url || '未知'}, 标题: ${tab.title || '未知'}`;
          addLog(`📄 ${executePageInfo}`, 'info');
        }
      } catch (e) {
        addLog(`⚠️ 无法获取页面信息: ${e.message}`, 'warn');
      }
      
      // 在执行前先检查 SQL 是否真的在编辑器中
      addLog(`🔍 检查 SQL 是否在编辑器中...`, 'info');
      const sqlCheckResult = await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        func: () => {
          // 方法2: 检查 CodeMirror 实例
          const cmElements = document.querySelectorAll('.CodeMirror');
          for (const cmEl of cmElements) {
            const cmInstance = cmEl.CodeMirror || cmEl.__CodeMirror || window.CodeMirror?.get(cmEl);
            if (cmInstance && typeof cmInstance.getValue === 'function') {
              const value = cmInstance.getValue();
              if (value && value.trim().length > 0) {
                return { hasSql: true, sqlLength: value.length, sqlPreview: value.substring(0, 50), method: 'CodeMirror' };
              }
            }
          }

          // 方法1: 检查 CodeMirror 内部的 textarea
          // 注意：不要把 textarea[name="codemirror"] 这种桥接 textarea 当成“已写入 SQL”，它可能不会同步到 CodeMirror。
          const ignoreTextareas = new Set(Array.from(document.querySelectorAll('textarea[name="codemirror"]')));
          const cmTextareas = document.querySelectorAll('.CodeMirror textarea');
          for (const textarea of cmTextareas) {
            if (ignoreTextareas.has(textarea)) continue;
            if (textarea.value && textarea.value.trim().length > 0) {
              return { hasSql: true, sqlLength: textarea.value.length, sqlPreview: textarea.value.substring(0, 50), method: 'CodeMirror textarea' };
            }
          }
          
          // 方法3: 检查独立的 textarea
          const textareas = document.querySelectorAll('textarea');
          for (const textarea of textareas) {
            if (textarea.closest('.CodeMirror') || textarea.closest('.vue-codemirror')) {
              continue;
            }
            if (textarea.value && textarea.value.trim().length > 0) {
              return { hasSql: true, sqlLength: textarea.value.length, sqlPreview: textarea.value.substring(0, 50), method: 'independent textarea' };
            }
          }
          
          return { hasSql: false, error: '未找到 SQL，编辑器为空' };
        }
      });
      
      const sqlCheck = sqlCheckResult[0]?.result || { hasSql: false };
      if (!sqlCheck.hasSql) {
        const errorMsg = `❌ 执行前检查失败：${sqlCheck.error || '编辑器中没有 SQL'}，停止执行`;
        addLog(errorMsg, 'error');
        return { success: false, error: errorMsg, stopExecution: true };
      }
      
      addLog(`✅ SQL 检查通过：找到 SQL（长度: ${sqlCheck.sqlLength}，方法: ${sqlCheck.method}，预览: ${sqlCheck.sqlPreview}...）`, 'success');
      
      const clickResult = await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        func: () => {
          console.log('🔍 开始查找执行按钮...');
          const buttons = document.querySelectorAll('button, div, span, a');
          console.log(`找到 ${buttons.length} 个可能的按钮元素`);
          
          const buttonCandidates = [];
          let foundButton = null;
          
          for (let i = 0; i < buttons.length; i++) {
            const btn = buttons[i];
            const text = btn.textContent.trim();
            const isVisible = btn.offsetParent !== null;
            
            // 记录所有可能的执行按钮
            if (text === '执行' || text === 'Execute' || text.includes('执行') || text.includes('execute')) {
              buttonCandidates.push({
                index: i,
                text: text,
                tagName: btn.tagName,
                className: btn.className,
                id: btn.id,
                visible: isVisible,
                disabled: btn.disabled
              });
            }
            
            if (text === '执行' && isVisible) {
              // 检查按钮是否被禁用（多种方式）
              const isDisabled = btn.disabled || 
                                btn.classList.contains('disabled') ||
                                btn.classList.contains('ant-btn-disabled') ||
                                btn.getAttribute('disabled') !== null ||
                                btn.style.pointerEvents === 'none' ||
                                btn.style.opacity === '0.5';
              
              console.log(`✅ 找到执行按钮 ${i}:`, {
                tagName: btn.tagName,
                className: btn.className,
                id: btn.id,
                text: text,
                visible: isVisible,
                disabled: btn.disabled,
                hasDisabledClass: btn.classList.contains('disabled'),
                isDisabled: isDisabled
              });
              
              // 优先选择未禁用的按钮
              if (!foundButton || (!isDisabled && foundButton.disabled)) {
                foundButton = btn;
              }
              
              // 如果找到未禁用的按钮，立即使用
              if (!isDisabled) {
                break;
              }
            }
          }
          
          console.log(`找到 ${buttonCandidates.length} 个可能的执行按钮候选:`, buttonCandidates);
          
          if (foundButton) {
            // 检查按钮是否被禁用（多种方式）
            const isDisabled = foundButton.disabled || 
                              foundButton.classList.contains('disabled') ||
                              foundButton.classList.contains('ant-btn-disabled') ||
                              foundButton.getAttribute('disabled') !== null ||
                              foundButton.style.pointerEvents === 'none' ||
                              foundButton.style.opacity === '0.5';
            
            if (isDisabled) {
              console.error('❌ 执行按钮被禁用');
              console.error('禁用原因:', {
                disabled: foundButton.disabled,
                hasDisabledClass: foundButton.classList.contains('disabled'),
                hasAntDisabledClass: foundButton.classList.contains('ant-btn-disabled'),
                disabledAttr: foundButton.getAttribute('disabled'),
                pointerEvents: foundButton.style.pointerEvents,
                opacity: foundButton.style.opacity
              });
              
              // 如果按钮被禁用，尝试强制启用（移除禁用状态）
              console.log('⚠️ 尝试强制启用按钮...');
              foundButton.disabled = false;
              foundButton.removeAttribute('disabled');
              foundButton.classList.remove('disabled', 'ant-btn-disabled');
              foundButton.style.pointerEvents = 'auto';
              foundButton.style.opacity = '1';
              
              // 再次检查是否仍然被禁用
              const stillDisabled = foundButton.disabled || 
                                   foundButton.classList.contains('disabled') ||
                                   foundButton.classList.contains('ant-btn-disabled');
              
              if (stillDisabled) {
                return { 
                  success: false, 
                  error: '执行按钮被禁用且无法强制启用',
                  buttonInfo: {
                    tagName: foundButton.tagName,
                    className: foundButton.className,
                    id: foundButton.id,
                    text: foundButton.textContent.trim(),
                    disabled: true
                  }
                };
              } else {
                console.log('✅ 按钮已强制启用');
              }
            }
            
            const buttonInfo = {
              tagName: foundButton.tagName,
              className: foundButton.className,
              id: foundButton.id,
              text: foundButton.textContent.trim(),
              visible: foundButton.offsetParent !== null,
              disabled: foundButton.disabled
            };
            
            // 记录点击前的状态
            const beforeClick = {
              hasFocus: document.activeElement === foundButton,
              pageTitle: document.title,
              pageUrl: window.location.href,
              sqlInEditor: ''
            };
            
            // 检查 SQL 编辑器中的内容（支持多种方式）
            try {
              // 方法1: 检查 CodeMirror 实例
              const cmElements = document.querySelectorAll('.CodeMirror');
              for (const cmEl of cmElements) {
                const cmInstance = cmEl.CodeMirror || cmEl.__CodeMirror || window.CodeMirror?.get(cmEl);
                if (cmInstance && typeof cmInstance.getValue === 'function') {
                  const value = cmInstance.getValue();
                  if (value && value.length > 0) {
                    beforeClick.sqlInEditor = value;
                    console.log(`✅ 通过 CodeMirror 实例获取 SQL，长度: ${value.length}`);
                    break;
                  }
                }
              }
              
              // 方法2: 如果 CodeMirror 实例获取失败，检查 textarea（Vue CodeMirror）
              if (!beforeClick.sqlInEditor || beforeClick.sqlInEditor.length === 0) {
                const textareas = document.querySelectorAll('.CodeMirror textarea, .vue-codemirror textarea');
                for (const textarea of textareas) {
                  if (textarea.value && textarea.value.length > 0) {
                    beforeClick.sqlInEditor = textarea.value;
                    console.log(`✅ 通过 textarea 获取 SQL，长度: ${textarea.value.length}`);
                    break;
                  }
                }
              }
            } catch (e) {
              console.log('无法获取 SQL 编辑器内容:', e);
            }
            
            // 点击按钮前，再次确认 SQL 是否在编辑器中
            let sqlBeforeClick = '';
            try {
              // 检查 textarea
              const textareas = document.querySelectorAll('.CodeMirror textarea, .vue-codemirror textarea');
              for (const textarea of textareas) {
                if (textarea.value && textarea.value.trim().length > 0) {
                  sqlBeforeClick = textarea.value;
                  break;
                }
              }
              // 如果 textarea 没有，检查 CodeMirror 实例
              if (!sqlBeforeClick) {
                const cmElements = document.querySelectorAll('.CodeMirror');
                for (const cmEl of cmElements) {
                  const cmInstance = cmEl.CodeMirror || cmEl.__CodeMirror || window.CodeMirror?.get(cmEl);
                  if (cmInstance && typeof cmInstance.getValue === 'function') {
                    const value = cmInstance.getValue();
                    if (value && value.trim().length > 0) {
                      sqlBeforeClick = value;
                      break;
                    }
                  }
                }
              }
            } catch (e) {
              console.log('检查 SQL 失败:', e);
            }
            
            if (!sqlBeforeClick || sqlBeforeClick.trim().length === 0) {
              console.error('❌ 执行前检查：编辑器中没有 SQL');
              return {
                success: false,
                error: '执行前检查失败：编辑器中没有 SQL',
                buttonInfo: buttonInfo
              };
            }
            
            console.log(`✅ 执行前检查通过：SQL 长度 ${sqlBeforeClick.length}`);
            
            // 点击按钮
            console.log('🖱️ 点击执行按钮...');
            
            // 先 focus，然后点击
            foundButton.focus();
            foundButton.click();
            
            // 触发所有可能的事件，确保点击被识别
            ['mousedown', 'mouseup', 'click', 'touchstart', 'touchend'].forEach(eventType => {
              const event = new MouseEvent(eventType, {
                bubbles: true,
                cancelable: true,
                view: window
              });
              foundButton.dispatchEvent(event);
            });
            
            // 也尝试触发 Vue 的事件（如果按钮是 Vue 组件）
            if (foundButton.__vue__ || foundButton.__vueParentComponent) {
              console.log('检测到 Vue 组件，尝试触发 Vue 事件');
              // 触发 Vue 的 click 事件
              const vueInstance = foundButton.__vue__ || foundButton.__vueParentComponent;
              if (vueInstance && vueInstance.$emit) {
                try {
                  vueInstance.$emit('click');
                } catch (e) {
                  console.log('Vue emit 失败:', e);
                }
              }
            }
            
            // 记录点击后的状态
            const afterClick = {
              hasFocus: document.activeElement === foundButton,
              pageTitle: document.title,
              pageUrl: window.location.href
            };
            
            console.log('✅ 执行按钮已点击');
            console.log(`点击前状态:`, beforeClick);
            console.log(`点击后状态:`, afterClick);
            
            return { 
              success: true, 
              message: '已点击执行按钮，查询正在运行',
              buttonInfo: buttonInfo,
              beforeClick: beforeClick,
              afterClick: afterClick,
              candidatesCount: buttonCandidates.length
            };
          }
          
          console.error('❌ 未找到执行按钮');
          return { 
            success: false, 
            error: '未找到执行按钮',
            candidatesCount: buttonCandidates.length,
            candidates: buttonCandidates
          };
        }
      });
      
      const clickResultData = clickResult[0]?.result || { success: false };
      if (clickResultData.success) {
        addLog(`✅ 执行按钮已点击，查询应该已开始运行`, 'success');
        addLog(`   按钮信息: ${clickResultData.buttonInfo?.tagName || '未知'} - ${clickResultData.buttonInfo?.text || '未知'} (${clickResultData.buttonInfo?.className || '无class'})`, 'info');
        addLog(`   找到 ${clickResultData.candidatesCount || 0} 个候选按钮`, 'info');
        
        if (clickResultData.beforeClick) {
          addLog(`   点击前状态:`, 'info');
          addLog(`     - 页面: ${clickResultData.beforeClick.pageUrl || '未知'}`, 'info');
          addLog(`     - 标题: ${clickResultData.beforeClick.pageTitle || '未知'}`, 'info');
          addLog(`     - SQL 长度: ${clickResultData.beforeClick.sqlInEditor?.length || 0}`, 'info');
          if (clickResultData.beforeClick.sqlInEditor) {
            addLog(`     - SQL 预览: ${clickResultData.beforeClick.sqlInEditor.substring(0, 100)}...`, 'info');
          }
        }
        
        if (clickResultData.afterClick) {
          addLog(`   点击后状态:`, 'info');
          addLog(`     - 页面: ${clickResultData.afterClick.pageUrl || '未知'}`, 'info');
          addLog(`     - 标题: ${clickResultData.afterClick.pageTitle || '未知'}`, 'info');
        }
        
        // 等待1秒后验证查询是否真的开始运行
        await sleep(1000);
        const verifyResult = await chrome.scripting.executeScript({
          target: { tabId: currentTabId },
          func: () => {
            // 检查是否有加载状态
            const loading = document.querySelector('.ant-spin, .loading, [class*="loading"], .ant-spin-spinning');
            const pageText = document.body.textContent || '';
            
            return {
              hasLoading: loading !== null && loading.offsetParent !== null,
              hasQueryText: pageText.includes('查询中') || pageText.includes('执行中') || pageText.includes('查询结果仍未完成'),
              pageText: pageText.substring(0, 500),
              loadingInfo: loading ? {
                className: loading.className,
                visible: loading.offsetParent !== null
              } : null
            };
          }
        });
        
        const verify = verifyResult[0]?.result || {};
        if (verify.hasLoading || verify.hasQueryText) {
          addLog(`✅ 验证成功：查询已开始运行（检测到加载状态或查询文本）`, 'success');
          if (verify.loadingInfo) {
            addLog(`   加载状态: ${verify.loadingInfo.className || '未知'}`, 'info');
          }
        } else {
          addLog(`⚠️ 警告：点击执行按钮后未检测到查询运行迹象，可能查询未启动`, 'warn');
          addLog(`   页面文本预览: ${verify.pageText?.substring(0, 200) || '无'}`, 'warn');
          
          // 如果查询未启动，检查 SQL 是否还在编辑器中
          const sqlRecheckResult = await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: () => {
              // 检查 textarea
              const textareas = document.querySelectorAll('.CodeMirror textarea, .vue-codemirror textarea');
              for (const textarea of textareas) {
                if (textarea.value && textarea.value.trim().length > 0) {
                  return { hasSql: true, sqlLength: textarea.value.length, method: 'textarea' };
                }
              }
              // 检查 CodeMirror 实例
              const cmElements = document.querySelectorAll('.CodeMirror');
              for (const cmEl of cmElements) {
                const cmInstance = cmEl.CodeMirror || cmEl.__CodeMirror || window.CodeMirror?.get(cmEl);
                if (cmInstance && typeof cmInstance.getValue === 'function') {
                  const value = cmInstance.getValue();
                  if (value && value.trim().length > 0) {
                    return { hasSql: true, sqlLength: value.length, method: 'CodeMirror' };
                  }
                }
              }
              return { hasSql: false, error: 'SQL 已丢失' };
            }
          });
          
          const sqlRecheck = sqlRecheckResult[0]?.result || { hasSql: false };
          if (!sqlRecheck.hasSql) {
            const errorMsg = `❌ 查询未启动：SQL 已丢失（${sqlRecheck.error || '未知原因'}），停止执行`;
            addLog(errorMsg, 'error');
            return { success: false, error: errorMsg, stopExecution: true };
          } else {
            addLog(`   重新检查：SQL 仍在编辑器中（长度: ${sqlRecheck.sqlLength}，方法: ${sqlRecheck.method}），但查询未启动`, 'warn');
            addLog(`   可能原因：Vue CodeMirror 未正确同步，或执行按钮点击无效`, 'warn');
          }
        }
      } else {
        addLog(`❌ 点击执行按钮失败: ${clickResultData.error || '未知错误'}`, 'error');
        if (clickResultData.buttonInfo) {
          addLog(`   按钮信息: ${clickResultData.buttonInfo.tagName} - ${clickResultData.buttonInfo.text} (禁用: ${clickResultData.buttonInfo.disabled})`, 'error');
        }
        if (clickResultData.candidates && clickResultData.candidates.length > 0) {
          addLog(`   找到 ${clickResultData.candidates.length} 个候选按钮，但都不可用:`, 'error');
          clickResultData.candidates.forEach((candidate, idx) => {
            addLog(`     候选 ${idx + 1}: ${candidate.text} (${candidate.tagName}) - 可见: ${candidate.visible}, 禁用: ${candidate.disabled}`, 'error');
          });
        }
      }
      return clickResultData;
      
    case 'get_result': {
      const waitTime = 5000; // 5秒
      const checkResultOnce = async () => {
        const resultData = await chrome.scripting.executeScript({
          target: { tabId: currentTabId },
          func: () => {
            const normalizeSql = (value) => String(value || '').replace(/\u00a0/g, ' ').trim();
            const looksLikeSql = (value) => /\b(select|insert|update|delete|with|create|drop|set|from)\b/i.test(value);
            const isLargeEditor = (el) => {
              if (!el) return false;
              const rect = el.getBoundingClientRect();
              return rect.width > 240 && rect.height > 120;
            };
            const readSqlFromEditors = () => {
              // CodeMirror
              const cmElements = document.querySelectorAll('.CodeMirror, .vue-codemirror');
              for (const cmEl of cmElements) {
                const cmInstance = cmEl.CodeMirror || cmEl.__CodeMirror || window.CodeMirror?.get?.(cmEl);
                if (cmInstance && typeof cmInstance.getValue === 'function') {
                  const value = normalizeSql(cmInstance.getValue());
                  if (value.length > 0) {
                    return { success: true, resultType: 'sql', sql: value, editorType: 'CodeMirror' };
                  }
                }
              }

              // Ace
              if (window.ace) {
                const aceElements = document.querySelectorAll('.ace_editor, [class*="ace_editor"]');
                for (const aceEl of aceElements) {
                  try {
                    const aceEditor = window.ace.edit(aceEl);
                    if (aceEditor && typeof aceEditor.getValue === 'function') {
                      const value = normalizeSql(aceEditor.getValue());
                      if (value.length > 0) {
                        return { success: true, resultType: 'sql', sql: value, editorType: 'Ace' };
                      }
                    }
                  } catch (e) {
                    // ignore
                  }
                }
              }

              // textarea / contenteditable fallback
              const textareas = document.querySelectorAll('textarea');
              for (const ta of textareas) {
                if (!isLargeEditor(ta)) continue;
                const value = normalizeSql(ta.value);
                if (value.length > 0 && looksLikeSql(value)) {
                  return { success: true, resultType: 'sql', sql: value, editorType: 'textarea' };
                }
              }

              const editables = document.querySelectorAll('[contenteditable="true"]');
              for (const el of editables) {
                if (!isLargeEditor(el)) continue;
                const value = normalizeSql(el.innerText);
                if (value.length > 0 && looksLikeSql(value)) {
                  return { success: true, resultType: 'sql', sql: value, editorType: 'contenteditable' };
                }
              }

              return null;
            };

            // 检查是否有错误
            const error = document.querySelector('.ant-message-error, .error-message, .ant-alert-error');
            if (error) {
              return { error: error.textContent.trim() };
            }
            
            // 检查结果表格（使用多种选择器）
            let table = document.querySelector('.ant-table-tbody');
            if (!table) {
              table = document.querySelector('table tbody');
            }
            if (!table) {
              table = document.querySelector('.ant-table');
            }
            if (!table) {
              table = document.querySelector('table');
            }
            
            if (table) {
              // 检查表格是否有数据行（排除表头）
              const allRows = Array.from(table.querySelectorAll('tr'));
              const dataRows = allRows.filter(tr => {
                const cells = tr.querySelectorAll('td');
                return cells.length > 0; // 数据行有 td，表头有 th
              });
              
              if (dataRows.length > 0) {
                const rows = dataRows.map(tr =>
                  Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())
                );
                
                if (rows.length > 0 && rows[0].length > 0) {
                  // 检查是否真的是数据（不是空行或加载提示）
                  const firstRowText = rows[0].join(' ').toLowerCase();
                  if (firstRowText.includes('加载') || firstRowText.includes('loading') || firstRowText.includes('暂无数据')) {
                    return { waiting: true };
                  }
                  
                  // 格式化结果，便于 AI 理解
                  if (rows.length > 0 && rows[0].length >= 2) {
                    const firstRow = rows[0];
                    // 尝试解析为数字
                    const totalCost = parseFloat(firstRow[1]) || firstRow[1];
                    const rowCount = parseInt(firstRow[2]) || firstRow[2] || rows.length;
                    return { 
                      success: true, 
                      data: rows,
                      formatted: `Cost 总和: ${totalCost}, 数据条数: ${rowCount}`
                    };
                  }
                  return { success: true, data: rows };
                }
              }
            }
            
            // 检查是否有"暂无数据"或"查询结果仍未完成"的提示
            const pageText = document.body.textContent || '';
            if (pageText.includes('查询结果仍未完成') || pageText.includes('请稍后再试')) {
              // 如果看到"查询结果仍未完成"，说明查询还在运行，应该继续等待
              return { running: true, progress: '查询结果仍未完成，继续等待...' };
            }
            
            // 检查是否还在运行（更全面的检查）
            const loading = document.querySelector('.ant-spin, .loading, [class*="loading"], .ant-spin-spinning, [class*="ant-spin"]');
            const statusText = document.body.textContent.match(/查询状态[：:]\s*(\d+%)/);
            const progressText = document.body.textContent.match(/(\d+)%/);
            
            // 检查是否有进度信息
            if (loading || (statusText && statusText[1] !== '100%')) {
              const progress = statusText ? statusText[1] : (progressText ? progressText[1] + '%' : 'unknown');
              return { running: true, progress: progress };
            }
            
            // 检查是否有"查询中"或"执行中"的提示
            const queryingText = document.body.textContent.match(/查询中|执行中|running|processing/i);
            if (queryingText) {
              return { running: true, progress: '查询中...' };
            }
            
            // 检查是否有"查询结果仍未完成"或"请稍后再试"的提示
            const incompleteText = document.body.textContent.match(/查询结果仍未完成|请稍后再试|仍未完成/i);
            if (incompleteText) {
              // 如果看到"查询结果仍未完成"，说明查询还在运行，应该继续等待
              return { running: true, progress: '查询结果仍未完成，继续等待...' };
            }

            // 如果不是查询结果页面，尝试读取 SQL 编辑器内容
            const sqlResult = readSqlFromEditors();
            if (sqlResult) {
              return sqlResult;
            }
            
            return { waiting: true };
          }
        });
        return resultData[0]?.result;
      };

      addLog('开始检查查询结果...', 'info');
      let result = await checkResultOnce();

      if (result?.running) {
        addLog(`查询仍在运行，等待 ${waitTime / 1000} 秒后重试...`, 'info');
        await sleep(waitTime);
        result = await checkResultOnce();
      }
      
      if (result?.error) {
        addLog(`❌ 查询出错: ${result.error}`, 'error');
        return { success: false, error: result.error };
      }
      
      if (result?.success && result?.resultType === 'sql') {
        const preview = String(result.sql || '').slice(0, 120);
        addLog(`✅ 已获取 SQL 编辑器内容 (${result.editorType || 'unknown'}): ${preview}...`, 'success');
        return result;
      }

      if (result?.success && result?.data) {
        addLog(`✅ 查询结果已获取: ${result.formatted || JSON.stringify(result.data)}`, 'success');
        return result;
      }
      
      // 如果没有找到结果，返回提示信息
      addLog(`⚠️ 未找到查询结果，可能查询仍在运行或已完成但无数据`, 'warn');
      return { success: false, error: '未找到查询结果，可能查询仍在运行或已完成但无数据。请手动查看页面。' };
    }
    
    case 'click_rerun': {
      addLog(`🔄 开始查找并点击重跑按钮...`, 'action');
      
      const rerunType = action.rerun_type || action.参数 || 'latest'; // latest 或 instance
      
      const rerunResult = await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        func: (type) => {
          console.log('🔍 开始查找重跑按钮...');
          const buttons = document.querySelectorAll('button, div, span, a');
          console.log(`找到 ${buttons.length} 个可能的按钮元素`);
          
          let foundButton = null;
          
          for (let i = 0; i < buttons.length; i++) {
            const btn = buttons[i];
            const text = btn.textContent.trim();
            const isVisible = btn.offsetParent !== null;
            
            // 查找重跑按钮（可能是"重跑"、"重新执行"等）
            if ((text === '重跑' || text === '重新执行' || text.includes('重跑') || text.includes('rerun')) && isVisible && !btn.disabled) {
              foundButton = btn;
              break;
            }
          }
          
          if (foundButton) {
            console.log(`✅ 找到重跑按钮`);
            foundButton.click();
            
            // 等待弹窗出现
            setTimeout(() => {
              // 查找重跑选项（"以任务最新内容重跑" 或 "以实例运行记录重跑"）
              const options = document.querySelectorAll('.ant-radio-wrapper, .ant-radio-button-wrapper, label');
              for (const option of options) {
                const optionText = option.textContent.trim();
                if (type === 'latest' && (optionText.includes('最新内容') || optionText.includes('最新'))) {
                  option.click();
                  console.log(`✅ 选择"以任务最新内容重跑"`);
                } else if (type === 'instance' && (optionText.includes('实例运行记录') || optionText.includes('实例'))) {
                  option.click();
                  console.log(`✅ 选择"以实例运行记录重跑"`);
                }
              }
              
              // 查找确认按钮
              const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => 
                b.textContent.trim() === '确定' || b.textContent.trim() === '确认'
              );
              if (confirmBtn) {
                setTimeout(() => confirmBtn.click(), 500);
                console.log(`✅ 点击确认按钮`);
              }
            }, 1000);
            
            return { success: true, message: '已点击重跑按钮' };
          }
          
          console.error('❌ 未找到重跑按钮');
          return { success: false, error: '未找到重跑按钮' };
        },
        args: [rerunType]
      });
      
      const rerunResultData = rerunResult[0]?.result || { success: false };
      if (rerunResultData.success) {
        addLog(`✅ 重跑按钮点击成功`, 'success');
      } else {
        addLog(`❌ 重跑按钮点击失败: ${rerunResultData.error || '未知错误'}`, 'error');
      }
      return rerunResultData;
    }
    
    case 'click_dag_view': {
      addLog(`📊 开始查找并点击 DAG 可视化按钮...`, 'action');
      
      const dagResult = await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        func: () => {
          console.log('🔍 开始查找 DAG/可视化按钮...');
          const buttons = document.querySelectorAll('button, div, span, a');
          console.log(`找到 ${buttons.length} 个可能的按钮元素`);
          
          let foundButton = null;
          
          for (let i = 0; i < buttons.length; i++) {
            const btn = buttons[i];
            const text = btn.textContent.trim();
            const isVisible = btn.offsetParent !== null;
            
            // 查找可视化/DAG按钮
            if ((text === '可视化' || text === 'DAG' || text.includes('可视化') || text.includes('DAG') || text.includes('依赖')) && isVisible && !btn.disabled) {
              foundButton = btn;
              break;
            }
          }
          
          if (foundButton) {
            console.log(`✅ 找到 DAG 可视化按钮`);
            foundButton.click();
            return { success: true, message: '已点击 DAG 可视化按钮' };
          }
          
          console.error('❌ 未找到 DAG 可视化按钮');
          return { success: false, error: '未找到 DAG 可视化按钮' };
        }
      });
      
      const dagResultData = dagResult[0]?.result || { success: false };
      if (dagResultData.success) {
        addLog(`✅ DAG 可视化按钮点击成功`, 'success');
        await sleep(2000); // 等待 DAG 图加载
      } else {
        addLog(`❌ DAG 可视化按钮点击失败: ${dagResultData.error || '未知错误'}`, 'error');
      }
      return dagResultData;
    }
    
    case 'get_dag_info': {
      addLog(`📊 开始获取 DAG 图信息...`, 'action');
      
      await sleep(2000); // 等待 DAG 图加载
      
      const dagInfoResult = await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        func: () => {
          console.log('🔍 开始提取 DAG 信息...');
          
          // 方法1: 尝试从 Canvas 中提取节点信息（如果 DAG 图是 Canvas 渲染）
          const canvas = document.querySelector('canvas');
          if (canvas) {
            console.log('✅ 找到 Canvas 元素');
            // Canvas 中的节点信息可能需要通过页面 JavaScript 获取
            // 这里尝试从页面的全局变量或数据属性中获取
          }
          
          // 方法2: 尝试从 SVG 中提取节点信息
          const svg = document.querySelector('svg');
          if (svg) {
            console.log('✅ 找到 SVG 元素');
            const nodes = svg.querySelectorAll('g[class*="node"], circle, rect');
            const edges = svg.querySelectorAll('line, path[class*="edge"]');
            return {
              success: true,
              type: 'svg',
              nodeCount: nodes.length,
              edgeCount: edges.length,
              message: `找到 ${nodes.length} 个节点，${edges.length} 条边`
            };
          }
          
          // 方法3: 尝试从 HTML 元素中提取节点信息
          const nodeElements = document.querySelectorAll('[class*="node"], [class*="dag-node"], [data-node-id]');
          const edgeElements = document.querySelectorAll('[class*="edge"], [class*="dag-edge"]');
          
          if (nodeElements.length > 0) {
            const nodes = Array.from(nodeElements).map(el => ({
              id: el.getAttribute('data-node-id') || el.id || '',
              text: el.textContent.trim().substring(0, 50),
              className: el.className
            }));
            
            return {
              success: true,
              type: 'html',
              nodes: nodes,
              nodeCount: nodes.length,
              edgeCount: edgeElements.length,
              message: `找到 ${nodes.length} 个节点`
            };
          }
          
          // 方法4: 尝试从页面文本中提取节点信息
          const pageText = document.body.textContent || '';
          const nodeMatches = pageText.match(/[数据加工|数据监控|虚节点][^\\n]*/g);
          
          if (nodeMatches && nodeMatches.length > 0) {
            return {
              success: true,
              type: 'text',
              nodes: nodeMatches.slice(0, 20),
              nodeCount: nodeMatches.length,
              message: `从文本中提取到 ${nodeMatches.length} 个节点`
            };
          }
          
          console.error('❌ 未找到 DAG 图信息');
          return { success: false, error: '未找到 DAG 图信息，可能页面未加载完成或不是 DAG 页面' };
        }
      });
      
      const dagInfo = dagInfoResult[0]?.result || { success: false };
      if (dagInfo.success) {
        addLog(`✅ DAG 信息获取成功: ${dagInfo.message}`, 'success');
        if (dagInfo.nodes) {
          addLog(`   节点列表: ${dagInfo.nodes.map(n => typeof n === 'string' ? n : n.text || n.id).join(', ')}`, 'info');
        }
      } else {
        addLog(`❌ DAG 信息获取失败: ${dagInfo.error || '未知错误'}`, 'error');
      }
      return dagInfo;
    }
    
    case 'confluence_search': {
      addLog(`🔍 开始搜索 Confluence 页面...`, 'action');
      
      const query = action.query || action.参数 || '';
      if (!query) {
        addLog(`❌ confluence_search 操作缺少 query 参数`, 'error');
        return { success: false, error: 'confluence_search 操作缺少 query 参数' };
      }
      
      try {
        // 调用 Confluence API 搜索页面
        // 使用配置的 Confluence API Token
        const apiToken = CONFLUENCE_API_TOKEN;
        
        // Confluence REST API v2 搜索端点
        const searchUrl = 'https://cf.meitu.com/rest/api/content/search';
        
        const response = await fetch(searchUrl, {
          method: 'POST',
          headers: {
            // Confluence Personal Access Token 使用 Bearer Token 认证
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            cql: `text ~ "${query}"`,
            limit: 10,
            expand: 'space,version'
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          addLog(`⚠️ Confluence API 调用失败 (${response.status}): ${errorText.substring(0, 200)}`, 'warn');
          
          // 如果 Bearer Token 失败，尝试提示使用 Basic Auth
          if (response.status === 401) {
            return { 
              success: false, 
              error: 'Confluence API 认证失败。请配置正确的 Confluence API Token，或使用 Basic Auth（用户名:密码的 Base64 编码）' 
            };
          }
          
          throw new Error(`Confluence API 调用失败: ${response.status} - ${errorText.substring(0, 100)}`);
        }
        
        const data = await response.json();
        const results = data.results || [];
        
        addLog(`✅ 搜索到 ${results.length} 个页面`, 'success');
        
        const formattedResults = results.map(page => ({
          id: page.id,
          title: page.title,
          space: page.space?.name || '',
          url: `https://cf.meitu.com/confluence/pages/viewpage.action?pageId=${page.id}`
        }));
        
        return {
          success: true,
          query: query,
          results: formattedResults,
          count: formattedResults.length
        };
      } catch (error) {
        addLog(`❌ Confluence 搜索失败: ${error.message}`, 'error');
        return { success: false, error: `Confluence 搜索失败: ${error.message}` };
      }
    }
    
    case 'confluence_get_content': {
      addLog(`📄 开始获取 Confluence 页面内容...`, 'action');
      
      const pageId = action.page_id || action.参数 || '';
      if (!pageId) {
        addLog(`❌ confluence_get_content 操作缺少 page_id 参数`, 'error');
        return { success: false, error: 'confluence_get_content 操作缺少 page_id 参数' };
      }
      
      try {
        // 调用 Confluence API 获取页面内容
        // 使用配置的 Confluence API Token
        const apiToken = CONFLUENCE_API_TOKEN;
        const contentUrl = `https://cf.meitu.com/rest/api/content/${pageId}?expand=body.storage,body.view,version,space`;
        
        const response = await fetch(contentUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          addLog(`⚠️ Confluence API 调用失败 (${response.status}): ${errorText.substring(0, 200)}`, 'warn');
          
          if (response.status === 401) {
            return { 
              success: false, 
              error: 'Confluence API 认证失败。请配置正确的 Confluence API Token' 
            };
          }
          
          throw new Error(`Confluence API 调用失败: ${response.status} - ${errorText.substring(0, 100)}`);
        }
        
        const data = await response.json();
        
        addLog(`✅ 获取到页面: ${data.title}`, 'success');
        
        // 提取文本内容
        // 优先使用 view 格式（已渲染的文本），如果没有则使用 storage 格式（HTML）
        let textContent = '';
        if (data.body?.view?.value) {
          textContent = data.body.view.value.replace(/<[^>]*>/g, '').substring(0, 3000);
        } else if (data.body?.storage?.value) {
          textContent = data.body.storage.value.replace(/<[^>]*>/g, '').substring(0, 3000);
        }
        
        return {
          success: true,
          pageId: pageId,
          title: data.title,
          space: data.space?.name || '',
          content: textContent,
          url: `https://cf.meitu.com/confluence/pages/viewpage.action?pageId=${pageId}`
        };
      } catch (error) {
        addLog(`❌ Confluence 获取内容失败: ${error.message}`, 'error');
        return { success: false, error: `Confluence 获取内容失败: ${error.message}` };
      }
    }
      
    case 'finish':
      // 兼容不同的字段名：result 或 参数
      const finishResult = action.result || action.参数 || '';
      return { success: true, result: finishResult };
      
    default:
      return { success: false, error: `未知操作: ${action.action}` };
  }
}

// 发送到微信
async function sendToWechat(result) {
  try {
    await loadConfigFromStorage();
    if (!WEBHOOK_URL) {
      addLog('Webhook URL 未配置，无法发送到群', 'error');
      return;
    }
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          content: `**【数仓小助手】查询结果**\n\n${result}`
        }
      })
    });
    addLog('已发送到微信群', 'success');
  } catch (e) {
    addLog(`发送失败: ${e.message}`, 'error');
  }
}

async function sleep(ms) {
  const total = Math.max(0, Number(ms) || 0);
  if (!currentTask) {
    return new Promise(resolve => setTimeout(resolve, total));
  }

  const start = Date.now();
  while (Date.now() - start < total) {
    if (taskControl.canceled) throw new Error('任务已取消');
    if (taskControl.paused) await waitIfPaused();
    const elapsed = Date.now() - start;
    const remaining = total - elapsed;
    await new Promise(resolve => setTimeout(resolve, Math.min(200, remaining)));
  }
}
