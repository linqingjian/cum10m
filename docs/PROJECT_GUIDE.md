# 项目记忆 / 操作手册

此文档用于保存本项目的关键信息与操作方式，便于下次打开项目快速上手。

## 项目路径
- 本地根目录：`/Users/lqj/cum10m`
- 扩展代码：`/Users/lqj/cum10m/chrome-extension`
- GitHub：`https://github.com/linqingjian/cum10m/tree/main/chrome-extension`

## 如何更新与发布（团队使用）
- 拉取最新代码：`git pull`
- Chrome 重新加载：`chrome://extensions/` → “重新加载扩展”

配置页/侧边栏均提供“下载最新 chrome-extension”按钮：
- 下载后解压，进入 `cum10m-main/chrome-extension/`，再“加载已解压”。

## 默认配置（当前约定）
- API URL 默认：`https://model-router.meitu.com/v1`
- 模型：默认 `gpt-5.2`，若不可用自动回退 `gpt-5.2-chat`
- 主题：默认浅色（Gemini 风格）

## 关键功能
- 侧边栏固定：点击“📌 固定右侧”
- 自动同步页面：勾选“同步页面”或手动“刷新页面”
- 自动截图：模型需要时自动触发
- 删除拦截：仅拦截“删除表/任务/节点”
- 历史会话：左侧会话列表
- 代码块复制：聊天中的代码块支持一键复制
- Skills 管理：在“Skills 管理”添加与 @skill 使用

## Confluence
- 功能文档：
  https://cf.meitu.com/confluence/pages/viewpage.action?pageId=662858433

## 常见报错处理
- unknown_model: gpt-5.2
  → 自动回退 gpt-5.2-chat；如需 gpt-5.2 请让 model-router 开通

- max_tokens 不支持
  → 已自动切换 max_completion_tokens

- 截图失败提示权限
  → 确认 manifest 有 `<all_urls>` 或 `activeTab`（已配置）

## 重要入口文件
- 侧边栏/弹窗 UI：`chrome-extension/popup.html`、`chrome-extension/popup.js`
- 后台执行：`chrome-extension/background.js`
- 配置页：`chrome-extension/options.html`、`chrome-extension/options.js`

## 发布注意事项
- 每次重要更新需提交并推送到 GitHub。
