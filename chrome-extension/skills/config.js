/**
 * Skills Configuration - 数仓小助手技能配置
 *
 * 这个文件定义了 AI 助手的所有可用技能和能力
 * 用户可以通过修改此文件来扩展或调整助手的 behavior
 *
 * Skills 格式说明：
 * - id: 唯一标识符
 * - name: 技能名称（显示给用户）
 * - description: 技能描述（用于 AI 理解能做什么）
 * - category: 分类（如 data, navigation, analysis 等）
 * - priority: 优先级（数字越大优先级越高）
 * - enabled: 是否启用
 * - actions: 支持的操作类型
 */

export const SKILLS_CONFIG = {
  // ========== 数据查询技能 ==========
  dataQuery: {
    id: 'dataQuery',
    name: '数据查询',
    description: '执行 SQL 查询，获取数据统计和分析结果',
    category: 'data',
    priority: 100,
    enabled: true,
    actions: ['sqlExecute', 'sqlValidate', 'sqlFormat'],
    templates: {
      queryBasic: `SELECT
  SUM(cost) AS total_cost,
  COUNT(*) AS row_count
FROM
  {{database}}.{{table}}
WHERE
  {{whereClause}}`,
    }
  },

  // ========== 页面导航技能 ==========
  navigation: {
    id: 'navigation',
    name: '页面导航',
    description: '在浏览器中导航到指定 URL 或页面元素',
    category: 'navigation',
    priority: 90,
    enabled: true,
    actions: ['navigate', 'goBack', 'goForward', 'refresh'],
  },

  // ========== 页面操作技能 ==========
  pageInteraction: {
    id: 'pageInteraction',
    name: '页面交互',
    description: '与页面元素进行交互：点击、输入、选择等',
    category: 'interaction',
    priority: 85,
    enabled: true,
    actions: ['click', 'type', 'select', 'scroll', 'hover'],
  },

  // ========== 信息提取技能 ==========
  informationExtraction: {
    id: 'informationExtraction',
    name: '信息提取',
    description: '从页面提取信息：文本、表格、链接、图片等',
    category: 'analysis',
    priority: 80,
    enabled: true,
    actions: ['getText', 'getTable', 'getLinks', 'getImages', 'getFormValues'],
  },

  // ========== 表单操作技能 ==========
  formInteraction: {
    id: 'formInteraction',
    name: '表单操作',
    description: '填写和提交网页表单',
    category: 'interaction',
    priority: 75,
    enabled: true,
    actions: ['fillForm', 'submitForm', 'clearForm', 'getFormFields'],
  },

  // ========== 等待和检测技能 ==========
  waitAndDetect: {
    id: 'waitAndDetect',
    name: '等待与检测',
    description: '等待特定条件或检测元素状态',
    category: 'utility',
    priority: 70,
    enabled: true,
    actions: ['waitForElement', 'waitForCondition', 'checkExists', 'checkVisible'],
  },

  // ========== 截图技能 ==========
  screenshot: {
    id: 'screenshot',
    name: '截图',
    description: '截取页面截图用于分析或保存',
    category: 'utility',
    priority: 65,
    enabled: true,
    actions: ['captureFullPage', 'captureViewport', 'captureElement'],
  },

  // ========== 搜索技能 ==========
  search: {
    id: 'search',
    name: '搜索',
    description: '在当前页面或搜索引擎进行搜索',
    category: 'analysis',
    priority: 60,
    enabled: true,
    actions: ['searchInPage', 'webSearch'],
  },

  // ========== 下载技能 ==========
  download: {
    id: 'download',
    name: '下载',
    description: '下载文件或保存页面内容',
    category: 'utility',
    priority: 55,
    enabled: true,
    actions: ['downloadFile', 'saveAs', 'exportData'],
  },
};

// ========== 平台特定配置 ==========
// 这些配置可以为不同平台（如神舟、GitHub、GitLab 等）提供特定规则
export const PLATFORM_CONFIGS = {
  generic: {
    name: '通用',
    description: '适用于大多数网页',
    patterns: ['*'],
    rules: {
      // 通用元素的定位策略
      selectors: {
        button: 'button, [role="button"], .btn, input[type="submit"]',
        input: 'input, textarea, select',
        link: 'a, [href]',
        table: 'table, .table',
      },
      // 等待超时配置
      timeouts: {
        default: 5000,
        navigate: 3000,
        click: 1000,
      }
    }
  },

  shenzhou: {
    name: '神舟大数据平台',
    description: '神舟数据平台特定配置',
    patterns: ['shenzhou.tatstm.com'],
    rules: {
      selectors: {
        sqlEditor: '.CodeMirror, .ace_editor',
        runButton: '执行, 运行',
        resultTable: '.ant-table, .result-table',
      },
      sqlRules: {
        partitionFormat: 'yyyyMMdd',
        mustIncludeTypeP: true,
      },
      urls: {
        query: '/data-develop/query',
        tables: '/data-manage/tables',
        taskList: '/data-develop/tasks',
      }
    }
  },

  github: {
    name: 'GitHub',
    description: 'GitHub 平台特定配置',
    patterns: ['github.com'],
    rules: {
      selectors: {
        commitButton: 'button[type="submit"].btn-primary',
        fileEditor: '.CodeMirror',
      }
    }
  },

  gitlab: {
    name: 'GitLab',
    description: 'GitLab 平台特定配置',
    patterns: ['gitlab.com'],
    rules: {
      selectors: {
        commitButton: 'button[type="submit"].gl-button',
      }
    }
  },
};

// ========== AI 行为配置 ==========
export const AI_BEHAVIOR_CONFIG = {
  // 最大循环步骤数，防止无限循环
  maxSteps: 15,

  // 超时时间（毫秒）
  timeouts: {
    elementWait: 10000,
    pageLoad: 30000,
    aiResponse: 60000,
  },

  // 重试配置
  retry: {
    maxAttempts: 3,
    delay: 1000,
  },

  // 日志级别
  logLevel: 'info', // debug, info, warn, error

  // 思考模式
  thinkingMode: {
    enabled: true,
    showToUser: false, // 是否向用户展示 AI 的思考过程
  },

  // 安全限制
  safety: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxUrlLength: 2000,
    allowedDomains: ['*'], // 允许访问的域名，'*' 表示全部
  },
};

// ========== 导出辅助函数 ==========

/**
 * 获取启用的技能列表
 */
export function getEnabledSkills() {
  return Object.values(SKILLS_CONFIG).filter(skill => skill.enabled);
}

/**
 * 根据技能 ID 获取技能
 */
export function getSkillById(id) {
  return Object.values(SKILLS_CONFIG).find(skill => skill.id === id);
}

/**
 * 根据分类获取技能
 */
export function getSkillsByCategory(category) {
  return Object.values(SKILLS_CONFIG).filter(skill =>
    skill.category === category && skill.enabled
  );
}

/**
 * 获取当前页面的平台配置
 */
export function getPlatformConfig(url) {
  for (const [key, config] of Object.entries(PLATFORM_CONFIGS)) {
    if (key === 'generic') continue;
    for (const pattern of config.patterns) {
      if (url.includes(pattern)) {
        return config;
      }
    }
  }
  return PLATFORM_CONFIGS.generic;
}

/**
 * 构建 AI 系统提示词（基于 Skills 配置动态生成）
 */
export function buildSystemPrompt(platform = 'generic', customSkills = []) {
  const skills = customSkills.length > 0 ? customSkills : getEnabledSkills();
  const platformConfig = getPlatformConfig(platform === 'generic' ? '' : platform);

  const skillsText = skills.map(skill =>
    `- ${skill.name}: ${skill.description}`
  ).join('\n');

  const platformText = platformConfig.id !== 'generic'
    ? `\n\n## 当前平台: ${platformConfig.name}\n${platformConfig.description}`
    : '';

  return `你是我的 AI 浏览器助手，可以帮我执行各种网页操作任务。

## 可用技能
${skillsText}
${platformText}

## 操作规则
1. 返回 JSON 格式，格式如下：
{
  "action": "操作类型",
  "target": "目标选择器或值",
  "value": "可选的输入值",
  "thinking": "你的思考过程（简短描述）",
  "done": "任务是否完成",
  "result": "最终结果（done=true 时必填）"
}

2. 支持的操作类型：
   - navigate: 导航到 URL
   - click: 点击元素
   - type: 输入文本
   - wait: 等待时间（毫秒）
   - getText: 获取文本
   - getTable: 获取表格
   - screenshot: 截图
   - done: 任务完成

3. 重要提醒：
   - 尽可能减少步骤数量
   - 能一步完成的不要分多步
   - 如果页面已经是预期状态，直接获取结果
   - 遇到错误时，尝试恢复或给出明确的错误信息

4. 示例：
用户: "帮我搜索 Google"
{"action": "navigate", "target": "https://www.google.com", "thinking": "导航到 Google", "done": false}
{"action": "type", "target": "input[name='q']", "value": "测试搜索", "thinking": "输入搜索词", "done": false}
{"action": "click", "target": "input[type='submit']", "thinking": "点击搜索", "done": false}
{"action": "wait", "target": "2000", "thinking": "等待结果加载", "done": false}
{"action": "getText", "target": ".search-results", "thinking": "获取搜索结果", "done": true, "result": "搜索结果已获取"}`;
}
