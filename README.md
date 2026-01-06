# 10分钟累计统计脚本使用说明

## 功能简介

`cum10m.py` 是一个用于从明细Excel文件生成10分钟累计统计数据的Python脚本。它能够匹配SQL的累计计算逻辑，自动处理数据聚合和累计计算。

## 安装要求

```bash
pip install pandas openpyxl
```

## 基本用法

```bash
python3 cum10m.py \
    --input <输入Excel文件路径> \
    --date_p <日期分区> \
    --start_ts <开始时间> \
    --end_ts <结束时间> \
    --input_sql <SQL文件路径> \
    [--output <输出Excel文件路径>] \
    [--output_table <数仓表名> --dw-url <连接串>]
```

## 参数说明

### 必需参数

- `--input`: 输入Excel文件路径，包含明细数据
- `--date_p`（或 `--date-p`）: 日期分区过滤值，格式：`YYYYMMDD`，例如：`20251226`
- `--start_ts`（或 `--start-ts`）: 开始时间戳（分钟级），格式：`YYYYMMDDHHmm`，例如：`202512260000`
- `--end_ts`（或 `--end-ts`）: 结束时间戳（分钟级），格式：`YYYYMMDDHHmm`，例如：`202512260100`
  - 也支持占位符格式：`--date_p '${date_p}'`（会读取环境变量 `date_p` 或 `DATE_P`）

> 注意：必须至少指定一个输出：`--output`（写Excel）或 `--dw-table`（写数仓）。

### 可选参数

- `--output`: 输出Excel文件路径，将写入累计统计结果（不填则不输出Excel）
- `--input_sql`（或 `--sql-file`）: SQL文件路径，包含SELECT字段列表（与`--sql-text`二选一）
- `--sql-text`: SQL文本字符串，包含SELECT字段列表（与`--sql-file`二选一）
- `--sql`: `--sql-text` 的别名
- `--no-cube`: 禁用CUBE聚合，不生成"整体"维度的组合
- `--output_table`（或 `--dw-table`）: 写入数仓表名，例如：`stat_aigc.cost_arz_roboneo_aigc_onecost_mina_backfill`（通用分区字段为`date_p`）
- `--engine`: 明细拉取引擎（同 `--dw-query-engine`），可选 `Presto`/`SparkSql`/`Hive`
- `--dw-url`: 数仓连接串（SQLAlchemy URL）。也可通过环境变量 `DW_URL` 提供
- `--dw-kind`: 写入方式：`auto`（有`dw-url`则走SQLAlchemy，否则走`datawork-client`）、`sqlalchemy`、`datawork-client`
- `--dw-mode`: `append` 追加；`overwrite` 按 `date_p` 分区覆盖（通过 `DELETE date_p=...` 实现）
- `--dw-chunk-size`: 写入分批大小（默认 `10000`）
- `--dw-project-name`/`--dw-ca-config-path`/`--dw-env`/`--dw-engine`/`--dw-hive-env`: `datawork-client` 执行参数（默认值参考 `online_test.py`）
- `--dw-tmp-dir`: 本地临时目录（用于 query_to_local 落地文件、Spark staging CSV、execute SQL 文件；默认环境变量 `CUM10M_TMP_DIR`，未设置则 `/data1/lqj2/cum10m`；若不可用会自动回退到 `/tmp`）
- 说明：`--dw-write-method spark` 会把 Spark 的 `spark.local.dir`/`java.io.tmpdir` 也指向该目录，避免生成大量 `/tmp/spark-*` 目录；脚本默认成功后会清理本次产生的临时文件/目录
- `--dw-keep-tmp`: 保留本次运行产生的临时文件（默认成功后删除本次产生的 `cum10m_*` 文件）
- `--dw-tmp-keep-last`: 配合 `--dw-keep-tmp` 使用，仅保留临时目录中最新 N 个 `cum10m_*` 文件（例如 `3`）
- `--dw-spark-driver-memory`: 本机 Spark 写入时的 driver 内存（默认 `4g`，用于避免大结果集写入时 JVM OOM）
- `--dw-spark-load-method`: Spark 加载 pandas 数据方式：`csv`（默认，更稳）/`pandas`（更快但大数据可能 OOM）
- `--dw-dry-run`: 仅生成CSV/SQL并打印待执行命令，不实际执行

## 使用示例

### 示例1：基本使用

```bash
python3 cum10m.py \
    --input /Users/lqj/Desktop/360度运镜.xlsx \
    --output /Users/lqj/Desktop/累计结果.xlsx \
    --date_p 20251226 \
    --start_ts 202512260000 \
    --end_ts 202512260100 \
    --input_sql /Users/lqj/Desktop/query.sql
```

### 示例2：不使用CUBE聚合

```bash
python3 cum10m.py \
    --input /Users/lqj/Desktop/360度运镜.xlsx \
    --output /Users/lqj/Desktop/累计结果.xlsx \
    --date_p 20251226 \
    --start_ts 202512260000 \
    --end_ts 202512260100 \
    --input_sql /Users/lqj/Desktop/query.sql \
    --no-cube
```

### 示例3：使用SQL文本

```bash
python3 cum10m.py \
    --input input.xlsx \
    --output output.xlsx \
    --date_p 20251226 \
    --start_ts 202512260000 \
    --end_ts 202512260100 \
    --sql-text "SELECT \
  cost_type, \
  algo_provider, \
  order_id,  -- distinct_req_num \
  uid,       -- distinct_user_num \
  req_time,  -- sum \
  cost,      -- sum \
  time_minute, \
  date_p \
FROM ..."
```

### 示例4：写入数仓（以sqlite演示）

```bash
python3 cum10m.py \
    --input /Users/lqj/Desktop/360度运镜.xlsx \
    --date_p 20251226 \
    --start_ts 202512260000 \
    --end_ts 202512260100 \
    --no-cube \
    --input_sql /Users/lqj/Desktop/query.sql \
    --output_table stat_aigc.cost_arz_roboneo_aigc_onecost_mina_backfill \
    --dw-url "sqlite:////tmp/dw.db" \
    --dw-mode overwrite
```

### 示例5：线上用 datawork-client 写入Hive分区表（date_p）

```bash
cd /www/warehouse/mt_tool_use/cum10m_cli && \
cat > query.sql <<'SQL'
select ...
where date_p = ${date_p}
  and substr(time_minute, 1, 11) <= substr(${end_ts}, 1, 11)
SQL

python3 cum10m.py \
  --date_p ${date_p} \
  --start_ts 202512260000 \
  --end_ts 202512260100 \
  --input_sql query.sql \
  --output_table stat_aigc.cost_arz_roboneo_aigc_onecost_mina_backfill \
  --engine Presto \
  --dw-presto-max-runtime-minute 8 \
  --dw-query-fallback-engine SparkSql \
  --dw-spark-load-method csv \
  --dw-spark-driver-memory 4g
```

说明：
- 如果 SQL 里包含 `${...}` 占位符，不建议用 `--sql "...${date_p}..."` 直接传：bash 会先做变量展开；推荐写入 `query.sql` 或用 heredoc（上例）。
- 性能诊断可加 `--profile` 输出分阶段耗时与行数。
- 结果集很大时可用 `--dw-write-slice-minutes 60` 按小时分片写入 ORC（默认不分片）。

### 示例6：大表推荐（集群侧 SparkSql 直接算累计+CUBE 并写表）

适用场景：明细数据量很大（千万/亿级），不希望 `query_to_local` 把明细落地到本机再用 pandas 处理。

```bash
cd /www/warehouse/mt_tool_use/cum10m_cli && \
cat > query.sql <<'SQL'
select ...
from stat_aigc.cost_odz_aigc_cost_detail_min
where date_p = ${date_p}
  and substr(time_minute, 1, 11) <= substr(${end_ts}, 1, 11)
SQL

python3 cum10m.py \
  --date_p ${date_p} \
  --start_ts ${date_p}0000 \
  --end_ts ${end_ts} \
  --input_sql query.sql \
  --output_table stat_aigc.cost_ahz_aigc_cost_mina_backfill \
  --dw-compute-mode sparksql \
  --dw-compute-engine SparkSql \
  --profile
```

说明：
- `--dw-compute-mode sparksql` 会在集群侧生成并执行 `insert overwrite table ... partition(date_p=...) select ...`，不再走 `query_to_local` 下载明细到本机。
- 若你的 SQL 里 `FROM <table>` 无法自动解析锚点表，可显式加 `--dw-anchor-table <table>`。
- 开启 CUBE 且包含 distinct 指标（如 `uid`）时，集群侧需要在 `(维度,key)` 粒度计算 first_seen 再累计，代价较高；若只看叶子维度或不需要“整体”，可加 `--no-cube` 明显提速。

## 输入文件要求

### Excel文件格式

输入Excel文件必须包含以下列：

1. **必需列**：
   - `time_minute`: 时间戳（分钟级），格式：`YYYYMMDDHHmm` 或数字
   - `date_p`: 日期分区，格式：`YYYYMMDD`

2. **指标列**（根据SQL文件中的定义）：
   - `order_id`: 订单ID（用于去重计数，输出为`req_num`）
   - `uid`: 用户ID（用于去重计数，输出为`user_num`）
   - `req_time`: 请求时间（用于求和）
   - `cost`: 成本（用于求和）

3. **维度列**（根据SQL文件中的定义）：
   - 例如：`cost_type`、`algo_provider`、`func_name`、`country_name`、`os_type`等

### SQL文件格式

SQL文件用于指定需要统计的字段和聚合规则。格式示例：

```sql
SELECT
  cost_type,        -- 维度
  algo_provider,    -- 维度
  func_name,        -- 维度
  country_name,     -- 维度
  os_type,          -- 维度
  app_name_cn,      -- 维度
  country_type,     -- 维度
  order_id,         -- 指标 distinct_order_id
  uid,              -- 指标 distinct_uid
  req_time,         -- 指标 sum_req_time
  cost,             -- 指标 sum_cost
  time_hour,        -- 小时
  time_minute,      -- 分钟
  date_p            -- 天
FROM ...
```

### 聚合规则说明

在SQL注释中指定聚合规则：

- `-- distinct` 或 `-- distinct_xxx`：表示去重计数
- `-- sum` 或 `-- sum_xxx`：表示求和

**默认规则**：
- `order_id`: distinct（去重计数，输出为`req_num`）
- `uid`: distinct（去重计数，输出为`user_num`）
- `req_time`: sum（求和）
- `cost`: sum（求和）

## 输出说明

### 输出列

输出Excel文件包含以下列：

1. **维度列**：SQL中指定的所有维度字段
2. `date_minute`: 10分钟时间戳（格式：`YYYYMMDDHHmm`，字符串格式避免科学计数法）
3. `req_num`: 请求数（去重后的order_id数量）
4. `req_time`: 累计请求时间（求和）
5. `cost`: 累计成本（求和）
6. `user_num`: 用户数（去重后的uid数量）
7. `date_p`: 日期分区

### 累计计算逻辑

1. **时间取整**：将`time_minute`向下取整到10分钟（如：`202512260047` -> `202512260040`）

2. **累计计算**：对每个10分钟时间点（`date_minute`），计算从当天开始到该时间点的累计值

3. **两层聚合**：
   - **第一层**：按`维度 + order_id + uid`分组，对`req_time`和`cost`求和
   - **第二层**：按`维度`分组，对`order_id`和`uid`去重计数，对`req_time`和`cost`求和

4. **匹配SQL逻辑**：`substr(time_minute, 1, 11) <= substr(date_minute10, 1, 11)`

### CUBE聚合

默认情况下，脚本会生成所有维度组合（包括"整体"），例如：

- 原始维度：`cost_type=自研, algo_provider=美图, os_type=android`
- CUBE组合：
  - `cost_type=整体, algo_provider=美图, os_type=android`
  - `cost_type=自研, algo_provider=整体, os_type=android`
  - `cost_type=整体, algo_provider=整体, os_type=android`
  - ...（所有组合）

使用`--no-cube`参数可以禁用此功能，只输出原始维度组合。

## 注意事项

1. **时间戳处理**：
   - 输入Excel中的`time_minute`列会被向下取整到10分钟
   - 累计计算使用`time_minute_10`进行过滤，而不是原始的`time_minute`

2. **数据格式**：
   - 输出中的`date_minute`和`date_p`会被转换为字符串格式，避免Excel显示为科学计数法
   - 维度列的空值会被替换为"未知"

3. **性能考虑**：
   - 如果启用CUBE聚合，会生成所有维度组合（2^n种组合，n为维度数），数据量会显著增加
   - 建议在处理大量数据时使用`--no-cube`参数

4. **数据完整性**：
   - 脚本会自动填充缺失的时间点组合，缺失值用0填充
   - 确保输入数据包含所有需要的字段

## 常见问题

### Q: 为什么输出中的`date_minute`显示为科学计数法？

A: 已修复。脚本会将`date_minute`转换为字符串格式，避免Excel显示为科学计数法。

### Q: 累计结果与SQL查询结果不一致？

A: 请检查：
1. 输入数据是否完整（包含所有需要的时间范围）
2. SQL文件中的字段定义是否正确
3. 聚合规则是否正确指定

### Q: 如何禁用CUBE聚合？

A: 使用`--no-cube`参数。

### Q: 支持哪些Excel格式？

A: 支持`.xlsx`格式（使用`openpyxl`库）。

## 版本信息

- Python版本要求：Python 3.6+
- 依赖库：pandas, openpyxl

## 许可证

本脚本为内部工具，仅供内部使用。
