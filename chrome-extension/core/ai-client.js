/**
 * AI Client - AI 客户端
 *
 * 与 AI 模型通信的通用接口
 */

import { logger } from './logger.js';
import { storage, StorageKeys } from './storage.js';

export class AIClient {
  constructor() {
    this.config = {
      apiUrl: '',
      apiToken: '',
      model: 'gpt-4o',
    };
    this.configReady = this.loadConfig();

    storage.onChanged((changes) => {
      if (changes.apiUrl) {
        this.config.apiUrl = changes.apiUrl.newValue || this.config.apiUrl;
      }
      if (changes.apiToken) {
        this.config.apiToken = changes.apiToken.newValue || '';
      }
      if (changes.model) {
        this.config.model = changes.model.newValue || this.config.model;
      }
    });
  }

  /**
   * 加载配置
   */
  async loadConfig() {
    const config = await storage.getMany(['apiUrl', 'apiToken', 'model']);
    this.config.apiUrl = config.apiUrl || 'https://model-router.meitu.com/v1';
    this.config.apiToken = config.apiToken || '';
    this.config.model = config.model || 'gpt-4o';
  }

  /**
   * 调用 AI
   */
  async chat(messages, options = {}) {
    await this.configReady;

    if (!this.config.apiToken) {
      throw new Error('API Token 未配置，请在设置中配置');
    }

    const { 
      model = this.config.model,
      maxTokens = 2000,
      temperature = 0.7,
      stream = false
    } = options;

    logger.debug(`调用 AI: ${messages.length} 条消息`);

    const requestUrl = this.normalizeApiUrl(this.config.apiUrl);
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiToken}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI API 错误 (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    return {
      content,
      model: data.model,
      usage: data.usage,
      finishReason: data.choices?.[0]?.finish_reason,
    };
  }

  normalizeApiUrl(apiUrl) {
    if (!apiUrl) {
      return 'https://model-router.meitu.com/v1/chat/completions';
    }

    const trimmed = apiUrl.replace(/\/+$/u, '');
    if (trimmed.endsWith('/v1')) {
      return `${trimmed}/chat/completions`;
    }

    return trimmed;
  }

  /**
   * 构建系统提示词
   */
  buildSystemPrompt(currentUrl, pageContext) {
    const baseUrl = currentUrl ? new URL(currentUrl).hostname : 'unknown';
    
    return `你是我的 AI 浏览器助手，可以帮我执行各种网页操作任务。

## 当前环境
- 网站: ${baseUrl}
- URL: ${currentUrl || 'N/A'}
${pageContext ? `- 页面上下文: ${JSON.stringify(pageContext, null, 2)}` : ''}

## 可用操作
1. **navigate** - 导航到指定 URL
2. **click** - 点击页面元素（使用 CSS 选择器）
3. **type** - 在输入框中输入文本
4. **select** - 选择下拉选项
5. **wait** - 等待指定时间（毫秒）
6. **getText** - 获取元素的文本内容
7. **getTable** - 获取表格数据
8. **scroll** - 滚动页面（up/down/top/bottom）
9. **back** - 浏览器后退
10. **forward** - 浏览器前进
11. **refresh** - 刷新页面

## 响应格式
必须返回纯 JSON，格式如下：
{
  "type": "操作类型",
  "target": "目标选择器或值",
  "value": "可选的输入值",
  "thinking": "你的思考过程（简短）",
  "done": "任务是否完成",
  "result": "最终结果（done=true 时必填）"
}

## 重要规则
1. 尽可能减少步骤数量，能一步完成的不要分多步
2. 如果页面已经是预期状态，直接获取结果
3. 选择器要尽量精确，避免选择错误的元素
4. 遇到错误时，尝试恢复或给出明确的错误信息
5. 不要执行危险操作（如删除、提交重要表单），除非用户明确要求

## 示例
用户: "帮我搜索 Google"
返回: {"type": "navigate", "target": "https://www.google.com", "thinking": "导航到 Google", "done": false}`;
  }
}

// 创建全局单例
export const aiClient = new AIClient();
