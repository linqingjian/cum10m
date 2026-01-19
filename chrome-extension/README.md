# AI Browser Assistant - 通用浏览器 AI 助手 (v2.0)

## ✨ 特性

- 🌐 **通用化设计**：支持任意网页的自动化操作，不再局限于特定平台
- 🤖 **AI 驱动**：基于大语言模型的智能决策和任务执行
- 🔄 **多轮对话**：支持持续的上下文对话，完成复杂任务
- 📝 **Skills 架构**：模块化的技能配置，方便扩展和自定义
- 🛡️ **安全设计**：配置存储在本地，不在代码中硬编码敏感信息
- 🧪 **本地测试**：完整的测试工具和页面，无需反复手动刷新扩展

## 🏗️ 架构

### 核心组件

```
chrome-extension/
├── manifest.json              # 扩展配置
├── background.js               # Service Worker（任务执行核心）
├── content.js                  # Content Script（页面注入）
├── popup.html                  # 侧边栏界面
├── popup.js                    # 侧边栏逻辑
├── options.html                # 设置页面
├── options.js                  # 设置逻辑
│
├── core/                       # 核心模块
│   ├── logger.js              # 日志管理
│   ├── storage.js             # 存储管理
│   ├── ai-client.js           # AI 客户端
│   └── action-executor.js     # 动作执行器
│
├── utils/                      # 工具模块
│   └── skills-loader.js       # Skills 加载器
│
├── skills/                     # Skills 配置
│   └── config.js              # 技能定义和平台适配
│
├── test.html                   # 测试页面
├── run-tests.sh               # 测试脚本
├── launch-test.sh             # 快速启动测试
└── reload.sh                  # 扩展重载脚本
```

### 工作流程

1. **用户输入**: 侧边栏或页面 UI 接收用户任务
2. **AI 决策**: Background 调用 AI 获取下一步操作
3. **动作执行**: ActionExecutor 执行具体操作（点击、输入、导航等）
4. **上下文更新**: 将执行结果反馈给 AI
5. **循环判断**: 重复步骤 2-4 直到任务完成
6. **结果返回**: 将最终结果展示给用户

## 📦 安装

### 前置条件
- Chrome 浏览器（或兼容的 Chromium 浏览器）
- AI 模型的 API Token

### 安装步骤

1. **加载扩展**
   ```bash
   # 打开 Chrome
   open -a "Google Chrome" "chrome://extensions/"

   # 或直接访问
   open "chrome://extensions/"

   # 开启开发者模式，然后点击「加载已解压的扩展程序」
   # 选择 /Users/lqj/cum10m/chrome-extension 目录
   ```

2. **配置 API**
   - 扩展加载后会自动打开设置页面
   - 填写 API URL、API Token 和模型名称
   - 点击「保存配置」和「测试连接」

3. **开始使用**
   - 在任意网页点击扩展图标打开侧边栏
   - 输入任务描述即可开始

## 🎯 使用示例

### 基础操作

```
# 导航
"导航到 Google"

# 填写表单
"在搜索框输入 'Hello AI'"

# 点击元素
"点击搜索按钮"

# 提取信息
"获取页面上的所有表格"
"提取页面的标题"

# 滚动页面
"滚动到页面底部"
```

### 复杂任务

```
# 多步骤任务（多轮对话）
"帮我登录 Google，然后搜索 'AI Assistant'"

# 信息汇总
"分析这个页面的主要内容，提取关键信息"
```

## ⚙️ 配置

### Settings (options.html)

**必填项：**
- **API URL**: AI 模型 API 地址
- **API Token**: 访问令牌
- **模型名称**: 如 gpt-4o, gpt-3.5-turbo

**可选项：**
- **Webhook URL**: 企业微信 webhook（用于通知）
- **最大步骤数**: 限制每个任务的执行步骤（默认 15）
- **日志级别**: Debug / Info / Warn / Error

### Skills 配置 (skills/config.js)

支持自定义技能和平台适配规则：

```javascript
{
  id: 'navigation',
  name: '页面导航',
  description: '导航到指定 URL',
  actions: ['navigate', 'back', 'forward', 'refresh']
}
```

添加新技能后重启扩展生效。

## 🧪 测试

### 快速测试

```bash
# 打开测试页面
cd /Users/lqj/cum10m/chrome-extension
./launch-test.sh
```

### 完整测试

```bash
# 检查文件结构
./run-tests.sh check

# 查看测试指南
cat TEST_GUIDE.md
```

### 测试场景

1. **导航测试**: 打开任意网页，命令导航到目标 URL
2. **交互测试**: 使用测试页面的按钮、输入框、下拉框
3. **提取测试**: 获取表格、文本、链接等内容
4. **多轮对话**: 连续执行多个相关任务
5. **错误恢复**: 模拟错误场景，验证恢复能力

详见 [TEST_GUIDE.md](./TEST_GUIDE.md)

## 🔧 开发

### 调试

**Background 调试：**
1. 访问 `chrome://extensions/`
2. 找到「AI Browser Assistant」
3. 点击「查看视图：background page」
4. 在 Console 中查看日志

**Content Script 调试：**
1. 在目标页面右键 > 检查
2. 查看 Console

### 文件结构

```
core/
├── logger.js          # 日志系统（支持实时日志、历史记录）
├── storage.js         # Chrome Storage Local 封装
├── ai-client.js       # AI 模型调用（流式/非流式）
└── action-executor.js # 浏览器操作统一封装

utils/
└── skills-loader.js   # 动态加载 Skills 配置
```

### 重新加载扩展

```bash
./reload.sh
```
或手动在 `chrome://extensions/` 中点击刷新。

## 🔄 从旧版本升级

### 主要变更

1. **去神舟化**：平台无关设计，支持任意网站
2. **模块化**：拆分大文件为独立模块
3. **安全化**：配置外部化，不再硬编码 Token
4. **测试化**：添加完整的测试工具

### 迁移步骤

1. 备份现有扩展（已自动备份到 `chrome-extension.backup.*`）
2. 安装新版本
3. 重新配置 API Token（新版本存储在 Chrome Storage）
4. 自定义 Skills 配置（如需要）

## 📝 技术栈

- **前端**：Vanilla JavaScript (ES6+)
- **HTML/CSS**：原生无框架
- **扩展 API**：Chrome Extension Manifest V3
- **存储**：Chrome Storage Local
- **测试**：自定义测试工具

## 🐛 问题排查

### 常见问题

**Q: 扩展无法加载**
- 检查文件结构: `./run-tests.sh check`
- 检查 Manifest JSON 语法
- 查看 Chrome Extensions 页面的错误提示

**Q: API 调用失败**
- 验证 API Token 配置
- 点击设置页面的「测试连接」
- 查看 Background Console 的错误日志

**Q: 操作执行失败**
- 检查选择器是否正确
- 尝试用测试页面验证
- 查看 Content Script Console 的错误信息

**Q: 扩展图标不显示**
- 检查是否在 Manifest V3 兼容的 Chrome 版本
- 尝试在 `chrome://extensions/` 中启用/禁用

## 📄 License

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📮 联系方式

- GitHub Issues
- Email: [待填写]

---

**当前版本**: v2.0.0  
**最后更新**: 2025-01-15
