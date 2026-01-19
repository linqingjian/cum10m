# 🤖 数仓小助手 Chrome 扩展

AI 驱动的浏览器自动化工具，使用你自己的大模型 token 操控神舟大数据平台。

## ✨ 功能

- 🔍 **智能页面分析** - AI 自动分析当前页面内容
- 🎯 **自动化操作** - 点击、输入、导航等浏览器操作
- 📊 **数据查询** - 在神舟临时查询页面执行 SQL
- 📤 **结果推送** - 将结果发送到企业微信群

## 📦 安装方法

### 步骤 1: 打开 Chrome 扩展管理

1. 在 Chrome 地址栏输入: `chrome://extensions/`
2. 或者点击右上角 `⋮` → 扩展程序 → 管理扩展程序

### 步骤 2: 开启开发者模式

点击右上角的 **"开发者模式"** 开关

### 步骤 3: 加载扩展

1. 点击 **"加载已解压的扩展程序"**
2. 选择 `chrome-extension` 文件夹
3. 扩展会出现在扩展列表中

> ⚠️ 说明：开发者模式加载（unpacked）无法自动更新。若需要一键更新，请使用下方的「自托管 CRX 更新」方式安装。

## 🔄 手动更新（unpacked 模式）

```bash
cd /Users/lqj/cum10m
./scripts/update-unpacked.sh
```

脚本会执行 `git pull`，并自动打开 `chrome://extensions/`。随后手动点击“重新加载”。

### 步骤 4: 固定扩展

1. 点击 Chrome 工具栏的拼图图标 🧩
2. 找到 "数仓小助手"
3. 点击图钉 📌 固定到工具栏

## 🚀 使用方法

### 基本使用

1. 打开神舟平台页面 (https://shenzhou.tatstm.com)
2. 点击工具栏的 🤖 图标打开扩展
3. 输入你的任务，例如：
   - "查询 stat_aigc.mpub_odz_aigc_outer_cost 表今天的 cost 总和"
   - "查看当前页面的表结构"
   - "获取查询结果并发送到群"
4. 点击 **执行** 按钮
5. AI 会自动分析页面并执行操作
6. 完成后点击 **发到群** 发送结果到企业微信

### 快捷按钮

- 📊 **查成本** - 快速查询成本数据
- 📋 **看表结构** - 查看当前表的字段结构
- 📥 **获取结果** - 获取页面上的查询结果

### 配置

点击 ⚙️ 配置 展开配置区域：
- **API Token**: 你的 model-router token
- **模型**: 选择 AI 模型 (GPT-5, GPT-4o, DeepSeek-V3 等)
- **Webhook URL**: 企业微信群机器人的 webhook 地址

## 🛠 技术架构

```
Chrome 扩展
├── manifest.json    # 扩展配置
├── popup.html/js    # 弹出界面
├── content.js       # 页面注入脚本
├── background.js    # 后台服务
└── icons/           # 图标资源
```

### 工作流程

```
用户输入任务
    ↓
获取当前页面快照 (DOM, URL, 可交互元素)
    ↓
发送给 AI 分析
    ↓
AI 返回操作指令 (JSON)
    ↓
扩展执行操作
    ↓
循环直到任务完成
    ↓
发送结果到企业微信群
```

## ⚠️ 注意事项

1. **权限**: 扩展需要访问神舟平台和 model-router API
2. **API Token**: 请妥善保管你的 token，不要分享给他人
3. **网络**: 需要能访问内网 (model-router.meitu.com)
4. **浏览器**: 仅支持 Chrome/Edge 等 Chromium 内核浏览器

## 🔧 故障排除

### 扩展无法加载
- 确保开启了开发者模式
- 检查 manifest.json 是否有语法错误

### AI 调用失败
- 检查 API Token 是否正确
- 检查网络是否能访问 model-router.meitu.com

### 页面操作失败
- 确保当前页面是神舟平台
- 尝试刷新页面后重试
- 检查控制台是否有错误信息

## 📝 更新日志

### v1.0.0 (2026-01-13)
- 初始版本
- 支持页面分析、自动化操作
- 支持 SQL 执行和结果获取
- 支持发送结果到企业微信群

## ♻️ 自托管 CRX 更新（GitHub Pages）

使用自托管 CRX 时，Chrome 会自动检查更新（需通过 CRX 安装）。

### 1) 生成 CRX 与 update_manifest

```bash
cd /Users/lqj/cum10m

# 第一次会生成 keys/extension.pem（请妥善保存，勿提交）
./scripts/publish-extension.sh
```

产物会生成到：
- `docs/extension/ai-assistant.crx`
- `docs/extension/update_manifest.xml`

### 2) 配置 GitHub Pages

在 GitHub 仓库设置中启用 Pages：
- Source: `main` 分支
- Folder: `/docs`

对应访问地址（默认）：
- `https://linqingjian.github.io/cum10m/extension/update_manifest.xml`
- `https://linqingjian.github.io/cum10m/extension/ai-assistant.crx`

### 3) 安装 CRX（一次性）

从上述 CRX 链接下载并安装。之后 Chrome 会按 `manifest.json` 的 `update_url` 自动更新。

### 4) 发布新版本

每次更新代码后：

```bash
./scripts/publish-extension.sh
git add docs/extension/ai-assistant.crx docs/extension/update_manifest.xml
git commit -m "发布扩展更新"
git push origin main
```

### 关键说明

- **扩展 ID 由私钥决定**，请务必保留 `keys/extension.pem`
- 如果更换私钥，扩展 ID 会变化，需要重新安装

---

Made with ❤️ by 数仓团队
