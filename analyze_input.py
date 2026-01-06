#!/usr/bin/env python3
import pandas as pd
from datetime import datetime

def floor_10m(x: int) -> int:
    dt = datetime.strptime(str(int(x)), "%Y%m%d%H%M")
    dt = dt.replace(minute=(dt.minute // 10) * 10, second=0, microsecond=0)
    return int(dt.strftime("%Y%m%d%H%M"))

df = pd.read_excel('/Users/lqj/Desktop/360度运镜.xlsx')
print('输入数据 shape:', df.shape)
print('\n列名:', df.columns.tolist())

# 处理 time_minute
if 'time_minute' in df.columns:
    df['time_minute'] = pd.to_numeric(df['time_minute'].astype(str).str.replace(r'\..*$', '', regex=True), errors='coerce')
    df = df.dropna(subset=['time_minute'])
    df['time_minute'] = df['time_minute'].astype('int64')
    df['time_minute_10'] = df['time_minute'].apply(floor_10m)

print('\n\n=== Web 数据分析 ===')
web_df = df[df['os_type'] == 'web'].copy() if 'os_type' in df.columns else pd.DataFrame()
print('Web 总行数:', len(web_df))

if len(web_df) > 0 and 'time_minute_10' in web_df.columns:
    print('\n按 time_minute_10 分组统计:')
    agg_dict = {}
    if 'order_id' in web_df.columns:
        agg_dict['order_id'] = 'nunique'
    if 'uid' in web_df.columns:
        agg_dict['uid'] = 'nunique'
    if 'req_time' in web_df.columns:
        agg_dict['req_time'] = 'sum'
    if 'cost' in web_df.columns:
        agg_dict['cost'] = 'sum'
    
    if agg_dict:
        grouped = web_df.groupby('time_minute_10', dropna=False).agg(agg_dict).reset_index()
        print(grouped.to_string(index=False))
        
        print('\n累计到 202512260100:')
        cum_df = web_df[web_df['time_minute_10'] <= 202512260100].copy()
        if len(cum_df) > 0:
            cum_agg = {}
            if 'order_id' in cum_df.columns:
                cum_agg['order_id'] = 'nunique'
            if 'uid' in cum_df.columns:
                cum_agg['uid'] = 'nunique'
            if 'req_time' in cum_df.columns:
                cum_agg['req_time'] = 'sum'
            if 'cost' in cum_df.columns:
                cum_agg['cost'] = 'sum'
            
            if cum_agg:
                cum_result = cum_df.agg(cum_agg)
                print('req_num (distinct order_id):', cum_result.get('order_id', 0))
                print('user_num (distinct uid):', cum_result.get('uid', 0))
                print('req_time (sum):', cum_result.get('req_time', 0))
                print('cost (sum):', cum_result.get('cost', 0))

print('\n\n=== 所有 os_type 的累计统计 (time_minute_10 <= 202512260100) ===')
if 'os_type' in df.columns and 'time_minute_10' in df.columns:
    cum_all = df[df['time_minute_10'] <= 202512260100].copy()
    if len(cum_all) > 0:
        agg_dict = {}
        if 'order_id' in cum_all.columns:
            agg_dict['order_id'] = 'nunique'
        if 'uid' in cum_all.columns:
            agg_dict['uid'] = 'nunique'
        if 'req_time' in cum_all.columns:
            agg_dict['req_time'] = 'sum'
        if 'cost' in cum_all.columns:
            agg_dict['cost'] = 'sum'
        
        if agg_dict:
            result = cum_all.groupby('os_type', dropna=False).agg(agg_dict).reset_index()
            result = result.rename(columns={'order_id': 'req_num', 'uid': 'user_num'})
            print(result.to_string(index=False))

