/**
 * AI Client Module - AI 调用客户端
 *
 * 统一处理与 AI 模型的交互
 */

import { logger } from './logger.js';
import { storage, StorageKeys } from './storage.js';

export class AIClient {
  constructor() {
    this.baseUrl = 'https://model-router.meitu.com/v1';
  }

  normalizeApiUrl(apiUrl) {
    if (!apiUrl) {
      return `${this.baseUrl}/chat/completions`;
    }

    const trimmed = String(apiUrl).replace(/\/+$/u, '');
    if (trimmed.endsWith('/v1')) {
      return `${trimmed}/chat/completions`;
    }
    return trimmed;
  }

  /**
   * 获取配置的 API Token
   */
  async getApiToken() {
    const token = await storage.get(StorageKeys.CONFIG_API_TOKEN);
    if (!token) {
      throw new Error('API Token 未配置，请在插件设置中配置');
    }
    return token;
  }

  /**
   * 获取配置的模型
   */
  async getModel() {
    return await storage.get(StorageKeys.CONFIG_MODEL) || 'gpt-4o-mini';
  }

  /**
   * 获取配置的 API URL
   */
  async getApiUrl() {
    return await storage.get(StorageKeys.CONFIG_API_URL) || this.baseUrl;
  }

  /**
   * 调用 AI 模型
   */
  async chat(messages, options = {}) {
    const {
      model,
      maxTokens = 65536,
      temperature = 0.7,
      systemPrompt = null,
    } = options;

    try {
      const actualModel = model || await this.getModel();
      const apiToken = await this.getApiToken();
      const apiUrl = await this.getApiUrl();
      const requestUrl = this.normalizeApiUrl(apiUrl);

      let formattedMessages = [...messages];

      // 如果提供了系统提示词，确保它在最前面
      if (systemPrompt) {
        const hasSystem = formattedMessages.some(m => m.role === 'system');
        if (!hasSystem) {
          formattedMessages.unshift({ role: 'system', content: systemPrompt });
        } else {
          formattedMessages[0] = { role: 'system', content: systemPrompt };
        }
      }

      logger.action(`调用模型: ${actualModel}`);
      logger.debug(`消息数量: ${formattedMessages.length}`);

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          'X-Mtcc-Client': 'ai-assistant-extension',
        },
        body: JSON.stringify({
          model: actualModel,
          messages: formattedMessages,
          max_tokens: maxTokens,
          temperature,
        }),
      });

      const responseText = await response.text();

      if (!response.ok) {
        logger.error(`AI 调用失败 (${response.status}): ${responseText.substring(0, 200)}`);
        throw new Error(`AI 调用失败 (${response.status}): ${responseText.substring(0, 100)}`);
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        logger.error(`AI 响应解析失败: ${responseText.substring(0, 200)}`);
        throw new Error(`AI 响应解析失败`);
      }

      if (!data.choices || !data.choices[0]) {
        logger.error(`AI 响应格式异常: ${JSON.stringify(data).substring(0, 200)}`);
        throw new Error(`AI 响应格式异常`);
      }

      const choice = data.choices[0];
      const content = choice.message?.content || choice.message?.reasoning_content || '';

      if (!content) {
        throw new Error(`AI 未返回内容 (finish_reason: ${choice.finish_reason})`);
      }

      // 检查是否被截断
      if (choice.finish_reason === 'length') {
        logger.warn('AI 响应被截断');
      }

      logger.success('AI 调用成功');
      return {
        content,
        model: actualModel,
        usage: data.usage,
        finishReason: choice.finish_reason,
      };

    } catch (error) {
      logger.error(`AI 调用异常: ${error.message}`);
      throw error;
    }
  }

  /**
   * 简化版对话（仅返回文本内容）
   */
  async chatSimple(messages, systemPrompt = null) {
    const result = await this.chat(messages, { systemPrompt });
    return result.content;
  }

  /**
   * 带重试的对话
   */
  async chatWithRetry(messages, options = {})
  {
    const maxAttempts = options.maxAttempts || 3;
    const delay = options.delay || 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.chat(messages, options);
      } catch (error) {
        if (attempt === maxAttempts) {
          throw error;
        }
        logger.warn(`第 ${attempt} 次调用失败，${delay}ms 后重试...`);
        await this.sleep(delay);
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 创建全局单例
export const aiClient = new AIClient();
