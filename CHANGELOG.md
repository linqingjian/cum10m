# 更新日志

## 通用化改进（最新）

### 问题
原代码中硬编码了多个字段名，导致脚本不够通用：
- `order_id`, `uid`, `req_time`, `cost` - 硬编码为指标列
- `req_num`, `user_num` - 硬编码为输出列名
- 无法支持其他字段名的指标

### 解决方案
1. **动态识别指标列**：从SQL注释中解析所有带有 `distinct` 或 `sum` 注释的字段作为指标列
2. **动态识别维度列**：排除指标列和时间列后的所有字段作为维度列
3. **支持输出列名映射**：通过SQL注释指定输出列名
   - 格式：`-- distinct_output_name` 或 `-- distinct:output_name`
   - 例如：`order_id -- distinct_req_num` 表示order_id去重计数后输出为req_num
4. **移除所有硬编码**：不再依赖特定的字段名

### 使用示例

#### 示例1：使用默认输出列名
```sql
SELECT
  cost_type,        -- 维度
  order_id,         -- 指标 distinct_order_id (输出为order_id)
  uid,              -- 指标 distinct_uid (输出为uid)
  req_time,         -- 指标 sum (输出为req_time)
  cost              -- 指标 sum (输出为cost)
FROM ...
```

#### 示例2：自定义输出列名
```sql
SELECT
  cost_type,        -- 维度
  order_id,         -- 指标 distinct_req_num (输出为req_num)
  uid,              -- 指标 distinct_user_num (输出为user_num)
  req_time,         -- 指标 sum (输出为req_time)
  cost              -- 指标 sum (输出为cost)
FROM ...
```

#### 示例3：完全自定义的字段
```sql
SELECT
  region,           -- 维度
  product_id,       -- 指标 distinct_product_count (输出为product_count)
  user_id,          -- 指标 distinct_user_count (输出为user_count)
  revenue,          -- 指标 sum (输出为revenue)
  quantity          -- 指标 sum (输出为quantity)
FROM ...
```

### 改进点
1. ✅ 完全通用化，支持任意字段名
2. ✅ 支持自定义输出列名
3. ✅ 自动识别指标列和维度列
4. ✅ 保持向后兼容（如果SQL注释格式不变，行为一致）

