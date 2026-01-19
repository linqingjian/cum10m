# 新增功能说明

## 📋 新增功能列表

### 1. 任务重跑功能 ✅

**功能描述**：支持在任务实例页面重跑失败的任务

**操作**：`click_rerun`

**参数**：
- `rerun_type`: 重跑类型
  - `"latest"`: 以任务最新内容重跑（默认）
  - `"instance"`: 以实例运行记录重跑

**使用示例**：
```json
{"action": "click_rerun", "rerun_type": "latest"}
```

**操作流程**：
1. 导航到任务实例页面
2. 找到失败的实例
3. 点击"重跑"按钮
4. 选择重跑方式（最新内容或实例记录）
5. 确认重跑

---

### 2. DAG 查看功能 ✅

**功能描述**：查看任务的 DAG（有向无环图）依赖关系

**操作**：
- `click_dag_view`: 点击可视化/DAG 按钮
- `get_dag_info`: 获取 DAG 图信息

**使用示例**：
```json
// 步骤1: 点击 DAG 按钮
{"action": "click_dag_view"}

// 步骤2: 获取 DAG 信息
{"action": "get_dag_info"}
```

**返回信息**：
- 节点列表（节点名称、ID）
- 依赖关系（边的数量）
- DAG 图类型（SVG、HTML、Canvas）

**操作流程**：
1. 导航到任务列表或任务开发页面
2. 点击"可视化"或"DAG"按钮
3. 等待 DAG 图加载
4. 获取节点和依赖关系信息

---

### 3. Confluence 功能 ✅

**功能描述**：搜索和获取 Confluence 页面内容

#### 3.1 搜索页面

**操作**：`confluence_search`

**参数**：
- `query`: 搜索关键词

**使用示例**：
```json
{"action": "confluence_search", "query": "数仓小助手"}
```

**返回信息**：
- 搜索结果列表（页面 ID、标题、URL）
- 结果数量

#### 3.2 获取页面内容

**操作**：`confluence_get_content`

**参数**：
- `page_id`: Confluence 页面 ID

**使用示例**：
```json
{"action": "confluence_get_content", "page_id": "529775023"}
```

**返回信息**：
- 页面标题
- 页面内容（文本格式）
- 页面 URL

**注意**：
- Confluence API 需要认证，当前使用 Bearer Token
- 如果认证失败，需要配置正确的 Confluence API Token
- Confluence API 地址：`https://cf.meitu.com/rest/api/`

---

## 🔧 配置说明

### Confluence API 配置

如果需要使用 Confluence 功能，需要在 `background.js` 中配置正确的 API Token：

```javascript
// 在 background.js 顶部添加
const CONFLUENCE_API_TOKEN = 'your_confluence_api_token_here';
```

然后在 `confluence_search` 和 `confluence_get_content` 操作中使用：

```javascript
headers: {
  'Authorization': `Bearer ${CONFLUENCE_API_TOKEN}`,
  'Content-Type': 'application/json'
}
```

---

## 📝 使用示例

### 示例1：重跑失败任务

**用户请求**：重跑昨天失败的 LLM日志数据清洗_天级别数据 任务

**操作序列**：
```json
1. {"action": "navigate", "url": "https://shenzhou.tatstm.com/data-develop/instances"}
2. {"action": "wait", "seconds": 2}
3. {"action": "type", "target": "搜索框选择器", "value": "LLM日志数据清洗_天级别数据"}
4. {"action": "click", "target": "搜索结果"}
5. {"action": "click_rerun", "rerun_type": "latest"}
6. {"action": "wait", "seconds": 1}
7. {"action": "click", "target": "确定"}
8. {"action": "finish", "result": "任务重跑已提交"}
```

### 示例2：查看任务 DAG

**用户请求**：查看 LLM日志数据清洗_天级别数据 任务的 DAG 图

**操作序列**：
```json
1. {"action": "navigate", "url": "https://shenzhou.tatstm.com/data-develop/tasks"}
2. {"action": "wait", "seconds": 2}
3. {"action": "type", "target": "搜索框选择器", "value": "LLM日志数据清洗_天级别数据"}
4. {"action": "click", "target": "可视化"}
5. {"action": "wait", "seconds": 2}
6. {"action": "get_dag_info"}
7. {"action": "finish", "result": "DAG 图包含 X 个节点，Y 条依赖关系"}
```

### 示例3：搜索 Confluence 页面

**用户请求**：搜索 Confluence 中关于"数仓小助手"的页面

**操作序列**：
```json
1. {"action": "confluence_search", "query": "数仓小助手"}
2. {"action": "finish", "result": "找到 X 个页面：[页面列表]"}
```

### 示例4：获取 Confluence 页面内容

**用户请求**：获取 Confluence 页面 529775023 的内容

**操作序列**：
```json
1. {"action": "confluence_get_content", "page_id": "529775023"}
2. {"action": "finish", "result": "页面标题：XXX，内容：XXX"}
```

---

## ⚠️ 注意事项

1. **任务重跑**：
   - 需要先找到失败的实例
   - 重跑操作会触发任务重新执行
   - 建议先查看运行日志确认失败原因

2. **DAG 查看**：
   - DAG 图可能需要时间加载
   - 不同类型的 DAG 图（SVG、Canvas、HTML）提取方式不同
   - 如果无法提取，可以尝试截图方式

3. **Confluence 功能**：
   - 需要配置正确的 API Token
   - API 调用需要网络访问权限
   - 搜索结果可能受权限限制

---

## 🚀 后续优化

1. **任务重跑**：
   - 支持批量重跑
   - 支持重跑下游节点
   - 支持重跑选项配置

2. **DAG 查看**：
   - 支持 DAG 图截图
   - 支持节点详情查看
   - 支持依赖路径分析

3. **Confluence 功能**：
   - 支持页面编辑
   - 支持评论添加
   - 支持页面创建

---

Made with ❤️ by 数仓团队
