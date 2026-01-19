/**
 * AI Browser Assistant - Background Service Worker
 *
 * 通用化的 AI 浏览器助手核心服务
 */

import { aiClient } from './core/ai-client.js';
import { ActionExecutor } from './core/action-executor.js';
import { logger, LogLevel } from './core/logger.js';
import { storage, StorageKeys } from './core/storage.js';
import { buildSkillsPrompt } from './utils/skills-loader.js';

// ========== 全局状态 ==========

let currentTask = null;
let taskLogs = [];
let executionHistory = [];
let abortController = null;
let lastResult = null;
let lastError = null;
let taskPaused = false;
let activeTaskPromise = null;

// ========== 消息监听 ==========

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const { type, data } = message;
      const tabId = sender.tab?.id;

      logger.debug(`收到消息: ${type}`);

      switch (type) {
        case 'START_TASK':
          {
            const taskText = data?.task || message.task;
            const model = data?.model || message.model;
            if (!taskText) {
              throw new Error('任务内容不能为空');
            }

            if (data?.task) {
              const taskResult = await startTask(taskText, tabId, { model });
              sendResponse({ success: true, data: taskResult });
            } else {
              startTaskAsync(taskText, tabId, { model });
              sendResponse({ success: true, status: 'started' });
            }
            break;
          }
        case 'CHAT_MESSAGE':
          {
            const chatText = data?.message || message.message;
            const model = data?.model || message.model;
            const reply = await handleChatMessage(chatText, tabId, { model });
            sendResponse({ success: true, reply });
            break;
          }
        case 'STOP_TASK':
          stopTask();
          sendResponse({ success: true });
          break;
        case 'TASK_CANCEL':
          stopTask();
          chrome.runtime.sendMessage({ type: 'TASK_CANCELED' });
          sendResponse({ success: true });
          break;
        case 'TASK_PAUSE':
          pauseTask();
          chrome.runtime.sendMessage({ type: 'TASK_PAUSED' });
          sendResponse({ success: true });
          break;
        case 'TASK_RESUME':
          resumeTask();
          chrome.runtime.sendMessage({ type: 'TASK_RESUMED' });
          sendResponse({ success: true });
          break;
        case 'GET_TASK_STATUS':
          sendResponse({ success: true, data: getTaskStatus() });
          break;
        case 'GET_STATUS':
          sendResponse({
            success: true,
            status: getTaskStatus().status,
            logs: logger.getLogs(),
            lastResult: lastResult,
            lastError: lastError,
          });
          break;
        case 'GET_LOGS':
          const logs = logger.getLogs();
          sendResponse({ success: true, data: logs });
          break;
        case 'CLEAR_LOGS':
          logger.clear();
          sendResponse({ success: true });
          break;
        case 'EXECUTE_SINGLE_ACTION':
          const actionResult = await executeAction(data, tabId);
          sendResponse({ success: true, data: actionResult });
          break;
        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      logger.error(`处理消息失败: ${error.message}`);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // 保持异步响应通道
});

// ========== 任务执行核心 ==========

/**
 * 开始任务
 */
async function startTask(task, tabId, options = {}) {
  if (currentTask) {
    throw new Error('已有任务在执行中，请先停止');
  }

  try {
    abortController = new AbortController();
    taskPaused = false;
    lastResult = null;
    lastError = null;
    currentTask = {
      id: Date.now().toString(),
      task,
      status: 'running',
      startTime: Date.now(),
      tabId,
    };

    logger.info(`开始任务: ${task}`);

    // 获取任务执行配置
    const config = await storage.getMany(['maxSteps', 'verboseLogs']);
    const maxSteps = config.maxSteps || 15;
    const verboseLogs = config.verboseLogs || false;

    // 设置日志级别
    if (verboseLogs) {
      logger.setLevel(LogLevel.DEBUG);
    }

    // 构建 AI 对话上下文
    const systemPrompt = await buildSystemPrompt(tabId);
    const messages = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: task,
      },
    ];

    // 执行任务循环
    const result = await executeTaskLoop(messages, tabId, maxSteps, options);

    currentTask.status = 'completed';
    logger.success(`任务完成: ${result}`);
    lastResult = result;

    return {
      task: currentTask,
      result,
      logs: logger.getLogs(),
    };
  } catch (error) {
    currentTask.status = 'failed';
    logger.error(`任务失败: ${error.message}`);
    lastError = error.message;
    throw error;
  } finally {
    currentTask = null;
  }
}

/**
 * 停止任务
 */
function stopTask() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }

  if (currentTask) {
    currentTask.status = 'stopped';
    logger.warn('任务已停止');
    taskPaused = false;
  }
}

/**
 * 任务执行循环
 */
async function executeTaskLoop(messages, tabId, maxSteps, options = {}) {
  let stepCount = 0;
  const executor = new ActionExecutor(tabId);

  while (stepCount < maxSteps) {
    if (abortController?.signal.aborted) {
      throw new Error('任务已中止');
    }

    await waitWhilePaused();

    stepCount++;
    logger.info(`执行步骤 ${stepCount}/${maxSteps}`);

    try {
      // 1. 调用 AI 获取下一步操作
      const aiResponse = await aiClient.chat(messages, {
        maxTokens: 1000,
        temperature: 0.3,
        model: options.model,
      });

      const aiContent = aiResponse.content.trim();
      logger.debug(`AI 响应: ${aiContent}`);

      // 2. 解析 AI 响应
      const action = parseAIResponse(aiContent);
      logger.action(`AI 决策: ${action.type} - ${action.thinking || ''}`);
      chrome.runtime.sendMessage({
        type: 'TASK_PROGRESS',
        action: action.type,
        thinking: action.thinking || '',
      });

      // 3. 检查任务是否完成
      if (action.done || action.type === 'done') {
        const finalResult = action.result || '';
        logger.success(`AI 判定任务完成`);
        return finalResult;
      }

      // 4. 执行操作
      const executionResult = await executor.execute(action);
      logger.result(`操作结果: ${JSON.stringify(executionResult)}`);

      // 5. 更新对话上下文
      messages.push({
        role: 'assistant',
        content: aiContent,
      });

      messages.push({
        role: 'user',
        content: `操作执行结果: ${JSON.stringify(executionResult) || '成功'}`,
      });

      // 6. 等待一下，给页面反应时间
      await wait(500);

    } catch (error) {
      logger.error(`步骤 ${stepCount} 执行失败: ${error.message}`);
      
      // 将错误信息反馈给 AI
      messages.push({
        role: 'user',
        content: `执行出错: ${error.message}。请根据错误信息调整或完成任务。`,
      });
    }
  }

  throw new Error(`达到最大步骤数 (${maxSteps})，任务未完成`);
}

/**
 * 执行单个动作（用于手动控制）
 */
async function executeAction(data, tabId) {
  const executor = new ActionExecutor(tabId);
  return await executor.execute(data);
}

function startTaskAsync(task, tabId, options = {}) {
  if (activeTaskPromise) {
    throw new Error('已有任务在执行中，请先停止');
  }

  activeTaskPromise = startTask(task, tabId, options)
    .then((result) => {
      safeSendRuntimeMessage({ type: 'TASK_COMPLETE', result });
      return result;
    })
    .catch((error) => {
      if (String(error.message || '').includes('中止') || currentTask?.status === 'stopped') {
        safeSendRuntimeMessage({ type: 'TASK_CANCELED' });
      } else {
        safeSendRuntimeMessage({ type: 'TASK_ERROR', error: error.message });
      }
      throw error;
    })
    .finally(() => {
      activeTaskPromise = null;
      taskPaused = false;
    });
}

function pauseTask() {
  if (!currentTask) {
    return;
  }
  taskPaused = true;
  currentTask.status = 'paused';
}

function resumeTask() {
  if (!currentTask) {
    return;
  }
  taskPaused = false;
  currentTask.status = 'running';
}

async function waitWhilePaused() {
  while (taskPaused) {
    if (abortController?.signal.aborted) {
      throw new Error('任务已中止');
    }
    await wait(300);
  }
}

// ========== 辅助函数 ==========

/**
 * 解析 AI 响应
 */
function parseAIResponse(content) {
  // 尝试提取 JSON
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const action = JSON.parse(jsonMatch[0]);
      // 标准化字段
      return {
        type: action.type || action.action,
        target: action.target,
        value: action.value,
        thinking: action.thinking || '',
        done: action.done === true || action.done === 'true',
        result: action.result || '',
      };
    } catch (e) {
      logger.warn(`JSON 解析失败: ${e.message}`);
    }
  }

  // 如果不是 JSON，可能是纯文本输出
  if (content.includes('完成') || content.includes('done') || content.includes('已完成')) {
    return {
      type: 'done',
      done: true,
      result: content,
      thinking: content,
    };
  }

  throw new Error(`无法解析 AI 响应: ${content}`);
}

/**
 * 构建系统提示词
 */
async function buildSystemPrompt(tabId) {
  let url = '';
  let pageContext = {};

  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      url = tab.url || '';
      
      // 获取页面上下文（简化版）
      pageContext = await getPageContext(tabId);
    } catch (e) {
      logger.warn(`获取 Tab 信息失败: ${e.message}`);
    }
  }

  return aiClient.buildSystemPrompt(url, pageContext).replace(
    '## 可用操作',
    `## 可用技能\n${buildSkillsPrompt()}\n\n## 可用操作`
  );
}

/**
 * 获取页面上下文
 */
async function getPageContext(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          title: document.title,
          url: window.location.href,
          hasInput: document.querySelectorAll('input, textarea').length > 0,
          hasButton: document.querySelectorAll('button, [role="button"]').length > 0,
          hasTable: document.querySelectorAll('table').length > 0,
        };
      },
    });
    return result[0]?.result || {};
  } catch (e) {
    return {};
  }
}

async function handleChatMessage(message, tabId, options = {}) {
  if (!message) {
    throw new Error('消息不能为空');
  }

  let url = '';
  let pageContext = {};

  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      url = tab.url || '';
      pageContext = await getPageContext(tabId);
    } catch (e) {
      logger.warn(`获取页面信息失败: ${e.message}`);
    }
  }

  const systemPrompt = `你是我的 AI 浏览器助手，负责回答用户的问题并给出清晰的建议。

当前页面: ${url || 'N/A'}
页面上下文: ${pageContext ? JSON.stringify(pageContext) : '{}'}

回复要求：
1. 使用简洁的中文回答
2. 如果需要进一步操作，请说明下一步
3. 避免返回 JSON，只输出自然语言`;

  const response = await aiClient.chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ],
    {
      maxTokens: 1000,
      temperature: 0.4,
      model: options.model,
    }
  );

  return response.content || '';
}

function safeSendRuntimeMessage(message) {
  try {
    chrome.runtime.sendMessage(message);
  } catch (error) {
    logger.debug(`发送消息失败: ${error.message}`);
  }
}

/**
 * 等待函数
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 获取任务状态
 */
function getTaskStatus() {
  const status = taskPaused ? 'paused' : (currentTask?.status || 'idle');
  return {
    task: currentTask,
    logs: logger.getLogs(),
    history: executionHistory,
    status,
    lastResult,
    lastError,
  };
}

// ========== 安装和更新 ==========

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    logger.info('AI Browser Assistant 已安装');
    chrome.tabs.create({ url: 'options.html' });
  } else if (details.reason === 'update') {
    logger.info(`AI Browser Assistant 已更新到 ${chrome.runtime.getManifest().version}`);
  }
});
