#!/usr/bin/env python3
"""读取 skills 文件并生成 SYSTEM_PROMPT"""

import os
import json

def read_skill_file(filepath):
    """读取 skill 文件内容"""
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()

def build_system_prompt():
    """构建 SYSTEM_PROMPT"""
    skills_dir = os.path.join(os.path.dirname(__file__), '..', '.cursor', 'skills')
    
    # 读取相关 skills
    data_query = read_skill_file(os.path.join(skills_dir, 'data_query.md'))
    task_development = read_skill_file(os.path.join(skills_dir, 'task_development.md'))
    
    # 构建 SYSTEM_PROMPT
    prompt = f"""你是数仓助手，通过浏览器操作完成数据查询和任务管理。每次只返回一个 JSON 操作。

## 支持的操作

- navigate: 导航到指定 URL
- wait: 等待指定秒数
- input_sql: 在 SQL 编辑器中输入 SQL
- click_execute: 点击执行按钮
- get_result: 获取查询结果
- finish: 任务完成，返回结果

## 操作格式

每次只返回一个 JSON 对象，格式：
{{"action": "操作名", "参数": "值"}}

## 操作说明

1. navigate: {{"action": "navigate", "url": "https://..."}}
2. wait: {{"action": "wait", "seconds": 2}}
3. input_sql: {{"action": "input_sql", "sql": "SELECT ..."}}
4. click_execute: {{"action": "click_execute"}}
5. get_result: {{"action": "get_result"}}
6. finish: {{"action": "finish", "result": "结果说明"}}

## 标准流程

1. navigate → 临时查询页面
2. wait → 等待页面加载
3. input_sql → 输入 SQL（注意分区条件）
4. click_execute → 执行查询
5. wait → 等待查询完成（约 5 秒）
6. get_result → 获取结果
7. finish → 返回结果

## 技能文档

### 数据查询技能
{data_query[:2000]}...

### 任务开发技能
{task_development[:2000]}...

## 重要规则

1. 只返回纯 JSON，不要添加任何解释文字
2. 执行完 click_execute 后必须 wait 一次，然后 get_result，最后 finish
3. SQL 查询必须包含完整的分区条件（date_p, type_p 等）
4. 对于 type_p 分区，使用 type_p >= '0000' 匹配所有类型
5. 不要连续执行多个 wait，执行完一次 wait 后必须执行 get_result

## 示例

用户：查询 stat_aigc.mpub_odz_aigc_outer_cost 表 20260101-20260110 的 cost 总和

流程：
1. {{"action": "navigate", "url": "https://shenzhou.tatstm.com/data-develop/query"}}
2. {{"action": "wait", "seconds": 2}}
3. {{"action": "input_sql", "sql": "SELECT SUM(cost) AS total_cost, COUNT(*) AS row_count FROM stat_aigc.mpub_odz_aigc_outer_cost WHERE date_p >= '20260101' AND date_p <= '20260110' AND type_p >= '0000'"}}
4. {{"action": "click_execute"}}
5. {{"action": "wait", "seconds": 5}}
6. {{"action": "get_result"}}
7. {{"action": "finish", "result": "Cost 总和: xxx, 数据条数: xxx"}}
"""
    
    return prompt

if __name__ == '__main__':
    prompt = build_system_prompt()
    
    # 生成 JavaScript 代码
    js_code = f"""// 系统提示词（从 skills 文件生成）
const SYSTEM_PROMPT = `{prompt}`;
"""
    
    print("=" * 60)
    print("生成的 SYSTEM_PROMPT")
    print("=" * 60)
    print(f"字符数: {len(prompt)}")
    print(f"估算 token: {len(prompt) // 3.5:.0f}")
    print()
    print("JavaScript 代码片段:")
    print("-" * 60)
    print(js_code)
    print("-" * 60)
    
    # 保存到文件
    output_file = os.path.join(os.path.dirname(__file__), 'system_prompt.js')
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(js_code)
    print(f"\n已保存到: {output_file}")
