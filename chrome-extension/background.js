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

// ========== 消息监听 ==========

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const { type, data } = message;
      const tabId = sender.tab?.id;

      logger.debug(`收到消息: ${type}`);

      switch (type) {
        case 'START_TASK':
          const taskResult = await startTask(data.task, tabId);
          sendResponse({ success: true, data: taskResult });
          break;
        case 'STOP_TASK':
          stopTask();
          sendResponse({ success: true });
          break;
        case 'GET_TASK_STATUS':
          sendResponse({ success: true, data: getTaskStatus() });
          break;
        case 'GET_LOGS':
          const logs = logger.getLogs();
          sendResponse({ success: true, data: logs });
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
async function startTask(task, tabId) {
  if (currentTask) {
    throw new Error('已有任务在执行中，请先停止');
  }

  try {
    abortController = new AbortController();
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
    const result = await executeTaskLoop(messages, tabId, maxSteps);

    currentTask.status = 'completed';
    logger.success(`任务完成: ${result}`);

    return {
      task: currentTask,
      result,
      logs: logger.getLogs(),
    };
  } catch (error) {
    currentTask.status = 'failed';
    logger.error(`任务失败: ${error.message}`);
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
    currentTask = null;
  }
}

/**
 * 任务执行循环
 */
async function executeTaskLoop(messages, tabId, maxSteps) {
  let stepCount = 0;
  const executor = new ActionExecutor(tabId);

  while (stepCount < maxSteps) {
    if (abortController?.signal.aborted) {
      throw new Error('任务已中止');
    }

    stepCount++;
    logger.info(`执行步骤 ${stepCount}/${maxSteps}`);

    try {
      // 1. 调用 AI 获取下一步操作
      const aiResponse = await aiClient.chat(messages, {
        maxTokens: 1000,
        temperature: 0.3,
      });

      const aiContent = aiResponse.content.trim();
      logger.debug(`AI 响应: ${aiContent}`);

      // 2. 解析 AI 响应
      const action = parseAIResponse(aiContent);
      logger.action(`AI 决策: ${action.type} - ${action.thinking || ''}`);

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
  return {
    task: currentTask,
    logs: logger.getLogs(),
    history: executionHistory,
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
