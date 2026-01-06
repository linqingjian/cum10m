import subprocess
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from cum10m import (
    _compute_cum_10m_fast,
    _cube_distinct_cum_fast,
    _build_sparksql_cum_cube_insert_subquery,
    _distinct_key_mask,
    _normalize_dim_values,
    _parse_create_table_columns_from_log,
    build_datawork_insert_sql,
    floor_10m,
    parse_select_fields,
)


def test_parse_select_fields_basic_and_output_names():
    sql = """
    SELECT
      cost_type,        -- 维度
      order_id,         -- distinct_req_num
      uid,              -- distinct:user_num
      req_time,         -- sum
      cost              -- sum_cost
    FROM t
    """
    fields, metric_rules, output_names, computed = parse_select_fields(sql)
    assert fields == ["cost_type", "order_id", "uid", "req_time", "cost"]
    assert metric_rules == {"order_id": "distinct", "uid": "distinct", "req_time": "sum", "cost": "sum"}
    assert output_names == {"order_id": "req_num", "uid": "user_num"}
    assert computed == {}


def test_parse_select_fields_prefers_last_select_block():
    sql = """
    WITH cte AS (
      SELECT inner_col, inner_metric -- distinct_inner
      FROM inner_t
    )
    SELECT outer_dim, order_id -- distinct_req_num
    FROM cte
    """
    fields, metric_rules, output_names, computed = parse_select_fields(sql)
    assert fields == ["outer_dim", "order_id"]
    assert metric_rules == {"order_id": "distinct"}
    assert output_names == {"order_id": "req_num"}
    assert computed == {}


def test_floor_10m():
    assert floor_10m(202512260047) == 202512260040
    assert floor_10m(202512260055) == 202512260050
    assert floor_10m(202512260000) == 202512260000


def test_parse_select_fields_coalesce_expr():
    sql = """
    SELECT
      COALESCE(func_name, func_id) as func_name, -- 维度
      order_id, -- distinct_req_num
      time_minute,
      date_p
    FROM t
    """
    fields, metric_rules, output_names, computed = parse_select_fields(sql)
    assert "func_name" in fields
    assert computed["func_name"]["op"] == "coalesce"
    assert computed["func_name"]["cols"] == ["func_name", "func_id"]
    assert metric_rules["order_id"] == "distinct"
    assert output_names == {"order_id": "req_num"}


def test_parse_select_fields_supports_expr_alias_without_as():
    sql = """
    SELECT
      nvl(cost_type, '整体') cost_type, -- 维度
      case when country_name is not null then '其他' else '未知' end country_name, -- 维度
      order_id, -- distinct_req_num
      time_minute,
      date_p
    FROM t
    """
    fields, metric_rules, output_names, computed = parse_select_fields(sql)
    assert "cost_type" in fields
    assert "country_name" in fields
    assert metric_rules["order_id"] == "distinct"


def test_parse_create_table_columns_from_log():
    log = """
    [2025-12-29 15:37:46] 建表SQL如下：
    CREATE EXTERNAL TABLE `stat_aigc.cost_arz_roboneo_aigc_onecost_mina_backfill`(
      `cost_type` string,
      `algo_provider` string,
      `req_num` double,
      `date_minute` bigint)
    PARTITIONED BY (
      `date_p` bigint)
    STORED AS INPUTFORMAT 'org.apache.hadoop.hive.ql.io.orc.OrcInputFormat'
    """
    cols, parts = _parse_create_table_columns_from_log(log)
    assert cols == ["cost_type", "algo_provider", "req_num", "date_minute"]
    assert parts == ["date_p"]


def test_build_datawork_insert_sql_is_single_statement_placeholder():
    sql = build_datawork_insert_sql(
        dw_table="stat_aigc.cost_arz_roboneo_aigc_onecost_mina_backfill",
        date_p=20251226,
        mode="overwrite",
        data_uri="/x",
        data_columns=["a"],
    )
    assert "insert overwrite" in sql.lower()
    assert "partition(date_p=20251226)" in sql


def test_build_sparksql_cum_cube_distinct_first_seen_uses_cube_at_key_level():
    # 只做“SQL 形状”校验：distinct + cube 必须在 (维度, key) 粒度做 cube，
    # 否则 rollup(整体) 会重复计数。
    raw_hql = """
    select
      cost_type,
      uid,       -- distinct_user_num
      req_time,  -- sum
      time_minute,
      date_p
    from t
    """
    fields = ["cost_type", "uid", "req_time", "time_minute", "date_p"]
    metric_rules = {"uid": "distinct", "req_time": "sum"}
    output_names = {"uid": "user_num", "req_time": "req_time"}
    schema_info = {"cols": ["cost_type", "user_num", "req_time", "date_minute", "date_p"], "part_cols": ["date_p"]}

    sql = _build_sparksql_cum_cube_insert_subquery(
        raw_hql=raw_hql,
        output_table="stat_aigc.cost_xxx",
        anchor_table="stat_aigc.cost_anchor",
        date_p=20251230,
        start_ts=202512300000,
        end_ts=202512300100,
        fields=fields,
        metric_rules=metric_rules,
        output_names=output_names,
        schema_info=schema_info,
        no_cube=False,
        preagg=False,
    )

    assert "count(1) as user_num_new" in sql
    assert "group by uid, cost_type with cube" in sql
    assert "group by first_minute, cost_type with cube" not in sql
    # CUBE 会同时 rollup uid，必须在聚合后剔除 uid is null 的汇总行，否则会稳定多 +1
    assert "where t.uid is not null" in sql.lower()


def test_distinct_key_mask_filters_null_like_strings():
    s = pd.Series([None, "", " ", "\\N", "null", "NULL", "u1"])
    mask = _distinct_key_mask(s)
    got = s[mask].tolist()
    assert got == ["u1"]


def test_cli_accepts_stdin_sql_and_no_dim_cols(tmp_path):
    out_xlsx = tmp_path / "out.xlsx"
    sql = """
    SELECT
      order_id,  -- distinct_req_num
      uid,       -- distinct_user_num
      req_time,  -- sum
      cost,      -- sum
      time_minute,
      date_p
    FROM t
    """
    cmd = [
        sys.executable,
        "cum10m.py",
        "--source",
        "excel",
        "--input",
        "360度运镜.xlsx",
        "--output",
        str(out_xlsx),
        "--date-p",
        "20251226",
        "--start-ts",
        "202512260000",
        "--end-ts",
        "202512260100",
        "--no-cube",
    ]
    subprocess.run(cmd, input=sql, text=True, check=True)

    df = pd.read_excel(out_xlsx, dtype=str)
    assert set(["date_minute", "req_num", "user_num", "req_time", "cost", "date_p"]).issubset(df.columns)
    assert len(df) == 7

    df = df.sort_values("date_minute")
    for col in ["req_num", "user_num", "req_time", "cost"]:
        vals = pd.to_numeric(df[col], errors="coerce").fillna(0).tolist()
        assert vals == sorted(vals)

    assert df["date_minute"].map(len).eq(12).all()
    assert df["date_p"].eq("20251226").all()


def test_cli_writes_to_dw_sqlite_overwrite_partition(tmp_path):
    db_path = tmp_path / "dw.db"
    dw_url = f"sqlite:///{db_path}"

    sql = """
    SELECT
      order_id,  -- distinct_req_num
      uid,       -- distinct_user_num
      req_time,  -- sum
      cost,      -- sum
      time_minute,
      date_p
    FROM t
    """

    base_cmd = [
        sys.executable,
        "cum10m.py",
        "--source",
        "excel",
        "--input",
        "360度运镜.xlsx",
        "--date-p",
        "20251226",
        "--start-ts",
        "202512260000",
        "--end-ts",
        "202512260100",
        "--no-cube",
        "--dw-table",
        "stat_aigc_cost_backfill",
        "--dw-url",
        dw_url,
    ]

    subprocess.run(base_cmd + ["--dw-mode", "append"], input=sql, text=True, check=True)
    subprocess.run(base_cmd + ["--dw-mode", "overwrite"], input=sql, text=True, check=True)

    import sqlalchemy as sa

    engine = sa.create_engine(dw_url, future=True)
    with engine.connect() as conn:
        cnt = pd.read_sql_query("select count(1) as c from stat_aigc_cost_backfill", conn)["c"].iloc[0]
        assert int(cnt) == 7
        date_ps = pd.read_sql_query(
            "select distinct date_p from stat_aigc_cost_backfill order by date_p",
            conn,
        )["date_p"].tolist()
        assert date_ps == [20251226]


def test_compute_cum_forward_fill_on_missing_buckets():
    df = pd.DataFrame(
        {
            "dim": ["a"],
            "order_id": ["o1"],
            "uid": ["u1"],
            "req_time": [50.413],
            "cost": [1.245816],
            "time_minute_10": [202512300120],
        }
    )
    spine_df = pd.DataFrame({"time_minute_10": [202512300110, 202512300120, 202512300130]})
    out = _compute_cum_10m_fast(
        df,
        dim_cols=["dim"],
        metric_cols=["order_id", "uid", "req_time", "cost"],
        metric_rules={"order_id": "distinct", "uid": "distinct", "req_time": "sum", "cost": "sum"},
        output_names={"order_id": "req_num", "uid": "user_num"},
        spine_df=spine_df,
    )
    out = out.sort_values(["dim", "time_minute_10"])
    got = out[["time_minute_10", "req_num", "user_num", "req_time", "cost"]].to_dict("records")
    assert got == [
        {"time_minute_10": 202512300110, "req_num": 0.0, "user_num": 0.0, "req_time": 0.0, "cost": 0.0},
        {"time_minute_10": 202512300120, "req_num": 1.0, "user_num": 1.0, "req_time": 50.413, "cost": 1.245816},
        {"time_minute_10": 202512300130, "req_num": 1.0, "user_num": 1.0, "req_time": 50.413, "cost": 1.245816},
    ]


def test_normalize_dim_values_func_name_unknown_to_undefined():
    df = pd.DataFrame(
        {
            "func_name": [None, "", "未知", "图生视频"],
            "other_dim": [None, "未知", "x", ""],
        }
    )
    _normalize_dim_values(df, ["func_name", "other_dim"])
    # func_name 不把空字符串当缺失（对齐 COALESCE 语义）；仅 None -> 未定义功能
    assert df["func_name"].tolist() == ["未定义功能", "", "未知", "图生视频"]
    assert df["other_dim"].tolist() == ["未知", "未知", "x", "未知"]


def test_cube_distinct_cum_is_not_additive():
    # 两个维度取值不同，但同一个 uid；rollup 到“整体”时，distinct 应该是 1 而不是 2
    df = pd.DataFrame(
        {
            "d1": ["x", "y"],
            "uid": ["u1", "u1"],
            "time_minute_10": [202512300120, 202512300130],
        }
    )
    spine_df = pd.DataFrame({"time_minute_10": [202512300120, 202512300130]})
    out = _cube_distinct_cum_fast(
        df,
        dim_cols=["d1"],
        key_col="uid",
        out_col="user_num",
        spine_df=spine_df,
        time_col="time_minute_10",
    )
    # 取 rollup 结果（d1='整体'），在 13:0 时也仍然是 1
    roll = out[out["d1"] == "整体"].sort_values("time_minute_10")
    assert roll["user_num"].tolist() == [1.0, 1.0]


def test_distinct_ignores_null_like_hive():
    df = pd.DataFrame(
        {
            "dim": ["a", "a"],
            "uid": ["", "u1"],  # 空字段模拟 query_to_local 输出的 NULL
            "time_minute_10": [202512300120, 202512300120],
        }
    )
    spine_df = pd.DataFrame({"time_minute_10": [202512300120]})
    out = _cube_distinct_cum_fast(
        df,
        dim_cols=["dim"],
        key_col="uid",
        out_col="user_num",
        spine_df=spine_df,
        time_col="time_minute_10",
    )
    got = out[(out["dim"] == "a") & (out["time_minute_10"] == 202512300120)]["user_num"].iloc[0]
    assert float(got) == 1.0
