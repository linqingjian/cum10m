/**
 * Skills Loader - Skills 加载器
 *
 * 从文件系统加载技能配置
 */

// 这里可以扩展为从 skills/ 目录动态加载
export const DEFAULT_SKILLS = [
  {
    id: 'navigation',
    name: '页面导航',
    description: '导航到指定 URL 或页面',
    category: 'navigation',
    actions: ['navigate', 'back', 'forward', 'refresh'],
  },
  {
    id: 'interaction',
    name: '页面交互',
    description: '与页面元素交互：点击、输入、选择等',
    category: 'interaction',
    actions: ['click', 'type', 'select', 'hover'],
  },
  {
    id: 'extraction',
    name: '信息提取',
    description: '从页面提取信息：文本、表格等',
    category: 'analysis',
    actions: ['getText', 'getTable', 'getLinks'],
  },
  {
    id: 'utility',
    name: '实用工具',
    description: '等待、滚动、截图等实用功能',
    category: 'utility',
    actions: ['wait', 'scroll', 'screenshot'],
  },
];

/**
 * 加载启用的技能
 */
export function loadEnabledSkills() {
  return DEFAULT_SKILLS.filter(skill => skill.enabled !== false);
}

/**
 * 根据 ID 获取技能
 */
export function getSkillById(id) {
  return DEFAULT_SKILLS.find(skill => skill.id === id);
}

/**
 * 动态加载 skills/ 目录下的技能文件
 * （预留扩展接口）
 */
export async function loadSkillsFromFiles() {
  // 未来可以从 skills/ 目录加载 .md 或 .json 文件
  return DEFAULT_SKILLS;
}

/**
 * 构建技能提示词
 */
export function buildSkillsPrompt() {
  const skills = loadEnabledSkills();
  return skills.map(skill => 
    `- ${skill.name}: ${skill.description}\n  操作: ${skill.actions.join(', ')}`
  ).join('\n');
}
