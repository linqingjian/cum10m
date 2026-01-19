/**
 * Action Executor - 动作执行器
 *
 * 执行 AI 返回的各种操作
 */

import { logger } from './logger.js';
import { storage, StorageKeys } from './storage.js';

export class ActionExecutor {
  constructor(tabId) {
    this.tabId = tabId;
  }

  /**
   * 执行单个 Action
   */
  async execute(action) {
    const { type, target, value, thinking } = action;

    logger.action(`执行操作: ${type} - ${thinking || ''}`);

    switch (type) {
      case 'navigate':
        return await this.navigate(target);
      case 'click':
        return await this.click(target);
      case 'type':
        return await this.type(target, value);
      case 'select':
        return await this.select(target, value);
      case 'wait':
        return await this.wait(parseInt(value, 10) || 1000);
      case 'getText':
        return await this.getText(target);
      case 'getTable':
        return await this.getTable(target);
      case 'screenshot':
        return await this.screenshot(target);
      case 'scroll':
        return await this.scroll(value);
      case 'back':
        return await this.goBack();
      case 'forward':
        return await this.goForward();
      case 'refresh':
        return await this.refresh();
      default:
        throw new Error(`未知的操作类型: ${type}`);
    }
  }

  /**
   * 导航到 URL
   */
  async navigate(url) {
    if (!url) throw new Error('URL 不能为空');
    
    logger.info(`导航到: ${url}`);
    await chrome.tabs.update(this.tabId, { url });
    
    return { success: true, action: 'navigate', url };
  }

  /**
   * 点击元素
   */
  async click(selector) {
    if (!selector) throw new Error('选择器不能为空');
    
    const result = await chrome.scripting.executeScript({
      target: { tabId: this.tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) {
          return { success: false, error: '元素不存在: ' + sel };
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.click();
        return { success: true, tagName: el.tagName };
      },
      args: [selector]
    });

    const outcome = result[0].result;
    if (!outcome.success) {
      throw new Error(outcome.error);
    }

    return { success: true, action: 'click', selector };
  }

  /**
   * 输入文本
   */
  async type(selector, text) {
    if (!selector) throw new Error('选择器不能为空');
    if (!text) throw new Error('输入文本不能为空');
    
    const result = await chrome.scripting.executeScript({
      target: { tabId: this.tabId },
      func: (sel, value) => {
        const el = document.querySelector(sel);
        if (!el) {
          return { success: false, error: '元素不存在: ' + sel };
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.click();
        el.value = '';
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, tagName: el.tagName };
      },
      args: [selector, text]
    });

    const outcome = result[0].result;
    if (!outcome.success) {
      throw new Error(outcome.error);
    }

    return { success: true, action: 'type', selector, text };
  }

  /**
   * 选择选项
   */
  async select(selector, value) {
    if (!selector) throw new Error('选择器不能为空');
    
    const result = await chrome.scripting.executeScript({
      target: { tabId: this.tabId },
      func: (sel, val) => {
        const el = document.querySelector(sel);
        if (!el) {
          return { success: false, error: '元素不存在: ' + sel };
        }
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true };
      },
      args: [selector, value]
    });

    return result[0].result;
  }

  /**
   * 等待
   */
  async wait(ms) {
    logger.info(`等待 ${ms}ms`);
    await new Promise(resolve => setTimeout(resolve, ms));
    return { success: true, action: 'wait', duration: ms };
  }

  /**
   * 获取文本
   */
  async getText(selector) {
    if (!selector) {
      selector = 'body';
    }
    
    const result = await chrome.scripting.executeScript({
      target: { tabId: this.tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) {
          return { success: false, error: '元素不存在: ' + sel };
        }
        return {
          success: true,
          text: el.textContent?.trim?.() || '',
          innerText: el.innerText?.trim?.() || ''
        };
      },
      args: [selector]
    });

    return result[0].result;
  }

  /**
   * 获取表格
   */
  async getTable(selector) {
    if (!selector) {
      selector = 'table';
    }
    
    const result = await chrome.scripting.executeScript({
      target: { tabId: this.tabId },
      func: (sel) => {
        const tables = Array.from(document.querySelectorAll(sel));
        if (tables.length === 0) {
          return { success: false, error: '未找到表格: ' + sel };
        }
        
        const extractTableData = (table) => {
          const rows = Array.from(table.querySelectorAll('tr'));
          return rows.map(row => {
            const cells = Array.from(row.querySelectorAll('th, td'));
            return cells.map(cell => cell.textContent?.trim() || '');
          });
        };
        
        const data = extractTableData(tables[0]);
        return {
          success: true,
          data,
          rowCount: data.length,
          colCount: data[0]?.length || 0
        };
      },
      args: [selector]
    });

    return result[0].result;
  }

  /**
   * 截图
   */
  async screenshot(selector = null) {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
    });

    return { success: true, action: 'screenshot', dataUrl };
  }

  /**
   * 滚动
   */
  async scroll(value = 'down') {
    const result = await chrome.scripting.executeScript({
      target: { tabId: this.tabId },
      func: (direction) => {
        if (direction === 'top') {
          window.scrollTo(0, 0);
        } else if (direction === 'bottom') {
          window.scrollTo(0, document.body.scrollHeight);
        } else {
          window.scrollBy(0, 300);
        }
        return { success: true };
      },
      args: [value]
    });

    return result[0].result;
  }

  /**
   * 后退
   */
  async goBack() {
    await chrome.tabs.goBack(this.tabId);
    await this.wait(1000);
    return { success: true, action: 'back' };
  }

  /**
   * 前进
   */
  async goForward() {
    await chrome.tabs.goForward(this.tabId);
    await this.wait(1000);
    return { success: true, action: 'forward' };
  }

  /**
   * 刷新
   */
  async refresh() {
    await chrome.tabs.reload(this.tabId);
    await this.wait(2000);
    return { success: true, action: 'refresh' };
  }
}
