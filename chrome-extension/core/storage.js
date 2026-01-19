/**
 * Storage Manager Module - 存储管理
 *
 * 统一管理 Chrome Extension 的数据存储
 */

export class StorageManager {
  constructor() {
    this.prefix = 'ai_assistant_';
  }

  /**
   * 构建带前缀的键名
   */
  buildKey(key) {
    return `${this.prefix}${key}`;
  }

  /**
   * 获取数据
   */
  async get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(this.buildKey(key), (result) => {
        resolve(result[this.buildKey(key)]);
      });
    });
  }

  /**
   * 获取多个键
   */
  async getMany(keys) {
    return new Promise((resolve) => {
      const prefixedKeys = keys.map(k => this.buildKey(k));
      chrome.storage.local.get(prefixedKeys, (result) => {
        const mappedResult = {};
        keys.forEach(key => {
          mappedResult[key] = result[this.buildKey(key)];
        });
        resolve(mappedResult);
      });
    });
  }

  /**
   * 设置数据
   */
  async set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [this.buildKey(key)]: value }, () => {
        resolve();
      });
    });
  }

  /**
   * 设置多个键值对
   */
  async setMany(data) {
    const prefixedData = {};
    for (const [key, value] of Object.entries(data)) {
      prefixedData[this.buildKey(key)] = value;
    }
    return new Promise((resolve) => {
      chrome.storage.local.set(prefixedData, () => {
        resolve();
      });
    });
  }

  /**
   * 删除数据
   */
  async remove(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(this.buildKey(key), () => {
        resolve();
      });
    });
  }

  /**
   * 删除多个键
   */
  async removeMany(keys) {
    const prefixedKeys = keys.map(k => this.buildKey(k));
    return new Promise((resolve) => {
      chrome.storage.local.remove(prefixedKeys, () => {
        resolve();
      });
    });
  }

  /**
   * 清空所有数据
   */
  async clear() {
    return new Promise((resolve) => {
      chrome.storage.local.clear(() => {
        resolve();
      });
    });
  }

  /**
   * 监听存储变化
   */
  onChanged(callback) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      const mappedChanges = {};
      for (const [key, change] of Object.entries(changes)) {
        if (key.startsWith(this.prefix)) {
          const originalKey = key.slice(this.prefix.length);
          mappedChanges[originalKey] = change;
        }
      }
      if (Object.keys(mappedChanges).length > 0) {
        callback(mappedChanges);
      }
    });
  }
}

// 创建全局单例
export const storage = new StorageManager();

// ========== 预定义的存储键 ==========
export const StorageKeys = {
  // 配置
  CONFIG_API_URL: 'apiUrl',
  CONFIG_API_TOKEN: 'apiToken',
  CONFIG_MODEL: 'model',
  CONFIG_WEBHOOK_URL: 'webhookUrl',
  CONFIG_CONFLUENCE_TOKEN: 'confluenceToken',
  CONFIG_VERBOSE_LOGS: 'verboseLogs',

  // 任务状态
  TASK_STATUS: 'taskStatus',
  TASK_LOGS: 'taskLogs',

  // 聊天历史
  CHAT_HISTORY: 'chatHistory',

  // 结果缓存
  LAST_RESULT: 'lastResult',
  LAST_TASK: 'lastTask',
};
