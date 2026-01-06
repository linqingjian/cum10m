#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
10分钟累计统计脚本

功能说明：
    从明细Excel文件生成10分钟累计统计数据，匹配SQL的累计计算逻辑。
    脚本会按照SQL SELECT语句中指定的字段和聚合规则，对数据进行累计统计。

使用方法：
    python3 cum10m.py \\
        --input <输入Excel文件路径> \\
        --date_p <日期分区，如：20251226> \\
        --start_ts <开始时间，如：202512260000> \\
        --end_ts <结束时间，如：202512260100> \\
        --input_sql <SQL文件路径> \\
        [--output <输出Excel文件路径>] \\
        [--output_table <数仓表名> --dw-url <连接串>] \\
        [--no-cube]

参数说明：
    --input (必需)
        输入Excel文件路径，包含明细数据
        
    --output (可选)
        输出Excel文件路径，将写入累计统计结果（不填则不输出Excel）
        
    --date_p (必需)
        日期分区过滤值，格式：YYYYMMDD，例如：20251226
        
    --start_ts (必需)
        开始时间戳（分钟级），格式：YYYYMMDDHHmm，例如：202512260000
        用于确定输出的时间轴起始点
        
    --end_ts (必需)
        结束时间戳（分钟级），格式：YYYYMMDDHHmm，例如：202512260100
        用于确定输出的时间轴结束点，以及过滤输入数据范围
        
    --input_sql (可选)
        SQL文件路径，包含SELECT字段列表。SQL文件用于指定：
        - 需要统计的字段（维度列和指标列）
        - 指标的聚合规则（distinct或sum，通过注释指定）
        
    --sql-text (可选)
        SQL文本字符串，与--input_sql二选一。如果都不提供，则从标准输入读取
        
    --sql (可选)
        --sql-text 的别名（便于命令行直接传SQL）
        
    --no-cube (可选)
        禁用CUBE聚合，不生成"整体"维度的组合。默认开启CUBE并生成所有维度组合

    --output_table (可选)
        写入自定义数仓表，例如：stat_aigc.cost_arz_roboneo_aigc_onecost_mina_backfill
        通用分区字段为 date_p
        
    --engine (可选)
        明细拉取引擎（等同于 --dw-query-engine）：Presto / SparkSql / Hive
        默认 Presto；Presto 失败按 --dw-query-fallback-engine 回退

    --dw-url (可选)
        数仓连接串（SQLAlchemy URL）。不提供则尝试读取环境变量 DW_URL

    --dw-mode (可选)
        append：追加
        overwrite：按 date_p 分区覆盖（通过 DELETE date_p=... 实现）

    --dw-spark-driver-memory (可选)
        线上写入（--dw-write-method spark）时，本机 Spark driver 内存（默认 4g）
        结果集较大（尤其开启CUBE）时建议调大，例如：8g

    --dw-spark-load-method (可选)
        线上写入（--dw-write-method spark）时，Spark 加载 pandas 结果集方式：
        - csv（默认）：先写本地临时CSV，再由 Spark 读取；更稳，避免 createDataFrame 大数据时 JVM OOM
        - pandas：直接 spark.createDataFrame(pandas_df)；小数据更快，但大数据可能 OOM

输入Excel文件要求：
    1. 必须包含 time_minute 列（时间戳，分钟级）
    2. 必须包含 date_p 列（日期分区）
    3. 必须包含 SQL SELECT 中指定的所有字段
    4. 指标列：order_id（订单ID）、uid（用户ID）、req_time（请求时间）、cost（成本）
    5. 维度列：SQL中指定的其他字段（如：cost_type、algo_provider、func_name等）

SQL文件格式示例：
    SELECT
      cost_type,        -- 维度
      algo_provider,    -- 维度
      func_name,        -- 维度
      country_name,     -- 维度
      os_type,          -- 维度
      app_name_cn,      -- 维度
      country_type,     -- 维度
      order_id,         -- 指标 distinct_req_num (去重计数，输出为req_num)
      uid,              -- 指标 distinct_user_num (去重计数，输出为user_num)
      req_time,         -- 指标 sum (求和，输出为req_time)
      cost,             -- 指标 sum (求和，输出为cost)
      time_hour,        -- 小时
      time_minute,      -- 分钟
      date_p            -- 天
    FROM ...
    
    输出列名映射说明：
    - 格式1：-- distinct_output_name 或 -- distinct:output_name
    - 格式2：-- sum_output_name 或 -- sum:output_name
    - 如果不指定输出列名，则使用原字段名作为输出列名

聚合规则说明：
    - 在SQL注释中指定聚合规则：
      * "-- distinct" 或 "-- distinct_xxx"：表示去重计数
      * "-- sum" 或 "-- sum_xxx"：表示求和
    - 输出列名映射（可选）：
      * 在注释中指定输出列名："-- distinct_output_name" 或 "-- distinct:output_name"
      * 例如：order_id -- distinct_req_num 表示order_id去重计数后输出为req_num
      * 如果不指定输出列名，则使用原字段名作为输出列名
    - 注意：所有指标字段必须通过注释明确指定聚合规则（distinct或sum）

输出说明：
    输出Excel文件包含以下列：
    - 维度列：SQL中指定的所有维度字段
    - date_minute: 10分钟时间戳（格式：YYYYMMDDHHmm，字符串格式避免科学计数法）
    - req_num: 请求数（去重后的order_id数量）
    - req_time: 累计请求时间（求和）
    - cost: 累计成本（求和）
    - user_num: 用户数（去重后的uid数量）
    - date_p: 日期分区

累计计算逻辑：
    1. 对每个10分钟时间点（date_minute），计算从当天开始到该时间点的累计值
    2. 第一层聚合：按维度 + order_id + uid分组，对req_time和cost求和
    3. 第二层聚合：按维度分组，对order_id和uid去重计数，对req_time和cost求和
    4. 匹配SQL逻辑：substr(time_minute, 1, 11) <= substr(date_minute10, 1, 11)

使用示例：
    示例1：基本使用（新参数名）
    python3 cum10m.py \\
        --input /path/to/input.xlsx \\
        --output /path/to/output.xlsx \\
        --date_p 20251226 \\
        --start_ts 202512260000 \\
        --end_ts 202512260100 \\
        --input_sql /path/to/query.sql

    示例2：不使用CUBE聚合
    python3 cum10m.py \\
        --input /path/to/input.xlsx \\
        --output /path/to/output.xlsx \\
        --date_p 20251226 \\
        --start_ts 202512260000 \\
        --end_ts 202512260100 \\
        --input_sql /path/to/query.sql \\
        --no-cube

    示例3：使用SQL文本（不使用文件）
    python3 cum10m.py \\
        --input /path/to/input.xlsx \\
        --output /path/to/output.xlsx \\
        --date_p 20251226 \\
        --start_ts 202512260000 \\
        --end_ts 202512260100 \\
        --sql-text "SELECT\\n  cost_type,\\n  algo_provider,\\n  order_id,  -- distinct_req_num\\n  uid,       -- distinct_user_num\\n  req_time,  -- sum\\n  cost,      -- sum\\n  time_minute,\\n  date_p\\nFROM ..."

    示例4：线上用SQL文件拉明细并写入分区表（date_p）
    python3 cum10m.py \\
        --date_p 20251226 \\
        --start_ts 202512260000 \\
        --end_ts 202512260100 \\
        --input_sql query.sql \\
        --output_table stat_aigc.cost_arz_roboneo_aigc_onecost_mina_backfill \\
        --engine Presto \\
        --dw-presto-max-runtime-minute 8 \\
        --dw-query-fallback-engine SparkSql \\
        --dw-spark-load-method csv \\
        --dw-spark-driver-memory 4g

    示例5：SQL里包含 ${...} 占位符时的推荐写法（避免被shell提前展开）
    cd /www/warehouse/mt_tool_use/cum10m_cli && \\
    cat > query.sql <<'SQL' \\
    select ... where date_p = ${date_p} and substr(time_minute,1,11) <= substr(${end_ts},1,11) \\
    SQL \\
    python3 cum10m.py \\
        --date_p ${date_p} \\
        --start_ts 202512260000 \\
        --end_ts 202512260100 \\
        --output_table stat_aigc.cost_arz_roboneo_aigc_onecost_mina_backfill \\
        --input_sql query.sql

    说明：
    - 不建议用 --sql "...${date_p}..." 这种写法传占位符：bash 会先做变量展开，容易导致 SQL 里出现非法字符或空值。

线上运行要点（建议先读）：
    1) SQL 占位符与传参
       - SQL 文件里可以写 ${date_p}/${start_ts}/${end_ts}/${date_minute10} 等占位符
       - 推荐用 heredoc 写 query.sql（cat <<'SQL'）以避免 bash 提前展开
       - 脚本会在执行 query_to_local 前做占位符替换，并内置 start_ts_10/end_ts_10/date_minute10

    2) 临时目录与清理策略
       - 默认临时目录为 /data1/lqj2/cum10m（不可用会回退到 /tmp）
       - 成功后默认会清理“本次运行产生的临时文件/目录”（cum10m_source_*/cum10m_exec_*/Spark 本地目录）
       - 失败时会保留临时文件，便于排查
       - 若要保留临时文件：加 --dw-keep-tmp；只保留最新3个：--dw-keep-tmp --dw-tmp-keep-last 3

    3) Spark 写入（线上写分区表的默认方式）
       - 采用本机 Spark(local[*]) 写 ORC 到目标表 LOCATION/date_p=... 路径，再 add_partition 注册分区
       - 为避免 /tmp 堆积 spark-*/blockmgr-*，会把 spark.local.dir/java.io.tmpdir 指向临时目录

    4) 累计口径
       - 输出是“累计值”：当某个 10 分钟桶没有新增/消耗时，会保持上一时间点的累计值（ffill）
       - CUBE 聚合会生成 2^n 个维度组合，“整体”表示该维度被汇总

注意事项：
    1. 输入Excel文件中的time_minute列会被向下取整到10分钟（如：202512260047 -> 202512260040）
    2. 累计计算使用time_minute_10进行过滤，而不是原始的time_minute
    3. 输出中的date_minute和date_p会被转换为字符串格式，避免Excel显示为科学计数法
    4. 如果启用CUBE聚合，会生成所有维度组合（包括"整体"），数据量会显著增加
"""

import argparse
import re
import os
import sys
import time
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import List
import xml.etree.ElementTree as ET

import pandas as pd


class _Profiler:
    def __init__(self, enabled: bool):
        self.enabled = bool(enabled)
        self._starts = {}
        self._records = []

    def start(self, name: str):
        if not self.enabled:
            return
        self._starts[name] = time.perf_counter()

    def end(self, name: str, *, rows: int = None, extra: str = None):
        if not self.enabled:
            return
        t0 = self._starts.get(name)
        if t0 is None:
            return
        dt = time.perf_counter() - t0
        self._records.append((name, dt, rows, extra))

    def info(self, msg: str):
        if self.enabled:
            print(f"[profile] {msg}")

    def dump(self):
        if not self.enabled:
            return
        print("[profile] ===== 分阶段耗时 =====")
        for name, dt, rows, extra in self._records:
            parts = [f"{name}: {dt:.3f}s"]
            if rows is not None:
                parts.append(f"rows={rows}")
            if extra:
                parts.append(str(extra))
            print("[profile] " + " ".join(parts))


def _maybe_categorize_dims(df: pd.DataFrame, dim_cols: List[str]) -> pd.DataFrame:
    """
    性能/内存优化：当需要做大量 groupby（尤其是 CUBE 2^n 组）时，把维度列转为 category。
    注意：需确保包含“整体”这个占位值，便于 CUBE 过程写入。
    """
    if not dim_cols:
        return df
    if len(df) < 50000:
        return df
    out = df
    for c in dim_cols:
        try:
            cats = list(pd.unique(out[c]))
            if "整体" not in cats:
                cats.append("整体")
            out[c] = pd.Categorical(out[c], categories=cats)
        except Exception:
            # 失败则保持原类型
            pass
    return out


def _normalize_dim_values(df: pd.DataFrame, dim_cols: List[str]) -> pd.DataFrame:
    """
    维度值标准化：
    - 除 func_name 外：空值/空字符串统一为“未知”
    - func_name 特殊规则（用于对齐校验 SQL 口径）：
      * NULL/NaN -> “未定义功能”（等价于 SQL: COALESCE(func_name, '未定义功能')）
      * 不会把 '未知' 映射为“未定义功能”（SQL 的 COALESCE 也不会）
      * 空字符串不会被当作缺失（SQL 的 COALESCE 也不会把 '' 当 NULL）
    """
    if not dim_cols:
        return df
    for c in dim_cols:
        if c not in df.columns:
            continue
        if c == "func_name":
            # 语义对齐：COALESCE(func_name, '未定义功能')
            # 注意：这里不把空字符串当作缺失（SQL 的 COALESCE 也不会），避免与校验SQL口径不一致。
            df[c] = df[c].fillna("未定义功能")
        else:
            # 其他维度：默认空值/空字符串视为未知
            df[c] = df[c].fillna("未知").replace("", "未知")
    return df


def _distinct_key_mask(s: pd.Series) -> pd.Series:
    """
    针对 distinct 指标字段（如 uid/order_id）的“有效值”判断。

    需要对齐 Hive/SparkSQL 的 count(distinct col) 语义：
    - NULL 不计入 distinct
    - 通过 query_to_local 落地后，NULL 可能被输出为“空字段”（即空字符串）或 '\\N'
      为避免把 NULL 当成一个有效取值计入 distinct，这里将以下视为“无效”并过滤：
      * NaN/None
      * ''（空字符串，含纯空白）
      * '\\N'
      * 'null'（部分系统会把 NULL 文本化为 'null'/'NULL'）

    注意：如果源数据本身确实存在“空字符串”作为合法值，这个过滤会与 SQL 语义不一致；
    但对 uid/order_id 这类字段通常不会出现空字符串，优先保证与 Hive NULL 输出对齐。
    """
    if s is None:
        return pd.Series(dtype=bool)
    mask = s.notna()
    if mask.any():
        ss = s[mask].astype(str).str.strip()
        bad = ss.isin(["", "\\N"]) | ss.str.lower().isin(["null"])
        mask.loc[mask] = ~bad
    return mask


def _parse_int_arg(v: str) -> int:
    """
    解析整型参数，支持：
    - 直接数字：20251226
    - 占位符：${date_p}（优先读取同名环境变量 date_p，其次 DATE_P）
    - 占位符拼接：${date_p}0000（用于 start_ts/end_ts 等场景）
    """
    if v is None:
        raise argparse.ArgumentTypeError("参数值为空")
    s = str(v).strip()
    if not s:
        raise argparse.ArgumentTypeError("参数值为空")
    # 支持把字符串中的 ${var} 用环境变量替换（允许拼接）
    def repl(m):
        k = m.group(1)
        env_v = os.environ.get(k)
        if env_v is None:
            env_v = os.environ.get(k.upper())
        if env_v is None or str(env_v).strip() == "":
            raise argparse.ArgumentTypeError(f"占位符 ${{{k}}} 未找到对应环境变量 {k}（或 {k.upper()}）")
        return str(env_v).strip()

    if "${" in s:
        s = re.sub(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", repl, s)
    try:
        return int(s)
    except Exception as e:
        raise argparse.ArgumentTypeError(f"无法解析为整数: {v}") from e


def parse_args():
    """解析命令行参数"""
    p = argparse.ArgumentParser(description="从明细Excel文件生成10分钟累计统计数据，使用SQL SELECT列表")
    p.add_argument(
        "--source",
        choices=["excel", "datawork"],
        default="datawork",
        help="输入来源：excel（本地文件）或 datawork（datawork-client query_to_local 拉取明细）；默认 datawork",
    )
    p.add_argument("--input", help="输入Excel文件路径（source=excel时必填）")
    p.add_argument("--output", help="输出Excel文件路径（不填则不输出Excel）")
    p.add_argument("--date_p", "--date-p", required=True, type=_parse_int_arg, help="日期分区过滤，例如：20251226")
    p.add_argument("--start_ts", "--start-ts", required=True, type=_parse_int_arg, help="开始时间（分钟级），例如：202512260000")
    p.add_argument("--end_ts", "--end-ts", required=True, type=_parse_int_arg, help="结束时间（分钟级），例如：202512260100")
    p.add_argument("--input_sql", "--sql-file", dest="sql_file", help="SQL文件路径（包含SELECT字段列表）")
    p.add_argument("--sql-text", help="SQL文本字符串（包含SELECT字段列表）")
    p.add_argument("--sql", dest="sql_text", help="SQL文本字符串别名（同 --sql-text）")
    p.add_argument("--no-cube", action="store_true", help="禁用CUBE聚合（默认开启CUBE，生成'整体'维度组合）")
    p.add_argument(
        "--output_table",
        "--dw-table",
        dest="dw_table",
        help="写入数仓表（可选），例如：stat_aigc.cost_arz_roboneo_aigc_onecost_mina_backfill",
    )
    p.add_argument(
        "--dw-kind",
        choices=["auto", "sqlalchemy", "datawork-client"],
        default="auto",
        help="写入方式：auto（优先sqlalchemy，有dw-url则用；否则使用datawork-client）、sqlalchemy、datawork-client；默认 auto",
    )
    p.add_argument(
        "--dw-url",
        help="数仓连接串（SQLAlchemy URL，可选；不填则尝试读取环境变量DW_URL），例如：mysql+pymysql://user:pwd@host:3306/db 或 sqlite:////tmp/dw.db",
    )
    p.add_argument(
        "--dw-mode",
        choices=["append", "overwrite"],
        default="overwrite",
        help="写入模式：append 追加；overwrite 按date_p分区覆盖（通过DELETE date_p=...实现）；默认 overwrite",
    )
    p.add_argument("--dw-chunk-size", type=int, default=10000, help="写入分批大小（to_sql chunksize）")

    # datawork-client（线上）参数（默认值来自 online_test.py）
    p.add_argument("--dw-project-name", default="mtxx", help="datawork-client project_name（默认 mtxx）")
    p.add_argument(
        "--dw-ca-config-path",
        default="/www/lqj/dataworks/ca_config.properties",
        help="datawork-client ca_config_path（默认 /www/lqj/dataworks/ca_config.properties）",
    )
    p.add_argument("--dw-env", default="prod", help="datawork-client env（默认 prod）")
    p.add_argument("--dw-engine", default="SparkSql", help="datawork-client se（默认 SparkSql）")
    p.add_argument("--dw-hive-env", default="huawei", help="datawork-client hive_env（默认 huawei）")
    p.add_argument(
        "--dw-tmp-dir",
        default=os.environ.get("CUM10M_TMP_DIR", "/data1/lqj2/cum10m"),
        help="本地临时目录（用于 query_to_local 落地文件、Spark staging CSV、execute SQL 文件）；默认读取环境变量 CUM10M_TMP_DIR，未设置则 /data1/lqj2/cum10m",
    )
    p.add_argument(
        "--dw-keep-tmp",
        action="store_true",
        help="保留本次运行产生的临时文件（默认会在成功后清理本次产生的 cum10m_* 临时文件）",
    )
    p.add_argument(
        "--dw-tmp-keep-last",
        type=int,
        default=0,
        help="当使用 --dw-keep-tmp 保留临时文件时，额外只保留临时目录中最新的N个 cum10m_* 文件（默认0表示不裁剪；例如 3 表示仅保留最新3个）",
    )
    p.add_argument("--dw-datawork-bin", default="datawork-client", help="datawork-client 可执行文件名/路径")
    p.add_argument(
        "--dw-write-batch-rows",
        type=int,
        default=500,
        help="写入每批行数（datawork-client 常量写入会按批拆分；默认500）",
    )
    p.add_argument(
        "--dw-write-method",
        choices=["spark", "datawork-client"],
        default="spark",
        help="写入方式：spark（默认，pyspark 本机写 ORC 到表 LOCATION/date_p=... 并注册分区）或 datawork-client（常量UNION ALL，小结果集可用）；默认 spark",
    )
    p.add_argument(
        "--dw-spark-app-name",
        default="cum10m_write",
        help="Spark 写入时的 appName（默认 cum10m_write）",
    )
    p.add_argument(
        "--dw-spark-driver-memory",
        default="4g",
        help="Spark driver 内存（默认 4g；用于避免本机写入大结果集时 JVM OOM）",
    )
    p.add_argument(
        "--dw-spark-master",
        default="local[*]",
        help="Spark master（默认 local[*]，避免占用集群资源）",
    )
    p.add_argument(
        "--dw-spark-load-method",
        choices=["csv", "pandas"],
        default="csv",
        help="Spark 读取 pandas 数据的方式：csv（默认，更稳，避免 createDataFrame 大数据时 JVM OOM）或 pandas（更快，但大数据可能 OOM）",
    )
    p.add_argument(
        "--dw-spark-parallelism",
        type=int,
        default=64,
        help="Spark 并行度（default.parallelism / shuffle.partitions，默认64；用于减少单task过大与提升写入吞吐）",
    )
    p.add_argument(
        "--dw-core-site",
        default="/www/hadoop-2.8.3/etc/hadoop/core-site.xml",
        help="Spark 写 ORC 到 oss:// 时加载的 core-site.xml（默认 /www/hadoop-2.8.3/etc/hadoop/core-site.xml）",
    )
    p.add_argument(
        "--dw-hdfs-site",
        default="/www/hadoop-2.8.3/etc/hadoop/hdfs-site.xml",
        help="Spark 写 ORC 到 oss:// 时加载的 hdfs-site.xml（默认 /www/hadoop-2.8.3/etc/hadoop/hdfs-site.xml）",
    )
    p.add_argument(
        "--dw-orc-num-files",
        type=int,
        default=16,
        help="每次写 ORC 的目标文件数（coalesce），默认16；可适当调大避免单task过大，调小减少小文件",
    )
    p.add_argument(
        "--dw-orc-compression",
        default="snappy",
        help="ORC 压缩（默认 snappy）",
    )
    p.add_argument(
        "--dw-write-slice-minutes",
        type=int,
        default=0,
        help="按时间分片写入（分钟）。0表示不分片；建议为10的倍数，例如60表示按小时分片写入",
    )
    p.add_argument(
        "--dw-hive-site",
        default="/www/huawei-hive-2.3.3/Hive/config/hive-site.xml",
        help="Spark 写入时读取 hive-site.xml 以获取 metastore 配置（默认 /www/huawei-hive-2.3.3/Hive/config/hive-site.xml）",
    )
    p.add_argument(
        "--dw-hdfs-dir",
        help="datawork-client 上传到HDFS的目标目录（默认 /datawork-client/<project_name>/cum10m ）",
    )
    p.add_argument(
        "--dw-anchor-table",
        help="datawork-client 写入时用于通过校验的锚点表（只读引用，不参与结果计算）；不填则尝试从输入SQL的FROM表自动提取",
    )
    p.add_argument(
        "--dw-source-sql-file",
        help="datawork 明细拉取SQL文件（source=datawork时可用）；不填则复用 --sql-file",
    )
    p.add_argument(
        "--dw-source-sql-text",
        help="datawork 明细拉取SQL文本（source=datawork时可用）；不填则复用 --sql-text/STDIN",
    )
    p.add_argument(
        "--dw-preagg",
        dest="dw_preagg",
        action="store_true",
        help="datawork 拉明细时先做SQL预聚合（默认开启）：按 10分钟粒度 + 维度 + distinct键 聚合 sum 指标，减少落地明细行数",
    )
    p.add_argument(
        "--dw-no-preagg",
        dest="dw_preagg",
        action="store_false",
        help="禁用 datawork 拉明细SQL预聚合（直接拉原始明细）",
    )
    p.set_defaults(dw_preagg=True)
    p.add_argument(
        "--sql-param",
        action="append",
        default=[],
        help="SQL参数替换 key=value（用于替换 ${key}），可多次传入；内置 date_p/date_minute10",
    )
    p.add_argument(
        "--date-minute10",
        type=_parse_int_arg,
        help="替换SQL里的 ${date_minute10}（不传则默认使用 end_ts 向下取整到10分钟）",
    )
    p.add_argument(
        "--dw-query-engine",
        choices=["Hive", "Presto", "SparkSql"],
        default="Presto",
        help="datawork-client query_to_local 的执行引擎（默认 Presto）",
    )
    p.add_argument(
        "--engine",
        dest="dw_query_engine",
        choices=["Hive", "Presto", "SparkSql"],
        help="明细拉取引擎（--dw-query-engine 的别名）",
    )
    p.add_argument(
        "--dw-presto-max-runtime-minute",
        type=int,
        default=8,
        help="Presto 拉明细最大运行分钟（通过在SQL前注入 set spark.hive.presto.execution.max.runtime.minute=...；默认8）",
    )
    p.add_argument(
        "--dw-query-fallback-engine",
        choices=["Hive", "SparkSql"],
        default="SparkSql",
        help="当 query_to_local 在 dw-query-engine 失败时回退的引擎（默认 SparkSql）",
    )
    p.add_argument(
        "--dw-query-fd",
        default="\\0001",
        help="datawork-client query_to_local 的 -fd 分隔符（默认 \\0001，与 online_test.py 对齐）",
    )
    p.add_argument(
        "--dw-query-to-local-max-bytes",
        type=int,
        default=0,
        help="query_to_local 落地文件大小上限（字节）。默认不限制（0）；仅在你确认要强制保护本机时才建议设置",
    )
    p.add_argument(
        "--dw-compute-mode",
        choices=["pandas", "sparksql"],
        default="pandas",
        help="计算模式：pandas（默认，本机计算；适合百万级以内）或 sparksql（集群侧 SparkSql 直接算累计+CUBE并写表；适合千万/亿级明细）",
    )
    p.add_argument(
        "--dw-compute-engine",
        choices=["SparkSql", "Hive"],
        default="SparkSql",
        help="dw-compute-mode=sparksql 时使用的 datawork-client execute 引擎（默认 SparkSql）",
    )
    p.add_argument(
        "--dw-stage-table",
        help="中间落盘表（external textfile，按date_p分区）；不填则自动使用与目标表同schema的 __tmp_cum10m_stage",
    )
    p.add_argument(
        "--dw-stage-hdfs-dir",
        help="中间表数据上传到HDFS的根目录（默认 /datawork-client/<project_name>/cum10m_stage/<stage_table>）",
    )
    p.add_argument("--dw-dry-run", action="store_true", help="仅生成SQL与数据文件，不实际调用datawork-client执行")
    p.add_argument("--profile", action="store_true", help="输出分阶段耗时与行数统计（用于性能诊断）")
    return p.parse_args()


def read_sql(args):
    """读取SQL文本，支持从文件、参数或标准输入读取"""
    if args.sql_text:
        return args.sql_text
    if args.sql_file:
        return Path(args.sql_file).read_text(encoding="utf-8")
    # 从标准输入读取（支持管道/重定向，直到EOF）
    return sys.stdin.read()


def read_source_sql(args):
    if args.dw_source_sql_text:
        return args.dw_source_sql_text
    if args.dw_source_sql_file:
        return Path(args.dw_source_sql_file).read_text(encoding="utf-8")
    return read_sql(args)

def _ensure_tmp_dir_or_fallback(args):
    """
    确保临时目录可写。默认希望落在 /data1/lqj2/cum10m（线上更稳定），
    但在本地/权限不足时自动回退到 /tmp，避免脚本直接失败。
    """
    tmp = Path(args.dw_tmp_dir)
    try:
        tmp.mkdir(parents=True, exist_ok=True)
        return
    except Exception:
        fallback = Path("/tmp")
        try:
            fallback.mkdir(parents=True, exist_ok=True)
        except Exception:
            # 回退也失败则抛出原始异常更清晰
            raise
        print(
            f"[warn] 临时目录不可用，已回退到 /tmp（原 dw-tmp-dir={args.dw_tmp_dir}）",
            file=sys.stderr,
        )
        args.dw_tmp_dir = str(fallback)

def _cleanup_run_tmp_files(args):
    """
    清理“本次运行”产生的临时文件/目录。

    说明：
    - 默认只在“成功运行”后清理；失败保留便于排查
    - 只会清理由脚本记录到 args._tmp_paths 的路径，不会扫描整个临时目录
    """
    paths = list(getattr(args, "_tmp_paths", []) or [])
    if not paths:
        return
    deleted = 0
    for p in paths:
        try:
            pp = Path(p)
            if not pp.exists():
                continue
            if pp.is_file():
                pp.unlink()
                deleted += 1
            elif pp.is_dir():
                shutil.rmtree(pp, ignore_errors=True)
                deleted += 1
        except Exception:
            pass
    if deleted and getattr(args, "profile", False):
        print(f"[profile] 已清理本次临时文件: {deleted} 个", file=sys.stderr)


def _cleanup_keep_last_tmp_files(args):
    """
    历史临时文件裁剪：仅保留最新 N 个 cum10m_* 文件。

    仅在用户显式开启 --dw-keep-tmp 时触发（否则默认成功后就会清理本次文件）。
    """
    keep = int(getattr(args, "dw_tmp_keep_last", 0) or 0)
    if keep <= 0:
        return
    root = Path(args.dw_tmp_dir)
    if not root.exists() or not root.is_dir():
        return
    patterns = ["cum10m_source_*", "cum10m_exec_*", "cum10m_spark_stage_*"]
    files = []
    for pat in patterns:
        for p in root.glob(pat):
            try:
                if p.is_file():
                    files.append(p)
            except Exception:
                pass
    if len(files) <= keep:
        return
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    to_del = files[keep:]
    deleted = 0
    for p in to_del:
        try:
            p.unlink()
            deleted += 1
        except Exception:
            pass
    if deleted and getattr(args, "profile", False):
        print(f"[profile] 已裁剪历史临时文件: {deleted} 个（保留最新{keep}个）", file=sys.stderr)


def _parse_sql_params(args) -> dict:
    params = {}
    params["date_p"] = int(args.date_p)
    params["start_ts"] = int(args.start_ts)
    params["end_ts"] = int(args.end_ts)
    params["start_ts_10"] = int(floor_10m(int(args.start_ts)))
    params["end_ts_10"] = int(floor_10m(int(args.end_ts)))
    dm10 = args.date_minute10 if args.date_minute10 is not None else floor_10m(int(args.end_ts))
    params["date_minute10"] = int(dm10)
    for kv in args.sql_param or []:
        if "=" not in kv:
            raise ValueError(f"--sql-param 参数格式必须为 key=value: {kv}")
        k, v = kv.split("=", 1)
        k = k.strip()
        v = v.strip()
        if not k:
            raise ValueError(f"--sql-param 参数key为空: {kv}")
        params[k] = v
    return params


def substitute_sql_params(sql_text: str, params: dict) -> str:
    def repl(m):
        # 支持 \${key}（用于避免shell提前展开），这里会自动去掉反斜杠
        k = m.group(1)
        if k not in params:
            raise ValueError(f"SQL参数未提供: {k}（可用 --sql-param {k}=... 传入）")
        return str(params[k])

    # 注意：允许占位符前有一个反斜杠（\${key}），替换时会移除反斜杠
    return re.sub(r"\\?\$\{([A-Za-z_][A-Za-z0-9_]*)\}", repl, sql_text)


def _build_preagg_hql(raw_hql: str, *, fields: List[str], metric_rules: dict) -> str:
    """
    将“明细SQL”包一层预聚合，降低 query_to_local 落地行数：
    - time_minute 向下取整到10分钟（以字符串处理：substr(...,1,11)+'0'）
    - 按 维度 + distinct指标字段 + date_p + time_minute_10 分组
    - sum 指标字段做 sum 聚合

    说明：distinct 指标字段（如 order_id/uid）保留在分组键里，供后续本地做累计去重逻辑。
    """
    time_cols = {"time_hour", "time_minute", "date_p", "date_minute", "time_minute_10"}
    metric_cols = [f for f in fields if f in metric_rules]
    distinct_fields = [f for f in metric_cols if metric_rules.get(f) == "distinct"]
    sum_fields = [f for f in metric_cols if metric_rules.get(f) == "sum"]
    dim_cols = [c for c in fields if c not in metric_cols and c not in time_cols]

    if "time_minute" not in fields:
        # 没有分钟字段无法预聚合
        return raw_hql

    # 10分钟取整表达式：对 YYYYMMDDHHmm 字符串/数值都兼容
    tm_expr = "concat(substr(cast(time_minute as string),1,11),'0')"

    # group by 键：维度 + distinct键 + time_minute_10 + date_p
    group_cols = []
    for c in dim_cols:
        group_cols.append(c)
    for c in distinct_fields:
        group_cols.append(c)
    group_cols.append(tm_expr)
    if "date_p" in fields:
        group_cols.append("date_p")

    # 重要：SELECT 列必须严格按 fields 的顺序输出，
    # 否则 query_to_local 落地文件的列序与 fields 不一致，会导致 pandas 读入后“列错位”。
    select_cols = []
    for f in fields:
        if f == "time_minute":
            select_cols.append(f"{tm_expr} as time_minute")
        elif f == "time_hour":
            # time_hour 不参与后续计算，但 fields 里出现就必须输出以对齐列；按桶内取一个即可
            select_cols.append("max(time_hour) as time_hour")
        elif f == "date_p":
            select_cols.append("date_p")
        elif f in sum_fields:
            select_cols.append(f"sum({f}) as {f}")
        else:
            # 维度列 / distinct键列：保持原值
            select_cols.append(f)

    # 统一用子查询形式，避免生成 `with raw as (...)`：
    # - dw-compute-mode=sparksql 会再包一层更外层 WITH，Hive 解析器不接受 CTE 内再嵌套 WITH
    # - query_to_local / execute 都能稳定解析这种写法
    inner = raw_hql.strip().rstrip(";").strip()
    return (
        "select "
        + ", ".join(select_cols)
        + "\nfrom (\n"
        + inner
        + "\n) raw\n"
        + "group by "
        + ", ".join(group_cols)
    )


def _build_sparksql_cum_cube_insert(
    *,
    raw_hql: str,
    output_table: str,
    date_p: int,
    start_ts: int,
    end_ts: int,
    fields: List[str],
    metric_rules: dict,
    output_names: dict,
    schema_info: dict,
    no_cube: bool,
    preagg: bool,
) -> str:
    """
    在集群侧用 SparkSQL 直接计算“10分钟累计 + CUBE（可选）”，并 insert overwrite 到目标分区表。

    适用场景：明细数据量很大（千万/亿级），不适合 query_to_local 拉到本机再用 pandas 计算。
    """
    time_cols = {"time_hour", "time_minute", "date_p", "date_minute", "time_minute_10"}
    metric_cols = [f for f in fields if f in metric_rules]
    dim_cols = [c for c in fields if c not in metric_cols and c not in time_cols]

    if "time_minute" not in fields:
        raise ValueError("dw-compute-mode=sparksql 需要输入SQL包含 time_minute 字段")
    if "date_p" not in fields:
        raise ValueError("dw-compute-mode=sparksql 需要输入SQL包含 date_p 字段")

    start_ts_10 = floor_10m(int(start_ts))
    end_ts_10 = floor_10m(int(end_ts))

    # 目标表列（不含分区列）
    table_cols = schema_info["cols"]
    part_cols = schema_info["part_cols"] or []
    if part_cols and "date_p" not in part_cols:
        raise RuntimeError(f"目标表分区字段未发现date_p，解析到的分区字段: {part_cols}")
    non_part_cols = [c for c in table_cols if c != "date_p"]

    # 规范化维度：对齐线上的校验SQL口径（func_name 走未定义功能；其他维度默认未知）
    dim_norm_exprs = []
    for c in dim_cols:
        if c == "func_name":
            dim_norm_exprs.append(
                "case when func_name is null then '未定义功能' else cast(func_name as string) end as func_name"
            )
        else:
            dim_norm_exprs.append(f"coalesce(cast({c} as string),'未知') as {c}")

    # 指标字段：sum 保持数值；distinct key 保持 string（count(distinct) 忽略 null）
    distinct_keys = [f for f in metric_cols if metric_rules.get(f) == "distinct"]
    sum_fields = [f for f in metric_cols if metric_rules.get(f) == "sum"]

    metric_exprs = []
    for f in distinct_keys:
        metric_exprs.append(f"cast({f} as string) as {f}")
    for f in sum_fields:
        metric_exprs.append(f"cast({f} as double) as {f}")

    date_minute_expr = "cast(concat(substr(cast(time_minute as string),1,11),'0') as bigint) as date_minute"

    base_select_cols = []
    base_select_cols.extend(dim_norm_exprs)
    base_select_cols.extend(metric_exprs)
    base_select_cols.append(date_minute_expr)

    # spine：生成 [start_ts_10, end_ts_10] 的 10分钟序列
    # 说明：DataWork 的 OneSQL 校验对 `posexplode(...) as (idx, v)` 这种写法兼容性较差；
    # 使用更通用的 Hive/SparkSQL 写法：`lateral view posexplode(...) t as idx, v`
    spine = f"""
params as (
  select
    unix_timestamp('{start_ts_10}', 'yyyyMMddHHmm') as start_u,
    unix_timestamp('{end_ts_10}', 'yyyyMMddHHmm') as end_u
),
nums as (
  select idx
  from params
  lateral view posexplode(split(space(cast((end_u-start_u)/600 as int)), ' ')) pe as idx, dummy
),
spine as (
  select cast(from_unixtime(start_u + idx*600, 'yyyyMMddHHmm') as bigint) as date_minute
  from params cross join nums
)
""".strip()

    dims_group = ", ".join(dim_cols) if dim_cols else ""

    # per-bucket sum + cube
    sum_bucket_cols = []
    for f in sum_fields:
        out_name = output_names.get(f, f)
        sum_bucket_cols.append(f"sum({f}) as {out_name}_bucket")
    sum_bucket_select = ", ".join(sum_bucket_cols) if sum_bucket_cols else "0 as __dummy_bucket"

    if dim_cols and (not no_cube):
        # WITH CUBE 会产生 NULL 维度，输出时统一转为 '整体'，避免后续 join 维度对不上
        dim_out_select = ", ".join([f"coalesce({c},'整体') as {c}" for c in dim_cols])
        sum_group_by = f"group by date_minute, {dims_group} with cube"
    elif dim_cols:
        dim_out_select = ", ".join(dim_cols)
        sum_group_by = f"group by date_minute, {dims_group}"
    else:
        dim_out_select = ""
        sum_group_by = "group by date_minute"

    sum_bucket = f"""
sum_bucket as (
  select
    date_minute
    {',' if dim_out_select else ''}{dim_out_select}
    {',' if sum_bucket_cols else ''}{sum_bucket_select}
  from base
  {sum_group_by}
)
""".strip()

    # distinct：先求 first_minute，再算每桶新增，再做 cumsum
    distinct_ctes = []
    new_cols = []
    for k in distinct_keys:
        out_name = output_names.get(k, k)
        first = f"""
{out_name}_first as (
  select
    min(date_minute) as first_minute
    {',' if dim_cols else ''}{', '.join(dim_cols) if dim_cols else ''}
    , {k} as {k}
  from base
  group by {k}{',' if dim_cols else ''}{', '.join(dim_cols) if dim_cols else ''}
)
""".strip()
        if dim_cols and (not no_cube):
            new_dim_select = ", ".join([f"coalesce({c},'整体') as {c}" for c in dim_cols])
            new_group_by = f"group by first_minute, {dims_group} with cube"
        elif dim_cols:
            new_dim_select = ", ".join(dim_cols)
            new_group_by = f"group by first_minute, {dims_group}"
        else:
            new_dim_select = ""
            new_group_by = "group by first_minute"
        new = f"""
{out_name}_new as (
  select
    first_minute as date_minute
    {',' if new_dim_select else ''}{new_dim_select}
    , count(1) as {out_name}_new
  from {out_name}_first
  {new_group_by}
)
""".strip()
        distinct_ctes.extend([first, new])
        new_cols.append(f"{out_name}_new.{out_name}_new")

    # dims_set：以 sum_bucket 和 distinct_new 的维度全集为准
    dims_select = ", ".join(dim_cols) if dim_cols else ""
    dims_set_parts = []
    if dim_cols:
        dims_set_parts.append(f"select distinct {dims_select} from sum_bucket")
        for k in distinct_keys:
            out_name = output_names.get(k, k)
            dims_set_parts.append(f"select distinct {dims_select} from {out_name}_new")
        dims_set = "dims as (\n  " + "\n  union\n  ".join(dims_set_parts) + "\n)"
    else:
        dims_set = "dims as (select 1 as __dummy_dim)"

    grid = """
grid as (
  select d.*, s.date_minute
  from dims d
  cross join spine s
)
""".strip()

    # join buckets
    join_cond = " and ".join([f"g.{c}=b.{c}" for c in dim_cols]) if dim_cols else "1=1"
    join_cond_new = lambda alias: (" and ".join([f"g.{c}={alias}.{c}" for c in dim_cols]) if dim_cols else "1=1")

    select_bucket_fields = []
    for f in sum_fields:
        out_name = output_names.get(f, f)
        select_bucket_fields.append(f"coalesce(b.{out_name}_bucket,0) as {out_name}_bucket")
    for k in distinct_keys:
        out_name = output_names.get(k, k)
        select_bucket_fields.append(f"coalesce({out_name}_new.{out_name}_new,0) as {out_name}_new")

    joined = f"""
joined as (
  select
    g.date_minute
    {',' if dim_cols else ''}{', '.join([f'g.{c}' for c in dim_cols]) if dim_cols else ''}
    {',' if select_bucket_fields else ''}{', '.join(select_bucket_fields) if select_bucket_fields else '0 as __dummy'}
  from grid g
  left join sum_bucket b
    on g.date_minute=b.date_minute and {join_cond}
""".rstrip()
    for k in distinct_keys:
        out_name = output_names.get(k, k)
        joined += f"""
  left join {out_name}_new {out_name}_new
    on g.date_minute={out_name}_new.date_minute and {join_cond_new(out_name + "_new")}
""".rstrip()
    joined += "\n)"

    # window cumulative
    part_by = ", ".join(dim_cols) if dim_cols else "__dummy"
    order_by = "date_minute"

    cum_select_cols = []
    if dim_cols:
        cum_select_cols.extend(dim_cols)
    else:
        cum_select_cols.append("1 as __dummy")
    cum_select_cols.append("date_minute")

    for f in sum_fields:
        out_name = output_names.get(f, f)
        cum_select_cols.append(
            f"sum({out_name}_bucket) over(partition by {part_by} order by {order_by} rows between unbounded preceding and current row) as {out_name}"
        )
    for k in distinct_keys:
        out_name = output_names.get(k, k)
        cum_select_cols.append(
            f"sum({out_name}_new) over(partition by {part_by} order by {order_by} rows between unbounded preceding and current row) as {out_name}"
        )

    final = "final as (\n  select " + ",\n         ".join(cum_select_cols) + "\n  from joined\n)"

    # 输出列顺序与目标表对齐（静态分区写入不包含 date_p）
    want_cols = []
    for c in non_part_cols:
        if c in dim_cols or c == "date_minute":
            want_cols.append(c)
        elif c in [output_names.get(f, f) for f in metric_cols]:
            want_cols.append(c)
        else:
            # 目标表列在当前SQL里没有生成，直接报错更清晰
            raise ValueError(f"dw-compute-mode=sparksql 输出缺少目标表列: {c}")

    schema, table = _split_schema_table(output_table)
    q_target = f"{schema}.{table}" if schema else table

    detail_sql = raw_hql.strip().rstrip(";").strip()

    raw_detail_cte = None
    if preagg and ("time_minute" in fields):
        # 预聚合在 sparksql 模式下必须用 CTE 方式展开，避免 `from (select ...)` 子查询触发 OneSQL 解析失败。
        time_cols = {"time_hour", "time_minute", "date_p", "date_minute", "time_minute_10"}
        metric_cols = [f for f in fields if f in metric_rules]
        distinct_fields = [f for f in metric_cols if metric_rules.get(f) == "distinct"]
        sum_fields = [f for f in metric_cols if metric_rules.get(f) == "sum"]
        dim_cols_pre = [c for c in fields if c not in metric_cols and c not in time_cols]

        tm_expr = "concat(substr(cast(time_minute as string),1,11),'0')"
        group_cols = []
        group_cols.extend(dim_cols_pre)
        group_cols.extend(distinct_fields)
        group_cols.append(tm_expr)
        if "date_p" in fields:
            group_cols.append("date_p")

        select_cols = []
        for f in fields:
            if f == "time_minute":
                select_cols.append(f"{tm_expr} as time_minute")
            elif f == "time_hour":
                select_cols.append("max(time_hour) as time_hour")
            elif f == "date_p":
                select_cols.append("date_p")
            elif f in sum_fields:
                select_cols.append(f"sum({f}) as {f}")
            else:
                select_cols.append(f)

        raw_detail_cte = "raw_detail as (\n" + detail_sql + "\n)"
        raw_cte = (
            "raw as (\n"
            + "select "
            + ", ".join(select_cols)
            + "\nfrom raw_detail\n"
            + "group by "
            + ", ".join(group_cols)
            + "\n)"
        )
    else:
        raw_cte = "raw as (\n" + detail_sql + "\n)"
    base_cte = (
        "base as (\n"
        "  select\n"
        f"    {', '.join(base_select_cols)}\n"
        "  from raw\n"
        f"  where cast(date_p as bigint) = {int(date_p)}\n"
        f"    and cast(time_minute as bigint) >= {int(start_ts_10)}\n"
        f"    and cast(time_minute as bigint) <= {int(end_ts)}\n"
        ")"
    )

    cte_parts = []
    if raw_detail_cte:
        cte_parts.append(raw_detail_cte)
    cte_parts.extend([raw_cte, base_cte, spine, sum_bucket])
    cte_parts.extend(distinct_ctes)
    cte_parts.extend([dims_set, grid, joined, final])
    with_sql = ",\n".join([p.strip() for p in cte_parts if p and p.strip()])

    insert_sql = (
        "set hive.exec.dynamic.partition.mode=nonstrict;\n"
        "with\n"
        f"{with_sql}\n"
        f"insert overwrite table {q_target} partition(date_p={int(date_p)})\n"
        f"select {', '.join(want_cols)}\n"
        "from final"
    ).strip()

    return insert_sql + "\n"


def _build_sparksql_cum_cube_insert_subquery(
    *,
    raw_hql: str,
    output_table: str,
    anchor_table: str,
    date_p: int,
    start_ts: int,
    end_ts: int,
    fields: List[str],
    metric_rules: dict,
    output_names: dict,
    schema_info: dict,
    no_cube: bool,
    preagg: bool,
) -> str:
    """
    在集群侧用 SparkSQL 直接计算“10分钟累计 + CUBE（可选）”，并 insert overwrite 到目标分区表（date_p）。

    注意：线上 OneSQL 校验对 JOIN 有额外限制（Join 两端必须是子查询），且 `select * from <CTE>` 会被当成真实表解析。
    因此这里不使用 WITH/CTE 来组织中间结果，而是生成“全子查询”的 INSERT SQL。
    """
    time_cols = {"time_hour", "time_minute", "date_p", "date_minute", "time_minute_10"}
    metric_cols = [f for f in fields if f in metric_rules]
    dim_cols = [c for c in fields if c not in metric_cols and c not in time_cols]

    if "time_minute" not in fields:
        raise ValueError("dw-compute-mode=sparksql 需要输入SQL包含 time_minute 字段")
    if "date_p" not in fields:
        raise ValueError("dw-compute-mode=sparksql 需要输入SQL包含 date_p 字段")

    start_ts_10 = floor_10m(int(start_ts))
    end_ts_10 = floor_10m(int(end_ts))

    # 目标表列（不含分区列）
    table_cols = schema_info["cols"]
    part_cols = schema_info["part_cols"] or []
    if part_cols and "date_p" not in part_cols:
        raise RuntimeError(f"目标表分区字段未发现date_p，解析到的分区字段: {part_cols}")
    non_part_cols = [c for c in table_cols if c != "date_p"]

    # 规范化维度：对齐线上的校验SQL口径（func_name 走未定义功能；其他维度默认未知）
    dim_norm_exprs = []
    for c in dim_cols:
        if c == "func_name":
            dim_norm_exprs.append(
                "case when func_name is null or func_name='未知' then '未定义功能' else cast(func_name as string) end as func_name"
            )
        else:
            dim_norm_exprs.append(f"coalesce(cast({c} as string),'未知') as {c}")

    distinct_keys = [f for f in metric_cols if metric_rules.get(f) == "distinct"]
    sum_fields = [f for f in metric_cols if metric_rules.get(f) == "sum"]

    def _sparksql_distinct_key_where(k: str) -> str:
        """
        SparkSQL 侧 distinct key（uid/order_id 等）过滤条件：
        - 仅过滤 NULL，以对齐 Hive/SparkSQL 的 count(distinct col) 语义（空字符串等属于合法值，会被计入 distinct）

        说明：
        - pandas 模式是从 query_to_local 落地文件读入，NULL 可能被写成空字段或 '\\N'，因此本地会额外过滤“空值形态”；
          但 sparksql 模式直接在集群侧读表，按 SQL 语义只应过滤 NULL。
        """
        return f"{k} is not null"

    metric_exprs = []
    for f in distinct_keys:
        metric_exprs.append(f"cast({f} as string) as {f}")
    for f in sum_fields:
        metric_exprs.append(f"cast({f} as double) as {f}")

    date_minute_expr = "cast(concat(substr(cast(time_minute as string),1,11),'0') as bigint) as date_minute"

    detail_sql = raw_hql.strip().rstrip(";").strip()

    # 预聚合：把 time_minute 提前取整到10分钟，并对 sum 指标做 sum；distinct key 保留到行级
    def _build_preagg_subquery_sql(from_sql: str) -> str:
        metric_cols_local = [f for f in fields if f in metric_rules]
        distinct_fields = [f for f in metric_cols_local if metric_rules.get(f) == "distinct"]
        sum_fields_local = [f for f in metric_cols_local if metric_rules.get(f) == "sum"]
        dim_cols_local = [c for c in fields if c not in metric_cols_local and c not in time_cols]
        tm_expr = "concat(substr(cast(time_minute as string),1,11),'0')"

        group_cols = []
        group_cols.extend(dim_cols_local)
        group_cols.extend(distinct_fields)
        group_cols.append(tm_expr)
        if "date_p" in fields:
            group_cols.append("date_p")

        select_cols = []
        for f in fields:
            if f == "time_minute":
                select_cols.append(f"{tm_expr} as time_minute")
            elif f == "time_hour":
                select_cols.append("max(time_hour) as time_hour")
            elif f == "date_p":
                select_cols.append("date_p")
            elif f in sum_fields_local:
                select_cols.append(f"sum({f}) as {f}")
            else:
                select_cols.append(f)

        # 额外加 start/end 过滤，避免明细SQL漏写导致全表扫描
        where_extra = (
            f"where cast(date_p as bigint) = {int(date_p)} "
            f"and cast(time_minute as bigint) >= {int(start_ts_10)} "
            f"and cast(time_minute as bigint) <= {int(end_ts)}"
        )

        return (
            "select "
            + ", ".join(select_cols)
            + "\nfrom (\n"
            + from_sql
            + "\n) raw_detail\n"
            + where_extra
            + "\ngroup by "
            + ", ".join(group_cols)
        )

    raw_source_sql = detail_sql
    raw_for_base_sql = _build_preagg_subquery_sql(raw_source_sql) if preagg else raw_source_sql

    base_select_cols = []
    base_select_cols.extend(dim_norm_exprs)
    base_select_cols.extend(metric_exprs)
    base_select_cols.append(date_minute_expr)

    base_sql = (
        "select "
        + ", ".join(base_select_cols)
        + "\nfrom (\n"
        + raw_for_base_sql
        + "\n) raw\n"
        + f"where cast(date_p as bigint) = {int(date_p)} "
        + f"and cast(time_minute as bigint) >= {int(start_ts_10)} "
        + f"and cast(time_minute as bigint) <= {int(end_ts)}"
    )

    # spine：生成 [start_ts_10, end_ts_10] 的 10分钟序列
    #
    # OneSQL/PartitionValidator 限制：JOIN/CROSS JOIN 的两端都必须是“有真实表来源的子查询”；
    # 如果一侧是纯常量/函数生成（例如 from (select unix_timestamp(...) ...)），会报“未指定表”。
    #
    # 这里用 anchor_table 作为行数来源，生成 idx=0..N-1，再拼出每个10分钟桶的 date_minute。
    buckets = int((end_ts_10 - start_ts_10) / 10) + 1
    if buckets <= 0:
        buckets = 1
    spine_sql = (
        "select cast(from_unixtime(p.start_u + n.idx*600, 'yyyyMMddHHmm') as bigint) as date_minute\n"
        "from (\n"
        f"  select unix_timestamp('{start_ts_10}', 'yyyyMMddHHmm') as start_u\n"
        f"  from {anchor_table}\n"
        f"  where date_p={int(date_p)}\n"
        "  limit 1\n"
        ") p\n"
        "join (\n"
        "  select cast(row_number() over(order by 1)-1 as int) as idx\n"
        f"  from {anchor_table}\n"
        f"  where date_p={int(date_p)}\n"
        f"  limit {buckets}\n"
        ") n\n"
        "on 1=1"
    )

    # dims：直接从 base 的维度生成（CUBE 产出 '整体' 组合），避免依赖 sum_bucket/req_num_new
    if dim_cols:
        if not no_cube:
            dims_sql = (
                "select "
                + ", ".join([f"coalesce({c},'整体') as {c}" for c in dim_cols])
                + "\nfrom (\n"
                + base_sql
                + "\n) base\n"
                + "group by "
                + ", ".join(dim_cols)
                + " with cube"
            )
        else:
            dims_sql = (
                "select "
                + ", ".join(dim_cols)
                + "\nfrom (\n"
                + base_sql
                + "\n) base\n"
                + "group by "
                + ", ".join(dim_cols)
            )
    else:
        dims_sql = "select 1 as __dummy_dim"

    # per-bucket sum + cube
    sum_bucket_cols = []
    for f in sum_fields:
        out_name = output_names.get(f, f)
        sum_bucket_cols.append(f"sum({f}) as {out_name}_bucket")
    sum_bucket_select = ", ".join(sum_bucket_cols) if sum_bucket_cols else "0 as __dummy_bucket"

    if dim_cols and (not no_cube):
        sum_dim_select = ", ".join([f"coalesce({c},'整体') as {c}" for c in dim_cols])
        sum_group_by = "group by date_minute, " + ", ".join(dim_cols) + " with cube"
    elif dim_cols:
        sum_dim_select = ", ".join(dim_cols)
        sum_group_by = "group by date_minute, " + ", ".join(dim_cols)
    else:
        sum_dim_select = ""
        sum_group_by = "group by date_minute"

    sum_bucket_sql = (
        "select date_minute"
        + (", " + sum_dim_select if sum_dim_select else "")
        + (", " + sum_bucket_select if sum_bucket_select else "")
        + "\nfrom (\n"
        + base_sql
        + "\n) base\n"
        + sum_group_by
    )

    # distinct：先求 first_minute，再算每桶新增
    distinct_new_sqls = {}
    for k in distinct_keys:
        out_name = output_names.get(k, k)
        # 关键点：distinct + cube 的语义必须在“distinct key 粒度”上做 cube。
        #
        # 错误做法（会导致 rollup/cube 层级重复计数）：
        #   先按叶子维度求每个 key 的 first_minute，再在“新增数”层面做 with cube。
        #   同一个 uid 可能出现在多个叶子维度值下，rollup(整体) 应该按最早出现时间计 1 次，
        #   但如果对新增数做 cube，会在多个 first_minute 上重复 +1。
        #
        # 正确做法：
        #   先在 (维度, key) 粒度上做 with cube，得到每个 cube 组合下该 key 的 first_minute，
        #   再按 first_minute 聚合为“新增数”，最后对新增数做窗口累计。
        if dim_cols and (not no_cube):
            first_dim_select = ", ".join([f"coalesce({c},'整体') as {c}" for c in dim_cols])
            first_group_by = "group by " + k + ", " + ", ".join(dim_cols) + " with cube"
            new_dim_select = ", ".join(dim_cols)
            new_group_by = "group by first_minute, " + ", ".join(dim_cols)
        elif dim_cols:
            first_dim_select = ", ".join(dim_cols)
            first_group_by = "group by " + k + ", " + ", ".join(dim_cols)
            new_dim_select = ", ".join(dim_cols)
            new_group_by = "group by first_minute, " + ", ".join(dim_cols)
        else:
            first_dim_select = ""
            first_group_by = "group by " + k
            new_dim_select = ""
            new_group_by = "group by first_minute"

        first_sql_inner = (
            "select min(date_minute) as first_minute"
            + (", " + first_dim_select if first_dim_select else "")
            + f", {k} as {k}\n"
            + "from (\n"
            + base_sql
            + f"\n) base\nwhere {_sparksql_distinct_key_where(k)}\n"
            + first_group_by
        )
        # 重要：当 first_group_by 使用 WITH CUBE 时，CUBE 会同时作用在 group by 列表的所有列上（包含 distinct key 本身），
        # 从而额外产出一行 “{k}=NULL” 的 rollup 结果（即把所有 key 汇总到一起）。
        # 这行若不剔除，会在后续 count(1) 时导致每个维度组合稳定多 +1（典型现象：user_num 差 -1）。
        first_sql = f"select * from (\n{first_sql_inner}\n) t\nwhere t.{k} is not null"

        new_sql = (
            "select first_minute as date_minute"
            + (", " + new_dim_select if new_dim_select else "")
            + f", count(1) as {out_name}_new\n"
            + "from (\n"
            + first_sql
            + "\n) first\n"
            + new_group_by
        )
        distinct_new_sqls[out_name] = new_sql

    # grid：维度 x 时间
    if dim_cols:
        grid_cols = ", ".join([f"d.{c}" for c in dim_cols]) + ", s.date_minute"
    else:
        grid_cols = "d.__dummy_dim, s.date_minute"
    grid_sql = (
        "select "
        + grid_cols
        + "\nfrom (\n"
        + dims_sql
        + "\n) d\n"
        + "cross join (\n"
        + spine_sql
        + "\n) s"
    )

    # join buckets（JOIN 两端必须是子查询）
    def _join_cond(left_alias: str, right_alias: str) -> str:
        conds = [f"{left_alias}.date_minute={right_alias}.date_minute"]
        for c in dim_cols:
            conds.append(f"{left_alias}.{c}={right_alias}.{c}")
        return " and ".join(conds)

    joined_select_fields = []
    if dim_cols:
        joined_select_fields.extend([f"g.{c}" for c in dim_cols])
    joined_select_fields.append("g.date_minute")

    for f in sum_fields:
        out_name = output_names.get(f, f)
        joined_select_fields.append(f"coalesce(b.{out_name}_bucket,0) as {out_name}_bucket")
    for out_name in [output_names.get(k, k) for k in distinct_keys]:
        joined_select_fields.append(f"coalesce(n_{out_name}.{out_name}_new,0) as {out_name}_new")

    joined_sql = (
        "select "
        + ", ".join(joined_select_fields)
        + "\nfrom (\n"
        + grid_sql
        + "\n) g\n"
        + "left join (\n"
        + sum_bucket_sql
        + "\n) b\n"
        + "on "
        + _join_cond("g", "b")
    )
    for out_name, new_sql in distinct_new_sqls.items():
        joined_sql += (
            "\nleft join (\n"
            + new_sql
            + f"\n) n_{out_name}\n"
            + "on "
            + _join_cond("g", f"n_{out_name}")
        )

    # window cumulative
    if dim_cols:
        part_by = ", ".join([f"{c}" for c in dim_cols])
        final_select_cols = [*dim_cols, "date_minute"]
    else:
        part_by = "__dummy_dim"
        final_select_cols = ["1 as __dummy_dim", "date_minute"]

    for f in sum_fields:
        out_name = output_names.get(f, f)
        final_select_cols.append(
            f"sum({out_name}_bucket) over(partition by {part_by} order by date_minute rows between unbounded preceding and current row) as {out_name}"
        )
    for out_name in [output_names.get(k, k) for k in distinct_keys]:
        final_select_cols.append(
            f"sum({out_name}_new) over(partition by {part_by} order by date_minute rows between unbounded preceding and current row) as {out_name}"
        )

    final_sql = (
        "select "
        + ", ".join(final_select_cols)
        + "\nfrom (\n"
        + joined_sql
        + "\n) joined"
    )

    # 输出列顺序与目标表对齐（静态分区写入不包含 date_p）
    want_cols = []
    for c in non_part_cols:
        if c in dim_cols or c == "date_minute":
            want_cols.append(c)
        elif c in [output_names.get(f, f) for f in metric_cols]:
            want_cols.append(c)
        else:
            raise ValueError(f"dw-compute-mode=sparksql 输出缺少目标表列: {c}")

    schema, table = _split_schema_table(output_table)
    q_target = f"{schema}.{table}" if schema else table

    insert_sql = (
        f"insert overwrite table {q_target} partition(date_p={int(date_p)})\n"
        f"select {', '.join(want_cols)}\n"
        "from (\n"
        + final_sql
        + "\n) final\n"
        + "join (\n"
        + f"select 1 from {anchor_table} where date_p={int(date_p)} limit 1\n"
        + ") anchor\n"
        + "on 1=1"
    )
    return insert_sql.strip() + "\n"

def strip_sql_line_comments(sql_text: str) -> str:
    lines = []
    for raw in (sql_text or "").splitlines():
        code, _ = _split_sql_line_comment(raw)
        lines.append(code)
    return "\n".join(lines)


def _read_datawork_query_to_local_file(path: Path, fields: List[str]) -> pd.DataFrame:
    """
    datawork-client query_to_local 输出分隔符在不同环境下可能是 \\0001 被解析成 NUL(\\x00)。
    为避免 pandas CSV 解析对 NUL 不兼容，这里用二进制方式读取并自动探测分隔符。
    """
    b = Path(path).read_bytes()
    if not b:
        return pd.DataFrame(columns=fields)
    lines = b.splitlines()
    if not lines:
        return pd.DataFrame(columns=fields)

    first = lines[0]
    candidates = [b"\x01", b"\x00", b"\t", b","]
    sep = None
    for c in candidates:
        if c in first:
            sep = c
            break
    if sep is None:
        # 单列或未知分隔符：当作整行
        rows = [[ln.decode("utf-8", errors="replace")] for ln in lines]
        cols = fields[:1] if fields else ["col0"]
        return pd.DataFrame(rows, columns=cols)

    rows = []
    for ln in lines:
        parts = ln.split(sep)
        # 兼容末尾额外分隔符导致的空列
        if parts and parts[-1] == b"":
            parts = parts[:-1]
        row = [p.decode("utf-8", errors="replace") for p in parts]
        if len(row) < len(fields):
            row = row + [""] * (len(fields) - len(row))
        elif len(row) > len(fields):
            row = row[: len(fields)]
        rows.append(row)
    return pd.DataFrame(rows, columns=fields)


def _split_sql_line_comment(raw_line: str):
    in_single = False
    in_double = False
    in_backtick = False
    i = 0
    while i < len(raw_line) - 1:
        ch = raw_line[i]
        nxt = raw_line[i + 1]
        if ch == "'" and not in_double and not in_backtick:
            if in_single and nxt == "'":  # escaped quote
                i += 2
                continue
            in_single = not in_single
        elif ch == '"' and not in_single and not in_backtick:
            in_double = not in_double
        elif ch == "`" and not in_single and not in_double:
            in_backtick = not in_backtick
        elif (not in_single) and (not in_double) and (not in_backtick) and ch == "-" and nxt == "-":
            return raw_line[:i], raw_line[i + 2 :]
        i += 1
    return raw_line, ""


def _split_top_level_commas(s: str) -> List[str]:
    parts: List[str] = []
    buf: List[str] = []
    depth = 0
    in_single = False
    in_double = False
    in_backtick = False

    i = 0
    while i < len(s):
        ch = s[i]
        if ch == "'" and not in_double and not in_backtick:
            if in_single and i + 1 < len(s) and s[i + 1] == "'":
                buf.append(ch)
                buf.append("'")
                i += 2
                continue
            in_single = not in_single
        elif ch == '"' and not in_single and not in_backtick:
            in_double = not in_double
        elif ch == "`" and not in_single and not in_double:
            in_backtick = not in_backtick
        elif not in_single and not in_double and not in_backtick:
            if ch == "(":
                depth += 1
            elif ch == ")" and depth > 0:
                depth -= 1
            elif ch == "," and depth == 0:
                part = "".join(buf).strip()
                if part:
                    parts.append(part)
                buf = []
                i += 1
                continue
        buf.append(ch)
        i += 1

    part = "".join(buf).strip()
    if part:
        parts.append(part)
    return parts


def _strip_identifier_quotes(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and ((s[0] == s[-1] == "`") or (s[0] == s[-1] == '"')):
        return s[1:-1]
    return s


def _parse_select_expr(expr: str):
    """
    解析单个SELECT表达式，返回 (输出字段名, 计算规则|None)。
    仅实现常见场景：
    - 裸列、table.col
    - COALESCE(col1,col2,...) AS alias
    - ... AS alias
    - ... alias（不写 AS 的别名写法，例如：nvl(x,'整体') x / case when ... end country_name）
    """
    expr = expr.strip().rstrip(",")
    if not expr:
        return None, None

    # 处理 "xxx as alias"（alias可带反引号）
    m_as = re.search(r"(?i)\bas\b\s+(`?\"?[A-Za-z_][A-Za-z0-9_]*`?\"?)\s*$", expr)
    alias = _strip_identifier_quotes(m_as.group(1)) if m_as else None
    expr_no_alias = expr[: m_as.start()].strip() if m_as else expr
    if alias is None:
        # 处理 "expr alias"（不写 AS）。为避免把纯列名误判为别名，仅对“左侧不是单纯列名”的情况生效。
        m_tail = re.match(r"(?is)^(.*\S)\s+(`?\"?[A-Za-z_][A-Za-z0-9_]*`?\"?)\s*$", expr)
        if m_tail:
            left = m_tail.group(1).strip()
            cand_alias = _strip_identifier_quotes(m_tail.group(2))
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?", left):
                alias = cand_alias
                expr_no_alias = left

    # 直接列名 / 带前缀列名
    m_col = re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?", expr_no_alias)
    if m_col:
        col = expr_no_alias.split(".")[-1]
        return alias or col, None

    # COALESCE(col1, col2, ...) AS alias
    m_coalesce = re.match(r"(?is)coalesce\s*\((.*)\)\s*$", expr_no_alias)
    if m_coalesce and alias:
        inside = m_coalesce.group(1).strip()
        args = []
        for part in _split_top_level_commas(inside):
            part = part.strip()
            if not part:
                continue
            # 仅支持列参数（可带前缀）
            if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?", part):
                args.append(part.split(".")[-1])
        if len(args) >= 2:
            return alias, {"op": "coalesce", "cols": args}

    # 兜底：如果有alias，用alias作为输出字段名，否则忽略该表达式
    if alias:
        return alias, None
    return None, None


def parse_select_fields(sql_text):
    """
    解析SQL SELECT语句中的字段列表
    返回字段列表、指标聚合规则（distinct或sum）和输出列名映射
    
    返回：
        fields: 所有字段列表
        metric_rules: 指标字段的聚合规则字典 {字段名: "distinct"|"sum"}
        output_names: 输出列名映射字典 {原始字段名: 输出列名}
        computed: 需要在本地生成的列规则 {字段名: {"op":..., ...}}
    """
    # 提取SELECT和FROM之间的字段列表
    matches = list(re.finditer(r"\bselect\b(.*?)\bfrom\b", sql_text, flags=re.I | re.S))
    if not matches:
        raise ValueError("SQL文本中未找到 SELECT ... FROM 块")
    # 选择最后一个匹配块，尽量兼容WITH/子查询中出现的SELECT
    block = matches[-1].group(1)
    fields = []
    metric_rules = {}
    output_names = {}  # 输出列名映射
    computed = {}
    default_distinct_output = {"order_id": "req_num", "uid": "user_num"}

    # 逐行解析字段（支持单行多个字段，逗号分隔）
    for raw_line in block.splitlines():
        line = raw_line.strip()
        # 跳过空行和注释行
        if not line or line.startswith("--"):
            continue

        code_part, comment_part = _split_sql_line_comment(raw_line)
        comment_part = (comment_part or "").lower()
        code_part = (code_part or "").strip()
        if not code_part:
            continue

        parts = _split_top_level_commas(code_part)
        for idx, expr in enumerate(parts):
            token, compute_rule = _parse_select_expr(expr)
            if not token:
                continue
            fields.append(token)

            if compute_rule:
                computed[token] = compute_rule

            comment = comment_part if idx == len(parts) - 1 else ""

            # 检查是否是指标字段（distinct或sum）
            if "distinct" in comment:
                metric_rules[token] = "distinct"
                output_match = re.search(r"distinct[_\s:]+(\w+)", comment)
                if output_match:
                    output_name = output_match.group(1)
                    if output_name != token:
                        output_names[token] = output_name
                    else:
                        # 常见约定：distinct order_id -> req_num，distinct uid -> user_num
                        if token in default_distinct_output and token not in output_names:
                            output_names[token] = default_distinct_output[token]
            elif "sum" in comment:
                metric_rules[token] = "sum"
                output_match = re.search(r"sum[_\s:]+(\w+)", comment)
                if output_match:
                    output_name = output_match.group(1)
                    if output_name != token:
                        output_names[token] = output_name

    return fields, metric_rules, output_names, computed


def extract_from_table(sql_text: str):
    matches = list(re.finditer(r"\bselect\b(.*?)\bfrom\b", sql_text, flags=re.I | re.S))
    if not matches:
        return None
    tail = sql_text[matches[-1].end() :]
    m = re.search(r"\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)", tail)
    if not m:
        return None
    return m.group(1)


def floor_10m(x: int) -> int:
    """
    将时间戳向下取整到10分钟
    例如：202512260047 -> 202512260040, 202512260055 -> 202512260050
    """
    # 性能优化：YYYYMMDDHHmm 的“10分钟取整”只需对最后一位（分钟个位）取模即可
    # 202512260047 -> 202512260040（-7）
    # 202512260055 -> 202512260050（-5）
    xi = int(x)
    return xi - (xi % 10)


def _split_schema_table(dw_table: str):
    parts = dw_table.split(".")
    if len(parts) == 1:
        return None, parts[0]
    if len(parts) == 2:
        return parts[0], parts[1]
    raise ValueError(f"dw-table不支持多于2段（schema.table）: {dw_table}")


def _validate_identifier(name: str):
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        raise ValueError(f"非法表/库标识符: {name}")


def _quote_qualified(schema: str, table: str) -> str:
    if schema:
        return f"`{schema}`.`{table}`"
    return f"`{table}`"


def _resolve_dw_kind(args) -> str:
    if args.dw_kind != "auto":
        return args.dw_kind
    if args.dw_url or os.environ.get("DW_URL"):
        return "sqlalchemy"
    return "datawork-client"


def _write_to_warehouse_sqlalchemy(df_out: pd.DataFrame, args):
    dw_url = args.dw_url or os.environ.get("DW_URL")
    if not dw_url:
        raise ValueError("sqlalchemy写入需要--dw-url或环境变量DW_URL")

    schema, table = _split_schema_table(args.dw_table)
    if schema:
        _validate_identifier(schema)
    _validate_identifier(table)

    try:
        from sqlalchemy import create_engine, inspect, text
    except Exception as e:  # pragma: no cover
        raise RuntimeError("缺少SQLAlchemy依赖，无法写入数仓") from e

    engine = create_engine(dw_url, future=True)
    has_table = inspect(engine).has_table(table, schema=schema)

    with engine.begin() as conn:
        if args.dw_mode == "overwrite" and has_table:
            prep = engine.dialect.identifier_preparer
            full_table = prep.quote(table)
            if schema:
                full_table = f"{prep.quote(schema)}.{full_table}"
            conn.execute(text(f"DELETE FROM {full_table} WHERE date_p = :date_p"), {"date_p": args.date_p})

        df_out.to_sql(
            name=table,
            con=conn,
            schema=schema,
            if_exists="append",
            index=False,
            chunksize=args.dw_chunk_size,
            method="multi",
        )

    print(f"已写入数仓表(sqlalchemy): {args.dw_table} (date_p={args.date_p}, mode={args.dw_mode})")


def build_datawork_insert_sql(
    *,
    dw_table: str,
    date_p: int,
    mode: str,
    data_uri: str,
    data_columns: List[str],
    temp_view_raw: str = "cum10m_raw",
    temp_view: str = "cum10m_tmp",
) -> str:
    schema, table = _split_schema_table(dw_table)
    if schema:
        _validate_identifier(schema)
    _validate_identifier(table)

    full_table = f"{schema}.{table}" if schema else table
    insert_kw = "insert into" if mode == "append" else "insert overwrite"

    # Spark CSV：header=false 时列名为 _c0,_c1...
    select_list = ", ".join([f"`{col}`" for col in data_columns])
    cast_list = ", ".join([f"_c{i} as `{col}`" for i, col in enumerate(data_columns)])

    # sep 使用 Hive 传统写法 '\001'，与 online_test.py 的 -fd \\0001 对齐
    # 注意：datawork-client 的 SparkSql 校验常见限制是“每次只能执行一条SQL”，且不保证支持数据源表名（text.`/path` 等）。
    # 这里保留该函数作为“单SQL模板”的拼接入口，真正的 datawork-client 写入采用 union-all 方式（见 _write_to_warehouse_datawork）。
    sql = f"{insert_kw} table {full_table} partition(date_p={date_p}) SELECT 1"
    return sql + "\n"


def _run_datawork_query_capture(args, hql: str, sql_engine: str = "Hive") -> str:
    import subprocess

    cmd = [
        args.dw_datawork_bin,
        "query",
        "-hql",
        hql,
        "-project_name",
        args.dw_project_name,
        "-ca_config_path",
        args.dw_ca_config_path,
        "-env",
        args.dw_env,
        "-se",
        sql_engine,
        "-hive_env",
        args.dw_hive_env,
        "-v",
    ]
    res = subprocess.run(cmd, text=True, capture_output=True)
    return (res.stdout or "") + "\n" + (res.stderr or "")


def _run_datawork_query_to_local(args, hql: str, out_path: Path):
    import subprocess

    def maybe_prefix_presto_settings(engine: str, sql: str) -> str:
        if engine != "Presto":
            return sql
        if args.dw_presto_max_runtime_minute and args.dw_presto_max_runtime_minute > 0:
            # 注意：datawork-client 会自行拆分多条语句并执行；
            # 这里注入的 set 用于放宽 Presto 运行时长限制，避免默认 3min 超时。
            return f"set spark.hive.presto.execution.max.runtime.minute={int(args.dw_presto_max_runtime_minute)}; {sql}"
        return sql

    def run(engine: str):
        sql_text = maybe_prefix_presto_settings(engine, hql)
        cmd = [
            args.dw_datawork_bin,
            "query_to_local",
            "-hql",
            sql_text,
            "-project_name",
            args.dw_project_name,
            "-ca_config_path",
            args.dw_ca_config_path,
            "-env",
            args.dw_env,
            "-se",
            engine,
            "-fd",
            args.dw_query_fd,
            "-file_path",
            str(out_path),
            "-hive_env",
            args.dw_hive_env,
            "-v",
        ]
        subprocess.check_call(cmd)

    try:
        run(args.dw_query_engine)
    except subprocess.CalledProcessError:
        # Presto 在部分环境会触发 3min 查询超时；按用户要求优先回退到 SparkSql
        run(args.dw_query_fallback_engine)
        return
        raise


def _run_datawork_execute_sql_file(args, sql_text: str, engine: str = None) -> Path:
    import subprocess

    tmp_dir = Path(args.dw_tmp_dir)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    stamp = int(time.time() * 1000)
    sql_path = tmp_dir / f"cum10m_exec_{args.date_p}_{stamp}.sql"
    sql_path.write_text((sql_text or "").strip() + "\n", encoding="utf-8")
    try:
        getattr(args, "_tmp_paths", []).append(sql_path)
    except Exception:
        pass

    exec_cmd = [
        args.dw_datawork_bin,
        "execute",
        "-f",
        str(sql_path),
        "-project_name",
        args.dw_project_name,
        "-ca_config_path",
        args.dw_ca_config_path,
        "-env",
        args.dw_env,
        "-se",
        engine or args.dw_engine,
        "-hive_env",
        args.dw_hive_env,
        "-v",
    ]
    if args.dw_dry_run:
        print(f"[dry-run] 已生成SQL文件: {sql_path}")
        print(f"[dry-run] 待执行命令: {' '.join(exec_cmd)}")
        return sql_path

    subprocess.check_call(exec_cmd)
    return sql_path


def _parse_create_table_columns_from_log(log_text: str):
    # datawork-client query 的输出中，建表SQL常以JSON字符串形式出现，包含转义的 \\n
    log_text = (log_text or "").replace("\\r", "").replace("\\n", "\n").replace("\\t", "\t")
    m = re.search(
        r"CREATE\s+(?:EXTERNAL\s+)?TABLE\s+`?[\w.]+`?\s*\((.*?)\)\s*PARTITIONED\s+BY",
        log_text,
        flags=re.I | re.S,
    )
    if not m:
        return None, None
    cols_block = m.group(1)
    cols = []
    col_types = {}
    for line in cols_block.splitlines():
        line = line.strip().rstrip(",")
        if not line:
            continue
        mcol = re.match(r"`?([A-Za-z_][A-Za-z0-9_]*)`?\s+([A-Za-z_][A-Za-z0-9_]*)", line)
        if not mcol:
            continue
        name = mcol.group(1)
        typ = mcol.group(2).lower()
        cols.append(name)
        col_types[name] = typ

    m2 = re.search(r"PARTITIONED\s+BY\s*\((.*?)\)", log_text, flags=re.I | re.S)
    part_cols = []
    if m2:
        part_block = m2.group(1)
        for line in part_block.splitlines():
            line = line.strip().rstrip(",")
            if not line:
                continue
            mcol = re.match(r"`?([A-Za-z_][A-Za-z0-9_]*)`?\s+([A-Za-z_][A-Za-z0-9_]*)", line)
            if mcol:
                part_cols.append(mcol.group(1))
    return cols, part_cols


def _parse_create_table_schema_from_log(log_text: str):
    log_text = (log_text or "").replace("\\r", "").replace("\\n", "\n").replace("\\t", "\t")
    m = re.search(
        r"CREATE\s+(?:EXTERNAL\s+)?TABLE\s+`?[\w.]+`?\s*\((.*?)\)\s*PARTITIONED\s+BY",
        log_text,
        flags=re.I | re.S,
    )
    if not m:
        return None
    cols_block = m.group(1)
    cols = []
    col_types = {}
    for line in cols_block.splitlines():
        line = line.strip().rstrip(",")
        if not line:
            continue
        mcol = re.match(r"`?([A-Za-z_][A-Za-z0-9_]*)`?\s+([A-Za-z_][A-Za-z0-9_]*)", line)
        if not mcol:
            continue
        name = mcol.group(1)
        typ = mcol.group(2).lower()
        cols.append(name)
        col_types[name] = typ

    m2 = re.search(r"PARTITIONED\s+BY\s*\((.*?)\)", log_text, flags=re.I | re.S)
    part_cols = []
    part_types = {}
    if m2:
        part_block = m2.group(1)
        for line in part_block.splitlines():
            line = line.strip().rstrip(",")
            if not line:
                continue
            mcol = re.match(r"`?([A-Za-z_][A-Za-z0-9_]*)`?\s+([A-Za-z_][A-Za-z0-9_]*)", line)
            if mcol:
                part_cols.append(mcol.group(1))
                part_types[mcol.group(1)] = mcol.group(2).lower()

    return {"cols": cols, "col_types": col_types, "part_cols": part_cols, "part_types": part_types}


def _parse_table_location_from_log(log_text: str):
    log_text = (log_text or "").replace("\\r", "").replace("\\n", "\n").replace("\\t", "\t")
    m = re.search(r"(?is)\bLOCATION\b\s*'([^']+)'", log_text)
    if m:
        return m.group(1).strip()
    return None


def _get_table_schema_info_and_location_with_retry(args, *, retries: int = 3, sleep_sec: float = 2.0):
    ddl_log_last = None
    for i in range(max(1, int(retries))):
        ddl_log = _run_datawork_query_capture(args, f"show create table {args.dw_table}", sql_engine="Hive")
        ddl_log_last = ddl_log
        schema_info = _parse_create_table_schema_from_log(ddl_log)
        location = _parse_table_location_from_log(ddl_log)
        if schema_info and location:
            return schema_info, location
        if i < retries - 1:
            time.sleep(sleep_sec * (i + 1))
    snippet = (ddl_log_last or "").strip().splitlines()[-50:]
    raise RuntimeError("无法通过 datawork-client query 解析目标表DDL/LOCATION（show create table），末尾日志：\n" + "\n".join(snippet))


def _sql_literal(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return "NULL"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        # pandas/numpy 标量
        try:
            if pd.isna(v):
                return "NULL"
        except Exception:
            pass
        return str(v)
    s = str(v)
    s = s.replace("\\\\", "\\\\\\\\").replace("'", "''")
    return f"'{s}'"


def _write_to_warehouse_spark(df_out: pd.DataFrame, args):
    """
    使用 pyspark + enableHiveSupport 写入目标表的 date_p 分区。
    优点：不依赖 OneSQL 校验器对常量SQL/UNION/VALUES 的限制，适合写入 ORC 表与大结果集。
    """
    if "date_p" not in df_out.columns:
        raise ValueError("写入数仓需要输出包含date_p列")

    """
    Spark 写入策略（不依赖直连 Hive Metastore）：
    1) 通过 datawork-client query(show create table) 解析表 LOCATION 与列类型
    2) pyspark 在本机 local 模式把 ORC 直接写到 LOCATION/date_p=... 目录
    3) 通过 datawork-client add_partition 注册分区（存在则忽略）
    """
    try:
        from pyspark.sql import SparkSession
        from pyspark.sql import functions as F
        from pyspark.sql.types import (
            BooleanType,
            DecimalType,
            DoubleType,
            FloatType,
            IntegerType,
            LongType,
            StringType,
            StructField,
            StructType,
        )
    except Exception as e:  # pragma: no cover
        raise RuntimeError("当前环境缺少 pyspark，无法使用 spark 写入") from e

    rows = df_out[df_out["date_p"].astype(int) == int(args.date_p)].copy()
    if len(rows) == 0:
        print(f"目标分区 date_p={args.date_p} 无数据，跳过写入: {args.dw_table}")
        return

    # 解析表结构与 LOCATION（走 datawork-client，不依赖本机直连 metastore）
    schema_info, location = _get_table_schema_info_and_location_with_retry(args, retries=3, sleep_sec=2.0)

    table_cols = schema_info["cols"]
    col_types = schema_info["col_types"]
    part_cols = schema_info["part_cols"]
    if part_cols and "date_p" not in part_cols:
        raise RuntimeError(f"目标表分区字段未发现date_p，解析到的分区字段: {part_cols}")

    non_part_cols = [c for c in table_cols if c != "date_p"]
    missing = [c for c in non_part_cols if c not in rows.columns]
    if missing:
        raise ValueError(f"输出结果缺少目标表列: {missing}；当前输出列: {rows.columns.tolist()}")

    # Spark 需要能访问 oss://，这里注入 Jindo(OSS) 相关 jar + Hadoop conf（core-site/hdfs-site）
    def pick_existing(paths: List[str]) -> List[str]:
        return [p for p in paths if p and os.path.exists(p)]

    jindo_jars = pick_existing(
        [
            "/www/hadoop-2.8.3/share/hadoop/hdfs/lib/jindo-core-6.9.1.jar",
            "/www/hadoop-2.8.3/share/hadoop/hdfs/lib/jindo-sdk-6.9.1.jar",
            "/www/hadoop-2.8.3/share/hadoop/hdfs/lib/jindo-core-linux-el6-x86_64-6.9.1.jar",
            "/www/hadoop-2.8.3/share/hadoop/hdfs/lib/jindo-core-linux-ubuntu22-x86_64-6.9.1.jar",
        ]
    )
    core_site = getattr(args, "dw_core_site", "/www/hadoop-2.8.3/etc/hadoop/core-site.xml")
    hdfs_site = getattr(args, "dw_hdfs_site", "/www/hadoop-2.8.3/etc/hadoop/hdfs-site.xml")

    builder = SparkSession.builder.appName(str(args.dw_spark_app_name))
    # 默认用本机 local，避免占用集群资源
    spark_master = getattr(args, "dw_spark_master", None) or "local[*]"
    builder = builder.master(spark_master)
    driver_mem = getattr(args, "dw_spark_driver_memory", None)
    if driver_mem:
        builder = builder.config("spark.driver.memory", str(driver_mem))

    # Spark 本地临时目录：避免占用 /tmp，默认落到 dw-tmp-dir 下，并在成功后清理。
    # 说明：如果集群管理器（YARN/Standalone 等）通过环境变量强制覆盖 spark.local.dir，
    # 该设置可能不会生效（Spark 会打印 warn），但对 local[*] 场景通常有效。
    spark_local_dir = None
    try:
        tmp_root = Path(args.dw_tmp_dir)
        tmp_root.mkdir(parents=True, exist_ok=True)
        spark_local_dir = tmp_root / f"cum10m_spark_local_{int(time.time() * 1000)}_{os.getpid()}"
        spark_local_dir.mkdir(parents=True, exist_ok=True)
        builder = builder.config("spark.local.dir", str(spark_local_dir))
        # 一些依赖（如 jindo）会用 java.io.tmpdir 解压 so；尽量也指向该目录
        builder = builder.config("spark.driver.extraJavaOptions", f"-Djava.io.tmpdir={spark_local_dir}")
        builder = builder.config("spark.executor.extraJavaOptions", f"-Djava.io.tmpdir={spark_local_dir}")
        try:
            args._tmp_paths.append(spark_local_dir)
        except Exception:
            pass
    except Exception:
        # 失败则不强制指定（保持 Spark 默认行为）
        spark_local_dir = None
    if jindo_jars:
        builder = builder.config("spark.jars", ",".join(jindo_jars))
    # 并行度与压缩（写 ORC 时有明显收益）
    parallelism = int(getattr(args, "dw_spark_parallelism", 64) or 64)
    if parallelism > 0:
        builder = builder.config("spark.default.parallelism", str(parallelism))
        builder = builder.config("spark.sql.shuffle.partitions", str(parallelism))
    orc_compression = getattr(args, "dw_orc_compression", "snappy") or "snappy"
    builder = builder.config("spark.sql.orc.compression.codec", str(orc_compression))

    spark = builder.getOrCreate()
    try:
        # 注入 Hadoop conf 以识别 oss:// scheme
        hconf = spark.sparkContext._jsc.hadoopConfiguration()
        if core_site and os.path.exists(core_site):
            hconf.addResource(spark.sparkContext._jvm.org.apache.hadoop.fs.Path(core_site))
        if hdfs_site and os.path.exists(hdfs_site):
            hconf.addResource(spark.sparkContext._jvm.org.apache.hadoop.fs.Path(hdfs_site))

        # 直接写到 partition 目录（ORC）
        base = location.rstrip("/")
        part_path = f"{base}/date_p={int(args.date_p)}"

        prof = getattr(args, "_profiler", None)
        if prof:
            prof.start("write_orc")

        def hive_type_to_spark(t: str):
            t = (t or "string").strip().lower()
            if t in ("string", "varchar", "char"):
                return StringType()
            if t in ("bigint", "long"):
                return LongType()
            if t in ("int", "integer"):
                return IntegerType()
            if t in ("double",):
                return DoubleType()
            if t in ("float",):
                return FloatType()
            if t in ("boolean", "bool"):
                return BooleanType()
            m = re.match(r"decimal\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)", t)
            if m:
                return DecimalType(int(m.group(1)), int(m.group(2)))
            return StringType()

        orc_num_files = int(getattr(args, "dw_orc_num_files", 16) or 16)
        if orc_num_files <= 0:
            orc_num_files = 16

        slice_minutes = int(getattr(args, "dw_write_slice_minutes", 0) or 0)
        if slice_minutes and slice_minutes % 10 != 0:
            raise ValueError("--dw-write-slice-minutes 必须为10的倍数")

        def _spark_load_pdf(pdf: pd.DataFrame):
            load_method = getattr(args, "dw_spark_load_method", "csv") or "csv"
            if load_method == "pandas" and len(pdf) <= 200000:
                # 小数据走 createDataFrame 更快；大数据可能导致 JVM OOM
                return spark.createDataFrame(pdf), []

            # 默认/大数据：先落本地CSV，再由 Spark 读取，避免 Python->JVM 大对象序列化导致 OOM
            tmp_dir = Path(args.dw_tmp_dir)
            tmp_dir.mkdir(parents=True, exist_ok=True)
            stamp = int(time.time() * 1000)
            stage = tmp_dir / f"cum10m_spark_stage_{args.date_p}_{stamp}.csv"
            # 使用 \x01 分隔符，尽量与 datawork-client 的 fd 对齐；不写 header，减少开销
            pdf.to_csv(
                stage,
                sep="\x01",
                header=False,
                index=False,
                encoding="utf-8",
                na_rep="",
            )
            # 全部先按 string 读入，再 cast（空串 cast 数值会得到 null，更稳）
            schema = StructType([StructField(c, StringType(), True) for c in non_part_cols])
            # 注意：部分环境注入的 Hadoop conf 会把 fs.defaultFS 指向 oss://，
            # 直接传 /tmp/... 会被解析成 oss://.../tmp/... 导致“Path does not exist”。
            # 这里显式使用 file:// 读取本地临时文件。
            stage_uri = stage.resolve().as_uri()  # file:///tmp/...
            sdf = spark.read.schema(schema).option("sep", "\x01").csv(stage_uri)
            return sdf, [stage]

        def write_pdf(pdf: pd.DataFrame, *, mode: str):
            sdf, cleanup_paths = _spark_load_pdf(pdf)
            try:
                for c in non_part_cols:
                    typ = col_types.get(c, "string")
                    sdf = sdf.withColumn(c, F.col(c).cast(typ))
                if orc_num_files:
                    sdf = sdf.coalesce(orc_num_files)
                sdf.write.mode(mode).format("orc").option("compression", str(orc_compression)).save(part_path)
            finally:
                for p in cleanup_paths:
                    try:
                        os.remove(p)
                    except Exception:
                        pass

        if args.dw_mode == "overwrite" and slice_minutes:
            # 先用“空写覆盖”清理旧分区，避免前几个slice无数据导致旧文件残留
            empty_schema = StructType(
                [StructField(c, hive_type_to_spark(col_types.get(c, "string")), True) for c in non_part_cols]
            )
            empty = spark.createDataFrame([], schema=empty_schema)
            empty.coalesce(1).write.mode("overwrite").format("orc").option("compression", str(orc_compression)).save(part_path)

        if (not slice_minutes) or ("date_minute" not in rows.columns):
            mode = "append" if args.dw_mode == "append" else "overwrite"
            write_pdf(rows[non_part_cols].copy(), mode=mode)
        else:
            # 按时间分片写入（对超大结果集更稳）
            start_ts_10 = int(floor_10m(int(args.start_ts)))
            end_ts_10 = int(floor_10m(int(args.end_ts)))
            cur = datetime.strptime(str(start_ts_10), "%Y%m%d%H%M")
            end_dt = datetime.strptime(str(end_ts_10), "%Y%m%d%H%M")

            first = True
            while cur <= end_dt:
                slice_end_dt = cur + timedelta(minutes=slice_minutes - 10)
                if slice_end_dt > end_dt:
                    slice_end_dt = end_dt
                s0 = int(cur.strftime("%Y%m%d%H%M"))
                s1 = int(slice_end_dt.strftime("%Y%m%d%H%M"))

                chunk = rows[(rows["date_minute"].astype(int) >= s0) & (rows["date_minute"].astype(int) <= s1)]
                if len(chunk) > 0:
                    mode = "append" if (args.dw_mode == "append" or (not first)) else "overwrite"
                    write_pdf(chunk[non_part_cols].copy(), mode=mode)
                    first = False
                cur = cur + timedelta(minutes=slice_minutes)

        if prof:
            prof.end("write_orc", rows=len(rows), extra=f"orc_files={orc_num_files} slice_minutes={slice_minutes}")
    finally:
        try:
            spark.stop()
        except Exception:
            pass

    # 注册分区（存在则忽略）
    schema, table = _split_schema_table(args.dw_table)
    if not schema:
        raise ValueError("dw-table 必须是 schema.table 形式（便于 add_partition）")
    try:
        import subprocess

        cmd = [
            args.dw_datawork_bin,
            "add_partition",
            "-d",
            schema,
            "-t",
            table,
            "-P",
            f"date_p={int(args.date_p)}",
            "-project_name",
            args.dw_project_name,
            "-ca_config_path",
            args.dw_ca_config_path,
            "-env",
            args.dw_env,
            "-v",
        ]
        # add_partition 返回“分区已存在”也会是非0退出码：这里捕获并忽略
        res = subprocess.run(
            [
                *cmd,
            ],
            text=True,
            capture_output=True,
        )
        if res.returncode != 0:
            merged = (res.stdout or "") + "\n" + (res.stderr or "")
            if ("分区信息已经存在" not in merged) and ("errorCode:-4206" not in merged) and ("-4206" not in merged):
                raise subprocess.CalledProcessError(res.returncode, cmd, output=res.stdout, stderr=res.stderr)
    except Exception as e:
        # 分区已存在会抛错：忽略（-4206）
        msg = str(e)
        if "分区信息已经存在" not in msg and "errorCode:-4206" not in msg:
            raise

    print(f"已写入数仓表(spark-orc-path): {args.dw_table} (date_p={args.date_p}, mode={args.dw_mode})")


def _write_to_warehouse_datawork_union(df_out: pd.DataFrame, args, *, schema_info: dict):
    """
    使用 datawork-client execute 写入：常量 SELECT ... FROM anchor + UNION ALL。
    仅适合小结果集（受 UNION 次数上限影响）；但能通过 OneSQL 分区校验。
    """
    table_cols = schema_info["cols"]
    col_types = schema_info["col_types"]
    part_cols = schema_info["part_cols"]
    if part_cols and "date_p" not in part_cols:
        raise RuntimeError(f"目标表分区字段未发现date_p，解析到的分区字段: {part_cols}")

    rows = df_out[df_out["date_p"].astype(int) == int(args.date_p)].copy()
    non_part_cols = [c for c in table_cols if c != "date_p"]
    missing = [c for c in non_part_cols if c not in rows.columns]
    if missing:
        raise ValueError(f"输出结果缺少目标表列: {missing}；当前输出列: {rows.columns.tolist()}")
    if len(rows) == 0:
        print(f"目标分区 date_p={args.date_p} 无数据，跳过写入: {args.dw_table}")
        return

    anchor_table = getattr(args, "dw_anchor_table", None)
    if not anchor_table:
        raise ValueError("datawork-client 写入需要指定锚点表（--dw-anchor-table）或从输入SQL自动提取FROM表")

    tgt_schema, tgt_table = _split_schema_table(args.dw_table)
    q_target = _quote_qualified(tgt_schema, tgt_table)

    # 每次 execute 的 UNION 次数上限约100：这里每批最多 99 行（再加一个0行锚点select）
    max_rows_per_batch = min(int(getattr(args, "dw_write_batch_rows", 500) or 500), 99)
    if max_rows_per_batch <= 0:
        max_rows_per_batch = 99

    anchor_cte = f"with anchor as (select 1 as k from {anchor_table} where date_p={int(args.date_p)} limit 1)"
    typed_nulls = []
    for c in non_part_cols:
        typ = col_types.get(c, "string")
        typed_nulls.append(f"cast(NULL as {typ}) as `{c}`")
    anchor_select = f"select {', '.join(typed_nulls)} from anchor where 1=0"

    total = len(rows)
    start = 0
    batch_idx = 0
    while start < total:
        end = min(total, start + max_rows_per_batch)
        chunk = rows.iloc[start:end]

        const_selects = []
        for _, r in chunk[non_part_cols].iterrows():
            exprs = []
            for c in non_part_cols:
                typ = col_types.get(c, "string")
                lit = _sql_literal(r[c])
                exprs.append(f"cast({lit} as {typ}) as `{c}`")
            const_selects.append("select " + ", ".join(exprs) + " from anchor")

        union_body = "\nunion all\n".join([anchor_select] + const_selects)

        # overwrite：首批覆盖分区；后续批次追加
        if args.dw_mode == "append":
            insert_kw = "insert into"
        else:
            insert_kw = "insert overwrite" if batch_idx == 0 else "insert into"

        insert_sql = (
            f"{anchor_cte}\n"
            f"{insert_kw} table {q_target} partition(date_p={int(args.date_p)})\n"
            f"select {', '.join([f'`{c}`' for c in non_part_cols])}\n"
            f"from (\n{union_body}\n) t"
        )
        _run_datawork_execute_sql_file(args, insert_sql)

        start = end
        batch_idx += 1

    print(f"已写入数仓表(datawork-client): {args.dw_table} (date_p={args.date_p}, mode={args.dw_mode})")


def _compute_cum_10m_fast(
    df: pd.DataFrame,
    *,
    dim_cols: List[str],
    metric_cols: List[str],
    metric_rules: dict,
    output_names: dict,
    spine_df: pd.DataFrame,
) -> pd.DataFrame:
    """
    更高效的10分钟累计实现：
    - sum 指标：先按(维度,time_minute_10)聚合，再按时间做 groupby.cumsum
    - distinct 指标：先求每个(维度,distinct_key)的首次出现时间，再转为“新增数”并按时间 cumsum
    """
    if "time_minute_10" not in df.columns:
        raise ValueError("缺少 time_minute_10")

    # 分离 distinct/sum 指标
    distinct_fields = [f for f in metric_cols if metric_rules.get(f) == "distinct" and f in df.columns]
    sum_fields = [f for f in metric_cols if metric_rules.get(f) == "sum" and f in df.columns]

    frames = []

    # sum 指标：按时间桶聚合并累计
    if sum_fields:
        gcols = (dim_cols + ["time_minute_10"]) if dim_cols else ["time_minute_10"]
        sums = df.groupby(gcols, dropna=False, sort=False, observed=True)[sum_fields].sum().reset_index()
        sums = sums.sort_values(gcols, kind="mergesort")
        if dim_cols:
            sums[sum_fields] = sums.groupby(dim_cols, dropna=False, sort=False, observed=True)[sum_fields].cumsum()
        else:
            sums[sum_fields] = sums[sum_fields].cumsum()

        rename_map = {c: output_names.get(c, c) for c in sum_fields}
        sums = sums.rename(columns=rename_map)
        frames.append(sums)

    # distinct 指标：首次出现时间 -> 新增 -> 累计
    for f in distinct_fields:
        out_name = output_names.get(f, f)
        # 过滤掉 NULL/空值，避免把 NULL 当成一个 distinct 值（与 Hive count(distinct) 对齐）
        dff = df[_distinct_key_mask(df[f])] if f in df.columns else df
        gcols = (dim_cols + [f]) if dim_cols else [f]
        first = dff.groupby(gcols, dropna=False, sort=False, observed=True)["time_minute_10"].min().reset_index()
        # 每个时间桶“新增”的去重数
        ngcols = (dim_cols + ["time_minute_10"]) if dim_cols else ["time_minute_10"]
        new_cnt = first.groupby(ngcols, dropna=False, sort=False, observed=True).size().reset_index(name=out_name)
        new_cnt = new_cnt.sort_values(ngcols, kind="mergesort")
        if dim_cols:
            new_cnt[out_name] = new_cnt.groupby(dim_cols, dropna=False, sort=False, observed=True)[out_name].cumsum()
        else:
            new_cnt[out_name] = new_cnt[out_name].cumsum()
        frames.append(new_cnt)

    if frames:
        # 合并所有指标
        gcols = (dim_cols + ["time_minute_10"]) if dim_cols else ["time_minute_10"]
        metrics = frames[0]
        for f in frames[1:]:
            metrics = metrics.merge(f, on=gcols, how="outer")
    else:
        metrics = pd.DataFrame(columns=(dim_cols + ["time_minute_10"]))

    # 构造完整的 time×维度 网格，缺失填0
    spine_df = spine_df.copy()
    spine_df["__key"] = 1
    if dim_cols:
        dims = df[dim_cols].drop_duplicates().copy()
        dims["__key"] = 1
        grid = dims.merge(spine_df, on="__key", how="inner").drop(columns=["__key"])
        out = grid.merge(metrics, on=dim_cols + ["time_minute_10"], how="left")
    else:
        out = spine_df.drop(columns=["__key"]).merge(metrics, on=["time_minute_10"], how="left")

    # 缺失指标填0
    metric_out_cols = []
    for f in metric_cols:
        out_name = output_names.get(f, f)
        metric_out_cols.append(out_name)
        if out_name not in out.columns:
            out[out_name] = pd.NA
        out[out_name] = pd.to_numeric(out[out_name], errors="coerce")

    # 累计结果需要在“无新增/无消耗”的时间桶上保持上一个时间点的累计值：
    # 先按时间排序，再按维度组内 forward-fill，最后把起始的 NaN 填 0
    sort_cols = (dim_cols + ["time_minute_10"]) if dim_cols else ["time_minute_10"]
    out = out.sort_values(sort_cols, kind="mergesort")
    if dim_cols:
        out[metric_out_cols] = (
            out.groupby(dim_cols, dropna=False, sort=False, observed=True)[metric_out_cols].ffill().fillna(0)
        )
    else:
        out[metric_out_cols] = out[metric_out_cols].ffill().fillna(0)

    # 列顺序：维度 + time + 指标
    ordered = dim_cols + ["time_minute_10"] + metric_out_cols
    ordered = [c for c in ordered if c in out.columns]
    out = out[ordered]
    return out


def _cube_sum_fast(
    base: pd.DataFrame,
    *,
    dim_cols: List[str],
    metric_cols: List[str],
    time_col: str = "time_minute_10",
) -> pd.DataFrame:
    """
    更高效的 CUBE(sum) 实现：
    - 动态规划：每个 mask（表示被置为“整体”的维度集合）从 parent(mask去掉一位) 聚合得到
    - 避免对原始大表重复做 2^n 次 groupby（仅 1-bit mask 会直接 groupby 大表）

    注意：
    - 这里对指标统一做 sum（与历史实现一致）。
    - distinct 指标在严格 CUBE 语义下并非严格可加；本脚本的“distinct 指标”已经在累计阶段变成数值列，
      这里的 sum 相当于对累计值做汇总（与校验 SQL 的 CUBE(sum) 行为对齐）。
    """
    if base is None or len(base) == 0:
        return base
    if not dim_cols:
        return base
    if time_col not in base.columns:
        raise ValueError(f"缺少时间列 {time_col}")

    cols = dim_cols + [time_col] + metric_cols
    df0 = base[cols].copy()
    n = len(dim_cols)

    dfs = {0: df0}
    for mask in range(1, 1 << n):
        lsb = mask & -mask
        parent = mask ^ lsb
        parent_df = dfs[parent]

        keep_dims = [dim_cols[j] for j in range(n) if not (mask & (1 << j))]
        gcols = keep_dims + [time_col]
        agg = parent_df.groupby(gcols, dropna=False, sort=False, observed=True, as_index=False)[metric_cols].sum()

        for j, col in enumerate(dim_cols):
            if mask & (1 << j):
                agg[col] = "整体"
        agg = agg[dim_cols + [time_col] + metric_cols]
        dfs[mask] = agg

    out = pd.concat(dfs.values(), ignore_index=True)
    out = out.groupby(dim_cols + [time_col], dropna=False, sort=False, observed=True, as_index=False)[metric_cols].sum()
    return out


def _cube_distinct_cum_fast(
    df: pd.DataFrame,
    *,
    dim_cols: List[str],
    key_col: str,
    out_col: str,
    spine_df: pd.DataFrame,
    time_col: str = "time_minute_10",
) -> pd.DataFrame:
    """
    CUBE + distinct 的累计计算（对齐 Hive/SparkSQL 的 count(distinct ...) with cube 语义）：

    关键点：
    - “distinct”在 rollup/cube 维度上不可加，不能用 sum(child) 得到 parent
    - 正确做法：对每个 cube 维度组合，统计 key 的首次出现时间 -> 每桶新增 -> cumsum

    实现方式（动态规划）：
    1) mask=0：先求每个(维度,key)的首次出现时间
    2) mask>0：从 parent(mask 去掉一位) 聚合得到，把更多维度折叠成“整体”
    3) 对每个 mask 产生的表，按(维度,time)统计新增 key 数量并做 cumsum
    4) 构造 dim×time 的完整网格，对缺失时间点做 forward-fill（保持累计值）
    """
    if df is None or len(df) == 0:
        return pd.DataFrame(columns=(dim_cols + [time_col, out_col]))
    if not dim_cols:
        # 无维度时，相当于全局 distinct key 的累计
        first = df.groupby([key_col], dropna=False, sort=False, observed=True)[time_col].min().reset_index()
        new_cnt = first.groupby([time_col], dropna=False, sort=False, observed=True).size().reset_index(name=out_col)
        new_cnt = new_cnt.sort_values([time_col], kind="mergesort")
        new_cnt[out_col] = new_cnt[out_col].cumsum()
        grid = spine_df.copy()
        out = grid.merge(new_cnt, on=[time_col], how="left")
        out[out_col] = pd.to_numeric(out[out_col], errors="coerce").ffill().fillna(0)
        return out[[time_col, out_col]]
    if time_col not in df.columns:
        raise ValueError(f"缺少时间列 {time_col}")
    if key_col not in df.columns:
        raise ValueError(f"缺少去重键列 {key_col}")

    dff = df[_distinct_key_mask(df[key_col])]
    base_first = (
        dff.groupby(dim_cols + [key_col], dropna=False, sort=False, observed=True)[time_col].min().reset_index()
    )

    n = len(dim_cols)
    dfs = {0: base_first}
    for mask in range(1, 1 << n):
        lsb = mask & -mask
        parent = mask ^ lsb
        parent_df = dfs[parent]

        keep_dims = [dim_cols[j] for j in range(n) if not (mask & (1 << j))]
        gcols = keep_dims + [key_col]
        agg = parent_df.groupby(gcols, dropna=False, sort=False, observed=True, as_index=False)[time_col].min()

        for j, col in enumerate(dim_cols):
            if mask & (1 << j):
                agg[col] = "整体"
        agg = agg[dim_cols + [key_col, time_col]]
        dfs[mask] = agg

    # 每个 mask 生成“累计 distinct”时间序列（只在 key 首次出现的桶上有值）
    frames = []
    for dfm in dfs.values():
        new_cnt = dfm.groupby(dim_cols + [time_col], dropna=False, sort=False, observed=True).size().reset_index(name=out_col)
        new_cnt = new_cnt.sort_values(dim_cols + [time_col], kind="mergesort")
        new_cnt[out_col] = new_cnt.groupby(dim_cols, dropna=False, sort=False, observed=True)[out_col].cumsum()
        frames.append(new_cnt)

    metrics = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=(dim_cols + [time_col, out_col]))
    # 同一(维度,time)可能出现重复（例如原始维度值本身就是“整体”），这里按 max 取累计值
    metrics = metrics.groupby(dim_cols + [time_col], dropna=False, sort=False, observed=True, as_index=False)[out_col].max()

    # 构造完整 dim×time 网格并 ffill（保持累计值）
    spine_df = spine_df.copy()
    spine_df["__key"] = 1
    dims = metrics[dim_cols].drop_duplicates().copy()
    dims["__key"] = 1
    grid = dims.merge(spine_df, on="__key", how="inner").drop(columns=["__key"])
    out = grid.merge(metrics, on=dim_cols + [time_col], how="left")
    out = out.sort_values(dim_cols + [time_col], kind="mergesort")
    out[out_col] = pd.to_numeric(out[out_col], errors="coerce")
    out[out_col] = out.groupby(dim_cols, dropna=False, sort=False, observed=True)[out_col].ffill().fillna(0)
    return out[dim_cols + [time_col, out_col]]


def _write_to_warehouse_datawork(df_out: pd.DataFrame, args):
    if "date_p" not in df_out.columns:
        raise ValueError("写入数仓需要输出包含date_p列")

    if args.dw_write_method == "spark":
        # spark 写 ORC 文件到 LOCATION/date_p=...，再 add_partition
        _write_to_warehouse_spark(df_out, args)
        return

    ddl_log = _run_datawork_query_capture(args, f"show create table {args.dw_table}", sql_engine="Hive")
    schema_info = _parse_create_table_schema_from_log(ddl_log)
    if not schema_info:
        raise RuntimeError("无法通过 datawork-client query 解析目标表DDL（show create table），请确认有权限且返回包含建表SQL")

    # 兼容：仍可指定 datawork-client 常量写入（适合小结果集）
    _write_to_warehouse_datawork_union(df_out, args, schema_info=schema_info)


def write_to_warehouse(df_out: pd.DataFrame, args):
    if not args.dw_table:
        return
    kind = _resolve_dw_kind(args)
    if kind == "sqlalchemy":
        _write_to_warehouse_sqlalchemy(df_out, args)
    elif kind == "datawork-client":
        _write_to_warehouse_datawork(df_out, args)
    else:  # pragma: no cover
        raise ValueError(f"未知dw-kind: {kind}")


def main():
    """主函数：执行累计统计计算"""
    args = parse_args()
    _ensure_tmp_dir_or_fallback(args)
    args._tmp_paths = []
    prof = _Profiler(getattr(args, "profile", False))
    args._profiler = prof
    prof.start("total")

    ok = False
    try:
        prof.start("read_sql")
        sql_text = read_sql(args)
        prof.end("read_sql", extra=f"len={len(sql_text or '')}")
        prof.start("parse_select")
        fields, metric_rules, output_names, computed = parse_select_fields(sql_text)
        prof.end("parse_select", extra=f"fields={len(fields)} metrics={len(metric_rules)}")
        if args.dw_table and _resolve_dw_kind(args) == "datawork-client" and not args.dw_anchor_table:
            args.dw_anchor_table = extract_from_table(sql_text)

        if args.source == "excel":
            if not args.input:
                raise ValueError("source=excel 时必须提供 --input")
            prof.start("read_excel")
            df = pd.read_excel(args.input)
            prof.end("read_excel", rows=len(df))
        else:
            if _resolve_dw_kind(args) != "datawork-client":
                raise ValueError("source=datawork 仅支持 datawork-client 环境（请使用 --dw-kind=datawork-client）")
            source_sql = read_source_sql(args)
            params = _parse_sql_params(args)
            # datawork-client(query_to_local) 对多行/注释SQL兼容性不稳定：执行时去掉行注释并合并为单行
            source_sql_exec = strip_sql_line_comments(source_sql)
            hql_raw = substitute_sql_params(source_sql_exec, params)
            hql_raw = re.sub(r"[\r\n\t]+", " ", hql_raw).strip().rstrip(";").strip()
            compute_mode = getattr(args, "dw_compute_mode", "pandas")
            # 预聚合：
            # - pandas 模式：直接改写明细SQL，降低 query_to_local 落地行数
            # - sparksql 模式：由 _build_sparksql_cum_cube_insert 以 CTE 方式展开（避免 OneSQL 解析不支持子查询）
            if compute_mode == "sparksql":
                hql = hql_raw
            else:
                hql = (
                    _build_preagg_hql(hql_raw, fields=fields, metric_rules=metric_rules)
                    if getattr(args, "dw_preagg", True)
                    else hql_raw
                )

            if compute_mode == "sparksql":
                if not args.dw_table:
                    raise ValueError("dw-compute-mode=sparksql 需要指定 --output_table/--dw-table")
                if not args.dw_anchor_table:
                    raise ValueError("dw-compute-mode=sparksql 需要锚点表（--dw-anchor-table 或在输入SQL中包含 FROM 以便自动提取）")
                schema_info, _ = _get_table_schema_info_and_location_with_retry(args, retries=3, sleep_sec=2.0)
                insert_sql = _build_sparksql_cum_cube_insert_subquery(
                    raw_hql=hql,
                    output_table=args.dw_table,
                    anchor_table=args.dw_anchor_table,
                    date_p=int(args.date_p),
                    start_ts=int(args.start_ts),
                    end_ts=int(args.end_ts),
                    fields=fields,
                    metric_rules=metric_rules,
                    output_names=output_names,
                    schema_info=schema_info,
                    no_cube=bool(args.no_cube),
                    preagg=bool(getattr(args, "dw_preagg", True)),
                )
                prof.start("compute_sparksql")
                _run_datawork_execute_sql_file(args, insert_sql, engine=args.dw_compute_engine)
                prof.end("compute_sparksql", extra=f"engine={args.dw_compute_engine}")
                # sparksql 模式由集群直接写入表，不再走本机 pandas 与 write_to_warehouse
                ok = True
                return

            tmp_dir = Path(args.dw_tmp_dir)
            tmp_dir.mkdir(parents=True, exist_ok=True)
            stamp = int(time.time() * 1000)
            out_path = tmp_dir / f"cum10m_source_{args.date_p}_{stamp}.txt"
            args._tmp_paths.append(out_path)
            prof.start("query_to_local")
            _run_datawork_query_to_local(args, hql, out_path)
            try:
                sz = out_path.stat().st_size
            except Exception:
                sz = None
            max_bytes = int(getattr(args, "dw_query_to_local_max_bytes", 0) or 0)
            if (sz is not None) and max_bytes > 0 and sz > max_bytes:
                raise RuntimeError(
                    f"query_to_local 落地文件过大（{sz} bytes > {max_bytes} bytes）；"
                    f"请改用 --dw-compute-mode sparksql 在集群侧计算写入，或显式关闭限制。"
                )
            prof.end(
                "query_to_local",
                extra=(f"file={out_path} bytes={sz}" if sz is not None else f"file={out_path}"),
            )
            prof.start("read_local_file")
            df = _read_datawork_query_to_local_file(out_path, fields)
            prof.end("read_local_file", rows=len(df))

        df.columns = [str(c).strip() for c in df.columns]

        if not fields:
            raise ValueError("SQL SELECT 字段列表为空")
        if not metric_rules:
            raise ValueError("未在SQL注释中识别到任何指标聚合规则（distinct/sum）")

        # 处理本地可计算的表达式列（目前仅支持COALESCE；如果已在输入中存在同名列则跳过）
        for out_col, rule in computed.items():
            if out_col in df.columns:
                continue
            if rule.get("op") == "coalesce":
                cols = [c for c in (rule.get("cols") or []) if c]
                missing = [c for c in cols if c not in df.columns]
                if missing:
                    raise ValueError(f"COALESCE生成列 {out_col} 缺少输入列: {missing}")
                s = df[cols[0]]
                for c in cols[1:]:
                    s = s.where(s.notna(), df[c])
                df[out_col] = s

        # 校验：维度/指标字段必须存在（时间字段允许缺省，除time_minute外）
        metric_fields = [f for f in fields if f in metric_rules]
        time_cols = {"time_hour", "time_minute", "date_p", "date_minute", "time_minute_10"}
        missing_metrics = [f for f in metric_fields if f not in df.columns]
        missing_dims = [f for f in fields if f not in metric_rules and f not in time_cols and f not in df.columns]
        if missing_metrics or missing_dims:
            msg_parts = []
            if missing_metrics:
                msg_parts.append(f"缺少指标列: {missing_metrics}")
            if missing_dims:
                msg_parts.append(f"缺少维度列: {missing_dims}")
            raise ValueError("输入数据列不完整，" + "；".join(msg_parts))

        # 只保留SQL中指定的字段
        use_cols = [c for c in fields if c in df.columns]
        if not use_cols:
            raise ValueError("输入数据中未找到SELECT字段")
        df = df[use_cols]

        # 标准化time_minute列（处理可能的浮点数格式）
        if "time_minute" not in df.columns:
            raise ValueError("输入数据必须包含time_minute列")
        # 将time_minute转换为整数（移除小数部分）
        df["time_minute"] = pd.to_numeric(
            df["time_minute"].astype(str).str.replace(r"\..*$", "", regex=True), errors="coerce"
        )
        df = df.dropna(subset=["time_minute"])
        df["time_minute"] = df["time_minute"].astype("int64")

        # 过滤date_p（如果存在）
        if "date_p" in df.columns:
            df["date_p"] = pd.to_numeric(df["date_p"], errors="coerce")
            df = df[df["date_p"] == args.date_p]

        # 先计算time_minute_10，然后按time_minute_10过滤，而不是按time_minute过滤
        # 这很重要，因为累计计算使用的是time_minute_10，而不是time_minute
        # 向下取整到10分钟（向量化，避免逐行 datetime 解析）
        df["time_minute_10"] = (df["time_minute"] - (df["time_minute"] % 10)).astype("int64")

        # 对于累计计算，我们需要从当天开始到end_ts的所有数据（按time_minute_10计算）
        # start_ts和end_ts仅用于确定输出的时间轴范围
        end_ts_10 = floor_10m(args.end_ts)
        df = df[df["time_minute_10"] <= end_ts_10]
        if getattr(args, "profile", False):
            try:
                mem_mb = df.memory_usage(deep=True).sum() / 1024 / 1024
                prof.info(f"预处理后 df 行数={len(df)} 内存≈{mem_mb:.1f}MB")
            except Exception:
                prof.info(f"预处理后 df 行数={len(df)}")

        # 指标字段（按SELECT顺序）
        metric_cols = [f for f in fields if f in metric_rules]
        # 确保sum类指标是数值类型（避免object字符串sum变成拼接）
        for c in metric_cols:
            if metric_rules.get(c) == "sum" and c in df.columns:
                df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)

        # 维度列 = SELECT字段中排除指标列和时间列
        dim_cols = [c for c in fields if c not in metric_cols and c not in time_cols]
        dim_cols = [c for c in dim_cols if c in df.columns]

        # 维度值标准化（含 func_name 特殊规则）
        df = _normalize_dim_values(df, dim_cols)

        # 生成时间轴（10分钟间隔）
        start_dt = datetime.strptime(str(args.start_ts), "%Y%m%d%H%M")
        end_dt = datetime.strptime(str(args.end_ts), "%Y%m%d%H%M")
        # 将开始和结束时间向下取整到10分钟
        start_dt = start_dt.replace(minute=(start_dt.minute // 10) * 10, second=0, microsecond=0)
        end_dt = end_dt.replace(minute=(end_dt.minute // 10) * 10, second=0, microsecond=0)
        spine = pd.date_range(start=start_dt, end=end_dt, freq="10min")
        spine_df = pd.DataFrame({"time_minute_10": spine.strftime("%Y%m%d%H%M").astype(int)})

        # 累计计算
        if len(df) == 0:
            cum = pd.DataFrame(columns=(dim_cols + ["time_minute_10"] + [output_names.get(f, f) for f in metric_cols]))
            cum = spine_df.merge(cum, on="time_minute_10", how="left") if not dim_cols else cum
            for f in metric_cols:
                out_name = output_names.get(f, f)
                if out_name not in cum.columns:
                    cum[out_name] = 0
        else:
            prof.start("compute_cum")
            cum = _compute_cum_10m_fast(
                df,
                dim_cols=dim_cols,
                metric_cols=metric_cols,
                metric_rules=metric_rules,
                output_names=output_names,
                spine_df=spine_df,
            )
            prof.end("compute_cum", rows=len(cum))

        # CUBE聚合：生成所有维度组合（包括"整体"）
        if args.no_cube:
            out = cum
        else:
            prof.start("compute_cube")
            # sum 指标可加：对累计值做 CUBE(sum) 可以对齐校验 SQL 的行为
            sum_metric_cols = [f for f in metric_cols if metric_rules.get(f) == "sum"]
            sum_out_cols = [output_names.get(f, f) for f in sum_metric_cols]
            sum_out_cols = [c for c in sum_out_cols if c in cum.columns]
            cum = _maybe_categorize_dims(cum, dim_cols)

            parts = []
            if sum_out_cols:
                cube_sum = _cube_sum_fast(cum, dim_cols=dim_cols, metric_cols=sum_out_cols, time_col="time_minute_10")
                parts.append(cube_sum)

            # distinct 指标不可加：必须重新计算 count(distinct) with cube 的累计
            for f in [x for x in metric_cols if metric_rules.get(x) == "distinct"]:
                out_name = output_names.get(f, f)
                cube_dist = _cube_distinct_cum_fast(
                    df,
                    dim_cols=dim_cols,
                    key_col=f,
                    out_col=out_name,
                    spine_df=spine_df,
                    time_col="time_minute_10",
                )
                parts.append(cube_dist)

            if not parts:
                out = cum
            else:
                # 合并各类指标（sum cube + distinct cube）
                gcols = dim_cols + ["time_minute_10"]
                out = parts[0]
                for p2 in parts[1:]:
                    out = out.merge(p2, on=gcols, how="outer")

                # 缺失指标填 0
                for f in metric_cols:
                    out_name = output_names.get(f, f)
                    if out_name not in out.columns:
                        out[out_name] = 0
                    out[out_name] = pd.to_numeric(out[out_name], errors="coerce").fillna(0)

            prof.end("compute_cube", rows=len(out))

        out = out.rename(columns={"time_minute_10": "date_minute"})
        out["date_p"] = args.date_p

        if args.dw_table:
            write_to_warehouse(out, args)

        if args.output:
            out_excel = out.copy()
            out_excel["date_minute"] = out_excel["date_minute"].astype(str)
            out_excel["date_p"] = out_excel["date_p"].astype(str)
            out_excel.to_excel(args.output, index=False)
            print(f"已写入: {args.output}")

        if (not args.output) and (not args.dw_table):
            raise ValueError("必须至少指定一个输出：--output 或 --dw-table")

        ok = True
    finally:
        # 默认：成功后清理本次产生的 cum10m_* 临时文件；失败保留便于排查
        if ok and (not getattr(args, "dw_keep_tmp", False)):
            _cleanup_run_tmp_files(args)
        # 若选择保留临时文件，可额外裁剪为仅保留最新 N 个
        if ok and getattr(args, "dw_keep_tmp", False):
            _cleanup_keep_last_tmp_files(args)

        prof.end("total")
        prof.dump()


if __name__ == "__main__":
    main()
